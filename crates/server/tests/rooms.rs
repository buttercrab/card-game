//! Drives a real server over HTTP and WebSockets.

mod common;

use common::*;
use serde_json::{Value, json};
use server::{AppState, Config};
use std::net::SocketAddr;
use std::time::Duration;
use tokio_tungstenite::connect_async;

#[tokio::test]
async fn one_player_and_four_bots_finish_a_hand() {
    let state = AppState::new(config());
    let stats = state.stats();
    let addr = serve(state).await;
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
            let done = &view["phase"]["Done"];
            let payoffs: Vec<i64> = serde_json::from_value(done["payoffs"].clone()).unwrap();
            assert_eq!(payoffs.iter().sum::<i64>(), 0);
            // The count the table shows comes with the hand.
            let value = done["value"]["value"].as_i64().unwrap();
            let declarer = done["declarer"].as_u64().unwrap() as usize;
            let friend = done["friend"].as_u64().map(|f| f as usize);
            let opponent = (0..5).find(|&s| s != declarer && Some(s) != friend).unwrap();
            assert_eq!(payoffs[opponent], -value);
            assert!(!done["value"]["steps"].as_array().unwrap().is_empty());
            break;
        }
        assert!(msg["notes"]["unplayable"].is_array() && msg["notes"]["contracts"].is_array());
        let hand = view["hand"].as_array().unwrap();
        assert!(hand.len() <= 14, "a seat never holds more than a hand plus the kitty");
        if let Some(action) = msg["legal"].as_array().and_then(|l| l.first()) {
            send(&mut ws, json!({ "type": "act", "action": action })).await;
        }
    }
    // Dealing the next hand changes the table but not the session, so only
    // the table is sent again.
    send(&mut ws, json!({ "type": "start" })).await;
    let next_msg = next_text(&mut ws).await.unwrap();
    assert_eq!(
        (&next_msg["type"], &next_msg["in_hand"]),
        (&json!("room"), &json!(true))
    );
    // Whoever comes to the table hears the session so far first.
    let mut watcher = connect(addr, &room).await;
    let session = next_text(&mut watcher).await.unwrap();
    assert_eq!(session["type"], "session");
    assert_eq!(session["hands_played"], 1);
    assert_eq!(next_text(&mut watcher).await.unwrap()["type"], "room");
    let history = session["history"].as_array().expect("hands are remembered");
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
    let hands = session["hands"].as_array().expect("hands are summarized");
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
    assert_eq!(error["code"], "not_seated");
}

#[tokio::test]
async fn cannot_start_with_empty_seats_or_act_out_of_turn() {
    let addr = spawn_server().await;
    let room = create_room(addr, "default").await;
    let mut ws = connect(addr, &room).await;
    join(&mut ws, "A", None).await;
    send(&mut ws, json!({ "type": "start" })).await;
    assert_eq!(next(&mut ws, "error").await["code"], "empty_seats");

    send(&mut ws, json!({ "type": "act", "action": "Pass" })).await;
    assert_eq!(next(&mut ws, "error").await["code"], "no_hand");
}

/// A table can start on rules of its own, which must hold together; the
/// room says what it plays by and that its players changed the preset.
#[tokio::test]
async fn a_table_starts_on_rules_of_its_own() {
    let addr = spawn_server().await;
    let (_, rules) = http(addr, "GET", "/api/presets/gshs", "").await;
    let mut rules: Value = serde_json::from_str(&rules).unwrap();
    rules["bidding"]["min"] = json!(15);
    let body = json!({ "preset": "gshs", "rules": rules }).to_string();
    let (status, body) = http(addr, "POST", "/api/rooms", &body).await;
    assert_eq!(status, 200, "{body}");
    let id = serde_json::from_str::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let mut ws = connect(addr, &id).await;
    join(&mut ws, "A", None).await;
    let room = next(&mut ws, "room").await;
    assert_eq!(room["rules"]["bidding"]["min"], 15);
    assert_eq!(room["settings"]["rules"]["bidding"]["min"], 15);
    assert_eq!(room["customized"], true);

    // The preset's own rules are no change at all.
    let id = create_room(addr, "gshs").await;
    let mut ws = connect(addr, &id).await;
    join(&mut ws, "A", None).await;
    let room = next(&mut ws, "room").await;
    assert_eq!(
        (&room["customized"], &room["rules"]["bidding"]["min"]),
        (&json!(false), &json!(14))
    );

    rules["bidding"]["min"] = json!(30);
    let body = json!({ "preset": "gshs", "rules": rules }).to_string();
    let (status, body) = http(addr, "POST", "/api/rooms", &body).await;
    assert_eq!(status, 400);
    let error: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        (&error["code"], &error["rule"]),
        (&json!("invalid_rules"), &json!("empty_bid_range"))
    );
    let (status, body) = http(addr, "POST", "/api/rooms", "{\"preset\": 3}").await;
    assert_eq!(status, 400);
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["code"], "bad_message");
}

