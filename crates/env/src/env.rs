//! Many hands stepped together, as one batch of arrays per step.

use crate::Error;
use crate::game::EnvGame;
use crate::hand::{Hand, Setup, Status, stream};
use engine::{Game, Seat, Spec, Viewer};
use rand::RngCore;
use rand_chacha::ChaCha8Rng;
use rayon::prelude::*;

/// Hands in a row a slot may play without the caller acting once before
/// it gives up: the controlled seats must be missing from every table.
const MAX_IDLE_HANDS: usize = 1000;

/// One step's output for every slot, one contiguous buffer per field,
/// row-major with the slot first. The observation fields have the
/// [`Spec`]'s shapes; see [`engine::Observation`].
#[derive(Debug, Clone, PartialEq)]
pub struct Batch {
    /// `[n, global]`.
    pub global: Vec<f32>,
    /// `[n, cards, card_features]`.
    pub cards: Vec<f32>,
    /// `[n, max_events, event_features]`.
    pub events: Vec<f32>,
    /// `[n, max_events]`.
    pub event_cards: Vec<i32>,
    /// `[n]`.
    pub events_len: Vec<i32>,
    /// `[n, actions]`: the legal mask of the seat to act.
    pub legal: Vec<bool>,
    /// `[n]`: the absolute seat to act, whose view the observation is.
    pub seat: Vec<i32>,
    /// `[n, max_seats]`: each seat's payoff, times the reward scale, for the
    /// hand that ended during this step; zero otherwise.
    pub reward: Vec<f32>,
    /// `[n]`: a hand ended during this step (its payoffs are in `reward`)
    /// and the observation is from the next one.
    pub done: Vec<bool>,
}

impl Batch {
    pub fn new(spec: &Spec, n: usize, max_seats: usize) -> Batch {
        Batch {
            global: vec![0.0; n * spec.global.len()],
            cards: vec![0.0; n * spec.cards.len() * spec.card_features.len()],
            events: vec![0.0; n * spec.max_events * spec.event_features.len()],
            event_cards: vec![-1; n * spec.max_events],
            events_len: vec![0; n],
            legal: vec![false; n * spec.actions.len()],
            seat: vec![0; n],
            reward: vec![0.0; n * max_seats],
            done: vec![false; n],
        }
    }

    /// Mutable views of each slot's rows, so slots can write in parallel.
    fn rows(&mut self) -> Vec<Row<'_>> {
        let n = self.seat.len();
        let width = |v: usize| v / n.max(1);
        let (g, c, e, ec, l, r) = (
            width(self.global.len()),
            width(self.cards.len()),
            width(self.events.len()),
            width(self.event_cards.len()),
            width(self.legal.len()),
            width(self.reward.len()),
        );
        let mut global = self.global.chunks_mut(g);
        let mut cards = self.cards.chunks_mut(c);
        let mut events = self.events.chunks_mut(e);
        let mut event_cards = self.event_cards.chunks_mut(ec);
        let mut legal = self.legal.chunks_mut(l);
        let mut reward = self.reward.chunks_mut(r);
        let mut next = || {
            Some(Row {
                global: global.next()?,
                cards: cards.next()?,
                events: events.next()?,
                event_cards: event_cards.next()?,
                legal: legal.next()?,
                reward: reward.next()?,
            })
        };
        let rows: Vec<Row> = std::iter::from_fn(&mut next).take(n).collect();
        assert_eq!(rows.len(), n, "every field has a row per slot");
        rows
    }
}

/// One slot's rows of a [`Batch`]; the scalar fields are written apart.
struct Row<'a> {
    global: &'a mut [f32],
    cards: &'a mut [f32],
    events: &'a mut [f32],
    event_cards: &'a mut [i32],
    legal: &'a mut [bool],
    reward: &'a mut [f32],
}

/// What one slot reports for a step besides its rows.
struct Scalars {
    events_len: i32,
    seat: i32,
    done: bool,
}

/// The caller's decision a slot waits on.
struct Pending<G: Game> {
    seat: Seat,
    view: G::View,
    legal: Vec<G::Action>,
}

/// One environment of the batch: a stream of hands.
struct Slot<G: EnvGame> {
    /// Draws each hand's seed.
    seeds: ChaCha8Rng,
    hand: Hand<G>,
    pending: Option<Pending<G>>,
    /// The caller has acted in the hand under way, so its end is reported.
    caller_acted: bool,
}

