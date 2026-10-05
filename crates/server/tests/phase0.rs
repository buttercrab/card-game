//! The bot worker link, coming back to a seat, and leaving mid-hand, driven
//! over a real server.

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use server::{AppState, router};
use std::net::SocketAddr;
use std::time::{Duration, Instant};
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

async fn create_room(addr: SocketAddr) -> String {
    let (status, body) = http(addr, "POST", "/api/rooms", r#"{"preset":"gshs"}"#).await;
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

/// The next text message, as JSON; `None` once the socket closes.
async fn next_text(ws: &mut Socket) -> Option<Value> {
    let wait = async {
        while let Some(Ok(message)) = ws.next().await {
            if let Message::Text(text) = message {
                return Some(serde_json::from_str(&text).unwrap());
            }
        }
        None
    };
    tokio::time::timeout(Duration::from_secs(10), wait)
        .await
        .expect("timed out")
}

/// Next message of the given type that satisfies `pred`, skipping others.
async fn next_where(ws: &mut Socket, kind: &str, pred: impl Fn(&Value) -> bool) -> Value {
    loop {
        let value = next_text(ws).await.expect("socket closed");
        if value["type"] == kind && pred(&value) {
            return value;
        }
    }
}

async fn next(ws: &mut Socket, kind: &str) -> Value {
    next_where(ws, kind, |_| true).await
}

async fn join(ws: &mut Socket, name: &str) -> (u64, String) {
    send(ws, json!({ "type": "join", "name": name })).await;
    let welcome = next(ws, "welcome").await;
    (
        welcome["seat"].as_u64().unwrap(),
        welcome["token"].as_str().unwrap().to_string(),
    )
}

/// Plays seat 0's first legal move each time until the hand is over.
async fn play_out(ws: &mut Socket) {
    loop {
        let msg = next(ws, "state").await;
        if msg["view"]["phase"].get("Done").is_some() {
            return;
        }
        if let Some(action) = msg["legal"].as_array().and_then(|l| l.first()) {
            send(ws, json!({ "type": "act", "action": action })).await;
        }
    }
}

#[tokio::test]
async fn reclaiming_a_seat_clears_its_away_mark() {
    // Turn-limit seconds last 10 ms, so a 20-second turn runs out in 200 ms.
    let addr = serve(AppState::new(Duration::ZERO).with_turn_second(Duration::from_millis(10))).await;
    let room = create_room(addr).await;
    let mut ws = connect(addr, &room).await;
    let (seat, token) = join(&mut ws, "Jae").await;
    send(&mut ws, json!({ "type": "set_table", "turn_secs": 20 })).await;
    for bot in 1..5 {
        send(&mut ws, json!({ "type": "add_bot", "seat": bot, "level": "easy" })).await;
    }
    send(&mut ws, json!({ "type": "start" })).await;
    // Jae's turn runs out, so the seat is marked away while still connected.
    next_where(&mut ws, "room", |r| {
        r["seats"][0]["away"] == true && r["seats"][0]["connected"] == true
    })
    .await;
    drop(ws);

    let mut again = connect(addr, &room).await;
    send(
        &mut again,
        json!({ "type": "join", "name": "Jae", "token": token, "reclaim": true }),
    )
    .await;
    assert_eq!(next(&mut again, "welcome").await["seat"], seat);
    // The first room message after the welcome is the one the join made.
    let room = next(&mut again, "room").await;
    assert_eq!(room["seats"][0]["connected"], true);
    assert_eq!(room["seats"][0]["away"], false, "coming back clears 자리 비움: {room}");
}

#[tokio::test]
async fn leaving_mid_hand_is_counted() {
    let state = AppState::new(Duration::from_millis(50));
    let stats = state.stats();
    let addr = serve(state).await;
    let room = create_room(addr).await;
    let mut ws = connect(addr, &room).await;
    join(&mut ws, "Jae").await;
    // Leaving between hands is not leaving a hand.
    let mut other = connect(addr, &room).await;
    join(&mut other, "B").await;
    // Seat 1 is empty before B sits too, so wait for B first.
    next_where(&mut ws, "room", |r| r["seats"][1]["kind"] == "human").await;
    send(&mut other, json!({ "type": "leave" })).await;
    next_where(&mut ws, "room", |r| r["seats"][1]["kind"] == "empty").await;
    for bot in 1..5 {
        send(&mut ws, json!({ "type": "add_bot", "seat": bot })).await;
    }
    send(&mut ws, json!({ "type": "start" })).await;
    next(&mut ws, "state").await;
    send(&mut ws, json!({ "type": "leave" })).await;
    let mut watcher = connect(addr, &room).await;
    next_where(&mut watcher, "room", |r| r["seats"][0]["kind"] == "bot").await;
    let s = stats.summary(server::stats::now());
    assert_eq!(s.totals.left_mid_hand, 1);
}

/// A stand-in for the bot worker that speaks the link by hand.
async fn fake_worker(addr: SocketAddr) -> Socket {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let mut request = format!("ws://{addr}/internal/bots").into_client_request().unwrap();
    request
        .headers_mut()
        .insert("authorization", "Bearer secret".parse().unwrap());
    connect_async(request).await.unwrap().0
}

#[tokio::test]
async fn a_worker_that_cannot_make_a_move_does_not_hold_up_the_room() {
    let state = AppState::new(Duration::ZERO).with_bot_token("secret".into());
    let remote = state.remote_bots();
    let addr = serve(state).await;

    // A worker of the same protocol that can read no job (as when the game's
    // messages changed under it) says so for every one.
    let mut worker = fake_worker(addr).await;
    let hello = json!({ "type": "hello", "protocol": server::bots::PROTOCOL, "commit": "abc" });
    send(&mut worker, hello).await;
    let welcome = next_text(&mut worker).await.unwrap();
    assert_eq!(welcome["type"], "welcome");
    assert_eq!(welcome["protocol"], server::bots::PROTOCOL);
    assert!(remote.connected());
    assert_eq!(remote.status().commit.as_deref(), Some("abc"));
    tokio::spawn(async move {
        while let Some(job) = next_text(&mut worker).await {
            let reply = json!({ "id": job["id"], "error": "unreadable job" });
            if worker.send(Message::Text(reply.to_string().into())).await.is_err() {
                break;
            }
        }
    });

    let room = create_room(addr).await;
    let mut ws = connect(addr, &room).await;
    join(&mut ws, "Jae").await;
    for bot in 1..5 {
        send(&mut ws, json!({ "type": "add_bot", "seat": bot, "level": "normal" })).await;
    }
    let started = Instant::now();
    send(&mut ws, json!({ "type": "start" })).await;
    play_out(&mut ws).await;
    // Waiting out the two-second grace for each of some forty bot moves
    // would take over a minute.
    assert!(started.elapsed() < Duration::from_secs(8), "{:?}", started.elapsed());
    let status = remote.status();
    assert!(status.failed > 10, "{status:?}");
    assert_eq!(status.answered, 0);
}

#[tokio::test]
async fn a_worker_of_another_protocol_is_turned_away() {
    let state = AppState::new(Duration::ZERO).with_bot_token("secret".into());
    let remote = state.remote_bots();
    let addr = serve(state).await;

    let mut worker = fake_worker(addr).await;
    send(
        &mut worker,
        json!({ "type": "hello", "protocol": 999, "commit": "future" }),
    )
    .await;
    let refused = next_text(&mut worker).await.unwrap();
    assert_eq!(refused["type"], "refused");
    assert_eq!(refused["protocol"], server::bots::PROTOCOL);
    assert!(next_text(&mut worker).await.is_none(), "the server hangs up");
    assert!(!remote.connected());
    let refusal = remote.status().refused.expect("the refusal shows on /stats");
    assert_eq!((refusal.protocol, refusal.commit.as_deref()), (999, Some("future")));

    // A worker from before the hello opens with something else.
    let mut old = fake_worker(addr).await;
    send(&mut old, json!({ "id": 1, "action": "Pass" })).await;
    assert_eq!(next_text(&mut old).await.unwrap()["type"], "refused");
    assert_eq!(remote.status().refused.unwrap().protocol, 1);
    assert!(!remote.connected());
}

#[tokio::test]
async fn the_version_names_the_build_and_the_worker() {
    let state = AppState::new(Duration::ZERO).with_bot_token("secret".into());
    let addr = serve(state).await;
    let (status, body) = http(addr, "GET", "/version", "").await;
    assert_eq!(status, 200);
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["commit"], server::bots::commit());
    assert_eq!(v["protocol"], server::bots::PROTOCOL);
    assert_eq!(v["worker"]["connected"], false);

    let mut worker = fake_worker(addr).await;
    send(
        &mut worker,
        json!({ "type": "hello", "protocol": server::bots::PROTOCOL, "commit": "abc" }),
    )
    .await;
    next_text(&mut worker).await.unwrap();
    let (_, body) = http(addr, "GET", "/version", "").await;
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["worker"], json!({ "connected": true, "commit": "abc" }));
}

