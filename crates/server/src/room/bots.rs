//! Bots at the table: how long they seem to take over a move, thinking
//! here or on a bot worker, the out-of-turn plans they make on a deal, and
//! the 고수 bot's hints for players.

use super::{Command, ConnId, Msg, Room, log_action};
use crate::protocol::{ErrorCode, ServerError};
use crate::session::{Decision, SessionGame};
use engine::{Turn, Viewer};
use mighty::bot::Level;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use serde_json::json;
use std::any::Any;
use std::time::{Duration, Instant};
use tokio::sync::mpsc::WeakUnboundedSender;

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

impl<G: SessionGame> Room<G> {
    /// Starts a bot thinking if one is to act. Its move arrives as
    /// [`Command::BotMove`] no sooner than its pace.
    pub(super) fn think(&mut self) {
        if self.thinking {
            return;
        }
        let me = self.me.as_ref().and_then(WeakUnboundedSender::upgrade);
        let (Some(seat), Some(game), Some(tx)) = (self.bot_to_act(), self.hand.game.as_ref(), me) else {
            return;
        };
        let Some((level, temper)) = self.seating.bot(seat) else {
            return;
        };
        let bots = &self.env.bots;
        let view = G::view(game, Viewer::Seat(seat));
        let legal = G::legal_actions(game);
        let (seed, version) = (self.rng.random::<u64>(), self.hand.version);
        // People take a moment, longer for a real choice, and every move
        // varies a little.
        let jitter = self.rng.random_range(JITTER);
        let delay = bots.delay.mul_f32(pace(level, G::decision(&view, &legal)) * jitter);
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
                "level": level, "seat": seat, "temper": temper, "seed": seed,
                "think_ms": think.as_millis() as u64,
                "view": view, "legal": legal,
            })
        });
        self.thinking = true;
        tokio::spawn(async move {
            let started = Instant::now();
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
                Some(action) => Ok(action),
                None => {
                    tokio::task::spawn_blocking(move || {
                        G::bot(level, temper, local_think, 1).act(&view, &legal, &mut StdRng::seed_from_u64(seed))
                    })
                    .await
                }
            };
            // Thinking time counts toward the delay that lets people follow along.
            tokio::time::sleep(delay.saturating_sub(started.elapsed())).await;
            let action: Box<dyn Any + Send> = match choice {
                Ok(action) => Box::new(action),
                Err(e) => {
                    tracing::error!("bot failed: {e}");
                    Box::new(())
                }
            };
            let _ = tx.send(Command::BotMove { version, seat, action });
        });
    }

    /// Applies a bot's move if the hand has not moved on. Returns whether it did.
    pub(super) fn bot_move(&mut self, version: u64, seat: usize, action: Box<dyn Any + Send>) -> bool {
        if version != self.hand.version || self.bot_to_act() != Some(seat) {
            return false;
        }
        let Ok(action) = action.downcast::<G::Action>() else {
            return false;
        };
        let logged = log_action(&*action);
        if let Err(e) = self.hand.apply(*action) {
            tracing::error!(room = %self.id, seat, action = %logged, "bot chose an illegal action: {e}");
            return false;
        }
        tracing::info!(room = %self.id, seat, action = %logged, "bot move");
        true
    }

    /// Applies a bot's out-of-turn action if it is still allowed. Returns
    /// whether it did.
    pub(super) fn bot_out_of_turn(&mut self, deal: u64, seat: usize, action: Box<dyn Any + Send>) -> bool {
        let Ok(action) = action.downcast::<G::Action>() else {
            return false;
        };
        let allowed = self
            .hand
            .game
            .as_ref()
            .is_some_and(|g| G::out_of_turn_actions(g, seat).contains(&*action));
        if deal != self.hand.deals || self.seating.bot(seat).is_none() || !allowed {
            return false;
        }
        self.out_of_turn(seat, *action).is_ok()
    }

    /// Right after a deal, each bot decides once whether to act out of
    /// turn (a 딜미스), and does so after a short pause, as a person would.
    pub(super) fn plan_out_of_turn(&mut self) {
        let Some(tx) = self.me.as_ref().and_then(WeakUnboundedSender::upgrade) else {
            return;
        };
        let Some(game) = self.hand.game.as_ref() else { return };
        for seat in 0..self.seating.len() {
            let Some((level, _)) = self.seating.bot(seat) else {
                continue;
            };
            let Some(action) = G::bot_out_of_turn(level, seat, game, &mut self.rng) else {
                continue;
            };
            let pause = self.env.bots.delay.mul_f32(self.rng.random_range(1.0..1.5));
            let (tx, deal) = (tx.clone(), self.hand.deals);
            tokio::spawn(async move {
                tokio::time::sleep(pause).await;
                let action: Box<dyn Any + Send> = Box::new(action);
                let _ = tx.send(Command::BotOutOfTurn { deal, seat, action });
            });
        }
    }

    /// What the 고수 bot would do in `seat`'s place, sent to `conn` alone.
    pub(super) fn hint(&mut self, conn: ConnId, seat: usize) -> Result<(), ServerError> {
        let game = self.hand.game.as_ref().ok_or(ErrorCode::NoHand)?;
        if G::turn(game) != Turn::Seat(seat) {
            return Err(ErrorCode::NotYourTurn.into());
        }
        let c = self.seating.conns.get_mut(&conn).ok_or(ErrorCode::NotSeated)?;
        if c.hinted.is_some_and(|t| t.elapsed() < Duration::from_secs(1)) {
            return Ok(());
        }
        // Searches are capped across the server; see `limit::HINTS`.
        let permit = crate::limit::hint_permit().ok_or(ErrorCode::HintsBusy)?;
        c.hinted = Some(Instant::now());
        let tx = c.tx.clone();
        let view = G::view(game, Viewer::Seat(seat));
        let legal = G::legal_actions(game);
        let (seed, version) = (self.rng.random::<u64>(), self.hand.version);
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let action = G::bot(Level::Hard, seat, HINT_THINK, 1).act(&view, &legal, &mut StdRng::seed_from_u64(seed));
            let msg = Msg::<G>::Hint { version, action };
            let _ = tx.send(serde_json::to_string(&msg).expect("messages serialize"));
        });
        Ok(())
    }
}
