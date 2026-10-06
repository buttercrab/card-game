//! The hand on the table: the game's state, the log it replays from, and
//! the counters that tell a stale bot move from a current one.

use super::{Room, log_action};
use crate::protocol::{ErrorCode, ServerError};
use crate::session::SessionGame;
use crate::stats::Event;
use engine::Turn;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tokio::time::Instant;

/// One step of a hand, as its log keeps it: replaying the log from the
/// hand's options gives back the hand exactly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum LogEntry<A> {
    /// The deal, or whatever else chance decides.
    Chance { action: A },
    /// `seat`'s move, on its turn or not (a 딜미스 the moment the cards
    /// land). Logs saved before moves were addressed by seat kept the
    /// latter as `out_of_turn`; they read as this.
    #[serde(alias = "out_of_turn")]
    Act { seat: usize, action: A },
}

/// Plays `log` from `game`, its first state; says which entry failed.
pub(super) fn replay<G: SessionGame>(game: &mut G::State, log: &[LogEntry<G::Action>]) -> Result<(), String> {
    for (i, entry) in log.iter().enumerate() {
        let applied = match entry {
            LogEntry::Chance { action } => G::apply_chance(game, action.clone()),
            LogEntry::Act { seat, action } => G::apply(game, *seat, action.clone()),
        };
        applied.map_err(|e| format!("action {i}: {e}"))?;
    }
    Ok(())
}

pub(super) struct Hand<G: SessionGame> {
    /// The current hand, or the last one once it is over.
    pub game: Option<G::State>,
    /// Every step of `game` so far, deals included, so it can be replayed.
    pub log: Vec<LogEntry<G::Action>>,
    /// The session hand number `game` was dealt as.
    pub number: u32,
    /// When the hand was dealt, in Unix seconds, if known.
    pub started: Option<u64>,
    /// Bumped whenever the hand changes, so a bot's stale move is dropped.
    pub version: u64,
    /// Deals so far, so a bot's off-turn action for an earlier deal is
    /// dropped.
    pub deals: u64,
    /// When the cards last landed, for [`SessionGame::grace`]; unknown
    /// after a restart, when any grace is long over.
    pub dealt_at: Option<Instant>,
    /// Whether the hand, once over, is in the session's scores.
    pub booked: bool,
}

impl<G: SessionGame> Default for Hand<G> {
    fn default() -> Hand<G> {
        Hand {
            game: None,
            log: Vec::new(),
            number: 0,
            started: None,
            version: 0,
            deals: 0,
            dealt_at: None,
            booked: false,
        }
    }
}

/// What playing the chance actions did.
pub(super) struct Advanced<G: SessionGame> {
    /// Cards landed.
    pub dealt: bool,
    /// The hand is over, and not yet booked.
    pub finished: Option<Finished<G>>,
}

/// A hand just over.
pub(super) struct Finished<G: SessionGame> {
    pub payoffs: Vec<i64>,
    pub summary: Option<G::Summary>,
    /// How it went, in a word, for the stats.
    pub outcome: &'static str,
}

impl<G: SessionGame> Hand<G> {
    pub fn turn(&self) -> Option<Turn> {
        self.game.as_ref().map(G::turn)
    }

    /// Whether a hand is being played (not over, not put away).
    pub fn in_hand(&self) -> bool {
        self.turn().is_some_and(|t| t != Turn::Over)
    }

    /// Deals hand number `number` from `game`, its first state.
    pub fn start(&mut self, game: G::State, number: u32) {
        self.game = Some(game);
        self.log.clear();
        self.number = number;
        self.started = Some(crate::stats::now());
        self.booked = false;
        self.version += 1;
    }

    /// Takes the last hand off the table (the seats it was dealt to moved).
    pub fn put_away(&mut self) {
        self.game = None;
        self.log.clear();
        self.version += 1;
    }

    /// Plays `seat`'s `action`, on its turn or not.
    pub fn apply(&mut self, seat: usize, action: G::Action) -> Result<(), String> {
        let game = self.game.as_mut().ok_or("no hand")?;
        G::apply(game, seat, action.clone()).map_err(|e| e.to_string())?;
        self.log.push(LogEntry::Act { seat, action });
        self.version += 1;
        Ok(())
    }

    /// Whether the hand waits on `seat` ([`Turn::Seat`]).
    pub fn waits_on(&self, seat: usize) -> bool {
        self.turn() == Some(Turn::Seat(seat))
    }

