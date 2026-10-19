//! Correlated lobby operations exercise the real actor publication boundary.
use super::*;
use crate::command_protocol::{CommandDomain, CommandOutcome, CommandReceipt, CommandRejection};
use crate::protocol::RoomAction;
use crate::room::{RoomEnv, mighty_bots};
use mighty::{Mighty, table::MightySettings};
use serde_json::json;
use std::{sync::Arc, time::Duration};

async fn turn(room: &mut Room<Mighty>, conn: ConnId, msg: ClientMsg) {
    room.publication.begin();
    let effects = room.handle(Command::Message { conn, msg });
    let (_tx, mut rx) = crate::ingress::test_channel();
    assert!(room.settle(effects, &mut rx).await);
}
fn drain(rx: &mut crate::outbound::Receiver) -> Vec<Value> {
    std::iter::from_fn(|| rx.try_recv().ok())
        .map(|text| serde_json::from_str(&text).unwrap())
        .collect()
}
fn last_receipt(messages: &[Value]) -> CommandReceipt {
    serde_json::from_value(
        messages
            .iter()
            .rev()
            .find(|value| value["type"] == "operation_receipt")
            .expect("receipt")
            .clone(),
    )
    .unwrap()
}
async fn fixture() -> (Room<Mighty>, crate::outbound::Receiver) {
    let mut room = Room::new(
        "test".into(),
        MightySettings::default(),
        Arc::new(RoomEnv::new(Duration::ZERO)),
        mighty_bots(),
    );
    let (tx, mut rx) = crate::outbound::test_channel();
    room.publication.begin();
    let effects = room.handle(Command::Connect { conn: 1, tx });
    let (_tx, mut input) = crate::ingress::test_channel();
    assert!(room.settle(effects, &mut input).await);
    drain(&mut rx);
    turn(
        &mut room,
        1,
        ClientMsg::Observe {
            name: "Alice".into(),
            token: None,
        },
    )
    .await;
    drain(&mut rx);
    (room, rx)
}
async fn submit(
    room: &mut Room<Mighty>,
    rx: &mut crate::outbound::Receiver,
    sequence: u64,
    action: RoomAction,
) -> CommandReceipt {
    let expected = room.room_command_scope(1).unwrap();
    let before = expected.version;
    turn(
        room,
        1,
        ClientMsg::SubmitRoom {
            operation_id: format!("{sequence}:room"),
            sequence,
            expected,
            action,
        },
    )
    .await;
    let messages = drain(rx);
    let receipt = last_receipt(&messages);
    assert_eq!(receipt.outcome, CommandOutcome::Accepted { version: before + 1 });
    assert_eq!(room.commands.room_version, before + 1);
    for message in &messages {
        if message["type"] == "room" || message["type"] == "state" || message["type"] == "session" {
            assert_eq!(message["room_version"], before + 1);
        }
        if message["type"] == "room_command_window" {
            assert_eq!(message["command"]["scope"]["version"], before + 1);
        }
    }
    receipt
}

#[tokio::test]
async fn lobby_join_bots_ready_start_and_duplicate_are_correlated() {
    let (mut room, mut rx) = fixture().await;
    let scope = room.room_command_scope(1).unwrap();
    assert_eq!(scope.domain, CommandDomain::Room);
    assert_eq!(scope.seat, None);
    let join = RoomAction::Join {
        name: "Alice".into(),
        seat: Some(0),
        device: None,
    };
    let original = submit(&mut room, &mut rx, 1, join.clone()).await;
    assert_eq!(
        room.room_command_scope(1).unwrap().actor_id,
        scope.actor_id,
        "join retains authenticated observer actor"
    );
    let version = room.commands.room_version;
    turn(
        &mut room,
        1,
        ClientMsg::SubmitRoom {
            operation_id: "1:room".into(),
            sequence: 1,
            expected: scope,
            action: join,
        },
    )
    .await;
    assert_eq!(last_receipt(&drain(&mut rx)), original);
    assert_eq!(
        room.commands.room_version, version,
        "duplicate cannot manufacture a new context"
    );
    assert_eq!(room.seating.seat_of(1), Some(0));
    for seat in 1..5 {
        submit(
            &mut room,
            &mut rx,
            seat as u64 + 1,
            RoomAction::AddBot {
                seat,
                level: Default::default(),
            },
        )
        .await;
    }
    submit(&mut room, &mut rx, 6, RoomAction::Ready { ready: true }).await;
    let expected = room.room_command_scope(1).unwrap();
    let original = submit(&mut room, &mut rx, 7, RoomAction::Start).await;
    assert!(room.hand.in_hand());
    let hand = room.hand.number;
    let version = room.commands.room_version;
    turn(
        &mut room,
        1,
        ClientMsg::SubmitRoom {
            operation_id: "7:room".into(),
            sequence: 7,
            expected,
            action: RoomAction::Start,
        },
    )
    .await;
    assert_eq!(last_receipt(&drain(&mut rx)), original);
    assert_eq!(room.hand.number, hand);
    assert_eq!(room.commands.room_version, version);
    assert_eq!(room.command_window(0).unwrap().next_sequence, 8);
}

