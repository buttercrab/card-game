//! Delivery refusal must survive the real HTTP upgrade and WebSocket writer.
mod common;

use common::*;
use futures_util::{SinkExt, StreamExt};
use server::{AppState, Config};
use tokio_tungstenite::tungstenite::Message;

#[tokio::test]
async fn oversized_encoded_error_sends_the_permanent_delivery_close() {
    let addr = serve(AppState::new(Config {
        // The lobby and its recovery headroom fit. An oversized encoded
        // error still exercises the real socket writer's permanent refusal.
        outbound_message_bytes: 32 * 1024,
        outbound_connection_bytes: 128 * 1024,
        outbound_global_bytes: 256 * 1024,
        ..config()
    }))
    .await;
    let room = create_room(addr, "gshs").await;
    let mut socket = connect(addr, &room).await;
    next_where(&mut socket, "room", |_| true).await;
    socket
        .send(Message::Text(
            serde_json::json!({"type":"x".repeat(40*1024)}).to_string().into(),
        ))
        .await
        .unwrap();
    let frame = tokio::time::timeout(DEADLINE, async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Close(Some(frame)))) => return frame,
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
                other => panic!("expected explicit delivery close, got {other:?}"),
            }
        }
    })
    .await
    .expect("bounded writer must close promptly");
    assert_eq!(u16::from(frame.code), 1009);
    assert_eq!(frame.reason, "outbound_message_limit");
    // Refusing socket delivery must not remove the durable room.
    assert_eq!(get(addr, &format!("/api/rooms/{room}")).await.status, 200);
}
