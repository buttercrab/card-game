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
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let state = AppState::new(Duration::ZERO);
    let stats = state.stats();
    tokio::spawn(async move { axum::serve(listener, router(state, None)).await.unwrap() });
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
    let history = room["history"].as_array().expect("hands are remembered");
    assert_eq!(history.len(), 1);
    assert_eq!(
        history[0]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p.as_i64().unwrap())
            .sum::<i64>(),
        0
    );
    let hands = room["hands"].as_array().expect("hands are summarized");
    assert_eq!(hands.len(), 1);
    let rounds: Vec<i64> = serde_json::from_value(hands[0]["rounds"].clone()).unwrap();
    assert_eq!(rounds.len(), 10, "one entry per trick");
    let taken: i64 = rounds.iter().filter(|&&r| r > 0).sum();
    assert!(taken <= hands[0]["team_points"].as_i64().unwrap());
    assert!(rounds.iter().map(|r| r.abs()).sum::<i64>() <= 20);

    // The stats saw the table, its seats and both hands, but no names.
    let s = stats.summary(server::stats::now());
    assert_eq!(s.totals.tables, 1);
    assert_eq!((s.totals.hands_started, s.totals.hands_finished), (2, 1));
    assert_eq!(s.bots_by_level.get("hard"), Some(&4));
    assert_eq!(s.hands_by_humans.get(&1), Some(&1));
    assert_eq!(s.presets[0].preset, "gshs");
    assert_eq!(s.players.active_7, 1);
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

#[tokio::test]
async fn a_hand_left_unfinished_when_the_table_closes_counts_as_abandoned() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let state = AppState::new(Duration::from_millis(50)).with_limits(10, Duration::from_millis(200));
    let stats = state.stats();
    tokio::spawn(async move { axum::serve(listener, router(state, None)).await.unwrap() });

    let room = create_room(addr, "gshs").await;
    let mut ws = connect(addr, &room).await;
    join(&mut ws, "Jae", None).await;
    for bot in 1..5 {
        send(&mut ws, json!({ "type": "add_bot", "seat": bot })).await;
    }
    send(&mut ws, json!({ "type": "start" })).await;
    next(&mut ws, "state").await;
    // Everyone leaves mid-hand; the table closes once idle.
    drop(ws);
    tokio::time::sleep(Duration::from_millis(800)).await;
    let s = stats.summary(server::stats::now());
    assert_eq!(s.totals.hands_started, 1);
    assert_eq!(s.totals.hands_abandoned, 1);
    assert_eq!(s.totals.hands_finished, 0);
}

/// Five people at a `preset` table where every hand may be thrown in, the
/// first hand dealt; returns their sockets, by seat, and each one's state.
async fn misdeal_table(addr: SocketAddr, preset: &str) -> (Vec<Socket>, Vec<Value>) {
    let room = create_room(addr, preset).await;
    let (_, rules) = http(addr, "GET", &format!("/api/presets/{preset}"), "").await;
    let mut rules: Value = serde_json::from_str(&rules).unwrap();
    rules["misdeal"]["threshold"] = json!(100);
    let mut players = Vec::new();
    for name in ["A", "B", "C", "D", "E"] {
        let mut ws = connect(addr, &room).await;
        let (seat, _) = join(&mut ws, name, None).await;
        assert_eq!(seat as usize, players.len());
        players.push(ws);
    }
    let settings = json!({ "preset": preset, "rules": rules });
    send(&mut players[0], json!({ "type": "set_settings", "settings": settings })).await;
    next_where(&mut players[0], "room", |r| r["settings"]["rules"].is_object()).await;
    send(&mut players[0], json!({ "type": "start" })).await;
    let states = next_states(&mut players).await;
    (players, states)
}

/// The next state each seat is sent.
async fn next_states(players: &mut [Socket]) -> Vec<Value> {
    let mut out = Vec::new();
    for ws in players.iter_mut() {
        out.push(next(ws, "state").await);
    }
    out
}

fn to_act(state: &Value) -> usize {
    state["turn"]["Seat"].as_u64().expect("a seat is to act") as usize
}