#[tokio::test]
async fn stale_room_scope_and_cross_domain_sequence_conflict_do_not_apply() {
    let (mut room, mut rx) = fixture().await;
    let stale = room.room_command_scope(1).unwrap();
    submit(
        &mut room,
        &mut rx,
        1,
        RoomAction::Join {
            name: "Alice".into(),
            seat: Some(0),
            device: None,
        },
    )
    .await;
    let before = room.commands.room_version;
    turn(
        &mut room,
        1,
        ClientMsg::SubmitRoom {
            operation_id: "2:stale".into(),
            sequence: 2,
            expected: stale.clone(),
            action: RoomAction::Leave,
        },
    )
    .await;
    assert!(matches!(
        last_receipt(&drain(&mut rx)).outcome,
        CommandOutcome::Rejected {
            reason: CommandRejection::StaleScope,
            ..
        }
    ));
    assert_eq!(room.seating.seat_of(1), Some(0));
    assert_eq!(
        room.commands.room_version,
        before + 1,
        "durable rejection consumes sequence and counter"
    );
    let mut game_domain = room.room_command_scope(1).unwrap();
    game_domain.domain = CommandDomain::Game;
    turn(
        &mut room,
        1,
        ClientMsg::SubmitRoom {
            operation_id: "3:domain".into(),
            sequence: 3,
            expected: game_domain.clone(),
            action: RoomAction::Leave,
        },
    )
    .await;
    assert!(matches!(
        last_receipt(&drain(&mut rx)).outcome,
        CommandOutcome::Rejected {
            reason: CommandRejection::StaleScope,
            ..
        }
    ));
    let before = room.commands.room_version;
    game_domain.domain = CommandDomain::Room;
    turn(
        &mut room,
        1,
        ClientMsg::Submit {
            operation_id: "3:domain".into(),
            sequence: 3,
            expected: game_domain,
            action: json!({"type":"leave"}),
        },
    )
    .await;
    assert!(matches!(
        last_receipt(&drain(&mut rx)).outcome,
        CommandOutcome::Rejected {
            reason: CommandRejection::SequenceConflict,
            ..
        }
    ));
    assert_eq!(room.commands.room_version, before);
    assert_eq!(room.seating.seat_of(1), Some(0));
}

#[tokio::test]
async fn room_cancel_and_restore_keep_optional_seat_and_separate_counters() {
    let (mut room, mut rx) = fixture().await;
    let expected = room.room_command_scope(1).unwrap();
    turn(
        &mut room,
        1,
        ClientMsg::CancelOperation {
            operation_id: "1:cancel".into(),
            sequence: 1,
            expected: expected.clone(),
        },
    )
    .await;
    let cancelled = last_receipt(&drain(&mut rx));
    assert!(matches!(
        cancelled.outcome,
        CommandOutcome::Rejected {
            reason: CommandRejection::Cancelled,
            ..
        }
    ));
    let version = room.commands.room_version;
    turn(
        &mut room,
        1,
        ClientMsg::SubmitRoom {
            operation_id: "1:cancel".into(),
            sequence: 1,
            expected,
            action: RoomAction::Join {
                name: "Alice".into(),
                seat: Some(0),
                device: None,
            },
        },
    )
    .await;
    assert_eq!(last_receipt(&drain(&mut rx)), cancelled);
    assert_eq!(room.seating.seat_of(1), None);
    assert_eq!(room.commands.room_version, version);
    let accepted = submit(
        &mut room,
        &mut rx,
        2,
        RoomAction::Join {
            name: "Alice".into(),
            seat: Some(0),
            device: None,
        },
    )
    .await;
    assert_eq!(accepted.scope.as_ref().unwrap().seat, None);
    assert_eq!(room.hand.version, 0);
    let saved = serde_json::to_value(room.snapshot()).unwrap();
    let restored = Room::<Mighty>::restore(saved.clone(), room.env.clone(), mighty_bots()).unwrap();
    assert_eq!(restored.commands.room_version, room.commands.room_version);
    assert_eq!(restored.hand.version, 0);
    let actor = &accepted.scope.unwrap().actor_id;
    let mut corrupt = saved;
    corrupt["commands"]["actors"][actor]["receipts"][1]["outcome"]["version"] = json!(room.commands.room_version + 1);
    assert!(Room::<Mighty>::restore(corrupt, room.env.clone(), mighty_bots()).is_err());
}

