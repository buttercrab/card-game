//! A room turn publishes its effects only after its checkpoint succeeds.
//! The actor is the sole state owner; this buffer adds no second state copy.
use super::{ConnId, Room};
use crate::game::ServerGame;
use crate::stats::Event;
use std::sync::{Arc, Mutex};

pub(super) enum Effect {
    Abort {
        conn: ConnId,
        cause: crate::outbound::AbortCause,
    },
    Message {
        conn: ConnId,
        frame: crate::outbound::PreparedFrame,
    },
    /// Render only after the candidate has committed its final public version.
    PublicSessionCheckpoint {
        conn: ConnId,
    },
    Stat(Event),
}

#[derive(Default)]
pub(super) struct Publication(Arc<Mutex<Option<Vec<Effect>>>>);

impl Publication {
    pub fn begin(&self) {
        let mut pending = self.0.lock().expect("publication lock");
        assert!(pending.is_none(), "one unpublished room turn at a time");
        *pending = Some(Vec::new());
    }

    pub fn push(&self, effect: Effect) -> Option<Effect> {
        let mut pending = self.0.lock().expect("publication lock");
        if let Some(pending) = pending.as_mut() {
            if let Effect::Abort { conn, cause } = &effect {
                fn strength(cause: crate::outbound::AbortCause) -> u8 {
                    match cause {
                        crate::outbound::AbortCause::Closed => 0,
                        crate::outbound::AbortCause::Backpressure => 1,
                        crate::outbound::AbortCause::MessageTooLarge => 2,
                    }
                }
                if let Some(Effect::Abort { cause: existing, .. }) = pending
                    .iter_mut()
                    .find(|queued| matches!(queued,Effect::Abort {conn:queued,..} if queued==conn))
                {
                    if strength(*cause) > strength(*existing) {
                        *existing = *cause;
                    }
                    return None;
                }
            }
            if let Effect::PublicSessionCheckpoint { conn } = &effect
                && pending.iter().any(
                    |existing| matches!(existing, Effect::PublicSessionCheckpoint { conn: queued } if queued == conn),
                )
            {
                return None;
            }
            pending.push(effect);
            None
        } else {
            Some(effect)
        }
    }

    /// A disconnected audience cannot receive a held private publication.
    /// Release its staged source permits immediately, even if disk recovery
    /// keeps the rest of this candidate pending indefinitely.
    pub fn discard_connection(&self, disconnected: ConnId) {
        if let Some(pending) = self.0.lock().expect("publication lock").as_mut() {
            pending.retain(|effect| match effect {
                Effect::Abort { conn, .. }
                | Effect::Message { conn, .. }
                | Effect::PublicSessionCheckpoint { conn } => *conn != disconnected,
                Effect::Stat(_) => true,
            });
        }
    }

    fn take(&self) -> Vec<Effect> {
        self.0
            .lock()
            .expect("publication lock")
            .take()
            .expect("a publication is open")
    }
}

impl<G: ServerGame> Room<G> {
    pub(super) fn publish_effect(&self, effect: Effect) {
        match effect {
            Effect::Abort { conn, cause } => {
                if let Some(connection) = self.seating.conns.get(&conn) {
                    connection.tx.abort(cause);
                }
            }
            Effect::Message { conn, frame } => {
                if let Some(connection) = self.seating.conns.get(&conn) {
                    let _ = connection.tx.deliver(frame);
                }
            }
            Effect::PublicSessionCheckpoint { conn } => {
                self.send_session(conn);
            }
            Effect::Stat(event) => self.env.stats.record(event),
        }
    }

