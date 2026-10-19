//! Poker goes through the same room actor, scoped transport and privacy boundary.
mod common;
use common::*;
use serde_json::{Value, json};
use server::{AppState, Config};
use std::{net::SocketAddr, time::Duration};

async fn create_poker(addr: SocketAddr) -> String {
    let (status, body) = http(addr, "POST", "/api/games/poker/rooms", r#"{"preset":"holdem"}"#).await;
    assert_eq!(status, 200, "{body}");
    serde_json::from_str::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .into()
}
struct Table {
    addr: SocketAddr,
    state: AppState,
    room: String,
    players: Vec<Socket>,
    tokens: Vec<String>,
    watcher: Socket,
    states: Vec<Value>,
}
async fn table(data: Option<std::path::PathBuf>) -> Table {
    let state = AppState::new(Config { data, ..config() });
    let addr = serve(state.clone()).await;
    let room = create_poker(addr).await;
    let mut players = Vec::new();
    let mut tokens = Vec::new();
    let mut room_version = 0;
    for seat in 0..3 {
        let mut ws = connect(addr, &room).await;
        let (actual, token) = join(&mut ws, &format!("Poker{seat}"), None).await;
        assert_eq!(actual, seat);
        send(&mut ws, json!({"type":"ready","ready":true})).await;
        let ready = next_where(&mut ws, "room", |r| r["ready"][seat as usize] == true).await;
        room_version = ready["room_version"].as_u64().unwrap();
        players.push(ws);
        tokens.push(token);
    }
    let mut watcher = connect(addr, &room).await;
    next(&mut watcher, "room").await;
    send(&mut watcher, json!({"type":"observe","name":"Watcher"})).await;
    next(&mut watcher, "visitor_welcome").await;
    let watching = next_where(&mut watcher, "room", |r| r["watching"].as_u64().unwrap_or(0) >= 1).await;
    assert_eq!(watching["game"], "poker");
    room_version = room_version.max(watching["room_version"].as_u64().unwrap());
    let window = next_where(&mut players[0], "room_command_window", |w| {
        w["command"]["scope"]["version"].as_u64() == Some(room_version)
    })
    .await;
    send(&mut players[0],json!({"type":"submit_room","operation_id":"1:poker-start","sequence":1,"expected":window["command"]["scope"],"action":{"type":"start"}})).await;
    let accepted = next(&mut players[0], "operation_receipt").await;
    assert_eq!(accepted["outcome"]["status"], "accepted", "{accepted}");
    assert_eq!(accepted["scope"]["domain"], "room");
    let mut states = Vec::new();
    for ws in &mut players {
        states.push(next(ws, "state").await);
    }
    Table {
        addr,
        state,
        room,
        players,
        tokens,
        watcher,
        states,
    }
}
fn assert_view_private(message: &Value, viewer: Option<usize>) {
    let view = &message["view"];
    assert!(view.get("deck").is_none());
    assert!(view.get("burns").is_none());
    assert_eq!(view["viewer"], json!(viewer));
    for (seat, player) in view["players"].as_array().unwrap().iter().enumerate() {
        assert_eq!(player["hole_count"], 2);
        if Some(seat) == viewer {
            assert_eq!(player["hole"].as_array().unwrap().len(), 2);
        } else {
            assert!(
                player["hole"].is_null(),
                "opponent cards leaked to {viewer:?}: {message}"
            );
        }
    }
}

#[tokio::test]
async fn poker_routes_are_registered_while_mighty_stays_default() {
    let addr = spawn_server().await;
    let games: Value = serde_json::from_str(&get(addr, "/api/games").await.body).unwrap();
    assert_eq!(games[0]["id"], "mighty");
    assert_eq!(games[1]["id"], "poker");
    assert_eq!(
        serde_json::from_str::<Value>(&get(addr, "/api/games/poker/presets").await.body).unwrap(),
        json!(["holdem"])
    );
    let rules = get(addr, "/api/games/poker/presets/holdem").await;
    assert_eq!(rules.status, 200);
    assert_eq!(
        serde_json::from_str::<Value>(&rules.body).unwrap(),
        json!({"players":3,"starting_stack":100})
    );
    assert_eq!(
        http(
            addr,
            "POST",
            "/api/games/poker/rooms",
            r#"{"rules":{"players":2,"starting_stack":100}}"#
        )
        .await
        .0,
        400
    );
    assert_eq!(
        http(
            addr,
            "POST",
            "/api/games/poker/rooms",
            r#"{"rules":{"players":3,"starting_stack":201}}"#
        )
        .await
        .0,
        400
    );
    assert_eq!(
        http(addr, "POST", "/api/games/poker/rooms", r#"{"preset":"gshs"}"#)
            .await
            .0,
        400
    );
    let room = create_poker(addr).await;
    let info = get(addr, &format!("/api/rooms/{room}")).await;
    assert_eq!(info.status, 200);
    assert_eq!(serde_json::from_str::<Value>(&info.body).unwrap()["game"], "poker");
    let mighty = create_room(addr, "gshs").await;
    let info = get(addr, &format!("/api/rooms/{mighty}")).await;
    assert_eq!(serde_json::from_str::<Value>(&info.body).unwrap()["game"], "mighty");
}

#[tokio::test]
async fn poker_uses_scoped_game_actions_exact_integer_offers_and_private_views() {
    let mut t = table(None).await;
    for (seat, state) in t.states.iter().enumerate() {
        assert_view_private(state, Some(seat));
        assert_eq!(state["room_version"], t.states[0]["room_version"]);
    }
    assert_view_private(&next(&mut t.watcher, "state").await, None);
    assert_eq!(t.states[0]["turn"], json!({"Seat":0}));
    let legal = t.states[0]["legal"].as_array().unwrap();
    let raises: Vec<u64> = legal
        .iter()
        .filter(|a| a["type"] == "raise_to")
        .map(|a| a["amount"].as_u64().unwrap())
        .collect();
    assert_eq!(raises, (4..=100).collect::<Vec<_>>());
    assert!(t.states[1]["legal"].as_array().unwrap().is_empty());
    let scope = t.states[0]["command"]["scope"].clone();
    assert_eq!(scope["domain"], "game");
    let submit =
        json!({"type":"submit","operation_id":"2:poker-fold","sequence":2,"expected":scope,"action":{"type":"fold"}});
    send(&mut t.players[0], submit.clone()).await;
    let receipt = next(&mut t.players[0], "operation_receipt").await;
    assert_eq!(receipt["outcome"]["status"], "accepted");
    let version = receipt["outcome"]["version"].as_u64().unwrap();
    let next_state = next_where(&mut t.players[1], "state", |s| s["version"] == version).await;
    assert_eq!(next_state["turn"], json!({"Seat":1}));
    send(&mut t.players[0], submit).await;
    assert_eq!(next(&mut t.players[0], "operation_receipt").await, receipt);
    send(
        &mut t.watcher,
        json!({"type":"query_operation","operation_id":"2:poker-fold","sequence":2}),
    )
    .await;
    assert_eq!(
        next(&mut t.watcher, "operation_receipt").await["outcome"],
        json!({"status":"unavailable","reason":"unknown"})
    );
    send(&mut t.players[1],json!({"type":"submit","operation_id":"1:poker-fold","sequence":1,"expected":next_state["command"]["scope"],"action":{"type":"fold"}})).await;
    assert_eq!(
        next(&mut t.players[1], "operation_receipt").await["outcome"]["status"],
        "accepted"
    );
    let session = next_where(&mut t.watcher, "session", |s| s["hands_played"] == 1).await;
    let done = next_where(&mut t.watcher, "state", |s| s["view"]["over"] == true).await;
    assert_view_private(&done, None);
    assert_eq!(done["view"]["showdown"], false);
    assert_eq!(done["view"]["payoffs"], json!([0, -1, 1]));
    assert!(done["command"].is_null());
    assert_eq!(session["scores"], json!([0, -1, 1]));
    assert!(session["records"][0]["view"].get("deck").is_none());
    assert!(
        session["records"][0]["view"]["players"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["hole"].is_null())
    );
}

#[tokio::test]
async fn poker_checkpoint_restores_its_game_and_private_receipt_without_replaying() {
    let dir = tempfile::tempdir().unwrap();
    let mut t = table(Some(dir.path().to_path_buf())).await;
    let expected = t.states[0]["command"]["scope"].clone();
    let submit = json!({"type":"submit","operation_id":"2:restore-poker","sequence":2,"expected":expected,"action":{"type":"fold"}});
    send(&mut t.players[0], submit.clone()).await;
    let receipt = next(&mut t.players[0], "operation_receipt").await;
    assert_eq!(receipt["durability"], "persisted");
    let version = receipt["outcome"]["version"].as_u64().unwrap();
    next_where(&mut t.players[1], "state", |s| s["version"] == version).await;
    let saved: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.path().join(format!("{}.json", t.room))).unwrap()).unwrap();
    assert_eq!(saved["game"], "poker");
    assert_eq!(t.state.shutdown(Duration::from_secs(5)).await, 1);
    drop(t.players);
    drop(t.watcher);
    let restored = AppState::new(Config {
        data: Some(dir.path().to_path_buf()),
        ..config()
    });
    assert_eq!(restored.restore_rooms().unwrap(), 1);
    let addr = serve(restored).await;
    let mut ws = connect(addr, &t.room).await;
    join(&mut ws, "Returning", Some(&t.tokens[0])).await;
    let current = next(&mut ws, "state").await;
    assert_view_private(&current, Some(0));
    assert_eq!(current["version"], version);
    assert_eq!(current["command"]["next_sequence"], 3);
    send(
        &mut ws,
        json!({"type":"query_operation","operation_id":"2:restore-poker","sequence":2}),
    )
    .await;
    assert_eq!(next(&mut ws, "operation_receipt").await, receipt);
    send(&mut ws, submit).await;
    assert_eq!(next(&mut ws, "operation_receipt").await, receipt);
}