#[tokio::test]
async fn room_windows_are_private_and_present_without_a_hand() {
    let (mut room, mut alice) = fixture().await;
    let (tx, mut bob) = crate::outbound::test_channel();
    room.seating.conns.insert(2, Conn::new(tx));
    turn(
        &mut room,
        2,
        ClientMsg::Observe {
            name: "Bob".into(),
            token: None,
        },
    )
    .await;
    let alice_messages = drain(&mut alice);
    let bob_messages = drain(&mut bob);
    let alice_actor = room.room_command_scope(1).unwrap().actor_id;
    let bob_actor = room.room_command_scope(2).unwrap().actor_id;
    assert_ne!(alice_actor, bob_actor);
    for (messages, actor) in [(alice_messages, alice_actor), (bob_messages, bob_actor)] {
        assert!(!messages.iter().any(|message| message["type"] == "state"));
        assert!(messages.iter().any(|message| message["type"] == "room_command_window"));
        for message in messages {
            if message["type"] == "room_command_window" {
                assert_eq!(message["command"]["scope"]["actor_id"], actor);
                assert!(message["command"]["scope"]["seat"].is_null());
            }
            if message["type"] == "room" {
                assert!(message.get("command").is_none());
            }
        }
    }
}

#[tokio::test]
async fn queries_preserve_away_presence_and_room_counter_survives_session_reset() {
    let (mut room, mut rx) = fixture().await;
    submit(
        &mut room,
        &mut rx,
        1,
        RoomAction::Join {
            name: "Alice".into(),
            seat: Some(0),
            device: None,
        },
    )
    .await;
    room.seating.away[0] = true;
    let version = room.commands.room_version;
    turn(
        &mut room,
        1,
        ClientMsg::QueryOperation {
            operation_id: "1:room".into(),
            sequence: 1,
        },
    )
    .await;
    assert!(room.seating.away[0], "receipt reads must not change public away state");
    assert_eq!(room.commands.room_version, version);
    let messages = drain(&mut rx);
    assert_eq!(messages.len(), 1, "query publishes only its private receipt");
    let old_session = room.lifecycle.id;
    submit(&mut room, &mut rx, 2, RoomAction::ResetScores).await;
    assert!(room.lifecycle.id > old_session);
    assert_eq!(room.commands.room_version, version + 1);
    submit(&mut room, &mut rx, 3, RoomAction::Leave).await;
    assert_eq!(room.room_command_window(1).unwrap().next_sequence, 4);
    assert_eq!(room.room_command_scope(1).unwrap().seat, None);
    assert_eq!(room.commands.room_version, version + 2);
}

#[tokio::test]
async fn failed_game_construction_preserves_shuffle_scores_readiness_rng_and_seats() {
    use rand::Rng;
    let (mut room, mut rx) = fixture().await;
    submit(
        &mut room,
        &mut rx,
        1,
        RoomAction::Join {
            name: "Alice".into(),
            seat: Some(0),
            device: None,
        },
    )
    .await;
    for seat in 1..5 {
        submit(
            &mut room,
            &mut rx,
            seat as u64 + 1,
            RoomAction::AddBot {
                seat,
                level: Default::default(),
            },
        )
        .await;
    }
    room.table.shuffle_next = true;
    room.session.hands_played = 1;
    room.session.scores = vec![11, 12, 13, 14, 15];
    // Fault injection at the fallible Game constructor. Keep players nonzero so
    // next-hand options are valid to compute, while State::new refuses the rules.
    let mut rules = room.settings.rules();
    rules.hand_size = 0;
    room.settings.rules = Some(rules);
    let mut before = serde_json::to_value(room.snapshot()).unwrap();
    before.as_object_mut().unwrap().remove("commands");
    let rng_next = room.rng.clone().random::<u64>();
    let expected = room.room_command_scope(1).unwrap();
    turn(
        &mut room,
        1,
        ClientMsg::SubmitRoom {
            operation_id: "6:failure".into(),
            sequence: 6,
            expected,
            action: RoomAction::Start,
        },
    )
    .await;
    let messages = drain(&mut rx);
    assert!(matches!(
        last_receipt(&messages).outcome,
        CommandOutcome::Rejected {
            reason: CommandRejection::Rule,
            ..
        }
    ));
    assert!(
        !messages
            .iter()
            .any(|message| message["type"] == "seats_moved" || message["type"] == "welcome")
    );
    let mut after = serde_json::to_value(room.snapshot()).unwrap();
    after.as_object_mut().unwrap().remove("commands");
    assert_eq!(after, before, "a Rule rejection changes only the command ledger");
    assert_eq!(
        room.rng.clone().random::<u64>(),
        rng_next,
        "preparing a rejected shuffle must not consume room randomness"
    );
    assert!(
        room.lifecycle.ready.is_empty(),
        "solo auto-readiness rolls back on failure"
    );
}

