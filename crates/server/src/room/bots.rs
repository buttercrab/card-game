//! Bots at the table: how long they seem to take over a move, thinking
//! here or on a bot worker, the off-turn moves they plan on a deal, and
//! the 고수 bot's hints for players. A bot's move comes back to the room
//! on its own typed channel ([`Internal`]).

use super::{ConnId, Msg, Room, log_action};
use crate::game::ServerGame;
use crate::protocol::{ErrorCode, ServerError};
use engine::Decision;
use engine::Level;
use engine::Viewer;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use serde_json::json;
use std::time::Duration;

/// How long a room waits past a move's thinking time for a bot worker's
/// answer before thinking itself.
const REMOTE_GRACE: Duration = Duration::from_secs(2);

/// A bot's move time, in units of the server's bot delay (one second by
/// default), by what it is deciding, as a person would take: bids 2 to 3
/// s, discards and the friend call 3 to 4 s, a lead about 2 s, an obvious
/// follow about 0.6 s, with [`JITTER`] on top. The 고수 bot spends most
/// of it thinking; 초보 and 보통 are a little quicker.
pub(super) fn pace(level: Level, decision: Decision) -> f32 {
    let base = match decision {
        Decision::Obvious => 0.6,
        Decision::Follow => 1.2,
        Decision::Lead => 2.0,
        Decision::Bid => 2.5,
        Decision::Plan => 3.5,
    };
    let level = match level {
        Level::Easy => 0.75,
        Level::Normal => 0.85,
        Level::Hard => 1.0,
    };
    base * level
}

/// How much every bot move varies around its pace.
const JITTER: std::ops::Range<f32> = 0.85..1.15;

/// The most a 고수 bot thinks per move, in units of the bot delay: what it
/// had before moves were paced by decision. Longer waits are for show.
const THINK: f32 = 1.28;

/// How long a hint may think: the player is waiting for it.
const HINT_THINK: Duration = Duration::from_millis(800);

/// What the room's own bot tasks send it, for game action `A`.
#[derive(Debug)]
#[allow(clippy::enum_variant_names)]
pub(super) enum Internal<A> {
    ResourceReady {
        waiter: u64,
    },
    /// A bot's move for hand `version`.
    BotMove {
        version: u64,
        seat: usize,
        action: A,
    },
    /// The bot for hand `version` failed to think (it panicked): the 보통
    /// bot moves for it instead.
    BotFailed {
        version: u64,
        seat: usize,
    },
    /// A bot's move off its turn (a 딜미스), decided when deal number
    /// `deal` landed.
    BotOffTurn {
        deal: u64,
        seat: usize,
        action: A,
    },
    /// Private background work returns through the actor's publication fence.
    Hint {
        version: u64,
        seat: usize,
        conn: ConnId,
        actor_id: String,
        action: A,
    },
}

impl<G: ServerGame> Room<G> {
    fn background_admission(&mut self) -> Option<(tokio::sync::OwnedSemaphorePermit, crate::work_budget::Permit)> {
        let job = self.jobs.clone().try_acquire_owned().ok()?;
        let notice = self.env.cognition.notification();
        if let Some(cpu) = self.env.cognition.try_acquire() {
            return Some((job, cpu));
        }
        if self.work_waiter.is_none() {
            let waiter = self.work_waiter_epoch.wrapping_add(1);
            self.work_waiter_epoch = waiter;
            let tx = self.internal.clone();
            let task = tokio::spawn(async move {
                notice.await;
                let _ = tx.send(Internal::ResourceReady { waiter }).await;
            });
            self.work_waiter = Some((waiter, crate::work_budget::TaskGuard::new(&task)));
        }
        None
    }
    fn track_background(&mut self, task: &tokio::task::JoinHandle<()>) {
        self.job_tasks.retain(|task| !task.finished());
        self.job_tasks.push(crate::work_budget::TaskGuard::new(task));
    }

