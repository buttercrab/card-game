//! The room's task: it waits for a command, a bot's move, its turn timer or
//! its idle timeout, handles the one that comes, and settles.

use super::bots::Internal;
use super::seating::Conn;
use super::snapshot::Persister;
use super::view::Preview;
use super::{ConnId, Msg, REACTIONS, Room, TURN_LIMITS, log_action};
use crate::game::ServerGame;
use crate::ingress::Receiver as CommandReceiver;
use crate::protocol::{ClientMsg, ErrorCode, RoomAction, ServerError};
use crate::stats::Event;
use serde_json::Value;
use tokio::sync::oneshot;

/// What the rest of the server asks of a room.
pub enum Command {
    Connect {
        conn: ConnId,
        tx: crate::outbound::Sender,
    },
    Disconnect {
        conn: ConnId,
    },
    Message {
        conn: ConnId,
        msg: ClientMsg,
    },
    /// What a problem report should carry about this room.
    Report {
        reply: oneshot::Sender<Value>,
    },
    /// The preset and empty seats, for a share link's preview.
    Describe {
        reply: oneshot::Sender<Preview>,
    },
    /// The server is stopping: save the room, keep its file, and end. `done`
    /// reports whether the final synchronized checkpoint succeeded.
    Shutdown {
        done: oneshot::Sender<Result<(), String>>,
    },
}

/// What the room's loop woke up for.
enum Wake<A> {
    Command(Command),
    Internal(Internal<A>),
    Clock,
    Closed,
}

/// What handling one wake did, for [`Room::settle`].
#[derive(Debug, Default, Clone, Copy)]
pub(super) struct Effects {
    /// Something everyone sees changed: send the table again.
    pub changed: bool,
    /// Something the room's file keeps changed: save it again. (Who is
    /// connected, and who is away, it does not keep.)
    pub saved: bool,
}

impl Effects {
    const NONE: Effects = Effects {
        changed: false,
        saved: false,
    };
    /// The table and its file both changed.
    const CHANGED: Effects = Effects {
        changed: true,
        saved: true,
    };
    /// Only who is there changed.
    const PRESENCE: Effects = Effects {
        changed: true,
        saved: false,
    };

    /// `CHANGED` if `changed`, else `NONE`.
    fn changed(changed: bool) -> Effects {
        if changed { Effects::CHANGED } else { Effects::NONE }
    }
}

/// Answers a command that came as the room closed: a connection hears the
/// table is gone (and its socket closes when its sender is dropped), a
/// shutdown has nothing to wait for, the rest go unanswered.
pub(super) fn turn_away(cmd: Command) {
    match cmd {
        Command::Connect { tx, .. } => {
            let _ = tx.send(ServerError::new(ErrorCode::TableGone).message());
        }
        Command::Shutdown { done } => {
            let _ = done.send(Err("room closed before shutdown checkpoint".into()));
        }
        Command::Disconnect { .. } | Command::Message { .. } | Command::Report { .. } | Command::Describe { .. } => {}
    }
}

impl<G: ServerGame> Room<G> {
    /// Runs the room on the commands from `rx` until every sender is gone
    /// or nobody has been connected for the server's idle time.
    ///
    /// With a data directory, the room is written there after every change
    /// and the file removed when the room closes.
    pub async fn run(mut self, mut rx: CommandReceiver) {
        let mut inbox = self.inbox.take().expect("a room runs once");
        let idle = self.env.idle;
        if let Some(dir) = &self.env.data {
            let path = dir.join(format!("{}.json", self.id));
            self.persister = Some(Persister::start(self.id.clone(), path));
        }
        // A restored room may have a bot to act.
        self.publication.begin();
        if !self.settle(Effects::NONE, &mut rx).await {
            return;
        }
        let mut empty_since = Some(tokio::time::Instant::now());
        let mut command_burst = 0usize;
        loop {
            let now = tokio::time::Instant::now();
            let deadline = self.clock.deadline();
            // In this order when several are ready at once: a move that came
            // as the turn ran out counts, and so does someone arriving as
            // the table was about to close.
            let ready = if command_burst >= 16 {
                inbox.try_recv().ok()
            } else {
                None
            };
            let next = if let Some(message) = ready {
                Wake::Internal(message)
            } else {
                tokio::select! {
                    biased;
                    cmd = rx.recv() => cmd.map_or(Wake::Closed, Wake::Command),
                    // The room holds a sender itself, so this never ends.
                    Some(message) = inbox.recv() => Wake::Internal(message),
                    () = tokio::time::sleep_until(deadline.unwrap_or(now)), if deadline.is_some() => Wake::Clock,
                    () = tokio::time::sleep_until(empty_since.map_or(now, |since| since + idle)), if empty_since.is_some() => Wake::Closed,
                }
            };
            command_burst = if matches!(&next, Wake::Command(_)) {
                command_burst.saturating_add(1).min(16)
            } else {
                0
            };
            let effects = match next {
                Wake::Command(Command::Shutdown { done }) => {
                    let _ = done.send(self.checkpoint(true).await);
                    return;
                }
                Wake::Command(cmd) => {
                    self.publication.begin();
                    self.handle(cmd)
                }
                Wake::Internal(message) => {
                    self.publication.begin();
                    Effects::changed(self.on_internal(message))
                }
                Wake::Clock => {
                    self.publication.begin();
                    Effects::changed(self.on_clock())
                }
                Wake::Closed => break,
            };
            if !self.settle(effects, &mut rx).await {
                return;
            }
            empty_since = match (self.seating.conns.is_empty(), empty_since) {
                (true, None) => Some(tokio::time::Instant::now()),
                (true, since) => since,
                (false, _) => None,
            };
        }
        // Closed to anything new: a connection on its way in hears the
        // table is gone (here, or from the sender it finds closed) rather
        // than waiting on a room that will never answer.
        rx.close();
        while let Ok(cmd) = rx.try_recv() {
            turn_away(cmd);
        }
        if self.hand.in_hand() {
            self.record(Event::HandAbandoned {
                hand: self.hand_stats(),
                secs: self.hand_secs(),
            });
        }
        if self
            .committed_entry_refusal
            .lock()
            .expect("entry status lock")
            .is_some()
        {
            // Numeric entry exhaustion never authorizes deleting retained history.
            return;
        }
        if let Some(persister) = self.persister.take()
            && let Err(error) = persister.remove().await
        {
            tracing::error!(room = %self.id, %error, "room closed but durable checkpoint removal failed");
        }
    }

