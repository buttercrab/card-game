//! Private per-actor sequence fences and bounded exact receipts.
use super::{ConnId, Msg, Room};
use crate::command_protocol::{
    CommandDomain, CommandOutcome, CommandReceipt, CommandRejection, CommandScope, CommandWindow, MAX_COMMAND_SEQUENCE,
    ReceiptDurability, ReceiptUnavailable,
};
use crate::game::ServerGame;
use crate::protocol::{ErrorCode, RoomAction, ServerError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, VecDeque};

const MAX_ACTORS: usize = 1024;
const RETAINED_RECEIPTS: usize = 32;

/// Transaction shape is part of command identity, not a game action variant.
enum ScopedCommand {
    Game(Value),
    Batch(Vec<Value>),
    Room(RoomAction),
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct CommandState {
    pub epoch: String,
    pub version: u64,
    #[serde(default)]
    pub room_version: u64,
    actors: BTreeMap<String, ActorCommands>,
}

impl Default for CommandState {
    fn default() -> Self {
        Self {
            epoch: format!("{:032x}", rand::random::<u128>()),
            version: 0,
            room_version: 0,
            actors: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct ActorCommands {
    high_water: u64,
    receipts: VecDeque<StoredReceipt>,
}

#[derive(Clone, Serialize, Deserialize)]
struct StoredReceipt {
    operation_id: String,
    sequence: u64,
    digest: Option<String>,
    #[serde(default)]
    digest_version: u8,
    scope: CommandScope,
    outcome: CommandOutcome,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_:./".contains(&c))
}

fn valid_operation_id(id: &str, sequence: u64) -> bool {
    let prefix = format!("{sequence}:");
    valid_id(id) && id.starts_with(&prefix) && id.len() > prefix.len()
}

fn valid_scoped_operation(id: &str, sequence: u64, expected: &CommandScope) -> bool {
    valid_operation_id(id, sequence)
        && sequence > 0
        && sequence <= MAX_COMMAND_SEQUENCE
        && expected.version <= MAX_COMMAND_SEQUENCE
        && valid_id(&expected.room_id)
        && expected.room_epoch.len() == 32
        && expected.room_epoch.bytes().all(|c| c.is_ascii_hexdigit())
        && valid_id(&expected.actor_id)
}

fn legacy_digest(expected: &CommandScope, action: &Value) -> String {
    // Preserve struct declaration field order used by the original tuple serialization.
    #[derive(Serialize)]
    struct LegacyScope<'a> {
        room_id: &'a str,
        room_epoch: &'a str,
        session_id: u32,
        hand: u32,
        version: u64,
        seat: Option<usize>,
        actor_id: &'a str,
    }
    let scope = LegacyScope {
        room_id: &expected.room_id,
        room_epoch: &expected.room_epoch,
        session_id: expected.session_id,
        hand: expected.hand,
        version: expected.version,
        seat: expected.seat,
        actor_id: &expected.actor_id,
    };
    crate::stats::hex(&Sha256::digest(
        serde_json::to_vec(&(scope, action)).expect("wire serializes"),
    ))
}

impl CommandState {
    /// Closed receipt/schema ceiling, independent of retained public history.
    /// Each actor uses <=128 key bytes and <=32 receipts of <=1024 bytes;
    /// 34MiB also covers array/map syntax, high-water counters and envelope.
    pub(super) fn resource_control_bytes(&self, version: u64) -> Result<usize, crate::resource_budget::BudgetError> {
        use crate::resource_budget::{BudgetError, Resource, serialized_size_capped};
        // A room receipt is staged before settle increments the public counter.
        // This pure shape certificate may inspect that single pending successor;
        // restore validation still uses the exact persisted checkpoint counter.
        self.validate_at_versions(version, self.room_version.saturating_add(1).min(MAX_COMMAND_SEQUENCE))
            .map_err(|_| BudgetError::InvalidProfile)?;
        for ledger in self.actors.values() {
            for receipt in &ledger.receipts {
                if !valid_scoped_operation(&receipt.operation_id, receipt.sequence, &receipt.scope) {
                    return Err(BudgetError::InvalidProfile);
                }
                serialized_size_capped(receipt, Resource::Snapshot, 1024)?;
            }
        }
        serialized_size_capped(
            &self.snapshot_ref(version),
            Resource::Snapshot,
            super::resources::COMMAND_CONTROL_BYTES,
        )
    }

    pub(super) fn snapshot_ref(&self, version: u64) -> impl Serialize + '_ {
        self.snapshot_ref_at(version, self.room_version)
    }

    pub(super) fn snapshot_ref_at(&self, version: u64, room_version: u64) -> impl Serialize + '_ {
        #[derive(Serialize)]
        struct Saved<'a> {
            epoch: &'a str,
            version: u64,
            room_version: u64,
            actors: &'a BTreeMap<String, ActorCommands>,
        }
        Saved {
            epoch: &self.epoch,
            version,
            room_version,
            actors: &self.actors,
        }
    }

    pub(super) fn ledger_revision(&self) -> u64 {
        self.actors.values().map(|actor| actor.high_water).sum()
    }

    pub fn validate_room(&self, room_id: &str, seats: usize) -> Result<(), String> {
        self.validate()?;
        for actor in self.actors.values() {
            for receipt in &actor.receipts {
                if let CommandOutcome::Accepted { version } = receipt.outcome
                    && (receipt.scope.room_id != room_id
                        || receipt.scope.seat.is_some_and(|seat| seat >= seats)
                        || receipt.scope.domain == CommandDomain::Game && receipt.scope.seat.is_none()
                        || receipt.scope.version.checked_add(1) != Some(version))
                {
                    return Err("accepted receipt disagrees with room checkpoint".into());
                }
            }
        }
        Ok(())
    }

    pub fn validate(&self) -> Result<(), String> {
        self.validate_at_version(self.version)
    }

    fn validate_at_version(&self, game_version: u64) -> Result<(), String> {
        self.validate_at_versions(game_version, self.room_version)
    }

    fn validate_at_versions(&self, game_version: u64, room_version: u64) -> Result<(), String> {
        if self.epoch.len() != 32
            || !self.epoch.bytes().all(|c| c.is_ascii_hexdigit())
            || game_version > MAX_COMMAND_SEQUENCE
            || self.room_version > MAX_COMMAND_SEQUENCE
            || self.actors.len() > MAX_ACTORS
        {
            return Err("invalid command checkpoint".into());
        }
        for (actor, ledger) in &self.actors {
            if !valid_id(actor) || ledger.high_water > MAX_COMMAND_SEQUENCE || ledger.receipts.len() > RETAINED_RECEIPTS
            {
                return Err("invalid command actor ledger".into());
            }
            let mut last = 0;
            for receipt in &ledger.receipts {
                if !valid_operation_id(&receipt.operation_id, receipt.sequence)
                    || receipt.digest_version > 2
                    || receipt.digest_version == 2 && receipt.scope.domain != CommandDomain::Game
                    || receipt.digest_version == 0 && receipt.scope.domain != CommandDomain::Game
                    || receipt.sequence <= last
                    || receipt.sequence > ledger.high_water
                    || receipt.scope.actor_id != *actor
                    || receipt.scope.room_epoch.len() != 32
                    || !receipt.scope.room_epoch.bytes().all(|c| c.is_ascii_hexdigit())
                    || matches!(receipt.outcome, CommandOutcome::Accepted { .. })
                        && receipt.scope.room_epoch != self.epoch
                    || match (&receipt.outcome, &receipt.digest) {
                        (
                            CommandOutcome::Rejected {
                                reason: CommandRejection::Cancelled,
                                ..
                            },
                            None,
                        ) => false,
                        (
                            CommandOutcome::Rejected {
                                reason: CommandRejection::Cancelled,
                                ..
                            },
                            Some(_),
                        ) => true,
                        (_, Some(digest)) => digest.len() != 64 || !digest.bytes().all(|c| c.is_ascii_hexdigit()),
                        (_, None) => true,
                    }
                    || matches!(receipt.outcome, CommandOutcome::Unavailable { .. })
                    || matches!(receipt.outcome, CommandOutcome::Accepted { version } if version > match receipt.scope.domain { CommandDomain::Game => game_version, CommandDomain::Room => room_version })
                {
                    return Err("invalid command receipt checkpoint".into());
                }
                last = receipt.sequence;
            }
            if ledger.high_water > 0 && last != ledger.high_water {
                return Err("missing command high-water receipt".into());
            }
        }
        Ok(())
    }
}