    pub(super) fn publish_pending(&self) {
        for effect in self.publication.take() {
            self.publish_effect(effect);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Command, RoomEnv, actor::Effects, mighty_bots, seating::Conn, snapshot::Persister};
    use super::*;
    use crate::protocol::ClientMsg;
    use engine::{Game, Turn};
    use mighty::{Mighty, table::MightySettings};
    use serde_json::{Value, json};
    use std::{sync::Arc, time::Duration};
    use tokio::sync::oneshot;

    async fn next(rx: &mut crate::outbound::Receiver, kind: &str) -> Value {
        tokio::time::timeout(Duration::from_secs(5), async {
            let message: Value = serde_json::from_str(&rx.recv().await.expect("connection open")).unwrap();
            assert_eq!(message["type"], kind, "unexpected message before {kind}: {message}");
            message
        })
        .await
        .expect("room answered")
    }

    async fn fixture(path: &std::path::Path) -> (Room<Mighty>, Vec<crate::outbound::Receiver>) {
        let mut env = RoomEnv::new(Duration::ZERO);
        env.data = Some(path.parent().unwrap().to_path_buf());
        let mut room = Room::new("test".into(), MightySettings::default(), Arc::new(env), mighty_bots());
        let mut receivers = Vec::new();
        for seat in 0..5 {
            let conn = seat as u64 + 1;
            let (tx, rx) = crate::outbound::test_channel();
            room.seating.conns.insert(conn, Conn::new(tx));
            let join: ClientMsg =
                serde_json::from_value(json!({"type":"join", "name":format!("P{seat}"), "seat":seat})).unwrap();
            room.on_message(conn, join).unwrap();
            room.on_message(conn, ClientMsg::Ready { ready: true }).unwrap();
            receivers.push(rx);
        }
        room.on_message(1, ClientMsg::Start).unwrap();
        room.hand.advance(&room.id, &mut room.rng);
        room.hand.dealt_at = None;
        room.table.turn_secs = 20;
        room.persister = Some(Persister::start(room.id.clone(), path.to_path_buf()));
        room.publication.begin();
        let (_tx, mut rx) = crate::ingress::test_channel();
        assert!(room.settle(Effects::default(), &mut rx).await);
        for rx in &mut receivers {
            while rx.try_recv().is_ok() {}
        }
        (room, receivers)
    }

    #[tokio::test]
    async fn held_checkpoint_refusal_storm_coalesces_aborts_and_does_not_accumulate_stats() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.json");
        let (mut room, _peers) = fixture(&path).await;
        let pool = crate::outbound::Pool::new(crate::outbound::Policy {
            message_bytes: 512,
            connection_bytes: 2048,
            global_bytes: 4096,
            frames: 256,
        })
        .unwrap();
        let (sender, mut receiver) = pool.channel();
        let target = sender.clone();
        room.seating.conns.insert(10, Conn::new(sender));
        std::fs::create_dir(path.with_extension("tmp")).unwrap();
        room.publication.begin();
        room.record(Event::TableCreated {
            table: "test".into(),
            preset: "default".into(),
        });
        room.publication.push(Effect::Abort {
            conn: 10,
            cause: crate::outbound::AbortCause::Backpressure,
        });
        let refused = crate::protocol::ServerMsg::Reaction {
            seat: 0,
            text: "x".repeat(1000),
        };
        for _ in 0..10_000 {
            room.send(10, &refused);
            room.greet(10);
        }
        let inspect = room.publication.0.clone();
        {
            let pending = inspect.lock().unwrap();
            let pending = pending.as_ref().unwrap();
            assert_eq!(pending.len(), 3); // stat +one abort +one public checkpoint
            assert!(matches!(
                pending[1],
                Effect::Abort {
                    cause: crate::outbound::AbortCause::MessageTooLarge,
                    ..
                }
            ));
        }
        let (commands, mut input) = crate::ingress::test_channel();
        let task = tokio::spawn(async move {
            assert!(
                room.settle(
                    Effects {
                        changed: true,
                        saved: true
                    },
                    &mut input
                )
                .await
            );
            room
        });
        assert_eq!(next(&mut receiver, "error").await["code"], "storage_unavailable");
        for _ in 0..100 {
            commands
                .send(Command::Message {
                    conn: 10,
                    msg: ClientMsg::Hint,
                })
                .unwrap();
            assert_eq!(next(&mut receiver, "error").await["code"], "storage_unavailable");
        }
        assert_eq!(inspect.lock().unwrap().as_ref().unwrap().len(), 3);
        assert_eq!(target.abort_cause(), None, "candidate abort stays behind commit fence");
        commands.send(Command::Disconnect { conn: 10 }).unwrap();
        let (reply, done) = oneshot::channel();
        commands.send(Command::Describe { reply }).unwrap();
        assert!(done.await.is_err());
        {
            let pending = inspect.lock().unwrap();
            let pending = pending.as_ref().unwrap();
            assert_eq!(pending.len(), 1);
            assert!(matches!(pending[0], Effect::Stat(_)));
        }
        std::fs::remove_dir(path.with_extension("tmp")).unwrap();
        tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(pool.available_bytes(), 4096);
    }