    /// Prepare once, commit every persistent writer, then expose the turn.
    /// Failed writes retain this same candidate and its bounded turn outbox;
    /// no human, bot or timer can mutate it until the checkpoint succeeds.
    pub(super) async fn settle(&mut self, effects: Effects, rx: &mut CommandReceiver) -> bool {
        let deals = self.hand.deals;
        let prepared_deal = self.prepared_advance.as_ref().is_some_and(|advanced| advanced.dealt);
        // Read-only receipts/tools cannot change canonical resource usage.
        // Initialize once and refresh every business/presence/candidate change;
        // retain exact admission checks inside each staged game operation.
        let refresh = effects.changed
            || effects.saved
            || self.prepared_advance.is_some()
            || self.hand.turn() == Some(engine::Turn::Chance)
            || self.resource_policy_needs_refresh();
        let advanced = refresh && self.advance();
        if refresh {
            self.reconcile_admissions();
        }
        if !self.bump_room_version(effects.changed || effects.saved || advanced) {
            // Preserve the last synchronized file; never publish changed data
            // under an unchanged or rounded revision on an invariant failure.
            return false;
        }
        self.dirty |= effects.saved | advanced;
        if !self.commit_before_publish(rx).await {
            return false;
        }
        if refresh {
            self.refresh_committed_entry_status();
        }
        // Time spent saving is never deducted from a newly visible turn.
        if prepared_deal || self.hand.deals != deals {
            self.hand.dealt_at = Some(tokio::time::Instant::now());
        }
        let changed = effects.changed | advanced | self.arm_clock();
        self.publish_pending();
        if changed || self.session.revision != self.session_sent {
            self.broadcast();
        }
        if prepared_deal || self.hand.deals != deals {
            self.plan_off_turn();
        }
        self.think();
        true
    }

    fn bump_room_version(&mut self, changed: bool) -> bool {
        if changed {
            let Some(version) = self
                .commands
                .room_version
                .checked_add(1)
                .filter(|version| *version <= crate::command_protocol::MAX_COMMAND_SEQUENCE)
            else {
                tracing::error!(room = %self.id, "room revision runway invariant failed; preserving checkpoint");
                return false;
            };
            self.commands.room_version = version;
            self.dirty = true;
        }
        true
    }

    async fn checkpoint(&mut self, force: bool) -> Result<(), String> {
        if (force || self.dirty)
            && let Some(persister) = &self.persister
        {
            let snapshot = match self.snapshot_text() {
                Ok(snapshot) => snapshot,
                Err(error) => {
                    self.resources.persistence_refusal = Some(error.clone());
                    return Err(format!("native snapshot capacity: {error:?}"));
                }
            };
            // No partial or oversized String ever reaches the writer. A failed
            // encoding preserves the previous file and the exact pending turn.
            self.resources.persistence_refusal = None;
            persister.save(snapshot).await?;
            persister.flush().await?;
        }
        self.dirty = false;
        Ok(())
    }

