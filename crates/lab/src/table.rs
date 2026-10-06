//! Who plays at a table, phase by phase, and playing a hand on with them.

use crate::error::{LabError, Result};
use engine::{Game, Seat, Turn, Viewer};
use harness::Decided;
use mighty::{Action, Mighty, PhaseView, State};
use mighty_ai::{SimpleBot, play_out};
use rand::{Rng, RngCore, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};
use sim::spec::Spec;
use std::cell::{Cell, RefCell};

/// Who decides for a seat.
#[derive(Debug, Clone)]
pub enum Actor {
    Bot(Box<Spec>),
    /// Sees every hand. Plays each legal action out `rollouts` times on
    /// the real cards with simple bots in every seat, each of which picks
    /// a random legal action instead this often (`slip`), and keeps the
    /// best on average when it beats the simple bot's choice by a standard
    /// error: the search bot, minus the guessing.
    Cheat {
        rollouts: usize,
        slip: f64,
    },
}

impl Actor {
    /// A `sim` bot, or `cheat[:ROLLOUTS[:SLIP]]`.
    pub fn parse(s: &str) -> Result<Actor> {
        let Some(rest) = s.strip_prefix("cheat") else {
            return s.parse().map(|spec| Actor::Bot(Box::new(spec))).map_err(LabError::Spec);
        };
        let mut parts = rest.split(':').skip(1);
        let bad = || LabError::Spec(format!("bad cheat spec {s:?}"));
        let rollouts = parts.next().map_or(Ok(1), |n| n.parse().map_err(|_| bad()))?;
        let slip = parts.next().map_or(Ok(0.0), |n| n.parse().map_err(|_| bad()))?;
        Ok(Actor::Cheat { rollouts, slip })
    }

    /// The simple bot, as an actor.
    pub fn simple() -> Actor {
        Actor::Bot(Box::new("simple".parse().expect("the simple bot parses")))
    }

    pub fn act(&self, state: &State, seat: Seat, rng: &mut ChaCha8Rng) -> Action {
        let legal = engine::legal_on_turn::<Mighty>(state);
        if legal.len() == 1 {
            return legal[0].clone();
        }
        let view = Mighty::view(state, Viewer::Seat(seat));
        match self {
            Actor::Bot(spec) => spec.build(seat).act(&view, &legal, rng),
            &Actor::Cheat { rollouts, slip } => {
                let usual = engine::Bot::act(&mut SimpleBot::default(), &view, &legal, rng);
                let base = legal.iter().position(|a| *a == usual).expect("legal");
                let mut scores = vec![Vec::with_capacity(rollouts); legal.len()];
                for _ in 0..rollouts.max(1) {
                    // Every action meets the same luck in each round.
                    let round = rng.random::<u64>();
                    for (a, score) in legal.iter().zip(&mut scores) {
                        let mut s = state.clone();
                        engine::apply_on_turn::<Mighty>(&mut s, a.clone()).expect("legal");
                        let mut r = ChaCha8Rng::seed_from_u64(round);
                        score.push(noisy_playout(s, seat, slip, &mut r) as f64);
                    }
                }
                let mut best = (0.0, base);
                for (i, s) in scores.iter().enumerate() {
                    let d: Vec<f64> = s.iter().zip(&scores[base]).map(|(a, b)| a - b).collect();
                    let n = d.len() as f64;
                    let mean = d.iter().sum::<f64>() / n;
                    let se = if n > 1.0 {
                        (d.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1.0) / n).sqrt()
                    } else {
                        0.0
                    };
                    if mean > best.0 && mean > se {
                        best = (mean, i);
                    }
                }
                legal[best.1].clone()
            }
        }
    }
}

/// Plays `state` to the end with simple bots that slip to a random legal
/// action this often: `me`'s payoff, 0 for a hand that has not ended in
/// 2000 steps (slips can pass a hand round and round).
fn noisy_playout(mut state: State, me: Seat, slip: f64, rng: &mut ChaCha8Rng) -> i64 {
    if slip <= 0.0 {
        return play_out(SimpleBot::default(), 0, state, me);
    }
    // Deals and slips draw from the one stream.
    let rng = RefCell::new(rng);
    let mut decide = |state: &State, seat: Seat, legal: &[Action]| {
        let rng = &mut **rng.borrow_mut();
        if rng.random_bool(slip) {
            legal[rng.random_range(0..legal.len())].clone()
        } else {
            let view = Mighty::view(state, Viewer::Seat(seat));
            engine::Bot::act(&mut SimpleBot::default(), &view, legal, rng)
        }
    };
    let steps = Cell::new(0);
    let stop = |_: &State| {
        steps.set(steps.get() + 1);
        steps.get() > 2000
    };
    harness::drive::<Mighty>(
        &mut state,
        &mut Shared(&rng),
        &mut decide,
        &stop,
        &mut (),
        &mut Vec::new(),
    )
    .expect("bots choose legal actions");
    Mighty::payoffs(&state).map_or(0, |p| p[me])
}

