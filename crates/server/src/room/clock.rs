//! The turn timer: under a table's turn limit, a person's turn that runs
//! out is played for them by a 보통 bot, and their seat is marked away.

use super::Room;
use crate::game::ServerGame;
use crate::protocol::ClockInfo;
use crate::stats::Event;
use engine::Turn;
use std::time::Duration;
use tokio::time::Instant;

/// A turn's time for a seat marked away (자리 비움), in seconds.
pub(super) const AWAY_SECS: u32 = 5;

/// What a running timer was set for; any of it changing sets a new one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ClockKey {
    /// The hand's version when the turn began.
    pub version: u64,
    pub seat: usize,
    /// The table's limit, in seconds.
    pub limit: u32,
    /// Whether the seat was away.
    pub away: bool,
}

/// The running turn timer: when `key.seat` must have acted.
struct Running {
    key: ClockKey,
    deadline: Instant,
    total: Duration,
}

#[derive(Default)]
pub(super) struct TurnClock(Option<Running>);

impl TurnClock {
    /// Runs the timer for `key`, `total` long, unless it already runs for
    /// it; stops it for `None`. Returns whether anything changed.
    pub fn set(&mut self, key: Option<ClockKey>, total: impl FnOnce() -> Duration) -> bool {
        match key {
            None => self.0.take().is_some(),
            Some(key) if self.0.as_ref().is_some_and(|r| r.key == key) => false,
            Some(key) => {
                let total = total();
                self.0 = Some(Running {
                    key,
                    deadline: Instant::now() + total,
                    total,
                });
                true
            }
        }
    }

    pub fn deadline(&self) -> Option<Instant> {
        self.0.as_ref().map(|r| r.deadline)
    }

    /// The timer that ran out, taken off.
    pub fn take(&mut self) -> Option<ClockKey> {
        self.0.take().map(|r| r.key)
    }

    /// The timer as the room message carries it.
    pub fn info(&self) -> Option<ClockInfo> {
        self.0.as_ref().map(|r| ClockInfo {
            seat: r.key.seat,
            ms: r.deadline.saturating_duration_since(Instant::now()).as_millis() as u64,
            total_ms: r.total.as_millis() as u64,
        })
    }
}

impl<G: ServerGame> Room<G> {
    /// Starts, keeps or stops the turn timer for whoever is to act now;
    /// returns whether it changed.
    pub(super) fn arm_clock(&mut self) -> bool {
        let limit = self.table.turn_secs;
        // Nobody to keep waiting: the table pauses until someone is back.
        let key = match self.hand.turn() {
            Some(Turn::Seat(seat)) if limit > 0 && !self.seating.conns.is_empty() && self.seating.is_human(seat) => {
                Some(ClockKey {
                    version: self.hand.version,
                    seat,
                    limit,
                    away: self.is_away(seat),
                })
            }
            _ => None,
        };
        let second = Duration::from_secs(1);
        let game = self.hand.game.as_ref();
        self.clock.set(key, || {
            let key = key.expect("a timer runs for a turn");
            let mut full = second * limit;
            if game.is_some_and(|g| G::long_decision(&G::legal_actions(g, key.seat))) {
                full *= 2;
            }
            if key.away { (second * AWAY_SECS).min(full) } else { full }
        })
    }

    /// The turn ran out: a 보통 bot plays it, and the seat is marked away.
    /// Returns whether it did.
    pub(super) fn on_clock(&mut self) -> bool {
        let Some(key) = self.clock.take() else { return false };
        let seat = key.seat;
        if key.version != self.hand.version || self.hand.turn() != Some(Turn::Seat(seat)) {
            return false;
        }
        if !self.stand_in(seat, "turn ran out") {
            return false;
        }
        self.seating.away[seat] = true;
        self.record(Event::TurnTimedOut { table: self.id.clone() });
        true
    }
}
