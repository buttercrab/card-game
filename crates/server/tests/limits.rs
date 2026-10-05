//! The server's limits and restarts, over HTTP and WebSockets. Its own test
//! binary, since one test holds the server-wide hint places.

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use server::{AppState, router};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn serve(state: AppState) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router(state, None)).await.unwrap() });
    addr
}

async fn http(addr: SocketAddr, method: &str, path: &str, body: &str) -> (u16, String) {
    let mut stream = TcpStream::connect(addr).await.unwrap();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    // The server may answer before reading a body it refuses.
    let _ = stream.write_all(request.as_bytes()).await;
    let mut response = Vec::new();
    let _ = stream.read_to_end(&mut response).await;
    let response = String::from_utf8_lossy(&response);
    let status = response[9..12].parse().unwrap();
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_string())
        .unwrap_or_default();
    (status, body)
}

async fn create_room(addr: SocketAddr) -> String {
    let (status, body) = http(addr, "POST", "/api/rooms", &json!({ "preset": "gshs" }).to_string()).await;
    assert_eq!(status, 200, "{body}");
    serde_json::from_str::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn connect(addr: SocketAddr, room: &str) -> Socket {
    connect_async(format!("ws://{addr}/api/rooms/{room}/ws"))
        .await
        .unwrap()
        .0
}

async fn send(ws: &mut Socket, msg: Value) {
    ws.send(Message::Text(msg.to_string().into())).await.unwrap();
}

async fn next(ws: &mut Socket, kind: &str) -> Value {
    let wait = async {
        loop {
            let msg = ws.next().await.expect("socket closed").unwrap();
            let Message::Text(text) = msg else { continue };
            let value: Value = serde_json::from_str(&text).unwrap();
            if value["type"] == kind {
                return value;
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(10), wait)
        .await
        .expect("timed out")
}

async fn join(ws: &mut Socket, name: &str, token: Option<&str>) -> (u64, String) {
    send(ws, json!({ "type": "join", "name": name, "token": token })).await;
    let welcome = next(ws, "welcome").await;
    (
        welcome["seat"].as_u64().unwrap(),
        welcome["token"].as_str().unwrap().to_string(),
    )
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cards-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

#[tokio::test]
async fn a_full_server_refuses_a_table_with_a_code() {
    let addr = serve(AppState::new(Duration::ZERO).with_limits(1, Duration::from_secs(60))).await;
    create_room(addr).await;
    let (status, body) = http(addr, "POST", "/api/rooms", "{}").await;
    assert_eq!(status, 503);
    assert_eq!(body, r#"{"code":"too_many_tables"}"#);
}

#[tokio::test]
async fn oversized_bodies_are_refused() {
    let addr = serve(AppState::new(Duration::ZERO)).await;
    let big = json!({ "text": "x".repeat(100_000) }).to_string();
    assert_eq!(http(addr, "POST", "/api/reports", &big).await.0, 413);
    assert_eq!(http(addr, "POST", "/api/rooms", &big).await.0, 413);
}

#[tokio::test]
async fn an_oversized_websocket_message_closes_the_connection() {
    let addr = serve(AppState::new(Duration::ZERO)).await;
    let room = create_room(addr).await;
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
    let room = create_room(addr).await;
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
    let addr = serve(AppState::new(Duration::ZERO)).await;
    let (mut players, mover) = a_dealt_table(addr).await;
    let ws = &mut players[mover];

    // Every search place is taken: the hint is declined, politely.
    let held: Vec<_> = (0..server::limit::HINT_SEARCHES)
        .map(|_| server::limit::hint_permit().unwrap())
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
    let dir = temp_dir("shutdown");
    let state = AppState::new(Duration::ZERO).with_data(dir.clone());
    let addr = serve(state.clone()).await;
    let room = create_room(addr).await;
    let mut ws = connect(addr, &room).await;
    let (seat, token) = join(&mut ws, "A", None).await;
    next(&mut ws, "room").await;
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Even with its file gone, the room writes itself out on the way down.
    let file = dir.join(format!("{room}.json"));
    std::fs::remove_file(&file).unwrap();
    assert_eq!(state.shutdown(Duration::from_secs(5)).await, 1);
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(saved["id"], room.as_str());
    // The preset's rules are pinned, so a later preset change leaves the table alone.
    assert!(saved["settings"]["preset_rules"].is_object(), "{saved}");
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(file.exists(), "a shutdown keeps the file");

    let next_server = AppState::new(Duration::ZERO).with_data(dir.clone());
    assert_eq!(next_server.restore_rooms().unwrap(), 1);
    let addr = serve(next_server).await;
    let mut ws = connect(addr, &room).await;
    let (reclaimed, _) = join(&mut ws, "A", Some(&token)).await;
    assert_eq!(reclaimed, seat, "the token still holds the seat");
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn a_table_saved_before_rules_were_pinned_is_pinned_on_restore() {
    let dir = temp_dir("pin");
    std::fs::create_dir_all(&dir).unwrap();
    let old = json!({
        "format": 1, "id": "oldtbl", "game": "mighty",
        "settings": { "preset": "gshs" },
        "seats": [{ "kind": "empty" }, { "kind": "empty" }, { "kind": "empty" }, { "kind": "empty" }, { "kind": "empty" }],
        "scores": [0, 0, 0, 0, 0], "hands_played": 0, "hand": null,
    });
    std::fs::write(dir.join("oldtbl.json"), old.to_string()).unwrap();
    let state = AppState::new(Duration::ZERO).with_data(dir.clone());
    assert_eq!(state.restore_rooms().unwrap(), 1);
    let addr = serve(state).await;
    let mut ws = connect(addr, "oldtbl").await;
    join(&mut ws, "A", None).await;
    let room = next(&mut ws, "room").await;
    assert_eq!(room["settings"]["preset"], "gshs");
    assert!(room["settings"]["preset_rules"].is_object(), "{room}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn the_stats_show_the_bot_worker_link() {
    let state = AppState::new(Duration::ZERO)
        .with_stats_token("secret".into())
        .with_bot_token("bots".into());
    let remote = state.remote_bots();
    let addr = serve(state).await;
    let stats = |addr| async move {
        let mut stream = TcpStream::connect(addr).await.unwrap();
        stream
            .write_all(
                b"GET /api/stats HTTP/1.1\r\nHost: t\r\nAuthorization: Bearer secret\r\nConnection: close\r\n\r\n",
            )
            .await
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        let body = response.split_once("\r\n\r\n").unwrap().1.to_string();
        serde_json::from_str::<Value>(&body).unwrap()["server"].clone()
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
    ));
    tokio::time::timeout(Duration::from_secs(10), async {
        while !remote.connected() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the worker connects");
    let after = stats(addr).await;
    assert_eq!(after["worker"]["connected"], true);
    assert!(after["worker"]["since"].is_u64() && after["worker"]["last_seen"].is_u64());
    worker.abort();
}