#[tokio::test]
async fn rename_observer_normalizes_existing_identity_and_duplicate_never_reapplies() {
    use rand::Rng;
    let (mut room, mut rx) = fixture().await;
    let actor = room.room_command_scope(1).unwrap().actor_id;
    let token = room.seating.conns[&1].visitor.clone().unwrap();
    let (tx, mut peer) = crate::outbound::test_channel();
    room.seating.conns.insert(2, Conn::new(tx));
    turn(
        &mut room,
        2,
        ClientMsg::Observe {
            name: "Alice".into(),
            token: Some(token.clone()),
        },
    )
    .await;
    drain(&mut rx);
    drain(&mut peer);
    let expected = room.room_command_scope(1).unwrap();
    let raw = format!("  {}  ", "🃏".repeat(super::super::NAME_MAX + 5));
    let name = "🃏".repeat(super::super::NAME_MAX);
    let rng_next = room.rng.clone().random::<u64>();
    let receipt = submit(&mut room, &mut rx, 1, RoomAction::Rename { name: raw.clone() }).await;
    assert_eq!(
        room.rng.clone().random::<u64>(),
        rng_next,
        "rename never mints credentials or consumes randomness"
    );
    assert_eq!(room.room_command_scope(1).unwrap().actor_id, actor);
    assert_eq!(room.seating.conns[&1].visitor.as_deref(), Some(token.as_str()));
    let messages = drain(&mut peer);
    let welcome = messages
        .iter()
        .find(|message| message["type"] == "visitor_welcome")
        .unwrap();
    assert_eq!(welcome["id"], actor);
    assert_eq!(welcome["token"], token);
    assert_eq!(welcome["name"], name);
    assert!(welcome["seat"].is_null());
    assert_eq!(room.observers().len(), 1);
    assert_eq!(room.observers()[0].name, name);
    assert_eq!(
        serde_json::to_value(room.snapshot()).unwrap()["lifecycle"]["guests"]
            .as_object()
            .unwrap()
            .len(),
        1
    );
    submit(
        &mut room,
        &mut rx,
        2,
        RoomAction::Rename {
            name: "최신 이름".into(),
        },
    )
    .await;
    drain(&mut peer);
    let version = room.commands.room_version;
    turn(
        &mut room,
        1,
        ClientMsg::SubmitRoom {
            operation_id: "1:room".into(),
            sequence: 1,
            expected,
            action: RoomAction::Rename { name: raw },
        },
    )
    .await;
    assert_eq!(last_receipt(&drain(&mut rx)), receipt);
    assert_eq!(room.observers()[0].name, "최신 이름");
    assert_eq!(room.commands.room_version, version);
    assert!(
        drain(&mut peer).is_empty(),
        "duplicate must not repeat identity publication"
    );
}