impl<G: EnvGame> Slot<G> {
    fn new(setup: &Setup<G>, mut seeds: ChaCha8Rng) -> Result<Slot<G>, Error> {
        let hand = Hand::new(setup, seeds.next_u64())?;
        Ok(Slot {
            seeds,
            hand,
            pending: None,
            caller_acted: false,
        })
    }

    /// Plays chance and bot turns, starting new hands as hands end, until
    /// a controlled seat must act. Returns the payoffs of a hand that ended
    /// on the way, if the caller played in it.
    fn run(&mut self, setup: &Setup<G>) -> Result<Option<Vec<i64>>, Error> {
        let mut ended = None;
        for _ in 0..MAX_IDLE_HANDS {
            match self.hand.advance(|_| {})? {
                Status::ToAct(seat) => {
                    let state = self.hand.state();
                    self.pending = Some(Pending {
                        seat,
                        view: G::view(state, Viewer::Seat(seat)),
                        legal: G::legal_actions(state, seat),
                    });
                    return Ok(ended);
                }
                Status::Over => {
                    if self.caller_acted {
                        ended = Some(self.hand.payoffs().expect("a hand over has payoffs"));
                    }
                    self.hand = Hand::new(setup, self.seeds.next_u64())?;
                    self.caller_acted = false;
                }
            }
        }
        Err(Error::Config(format!(
            "{MAX_IDLE_HANDS} hands in a row without a controlled seat at the table"
        )))
    }

    fn write(&self, row: Row, ended: Option<Vec<i64>>, reward_scale: f32) -> Scalars {
        let pending = self.pending.as_ref().expect("a slot waits on the caller after running");
        let obs = G::encode(&pending.view, &pending.legal);
        row.global.copy_from_slice(&obs.global);
        row.cards.copy_from_slice(&obs.cards);
        row.events.copy_from_slice(&obs.events);
        row.event_cards.copy_from_slice(&obs.event_cards);
        row.legal.copy_from_slice(&obs.legal);
        row.reward.fill(0.0);
        if let Some(payoffs) = &ended {
            for (r, &p) in row.reward.iter_mut().zip(payoffs) {
                *r = p as f32 * reward_scale;
            }
        }
        Scalars {
            events_len: obs.events_len as i32,
            seat: pending.seat as i32,
            done: ended.is_some(),
        }
    }
}

/// How the batch runs; the game-side choices are in [`Setup`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Config {
    /// Hands played side by side.
    pub num_envs: usize,
    /// Slot `i` draws its hands' seeds from this seed's stream `i`, so a
    /// slot plays the same hands whatever the batch size or thread count.
    pub seed: u64,
    /// Rewards are payoffs times this: 1 keeps the game's points.
    pub reward_scale: f32,
    /// Worker threads; 0 for one per core.
    pub threads: usize,
}

/// A batch of hands for a caller playing some seats, the rest played by
/// bots, every hand reproducible from its seed.
///
/// Each step takes one action per slot, for the seat that slot's last
/// observation was for, plays bots and deals until a seat the caller
/// controls must act again, and returns that seat's observation. A hand
/// that ends restarts at once with the next seed (auto-reset): the step
/// that ends it reports `done` and every seat's payoff as `reward`, and
/// its observation is already from the new hand. Hands in which the
/// caller never acted are played but not reported.
///
/// Reward convention: zero on every step but the one that ends a hand,
/// then each seat's payoff for the hand (the game's points, zero-sum in
/// Mighty) times [`Config::reward_scale`], indexed by absolute seat.
pub struct Env<G: EnvGame> {
    setup: Setup<G>,
    config: Config,
    spec: Spec,
    pool: rayon::ThreadPool,
    slots: Vec<Slot<G>>,
}

impl<G: EnvGame> Env<G> {
    pub fn new(setup: Setup<G>, config: Config) -> Result<Env<G>, Error> {
        if config.num_envs == 0 {
            return Err(Error::Config("num_envs must be at least 1".into()));
        }
        if !setup.controlled.iter().any(|&c| c) {
            return Err(Error::Config("the caller controls no seat".into()));
        }
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(config.threads)
            .build()
            .map_err(|e| Error::Config(e.to_string()))?;
        // Every rule set of a game has the same spec; any one gives it.
        let mut rng = stream(config.seed, 0);
        let rules = setup.rules.draw::<G>(&mut rng)?;
        let spec =
            G::spec(&crate::game::draw_options::<G>(&rules, &mut rng)).map_err(|e| Error::Rules(e.to_string()))?;
        let mut env = Env {
            setup,
            config,
            spec,
            pool,
            slots: Vec::new(),
        };
        env.reseed(config.seed)?;
        Ok(env)
    }