    async fn commit_before_publish(&mut self, rx: &mut CommandReceiver) -> bool {
        let mut notified = false;
        loop {
            match self.checkpoint(false).await {
                Ok(()) => return true,
                Err(error) => {
                    tracing::error!(room = %self.id, %error, "holding unpublished room turn until storage recovers");
                    // Pause even an existing clock while play cannot proceed.
                    self.clock.take();
                    if !notified {
                        let text = self.checkpoint_unavailable().message();
                        for connection in self.seating.conns.values() {
                            let _ = connection.tx.send(text.clone());
                        }
                        notified = true;
                    }
                }
            }
            let retry = tokio::time::sleep(std::time::Duration::from_secs(1));
            tokio::pin!(retry);
            loop {
                tokio::select! {
                    biased;
                    () = &mut retry => break,
                    command = rx.recv() => match command {
                        Some(Command::Shutdown { done }) => {
                            let _ = done.send(self.checkpoint(true).await);
                            // Keep the last checkpoint; never run idle deletion on failure.
                            return false;
                        }
                        Some(command @ Command::Disconnect { .. }) => {
                            // Presence cleanup follows exactly the normal path;
                            // its readiness/admission changes join this checkpoint.
                            let effects = self.handle(command);
                            if !self.bump_room_version(effects.changed || effects.saved) { return false; }
                        }
                        Some(Command::Connect { tx, .. }) => {
                            // No greeting or identity change from an unpublished candidate.
                            let _ = tx.send(self.checkpoint_unavailable().message());
                        }
                        Some(Command::Message { conn, msg }) => self.storage_refusal(conn, msg),
                        // Dropping these replies makes the caller report unavailable;
                        // neither reports nor share previews see the candidate state.
                        Some(Command::Report { .. } | Command::Describe { .. }) => {}
                        None => return false,
                    }
                }
            }
        }
    }

    fn storage_refusal(&self, conn: ConnId, msg: ClientMsg) {
        use crate::command_protocol::{CommandOutcome, CommandReceipt, ReceiptDurability, ReceiptUnavailable};
        let Some(connection) = self.seating.conns.get(&conn) else {
            return;
        };
        let text = match msg {
            ClientMsg::Submit {
                operation_id, sequence, ..
            }
            | ClientMsg::SubmitBatch {
                operation_id, sequence, ..
            }
            | ClientMsg::SubmitRoom {
                operation_id, sequence, ..
            }
            | ClientMsg::CancelOperation {
                operation_id, sequence, ..
            }
            | ClientMsg::QueryOperation { operation_id, sequence }
                if operation_id.len() <= 128 =>
            {
                serde_json::to_string(&Msg::<G>::OperationReceipt(CommandReceipt {
                    operation_id,
                    sequence,
                    scope: None,
                    outcome: CommandOutcome::Unavailable {
                        reason: ReceiptUnavailable::PersistenceFailed,
                    },
                    durability: ReceiptDurability::Memory,
                }))
                .expect("messages serialize")
            }
            _ => self.checkpoint_unavailable().message(),
        };
        // This explicit unavailable result bypasses the held candidate outbox.
        let _ = connection.tx.send(text);
    }

    fn checkpoint_unavailable(&self) -> ServerError {
        ServerError::new(if self.resources.persistence_refusal.is_some() {
            ErrorCode::ResourceCapacity
        } else {
            ErrorCode::StorageUnavailable
        })
    }

    /// The room as its file holds it, capped before allocating a checkpoint
    /// String or handing anything to the asynchronous persistence worker.
    fn snapshot_text(&self) -> Result<String, crate::resource_budget::BudgetError> {
        let bytes = crate::resource_budget::serialize_capped(
            &self.snapshot_ref(),
            crate::resource_budget::Resource::Snapshot,
            self.env.resources.snapshot_bytes,
        )?;
        Ok(String::from_utf8(bytes).expect("serde JSON is UTF-8"))
    }

    fn handle(&mut self, cmd: Command) -> Effects {
        match cmd {
            Command::Connect { conn, tx } => {
                if let Err(error) = self.require_room_control(false, true) {
                    let _ =
                        tx.send(ServerError::with_detail(ErrorCode::ResourceCapacity, format!("{error:?}")).message());
                    return Effects::NONE;
                }
                self.seating.conns.insert(conn, Conn::new(tx));
                self.greet(conn);
                Effects::PRESENCE
            }
            Command::Disconnect { conn } => {
                self.publication.discard_connection(conn);
                let Some(connection) = self.seating.conns.remove(&conn) else {
                    return Effects::NONE;
                };
                let seat = connection.seat;
                if let Some(s) = seat
                    && !self.seating.connected(s)
                {
                    self.lifecycle.ready.remove(&self.member(s).id);
                }
                self.reconcile_admissions();
                Effects::PRESENCE
            }
            Command::Message { conn, msg } => {
                // A reaction or a hint changes nothing the room or the hand shows.
                let quiet = matches!(
                    msg,
                    ClientMsg::React { .. } | ClientMsg::Hint | ClientMsg::QueryOperation { .. }
                );
                let correlated = matches!(
                    msg,
                    ClientMsg::Submit { .. }
                        | ClientMsg::SubmitBatch { .. }
                        | ClientMsg::SubmitRoom { .. }
                        | ClientMsg::CancelOperation { .. }
                );
                let ledger_revision = self.commands.ledger_revision();
                let quiet_back = matches!(msg, ClientMsg::Hint | ClientMsg::React { .. })
                    && self.require_room_control(true, false).is_ok();
                let cancel = matches!(msg, ClientMsg::CancelOperation { .. });
                let done = self.on_message(conn, msg);
                if let Err(error) = &done {
                    self.send(conn, &Msg::<G>::Error(error.clone()));
                }
                let acted =
                    done.is_ok() && !quiet && (!correlated || ledger_revision != self.commands.ledger_revision());
                // Quiet tools and replayed/nonconsuming receipts are read-only.
                // A fresh business operation shares its already admitted revision
                // with the away→back mark; never spend protected runway first.
                let back = ((acted && !cancel) || (quiet_back && done.is_ok())) && self.seating.back(conn);
                Effects {
                    changed: back || acted,
                    saved: acted,
                }
            }
            Command::Report { reply } => {
                let _ = reply.send(self.report());
                Effects::NONE
            }
            Command::Describe { reply } => {
                let _ = reply.send(self.describe());
                Effects::NONE
            }
            // Handled by `run`, which ends the room.
            Command::Shutdown { .. } => Effects::NONE,
        }
    }