#[tokio::test]
async fn anyone_may_call_a_misdeal_out_of_turn_while_their_window_is_open() {
    let addr = spawn_server().await;
    let (mut players, states) = misdeal_table(addr, "gshs").await;
    let turn = to_act(&states[0]);
    let other = (turn + 1) % 5;
    assert_eq!(states[other]["out_of_turn"], json!(["Misdeal"]));
    assert_eq!(states[turn]["out_of_turn"], json!([]));
    assert!(states[turn]["legal"].as_array().unwrap().contains(&json!("Misdeal")));
    assert_eq!(states[turn]["grace_ms"], 0, "경기과고 bids at once");

    // A seat that is not to act throws the deal in.
    send(&mut players[other], json!({ "type": "act", "action": "Misdeal" })).await;
    let states = next_states(&mut players).await;
    for state in &states {
        assert_eq!(state["view"]["redealt"]["why"]["Misdeal"]["seat"], other);
    }

    // Once a seat has bid, its window is closed.
    let turn = to_act(&states[0]);
    let bid = states[turn]["legal"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a.get("Bid").is_some())
        .unwrap()
        .clone();
    send(&mut players[turn], json!({ "type": "act", "action": bid })).await;
    let states = next_states(&mut players).await;
    assert_eq!(states[turn]["out_of_turn"], json!([]));
    send(&mut players[turn], json!({ "type": "act", "action": "Misdeal" })).await;
    assert_eq!(
        next(&mut players[turn], "error").await["message"],
        "it is not your turn"
    );
    // Nor may a seat take a turn action out of turn.
    let other = (to_act(&states[0]) + 1) % 5;
    send(&mut players[other], json!({ "type": "act", "action": "Pass" })).await;
    assert_eq!(
        next(&mut players[other], "error").await["message"],
        "it is not your turn"
    );
}

#[tokio::test]
async fn where_misdeals_come_first_the_first_bid_waits_after_the_deal() {
    let addr = spawn_server().await;
    let (mut players, states) = misdeal_table(addr, "default").await;
    let turn = to_act(&states[0]);
    let grace = states[turn]["grace_ms"].as_u64().unwrap();
    assert!(grace > 1000 && grace <= 2000, "{grace}");
    let bid = states[turn]["legal"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a.get("Bid").is_some())
        .unwrap()
        .clone();
    send(&mut players[turn], json!({ "type": "act", "action": bid })).await;
    assert_eq!(
        next(&mut players[turn], "error").await["message"],
        "wait a moment after the deal"
    );
    let other = (turn + 2) % 5;
    assert_eq!(states[other]["out_of_turn"], json!(["Misdeal"]));

    tokio::time::sleep(Duration::from_millis(grace + 50)).await;
    send(&mut players[turn], json!({ "type": "act", "action": bid })).await;
    let states = next_states(&mut players).await;
    assert_eq!(states[0]["view"]["bids"].as_array().unwrap().len(), 1);
    // The first bid closed every window.
    assert!(states.iter().all(|s| s["out_of_turn"] == json!([])));
    send(&mut players[other], json!({ "type": "act", "action": "Misdeal" })).await;
    assert_eq!(
        next(&mut players[other], "error").await["message"],
        "it is not your turn"
    );
}

/// A server whose turn-limit seconds last 10 ms, so a 20-second turn runs
/// out in a fifth of a second.
async fn spawn_quick_clock_server() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let state = AppState::new(Duration::ZERO).with_turn_second(Duration::from_millis(10));
    tokio::spawn(async move { axum::serve(listener, router(state, None)).await.unwrap() });
    addr
}

#[tokio::test]
async fn a_turn_that_runs_out_is_played_for_the_seat_and_marks_it_away() {
    let addr = spawn_quick_clock_server().await;
    let room = create_room(addr, "gshs").await;
    let mut ws = connect(addr, &room).await;
    join(&mut ws, "Jae", None).await;

    // Only a listed limit is taken.
    send(&mut ws, json!({ "type": "set_table", "turn_secs": 25 })).await;
    next(&mut ws, "error").await;
    send(&mut ws, json!({ "type": "set_table", "turn_secs": 20 })).await;
    let msg = next_where(&mut ws, "room", |r| r["table"]["turn_secs"] == 20).await;
    assert_eq!(msg["table"]["shuffle"], false);
    assert!(msg["clock"].is_null(), "no hand, no clock");

    for bot in 1..5 {
        send(&mut ws, json!({ "type": "add_bot", "seat": bot, "level": "easy" })).await;
    }
    send(&mut ws, json!({ "type": "start" })).await;
    // Jae never acts: the clock runs on the server and a stand-in moves.
    let clocked = next_where(&mut ws, "room", |r| r["clock"]["seat"] == 0).await;
    assert!(clocked["clock"]["ms"].as_u64().unwrap() <= clocked["clock"]["total_ms"].as_u64().unwrap());
    next_where(&mut ws, "room", |r| r["seats"][0]["away"] == true).await;
    // Away, the next turns get five seconds' worth: 50 ms here.
    let short = next_where(&mut ws, "room", |r| {
        r["clock"]["seat"] == 0 && r["seats"][0]["away"] == true
    })
    .await;
    assert_eq!(short["clock"]["total_ms"], 50);

    // Anything the player does clears the mark.
    send(&mut ws, json!({ "type": "react", "text": "미안" })).await;
    next_where(&mut ws, "room", |r| r["seats"][0]["away"] == false).await;

    // The hand finishes on its own, the stand-in playing every late turn.
    let done = next_where(&mut ws, "room", |r| r["hands_played"] == 1).await;
    assert_eq!(done["in_hand"], false);
    assert!(done["clock"].is_null());
}

