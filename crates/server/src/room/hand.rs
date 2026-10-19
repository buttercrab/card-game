//! The hand on the table: the game's state, the log it replays from, and
//! the counters that tell a stale bot move from a current one.

use super::{Room, log_action};
use crate::game::ServerGame;
use crate::protocol::{ErrorCode, ServerError};
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
pub(super) fn replay<G: ServerGame>(game: &mut G::State, log: &[LogEntry<G::Action>]) -> Result<(), String> {
    for (i, entry) in log.iter().enumerate() {
        let applied = match entry {
            LogEntry::Chance { action } => G::apply_chance(game, action.clone()),
            LogEntry::Act { seat, action } => G::apply(game, *seat, action.clone()),
        };
        applied.map_err(|e| format!("action {i}: {e}"))?;
    }
    Ok(())
}

/// Frozen reconstruction inputs, independent of mutable table/session settings.
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct ReplayContext {
    pub settings: Value,
    pub previous: Option<Value>,
    pub rotation: usize,
}

pub(super) struct Hand<G: ServerGame> {
    /// The current hand, or the last one once it is over.
    pub game: Option<G::State>,
    pub replay_context: Option<ReplayContext>,
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
    /// When the cards last landed, for [`ServerGame::grace`]; unknown
    /// after a restart, when any grace is long over.
    pub dealt_at: Option<Instant>,
    /// Whether the hand, once over, is in the session's scores.
    pub booked: bool,
}

impl<G: ServerGame> Clone for Hand<G> {
    fn clone(&self) -> Self {
        Self {
            game: self.game.clone(),
            replay_context: self.replay_context.clone(),
            log: self.log.clone(),
            number: self.number,
            started: self.started,
            version: self.version,
            deals: self.deals,
            dealt_at: self.dealt_at,
            booked: self.booked,
        }
    }
}

