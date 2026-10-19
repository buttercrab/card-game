//! Native socket admission is bounded before parsing and releases on cleanup.
mod common;
use common::*;
use futures_util::{SinkExt, StreamExt};
use server::{AppState, Config};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Error, Message},
};

#[tokio::test]
async fn native_source_pressure_closes_transiently_without_applying_identity() {
    let addr = serve(AppState::new(Config {
        ingress_room_bytes: 8,
        ingress_global_bytes: 16,
        ..config()
    }))
    .await;
    let room = create_room(addr, "gshs").await;
    let mut socket = connect(addr, &room).await;
    next_where(&mut socket, "room", |_| true).await;
    socket
        .send(Message::Text(r#"{"type":"observe","name":"Never admitted"}"#.into()))
        .await
        .unwrap();
    let close = tokio::time::timeout(DEADLINE, async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Close(Some(frame)))) => break frame,
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
                other => panic!("expected transient close, got {other:?}"),
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(u16::from(close.code), 1013);
    assert_eq!(close.reason, "outbound_backpressure");
    assert_eq!(get(addr, &format!("/api/rooms/{room}")).await.status, 200);
    let mut fresh = connect(addr, &room).await;
    let public = next_where(&mut fresh, "room", |_| true).await;
    assert!(
        public["observers"].as_array().unwrap().is_empty(),
        "refused source was never parsed/applied"
    );
}

#[tokio::test]
async fn connection_cap_is_temporary_and_released_after_disconnect() {
    let addr = serve(AppState::new(Config {
        room_connections: 1,
        global_connections: 1,
        ingress_commands: 3,
        ..config()
    }))
    .await;
    let room = create_room(addr, "gshs").await;
    let mut first = connect(addr, &room).await;
    next_where(&mut first, "room", |_| true).await;
    let url = format!("ws://{addr}/api/rooms/{room}/ws");
    let Err(Error::Http(response)) = connect_async(&url).await else {
        panic!("second connection must be refused before upgrade")
    };
    assert_eq!(response.status().as_u16(), 429);
    assert_eq!(get(addr, &format!("/api/rooms/{room}")).await.status, 200);
    first.close(None).await.unwrap();
    tokio::time::timeout(DEADLINE, async {
        loop {
            match connect_async(&url).await {
                Ok((mut socket, _)) => {
                    next_where(&mut socket, "room", |_| true).await;
                    break;
                }
                Err(Error::Http(response)) if response.status().as_u16() == 429 => tokio::task::yield_now().await,
                other => panic!("unexpected reconnect result {other:?}"),
            }
        }
    })
    .await
    .expect("reserved disconnect releases native connection lease");
}