    /// Scoped business operations only: never turn Rename into Observe/bootstrap.
    pub(super) fn apply_room_action(&mut self, conn: ConnId, action: RoomAction) -> Result<(), ServerError> {
        let native = match action {
            RoomAction::Rename { name } => return self.rename(conn, name),
            RoomAction::Join { name, seat, device } => ClientMsg::Join {
                name,
                seat,
                device,
                token: None,
                reclaim: false,
            },
            RoomAction::Leave => ClientMsg::Leave,
            RoomAction::RequestSeat { requested, seat } => ClientMsg::RequestSeat { requested, seat },
            RoomAction::OfferSeat { requester_id } => ClientMsg::OfferSeat { requester_id },
            RoomAction::AcceptSeat { seat, target_id } => ClientMsg::AcceptSeat { seat, target_id },
            RoomAction::ResetScores => ClientMsg::ResetScores,
            RoomAction::Ready { ready } => ClientMsg::Ready { ready },
            RoomAction::EndSession => ClientMsg::EndSession,
            RoomAction::Rematch => ClientMsg::Rematch,
            RoomAction::SetTable {
                turn_secs,
                shuffle,
                shuffle_next,
            } => ClientMsg::SetTable {
                turn_secs,
                shuffle,
                shuffle_next,
            },
            RoomAction::SwapSeats { a, b } => ClientMsg::SwapSeats { a, b },
            RoomAction::ClearSeat { seat } => ClientMsg::ClearSeat { seat },
            RoomAction::AddBot { seat, level } => ClientMsg::AddBot { seat, level },
            RoomAction::RemoveBot { seat } => ClientMsg::RemoveBot { seat },
            RoomAction::SetSettings { settings } => ClientMsg::SetSettings { settings },
            RoomAction::Start => ClientMsg::Start,
        };
        self.on_message(conn, native)
    }