/// The rulebook's examples come from the engine's own scoring, for any
/// rules a table could play.
#[tokio::test]
async fn the_rulebook_examples_are_scored_by_the_server() {
    let addr = spawn_server().await;
    let (_, rules) = http(addr, "GET", "/api/presets/default", "").await;
    let (status, body) = http(addr, "POST", "/api/rules/examples", &rules).await;
    assert_eq!(status, 200, "{body}");
    let examples: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(examples["contract"]["count"], 15);
    assert_eq!(examples["made"]["value"]["team_points"], 17);
    let made = examples["made"]["value"]["value"].as_i64().unwrap();
    assert!(made > 0);
    assert_eq!(examples["made"]["payoffs"][4], -made);
    assert!(examples["failed"]["value"]["value"].as_i64().unwrap() < 0);

    let mut rules: Value = serde_json::from_str(&rules).unwrap();
    rules["friend"] = json!({ "by_card": false, "by_seat": false, "first_trick": false, "last_trick": false, "fake": false, "alone": false });
    let (status, body) = http(addr, "POST", "/api/rules/examples", &rules.to_string()).await;
    assert_eq!(status, 400);
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["rule"], "no_friend_rule");
}

/// The room says which protocol it speaks, as the client's build records
/// it, so a page built for another one can offer to reload.
#[tokio::test]
async fn the_room_names_its_protocol() {
    let addr = spawn_server().await;
    let room = create_room(addr, "gshs").await;
    let mut ws = connect(addr, &room).await;
    join(&mut ws, "A", None).await;
    let msg = next(&mut ws, "room").await;
    assert_eq!(msg["protocol"], server::protocol::version());
    assert_eq!(server::catalog::catalog().protocol, server::protocol::version());
}

/// What belongs to a game is under `/api/games/{game}/`; the routes from
/// before games had ids still answer, for Mighty, the same.
#[tokio::test]
async fn game_scoped_routes_and_their_old_aliases_agree() {
    let addr = spawn_server().await;
    let (status, games) = http(addr, "GET", "/api/games", "").await;
    assert_eq!(status, 200);
    assert_eq!(
        serde_json::from_str::<Value>(&games).unwrap(),
        json!([{ "id": "mighty", "name": "마이티" }])
    );
    for (new, old) in [
        ("/api/games/mighty/presets", "/api/presets"),
        ("/api/games/mighty/presets/gshs", "/api/presets/gshs"),
    ] {
        let (new, old) = (http(addr, "GET", new, "").await, http(addr, "GET", old, "").await);
        assert_eq!((new.0, &new.1), (200, &old.1));
    }
    let (_, rules) = http(addr, "GET", "/api/presets/default", "").await;
    let new = http(addr, "POST", "/api/games/mighty/rules/examples", &rules).await;
    let old = http(addr, "POST", "/api/rules/examples", &rules).await;
    assert_eq!((new.0, &new.1), (200, &old.1));
    // A table made either way plays Mighty, and says so.
    let body = json!({ "preset": "gshs" }).to_string();
    for path in ["/api/games/mighty/rooms", "/api/rooms"] {
        let (status, body) = http(addr, "POST", path, &body).await;
        assert_eq!(status, 200, "{body}");
        let id = serde_json::from_str::<Value>(&body).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        let (status, info) = http(addr, "GET", &format!("/api/rooms/{id}"), "").await;
        assert_eq!(status, 200);
        assert_eq!(serde_json::from_str::<Value>(&info).unwrap()["game"], "mighty");
        let mut ws = connect(addr, &id).await;
        join(&mut ws, "A", None).await;
        assert_eq!(next(&mut ws, "room").await["game"], "mighty");
    }
    // An unknown game, or a preset it does not have.
    for path in ["/api/games/poker/presets", "/api/games/poker/presets/gshs"] {
        assert_eq!(http(addr, "GET", path, "").await.0, 404, "{path}");
    }
    assert_eq!(http(addr, "POST", "/api/games/poker/rooms", "{}").await.0, 404);
    let (status, body) = http(addr, "POST", "/api/games/mighty/rooms", "{\"preset\": \"nope\"}").await;
    assert_eq!(status, 400);
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["code"], "unknown_preset");
}