    /// Starts a bot thinking if one is to act. Its move arrives as
    /// [`Internal::BotMove`] no sooner than its pace.
    pub(super) fn think(&mut self) {
        if self.thinking == Some(self.hand.version) {
            return;
        }
        let Some(seat) = self.bot_to_act() else {
            return;
        };
        let Some((level, temper)) = self.seating.bot(seat) else {
            return;
        };
        let Some((job_permit, cpu)) = self.background_admission() else {
            return;
        };
        let Some(game) = self.hand.game.as_ref() else {
            return;
        };
        let bots = &self.env.bots;
        let view = G::view(game, Viewer::Seat(seat));
        let legal = self.policy_actions(&G::legal_actions(game, seat));
        if legal.is_empty() {
            return;
        }
        let (seed, version) = (self.rng.random::<u64>(), self.hand.version);
        // People take a moment, longer for a real choice, and every move
        // varies a little.
        let jitter = self.rng.random_range(JITTER);
        let delay = bots
            .delay
            .mul_f32(pace(level, self.bots.decision(&view, &legal)) * jitter);
        // A move that must wait after the deal waits a little past it.
        let delay = match self.hand.grace_left(&legal) {
            left if !left.is_zero() => delay.max(left + Duration::from_millis(300)),
            _ => delay,
        };
        // Bots wait out the delay anyway so people can follow along; spend
        // most of it thinking, leaving a little for the move to travel.
        let think = delay.mul_f32(0.8).min(bots.delay.mul_f32(THINK));
        let local_think = bots.think_cap.map_or(think, |cap| think.min(cap));
        let remote = Some(self.env.remote.clone()).filter(|r| r.available());
        let job = remote.as_ref().map(|_| {
            json!({
                "game": G::ID, "level": level, "seat": seat, "temper": temper, "seed": seed,
                "think_ms": think.as_millis() as u64,
                "view": view, "legal": legal,
            })
        });
        let tx = self.internal.clone();
        let table_bots = self.bots.clone();
        self.thinking = Some(version);
        let task = tokio::spawn(async move {
            let _job_permit = job_permit;
            let started = tokio::time::Instant::now();
            // A worker gets the move's thinking time and a grace period; past
            // that, or with no worker, the room thinks for itself.
            let mut remote_choice = None;
            if let (Some(remote), Some(job)) = (remote, job)
                && let Some(answer) = remote.ask(job, think + REMOTE_GRACE).await
            {
                remote_choice = serde_json::from_value::<G::Action>(answer)
                    .ok()
                    .filter(|a| legal.contains(a));
            }
            let choice = match remote_choice {
                Some(action) => {
                    // A successful remote choice no longer needs this private
                    // snapshot during the presentation delay.
                    drop(view);
                    drop(legal);
                    drop(cpu);
                    Ok(action)
                }
                None => {
                    tokio::task::spawn_blocking(move || {
                        let _cpu = cpu;
                        table_bots.bot(level, temper, local_think, 1).act(
                            &view,
                            &legal,
                            &mut StdRng::seed_from_u64(seed),
                        )
                    })
                    .await
                }
            };
            // Thinking time counts toward the delay that lets people follow along.
            tokio::time::sleep(delay.saturating_sub(started.elapsed())).await;
            let message = match choice {
                Ok(action) => Internal::BotMove { version, seat, action },
                Err(e) => {
                    tracing::error!(seat, "bot failed: {e}");
                    Internal::BotFailed { version, seat }
                }
            };
            let _ = tx.send(message).await;
        });
        self.track_background(&task);
    }

    /// What the room's own tasks sent; returns whether anything changed.
    pub(super) fn on_internal(&mut self, message: Internal<G::Action>) -> bool {
        match message {
            Internal::ResourceReady { waiter } => {
                if self.work_waiter.as_ref().is_some_and(|(id, _)| *id == waiter) {
                    self.work_waiter = None;
                }
                false
            }
            Internal::BotMove { version, seat, action } => {
                self.done_thinking(version);
                self.is_current(version, seat) && self.bot_move(seat, action)
            }
            Internal::BotFailed { version, seat } => {
                self.done_thinking(version);
                self.is_current(version, seat) && self.stand_in(seat, "the bot failed; a 보통 bot moved")
            }
            Internal::BotOffTurn { deal, seat, action } => self.bot_off_turn(deal, seat, action),
            Internal::Hint {
                version,
                seat,
                conn,
                actor_id,
                action,
            } => {
                if version == self.hand.version
                    && self.seating.seat_of(conn) == Some(seat)
                    && self.member(seat).id == actor_id
                    && !self.policy_actions(std::slice::from_ref(&action)).is_empty()
                {
                    self.send(conn, &Msg::<G>::Hint { version, action });
                }
                false
            }
        }
    }

    /// The think for hand `version` is over; one for a later version runs on.
    fn done_thinking(&mut self, version: u64) {
        if self.thinking == Some(version) {
            self.thinking = None;
        }
    }

    /// Whether a bot's move for hand `version` is still the one to make.
    fn is_current(&self, version: u64, seat: usize) -> bool {
        version == self.hand.version && self.resources.held.is_none() && self.bot_to_act() == Some(seat)
    }

    /// Applies a bot's move. Returns whether it did.
    fn bot_move(&mut self, seat: usize, action: G::Action) -> bool {
        if self.policy_actions(std::slice::from_ref(&action)).is_empty() {
            return false;
        }
        let logged = log_action(&action);
        if let Err(e) = self.apply_move(seat, action, "bot move") {
            tracing::error!(room = %self.id, seat, action = %logged, "bot move refused: {e:?}");
            return false;
        }
        true
    }