    pub(super) fn on_message(&mut self, conn: ConnId, msg: ClientMsg) -> Result<(), ServerError> {
        // Correlated envelopes classify cached receipts before admission in
        // commands.rs. A valid existing bootstrap credential may use finite
        // recovery spare, while fresh identities and optional edits may not.
        match &msg {
            ClientMsg::Submit { .. }
            | ClientMsg::SubmitBatch { .. }
            | ClientMsg::SubmitRoom { .. }
            | ClientMsg::CancelOperation { .. }
            | ClientMsg::QueryOperation { .. }
            | ClientMsg::Act { .. }
            | ClientMsg::Hint
            | ClientMsg::React { .. } => {}
            ClientMsg::Observe { name, token } if self.recovery_observe(name, token.as_deref()) => {
                self.require_room_control(false, false)
                    .map_err(|error| ServerError::with_detail(ErrorCode::ResourceCapacity, format!("{error:?}")))?;
            }
            ClientMsg::Join { token: Some(token), .. } if self.seating.seat_with_token(token).is_some() => {
                self.require_room_control(false, false)
                    .map_err(|error| ServerError::with_detail(ErrorCode::ResourceCapacity, format!("{error:?}")))?;
            }
            _ => self.require_optional_room_control()?,
        }
        let my_seat = self.seating.seat_of(conn);
        let seated = || my_seat.ok_or(ServerError::from(ErrorCode::NotSeated));
        match msg {
            ClientMsg::Observe { name, token } => self.observe(conn, name, token),
            ClientMsg::RequestSeat { requested, seat } => self.request_seat(conn, requested, seat),
            ClientMsg::OfferSeat { requester_id } => self.offer_seat(seated()?, requester_id),
            ClientMsg::AcceptSeat { seat, target_id } => self.accept_seat(conn, seat, target_id),
            ClientMsg::ResetScores => {
                seated()?;
                self.reset_scores()
            }
            ClientMsg::Ready { ready } => self.set_ready(seated()?, ready),
            ClientMsg::EndSession => {
                seated()?;
                self.end_session()
            }
            ClientMsg::Rematch => {
                seated()?;
                self.rematch()
            }
            ClientMsg::Join {
                name,
                token,
                seat,
                device,
                reclaim,
            } => self.join(conn, name, token, seat, device, reclaim),
            ClientMsg::Leave => {
                self.leave(seated()?);
                Ok(())
            }
            ClientMsg::SetTable {
                turn_secs,
                shuffle,
                shuffle_next,
            } => self.set_table(my_seat, turn_secs, shuffle, shuffle_next),
            ClientMsg::SwapSeats { a, b } => self.swap_seats(my_seat, a, b),
            ClientMsg::ClearSeat { seat } => self.clear_seat(my_seat, seat),
            ClientMsg::AddBot { seat, level } => {
                seated()?;
                self.add_bot(seat, level)
            }
            ClientMsg::RemoveBot { seat } => {
                seated()?;
                self.remove_bot(seat)
            }
            ClientMsg::SetSettings { settings } => {
                seated()?;
                self.set_settings(settings)
            }
            ClientMsg::Hint => self.hint(conn, seated()?),
            ClientMsg::React { text } => match my_seat {
                Some(seat) => self.react(seat, text),
                None => self.observer_react(conn, text),
            },
            ClientMsg::Start => {
                let caller = seated()?;
                self.reconcile_admissions();
                let actor = self.member(caller).id;
                let was_ready = self.lifecycle.ready.contains(&actor);
                if self.seating.counts().0 == 1
                    && self.seating.connected(caller)
                    && !self.hand.in_hand()
                    && !self.lifecycle.ended
                    && !self.admissions_pending()
                {
                    self.lifecycle.ready.insert(actor.clone());
                }
                let result = self.start();
                if result.is_err() && !was_ready {
                    self.lifecycle.ready.remove(&actor);
                }
                result
            }
            ClientMsg::Submit {
                operation_id,
                sequence,
                expected,
                action,
            } => self.submit_command(conn, operation_id, sequence, expected, action),
            ClientMsg::SubmitBatch {
                operation_id,
                sequence,
                expected,
                actions,
            } => self.submit_batch_command(conn, operation_id, sequence, expected, actions),
            ClientMsg::SubmitRoom {
                operation_id,
                sequence,
                expected,
                action,
            } => self.submit_room_command(conn, operation_id, sequence, expected, action),
            ClientMsg::CancelOperation {
                operation_id,
                sequence,
                expected,
            } => self.cancel_operation(conn, operation_id, sequence, expected),
            ClientMsg::QueryOperation { operation_id, sequence } => self.query_operation(conn, operation_id, sequence),
            ClientMsg::Act { action } => self.act(seated()?, action),
        }
    }

    /// Changes the table's own settings; fields left out stay as they are.
    fn set_table(
        &mut self,
        my_seat: Option<usize>,
        turn_secs: Option<u32>,
        shuffle: Option<bool>,
        shuffle_next: Option<bool>,
    ) -> Result<(), ServerError> {
        my_seat.ok_or(ErrorCode::NotSeated)?;
        if shuffle_next.is_some() {
            self.may_move_seats(my_seat)?;
        }
        if let Some(secs) = turn_secs {
            if !TURN_LIMITS.contains(&secs) {
                return Err(ErrorCode::NoSuchTurnLimit.into());
            }
            self.table.turn_secs = secs;
        }
        if let Some(shuffle) = shuffle {
            self.table.shuffle = shuffle;
        }
        if let Some(next) = shuffle_next {
            self.table.shuffle_next = next;
        }
        Ok(())
    }

    /// Changes the game's settings between hands; the seat count stays.
    fn set_settings(&mut self, settings: Value) -> Result<(), ServerError> {
        if self.hand.in_hand() {
            return Err(ErrorCode::RulesBetweenHands.into());
        }
        let mut settings: G::Settings =
            serde_json::from_value(settings).map_err(|e| ServerError::with_detail(ErrorCode::BadMessage, e))?;
        G::freeze(&mut settings);
        crate::game::validate::<G>(&settings)?;
        if crate::game::seats::<G>(&settings) != self.seating.len() {
            return Err(ErrorCode::PlayerCountFixed.into());
        }
        tracing::info!(room = %self.id, settings = %log_action(&settings), "settings");
        self.lifecycle.ready.clear();
        self.settings = settings;
        Ok(())
    }

    /// Shows `seat`'s reaction to the whole table.
    /// Shows `seat`'s reaction to the whole table. (How often a connection
    /// may react is its own limit: `limit::ws_reactions`.)
    fn react(&mut self, seat: usize, text: String) -> Result<(), ServerError> {
        if !REACTIONS.contains(&text.as_str()) {
            return Err(ErrorCode::UnknownReaction.into());
        }
        self.tell_all(&Msg::<G>::Reaction { seat, text });
        Ok(())
    }
}

#[cfg(test)]
#[path = "room_commands_tests.rs"]
mod room_command_tests;

#[cfg(test)]
mod resource_checkpoint_tests {
    use super::*;
    use std::{sync::Arc, time::Duration};