#[tokio::test]
async fn unknown_rooms_are_not_found() {
    let addr = spawn_server().await;
    assert_eq!(http(addr, "GET", "/api/rooms/nope", "").await.0, 404);
    let (status, body) = http(addr, "GET", "/api/presets/nope", "").await;
    assert_eq!(status, 404);
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["code"], "unknown_preset");
    assert!(connect_async(format!("ws://{addr}/api/rooms/nope/ws")).await.is_err());
}

#[tokio::test]
async fn idle_rooms_close_and_the_room_count_is_capped() {
    let state = AppState::new(Config {
        max_rooms: 2,
        idle_minutes: IDLE_200MS,
        ..config()
    });
    let open = state.clone();
    let addr = serve(state).await;

    assert_eq!(http(addr, "GET", "/healthz", "").await.0, 200);
    let first = create_room(addr, "gshs").await;
    let mut ws = connect(addr, &first).await;
    create_room(addr, "gshs").await;
    // Two rooms open: a third is refused.
    let (status, body) = http(addr, "POST", "/api/rooms", &json!({ "preset": "gshs" }).to_string()).await;
    assert_eq!(status, 503);
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!({ "code": "too_many_tables" })
    );

    // The empty room closes; the one with a connection stays.
    eventually("the empty room closes", || async { open.open_rooms() == 1 }).await;
    assert_eq!(http(addr, "GET", &format!("/api/rooms/{first}"), "").await.0, 200);
    create_room(addr, "gshs").await;

    // Once everyone leaves, it closes too.
    ws.close(None).await.unwrap();
    let path = format!("/api/rooms/{first}");
    eventually("the left room closes", || async {
        http(addr, "GET", &path, "").await.0 == 404
    })
    .await;
}

#[tokio::test]
async fn a_saved_table_comes_back_mid_hand_after_a_restart() {
    let dir = temp_dir();
    let start = |dir: std::path::PathBuf| async move {
        let state = AppState::new(Config {
            data: Some(dir),
            ..config()
        });
        let restored = state.restore_rooms().unwrap();
        (serve(state).await, restored)
    };

    let (addr, restored) = start(dir.path().to_path_buf()).await;
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
    let mut moves = Vec::new();
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
        moves.push(json!({ "kind": "act", "seat": i, "action": msg["legal"][0] }));
        send(&mut players[i].0, json!({ "type": "act", "action": msg["legal"][0] })).await;
    }
    let seat = before["turn"]["Seat"].as_u64().unwrap() as usize;
    let token = players[seat].1.clone();
    // The room hands itself to its writer after each move; once the file
    // holds every move made, it is up to date.
    let file = dir.path().join(format!("{room}.json"));
    eventually("every move is saved", || async {
        let saved: Value = std::fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        let log = saved["hand"]["log"].as_array().cloned().unwrap_or_default();
        log.into_iter().filter(|e| e["kind"] == "act").collect::<Vec<_>>() == moves
    })
    .await;

    // A second server reading the same directory picks the hand up where it was.
    let (addr, restored) = start(dir.path().to_path_buf()).await;
    assert_eq!(restored, 1);
    let mut ws = connect(addr, &room).await;
    let (reclaimed, _) = join(&mut ws, "again", Some(&token)).await;
    assert_eq!(reclaimed as usize, seat, "the token still holds the seat");
    let after = next(&mut ws, "state").await;
    assert_eq!(after["view"], before["view"]);
    assert_eq!(after["legal"], before["legal"]);
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
    assert_eq!(next(&mut ws, "error").await["code"], "not_seated");

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
    let error = next(&mut ws, "error").await;
    assert_eq!(
        (&error["code"], &error["rule"]),
        (&json!("invalid_rules"), &json!("empty_bid_range"))
    );
    rules["bidding"]["min"] = json!(15);
    rules["players"] = json!(4);
    send(
        &mut ws,
        json!({ "type": "set_settings", "settings": { "preset": "gshs", "rules": rules } }),
    )
    .await;
    assert_eq!(next(&mut ws, "error").await["code"], "player_count_fixed");
    // Not rules at all.
    send(
        &mut ws,
        json!({ "type": "set_settings", "settings": { "preset": "gshs", "rules": 7 } }),
    )
    .await;
    let error = next(&mut ws, "error").await;
    assert_eq!(error["code"], "bad_message");
    assert!(error["detail"].is_string());

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
    assert_eq!(next(&mut ws, "error").await["code"], "rules_between_hands");
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
    assert_eq!(next(&mut a, "error").await["code"], "unknown_reaction");
    send(&mut watcher, json!({ "type": "react", "text": "👏" })).await;
    assert_eq!(next(&mut watcher, "error").await["code"], "not_seated");
}