impl<G: ServerGame> Default for Hand<G> {
    fn default() -> Hand<G> {
        Hand {
            game: None,
            replay_context: None,
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
pub(super) struct Advanced<G: ServerGame> {
    /// Cards landed.
    pub dealt: bool,
    /// Index of this prepared chance batch; only committed batches are logged.
    pub(super) chance_start: usize,
    /// The hand is over, and not yet booked.
    pub finished: Option<Finished<G>>,
}

/// A hand just over.
pub(super) struct Finished<G: ServerGame> {
    pub payoffs: Vec<i64>,
    pub summary: Option<G::Summary>,
    /// How it went, in a word, for the stats.
    pub outcome: &'static str,
}

impl<G: ServerGame> Hand<G> {
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
    pub fn advance(&mut self, _room: &str, rng: &mut impl Rng) -> Advanced<G> {
        let mut done = Advanced {
            dealt: false,
            chance_start: self.log.len(),
            finished: None,
        };
        let Some(game) = self.game.as_mut() else { return done };
        while G::turn(game) == Turn::Chance {
            let deal = G::sample_chance(game, rng);
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

impl<G: ServerGame> Room<G> {
    /// Deals the next hand once every seat is filled, moving the seats
    /// first when the table shuffles.
    pub(super) fn start(&mut self) -> Result<(), ServerError> {
        if self.hand.in_hand() {
            return Err(ErrorCode::HandInProgress.into());
        }
        if self.admissions_pending() {
            return Err(ErrorCode::PlayersNotReady.into());
        }
        if self.seating.any_empty() {
            return Err(ErrorCode::EmptySeats.into());
        }
        if self.lifecycle.ended {
            return Err(ErrorCode::SessionEnded.into());
        }
        if !self.readiness().iter().all(|r| *r) {
            return Err(ErrorCode::PlayersNotReady.into());
        }
        let baseline = self
            .native_start_baseline()
            .map_err(|error| ServerError::with_detail(ErrorCode::ResourceCapacity, format!("{error:?}")))?;
        // Prepare the complete fallible game before changing seats, score
        // projections or shuffle flags. Rejection must leave business state intact.
        let mut rng = self.rng.clone();
        let order = (self.table.shuffle_next || self.table.shuffle).then(|| self.seating.shuffle_order(&mut rng));
        let number = self.session.hands_played;
        let options = match &order {
            Some(order) => self.session.options_after_reseat(&self.settings, number, order),
            None => self.session.options(&self.settings, number),
        };
        let state = G::new_game(&options).map_err(|e| ServerError::with_detail(ErrorCode::IllegalAction, e))?;
        let mut prepared = Hand {
            version: self.hand.version,
            deals: self.hand.deals,
            ..Hand::default()
        };
        prepared.start(state, number);
        let advanced = prepared.advance(&self.id, &mut rng);
        let (profile, reservation) = self.reserve_native_start(baseline, &prepared, &advanced)?;
        self.rng = rng;
        self.table.shuffle_next = false;
        if let Some(order) = order {
            let news = crate::protocol::SeatsMoved::Shuffle { order: order.clone() };
            self.reseat(&order, news);
        }
        if self.session.hands_played > 0 {
            let before = self.session.scores.clone();
            for s in 0..self.seating.len() {
                if let Some(p) = self.lifecycle.standings.get(&self.member(s).id) {
                    self.session.scores[s] = p.score;
                } else {
                    self.session.scores[s] = 0;
                }
            }
            if before != self.session.scores {
                self.session.revision += 1;
            }
        }
        self.clear_current_replay();
        self.lifecycle.hand_members = (0..self.seating.len()).map(|s| self.member(s)).collect();
        self.lifecycle.ready.clear();
        self.hand = prepared;
        self.resources = super::resources::NativeResources::admitted(profile, reservation);
        self.prepared_advance = Some(advanced);
        self.hand.replay_context = Some(ReplayContext {
            settings: serde_json::to_value(&self.settings).expect("settings serialize"),
            previous: self
                .session
                .last_hand(number)
                .map(|h| serde_json::to_value(h).expect("summary serializes")),
            rotation: self.session.rotation,
        });
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

    /// Stage a bounded same-seat transaction. Rules, turn and grace are checked
    /// at every step; a failure publishes neither a prefix nor a changed RNG.
    pub(super) fn act_batch(&mut self, seat: usize, actions: Vec<Value>) -> Result<(), ServerError> {
        if actions.is_empty() || actions.len() > crate::command_protocol::MAX_COMMAND_BATCH {
            return Err(ServerError::with_detail(
                ErrorCode::BadMessage,
                "invalid command batch length",
            ));
        }
        let actions: Vec<G::Action> = actions
            .into_iter()
            .map(serde_json::from_value)
            .collect::<Result<_, _>>()
            .map_err(|e| ServerError::with_detail(ErrorCode::BadMessage, e))?;
        let mut prepared = self.hand.clone();
        for action in actions {
            if !prepared.waits_on(seat) {
                return Err(ErrorCode::NotYourTurn.into());
            }
            let game = prepared.game.as_ref().ok_or(ErrorCode::NoHand)?;
            if prepared.dealt_at.is_some_and(|t| t.elapsed() < G::grace(game, &action)) {
                return Err(ErrorCode::WaitAfterDeal.into());
            }
            prepared
                .apply(seat, action)
                .map_err(|e| ServerError::with_detail(ErrorCode::IllegalAction, e))?;
        }
        // A revision denotes one committed transaction, not a log entry count.
        // The ordinary replay log retains every native rule action unchanged.
        prepared.version = self.hand.version + 1;
        self.commit_prepared_move(prepared, self.rng.clone(), seat, "batch", "atomic move")
    }

    /// Applies `seat`'s `action` and logs it as `what`.
    pub(super) fn apply_move(&mut self, seat: usize, action: G::Action, what: &str) -> Result<(), ServerError> {
        self.apply_move_with_rng(seat, action, what, self.rng.clone())
    }

    pub(super) fn apply_move_with_rng(
        &mut self,
        seat: usize,
        action: G::Action,
        what: &str,
        rng: rand::rngs::StdRng,
    ) -> Result<(), ServerError> {
        let logged = log_action(&action);
        let mut prepared = self.hand.clone();
        prepared
            .apply(seat, action)
            .map_err(|e| ServerError::with_detail(ErrorCode::IllegalAction, e))?;
        self.commit_prepared_move(prepared, rng, seat, &logged, what)
    }

    fn commit_prepared_move(
        &mut self,
        mut prepared: Hand<G>,
        mut rng: rand::rngs::StdRng,
        seat: usize,
        logged: &str,
        what: &str,
    ) -> Result<(), ServerError> {
        if prepared.turn() == Some(Turn::Chance)
            && std::any::TypeId::of::<G>() == std::any::TypeId::of::<mighty::Mighty>()
        {
            self.ensure_native_reservation()?;
            self.require_restart_policy()
                .map_err(|error| ServerError::with_detail(ErrorCode::ResourceCapacity, format!("{error:?}")))?;
        }
        let advanced = prepared.advance(&self.id, &mut rng);
        let reservation = self.reserve_native_action(&prepared, &advanced)?;
        self.hand = prepared;
        self.resources.reservation = Some(reservation);
        self.rng = rng;
        self.prepared_advance = Some(advanced);
        tracing::info!(room = %self.id, seat, action = %logged, "{what}");
        Ok(())
    }

    /// Plays the chance actions, books the hand when it ends, and lets the
    /// bots decide whether to act off their turn on a new deal. Returns
    /// whether anything changed.
    pub(super) fn advance(&mut self) -> bool {
        if self.hand.in_hand() && self.prepared_advance.is_none() && self.ensure_native_reservation().is_err() {
            return self.refresh_resource_policy();
        }
        let advanced = self
            .prepared_advance
            .take()
            .unwrap_or_else(|| self.hand.advance(&self.id, &mut self.rng));
        if advanced.dealt {
            for entry in &self.hand.log[advanced.chance_start..] {
                if let LogEntry::Chance { action } = entry {
                    tracing::info!(room = %self.id, action = %log_action(action), "deal");
                }
            }
        }
        let finished = advanced.finished.is_some();
        if let Some(Finished {
            payoffs,
            summary,
            outcome,
        }) = advanced.finished
        {
            self.book_record(&payoffs);
            self.lifecycle.ready.clear();
            self.session.book(payoffs, summary);
            self.record(Event::HandFinished {
                hand: self.hand_stats(),
                outcome: outcome.to_string(),
                secs: self.hand_secs(),
            });
        }
        let policy_changed = self.refresh_resource_policy();
        advanced.dealt || finished || policy_changed
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