#[tokio::test]
async fn a_dropped_player_counts_as_away_under_a_time_limit() {
    let addr = spawn_quick_clock_server().await;
    let room = create_room(addr, "gshs").await;
    let mut a = connect(addr, &room).await;
    join(&mut a, "A", None).await;
    let mut b = connect(addr, &room).await;
    join(&mut b, "B", None).await;
    b.close(None).await.unwrap();
    let r = next_where(&mut a, "room", |r| r["seats"][1]["connected"] == false).await;
    assert_eq!(r["seats"][1]["away"], false, "without a limit nobody is away");
    send(&mut a, json!({ "type": "set_table", "turn_secs": 60 })).await;
    next_where(&mut a, "room", |r| r["seats"][1]["away"] == true).await;
}

#[tokio::test]
async fn seats_shuffle_and_swap_between_hands_and_scores_follow_the_players() {
    let addr = spawn_quick_clock_server().await;
    let room = create_room(addr, "gshs").await;
    let mut a = connect(addr, &room).await;
    let (_, token_a) = join(&mut a, "A", None).await;
    let mut b = connect(addr, &room).await;
    let (_, token_b) = join(&mut b, "B", None).await;
    let mut watcher = connect(addr, &room).await;
    for bot in 2..5 {
        send(&mut a, json!({ "type": "add_bot", "seat": bot, "level": "easy" })).await;
    }
    // Spectators may not move anyone.
    send(&mut watcher, json!({ "type": "shuffle_seats" })).await;
    next(&mut watcher, "error").await;
    send(&mut watcher, json!({ "type": "set_table", "shuffle_next": true })).await;
    next(&mut watcher, "error").await;

    // A whole hand plays itself: both players let every turn run out.
    send(&mut a, json!({ "type": "set_table", "turn_secs": 20 })).await;
    send(&mut a, json!({ "type": "start" })).await;
    // Seats stay put while a hand is on.
    next_where(&mut b, "room", |r| r["in_hand"] == true).await;
    send(&mut b, json!({ "type": "swap_seats", "a": 0, "b": 1 })).await;
    assert_eq!(next(&mut b, "error").await["message"], "seats move only between hands");
    let before = next_where(&mut a, "room", |r| r["hands_played"] == 1).await;
    assert_eq!(before["showing"], true);
    let score = |r: &Value, name: &str| -> (usize, i64) {
        let seat = r["seats"]
            .as_array()
            .unwrap()
            .iter()
            .position(|s| s["name"] == name)
            .unwrap();
        (seat, r["scores"][seat].as_i64().unwrap())
    };
    let (a_was, a_score) = score(&before, "A");
    let (_, b_score) = score(&before, "B");
    let a_hist = before["history"][0][a_was].clone();
    let declarer = before["hands"][0]["declarer"].as_u64().unwrap() as usize;
    let declarer_was = before["seats"][declarer].clone();

    // 섞기 waits for the next hand; 다음 판 shuffles, then deals.
    send(&mut b, json!({ "type": "set_table", "shuffle_next": true })).await;
    next_where(&mut watcher, "room", |r| r["table"]["shuffle_next"] == true).await;
    send(&mut b, json!({ "type": "start" })).await;
    let news = next_where(&mut a, "seats_moved", |m| m["how"] == "shuffle").await;
    // B hears where everyone went before its own new seat, so its table can
    // slide each seat from where it was.
    let b_news = next(&mut b, "seats_moved").await;
    let b_welcome = next(&mut b, "welcome").await;
    let after = next_where(&mut watcher, "room", |r| r["hands_played"] == 1 && r["in_hand"] == true).await;
    assert_eq!(after["table"]["shuffle_next"], false, "a shuffle is used once");
    let (a_seat, a_after) = score(&after, "A");
    let (b_seat, b_after) = score(&after, "B");
    assert_eq!((a_after, b_after), (a_score, b_score), "scores follow the players");
    assert_eq!(after["history"][0][a_seat], a_hist, "so does each hand's payoff");
    let moved_declarer = after["hands"][0]["declarer"].as_u64().unwrap() as usize;
    assert_eq!(after["seats"][moved_declarer]["kind"], declarer_was["kind"]);
    // Bots keep their names too.
    assert_eq!(after["seats"][moved_declarer]["name"], declarer_was["name"]);
    assert_eq!(after["hands_played"], 1);
    assert_eq!(news["order"][a_was], a_seat, "the news says where each seat went");
    assert_eq!(b_news, news);

    // Each tab learns its new seat, and the token still finds it.
    assert_eq!(b_welcome["seat"].as_u64().unwrap() as usize, b_seat);
    // That hand plays itself out too before the seats move again.
    next_where(&mut watcher, "room", |r| r["hands_played"] == 2).await;
    drop(b);
    next_where(&mut watcher, "room", |r| r["seats"][b_seat]["connected"] == false).await;
    let mut again = connect(addr, &room).await;
    let (seat, token) = join(&mut again, "B", Some(&token_b)).await;
    assert_eq!((seat as usize, token), (b_seat, token_b.clone()));

    // A swap moves two seats.
    send(&mut again, json!({ "type": "swap_seats", "a": a_seat, "b": b_seat })).await;
    assert_eq!(
        next(&mut again, "welcome").await["seat"].as_u64().unwrap() as usize,
        a_seat
    );
    let swapped = next_where(&mut again, "room", |r| r["seats"][b_seat]["name"] == "A").await;
    assert_eq!(swapped["seats"][a_seat]["name"], "B");

    // B sends A back to watching; A's tab is told, and its token no longer
    // seats it anywhere.
    send(&mut again, json!({ "type": "clear_seat", "seat": b_seat })).await;
    next(&mut a, "unseated").await;
    let cleared = next_where(&mut watcher, "room", |r| r["seats"][b_seat]["kind"] == "empty").await;
    assert_eq!(cleared["watching"], 2, "A and the first watcher");
    send(
        &mut a,
        json!({ "type": "join", "name": "A", "token": token_a, "reclaim": true }),
    )
    .await;
    next(&mut a, "unseated").await;
    // A may sit again by choice.
    send(&mut a, json!({ "type": "join", "name": "A", "seat": b_seat })).await;
    assert_eq!(next(&mut a, "welcome").await["seat"].as_u64().unwrap() as usize, b_seat);
}