impl<G: ServerGame> Room<G> {
    fn command_actor(&self, conn: ConnId) -> Option<String> {
        self.seating
            .seat_of(conn)
            .map(|seat| self.member(seat).id)
            .or_else(|| self.visitor_id(conn))
    }

    pub(super) fn command_scope(&self, seat: usize) -> CommandScope {
        CommandScope {
            domain: CommandDomain::Game,
            room_id: self.id.clone(),
            room_epoch: self.commands.epoch.clone(),
            session_id: self.lifecycle.id,
            hand: self.hand.number,
            version: self.hand.version,
            seat: Some(seat),
            actor_id: self.member(seat).id,
        }
    }

    pub(super) fn command_window(&self, seat: usize) -> Option<CommandWindow> {
        if !self.hand.in_hand() || self.hand.version >= MAX_COMMAND_SEQUENCE {
            return None;
        }
        let scope = self.command_scope(seat);
        let high_water = self
            .commands
            .actors
            .get(&scope.actor_id)
            .map_or(0, |actor| actor.high_water);
        (high_water < MAX_COMMAND_SEQUENCE).then_some(CommandWindow {
            scope,
            next_sequence: high_water + 1,
        })
    }

    pub(super) fn room_command_scope(&self, conn: ConnId) -> Option<CommandScope> {
        Some(CommandScope {
            domain: CommandDomain::Room,
            room_id: self.id.clone(),
            room_epoch: self.commands.epoch.clone(),
            session_id: self.lifecycle.id,
            hand: self.hand.number,
            version: self.commands.room_version,
            seat: self.seating.seat_of(conn),
            actor_id: self.command_actor(conn)?,
        })
    }

    pub(super) fn room_command_window(&self, conn: ConnId) -> Option<CommandWindow> {
        let scope = self.room_command_scope(conn)?;
        let high_water = self
            .commands
            .actors
            .get(&scope.actor_id)
            .map_or(0, |actor| actor.high_water);
        (self.commands.room_version < MAX_COMMAND_SEQUENCE && high_water < MAX_COMMAND_SEQUENCE).then_some(
            CommandWindow {
                scope,
                next_sequence: high_water + 1,
            },
        )
    }

    fn command_receipt(
        &self,
        conn: ConnId,
        id: &str,
        sequence: u64,
        scope: Option<CommandScope>,
        outcome: CommandOutcome,
    ) {
        self.send(
            conn,
            &Msg::<G>::OperationReceipt(CommandReceipt {
                operation_id: id.to_owned(),
                sequence,
                scope,
                outcome,
                durability: if self.persister.is_some() {
                    ReceiptDurability::Persisted
                } else {
                    ReceiptDurability::Memory
                },
            }),
        );
    }

    fn stored_receipt(&self, conn: ConnId, receipt: &StoredReceipt) {
        self.command_receipt(
            conn,
            &receipt.operation_id,
            receipt.sequence,
            Some(receipt.scope.clone()),
            receipt.outcome.clone(),
        );
    }

    pub(super) fn submit_command(
        &mut self,
        conn: ConnId,
        id: String,
        sequence: u64,
        expected: CommandScope,
        action: Value,
    ) -> Result<(), ServerError> {
        self.submit_scoped(conn, id, sequence, expected, ScopedCommand::Game(action))
    }

    pub(super) fn submit_batch_command(
        &mut self,
        conn: ConnId,
        id: String,
        sequence: u64,
        expected: CommandScope,
        actions: Vec<Value>,
    ) -> Result<(), ServerError> {
        self.submit_scoped(conn, id, sequence, expected, ScopedCommand::Batch(actions))
    }

    pub(super) fn submit_room_command(
        &mut self,
        conn: ConnId,
        id: String,
        sequence: u64,
        expected: CommandScope,
        action: RoomAction,
    ) -> Result<(), ServerError> {
        self.submit_scoped(conn, id, sequence, expected, ScopedCommand::Room(action))
    }

