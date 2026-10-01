//! Drives a real server over HTTP and WebSockets.

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use server::{AppState, router};
use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn spawn_server() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router(AppState::new(Duration::ZERO), None);
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    addr
}

async fn http(addr: SocketAddr, method: &str, path: &str, body: &str) -> (u16, String) {
    let mut stream = TcpStream::connect(addr).await.unwrap();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    let status = response[9..12].parse().unwrap();
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_string())
        .unwrap_or_default();
    (status, body)
}

async fn create_room(addr: SocketAddr, preset: &str) -> String {
    let (status, body) = http(addr, "POST", "/api/rooms", &json!({ "preset": preset }).to_string()).await;
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

/// Next message of the given type that satisfies `pred`, skipping others.
async fn next_where(ws: &mut Socket, kind: &str, pred: impl Fn(&Value) -> bool) -> Value {
    let wait = async {
        loop {
            let msg = ws.next().await.expect("socket closed").unwrap();
            let Message::Text(text) = msg else { continue };
            let value: Value = serde_json::from_str(&text).unwrap();
            if value["type"] == kind && pred(&value) {
                return value;
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(10), wait)
        .await
        .expect("timed out")
}

async fn next(ws: &mut Socket, kind: &str) -> Value {
    next_where(ws, kind, |_| true).await
}

async fn join(ws: &mut Socket, name: &str, token: Option<&str>) -> (u64, String) {
    send(ws, json!({ "type": "join", "name": name, "token": token })).await;
    let welcome = next(ws, "welcome").await;
    (
        welcome["seat"].as_u64().unwrap(),
        welcome["token"].as_str().unwrap().to_string(),
    )
}

#[tokio::test]
async fn one_player_and_four_bots_finish_a_hand() {
    let addr = spawn_server().await;
    let room = create_room(addr, "gshs").await;
    let mut ws = connect(addr, &room).await;
    let (seat, _) = join(&mut ws, "Jae", None).await;
    assert_eq!(seat, 0);
    for bot in 1..5 {
        send(&mut ws, json!({ "type": "add_bot", "seat": bot })).await;
    }
    send(&mut ws, json!({ "type": "start" })).await;

    loop {
        let msg = next_where(&mut ws, "state", |_| true).await;
        let view = &msg["view"];
        if view["phase"].get("Done").is_some() {
            let payoffs: Vec<i64> = serde_json::from_value(view["phase"]["Done"]["payoffs"].clone()).unwrap();
            assert_eq!(payoffs.iter().sum::<i64>(), 0);
            break;
        }
        let hand = view["hand"].as_array().unwrap();
        assert!(hand.len() <= 14, "a seat never holds more than a hand plus the kitty");
        if let Some(action) = msg["legal"].as_array().and_then(|l| l.first()) {
            send(&mut ws, json!({ "type": "act", "action": action })).await;
        }
    }
    // The room update for the finished hand went out just before the final state.
    send(&mut ws, json!({ "type": "start" })).await;
    let room = next_where(&mut ws, "room", |r| r["hands_played"] == 1).await;
    assert_eq!(room["in_hand"], true, "the next hand deals");
}

#[tokio::test]
async fn a_token_reclaims_the_seat_after_a_disconnect() {
    let addr = spawn_server().await;
    let room = create_room(addr, "default").await;
    let mut first = connect(addr, &room).await;
    join(&mut first, "A", None).await;
    let mut second = connect(addr, &room).await;
    let (seat, token) = join(&mut second, "B", None).await;
    assert_eq!(seat, 1);
    second.close(None).await.unwrap();

    next_where(&mut first, "room", |r| r["seats"][1]["connected"] == false).await;

    let mut again = connect(addr, &room).await;
    let (seat, same_token) = join(&mut again, "B", Some(&token)).await;
    assert_eq!((seat, same_token), (1, token));
}

#[tokio::test]
async fn spectators_see_no_cards_and_cannot_act() {
    let addr = spawn_server().await;
    let room = create_room(addr, "default").await;
    let mut player = connect(addr, &room).await;
    join(&mut player, "A", None).await;
    for bot in 1..5 {
        send(&mut player, json!({ "type": "add_bot", "seat": bot })).await;
    }
    let mut spectator = connect(addr, &room).await;
    send(&mut player, json!({ "type": "start" })).await;

    let state = next(&mut spectator, "state").await;
    assert_eq!(state["view"]["hand"], json!([]));
    assert_eq!(state["legal"], json!([]));

    send(&mut spectator, json!({ "type": "act", "action": "Pass" })).await;
    let error = next(&mut spectator, "error").await;
    assert_eq!(error["message"], "you are not seated");
}

#[tokio::test]
async fn cannot_start_with_empty_seats_or_act_out_of_turn() {
    let addr = spawn_server().await;
    let room = create_room(addr, "default").await;
    let mut ws = connect(addr, &room).await;
    join(&mut ws, "A", None).await;
    send(&mut ws, json!({ "type": "start" })).await;
    assert_eq!(
        next(&mut ws, "error").await["message"],
        "every seat needs a player or a bot"
    );

    send(&mut ws, json!({ "type": "act", "action": "Pass" })).await;
    assert_eq!(next(&mut ws, "error").await["message"], "no hand in progress");
}

#[tokio::test]
async fn unknown_rooms_are_not_found() {
    let addr = spawn_server().await;
    assert_eq!(http(addr, "GET", "/api/rooms/nope", "").await.0, 404);
    assert!(connect_async(format!("ws://{addr}/api/rooms/nope/ws")).await.is_err());
}