#[tokio::test]
async fn a_watcher_takes_a_bots_seat_between_hands() {
    let addr = spawn_server().await;
    let room = create_room(addr, "gshs").await;
    let mut a = connect(addr, &room).await;
    join(&mut a, "A", None).await;
    for bot in 1..5 {
        send(&mut a, json!({ "type": "add_bot", "seat": bot })).await;
    }
    next_where(&mut a, "room", |r| r["seats"][4]["kind"] == "bot").await;
    let mut watcher = connect(addr, &room).await;
    send(&mut watcher, json!({ "type": "join", "name": "W", "seat": 3 })).await;
    assert_eq!(next(&mut watcher, "welcome").await["seat"], 3);
}

#[tokio::test]
async fn shuffling_every_hand_reseats_before_the_deal() {
    let addr = spawn_server().await;
    let room = create_room(addr, "gshs").await;
    let mut a = connect(addr, &room).await;
    join(&mut a, "A", None).await;
    for bot in 1..5 {
        send(&mut a, json!({ "type": "add_bot", "seat": bot })).await;
    }
    send(&mut a, json!({ "type": "set_table", "shuffle": true })).await;
    next_where(&mut a, "room", |r| r["table"]["shuffle"] == true).await;
    send(&mut a, json!({ "type": "start" })).await;
    // Where the seats went comes first, then this tab's new seat.
    next(&mut a, "seats_moved").await;
    let welcome = next(&mut a, "welcome").await;
    let state = next(&mut a, "state").await;
    assert_eq!(
        state["view"]["viewer"]["Seat"], welcome["seat"],
        "dealt in the new seat"
    );
}