    fn submit_scoped(
        &mut self,
        conn: ConnId,
        id: String,
        sequence: u64,
        expected: CommandScope,
        command: ScopedCommand,
    ) -> Result<(), ServerError> {
        let room_command = matches!(&command, ScopedCommand::Room(_));
        let batch = matches!(&command, ScopedCommand::Batch(_));
        let action = match &command {
            ScopedCommand::Game(action) => action.clone(),
            ScopedCommand::Batch(actions) => serde_json::to_value(actions).expect("actions serialize"),
            ScopedCommand::Room(action) => serde_json::to_value(action).expect("room action serializes"),
        };
        if !valid_scoped_operation(&id, sequence, &expected) {
            return Err(ServerError::with_detail(
                ErrorCode::IllegalAction,
                "invalid scoped operation",
            ));
        }
        let rejected = |reason, error| CommandOutcome::Rejected { reason, error };
        let Some(actor) = self.command_actor(conn) else {
            self.command_receipt(
                conn,
                &id,
                sequence,
                None,
                rejected(CommandRejection::ActorMismatch, None),
            );
            return Ok(());
        };
        if expected.actor_id != actor {
            self.command_receipt(
                conn,
                &id,
                sequence,
                None,
                rejected(CommandRejection::ActorMismatch, None),
            );
            return Ok(());
        }
        let digest = crate::stats::hex(&Sha256::digest(if batch {
            // Three tuple members cannot collide with legacy single/room
            // command digests, even if a game action itself is an array.
            serde_json::to_vec(&(&expected, "batch", &action)).expect("wire serializes")
        } else {
            serde_json::to_vec(&(&expected, &action)).expect("wire serializes")
        }));
        if let Some(ledger) = self.commands.actors.get(&actor) {
            if sequence <= ledger.high_water {
                if let Some(old) = ledger.receipts.iter().find(|old| old.sequence == sequence) {
                    if old.operation_id == id
                        && (old.digest.as_ref()
                            == Some(
                                &if old.digest_version == 0 && expected.domain == CommandDomain::Game && !batch {
                                    legacy_digest(&expected, &action)
                                } else {
                                    digest.clone()
                                },
                            )
                            || matches!(
                                old.outcome,
                                CommandOutcome::Rejected {
                                    reason: CommandRejection::Cancelled,
                                    ..
                                }
                            ))
                    {
                        self.stored_receipt(conn, old);
                    } else {
                        self.command_receipt(
                            conn,
                            &id,
                            sequence,
                            None,
                            rejected(CommandRejection::SequenceConflict, None),
                        );
                    }
                } else {
                    self.command_receipt(
                        conn,
                        &id,
                        sequence,
                        None,
                        CommandOutcome::Unavailable {
                            reason: ReceiptUnavailable::Pruned,
                        },
                    );
                }
                return Ok(());
            }
            if sequence != ledger.high_water + 1 {
                self.command_receipt(conn, &id, sequence, None, rejected(CommandRejection::SequenceGap, None));
                return Ok(());
            }
        } else if sequence != 1 {
            self.command_receipt(conn, &id, sequence, None, rejected(CommandRejection::SequenceGap, None));
            return Ok(());
        } else if self.commands.actors.len() >= MAX_ACTORS {
            self.command_receipt(conn, &id, sequence, None, rejected(CommandRejection::Capacity, None));
            return Ok(());
        }
        // Cached reads above do not spend a revision. A new rejected receipt
        // does; it must not borrow the protected normal-finish/cleanup runway.
        // A valid game move is checked against its exact post-log candidate.
        let valid_game = !room_command
            && self.hand.in_hand()
            && self
                .seating
                .seat_of(conn)
                .is_some_and(|seat| expected == self.command_scope(seat));
        if (room_command && self.require_room_control(true, false).is_err())
            || (!valid_game && self.require_room_control(false, false).is_err())
        {
            self.command_receipt(conn, &id, sequence, None, rejected(CommandRejection::Capacity, None));
            return Ok(());
        }
        // Reconnecting observers may read receipts, but never reserve/consume a
        // player's next sequence without their current authenticated seat.
        let seat = self.seating.seat_of(conn);
        if !room_command && seat.is_none() {
            self.command_receipt(
                conn,
                &id,
                sequence,
                None,
                rejected(CommandRejection::ActorMismatch, None),
            );
            return Ok(());
        };
        let outcome = if let ScopedCommand::Room(room_action) = command {
            if expected.domain != CommandDomain::Room
                || self.room_command_scope(conn).as_ref() != Some(&expected)
                || self.commands.room_version >= MAX_COMMAND_SEQUENCE
            {
                rejected(CommandRejection::StaleScope, None)
            } else {
                match self.apply_room_action(conn, room_action) {
                    Ok(()) => CommandOutcome::Accepted {
                        version: self.commands.room_version + 1,
                    },
                    Err(error) => rejected(CommandRejection::Rule, Some(error.code)),
                }
            }
        } else if !self.hand.in_hand()
            || self.hand.version >= MAX_COMMAND_SEQUENCE
            || expected != self.command_scope(seat.expect("authenticated seat"))
        {
            rejected(CommandRejection::StaleScope, None)
        } else {
            let result = match command {
                ScopedCommand::Game(action) => self.act(seat.expect("authenticated seat"), action),
                ScopedCommand::Batch(actions) => self.act_batch(seat.expect("authenticated seat"), actions),
                ScopedCommand::Room(_) => unreachable!("room command handled above"),
            };
            match result {
                Ok(()) => CommandOutcome::Accepted {
                    version: expected.version + 1,
                },
                Err(error) => rejected(CommandRejection::Rule, Some(error.code)),
            }
        };
        if !matches!(outcome, CommandOutcome::Accepted { .. }) && self.require_room_control(false, false).is_err() {
            self.command_receipt(conn, &id, sequence, None, rejected(CommandRejection::Capacity, None));
            return Ok(());
        }
        let receipt = StoredReceipt {
            operation_id: id,
            sequence,
            digest: Some(digest),
            digest_version: if batch { 2 } else { 1 },
            scope: expected,
            outcome,
        };
        let ledger = self.commands.actors.entry(actor).or_default();
        ledger.high_water = sequence;
        ledger.receipts.push_back(receipt.clone());
        while ledger.receipts.len() > RETAINED_RECEIPTS {
            ledger.receipts.pop_front();
        }
        self.stored_receipt(conn, &receipt);
        Ok(())
    }

    /// Close an uncertain operation without replaying an action. Authentication and
    /// room epoch are checked before consulting or reserving an actor sequence.
    pub(super) fn cancel_operation(
        &mut self,
        conn: ConnId,
        id: String,
        sequence: u64,
        expected: CommandScope,
    ) -> Result<(), ServerError> {
        if !valid_scoped_operation(&id, sequence, &expected) {
            return Err(ServerError::with_detail(
                ErrorCode::IllegalAction,
                "invalid scoped cancellation",
            ));
        }
        let reject = |reason| CommandOutcome::Rejected { reason, error: None };
        let Some(actor) = self.command_actor(conn).filter(|actor| *actor == expected.actor_id) else {
            self.command_receipt(conn, &id, sequence, None, reject(CommandRejection::ActorMismatch));
            return Ok(());
        };
        if expected.room_id != self.id || expected.room_epoch != self.commands.epoch {
            self.command_receipt(conn, &id, sequence, None, reject(CommandRejection::StaleScope));
            return Ok(());
        }
        if let Some(ledger) = self.commands.actors.get(&actor) {
            if sequence <= ledger.high_water {
                if let Some(old) = ledger.receipts.iter().find(|old| old.sequence == sequence) {
                    if old.operation_id == id {
                        self.stored_receipt(conn, old);
                    } else {
                        self.command_receipt(conn, &id, sequence, None, reject(CommandRejection::SequenceConflict));
                    }
                } else {
                    self.command_receipt(
                        conn,
                        &id,
                        sequence,
                        None,
                        CommandOutcome::Unavailable {
                            reason: ReceiptUnavailable::Pruned,
                        },
                    );
                }
                return Ok(());
            }
            if sequence != ledger.high_water + 1 {
                self.command_receipt(conn, &id, sequence, None, reject(CommandRejection::SequenceGap));
                return Ok(());
            }
        } else if sequence != 1 {
            self.command_receipt(conn, &id, sequence, None, reject(CommandRejection::SequenceGap));
            return Ok(());
        } else if self.commands.actors.len() >= MAX_ACTORS {
            self.command_receipt(conn, &id, sequence, None, reject(CommandRejection::Capacity));
            return Ok(());
        }
        if self.require_room_control(false, false).is_err() {
            self.command_receipt(conn, &id, sequence, None, reject(CommandRejection::Capacity));
            return Ok(());
        }
        // Seat/session/hand may have changed during recovery. Only the current
        // authenticated actor in this room epoch can fence their own next sequence.
        let receipt = StoredReceipt {
            operation_id: id,
            sequence,
            digest: None,
            digest_version: 1,
            scope: expected,
            outcome: reject(CommandRejection::Cancelled),
        };
        let ledger = self.commands.actors.entry(actor).or_default();
        ledger.high_water = sequence;
        ledger.receipts.push_back(receipt.clone());
        while ledger.receipts.len() > RETAINED_RECEIPTS {
            ledger.receipts.pop_front();
        }
        self.stored_receipt(conn, &receipt);
        Ok(())
    }