    #[tokio::test]
    async fn capped_encoding_preserves_previous_file_and_exact_candidate_until_success() {
        let mut room = Room::<mighty::Mighty>::new(
            "saved".into(),
            Default::default(),
            Arc::new(super::super::RoomEnv::new(Duration::ZERO)),
            super::super::mighty_bots(),
        );
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("saved.json");
        let original = room.snapshot_text().unwrap();
        std::fs::write(&path, &original).unwrap();
        room.persister = Some(Persister::start(room.id.clone(), path.clone()));
        room.table.shuffle = !room.table.shuffle;
        let candidate = room.snapshot_text().unwrap();
        Arc::make_mut(&mut room.env).resources.snapshot_bytes = 128;
        assert!(room.checkpoint(true).await.is_err());
        assert_eq!(room.checkpoint_unavailable().code, ErrorCode::ResourceCapacity);
        assert!(room.resources.persistence_refusal.is_some());
        assert!(room.dirty);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        Arc::make_mut(&mut room.env).resources.snapshot_bytes =
            crate::resource_budget::ResourceLimits::default().snapshot_bytes;
        assert_eq!(room.snapshot_text().unwrap(), candidate);
        room.checkpoint(true).await.unwrap();
        assert!(room.resources.persistence_refusal.is_none());
        assert!(!room.dirty);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), candidate);
        assert!(!path.with_extension("tmp").exists());
    }
}

#[cfg(test)]
mod numeric_tests {
    use super::*;
    use crate::{command_protocol::MAX_COMMAND_SEQUENCE, resource_budget::ResourceProfile};
    use engine::{Game, Turn};
    use rand::Rng;
    use std::{sync::Arc, time::Duration};

    fn active() -> (Room<mighty::Mighty>, crate::outbound::Receiver) {
        let mut room = Room::new(
            "numeric".into(),
            mighty::table::MightySettings::default(),
            Arc::new(super::super::RoomEnv::new(Duration::ZERO)),
            super::super::mighty_bots(),
        );
        let (tx, rx) = crate::outbound::Pool::new(Default::default()).unwrap().channel();
        room.handle(Command::Connect { conn: 1, tx });
        room.on_message(
            1,
            ClientMsg::Join {
                name: "original".into(),
                token: None,
                seat: Some(0),
                device: None,
                reclaim: false,
            },
        )
        .unwrap();
        for seat in 1..room.seating.len() {
            room.add_bot(seat, engine::Level::Normal).unwrap();
        }
        room.on_message(1, ClientMsg::Start).unwrap();
        room.advance();
        (room, rx)
    }

    #[test]
    fn protected_revision_floor_refuses_metadata_and_new_cancel_but_finishes_normally() {
        let (mut room, _rx) = active();
        let profile = ResourceProfile::table::<mighty::Mighty>(&room.settings).unwrap();
        let finish = Room::<mighty::Mighty>::normal_revision_steps(&room.hand, profile).unwrap();
        room.commands.room_version = MAX_COMMAND_SEQUENCE - finish as u64 - room.seating.conns.len() as u64;
        room.seating.away[0] = true;
        let before = serde_json::to_vec(&room.snapshot_ref()).unwrap();
        let rng = room.rng.clone().random::<u64>();
        for _ in 0..100 {
            let effects = room.handle(Command::Message {
                conn: 1,
                msg: ClientMsg::SetTable {
                    turn_secs: Some(20),
                    shuffle: Some(true),
                    shuffle_next: Some(true),
                },
            });
            assert!(!effects.changed && !effects.saved);
        }
        let expected = room.room_command_scope(1).unwrap();
        let effects = room.handle(Command::Message {
            conn: 1,
            msg: ClientMsg::CancelOperation {
                operation_id: "1:floor".into(),
                sequence: 1,
                expected,
            },
        });
        assert!(!effects.changed && !effects.saved);
        assert_eq!(
            room.commands.ledger_revision(),
            0,
            "nonconsuming refusal is not a cancellation fence"
        );
        assert!(room.seating.away[0]);
        assert_eq!(serde_json::to_vec(&room.snapshot_ref()).unwrap(), before);
        assert_eq!(room.rng.clone().random::<u64>(), rng);
        let mut moves = 0;
        while room.hand.in_hand() {
            assert!(moves < 500);
            let Turn::Seat(seat) = room.hand.turn().unwrap() else {
                panic!("settled turn")
            };
            let legal = mighty::Mighty::legal_actions(room.hand.game.as_ref().unwrap(), seat);
            let action = legal
                .iter()
                .find(|action| matches!(action, mighty::Action::Bid(_)))
                .or_else(|| {
                    legal.iter().find(|action| {
                        matches!(
                            action,
                            mighty::Action::Discard(_) | mighty::Action::CallFriend(mighty::FriendCall::Alone)
                        )
                    })
                })
                .or_else(|| legal.iter().find(|action| !matches!(action, mighty::Action::Misdeal)))
                .unwrap()
                .clone();
            room.apply_move(seat, action, "numeric proof").unwrap();
            room.advance();
            assert!(room.bump_room_version(true));
            moves += 1;
        }
        assert_eq!(room.session.hands_played, 1);
        let effects = room.handle(Command::Disconnect { conn: 1 });
        assert!(effects.changed && room.bump_room_version(true));
        let version = room.commands.room_version;
        assert!(!room.handle(Command::Disconnect { conn: 1 }).changed);
        assert_eq!(room.commands.room_version, version);
        assert!(version <= MAX_COMMAND_SEQUENCE);
    }