#[test]
fn rooms_saved_before_table_settings_still_restore() {
    use mighty::Mighty;
    use server::room::Room;
    use server::session::MightySettings;
    let room = Room::<Mighty>::new("abc".into(), MightySettings::default(), Duration::ZERO);
    let mut snapshot = room.snapshot();
    assert_eq!(
        snapshot["table"],
        json!({ "turn_secs": 0, "shuffle": false, "shuffle_next": false })
    );
    snapshot.as_object_mut().unwrap().remove("table");
    assert!(Room::<Mighty>::restore(snapshot.clone(), Duration::ZERO).is_ok());
    snapshot["table"] = json!({ "turn_secs": 40, "shuffle": true });
    let restored = Room::<Mighty>::restore(snapshot.clone(), Duration::ZERO).unwrap();
    assert_eq!(
        restored.snapshot()["table"],
        json!({ "turn_secs": 40, "shuffle": true, "shuffle_next": false })
    );
    // A shuffle pressed for the next hand survives a restart.
    snapshot["table"]["shuffle_next"] = json!(true);
    let restored = Room::<Mighty>::restore(snapshot, Duration::ZERO).unwrap();
    assert_eq!(restored.snapshot()["table"]["shuffle_next"], true);
}

#[test]
fn bots_saved_before_they_had_names_get_their_seats_names() {
    use mighty::Mighty;
    use server::room::Room;
    use server::session::MightySettings;
    let room = Room::<Mighty>::new("abc".into(), MightySettings::default(), Duration::ZERO);
    let mut snapshot = room.snapshot();
    snapshot["seats"] = json!([
        { "kind": "human", "name": "A", "token": "t" },
        { "kind": "bot", "level": "easy" },
        { "kind": "empty" },
        { "kind": "bot" },
        { "kind": "bot", "level": "normal", "name": "콩떡" },
    ]);
    let restored = Room::<Mighty>::restore(snapshot, Duration::ZERO).unwrap().snapshot();
    let seats = restored["seats"].as_array().unwrap();
    assert_eq!(seats[1], json!({ "kind": "bot", "level": "easy", "name": "모과" }));
    assert_eq!(seats[3], json!({ "kind": "bot", "level": "hard", "name": "보리" }));
    assert_eq!(seats[4]["name"], "콩떡", "a saved name stays");
    // Saved before seats could move: no rotation yet.
    assert_eq!(restored["rotation"], 0);
}

/// Each seat's name (a person's or a bot's), and a bot's level, by seat.
fn occupants(room: &Value) -> Vec<(String, String)> {
    room["seats"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            (
                s["name"].as_str().unwrap_or("").to_string(),
                s["level"].as_str().unwrap_or("").to_string(),
            )
        })
        .collect()
}

#[tokio::test]
async fn bots_keep_their_names_and_levels_when_seats_move() {
    let addr = spawn_server().await;
    let room = create_room(addr, "gshs").await;
    let mut a = connect(addr, &room).await;
    join(&mut a, "A", None).await;
    for (bot, level) in [(1, "easy"), (2, "normal"), (3, "hard"), (4, "easy")] {
        send(&mut a, json!({ "type": "add_bot", "seat": bot, "level": level })).await;
    }
    let before = next_where(&mut a, "room", |r| r["seats"][4]["kind"] == "bot").await;
    // Every bot has a name of its own: its seat's, while nobody has it.
    let names: Vec<String> = occupants(&before).into_iter().map(|(n, _)| n).collect();
    assert_eq!(names, ["A", "모과", "호두", "보리", "단추"]);
    // A new level keeps the name.
    send(&mut a, json!({ "type": "add_bot", "seat": 2, "level": "hard" })).await;
    let changed = next_where(&mut a, "room", |r| r["seats"][2]["level"] == "hard").await;
    assert_eq!(changed["seats"][2]["name"], "호두");

    // A swap moves a bot with its name and level.
    send(&mut a, json!({ "type": "swap_seats", "a": 1, "b": 3 })).await;
    let swapped = next_where(&mut a, "room", |r| r["seats"][1]["name"] == "보리").await;
    assert_eq!(swapped["seats"][1]["level"], "hard");
    assert_eq!(swapped["seats"][3]["name"], "모과");
    assert_eq!(swapped["seats"][3]["level"], "easy");
    // Two empty seats have nobody to swap.
    send(&mut a, json!({ "type": "remove_bot", "seat": 4 })).await;
    send(&mut a, json!({ "type": "remove_bot", "seat": 1 })).await;
    next_where(&mut a, "room", |r| r["seats"][1]["kind"] == "empty").await;
    send(&mut a, json!({ "type": "swap_seats", "a": 1, "b": 4 })).await;
    assert_eq!(next(&mut a, "error").await["message"], "nobody to move");
    // A bot sitting down never takes a name in use: seat 1's own (모과)
    // and 호두 are, so it is 보리, free again.
    send(&mut a, json!({ "type": "add_bot", "seat": 1, "level": "easy" })).await;
    send(&mut a, json!({ "type": "add_bot", "seat": 4, "level": "normal" })).await;
    let refilled = next_where(&mut a, "room", |r| r["seats"][4]["kind"] == "bot").await;
    assert_eq!(refilled["seats"][1]["name"], "보리");
    assert_eq!(refilled["seats"][4]["name"], "단추");

    // A shuffle moves everyone with their names and levels.
    let mut was = occupants(&refilled);
    send(&mut a, json!({ "type": "set_table", "shuffle_next": true })).await;
    send(&mut a, json!({ "type": "start" })).await;
    next(&mut a, "seats_moved").await;
    let shuffled = next_where(&mut a, "room", |r| r["in_hand"] == true).await;
    let mut now = occupants(&shuffled);
    assert_ne!(now, was, "someone moved");
    was.sort();
    now.sort();
    assert_eq!(now, was);
}