    pub(super) fn query_operation(&self, conn: ConnId, id: String, sequence: u64) -> Result<(), ServerError> {
        if !valid_operation_id(&id, sequence) || sequence == 0 || sequence > MAX_COMMAND_SEQUENCE {
            return Err(ServerError::with_detail(
                ErrorCode::IllegalAction,
                "invalid operation query",
            ));
        }
        if let Some(ledger) = self
            .command_actor(conn)
            .and_then(|actor| self.commands.actors.get(&actor))
        {
            if let Some(receipt) = ledger
                .receipts
                .iter()
                .find(|receipt| receipt.sequence == sequence && receipt.operation_id == id)
            {
                self.stored_receipt(conn, receipt);
                return Ok(());
            }
            if sequence <= ledger.high_water && !ledger.receipts.iter().any(|receipt| receipt.sequence == sequence) {
                self.command_receipt(
                    conn,
                    &id,
                    sequence,
                    None,
                    CommandOutcome::Unavailable {
                        reason: ReceiptUnavailable::Pruned,
                    },
                );
                return Ok(());
            }
        }
        self.command_receipt(
            conn,
            &id,
            sequence,
            None,
            CommandOutcome::Unavailable {
                reason: ReceiptUnavailable::Unknown,
            },
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::{RoomEnv, seating::Conn};
    use super::*;
    use crate::protocol::ClientMsg;
    use engine::{Game, Turn};
    use mighty::{Mighty, table::MightySettings};
    use serde_json::json;
    use std::{sync::Arc, time::Duration};

    #[test]
    fn control_measurement_uses_authoritative_live_game_fence_without_cloning_ledger() {
        let (mut room, _receivers) = fixture();
        let Turn::Seat(seat) = room.hand.turn().unwrap() else {
            panic!("decision")
        };
        let action = Mighty::legal_actions(room.hand.game.as_ref().unwrap(), seat)
            .into_iter()
            .find(|action| !matches!(action, mighty::Action::Misdeal))
            .unwrap();
        let expected = room.command_scope(seat);
        room.submit_test(
            seat as u64 + 1,
            "control-fence".into(),
            1,
            expected,
            serde_json::to_value(action).unwrap(),
        )
        .unwrap();
        assert!(room.hand.version > room.commands.version);
        assert!(room.commands.resource_control_bytes(room.hand.version).is_ok());
        assert!(room.commands.resource_control_bytes(0).is_err());
    }

    #[test]
    fn maximal_canonical_command_checkpoint_fits_closed_control_ceiling() {
        let mut state = CommandState {
            version: MAX_COMMAND_SEQUENCE,
            room_version: MAX_COMMAND_SEQUENCE,
            ..CommandState::default()
        };
        for index in 0..MAX_ACTORS {
            let actor = format!("{index:0128}");
            let mut ledger = ActorCommands {
                high_water: MAX_COMMAND_SEQUENCE,
                ..ActorCommands::default()
            };
            for sequence in MAX_COMMAND_SEQUENCE - RETAINED_RECEIPTS as u64 + 1..=MAX_COMMAND_SEQUENCE {
                let prefix = format!("{sequence}:");
                ledger.receipts.push_back(StoredReceipt {
                    operation_id: format!("{prefix}{}", "x".repeat(128 - prefix.len())),
                    sequence,
                    digest: Some("f".repeat(64)),
                    digest_version: 1,
                    scope: CommandScope {
                        domain: CommandDomain::Room,
                        room_id: "r".repeat(128),
                        room_epoch: state.epoch.clone(),
                        session_id: u32::MAX,
                        hand: u32::MAX,
                        version: MAX_COMMAND_SEQUENCE,
                        seat: Some(usize::MAX),
                        actor_id: actor.clone(),
                    },
                    outcome: CommandOutcome::Rejected {
                        reason: CommandRejection::StaleScope,
                        error: Some(ErrorCode::StorageUnavailable),
                    },
                });
            }
            state.actors.insert(actor, ledger);
        }
        assert!(
            state.resource_control_bytes(MAX_COMMAND_SEQUENCE).unwrap()
                < super::super::resources::COMMAND_CONTROL_BYTES
        );
        state.actors.values_mut().next().unwrap().receipts[0].scope.room_id = "x".repeat(129);
        assert!(
            state.resource_control_bytes(MAX_COMMAND_SEQUENCE).is_err(),
            "oversized legacy scope is not a capacity certificate"
        );
    }

    impl Room<Mighty> {
        fn submit_test(
            &mut self,
            conn: ConnId,
            nonce: String,
            sequence: u64,
            expected: CommandScope,
            action: Value,
        ) -> Result<(), ServerError> {
            self.submit_command(conn, format!("{sequence}:{nonce}"), sequence, expected, action)
        }
        fn query_test(&self, conn: ConnId, nonce: String, sequence: u64) -> Result<(), ServerError> {
            self.query_operation(conn, format!("{sequence}:{nonce}"), sequence)
        }
    }

    fn fixture() -> (Room<Mighty>, Vec<crate::outbound::Receiver>) {
        let mut room = Room::new(
            "test".into(),
            MightySettings::default(),
            Arc::new(RoomEnv::new(Duration::ZERO)),
            super::super::mighty_bots(),
        );
        let mut receivers = Vec::new();
        for seat in 0..5 {
            let conn = seat as u64 + 1;
            let (tx, rx) = crate::outbound::test_channel();
            room.seating.conns.insert(conn, Conn::new(tx));
            room.on_message(
                conn,
                ClientMsg::Join {
                    name: format!("P{seat}"),
                    token: None,
                    seat: Some(seat),
                    device: None,
                    reclaim: false,
                },
            )
            .unwrap();
            room.on_message(conn, ClientMsg::Ready { ready: true }).unwrap();
            receivers.push(rx);
        }
        room.on_message(1, ClientMsg::Start).unwrap();
        room.hand.advance(&room.id, &mut room.rng);
        room.hand.dealt_at = None;
        (room, receivers)
    }

    fn opportunity(room: &Room<Mighty>) -> (usize, CommandScope, Value) {
        let Some(Turn::Seat(seat)) = room.hand.turn() else {
            panic!("bidding")
        };
        let action = Mighty::legal_actions(room.hand.game.as_ref().unwrap(), seat)
            .into_iter()
            .find(|action| !matches!(action, mighty::Action::Misdeal))
            .unwrap();
        (seat, room.command_scope(seat), serde_json::to_value(action).unwrap())
    }

    fn receipt(rx: &mut crate::outbound::Receiver) -> CommandReceipt {
        let mut result = None;
        while let Ok(text) = rx.try_recv() {
            let value: Value = serde_json::from_str(&text).unwrap();
            if value["type"] == "operation_receipt" {
                result = Some(serde_json::from_value(value).unwrap());
            }
        }
        result.expect("private operation receipt")
    }

    #[test]
    fn exact_duplicates_replay_receipts_without_applying_again_and_conflicts_do_not_execute() {
        let (mut room, mut clients) = fixture();
        let (seat, expected, action) = opportunity(&room);
        room.submit_test(seat as u64 + 1, "first".into(), 1, expected.clone(), action.clone())
            .unwrap();
        let original = receipt(&mut clients[seat]);
        assert!(matches!(original.outcome, CommandOutcome::Accepted { .. }));
        assert_eq!(original.durability, ReceiptDurability::Memory);
        let version = room.hand.version;
        let log_length = room.hand.log.len();
        room.submit_test(seat as u64 + 1, "first".into(), 1, expected.clone(), action)
            .unwrap();
        assert_eq!(receipt(&mut clients[seat]), original);
        room.submit_test(seat as u64 + 1, "second".into(), 1, expected, json!("Pass"))
            .unwrap();
        assert!(matches!(
            receipt(&mut clients[seat]).outcome,
            CommandOutcome::Rejected {
                reason: CommandRejection::SequenceConflict,
                ..
            }
        ));
        assert_eq!(room.hand.version, version);
        assert_eq!(room.hand.log.len(), log_length);
    }

    #[test]
    fn every_scope_dimension_is_fenced_and_rejections_consume_only_the_next_sequence() {
        let (mut room, mut clients) = fixture();
        let (seat, expected, action) = opportunity(&room);
        let mut variants = vec![];
        let mut old = expected.clone();
        old.version += 1;
        variants.push(old);
        let mut old = expected.clone();
        old.hand += 1;
        variants.push(old);
        let mut old = expected.clone();
        old.session_id += 1;
        variants.push(old);
        let mut old = expected.clone();
        old.seat = Some((seat + 1) % 5);
        variants.push(old);
        let mut old = expected.clone();
        old.room_id = "foreign".into();
        variants.push(old);
        let mut old = expected.clone();
        old.room_epoch = "f".repeat(32);
        variants.push(old);
        let before = room.hand.log.len();
        for (index, old) in variants.into_iter().enumerate() {
            room.submit_test(
                seat as u64 + 1,
                format!("stale-{index}"),
                index as u64 + 1,
                old,
                action.clone(),
            )
            .unwrap();
            assert!(matches!(
                receipt(&mut clients[seat]).outcome,
                CommandOutcome::Rejected {
                    reason: CommandRejection::StaleScope,
                    ..
                }
            ));
        }
        assert_eq!(room.hand.log.len(), before);
        assert_eq!(room.command_window(seat).unwrap().next_sequence, 7);
        let mut foreign = expected.clone();
        foreign.actor_id = "other-actor".into();
        room.submit_test(seat as u64 + 1, "foreign-actor".into(), 7, foreign, action.clone())
            .unwrap();
        assert!(matches!(
            receipt(&mut clients[seat]).outcome,
            CommandOutcome::Rejected {
                reason: CommandRejection::ActorMismatch,
                ..
            }
        ));
        assert_eq!(room.command_window(seat).unwrap().next_sequence, 7);
        room.submit_test(seat as u64 + 1, "gap".into(), 8, expected, action)
            .unwrap();
        assert!(matches!(
            receipt(&mut clients[seat]).outcome,
            CommandOutcome::Rejected {
                reason: CommandRejection::SequenceGap,
                ..
            }
        ));
        assert_eq!(room.command_window(seat).unwrap().next_sequence, 7);
        assert!(room.commands.validate().is_ok());
    }

    #[test]
    fn private_queries_and_restore_keep_actor_fences_and_versions() {
        let (mut room, mut clients) = fixture();
        let (seat, expected, action) = opportunity(&room);
        room.submit_test(seat as u64 + 1, "accepted".into(), 1, expected, action)
            .unwrap();
        let original = receipt(&mut clients[seat]);
        let other = (seat + 1) % 5;
        room.query_test(other as u64 + 1, "accepted".into(), 1).unwrap();
        let foreign = receipt(&mut clients[other]);
        assert_eq!(foreign.scope, None);
        assert!(matches!(
            foreign.outcome,
            CommandOutcome::Unavailable {
                reason: ReceiptUnavailable::Unknown
            }
        ));
        let snapshot = serde_json::to_value(room.snapshot()).unwrap();
        let mut restored =
            Room::<Mighty>::restore(snapshot.clone(), room.env.clone(), super::super::mighty_bots()).unwrap();
        assert_eq!(restored.hand.version, room.hand.version);
        assert_eq!(restored.commands.epoch, room.commands.epoch);
        assert_eq!(restored.command_window(seat).unwrap().next_sequence, 2);
        let (tx, mut rx) = crate::outbound::test_channel();
        restored.seating.conns.insert(99, Conn::new(tx));
        let token = snapshot["seats"][seat]["token"].as_str().unwrap().to_owned();
        restored
            .on_message(
                99,
                ClientMsg::Join {
                    name: "Restored".into(),
                    token: Some(token),
                    seat: None,
                    device: None,
                    reclaim: true,
                },
            )
            .unwrap();
        restored.query_test(99, "accepted".into(), 1).unwrap();
        assert_eq!(receipt(&mut rx), original);
        assert!(restored.report().get("commands").is_none());
        let mut old = snapshot;
        old.as_object_mut().unwrap().remove("commands");
        let migrated = Room::<Mighty>::restore(old, room.env.clone(), super::super::mighty_bots()).unwrap();
        assert_ne!(migrated.commands.epoch, room.commands.epoch);
    }

    #[test]
    fn pruning_never_reopens_an_old_sequence_and_snapshot_keeps_the_tombstone() {
        let (mut room, mut clients) = fixture();
        let (seat, expected, _) = opportunity(&room);
        let before = room.hand.version;
        for sequence in 1..=40 {
            room.submit_test(
                seat as u64 + 1,
                format!("illegal-{sequence}"),
                sequence,
                expected.clone(),
                json!({"not":"an action"}),
            )
            .unwrap();
            assert!(matches!(
                receipt(&mut clients[seat]).outcome,
                CommandOutcome::Rejected {
                    reason: CommandRejection::Rule,
                    ..
                }
            ));
        }
        room.submit_test(
            seat as u64 + 1,
            "illegal-1".into(),
            1,
            expected,
            json!({"not":"an action"}),
        )
        .unwrap();
        assert!(matches!(
            receipt(&mut clients[seat]).outcome,
            CommandOutcome::Unavailable {
                reason: ReceiptUnavailable::Pruned
            }
        ));
        assert_eq!(room.hand.version, before);
        assert_eq!(room.command_window(seat).unwrap().next_sequence, 41);
        assert!(
            room.submit_command(
                seat as u64 + 1,
                "1:illegal-1".into(),
                41,
                room.command_scope(seat),
                json!("Pass")
            )
            .is_err()
        );
        assert_eq!(
            room.commands.actors.values().next().unwrap().receipts.len(),
            RETAINED_RECEIPTS
        );
        assert!(room.commands.validate().is_ok());
        let restored = Room::<Mighty>::restore(
            serde_json::to_value(room.snapshot()).unwrap(),
            room.env.clone(),
            super::super::mighty_bots(),
        )
        .unwrap();
        assert_eq!(restored.command_window(seat).unwrap().next_sequence, 41);
    }

    #[test]
    fn seat_loss_keeps_private_query_authority_but_cannot_consume_a_new_sequence() {
        let (mut room, mut clients) = fixture();
        let (seat, expected, action) = opportunity(&room);
        let conn = seat as u64 + 1;
        room.on_message(
            conn,
            ClientMsg::Observe {
                name: "Returning".into(),
                token: None,
            },
        )
        .unwrap();
        assert_eq!(room.command_actor(conn), Some(expected.actor_id.clone()));
        room.submit_test(conn, "before-leave".into(), 1, expected.clone(), action.clone())
            .unwrap();
        let accepted = receipt(&mut clients[seat]);
        room.on_message(conn, ClientMsg::Leave).unwrap();
        room.query_test(conn, "before-leave".into(), 1).unwrap();
        assert_eq!(receipt(&mut clients[seat]), accepted);
        room.submit_test(conn, "after-leave".into(), 2, expected.clone(), action)
            .unwrap();
        assert!(matches!(
            receipt(&mut clients[seat]).outcome,
            CommandOutcome::Rejected {
                reason: CommandRejection::ActorMismatch,
                ..
            }
        ));
        assert_eq!(room.commands.actors[&expected.actor_id].high_water, 1);
    }

    #[test]
    fn capacity_and_malformed_identity_reject_before_game_mutation() {
        let (mut room, mut clients) = fixture();
        let (seat, expected, action) = opportunity(&room);
        let before = room.hand.version;
        assert!(
            room.submit_test(seat as u64 + 1, "x".repeat(129), 1, expected.clone(), action.clone())
                .is_err()
        );
        assert!(
            room.submit_test(
                seat as u64 + 1,
                "bad-sequence".into(),
                MAX_COMMAND_SEQUENCE + 1,
                expected.clone(),
                action.clone()
            )
            .is_err()
        );
        for index in 0..MAX_ACTORS {
            room.commands
                .actors
                .insert(format!("retained-{index}"), ActorCommands::default());
        }
        room.submit_test(seat as u64 + 1, "full".into(), 1, expected, action)
            .unwrap();
        assert!(matches!(
            receipt(&mut clients[seat]).outcome,
            CommandOutcome::Rejected {
                reason: CommandRejection::Capacity,
                ..
            }
        ));
        assert_eq!(room.hand.version, before);
        assert_eq!(room.commands.actors.len(), MAX_ACTORS);
    }

    fn cancel(room: &mut Room<Mighty>, conn: ConnId, id: &str, sequence: u64, expected: CommandScope) {
        room.on_message(
            conn,
            ClientMsg::CancelOperation {
                operation_id: format!("{sequence}:{id}"),
                sequence,
                expected,
            },
        )
        .unwrap();
    }

    #[test]
    fn cancellation_fences_late_submit_without_executing_and_replays_exact_receipt() {
        let (mut room, mut clients) = fixture();
        let (seat, expected, action) = opportunity(&room);
        let conn = seat as u64 + 1;
        let version = room.hand.version;
        let log = room.hand.log.len();
        cancel(&mut room, conn, "cancelled", 1, expected.clone());
        let original = receipt(&mut clients[seat]);
        assert!(matches!(
            original.outcome,
            CommandOutcome::Rejected {
                reason: CommandRejection::Cancelled,
                error: None
            }
        ));
        assert!(room.commands.actors[&expected.actor_id].receipts[0].digest.is_none());
        room.submit_test(conn, "cancelled".into(), 1, expected.clone(), action)
            .unwrap();
        assert_eq!(receipt(&mut clients[seat]), original);
        // The original unknown action payload/scope is not needed to fence the ID.
        let mut stale = expected.clone();
        stale.hand += 1;
        room.submit_test(conn, "cancelled".into(), 1, stale, json!({"different": "payload"}))
            .unwrap();
        assert_eq!(receipt(&mut clients[seat]), original);
        assert_eq!(room.hand.version, version);
        assert_eq!(room.hand.log.len(), log);
        cancel(&mut room, conn, "different", 1, expected.clone());
        assert!(matches!(
            receipt(&mut clients[seat]).outcome,
            CommandOutcome::Rejected {
                reason: CommandRejection::SequenceConflict,
                ..
            }
        ));
        cancel(&mut room, conn, "gap", 3, expected.clone());
        assert!(matches!(
            receipt(&mut clients[seat]).outcome,
            CommandOutcome::Rejected {
                reason: CommandRejection::SequenceGap,
                ..
            }
        ));
        assert_eq!(room.command_window(seat).unwrap().next_sequence, 2);
    }

    #[test]
    fn already_accepted_cancellation_returns_original_acceptance() {
        let (mut room, mut clients) = fixture();
        let (seat, expected, action) = opportunity(&room);
        let conn = seat as u64 + 1;
        room.submit_test(conn, "accepted".into(), 1, expected.clone(), action)
            .unwrap();
        let original = receipt(&mut clients[seat]);
        assert!(matches!(original.outcome, CommandOutcome::Accepted { .. }));
        cancel(&mut room, conn, "accepted", 1, expected);
        assert_eq!(receipt(&mut clients[seat]), original);
    }

    #[test]
    fn cancellation_authentication_and_room_epoch_refuse_without_consuming_sequence() {
        let (mut room, mut clients) = fixture();
        let (seat, expected, _) = opportunity(&room);
        let conn = seat as u64 + 1;
        for mutation in 0..3 {
            let mut foreign = expected.clone();
            match mutation {
                0 => foreign.actor_id = "foreign".into(),
                1 => foreign.room_id = "foreign".into(),
                _ => foreign.room_epoch = "f".repeat(32),
            }
            cancel(&mut room, conn, "refused", 1, foreign);
            let reason = if mutation == 0 {
                CommandRejection::ActorMismatch
            } else {
                CommandRejection::StaleScope
            };
            assert!(
                matches!(receipt(&mut clients[seat]).outcome, CommandOutcome::Rejected { reason: actual, .. } if actual == reason)
            );
            assert_eq!(room.command_window(seat).unwrap().next_sequence, 1);
            assert!(room.commands.actors.is_empty());
        }
        assert!(
            room.cancel_operation(conn, "01:noncanonical".into(), 1, expected.clone())
                .is_err()
        );
        assert!(
            room.cancel_operation(conn, "0:zero".into(), 0, expected.clone())
                .is_err()
        );
        assert!(
            room.cancel_operation(conn, format!("1:{}", "x".repeat(129)), 1, expected)
                .is_err()
        );
    }

    #[test]
    fn authenticated_unseated_actor_can_cancel_its_old_scope() {
        let (mut room, mut clients) = fixture();
        let (seat, expected, _) = opportunity(&room);
        let conn = seat as u64 + 1;
        room.on_message(
            conn,
            ClientMsg::Observe {
                name: "Returning".into(),
                token: None,
            },
        )
        .unwrap();
        room.on_message(conn, ClientMsg::Leave).unwrap();
        assert_eq!(room.seating.seat_of(conn), None);
        assert_eq!(room.command_actor(conn), Some(expected.actor_id.clone()));
        cancel(&mut room, conn, "unseated", 1, expected.clone());
        assert!(matches!(
            receipt(&mut clients[seat]).outcome,
            CommandOutcome::Rejected {
                reason: CommandRejection::Cancelled,
                ..
            }
        ));
        assert_eq!(room.commands.actors[&expected.actor_id].high_water, 1);
    }

    #[test]
    fn cancelled_tombstone_survives_restore_and_pruning_never_reopens_sequence() {
        let (mut room, mut clients) = fixture();
        let (seat, expected, action) = opportunity(&room);
        let conn = seat as u64 + 1;
        cancel(&mut room, conn, "restored", 1, expected.clone());
        let original = receipt(&mut clients[seat]);
        let saved = serde_json::to_value(room.snapshot()).unwrap();
        let mut restored =
            Room::<Mighty>::restore(saved.clone(), room.env.clone(), super::super::mighty_bots()).unwrap();
        let token = saved["seats"][seat]["token"].as_str().unwrap().to_owned();
        let (tx, mut rx) = crate::outbound::test_channel();
        restored.seating.conns.insert(99, Conn::new(tx));
        restored
            .on_message(
                99,
                ClientMsg::Join {
                    name: "Restored".into(),
                    token: Some(token),
                    seat: None,
                    device: None,
                    reclaim: true,
                },
            )
            .unwrap();
        restored
            .submit_test(99, "restored".into(), 1, expected.clone(), action)
            .unwrap();
        assert_eq!(receipt(&mut rx), original);
        assert_eq!(restored.command_window(seat).unwrap().next_sequence, 2);
        for sequence in 2..=40 {
            cancel(&mut restored, 99, "pruning", sequence, expected.clone());
        }
        receipt(&mut rx);
        cancel(&mut restored, 99, "restored", 1, expected.clone());
        assert!(matches!(
            receipt(&mut rx).outcome,
            CommandOutcome::Unavailable {
                reason: ReceiptUnavailable::Pruned
            }
        ));
        assert_eq!(restored.commands.actors[&expected.actor_id].high_water, 40);
        assert!(restored.commands.validate().is_ok());
        let mut corrupt = saved;
        corrupt["commands"]["actors"][&expected.actor_id]["receipts"][0]["digest"] = json!("a".repeat(64));
        assert!(Room::<Mighty>::restore(corrupt, room.env.clone(), super::super::mighty_bots()).is_err());
    }

    #[test]
    fn cancellation_capacity_does_not_reserve_an_actor() {
        let (mut room, mut clients) = fixture();
        let (seat, expected, _) = opportunity(&room);
        for index in 0..MAX_ACTORS {
            room.commands
                .actors
                .insert(format!("retained-{index}"), ActorCommands::default());
        }
        cancel(&mut room, seat as u64 + 1, "full", 1, expected.clone());
        assert!(matches!(
            receipt(&mut clients[seat]).outcome,
            CommandOutcome::Rejected {
                reason: CommandRejection::Capacity,
                ..
            }
        ));
        assert!(!room.commands.actors.contains_key(&expected.actor_id));
    }

    #[test]
    fn legacy_scope_digests_and_numeric_seats_replay_after_restore() {
        let (mut room, mut clients) = fixture();
        let (seat, expected, action) = opportunity(&room);
        let conn = seat as u64 + 1;
        room.submit_test(conn, "legacy".into(), 1, expected.clone(), action.clone())
            .unwrap();
        let original = receipt(&mut clients[seat]);
        let mut saved = serde_json::to_value(room.snapshot()).unwrap();
        saved["commands"].as_object_mut().unwrap().remove("room_version");
        let stored = &mut saved["commands"]["actors"][&expected.actor_id]["receipts"][0];
        stored.as_object_mut().unwrap().remove("digest_version");
        stored["scope"].as_object_mut().unwrap().remove("domain");
        // Literal wire field order from before the domain was introduced.
        let old_scope = format!(
            r#"{{"room_id":"{}","room_epoch":"{}","session_id":{},"hand":{},"version":{},"seat":{},"actor_id":"{}"}}"#,
            expected.room_id,
            expected.room_epoch,
            expected.session_id,
            expected.hand,
            expected.version,
            seat,
            expected.actor_id
        );
        let wire = format!("[{},{}]", old_scope, serde_json::to_string(&action).unwrap());
        let digest = crate::stats::hex(&Sha256::digest(wire.as_bytes()));
        assert_eq!(legacy_digest(&expected, &action), digest);
        stored["digest"] = json!(digest);
        let token = saved["seats"][seat]["token"].as_str().unwrap().to_owned();
        let mut restored = Room::<Mighty>::restore(saved, room.env.clone(), super::super::mighty_bots()).unwrap();
        let (tx, mut rx) = crate::outbound::test_channel();
        restored.seating.conns.insert(99, Conn::new(tx));
        restored
            .on_message(
                99,
                ClientMsg::Join {
                    name: "Restored".into(),
                    token: Some(token),
                    seat: None,
                    device: None,
                    reclaim: true,
                },
            )
            .unwrap();
        restored
            .submit_test(99, "legacy".into(), 1, expected.clone(), action)
            .unwrap();
        assert_eq!(receipt(&mut rx), original);
        restored
            .submit_test(99, "legacy".into(), 1, expected, json!({"changed":"payload"}))
            .unwrap();
        assert!(matches!(
            receipt(&mut rx).outcome,
            CommandOutcome::Rejected {
                reason: CommandRejection::SequenceConflict,
                ..
            }
        ));
    }

    #[test]
    fn accepted_game_receipts_survive_end_session_rematch_and_restore() {
        let (mut room, mut clients) = fixture();
        let (seat, expected, action) = opportunity(&room);
        room.submit_test(seat as u64 + 1, "before-rematch".into(), 1, expected.clone(), action)
            .unwrap();
        let original = receipt(&mut clients[seat]);
        assert!(matches!(original.outcome, CommandOutcome::Accepted { .. }));
        for _ in 0..500 {
            room.advance();
            if !room.hand.in_hand() {
                break;
            }
            if let Turn::Seat(current) = Mighty::turn(room.hand.game.as_ref().unwrap()) {
                let legal = Mighty::legal_actions(room.hand.game.as_ref().unwrap(), current);
                let action = legal
                    .iter()
                    .find(|action| !matches!(action, mighty::Action::Pass | mighty::Action::Misdeal))
                    .unwrap_or(&legal[0])
                    .clone();
                room.apply_move(current, action, "test").unwrap();
            }
        }
        assert!(!room.hand.in_hand());
        let before = room.hand.version;
        room.end_session().unwrap();
        room.rematch().unwrap();
        assert_eq!(room.hand.version, before);
        let saved = serde_json::to_value(room.snapshot()).unwrap();
        let token = saved["seats"][seat]["token"].as_str().unwrap().to_owned();
        let mut restored = Room::<Mighty>::restore(saved, room.env.clone(), super::super::mighty_bots()).unwrap();
        assert_eq!(restored.hand.version, before);
        let (tx, mut rx) = crate::outbound::test_channel();
        restored.seating.conns.insert(99, Conn::new(tx));
        restored
            .on_message(
                99,
                ClientMsg::Join {
                    name: "Restored".into(),
                    token: Some(token),
                    seat: None,
                    device: None,
                    reclaim: true,
                },
            )
            .unwrap();
        restored.query_test(99, "before-rematch".into(), 1).unwrap();
        assert_eq!(receipt(&mut rx), original);
        assert!(restored.command_window(seat).is_none());
        assert_eq!(restored.room_command_window(99).unwrap().next_sequence, 2);
    }

    #[test]
    fn accepted_checkpoint_receipts_must_belong_to_the_restored_room_and_version() {
        let (mut room, _) = fixture();
        let (seat, expected, action) = opportunity(&room);
        let actor = expected.actor_id.clone();
        room.submit_test(seat as u64 + 1, "checkpoint".into(), 1, expected, action)
            .unwrap();
        let saved = serde_json::to_value(room.snapshot()).unwrap();
        for (field, replacement) in [
            ("room_id", json!("foreign")),
            ("seat", json!(999)),
            ("version", json!(0)),
        ] {
            let mut corrupt = saved.clone();
            corrupt["commands"]["actors"][&actor]["receipts"][0]["scope"][field] = replacement;
            assert!(Room::<Mighty>::restore(corrupt, room.env.clone(), super::super::mighty_bots()).is_err());
        }
    }

    fn exchange_fixture() -> (Room<Mighty>, Vec<crate::outbound::Receiver>, usize, Vec<Value>) {
        let (mut room, clients) = fixture();
        for _ in 0..32 {
            let Some(Turn::Seat(seat)) = room.hand.turn() else {
                panic!("expected player turn")
            };
            let legal = Mighty::legal_actions(room.hand.game.as_ref().unwrap(), seat);
            let discards: Vec<_> = legal
                .iter()
                .filter(|action| matches!(action, mighty::Action::Discard(_)))
                .map(|action| serde_json::to_value(action).unwrap())
                .collect();
            if !discards.is_empty() {
                return (room, clients, seat, discards);
            }
            let action = legal
                .iter()
                .find(|action| matches!(action, mighty::Action::Bid(contract) if contract.count == 20))
                .or_else(|| legal.iter().find(|action| matches!(action, mighty::Action::Pass)))
                .expect("bid or pass")
                .clone();
            room.act(seat, serde_json::to_value(action).unwrap()).unwrap();
            room.advance();
        }
        panic!("exchange not reached");
    }

    fn private_views(room: &Room<Mighty>) -> Vec<Value> {
        (0..5)
            .map(|seat| {
                serde_json::to_value(Mighty::view(
                    room.hand.game.as_ref().unwrap(),
                    engine::Viewer::Seat(seat),
                ))
                .unwrap()
            })
            .collect()
    }

    #[test]
    fn atomic_batch_discards_once_with_one_revision_and_replayable_receipt() {
        let (mut room, mut clients, seat, discards) = exchange_fixture();
        let expected = room.command_scope(seat);
        let batch = discards[..3].to_vec();
        let before = room.hand.log.len();
        let before_cards = Mighty::view(room.hand.game.as_ref().unwrap(), engine::Viewer::Seat(seat))
            .hand
            .len();
        room.on_message(
            seat as u64 + 1,
            ClientMsg::SubmitBatch {
                operation_id: "1:discard".into(),
                sequence: 1,
                expected: expected.clone(),
                actions: batch.clone(),
            },
        )
        .unwrap();
        let accepted = receipt(&mut clients[seat]);
        assert_eq!(
            accepted.outcome,
            CommandOutcome::Accepted {
                version: expected.version + 1
            }
        );
        assert_eq!(room.hand.version, expected.version + 1);
        assert_eq!(room.hand.log.len(), before + 3);
        assert_eq!(
            Mighty::view(room.hand.game.as_ref().unwrap(), engine::Viewer::Seat(seat))
                .hand
                .len(),
            before_cards - 3
        );
        let views = private_views(&room);
        room.submit_batch_command(seat as u64 + 1, "1:discard".into(), 1, expected.clone(), batch.clone())
            .unwrap();
        assert_eq!(receipt(&mut clients[seat]), accepted);
        assert_eq!(private_views(&room), views);
        assert_eq!(room.hand.log.len(), before + 3);
        // Reinterpreting this transaction as one game action is a conflict.
        room.submit_command(
            seat as u64 + 1,
            "1:discard".into(),
            1,
            expected.clone(),
            serde_json::to_value(&batch).unwrap(),
        )
        .unwrap();
        assert!(matches!(
            receipt(&mut clients[seat]).outcome,
            CommandOutcome::Rejected {
                reason: CommandRejection::SequenceConflict,
                ..
            }
        ));
        let saved = serde_json::to_value(room.snapshot()).unwrap();
        let mut restored = Room::<Mighty>::restore(saved, room.env.clone(), super::super::mighty_bots()).unwrap();
        assert_eq!(private_views(&restored), views);
        assert_eq!(restored.hand.log.len(), before + 3);
        assert_eq!(restored.hand.version, expected.version + 1);
        let (tx, mut rx) = crate::outbound::test_channel();
        let conn = seat as u64 + 1;
        // Reconnect the original actor through its persisted credential.
        let snapshot = serde_json::to_value(room.snapshot()).unwrap();
        restored.seating.conns.insert(conn, Conn::new(tx));
        restored
            .on_message(
                conn,
                ClientMsg::Join {
                    name: "Restored".into(),
                    token: Some(snapshot["seats"][seat]["token"].as_str().unwrap().into()),
                    seat: None,
                    device: None,
                    reclaim: true,
                },
            )
            .unwrap();
        restored
            .submit_batch_command(conn, "1:discard".into(), 1, expected, batch)
            .unwrap();
        assert_eq!(receipt(&mut rx), accepted);
        assert_eq!(private_views(&restored), views);
    }

    #[test]
    fn atomic_batch_refusals_never_commit_a_prefix_or_rng() {
        for failure in ["duplicate", "malformed", "empty", "oversized", "stale", "wrong-seat"] {
            let (mut room, mut clients, seat, discards) = exchange_fixture();
            let views = private_views(&room);
            let log = room.hand.log.clone();
            let version = room.hand.version;
            let rng = rand::RngCore::next_u64(&mut room.rng.clone());
            let mut scope = room.command_scope(seat);
            let (actor, batch) = match failure {
                "duplicate" => (seat, vec![discards[0].clone(), discards[0].clone()]),
                "malformed" => (seat, vec![discards[0].clone(), json!({"unknown":"action"})]),
                "empty" => (seat, vec![]),
                "oversized" => (
                    seat,
                    vec![discards[0].clone(); crate::command_protocol::MAX_COMMAND_BATCH + 1],
                ),
                "stale" => {
                    scope.version += 1;
                    (seat, discards[..3].to_vec())
                }
                _ => {
                    let other = (seat + 1) % 5;
                    scope = room.command_scope(other);
                    (other, discards[..3].to_vec())
                }
            };
            room.submit_batch_command(actor as u64 + 1, "1:refused".into(), 1, scope, batch)
                .unwrap();
            assert!(
                matches!(receipt(&mut clients[actor]).outcome, CommandOutcome::Rejected { .. }),
                "{failure}"
            );
            assert_eq!(private_views(&room), views, "{failure}");
            assert_eq!(room.hand.log, log, "{failure}");
            assert_eq!(room.hand.version, version, "{failure}");
            assert_eq!(rand::RngCore::next_u64(&mut room.rng.clone()), rng, "{failure}");
        }
    }

    #[test]
    fn atomic_batch_cannot_continue_after_turn_handoff() {
        let (mut room, mut clients) = fixture();
        let (seat, scope, action) = opportunity(&room);
        let views = private_views(&room);
        let log = room.hand.log.clone();
        room.submit_batch_command(
            seat as u64 + 1,
            "1:handoff".into(),
            1,
            scope.clone(),
            vec![action, json!("Pass")],
        )
        .unwrap();
        assert!(matches!(
            receipt(&mut clients[seat]).outcome,
            CommandOutcome::Rejected {
                reason: CommandRejection::Rule,
                error: Some(ErrorCode::NotYourTurn)
            }
        ));
        assert_eq!(private_views(&room), views);
        assert_eq!(room.hand.log, log);
        assert_eq!(room.hand.version, scope.version);
    }

    #[test]
    fn cancelled_batch_never_executes_late_actions() {
        let (mut room, mut clients, seat, discards) = exchange_fixture();
        let scope = room.command_scope(seat);
        let views = private_views(&room);
        let log = room.hand.log.clone();
        cancel(&mut room, seat as u64 + 1, "batch-cancelled", 1, scope.clone());
        let cancelled = receipt(&mut clients[seat]);
        room.submit_batch_command(
            seat as u64 + 1,
            "1:batch-cancelled".into(),
            1,
            scope.clone(),
            discards[..3].to_vec(),
        )
        .unwrap();
        assert_eq!(receipt(&mut clients[seat]), cancelled);
        assert_eq!(private_views(&room), views);
        assert_eq!(room.hand.log, log);
        assert_eq!(room.hand.version, scope.version);
    }
}