#[tokio::test]
async fn rename_rejects_blank_stale_and_foreign_actor_without_identity_mutation() {
    let (mut room, mut rx) = fixture().await;
    let expected = room.room_command_scope(1).unwrap();
    let (tx, mut bob) = crate::outbound::test_channel();
    room.seating.conns.insert(2, Conn::new(tx));
    turn(
        &mut room,
        2,
        ClientMsg::Observe {
            name: "Bob".into(),
            token: None,
        },
    )
    .await;
    drain(&mut rx);
    drain(&mut bob);
    turn(
        &mut room,
        2,
        ClientMsg::SubmitRoom {
            operation_id: "1:foreign".into(),
            sequence: 1,
            expected: expected.clone(),
            action: RoomAction::Rename { name: "Stolen".into() },
        },
    )
    .await;
    assert!(matches!(
        last_receipt(&drain(&mut bob)).outcome,
        CommandOutcome::Rejected {
            reason: CommandRejection::ActorMismatch,
            ..
        }
    ));
    assert_eq!(room.room_command_window(2).unwrap().next_sequence, 1);
    turn(
        &mut room,
        1,
        ClientMsg::SubmitRoom {
            operation_id: "1:stale".into(),
            sequence: 1,
            expected,
            action: RoomAction::Rename { name: "Stale".into() },
        },
    )
    .await;
    assert!(matches!(
        last_receipt(&drain(&mut rx)).outcome,
        CommandOutcome::Rejected {
            reason: CommandRejection::StaleScope,
            ..
        }
    ));
    let expected = room.room_command_scope(1).unwrap();
    turn(
        &mut room,
        1,
        ClientMsg::SubmitRoom {
            operation_id: "2:blank".into(),
            sequence: 2,
            expected,
            action: RoomAction::Rename {
                name: " \t\n　".into()
            },
        },
    )
    .await;
    assert!(matches!(
        last_receipt(&drain(&mut rx)).outcome,
        CommandOutcome::Rejected {
            reason: CommandRejection::Rule,
            error: Some(ErrorCode::NameRequired)
        }
    ));
    assert_eq!(
        room.observers()
            .iter()
            .map(|person| person.name.as_str())
            .collect::<std::collections::BTreeSet<_>>(),
        ["Alice", "Bob"].into_iter().collect()
    );
    assert_eq!(room.room_command_window(1).unwrap().next_sequence, 3);
    assert!(serde_json::from_value::<ClientMsg>(json!({"type":"rename","name":"unscoped"})).is_err());
    assert_eq!(
        serde_json::to_value(RoomAction::Rename { name: "Alice".into() }).unwrap(),
        json!({"type":"rename","name":"Alice"})
    );
}

#[tokio::test]
async fn player_rename_preserves_seat_readiness_scores_and_frozen_hand_names() {
    let (mut room, mut rx) = fixture().await;
    submit(
        &mut room,
        &mut rx,
        1,
        RoomAction::Join {
            name: "Alice".into(),
            seat: Some(0),
            device: None,
        },
    )
    .await;
    submit(&mut room, &mut rx, 2, RoomAction::Ready { ready: true }).await;
    let actor = room.member(0).id;
    let mut standing = room.member(0);
    standing.score = 42;
    room.lifecycle.standings.insert(actor.clone(), standing);
    let seat_token = serde_json::to_value(room.snapshot()).unwrap()["seats"][0]["token"].clone();
    let session_revision = room.session.revision;
    let (tx, mut watcher) = crate::outbound::test_channel();
    room.seating.conns.insert(2, Conn::new(tx));
    turn(
        &mut room,
        2,
        ClientMsg::Observe {
            name: "Other observer".into(),
            token: None,
        },
    )
    .await;
    drain(&mut rx);
    drain(&mut watcher);
    submit(
        &mut room,
        &mut rx,
        3,
        RoomAction::Rename {
            name: "  새 이름  ".into(),
        },
    )
    .await;
    assert_eq!(room.member(0).id, actor);
    assert_eq!(room.member(0).name, "새 이름");
    assert!(room.lifecycle.ready.contains(&actor));
    assert_eq!(room.lifecycle.standings[&actor].score, 42);
    assert_eq!(room.lifecycle.standings[&actor].name, "새 이름");
    assert_eq!(room.session.revision, session_revision + 1);
    let public = drain(&mut watcher);
    let session = public.iter().find(|message| message["type"] == "session").unwrap();
    assert_eq!(session["standings"][0]["name"], "새 이름");
    let published = public.iter().find(|message| message["type"] == "room").unwrap();
    assert_eq!(published["seats"][0]["name"], "새 이름");
    assert_eq!(published["participant_ids"][0], actor);
    assert_eq!(session["room_version"], published["room_version"]);
    assert!(
        !public.iter().any(|message| message["type"] == "visitor_welcome"),
        "rename must not disclose credentials to a different observer"
    );
    assert_eq!(
        serde_json::to_value(room.snapshot()).unwrap()["seats"][0]["token"],
        seat_token
    );
    for seat in 1..5 {
        turn(
            &mut room,
            1,
            ClientMsg::AddBot {
                seat,
                level: Default::default(),
            },
        )
        .await;
    }
    drain(&mut rx);
    submit(&mut room, &mut rx, 4, RoomAction::Start).await;
    let game_version = room.hand.version;
    let hand_names: Vec<_> = room
        .lifecycle
        .hand_members
        .iter()
        .map(|member| member.name.clone())
        .collect();
    submit(
        &mut room,
        &mut rx,
        5,
        RoomAction::Rename {
            name: "진행 중 이름".into(),
        },
    )
    .await;
    assert_eq!(room.member(0).id, actor);
    assert_eq!(room.member(0).name, "진행 중 이름");
    assert_eq!(room.hand.version, game_version);
    assert_eq!(
        room.lifecycle
            .hand_members
            .iter()
            .map(|member| member.name.clone())
            .collect::<Vec<_>>(),
        hand_names
    );
}