    #[test]
    fn cached_receipts_and_queries_never_clear_away_or_spend_protected_revisions() {
        let (mut room, _rx) = active();
        let expected = room.room_command_scope(1).unwrap();
        let cancel = || ClientMsg::CancelOperation {
            operation_id: "1:cached".into(),
            sequence: 1,
            expected: expected.clone(),
        };
        assert!(room.handle(Command::Message { conn: 1, msg: cancel() }).saved);
        assert!(room.bump_room_version(true));
        let profile = ResourceProfile::table::<mighty::Mighty>(&room.settings).unwrap();
        let finish = Room::<mighty::Mighty>::normal_revision_steps(&room.hand, profile).unwrap();
        room.commands.room_version = MAX_COMMAND_SEQUENCE - finish as u64 - room.seating.conns.len() as u64;
        room.seating.away[0] = true;
        let before = serde_json::to_vec(&room.snapshot_ref()).unwrap();
        for msg in [
            cancel(),
            ClientMsg::QueryOperation {
                operation_id: "1:cached".into(),
                sequence: 1,
            },
            ClientMsg::Submit {
                operation_id: "2:invalid".into(),
                sequence: 2,
                expected: room.command_scope(0),
                action: serde_json::Value::Null,
            },
        ] {
            let effects = room.handle(Command::Message { conn: 1, msg });
            assert!(!effects.changed && !effects.saved);
            assert!(room.seating.away[0]);
            assert_eq!(room.commands.ledger_revision(), 1);
        }
        assert_eq!(serde_json::to_vec(&room.snapshot_ref()).unwrap(), before);
    }

    #[tokio::test]
    async fn read_only_receipts_preserve_outputs_and_policy_without_remeasuring_retained_history() {
        let (mut room, mut output) = active();
        let (_tx, mut inbox) = crate::ingress::test_channel();
        room.publication.begin();
        assert!(room.settle(Effects::NONE, &mut inbox).await);
        let expected = room.room_command_scope(1).unwrap();
        room.cancel_operation(1, "1:quiet".into(), 1, expected.clone()).unwrap();
        while output.try_recv().is_ok() {}
        let policy = (
            room.resources.held.clone(),
            room.resources.restart_allowed,
            room.resources.pass_restarts,
        );
        assert!(!room.advance(), "recomputed reference policy is unchanged");
        let before = serde_json::to_vec(&room.snapshot_ref()).unwrap();
        let refreshes = room.resource_policy_refreshes();
        for index in 0..100 {
            room.publication.begin();
            let msg = if index % 2 == 0 {
                ClientMsg::QueryOperation {
                    operation_id: "1:quiet".into(),
                    sequence: 1,
                }
            } else {
                ClientMsg::CancelOperation {
                    operation_id: "1:quiet".into(),
                    sequence: 1,
                    expected: expected.clone(),
                }
            };
            let effects = room.handle(Command::Message { conn: 1, msg });
            assert!(!effects.changed && !effects.saved);
            assert!(room.settle(effects, &mut inbox).await);
            let receipt: serde_json::Value = serde_json::from_str(&output.recv().await.unwrap()).unwrap();
            assert_eq!(receipt["type"], "operation_receipt");
            assert_eq!(receipt["outcome"]["reason"], "cancelled");
        }
        assert_eq!(
            room.resource_policy_refreshes(),
            refreshes,
            "zero retained-history policy passes for100 quiet reads"
        );
        // Actual request and private answer ingress share the same unchanged
        // canonical usage; both still deliver their original scoped payload.
        room.publication.begin();
        let effects = room.handle(Command::Message {
            conn: 1,
            msg: ClientMsg::Hint,
        });
        assert!(!effects.changed && !effects.saved);
        assert!(room.settle(effects, &mut inbox).await);
        let message = tokio::time::timeout(Duration::from_secs(3), room.inbox.as_mut().unwrap().recv())
            .await
            .unwrap()
            .unwrap();
        room.publication.begin();
        assert!(!room.on_internal(message));
        assert!(room.settle(Effects::NONE, &mut inbox).await);
        let hint: serde_json::Value = serde_json::from_str(&output.recv().await.unwrap()).unwrap();
        assert_eq!(hint["type"], "hint");
        assert_eq!(hint["version"], room.hand.version);
        assert_eq!(room.resource_policy_refreshes(), refreshes);
        room.publication.begin();
        assert!(!room.on_internal(Internal::BotFailed {
            version: room.hand.version - 1,
            seat: 0
        }));
        assert!(room.settle(Effects::NONE, &mut inbox).await);
        assert_eq!(room.resource_policy_refreshes(), refreshes);
        assert_eq!(serde_json::to_vec(&room.snapshot_ref()).unwrap(), before);
        assert_eq!(
            (
                room.resources.held.clone(),
                room.resources.restart_allowed,
                room.resources.pass_restarts
            ),
            policy
        );
        assert!(!room.advance());
        assert_eq!(
            (
                room.resources.held.clone(),
                room.resources.restart_allowed,
                room.resources.pass_restarts
            ),
            policy
        );
    }