#[tokio::test]
async fn a_shuffle_waits_for_the_next_hand_and_everyone_sees_it_coming() {
    let addr = spawn_server().await;
    let room = create_room(addr, "gshs").await;
    let mut a = connect(addr, &room).await;
    join(&mut a, "A", None).await;
    for bot in 1..5 {
        send(&mut a, json!({ "type": "add_bot", "seat": bot, "level": "easy" })).await;
    }
    let mut watcher = connect(addr, &room).await;
    let full = next_where(&mut watcher, "room", |r| r["seats"][4]["kind"] == "bot").await;

    // 섞기 only marks the next hand; nobody moves yet.
    send(&mut a, json!({ "type": "set_table", "shuffle_next": true })).await;
    let marked = next_where(&mut watcher, "room", |r| r["table"]["shuffle_next"] == true).await;
    assert_eq!(marked["seats"], full["seats"]);
    // Pressed again, it is off.
    send(&mut a, json!({ "type": "set_table", "shuffle_next": false })).await;
    next_where(&mut watcher, "room", |r| r["table"]["shuffle_next"] == false).await;
    // An older page's 섞기 marks it too.
    send(&mut a, json!({ "type": "shuffle_seats" })).await;
    let marked = next_where(&mut watcher, "room", |r| r["table"]["shuffle_next"] == true).await;
    assert_eq!(marked["seats"], full["seats"]);

    // 시작 shuffles, tells everyone where the seats went, then deals.
    send(&mut a, json!({ "type": "start" })).await;
    let news = next(&mut watcher, "seats_moved").await;
    assert_eq!(news["how"], "shuffle");
    let moved = next(&mut a, "seats_moved").await;
    assert_eq!(moved, news);
    let welcome = next(&mut a, "welcome").await;
    let room_now = next(&mut a, "room").await;
    assert_eq!(room_now["in_hand"], true);
    assert_eq!(room_now["table"]["shuffle_next"], false, "used once");
    let seat = welcome["seat"].as_u64().unwrap() as usize;
    assert_eq!(news["order"][0], seat);
    assert_eq!(room_now["seats"][seat]["name"], "A");
    let state = next(&mut a, "state").await;
    assert_eq!(state["view"]["viewer"]["Seat"], seat, "dealt in the new seat");
    // Not while a hand is on.
    send(&mut a, json!({ "type": "set_table", "shuffle_next": true })).await;
    assert_eq!(next(&mut a, "error").await["message"], "seats move only between hands");
}

#[tokio::test]
async fn whoever_opens_the_next_hand_still_does_after_moving() {
    let addr = spawn_server().await;
    // 경기과고 opens each hand one seat further round.
    let room = create_room(addr, "gshs").await;
    let mut a = connect(addr, &room).await;
    let (seat, _) = join(&mut a, "A", None).await;
    assert_eq!(seat, 0, "A would open the first hand");
    for bot in 1..5 {
        send(&mut a, json!({ "type": "add_bot", "seat": bot, "level": "easy" })).await;
    }
    send(&mut a, json!({ "type": "swap_seats", "a": 0, "b": 2 })).await;
    assert_eq!(next(&mut a, "welcome").await["seat"], 2);
    send(&mut a, json!({ "type": "start" })).await;
    let state = next(&mut a, "state").await;
    assert_eq!(state["view"]["first_bidder"], 2, "A opens it from seat 2");
}