    fn reseed(&mut self, seed: u64) -> Result<(), Error> {
        self.config.seed = seed;
        self.slots = (0..self.config.num_envs as u64)
            .map(|i| Slot::new(&self.setup, stream(seed, i)))
            .collect::<Result<_, _>>()?;
        Ok(())
    }

    pub fn spec(&self) -> &Spec {
        &self.spec
    }

    pub fn setup(&self) -> &Setup<G> {
        &self.setup
    }

    pub fn num_envs(&self) -> usize {
        self.slots.len()
    }

    /// Each slot's hand under way.
    pub fn hands(&self) -> impl Iterator<Item = &Hand<G>> {
        self.slots.iter().map(|s| &s.hand)
    }

    /// Starts every slot afresh and returns the first observations: from
    /// `seed`'s streams when given (the hands a new environment with that
    /// seed plays), otherwise with each slot's next hand (its first, before
    /// any step). Hands under way are dropped unreported.
    pub fn reset(&mut self, seed: Option<u64>) -> Result<Batch, Error> {
        let started = self.slots.iter().any(|s| s.pending.is_some());
        match seed {
            Some(seed) => self.reseed(seed)?,
            None if started => {
                for slot in &mut self.slots {
                    slot.hand = Hand::new(&self.setup, slot.seeds.next_u64())?;
                    slot.caller_acted = false;
                }
            }
            None => {}
        }
        let mut batch = self.new_batch();
        self.advance((0..self.slots.len()).map(|_| None).collect(), &mut batch)?;
        Ok(batch)
    }

    /// Plays `actions[i]` (an index into the spec's actions) in slot `i`.
    /// Checks every action before playing any, so an illegal one leaves
    /// the environment as it was.
    pub fn step(&mut self, actions: &[usize]) -> Result<Batch, Error> {
        let mut batch = self.new_batch();
        self.step_into(actions, &mut batch)?;
        Ok(batch)
    }

    /// [`Env::step`] into a batch made by [`Env::new_batch`], reusing its
    /// buffers.
    pub fn step_into(&mut self, actions: &[usize], batch: &mut Batch) -> Result<(), Error> {
        if actions.len() != self.slots.len() {
            return Err(Error::Config(format!(
                "{} actions for {} environments",
                actions.len(),
                self.slots.len()
            )));
        }
        let chosen = self
            .slots
            .iter()
            .zip(actions)
            .enumerate()
            .map(|(slot, (s, &index))| {
                let pending = s.pending.as_ref().ok_or(Error::NotReset)?;
                G::action_from_index(&pending.view, &pending.legal, index)
                    .map(Some)
                    .ok_or(Error::IllegalAction { slot, index })
            })
            .collect::<Result<_, _>>()?;
        self.advance(chosen, batch)
    }

    /// A batch with this environment's shapes, for [`Env::step_into`].
    pub fn new_batch(&self) -> Batch {
        Batch::new(&self.spec, self.slots.len(), G::MAX_SEATS)
    }

    /// Applies each slot's action, if any, runs every slot to the caller's
    /// next decision and writes the batch, slots in parallel.
    fn advance(&mut self, actions: Vec<Option<G::Action>>, batch: &mut Batch) -> Result<(), Error> {
        let (setup, scale) = (&self.setup, self.config.reward_scale);
        let slots = &mut self.slots;
        let rows = batch.rows();
        let scalars = self.pool.install(|| {
            slots
                .par_iter_mut()
                .zip(actions)
                .zip(rows)
                .map(|((slot, action), row)| {
                    if let Some(action) = action {
                        slot.pending = None;
                        slot.caller_acted = true;
                        slot.hand.act(action)?;
                    }
                    let ended = slot.run(setup)?;
                    Ok(slot.write(row, ended, scale))
                })
                .collect::<Result<Vec<Scalars>, Error>>()
        })?;
        for (i, s) in scalars.into_iter().enumerate() {
            batch.events_len[i] = s.events_len;
            batch.seat[i] = s.seat;
            batch.done[i] = s.done;
        }
        Ok(())
    }

    /// For each slot, where the cards the seat to act cannot see really
    /// are (see [`engine::Encode::belief_targets`]): `[n, cards]`, for training
    /// a belief model. Never part of an observation.
    pub fn belief_targets(&self) -> Result<Vec<i32>, Error> {
        let mut targets = Vec::with_capacity(self.slots.len() * self.spec.cards.len());
        for slot in &self.slots {
            let pending = slot.pending.as_ref().ok_or(Error::NotReset)?;
            targets.extend(G::belief_targets(slot.hand.state(), pending.seat));
        }
        Ok(targets)
    }
}