    #[tokio::test]
    async fn unchanged_initialization_and_explicit_resource_hold_still_refresh() {
        let mut room = Room::<mighty::Mighty>::new(
            "initialize".into(),
            Default::default(),
            Arc::new(super::super::RoomEnv::new(Duration::ZERO)),
            super::super::mighty_bots(),
        );
        let (_tx, mut inbox) = crate::ingress::test_channel();
        assert!(room.resource_policy_needs_refresh());
        room.publication.begin();
        assert!(room.settle(Effects::NONE, &mut inbox).await);
        assert_eq!(room.resource_policy_refreshes(), 1);
        room.publication.begin();
        assert!(room.settle(Effects::NONE, &mut inbox).await);
        assert_eq!(room.resource_policy_refreshes(), 1);
        // An actual reservation refusal records changed resource status even
        // when the business operation returns Err/Effects::NONE.
        let (mut room, _output) = active();
        let refreshes = room.resource_policy_refreshes();
        room.resources.reservation = None;
        room.session.scores[0] = crate::command_protocol::MAX_COMMAND_SEQUENCE as i64;
        assert!(room.ensure_native_reservation().is_err());
        assert!(room.resource_policy_needs_refresh());
        room.publication.begin();
        assert!(room.settle(Effects::NONE, &mut inbox).await);
        assert_eq!(room.resource_policy_refreshes(), refreshes + 1);
    }

    #[test]
    fn seat_swap_cannot_publish_a_game_revision_outside_the_exact_range() {
        let (mut room, _rx) = active();
        room.hand.game = None;
        room.hand.version = MAX_COMMAND_SEQUENCE;
        let before = serde_json::to_vec(&room.snapshot_ref()).unwrap();
        assert_eq!(
            room.swap_seats(Some(0), 0, 1).unwrap_err().code,
            ErrorCode::ResourceCapacity
        );
        assert_eq!(serde_json::to_vec(&room.snapshot_ref()).unwrap(), before);
    }

    #[tokio::test]
    async fn contending_upgraded_connections_are_rechecked_before_greeting_and_close_on_refusal() {
        let (mut room, _rx) = active();
        let profile = ResourceProfile::table::<mighty::Mighty>(&room.settings).unwrap();
        let finish = Room::<mighty::Mighty>::normal_revision_steps(&room.hand, profile).unwrap();
        room.commands.room_version = MAX_COMMAND_SEQUENCE - finish as u64 - room.seating.conns.len() as u64 - 2;
        let (first, _first_rx) = crate::outbound::test_channel();
        let effects = room.handle(Command::Connect { conn: 2, tx: first });
        assert!(effects.changed && room.bump_room_version(true));
        let version = room.commands.room_version;
        let (second, mut rejected) = crate::outbound::test_channel();
        assert!(!room.handle(Command::Connect { conn: 3, tx: second }).changed);
        let error: serde_json::Value = serde_json::from_str(&rejected.recv().await.unwrap()).unwrap();
        assert_eq!(error["type"], "error");
        assert_eq!(error["code"], "resource_capacity");
        assert!(
            rejected.recv().await.is_none(),
            "no owned sender or stranded upgraded socket remains"
        );
        assert!(!room.seating.conns.contains_key(&3));
        assert!(
            !room.handle(Command::Disconnect { conn: 3 }).changed,
            "reserved cleanup of refused Connect is a no-op"
        );
        assert_eq!(room.commands.room_version, version);
        let effects = room.handle(Command::Disconnect { conn: 2 });
        assert!(effects.changed && room.bump_room_version(true));
        assert!(
            room.require_room_control(false, false).is_err(),
            "released lease does not replenish spent revisions"
        );
    }

    #[test]
    fn recovery_connections_account_for_their_own_cleanup_and_restore_entry() {
        let (mut room, _rx) = active();
        let profile = ResourceProfile::table::<mighty::Mighty>(&room.settings).unwrap();
        let finish = Room::<mighty::Mighty>::normal_revision_steps(&room.hand, profile).unwrap();
        room.commands.room_version = MAX_COMMAND_SEQUENCE - finish as u64 - 2;
        let (tx, _rx2) = crate::outbound::Pool::new(Default::default()).unwrap().channel();
        assert!(!room.handle(Command::Connect { conn: 2, tx }).changed);
        assert!(!room.seating.conns.contains_key(&2));
        assert!(room.admit_restore(4 << 20).is_err());
        room.commands.room_version -= 4;
        assert!(room.admit_restore(4 << 20).is_ok());
    }
}