#[tokio::test]
async fn a_report_saves_the_room_without_seat_tokens() {
    let dir = temp_dir();
    let dir = dir.path();
    let state = AppState::new(Config {
        data: Some(dir.to_path_buf()),
        ..config()
    });
    let addr = serve(state).await;

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
    // The hand may move on while the hint is thought of (a bot throwing the
    // deal in, out of turn), or before it is asked for: the hint names the
    // state it was for, so a client can drop a late one.
    let mut states = std::collections::HashMap::new();
    states.insert(state["version"].as_u64().expect("states have versions"), state);
    send(&mut ws, json!({ "type": "hint" })).await;
    let hint = loop {
        let msg = next_text(&mut ws).await.expect("socket open");
        match msg["type"].as_str() {
            Some("state") => {
                let mine = msg["legal"].as_array().is_some_and(|l| !l.is_empty());
                states.insert(msg["version"].as_u64().unwrap(), msg);
                if mine {
                    // Asked again for this state.
                    send(&mut ws, json!({ "type": "hint" })).await;
                }
            }
            // Asked after the hand moved past this seat's turn: the next
            // state of ours asks again.
            Some("error") if msg["code"] == "not_your_turn" => {}
            // Asked once too often (deal after deal thrown in): wait for
            // the connection's hint allowance to refill, and ask again.
            Some("error") if msg["code"] == "hints_too_often" || msg["code"] == "hints_busy" => {
                tokio::time::sleep(Duration::from_millis(5100)).await;
                send(&mut ws, json!({ "type": "hint" })).await;
            }
            Some("error") => panic!("unexpected error {msg}"),
            Some("hint") => break msg,
            _ => {}
        }
    };
    let state = &states[&hint["version"].as_u64().unwrap()];
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
    let state = AppState::new(Config {
        bot_token: Some("secret".into()),
        ..config()
    });
    let remote = state.remote_bots();
    let addr = serve(state).await;

    // Without the token, no worker gets in.
    let refused = connect_async(format!("ws://{addr}/internal/bots")).await;
    assert!(refused.is_err());

    tokio::spawn(server::bots::run_worker(
        format!("ws://{addr}/internal/bots"),
        "secret".into(),
        Duration::from_millis(20),
        server::bots::Liveness::new(None),
    ));
    eventually("the worker connects", || async { remote.connected() }).await;

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
    let state = AppState::new(Config {
        bot_delay_ms: 50,
        idle_minutes: IDLE_200MS,
        ..config()
    });
    let stats = state.stats();
    let addr = serve(state).await;

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
    eventually("the table closes", || async {
        stats.summary(server::stats::now()).totals.hands_abandoned == 1
    })
    .await;
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
    // Every hand but one of all point cards: practically every hand.
    rules["misdeal"]["threshold"] = json!(19);
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
    assert_eq!(next(&mut players[turn], "error").await["code"], "not_your_turn");
    // Nor may a seat take a turn action out of turn.
    let other = (to_act(&states[0]) + 1) % 5;
    send(&mut players[other], json!({ "type": "act", "action": "Pass" })).await;
    assert_eq!(next(&mut players[other], "error").await["code"], "not_your_turn");
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

/// A room saved by this server comes back as it was; one missing part of
/// its shape is refused, and the server sets its file aside (older
/// formats are migrated: see `room::migrate_v1`).
#[test]
fn a_snapshot_restores_as_saved_and_a_broken_one_is_refused() {
    use mighty::Mighty;
    use mighty::table::MightySettings;
    use server::room::Room;
    let bots = || -> std::sync::Arc<dyn engine::TableBots<Mighty>> { std::sync::Arc::new(mighty_ai::MightyBots) };
    let env = std::sync::Arc::new(server::room::RoomEnv::new(Duration::ZERO));
    let room = Room::<Mighty>::new("abc".into(), MightySettings::default(), env.clone(), bots());
    let mut snapshot = serde_json::to_value(room.snapshot()).unwrap();
    snapshot["table"]["shuffle_next"] = json!(true);
    let restored = Room::<Mighty>::restore(snapshot.clone(), env.clone(), bots()).unwrap();
    assert_eq!(serde_json::to_value(restored.snapshot()).unwrap(), snapshot);
    snapshot.as_object_mut().unwrap().remove("table");
    assert!(Room::<Mighty>::restore(snapshot, env, bots()).is_err());
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
    assert_eq!(next(&mut a, "error").await["code"], "nobody_to_move");
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
    send(&mut a, json!({ "type": "set_table", "shuffle_next": true })).await;
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
    assert_eq!(next(&mut a, "error").await["code"], "seats_between_hands");
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
