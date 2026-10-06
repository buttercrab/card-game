//! The server's limits and restarts, over HTTP and WebSockets.

mod common;

use common::*;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use server::{AppState, Config};
use std::net::SocketAddr;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

#[tokio::test]
async fn a_full_server_refuses_a_table_with_a_code() {
    let addr = serve(AppState::new(Config {
        max_rooms: 1,
        ..config()
    }))
    .await;
    create_room(addr, "gshs").await;
    let (status, body) = http(addr, "POST", "/api/rooms", "{}").await;
    assert_eq!(status, 503);
    assert_eq!(body, r#"{"code":"too_many_tables"}"#);
}

#[tokio::test]
async fn oversized_bodies_are_refused() {
    let addr = serve(AppState::new(config())).await;
    let big = json!({ "text": "x".repeat(100_000) }).to_string();
    assert_eq!(http(addr, "POST", "/api/reports", &big).await.0, 413);
    assert_eq!(http(addr, "POST", "/api/rooms", &big).await.0, 413);
}

#[tokio::test]
async fn an_oversized_websocket_message_closes_the_connection() {
    let addr = serve(AppState::new(config())).await;
    let room = create_room(addr, "gshs").await;
    let mut ws = connect(addr, &room).await;
    let name = "x".repeat(server::limit::WS_MAX_MESSAGE + 1);
    // The send itself may fail once the server hangs up.
    let _ = ws
        .send(Message::Text(
            json!({ "type": "join", "name": name }).to_string().into(),
        ))
        .await;
    let closed = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match ws.next().await {
                Some(Ok(Message::Close(_)) | Err(_)) | None => return,
                Some(Ok(_)) => {}
            }
        }
    })
    .await;
    assert!(closed.is_ok(), "the server closed the socket");
}

/// Five people at a table with a hand dealt; returns them and who is to act.
async fn a_dealt_table(addr: SocketAddr) -> (Vec<Socket>, usize) {
    let room = create_room(addr, "gshs").await;
    let mut players = Vec::new();
    for name in ["A", "B", "C", "D", "E"] {
        let mut ws = connect(addr, &room).await;
        join(&mut ws, name, None).await;
        players.push(ws);
    }
    send(&mut players[0], json!({ "type": "start" })).await;
    let mut mover = None;
    for (i, ws) in players.iter_mut().enumerate() {
        let state = next(ws, "state").await;
        if state["legal"].as_array().is_some_and(|l| !l.is_empty()) {
            mover = Some(i);
        }
    }
    (players, mover.expect("someone is to act"))
}

#[tokio::test]
async fn hints_wait_for_a_free_search_and_are_rate_limited() {
    let state = AppState::new(config());
    let pool = state.hint_pool();
    let addr = serve(state).await;
    let (mut players, mover) = a_dealt_table(addr).await;
    let ws = &mut players[mover];

    // Every search place is taken: the hint is declined, politely.
    let held: Vec<_> = (0..server::limit::HINT_SEARCHES)
        .map(|_| pool.try_permit().unwrap())
        .collect();
    send(ws, json!({ "type": "hint" })).await;
    assert_eq!(next(ws, "error").await["code"], "hints_busy");
    drop(held);
    send(ws, json!({ "type": "hint" })).await;
    next(ws, "hint").await;

    // A connection asking again and again is told to slow down.
    for _ in 0..4 {
        send(ws, json!({ "type": "hint" })).await;
    }
    assert_eq!(next(ws, "error").await["code"], "hints_too_often");
}

#[tokio::test]
async fn a_stopping_server_saves_its_tables_and_the_next_restores_them() {
    let dir = temp_dir();
    let dir = dir.path();
    let state = AppState::new(Config {
        data: Some(dir.to_path_buf()),
        ..config()
    });
    let addr = serve(state.clone()).await;
    let room = create_room(addr, "gshs").await;
    let mut ws = connect(addr, &room).await;
    let (seat, token) = join(&mut ws, "A", None).await;
    next(&mut ws, "room").await;
    let file = dir.join(format!("{room}.json"));
    eventually("the room is saved", || async { file.exists() }).await;

    // Even with its file gone, the room writes itself out on the way down.
    std::fs::remove_file(&file).unwrap();
    assert_eq!(state.shutdown(Duration::from_secs(5)).await, 1);
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(saved["id"], room.as_str());
    // The preset's rules are pinned, so a later preset change leaves the table alone.
    assert!(saved["settings"]["preset_rules"].is_object(), "{saved}");
    // The room has ended by now (`shutdown` waited for it), and kept its file.
    assert!(file.exists(), "a shutdown keeps the file");

    let next_server = AppState::new(Config {
        data: Some(dir.to_path_buf()),
        ..config()
    });
    assert_eq!(next_server.restore_rooms().unwrap(), 1);
    let addr = serve(next_server).await;
    let mut ws = connect(addr, &room).await;
    let (reclaimed, _) = join(&mut ws, "A", Some(&token)).await;
    assert_eq!(reclaimed, seat, "the token still holds the seat");
}

#[tokio::test]
async fn the_stats_show_the_bot_worker_link() {
    let state = AppState::new(Config {
        stats_token: Some("secret".into()),
        bot_token: Some("bots".into()),
        ..config()
    });
    let remote = state.remote_bots();
    let addr = serve(state).await;
    let stats = |addr| async move {
        let reply = request(addr, "GET", "/api/stats", &["Authorization: Bearer secret"], "").await;
        serde_json::from_str::<Value>(&reply.body).unwrap()["server"].clone()
    };
    let before = stats(addr).await;
    assert_eq!(before["worker"]["expected"], true);
    assert_eq!(before["worker"]["connected"], false);

    // Without a worker, a table's bots think here, and that is counted.
    assert!(!remote.available());
    assert_eq!(stats(addr).await["worker"]["fallbacks"], 1);

    let worker = tokio::spawn(server::bots::run_worker::<mighty::Mighty>(
        format!("ws://{addr}/internal/bots"),
        "bots".into(),
        Duration::from_millis(10),
        server::bots::Liveness::new(None),
    ));
    eventually("the worker connects", || async { remote.connected() }).await;
    let after = stats(addr).await;
    assert_eq!(after["worker"]["connected"], true);
    assert!(after["worker"]["since"].is_u64() && after["worker"]["last_seen"].is_u64());
    worker.abort();
}
