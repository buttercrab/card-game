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

#[tokio::test]
async fn idle_rooms_close_and_the_room_count_is_capped() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let state = AppState::new(Duration::ZERO).with_limits(2, Duration::from_millis(200));
    tokio::spawn(async move { axum::serve(listener, router(state, None)).await.unwrap() });

    assert_eq!(http(addr, "GET", "/healthz", "").await.0, 200);
    let first = create_room(addr, "gshs").await;
    let mut ws = connect(addr, &first).await;
    create_room(addr, "gshs").await;
    // Two rooms open: a third is refused.
    let (status, _) = http(addr, "POST", "/api/rooms", &json!({ "preset": "gshs" }).to_string()).await;
    assert_eq!(status, 503);

    // The empty room closes; the one with a connection stays.
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert_eq!(http(addr, "GET", &format!("/api/rooms/{first}"), "").await.0, 200);
    create_room(addr, "gshs").await;

    // Once everyone leaves, it closes too.
    ws.close(None).await.unwrap();
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert_eq!(http(addr, "GET", &format!("/api/rooms/{first}"), "").await.0, 404);
}

#[tokio::test]
async fn a_saved_table_comes_back_mid_hand_after_a_restart() {
    let dir = std::env::temp_dir().join(format!("cards-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let serve = |dir: std::path::PathBuf| async move {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let state = AppState::new(Duration::ZERO).with_data(dir);
        let restored = state.restore_rooms().unwrap();
        tokio::spawn(async move { axum::serve(listener, router(state, None)).await.unwrap() });
        (addr, restored)
    };

    let (addr, restored) = serve(dir.clone()).await;
    assert_eq!(restored, 0);
    let room = create_room(addr, "gshs").await;
    // Five people rather than bots, so the test never waits on a bot thinking.
    let mut players = Vec::new();
    for name in ["A", "B", "C", "D", "E"] {
        let mut ws = connect(addr, &room).await;
        let (_, token) = join(&mut ws, name, None).await;
        players.push((ws, token));
    }
    send(&mut players[0].0, json!({ "type": "start" })).await;
    // Each move reaches everyone; whoever has legal actions makes the next one.
    let mut before = Value::Null;
    for step in 0..8 {
        let mut mover = None;
        for (i, (ws, _)) in players.iter_mut().enumerate() {
            let msg = next(ws, "state").await;
            if msg["legal"].as_array().is_some_and(|l| !l.is_empty()) {
                mover = Some((i, msg));
            }
        }
        let (i, msg) = mover.expect("someone is to act");
        if step == 7 {
            before = msg;
            break;
        }
        send(&mut players[i].0, json!({ "type": "act", "action": msg["legal"][0] })).await;
    }
    let seat = before["turn"]["Seat"].as_u64().unwrap() as usize;
    let token = players[seat].1.clone();
    tokio::time::sleep(Duration::from_millis(100)).await;

    // A second server reading the same directory picks the hand up where it was.
    let (addr, restored) = serve(dir.clone()).await;
    assert_eq!(restored, 1);
    let mut ws = connect(addr, &room).await;
    let (reclaimed, _) = join(&mut ws, "again", Some(&token)).await;
    assert_eq!(reclaimed as usize, seat, "the token still holds the seat");
    let after = next(&mut ws, "state").await;
    assert_eq!(after["view"], before["view"]);
    assert_eq!(after["legal"], before["legal"]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn seated_players_change_the_rules_between_hands() {
    let addr = spawn_server().await;
    let room = create_room(addr, "gshs").await;
    let (_, rules) = http(addr, "GET", "/api/presets/gshs", "").await;
    let mut rules: Value = serde_json::from_str(&rules).unwrap();
    let mut ws = connect(addr, &room).await;

    // Spectators may not.
    rules["bidding"]["min"] = json!(15);
    send(
        &mut ws,
        json!({ "type": "set_settings", "settings": { "preset": "gshs", "rules": rules } }),
    )
    .await;
    next(&mut ws, "error").await;

    join(&mut ws, "Jae", None).await;
    send(
        &mut ws,
        json!({ "type": "set_settings", "settings": { "preset": "gshs", "rules": rules } }),
    )
    .await;
    let msg = next_where(&mut ws, "room", |r| r["settings"]["rules"].is_object()).await;
    assert_eq!(msg["settings"]["rules"]["bidding"]["min"], 15);

    // Rules that cannot be played, or a different table size, are refused.
    rules["bidding"]["min"] = json!(30);
    send(
        &mut ws,
        json!({ "type": "set_settings", "settings": { "preset": "gshs", "rules": rules } }),
    )
    .await;
    next(&mut ws, "error").await;
    rules["bidding"]["min"] = json!(15);
    rules["players"] = json!(4);
    send(
        &mut ws,
        json!({ "type": "set_settings", "settings": { "preset": "gshs", "rules": rules } }),
    )
    .await;
    next(&mut ws, "error").await;

    // The hand is dealt under the new rules.
    for bot in 1..5 {
        send(&mut ws, json!({ "type": "add_bot", "seat": bot })).await;
    }
    send(&mut ws, json!({ "type": "start" })).await;
    let state = next(&mut ws, "state").await;
    assert_eq!(state["view"]["rules"]["bidding"]["min"], 15);
    send(
        &mut ws,
        json!({ "type": "set_settings", "settings": { "preset": "gshs" } }),
    )
    .await;
    next(&mut ws, "error").await;
}

#[tokio::test]
async fn reactions_reach_the_table_and_unknown_ones_are_refused() {
    let addr = spawn_server().await;
    let room = create_room(addr, "gshs").await;
    let mut a = connect(addr, &room).await;
    let (seat, _) = join(&mut a, "A", None).await;
    let mut watcher = connect(addr, &room).await;

    send(&mut a, json!({ "type": "react", "text": "나이스" })).await;
    let r = next(&mut watcher, "reaction").await;
    assert_eq!(r["seat"], seat);
    assert_eq!(r["text"], "나이스");

    send(&mut a, json!({ "type": "react", "text": "<script>" })).await;
    next(&mut a, "error").await;
    send(&mut watcher, json!({ "type": "react", "text": "👏" })).await;
    next(&mut watcher, "error").await;
}

#[tokio::test]
async fn a_report_saves_the_room_without_seat_tokens() {
    let dir = std::env::temp_dir().join(format!("cards-report-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let state = AppState::new(Duration::ZERO).with_data(dir.clone());
    tokio::spawn(async move { axum::serve(listener, router(state, None)).await.unwrap() });

    let room = create_room(addr, "gshs").await;
    let mut ws = connect(addr, &room).await;
    let (_, token) = join(&mut ws, "Jae", None).await;

    let (status, _) = http(addr, "POST", "/api/reports", &json!({ "text": "  " }).to_string()).await;
    assert_eq!(status, 400);
    let body = json!({ "text": "joker won wrongly", "room": room, "seat": 0, "client": { "ua": "test" } });
    let (status, _) = http(addr, "POST", "/api/reports", &body.to_string()).await;
    assert_eq!(status, 204);

    let files: Vec<_> = std::fs::read_dir(dir.join("reports")).unwrap().flatten().collect();
    assert_eq!(files.len(), 1);
    let text = std::fs::read_to_string(files[0].path()).unwrap();
    assert!(!text.contains(&token), "tokens stay private");
    let report: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(report["text"], "joker won wrongly");
    assert_eq!(report["room"]["seats"][0]["human"], "Jae");
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn a_hint_is_one_of_the_legal_actions() {
    let addr = spawn_server().await;
    let room = create_room(addr, "gshs").await;
    let mut ws = connect(addr, &room).await;
    join(&mut ws, "Jae", None).await;
    send(&mut ws, json!({ "type": "hint" })).await;
    next(&mut ws, "error").await;
    for bot in 1..5 {
        send(&mut ws, json!({ "type": "add_bot", "seat": bot })).await;
    }
    send(&mut ws, json!({ "type": "start" })).await;
    let state = next_where(&mut ws, "state", |m| {
        m["legal"].as_array().is_some_and(|l| !l.is_empty())
    })
    .await;
    send(&mut ws, json!({ "type": "hint" })).await;
    let hint = next(&mut ws, "hint").await;
    assert!(state["legal"].as_array().unwrap().contains(&hint["action"]));
}

#[tokio::test]
async fn bots_default_to_hard_and_their_level_can_change() {
    let addr = spawn_server().await;
    let room = create_room(addr, "gshs").await;
    let mut ws = connect(addr, &room).await;
    join(&mut ws, "Jae", None).await;
    send(&mut ws, json!({ "type": "add_bot", "seat": 1 })).await;
    next_where(&mut ws, "room", |r| r["seats"][1]["level"] == "hard").await;
    send(&mut ws, json!({ "type": "add_bot", "seat": 1, "level": "easy" })).await;
    next_where(&mut ws, "room", |r| r["seats"][1]["level"] == "easy").await;
    // Easy bots still finish a hand with legal moves.
    for bot in 2..5 {
        send(&mut ws, json!({ "type": "add_bot", "seat": bot, "level": "easy" })).await;
    }
    send(&mut ws, json!({ "type": "start" })).await;
    loop {
        let msg = next(&mut ws, "state").await;
        if msg["view"]["phase"].get("Done").is_some() {
            break;
        }
        if let Some(action) = msg["legal"].as_array().and_then(|l| l.first()) {
            send(&mut ws, json!({ "type": "act", "action": action })).await;
        }
    }
}

#[tokio::test]
async fn a_bot_worker_thinks_for_the_room() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let state = AppState::new(Duration::ZERO).with_bot_token("secret".into());
    let remote = state.remote_bots();
    tokio::spawn(async move { axum::serve(listener, router(state, None)).await.unwrap() });

    // Without the token, no worker gets in.
    let refused = connect_async(format!("ws://{addr}/internal/bots")).await;
    assert!(refused.is_err());

    tokio::spawn(server::bots::run_worker::<mighty::Mighty>(
        format!("ws://{addr}/internal/bots"),
        "secret".into(),
        Duration::from_millis(20),
    ));
    let wait = async {
        while !remote.connected() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    };
    tokio::time::timeout(Duration::from_secs(5), wait)
        .await
        .expect("worker connects");

    let room = create_room(addr, "gshs").await;
    let mut ws = connect(addr, &room).await;
    join(&mut ws, "Jae", None).await;
    for bot in 1..5 {
        send(&mut ws, json!({ "type": "add_bot", "seat": bot, "level": "normal" })).await;
    }
    send(&mut ws, json!({ "type": "start" })).await;
    loop {
        let msg = next(&mut ws, "state").await;
        if msg["view"]["phase"].get("Done").is_some() {
            break;
        }
        if let Some(action) = msg["legal"].as_array().and_then(|l| l.first()) {
            send(&mut ws, json!({ "type": "act", "action": action })).await;
        }
    }
    assert!(remote.answered() > 10, "the worker made the bots' moves");
}