#[tokio::test]
async fn rename_checkpoint_restores_same_credentials_and_original_receipt() {
    let (mut room, mut rx) = fixture().await;
    let token = room.seating.conns[&1].visitor.clone().unwrap();
    let expected = room.room_command_scope(1).unwrap();
    let accepted = submit(
        &mut room,
        &mut rx,
        1,
        RoomAction::Rename {
            name: "복원 이름".into(),
        },
    )
    .await;
    let saved = serde_json::to_value(room.snapshot()).unwrap();
    let mut restored = Room::<Mighty>::restore(saved, room.env.clone(), mighty_bots()).unwrap();
    let (tx, mut returning) = crate::outbound::test_channel();
    restored.seating.conns.insert(99, Conn::new(tx));
    turn(
        &mut restored,
        99,
        ClientMsg::Observe {
            name: "".into(),
            token: Some(token.clone()),
        },
    )
    .await;
    let messages = drain(&mut returning);
    let welcome = messages
        .iter()
        .find(|message| message["type"] == "visitor_welcome")
        .unwrap();
    assert_eq!(welcome["id"], expected.actor_id);
    assert_eq!(welcome["token"], token);
    assert_eq!(welcome["name"], "복원 이름");
    turn(
        &mut restored,
        99,
        ClientMsg::QueryOperation {
            operation_id: "1:room".into(),
            sequence: 1,
        },
    )
    .await;
    assert_eq!(last_receipt(&drain(&mut returning)), accepted);
    let version = restored.commands.room_version;
    turn(
        &mut restored,
        99,
        ClientMsg::SubmitRoom {
            operation_id: "1:room".into(),
            sequence: 1,
            expected,
            action: RoomAction::Rename {
                name: "복원 이름".into(),
            },
        },
    )
    .await;
    assert_eq!(last_receipt(&drain(&mut returning)), accepted);
    assert_eq!(restored.commands.room_version, version);
    assert_eq!(restored.observers()[0].name, "복원 이름");
}

#[tokio::test]
async fn legacy_seated_actor_can_rename_without_creating_visitor_credentials() {
    let (mut room, mut alice) = fixture().await;
    let (tx, mut legacy) = crate::outbound::test_channel();
    room.seating.conns.insert(2, Conn::new(tx));
    turn(
        &mut room,
        2,
        ClientMsg::Join {
            name: "Legacy".into(),
            token: None,
            seat: Some(0),
            device: None,
            reclaim: false,
        },
    )
    .await;
    drain(&mut legacy);
    drain(&mut alice);
    assert!(room.seating.conns[&2].visitor.is_none());
    let expected = room.room_command_scope(2).unwrap();
    let saved = serde_json::to_value(room.snapshot()).unwrap();
    let token = saved["seats"][0]["token"].clone();
    let guests = saved["lifecycle"]["guests"].clone();
    turn(
        &mut room,
        2,
        ClientMsg::SubmitRoom {
            operation_id: "1:legacy-rename".into(),
            sequence: 1,
            expected: expected.clone(),
            action: RoomAction::Rename {
                name: "Legacy renamed".into(),
            },
        },
    )
    .await;
    assert!(matches!(
        last_receipt(&drain(&mut legacy)).outcome,
        CommandOutcome::Accepted { .. }
    ));
    assert_eq!(room.member(0).id, expected.actor_id);
    assert_eq!(room.member(0).name, "Legacy renamed");
    assert_eq!(room.seating.seat_of(2), Some(0));
    assert!(room.seating.conns[&2].visitor.is_none());
    let after = serde_json::to_value(room.snapshot()).unwrap();
    assert_eq!(after["seats"][0]["token"], token);
    assert_eq!(after["lifecycle"]["guests"], guests);
    let public = drain(&mut alice);
    assert!(
        public
            .iter()
            .any(|message| message["type"] == "room" && message["seats"][0]["name"] == "Legacy renamed")
    );
}