    /// Plays the chance actions due (the deal), and says when the hand is
    /// over and not yet booked.
    pub fn advance(&mut self, room: &str, rng: &mut impl Rng) -> Advanced<G> {
        let mut done = Advanced {
            dealt: false,
            finished: None,
        };
        let Some(game) = self.game.as_mut() else { return done };
        while G::turn(game) == Turn::Chance {
            let deal = G::sample_chance(game, rng);
            tracing::info!(room, action = %log_action(&deal), "deal");
            G::apply_chance(game, deal.clone()).expect("a sampled chance action is legal");
            self.log.push(LogEntry::Chance { action: deal });
            done.dealt = true;
        }
        if done.dealt {
            self.deals += 1;
            self.version += 1;
            self.dealt_at = Some(Instant::now());
        }
        if G::turn(game) == Turn::Over
            && !self.booked
            && let Some(payoffs) = G::payoffs(game)
        {
            self.booked = true;
            done.finished = Some(Finished {
                payoffs,
                summary: G::summary(game),
                outcome: G::outcome(game),
            });
        }
        done
    }

    /// How long the slowest of `legal` must still wait after the deal.
    pub fn grace_left(&self, legal: &[G::Action]) -> Duration {
        let Some(game) = &self.game else { return Duration::ZERO };
        let grace = legal.iter().map(|a| G::grace(game, a)).max().unwrap_or_default();
        let waited = self.dealt_at.map_or(grace, |t| t.elapsed());
        grace.saturating_sub(waited)
    }
}

impl<G: SessionGame> Room<G> {
    /// Deals the next hand once every seat is filled, moving the seats
    /// first when the table shuffles.
    pub(super) fn start(&mut self) -> Result<(), ServerError> {
        if self.hand.in_hand() {
            return Err(ErrorCode::HandInProgress.into());
        }
        if self.seating.any_empty() {
            return Err(ErrorCode::EmptySeats.into());
        }
        // 매 판 자리 섞기, or 섞기 pressed since the last hand.
        if std::mem::take(&mut self.table.shuffle_next) | self.table.shuffle {
            self.shuffle_seats();
        }
        let number = self.session.hands_played;
        let options = self.session.options(&self.settings, number);
        let state = G::new_game(&options).map_err(|e| ServerError::with_detail(ErrorCode::IllegalAction, e))?;
        self.hand.start(state, number);
        self.record(Event::HandStarted {
            hand: self.hand_stats(),
            players: self.seating.players(),
        });
        Ok(())
    }

    /// `seat` plays `action`, on its turn or out of it. Off its turn, an
    /// action it may not take is refused as not its turn.
    pub(super) fn act(&mut self, seat: usize, action: Value) -> Result<(), ServerError> {
        let game = self.hand.game.as_ref().ok_or(ErrorCode::NoHand)?;
        let action: G::Action =
            serde_json::from_value(action).map_err(|e| ServerError::with_detail(ErrorCode::BadMessage, e))?;
        let on_turn = self.hand.waits_on(seat);
        if !on_turn && !G::legal_actions(game, seat).contains(&action) {
            return Err(ErrorCode::NotYourTurn.into());
        }
        if self
            .hand
            .dealt_at
            .is_some_and(|t| t.elapsed() < G::grace(game, &action))
        {
            return Err(ErrorCode::WaitAfterDeal.into());
        }
        let what = if on_turn { "move" } else { "off-turn move" };
        self.apply_move(seat, action, what)
    }

    /// Applies `seat`'s `action` and logs it as `what`.
    pub(super) fn apply_move(&mut self, seat: usize, action: G::Action, what: &str) -> Result<(), ServerError> {
        let logged = log_action(&action);
        self.hand
            .apply(seat, action)
            .map_err(|e| ServerError::with_detail(ErrorCode::IllegalAction, e))?;
        tracing::info!(room = %self.id, seat, action = %logged, "{what}");
        Ok(())
    }

    /// Plays the chance actions, books the hand when it ends, and lets the
    /// bots decide whether to act off their turn on a new deal. Returns
    /// whether anything changed.
    pub(super) fn advance(&mut self) -> bool {
        let advanced = self.hand.advance(&self.id, &mut self.rng);
        if advanced.dealt {
            self.plan_off_turn();
        }
        let finished = advanced.finished.is_some();
        if let Some(Finished {
            payoffs,
            summary,
            outcome,
        }) = advanced.finished
        {
            self.session.book(payoffs, summary);
            self.record(Event::HandFinished {
                hand: self.hand_stats(),
                outcome: outcome.to_string(),
                secs: self.hand_secs(),
            });
        }
        advanced.dealt || finished
    }

    /// How long the hand has been played, in seconds, if known.
    pub(super) fn hand_secs(&self) -> Option<u64> {
        self.hand.started.map(|t| crate::stats::now().saturating_sub(t))
    }

    /// Who is to act now, if it is a bot.
    pub(super) fn bot_to_act(&self) -> Option<usize> {
        match self.hand.turn() {
            Some(Turn::Seat(s)) if self.seating.bot(s).is_some() => Some(s),
            _ => None,
        }
    }
}