#[tokio::test]
async fn the_worker_says_hello_and_answers_every_job() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(server::bots::run_worker::<mighty::Mighty>(
        format!("ws://{addr}/internal/bots"),
        "secret".into(),
        Duration::from_millis(10),
    ));
    let (stream, _) = tokio::time::timeout(Duration::from_secs(10), listener.accept())
        .await
        .unwrap()
        .unwrap();
    let mut ws = tokio_tungstenite::accept_async(MaybeTlsStream::Plain(stream))
        .await
        .unwrap();
    let hello = next_text(&mut ws).await.unwrap();
    assert_eq!(hello["type"], "hello");
    assert_eq!(hello["protocol"], server::bots::PROTOCOL);
    assert_eq!(hello["commit"], server::bots::commit());
    send(
        &mut ws,
        json!({ "type": "welcome", "protocol": server::bots::PROTOCOL, "commit": "x" }),
    )
    .await;

    // Jobs it cannot read still get an answer, with the reason.
    for job in [
        json!({ "id": 7, "something": "new" }),
        json!({ "id": 8, "level": "normal", "seat": 0, "seed": 1, "view": { "new": true }, "legal": [] }),
    ] {
        send(&mut ws, job.clone()).await;
        let reply = next_text(&mut ws).await.unwrap();
        assert_eq!(reply["id"], job["id"]);
        assert!(reply["error"].is_string(), "{reply}");
        assert!(reply.get("action").is_none());
    }
}