    #[tokio::test]
    async fn disconnect_releases_staged_source_while_checkpoint_is_still_held() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.json");
        let (mut room, _peers) = fixture(&path).await;
        let original = std::fs::read(&path).unwrap();
        let pool = crate::outbound::Pool::new(crate::outbound::Policy::default()).unwrap();
        let total = pool.available_bytes();
        let (sender, mut receiver) = pool.channel();
        room.seating.conns.insert(10, Conn::new(sender));
        std::fs::create_dir(path.with_extension("tmp")).unwrap();
        room.publication.begin();
        room.send(
            10,
            &crate::protocol::ServerMsg::Reaction {
                seat: 0,
                text: "굿".into(),
            },
        );
        assert!(
            pool.available_bytes() < total,
            "candidate bytes are charged before commit"
        );
        assert!(receiver.try_recv().is_err());
        let (commands, mut input) = crate::ingress::test_channel();
        let task = tokio::spawn(async move {
            assert!(
                room.settle(
                    Effects {
                        changed: true,
                        saved: true
                    },
                    &mut input
                )
                .await
            );
            room
        });
        assert_eq!(next(&mut receiver, "error").await["code"], "storage_unavailable");
        assert!(
            pool.available_bytes() < total,
            "unpublished frame remains charged during failure"
        );
        commands.send(Command::Disconnect { conn: 10 }).unwrap();
        let (reply, done) = oneshot::channel();
        commands.send(Command::Describe { reply }).unwrap();
        assert!(done.await.is_err(), "storage hold processed the preceding disconnect");
        assert_eq!(
            pool.available_bytes(),
            total,
            "disconnect releases staged source before disk recovers"
        );
        assert_eq!(std::fs::read(&path).unwrap(), original);
        std::fs::remove_dir(path.with_extension("tmp")).unwrap();
        let room = tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .unwrap()
            .unwrap();
        assert!(!room.seating.conns.contains_key(&10));
        assert_eq!(pool.available_bytes(), total);
    }

    #[tokio::test]
    async fn numeric_entry_refusal_is_visible_only_after_its_exact_checkpoint_commits() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.json");
        let (mut room, mut receivers) = fixture(&path).await;
        let before = std::fs::read(&path).unwrap();
        let status = room.entry_status();
        assert!(status.lock().unwrap().is_none());
        let profile = crate::resource_budget::ResourceProfile::table::<Mighty>(&room.settings).unwrap();
        let finish = Room::<Mighty>::normal_revision_steps(&room.hand, profile).unwrap();
        room.commands.room_version =
            crate::command_protocol::MAX_COMMAND_SEQUENCE - finish as u64 - room.seating.conns.len() as u64 - 3;
        std::fs::create_dir(path.with_extension("tmp")).unwrap();
        let task = tokio::spawn(async move {
            room.publication.begin();
            let (_tx, mut input) = crate::ingress::test_channel();
            assert!(
                room.settle(
                    Effects {
                        changed: true,
                        saved: true
                    },
                    &mut input
                )
                .await
            );
            room
        });
        assert_eq!(next(&mut receivers[0], "error").await["code"], "storage_unavailable");
        assert!(
            status.lock().unwrap().is_none(),
            "speculative capacity is not published during disk hold"
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_dir(path.with_extension("tmp")).unwrap();
        let room = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            *status.lock().unwrap(),
            Some(crate::protocol::NativeCapacityReason::Capacity {
                resource: crate::resource_budget::Resource::RoomVersion,
                ..
            })
        ));
        let saved: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(saved["commands"]["room_version"], room.commands.room_version);
    }

    #[tokio::test]
    async fn oversized_candidate_disconnect_waits_for_successful_checkpoint() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.json");
        let (mut room, mut receivers) = fixture(&path).await;
        let target = room.seating.conns[&1].tx.clone();
        let peer = room.seating.conns[&2].tx.clone();
        std::fs::create_dir(path.with_extension("tmp")).unwrap();
        let task = tokio::spawn(async move {
            room.publication.begin();
            room.send(
                1,
                &crate::protocol::ServerMsg::Reaction {
                    seat: 0,
                    text: "x".repeat(crate::outbound::Policy::default().message_bytes),
                },
            );
            let (_tx, mut input) = crate::ingress::test_channel();
            assert!(
                room.settle(
                    Effects {
                        changed: true,
                        saved: true
                    },
                    &mut input
                )
                .await
            );
            room
        });
        assert_eq!(next(&mut receivers[0], "error").await["code"], "storage_unavailable");
        assert_eq!(target.abort_cause(), None, "uncommitted capacity refusal stays private");
        assert_eq!(peer.abort_cause(), None);
        std::fs::remove_dir(path.with_extension("tmp")).unwrap();
        let _room = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(target.abort_cause(), Some(crate::outbound::AbortCause::MessageTooLarge));
        assert_eq!(
            peer.abort_cause(),
            None,
            "only the committed oversized recipient closes"
        );
    }

    #[tokio::test]
    async fn failed_checkpoint_holds_all_effects_and_retries_the_same_candidate() {
        failed_operation_checkpoint(false, false).await;
    }

    #[tokio::test]
    async fn cancellation_checkpoint_holds_acknowledgement_and_restores_tombstone() {
        failed_operation_checkpoint(true, false).await;
    }

    #[tokio::test]
    async fn room_operation_checkpoint_holds_acknowledgement_and_restores_counter() {
        failed_operation_checkpoint(false, true).await;
    }

    async fn failed_operation_checkpoint(cancel: bool, room_command: bool) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.json");
        let (mut room, mut receivers) = fixture(&path).await;
        let before = std::fs::read_to_string(&path).unwrap();
        let Turn::Seat(seat) = room.hand.turn().unwrap() else {
            panic!("bidding")
        };
        let conn = seat as u64 + 1;
        let disconnected = (seat + 1) % 5;
        let disconnected_actor = room.member(disconnected).id;
        room.lifecycle.ready.insert(disconnected_actor.clone());
        let hand_version = room.hand.version;
        let scope = if room_command {
            room.room_command_scope(conn).unwrap()
        } else {
            room.command_scope(seat)
        };
        let action = Mighty::legal_actions(room.hand.game.as_ref().unwrap(), seat)
            .into_iter()
            .find(|action| !matches!(action, mighty::Action::Misdeal))
            .unwrap();
        let submit: ClientMsg = serde_json::from_value(json!({
            "type": if cancel { "cancel_operation" } else if room_command { "submit_room" } else { "submit" }, "operation_id":"1:held", "sequence":1,
            "expected":scope, "action": if room_command { json!({"type":"set_table", "shuffle":false}) } else { serde_json::to_value(&action).unwrap() }
        }))
        .unwrap();
        // A directory at the temporary-file path fails before modifying the
        // previous committed checkpoint. No production fault switch is needed.
        std::fs::create_dir(path.with_extension("tmp")).unwrap();
        let stats = room.env.stats.clone();
        let (tx, mut rx) = crate::ingress::test_channel();
        let task = tokio::spawn(async move {
            room.publication.begin();
            room.on_message(conn, submit).unwrap();
            room.record(Event::TurnTimedOut { table: room.id.clone() });
            assert!(
                room.settle(
                    Effects {
                        changed: true,
                        saved: true
                    },
                    &mut rx
                )
                .await
            );
            room
        });
        for receiver in &mut receivers {
            assert_eq!(next(receiver, "error").await["code"], "storage_unavailable");
            assert!(
                receiver.try_recv().is_err(),
                "no state, welcome or acceptance before commit"
            );
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
        assert_eq!(stats.summary(crate::stats::now()).totals.turns_timed_out, 0);
        tx.send(Command::Message {
            conn,
            msg: ClientMsg::QueryOperation {
                operation_id: "1:held".into(),
                sequence: 1,
            },
        })
        .unwrap();
        let unavailable = next(&mut receivers[seat], "operation_receipt").await;
        assert_eq!(
            unavailable["outcome"],
            json!({"status":"unavailable", "reason":"persistence_failed"})
        );
        assert!(unavailable["scope"].is_null());
        tx.send(Command::Message {
            conn,
            msg: ClientMsg::CancelOperation {
                operation_id: "2:blocked-cancel".into(),
                sequence: 2,
                expected: scope.clone(),
            },
        })
        .unwrap();
        let unavailable_cancel = next(&mut receivers[seat], "operation_receipt").await;
        assert_eq!(
            unavailable_cancel["outcome"],
            json!({"status":"unavailable", "reason":"persistence_failed"})
        );
        assert_eq!(unavailable_cancel["durability"], "memory");
        tx.send(Command::Message {
            conn,
            msg: ClientMsg::SubmitRoom {
                operation_id: "2:blocked-room".into(),
                sequence: 2,
                expected: scope.clone(),
                action: crate::protocol::RoomAction::Leave,
            },
        })
        .unwrap();
        let unavailable_room = next(&mut receivers[seat], "operation_receipt").await;
        assert_eq!(
            unavailable_room["outcome"],
            json!({"status":"unavailable", "reason":"persistence_failed"})
        );
        assert_eq!(unavailable_room["durability"], "memory");
        tx.send(Command::Message {
            conn,
            msg: ClientMsg::Act {
                action: serde_json::to_value(&action).unwrap(),
            },
        })
        .unwrap();
        assert_eq!(next(&mut receivers[seat], "error").await["code"], "storage_unavailable");
        let (reply, unavailable) = oneshot::channel();
        tx.send(Command::Report { reply }).unwrap();
        assert!(unavailable.await.is_err(), "reports cannot expose the candidate");
        let (connection, mut refused) = crate::outbound::test_channel();
        tx.send(Command::Connect {
            conn: 99,
            tx: connection,
        })
        .unwrap();
        assert_eq!(next(&mut refused, "error").await["code"], "storage_unavailable");
        assert!(refused.recv().await.is_none(), "new connections retry after recovery");

        tx.send(Command::Disconnect {
            conn: disconnected as u64 + 1,
        })
        .unwrap();
        // A read-only command orders the disconnect before the next retry.
        let (reply, described) = oneshot::channel();
        tx.send(Command::Describe { reply }).unwrap();
        assert!(described.await.is_err());
        std::fs::remove_dir(path.with_extension("tmp")).unwrap();
        let receipt = next(&mut receivers[seat], "operation_receipt").await;
        assert_eq!(receipt["durability"], "persisted");
        assert_eq!(
            receipt["outcome"],
            if cancel {
                json!({"status":"rejected", "reason":"cancelled", "error":null})
            } else {
                json!({"status":"accepted", "version":scope.version + 1})
            }
        );
        // Receipt arrival itself proves its game and ledger are readable on disk.
        let checkpoint: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let restored =
            Room::<Mighty>::restore(checkpoint, Arc::new(RoomEnv::new(Duration::ZERO)), mighty_bots()).unwrap();
        let version = hand_version + u64::from(!cancel && !room_command);
        assert_eq!(restored.hand.version, version);
        assert_eq!(restored.command_window(seat).unwrap().next_sequence, 2);
        if room_command {
            assert!(restored.commands.room_version > scope.version);
            assert!(!restored.table.shuffle);
        }
        let room = task.await.unwrap();
        assert_eq!(room.hand.version, version, "retry never replays the action");
        assert!(
            !room.lifecycle.ready.contains(&disconnected_actor),
            "held disconnect clears readiness"
        );
        assert!(!room.seating.connected(disconnected));
        assert_eq!(stats.summary(crate::stats::now()).totals.turns_timed_out, 1);
        let clock = room.clock.info().unwrap();
        assert!(
            cancel || room_command || clock.ms > clock.total_ms.saturating_sub(250),
            "publication starts a full visible turn, including an away seat's shorter limit"
        );
    }

    #[tokio::test]
    async fn background_hints_obey_publication_and_current_audience() {
        use super::super::bots::Internal;
        let dir = tempfile::tempdir().unwrap();
        let (mut room, mut receivers) = fixture(&dir.path().join("test.json")).await;
        let Turn::Seat(seat) = room.hand.turn().unwrap() else {
            panic!("bidding")
        };
        let conn = seat as u64 + 1;
        let version = room.hand.version;
        let actor_id = room.member(seat).id;
        let action = Mighty::legal_actions(room.hand.game.as_ref().unwrap(), seat)[0].clone();
        room.publication.begin();
        assert!(!room.on_internal(Internal::Hint {
            version,
            seat,
            conn,
            actor_id: actor_id.clone(),
            action: action.clone(),
        }));
        assert!(receivers[seat].try_recv().is_err(), "hint waits behind publication");
        room.publish_pending();
        assert_eq!(next(&mut receivers[seat], "hint").await["version"], version);
        room.on_internal(Internal::Hint {
            version: version + 1,
            seat,
            conn,
            actor_id: actor_id.clone(),
            action: action.clone(),
        });
        room.on_internal(Internal::Hint {
            version,
            seat,
            conn,
            actor_id: "foreign".into(),
            action: action.clone(),
        });
        room.seating.conns.get_mut(&conn).unwrap().seat = None;
        room.on_internal(Internal::Hint {
            version,
            seat,
            conn,
            actor_id,
            action: action.clone(),
        });
        assert!(
            receivers[seat].try_recv().is_err(),
            "stale work cannot expose another seat's hint"
        );
    }

    #[tokio::test]
    async fn shutdown_failure_is_reported_and_never_deletes_the_last_checkpoint() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.json");
        let (mut room, mut receivers) = fixture(&path).await;
        let before = std::fs::read_to_string(&path).unwrap();
        std::fs::create_dir(path.with_extension("tmp")).unwrap();
        let (tx, mut rx) = crate::ingress::test_channel();
        let task = tokio::spawn(async move {
            room.publication.begin();
            room.table.shuffle = true;
            room.settle(
                Effects {
                    changed: true,
                    saved: true,
                },
                &mut rx,
            )
            .await
        });
        next(&mut receivers[0], "error").await;
        let (done, saved) = oneshot::channel();
        tx.send(Command::Shutdown { done }).unwrap();
        assert!(saved.await.unwrap().is_err());
        assert!(!task.await.unwrap());
        assert_eq!(std::fs::read_to_string(path).unwrap(), before);
        assert!(
            receivers[0].recv().await.is_none(),
            "uncommitted effects are dropped on stop"
        );
    }

    fn packets(rx: &mut crate::outbound::Receiver) -> Vec<Value> {
        std::iter::from_fn(|| rx.try_recv().ok())
            .map(|text| serde_json::from_str(&text).unwrap())
            .collect()
    }

    #[tokio::test]
    async fn public_session_checkpoint_tracks_settled_connect_and_authentication_only() {
        let mut room = Room::<Mighty>::new(
            "test".into(),
            MightySettings::default(),
            Arc::new(RoomEnv::new(Duration::ZERO)),
            mighty_bots(),
        );
        let (tx, mut messages) = crate::outbound::test_channel();
        room.seating.conns.insert(1, Conn::new(tx));
        let (_commands, mut rx) = crate::ingress::test_channel();
        room.publication.begin();
        room.greet(1);
        assert!(messages.try_recv().is_err());
        room.settle(
            Effects {
                changed: true,
                saved: false,
            },
            &mut rx,
        )
        .await;
        let connected = packets(&mut messages);
        let session = connected.iter().find(|m| m["type"] == "session").unwrap();
        let public = connected.iter().find(|m| m["type"] == "room").unwrap();
        assert_eq!(session["room_version"], public["room_version"]);
        let session_revision = room.session.revision;
        room.publication.begin();
        room.observe(1, "Watcher".into(), None).unwrap();
        let key = room.seating.conns[&1].visitor.clone().unwrap();
        // The same identity may be welcomed repeatedly in one actor turn.
        room.visitor_welcome(1, &key);
        room.settle(
            Effects {
                changed: true,
                saved: true,
            },
            &mut rx,
        )
        .await;
        assert_eq!(
            room.session.revision, session_revision,
            "authentication does not modify historical content"
        );
        let authenticated = packets(&mut messages);
        let sessions: Vec<_> = authenticated.iter().filter(|m| m["type"] == "session").collect();
        assert_eq!(sessions.len(), 1, "one full public checkpoint per recipient per turn");
        let public = authenticated.iter().find(|m| m["type"] == "room").unwrap();
        let window = authenticated
            .iter()
            .find(|m| m["type"] == "room_command_window")
            .unwrap();
        assert_eq!(sessions[0]["room_version"], public["room_version"]);
        assert_eq!(sessions[0]["room_version"], window["command"]["scope"]["version"]);
        assert_eq!(sessions[0]["session_id"], window["command"]["scope"]["session_id"]);
        room.publication.begin();
        room.settle(
            Effects {
                changed: true,
                saved: false,
            },
            &mut rx,
        )
        .await;
        assert!(
            packets(&mut messages).iter().all(|m| m["type"] != "session"),
            "ordinary room publications retain session revision suppression"
        );
    }

    #[tokio::test]
    async fn authentication_checkpoint_waits_for_storage_and_final_disconnect_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.json");
        let (mut room, mut peers) = fixture(&path).await;
        let (tx, mut watcher) = crate::outbound::test_channel();
        room.seating.conns.insert(10, Conn::new(tx));
        std::fs::create_dir(path.with_extension("tmp")).unwrap();
        let session_revision = room.session.revision;
        room.publication.begin();
        room.greet(10);
        room.observe(10, "Watcher".into(), None).unwrap();
        let (commands, mut rx) = crate::ingress::test_channel();
        let task = tokio::spawn(async move {
            room.settle(
                Effects {
                    changed: true,
                    saved: true,
                },
                &mut rx,
            )
            .await;
            room
        });
        next(&mut watcher, "error").await;
        assert!(
            watcher.try_recv().is_err(),
            "private identity and public checkpoint remain unpublished"
        );
        commands.send(Command::Disconnect { conn: 1 }).unwrap();
        let (reply, unavailable) = oneshot::channel();
        commands.send(Command::Describe { reply }).unwrap();
        assert!(
            unavailable.await.is_err(),
            "disconnect is processed while the candidate is held"
        );
        std::fs::remove_dir(path.with_extension("tmp")).unwrap();
        let room = task.await.unwrap();
        assert_eq!(room.session.revision, session_revision);
        let messages = packets(&mut watcher);
        assert!(messages.iter().any(|m| m["type"] == "visitor_welcome"));
        let session = messages.iter().find(|m| m["type"] == "session").unwrap();
        let public = messages.iter().find(|m| m["type"] == "room").unwrap();
        let window = messages.iter().find(|m| m["type"] == "room_command_window").unwrap();
        assert_eq!(session["room_version"], public["room_version"]);
        assert_eq!(session["room_version"], window["command"]["scope"]["version"]);
        let durable: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(session["room_version"].as_u64(), Some(room.commands.room_version));
        assert!(Room::<Mighty>::restore(durable, Arc::new(RoomEnv::new(Duration::ZERO)), mighty_bots()).is_ok());
        for peer in &mut peers {
            assert!(
                packets(peer).iter().all(|m| m["type"] != "session"),
                "another actor's authentication does not resend peer archives"
            );
        }
    }

    #[tokio::test]
    async fn disconnected_checkpoint_recipient_never_redirects_to_a_peer() {
        let mut room = Room::<Mighty>::new(
            "test".into(),
            MightySettings::default(),
            Arc::new(RoomEnv::new(Duration::ZERO)),
            mighty_bots(),
        );
        let (tx, mut target) = crate::outbound::test_channel();
        let (peer, mut other) = crate::outbound::test_channel();
        room.seating.conns.insert(1, Conn::new(tx));
        room.seating.conns.insert(2, Conn::new(peer));
        room.publication.begin();
        room.greet(1);
        room.observe(1, "gone".into(), None).unwrap();
        room.seating.conns.remove(&1);
        room.publish_pending();
        assert!(target.recv().await.is_none());
        assert!(other.try_recv().is_err());
    }

    #[tokio::test]
    async fn native_reclaim_gets_one_exact_public_checkpoint_without_changing_history() {
        let mut room = Room::<Mighty>::new(
            "test".into(),
            MightySettings::default(),
            Arc::new(RoomEnv::new(Duration::ZERO)),
            mighty_bots(),
        );
        let (tx, mut old) = crate::outbound::test_channel();
        room.seating.conns.insert(1, Conn::new(tx));
        let (_commands, mut rx) = crate::ingress::test_channel();
        room.publication.begin();
        room.observe(1, "Original".into(), None).unwrap();
        room.join(1, "Original".into(), None, Some(0), None, false).unwrap();
        room.settle(
            Effects {
                changed: true,
                saved: true,
            },
            &mut rx,
        )
        .await;
        let _ = packets(&mut old);
        let visitor_token = room.seating.conns[&1].visitor.clone().unwrap();
        let seat_token = match &room.seating.seats[0] {
            super::super::seating::Occupant::Human { token, .. } => token.clone(),
            _ => panic!("human"),
        };
        let actor = room.member(0).id;
        let session_revision = room.session.revision;
        let scores = room.session.scores.clone();
        room.seating.conns.remove(&1);
        let (tx, mut current) = crate::outbound::test_channel();
        room.seating.conns.insert(2, Conn::new(tx));
        room.publication.begin();
        room.greet(2);
        room.observe(2, String::new(), Some(visitor_token.clone())).unwrap();
        room.join(2, "stale local name".into(), Some(seat_token.clone()), None, None, true)
            .unwrap();
        assert!(current.try_recv().is_err(), "identity and checkpoint wait together");
        room.settle(
            Effects {
                changed: true,
                saved: true,
            },
            &mut rx,
        )
        .await;
        assert_eq!(room.session.revision, session_revision);
        assert_eq!(room.session.scores, scores);
        let messages = packets(&mut current);
        let sessions: Vec<_> = messages.iter().filter(|m| m["type"] == "session").collect();
        assert_eq!(sessions.len(), 1);
        let public = messages.iter().find(|m| m["type"] == "room").unwrap();
        let window = messages.iter().find(|m| m["type"] == "room_command_window").unwrap();
        assert_eq!(sessions[0]["room_version"], public["room_version"]);
        assert_eq!(sessions[0]["room_version"], window["command"]["scope"]["version"]);
        assert_eq!(window["command"]["scope"]["seat"], 0);
        assert_eq!(window["command"]["scope"]["actor_id"], actor);
        assert_eq!(public["seats"][0]["name"], "Original");
        let text = sessions[0].to_string();
        assert!(!text.contains(&seat_token));
        assert!(!text.contains(&visitor_token));
    }
}