    /// A 보통 bot makes `seat`'s move, at once (`why` goes to the log).
    /// Returns whether it did.
    pub(super) fn stand_in(&mut self, seat: usize, why: &str) -> bool {
        let Some(game) = self.hand.game.as_ref() else {
            return false;
        };
        let view = G::view(game, Viewer::Seat(seat));
        let legal = self.policy_actions(&G::legal_actions(game, seat));
        if legal.is_empty() {
            return false;
        }
        let mut rng = self.rng.clone();
        let action = self
            .bots
            .bot(Level::Normal, seat, Duration::ZERO, 1)
            .act(&view, &legal, &mut rng);
        let logged = log_action(&action);
        if let Err(e) = self.apply_move_with_rng(seat, action, why, rng) {
            tracing::error!(room = %self.id, seat, action = %logged, "stand-in move refused: {e:?}");
            return false;
        }
        true
    }

    /// Applies a bot's off-turn move if it is still allowed: the same deal,
    /// the bot still seated, still not its turn (on its turn it thinks
    /// afresh), and still legal. Returns whether it did.
    fn bot_off_turn(&mut self, deal: u64, seat: usize, action: G::Action) -> bool {
        let allowed = self
            .hand
            .game
            .as_ref()
            .is_some_and(|g| !self.hand.waits_on(seat) && G::legal_actions(g, seat).contains(&action));
        if deal != self.hand.deals || self.seating.bot(seat).is_none() || !allowed {
            return false;
        }
        if self.policy_actions(std::slice::from_ref(&action)).is_empty() {
            return false;
        }
        self.apply_move(seat, action, "bot off-turn move").is_ok()
    }

    /// Right after a deal, each bot the hand does not wait on decides once
    /// whether to take one of its legal actions anyway (a 딜미스), and
    /// does so after a short pause, as a person would.
    pub(super) fn plan_off_turn(&mut self) {
        let Some(game) = self.hand.game.as_ref() else { return };
        for seat in 0..self.seating.len() {
            let Some((level, _)) = self.seating.bot(seat) else {
                continue;
            };
            if self.hand.waits_on(seat) {
                continue;
            }
            let legal = self.policy_actions(&G::legal_actions(game, seat));
            if legal.is_empty() {
                continue;
            }
            let Ok(job_permit) = self.jobs.clone().try_acquire_owned() else {
                continue;
            };
            let view = G::view(game, Viewer::Seat(seat));
            let Some(action) = self.bots.off_turn(level, seat, &view, &legal) else {
                continue;
            };
            let pause = self.env.bots.delay.mul_f32(self.rng.random_range(1.0..1.5));
            let (tx, deal) = (self.internal.clone(), self.hand.deals);
            let task = tokio::spawn(async move {
                let _job_permit = job_permit;
                tokio::time::sleep(pause).await;
                let _ = tx.send(Internal::BotOffTurn { deal, seat, action }).await;
            });
            self.job_tasks.retain(|task| !task.finished());
            self.job_tasks.push(crate::work_budget::TaskGuard::new(&task));
        }
    }

    /// What the 고수 bot would do in `seat`'s place, sent to `conn` alone.
    pub(super) fn hint(&mut self, conn: ConnId, seat: usize) -> Result<(), ServerError> {
        let game = self.hand.game.as_ref().ok_or(ErrorCode::NoHand)?;
        if !self.hand.waits_on(seat) {
            return Err(ErrorCode::NotYourTurn.into());
        }
        if self.seating.seat_of(conn) != Some(seat) {
            return Err(ErrorCode::NotSeated.into());
        }
        let tx = self.internal.clone();
        let actor_id = self.member(seat).id;
        // Searches are capped across the server (see `limit::HintPool`);
        // how often one connection asks, by its own limit (`limit::ws_hints`).
        let permit = self.env.hints.try_permit().ok_or(ErrorCode::HintsBusy)?;
        let job_permit = self
            .jobs
            .clone()
            .try_acquire_owned()
            .map_err(|_| ErrorCode::HintsBusy)?;
        let cpu = self.env.cognition.try_acquire().ok_or(ErrorCode::HintsBusy)?;
        let view = G::view(game, Viewer::Seat(seat));
        let legal = self.policy_actions(&G::legal_actions(game, seat));
        if legal.is_empty() {
            return Err(ErrorCode::ResourceCapacity.into());
        }
        let (seed, version) = (self.rng.random::<u64>(), self.hand.version);
        let table_bots = self.bots.clone();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let _job_permit = job_permit;
            let action =
                table_bots
                    .bot(Level::Hard, seat, HINT_THINK, 1)
                    .act(&view, &legal, &mut StdRng::seed_from_u64(seed));
            drop(cpu);
            let _ = tx.blocking_send(Internal::Hint {
                version,
                seat,
                conn,
                actor_id,
                action,
            });
        });
        Ok(())
    }
}