#[tokio::test]
async fn settled_reclaim_keeps_original_holes_but_new_seat_occupant_gets_only_public_cards() {
    let mut t = table(None).await;
    // Two folds end this real hand without tabling anybody's private holes.
    send(&mut t.players[0], json!({"type":"act","action":{"type":"fold"}})).await;
    let next_turn = next_where(&mut t.players[1], "state", |s| s["turn"] == json!({"Seat":1})).await;
    assert!(next_turn["view"]["over"] == false);
    send(&mut t.players[1], json!({"type":"act","action":{"type":"fold"}})).await;
    let original = next_where(&mut t.players[0], "state", |s| s["view"]["over"] == true).await;
    assert_view_private(&original, Some(0));
    assert!(
        original["view"]["players"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["shown"] == false)
    );
    // Reclaim authenticates the same participant, rather than a new person at
    // an old seat. Its own mucked cards remain private to that participant.
    let mut returning = connect(t.addr, &t.room).await;
    let (seat, _) = join(&mut returning, "Returning", Some(&t.tokens[0])).await;
    assert_eq!(seat, 0);
    let reclaimed = next_where(&mut returning, "state", |s| {
        s["view"]["over"] == true && s["view"]["viewer"] == 0
    })
    .await;
    assert_eq!(
        reclaimed["view"]["players"][0]["hole"],
        original["view"]["players"][0]["hole"]
    );
    send(&mut returning, json!({"type":"leave"})).await;
    next(&mut returning, "unseated").await;
    next_where(&mut t.watcher, "room", |r| r["seats"][0]["kind"] == "empty").await;
    let (replacement_seat, _) = join(&mut t.watcher, "Replacement", None).await;
    assert_eq!(replacement_seat, 0);
    let replacement = next_where(&mut t.watcher, "state", |s| {
        s["view"]["over"] == true && s["view"]["viewer"].is_null()
    })
    .await;
    assert_view_private(&replacement, None);
    assert_eq!(replacement["legal"], json!([]));
    assert_eq!(replacement["out_of_turn"], json!([]));
    assert!(replacement["command"].is_null());
    assert_eq!(replacement["policy_actions"], json!({"legal":[],"out_of_turn":[]}));
}