/// One generator, drawn from by turns through a shared cell.
struct Shared<'a, R>(&'a RefCell<R>);

impl<R: std::ops::DerefMut<Target = ChaCha8Rng>> RngCore for Shared<'_, R> {
    fn next_u32(&mut self) -> u32 {
        self.0.borrow_mut().next_u32()
    }

    fn next_u64(&mut self) -> u64 {
        self.0.borrow_mut().next_u64()
    }

    fn fill_bytes(&mut self, dest: &mut [u8]) {
        self.0.borrow_mut().fill_bytes(dest);
    }
}

/// The bots at a table, by phase: one actor for every seat, except one
/// seat that may play differently in one phase.
#[derive(Debug, Clone, Copy)]
pub struct Table<'a> {
    pub all: &'a Actor,
    pub focus: Option<(Seat, Phase, &'a Actor)>,
}

impl<'a> Table<'a> {
    /// The same actor in every seat.
    pub fn of(all: &'a Actor) -> Table<'a> {
        Table { all, focus: None }
    }

    pub fn actor(&self, seat: Seat, phase: Phase) -> &'a Actor {
        match self.focus {
            Some((s, p, actor)) if s == seat && p == phase => actor,
            _ => self.all,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Phase {
    Bidding,
    Exchange,
    Play,
    Over,
}

pub fn phase(state: &State) -> Phase {
    if matches!(Mighty::turn(state), Turn::Over) {
        return Phase::Over;
    }
    match Mighty::view(state, Viewer::Spectator).phase {
        PhaseView::Exchange { .. } => Phase::Exchange,
        PhaseView::Play { .. } => Phase::Play,
        PhaseView::Done { .. } => Phase::Over,
        PhaseView::Dealing | PhaseView::Bidding { .. } => Phase::Bidding,
    }
}

/// One decision, as an experiment saw it.
pub struct Decision<'a> {
    pub state: &'a State,
    pub seat: Seat,
    pub action: &'a Action,
    /// Its place in the hand's log.
    pub index: usize,
    /// The seat's randomness as it was before deciding.
    pub rng: ChaCha8Rng,
}

/// Plays on from `state` until the hand reaches a phase past `until`, with
/// `rngs` (one per seat and one for the dealer), appending every action
/// to `log`. Calls `watch` on each seat's decision.
pub fn advance(
    deal: u64,
    state: &mut State,
    table: &Table,
    rngs: &mut [ChaCha8Rng],
    log: &mut Vec<Action>,
    until: Phase,
    watch: &mut dyn FnMut(Decision),
) -> Result<()> {
    let seats = rngs.len() - 1;
    let (dealer, rngs) = {
        let (bots, dealer) = rngs.split_at_mut(seats);
        (&mut dealer[0], bots)
    };
    // The deciding seat's randomness before it decided, for the watcher.
    let before: RefCell<Option<ChaCha8Rng>> = RefCell::new(None);
    let start = log.len();
    let mut decide = |state: &State, seat: Seat, _: &[Action]| {
        *before.borrow_mut() = Some(rngs[seat].clone());
        table.actor(seat, phase(state)).act(state, seat, &mut rngs[seat])
    };
    let mut observe = |d: Decided<Mighty>| {
        let rng = before.borrow_mut().take().expect("decided just now");
        watch(Decision {
            state: d.state,
            seat: d.seat,
            action: d.action,
            index: start + d.step,
            rng,
        });
    };
    let mut steps = Vec::new();
    let result = harness::drive::<Mighty>(
        state,
        dealer,
        &mut decide,
        &|s: &State| phase(s) > until,
        &mut observe,
        &mut steps,
    );
    let failed = steps.len();
    log.extend(steps);
    result.map_err(|e| LabError::Hand {
        deal,
        what: format!("a bot's action at step {} was refused: {e}", start + failed),
    })
}
