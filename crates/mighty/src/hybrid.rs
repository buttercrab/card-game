//! 고수 leaning on a learned network: the search of [`SearchBot`] (deal
//! the unseen cards many ways, play each candidate out, keep the best
//! on average), with a Q network ([`ActionValues`]: the payoff the
//! acting seat can expect after each legal action, as self-play DMC
//! learns it) in three places, each a setting:
//!
//! - **which moves to weigh** ([`HybridBot::prior`]): the `k` legal
//!   actions the network values most, instead of the search's
//!   hand-written candidates (the cheapest bids, sensible discards, …);
//! - **what to beat** ([`HybridBot::baseline`]): a candidate replaces the
//!   network's own choice only when it does better by more than
//!   [`SearchBot::confidence`] standard errors over the sampled deals,
//!   instead of [`SimpleBot`]'s choice;
//! - **where playouts stop** ([`HybridBot::leaf`]): after `k` more tricks,
//!   at the searching seat's next turn, the network values the position
//!   from that seat's view (its best action's value), instead of playing
//!   to the end with [`SimpleBot`]. Shorter playouts are cheaper and
//!   less tied to the simple bot's play; the price is a network call per
//!   playout, batched.
//!
//! Every setting off, it is the search itself (but for the baseline
//! always being a candidate). The network can be any whose encoding is
//! Mighty's; nothing here knows how it was trained.
//!
//! [`SimpleBot`]: crate::bot::SimpleBot

use crate::Mighty;
use crate::search::{self, SearchBot};
use crate::state::{Action, Phase, State};
use crate::view::{PhaseView, Seen, View};
use engine::{ActionValues, Bot, Encode, Game, Observation, Seat, Turn, Viewer};
use rand::RngCore;
use std::fmt;

/// Positions valued by one network call at the leaves.
const LEAF_BATCH: usize = 256;

/// The choice a candidate must beat, and the move made when the search
/// has nothing to go on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Baseline {
    /// [`crate::bot::SimpleBot`]'s, as [`SearchBot`] does.
    Simple,
    /// The legal action the network values most.
    Network,
}

/// [`SearchBot`] with a Q network: see the module docs.
#[derive(Clone, Copy)]
pub struct HybridBot {
    /// Deals, reading, threads, the playouts' policy and the confidence a
    /// candidate needs. Its time budget is not used: the hybrid deals
    /// `samples` worlds every decision.
    pub search: SearchBot,
    /// The network. Loaded once for the life of the process (leak a `Box`),
    /// which keeps the bot `Copy`.
    pub values: &'static dyn ActionValues,
    /// Weigh the `prior` legal actions the network values most; 0 weighs
    /// the search's own candidates ([`search::candidates`]).
    pub prior: usize,
    pub baseline: Baseline,
    /// Value playouts by the network at the searching seat's first turn
    /// once this many more tricks are done; `None` plays them out.
    pub leaf: Option<usize>,
}

impl fmt::Debug for HybridBot {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HybridBot")
            .field("search", &self.search)
            .field("values", &self.values.spec().version)
            .field("prior", &self.prior)
            .field("baseline", &self.baseline)
            .field("leaf", &self.leaf)
            .finish()
    }
}

/// Equal when the settings are and the network is the same one.
impl PartialEq for HybridBot {
    fn eq(&self, other: &HybridBot) -> bool {
        self.search == other.search
            && std::ptr::addr_eq(self.values, other.values)
            && self.prior == other.prior
            && self.baseline == other.baseline
            && self.leaf == other.leaf
    }
}

/// How a playout ended: a payoff, or a position for the network.
enum Outcome {
    Payoff(f64),
    Leaf(Observation),
}

impl Bot<Mighty> for HybridBot {
    fn act(&mut self, view: &View, legal: &[Action], rng: &mut dyn RngCore) -> Action {
        let searched = matches!(
            (&view.viewer, &view.phase),
            (
                Viewer::Seat(_),
                PhaseView::Bidding { .. } | PhaseView::Exchange { .. } | PhaseView::Play { .. }
            )
        );
        if legal.len() == 1 {
            return legal[0].clone();
        }
        if !searched {
            return self.search.policy.act(view, legal, rng);
        }
        let Viewer::Seat(me) = view.viewer else {
            unreachable!("matched above")
        };
        // A network that fails to answer leaves the search as it would be
        // without it.
        let network = (self.prior > 0 || self.baseline == Baseline::Network)
            .then(|| self.root_values(view, legal))
            .flatten();
        let mut candidates = match &network {
            Some(values) if self.prior > 0 => values.iter().take(self.prior).map(|(a, _)| a.clone()).collect(),
            _ => search::candidates(view, legal),
        };
        let base = match (&network, self.baseline) {
            (Some(values), Baseline::Network) => values[0].0.clone(),
            _ => self.search.policy.act(view, legal, rng),
        };
        if !candidates.contains(&base) {
            candidates.push(base.clone());
        }
        if candidates.len() == 1 {
            return base;
        }
        let worlds = self.search.worlds(view, self.search.samples, rng);
        if worlds.is_empty() {
            return base;
        }
        // Leaves the network fails to value leave nothing to go on.
        let Some(scores) = self.scores(&worlds, me, &candidates) else {
            return base;
        };
        let weights: Vec<f64> = worlds.iter().map(|(_, w)| *w).collect();
        let at = candidates
            .iter()
            .position(|a| *a == base)
            .expect("the baseline is a candidate");
        candidates[confident_best(&scores, &weights, at, self.search.confidence)].clone()
    }
}

impl HybridBot {
    /// The legal actions with the network's values for them, best first;
    /// `None` when the network fails or values none of them.
    fn root_values(&self, view: &View, legal: &[Action]) -> Option<Vec<(Action, f32)>> {
        let obs = Mighty::encode(view, legal);
        let values = self.values.action_values(&[&obs]).ok()?;
        let mut out: Vec<(Action, f32)> = values
            .first()?
            .iter()
            .filter_map(|&(index, v)| Some((Mighty::action_from_index(view, legal, index)?, v)))
            .collect();
        out.sort_by(|a, b| b.1.total_cmp(&a.1));
        (!out.is_empty()).then_some(out)
    }

    /// Every candidate played out on every world: `[candidate][world]`,
    /// `me`'s payoff or the network's value at the leaf. Worlds are split
    /// between the search's threads, each valuing its own leaves.
    /// `None` when the network fails to value leaves.
    fn scores(&self, worlds: &[(State, f64)], me: Seat, candidates: &[Action]) -> Option<Vec<Vec<f64>>> {
        let threads = self.search.threads.clamp(1, worlds.len());
        if threads == 1 {
            return self.score_part(worlds, me, candidates);
        }
        let share = worlds.len().div_ceil(threads);
        let parts: Vec<Option<Vec<Vec<f64>>>> = std::thread::scope(|scope| {
            let handles: Vec<_> = worlds
                .chunks(share)
                .map(|part| scope.spawn(move || self.score_part(part, me, candidates)))
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().expect("hybrid search thread panicked"))
                .collect()
        });
        // Contiguous runs of worlds, joined in order: scores stay paired
        // with the worlds' weights.
        let mut scores = vec![Vec::with_capacity(worlds.len()); candidates.len()];
        for part in parts {
            for (all, part) in scores.iter_mut().zip(part?) {
                all.extend(part);
            }
        }
        Some(scores)
    }

    fn score_part(&self, worlds: &[(State, f64)], me: Seat, candidates: &[Action]) -> Option<Vec<Vec<f64>>> {
        let mut scores = vec![vec![0.0; worlds.len()]; candidates.len()];
        let mut pending: Vec<(usize, usize, Observation)> = Vec::new();
        for (w, (world, _)) in worlds.iter().enumerate() {
            for (c, action) in candidates.iter().enumerate() {
                match self.playout(world, action, me) {
                    Outcome::Payoff(p) => scores[c][w] = p,
                    Outcome::Leaf(obs) => {
                        pending.push((c, w, obs));
                        if pending.len() >= LEAF_BATCH {
                            self.value_leaves(&mut pending, &mut scores)?;
                        }
                    }
                }
            }
        }
        self.value_leaves(&mut pending, &mut scores)?;
        Some(scores)
    }

    /// Values the pending leaves in one network call: each the value of
    /// its seat's best legal action. `None` when the network fails.
    fn value_leaves(&self, pending: &mut Vec<(usize, usize, Observation)>, scores: &mut [Vec<f64>]) -> Option<()> {
        if pending.is_empty() {
            return Some(());
        }
        let observations: Vec<&Observation> = pending.iter().map(|(_, _, o)| o).collect();
        let values = self.values.action_values(&observations).ok()?;
        if values.len() != pending.len() {
            return None;
        }
        for ((c, w, _), values) in pending.iter().zip(values) {
            let best = values
                .iter()
                .map(|&(_, v)| f64::from(v))
                .fold(f64::NEG_INFINITY, f64::max);
            scores[*c][*w] = if best.is_finite() { best } else { 0.0 };
        }
        pending.clear();
        Some(())
    }

    /// Plays `action` in `world`, then the simple bots until the hand ends
    /// or, with a [`HybridBot::leaf`], until `me`'s first turn once that
    /// many more tricks are done.
    fn playout(&self, world: &State, action: &Action, me: Seat) -> Outcome {
        let SearchBot { policy, endgame, .. } = self.search;
        let mut state = world.clone();
        state.step(me, action.clone());
        let Some(more) = self.leaf else {
            return Outcome::Payoff(search::finish(policy, endgame, state, me) as f64);
        };
        let horizon = tricks_done(world) + more;
        // As `search::finish`, which also gives up on endless redeals.
        for _ in 0..2000 {
            match state.turn() {
                Turn::Over => return Outcome::Payoff(state.payoffs().map_or(0, |p| p[me]) as f64),
                // A hand thrown in: the search's own playouts score the redeal.
                Turn::Chance => return Outcome::Payoff(search::finish(policy, endgame, state, me) as f64),
                Turn::Seat(seat) => {
                    if seat == me && tricks_done(&state) >= horizon {
                        let view = Mighty::view(&state, Viewer::Seat(me));
                        let legal = state.legal_actions();
                        return Outcome::Leaf(Mighty::encode(&view, &legal));
                    }
                    if endgame > 0
                        && let Some(payoffs) = crate::endgame::solve(&state, endgame)
                    {
                        return Outcome::Payoff(payoffs[me] as f64);
                    }
                    let legal = state.legal_actions();
                    let choice = policy.decide(&Seen::of_state(&state, seat), &legal);
                    state.step(seat, choice);
                }
            }
        }
        Outcome::Payoff(0.0)
    }
}

/// Tricks finished in the hand under way.
fn tricks_done(state: &State) -> usize {
    match state.phase() {
        Phase::Play(p) => p.tricks.len(),
        Phase::Done(_) => usize::MAX,
        _ => 0,
    }
}

/// The candidate that beats `base` by the most on the same deals, among
/// those that beat it by more than `z` standard errors; else `base`. As
/// the search's own rule, on real-valued scores (leaf values are not
/// whole points). Deals count by `weights`, which sum to 1.
fn confident_best(scores: &[Vec<f64>], weights: &[f64], base: usize, z: f64) -> usize {
    let n = 1.0 / weights.iter().map(|w| w * w).sum::<f64>();
    let mut best = (0.0, base);
    for (i, s) in scores.iter().enumerate() {
        let diffs: Vec<f64> = s.iter().zip(&scores[base]).map(|(a, b)| a - b).collect();
        let mean = diffs.iter().zip(weights).map(|(d, w)| d * w).sum::<f64>();
        let spread = diffs
            .iter()
            .zip(weights)
            .map(|(d, w)| (w * (d - mean)).powi(2))
            .sum::<f64>();
        let se = (spread * n / (n - 1.0).max(1.0)).sqrt();
        if mean > best.0 && mean > z * se {
            best = (mean, i);
        }
    }
    best.1
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine::{BeliefError, Spec};
    use rand::{Rng, SeedableRng};
    use rand_chacha::ChaCha8Rng;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A stand-in network: values an action by its index (or a fixed
    /// favourite above all), and counts the positions it is asked about.
    struct Fake {
        spec: Spec,
        favourite: Option<usize>,
        asked: AtomicUsize,
        calls: AtomicUsize,
    }

    impl ActionValues for Fake {
        fn action_values(&self, observations: &[&Observation]) -> Result<Vec<Vec<(usize, f32)>>, BeliefError> {
            self.asked.fetch_add(observations.len(), Ordering::Relaxed);
            self.calls.fetch_add(1, Ordering::Relaxed);
            Ok(observations
                .iter()
                .map(|o| {
                    (0..o.legal.len())
                        .filter(|&i| o.legal[i])
                        .map(|i| (i, if Some(i) == self.favourite { 1e6 } else { -(i as f32) }))
                        .collect()
                })
                .collect())
        }

        fn spec(&self) -> &Spec {
            &self.spec
        }
    }

    fn fake(favourite: Option<usize>) -> &'static Fake {
        let options = crate::Options {
            rules: crate::rules::Preset::Gshs.rules(),
            first_bidder: 0,
        };
        Box::leak(Box::new(Fake {
            spec: Mighty::spec(&options).unwrap(),
            favourite,
            asked: AtomicUsize::new(0),
            calls: AtomicUsize::new(0),
        }))
    }

    fn bot(values: &'static Fake, prior: usize, baseline: Baseline, leaf: Option<usize>) -> HybridBot {
        HybridBot {
            search: SearchBot {
                samples: 12,
                budget: None,
                ..SearchBot::default()
            },
            values,
            prior,
            baseline,
            leaf,
        }
    }

    /// A position mid-play of 경기과고, by random play from a seeded deal.
    fn mid_play(seed: u64) -> (State, Seat) {
        let mut rng = ChaCha8Rng::seed_from_u64(seed);
        let options = crate::Options {
            rules: crate::rules::Preset::Gshs.rules(),
            first_bidder: 0,
        };
        loop {
            let mut state = Mighty::new_game(&options).unwrap();
            let mut simple = crate::bot::SimpleBot::default();
            loop {
                match Mighty::turn(&state) {
                    Turn::Chance => {
                        let deal = Mighty::sample_chance(&state, &mut rng);
                        Mighty::apply(&mut state, deal).unwrap();
                    }
                    Turn::Seat(seat) => {
                        if let Phase::Play(p) = state.phase()
                            && p.tricks.len() == 3
                            && p.plays.is_empty()
                        {
                            return (state, seat);
                        }
                        let view = Mighty::view(&state, Viewer::Seat(seat));
                        let legal = Mighty::legal_actions(&state);
                        let action = simple.act(&view, &legal, &mut rng);
                        Mighty::apply(&mut state, action).unwrap();
                    }
                    Turn::Over => break,
                }
            }
        }
    }

    /// With leaves after one trick, every playout ends at the network
    /// (bar a hand that ends sooner), in batches; played out, never.
    #[test]
    fn leaves_are_valued_by_the_network_in_batches() {
        let (state, seat) = mid_play(1);
        let view = Mighty::view(&state, Viewer::Seat(seat));
        let legal = Mighty::legal_actions(&state);
        let mut rng = ChaCha8Rng::seed_from_u64(2);

        let net = fake(None);
        let choice = bot(net, 0, Baseline::Simple, None).act(&view, &legal, &mut rng);
        assert!(legal.contains(&choice));
        assert_eq!(net.asked.load(Ordering::Relaxed), 0, "no network without its settings");

        let net = fake(None);
        let mut hybrid = bot(net, 0, Baseline::Simple, Some(1));
        let candidates = search::candidates(&view, &legal).len().max(1);
        let choice = hybrid.act(&view, &legal, &mut rng);
        assert!(legal.contains(&choice));
        // One leaf per world and candidate (the simple bot's choice may
        // be one more), in as few calls as the batch allows.
        let asked = net.asked.load(Ordering::Relaxed);
        assert!(asked > 0 && asked <= 12 * (candidates + 1), "{asked} leaves");
        assert_eq!(net.calls.load(Ordering::Relaxed), asked.div_ceil(LEAF_BATCH));
    }

    /// The network as the baseline: with no deal to show anything better
    /// by a wide margin (an absurd confidence), its favourite is played.
    #[test]
    fn the_network_is_the_baseline_and_the_prior() {
        for seed in 0..4 {
            let (state, seat) = mid_play(seed);
            let view = Mighty::view(&state, Viewer::Seat(seat));
            let legal = Mighty::legal_actions(&state);
            if legal.len() < 2 {
                continue;
            }
            let mut rng = ChaCha8Rng::seed_from_u64(seed);
            let pick = &legal[rng.random_range(0..legal.len())];
            let index = Mighty::action_index(&view, pick).unwrap();
            // Played out to the end, so the deals disagree: a fixed leaf
            // value would give every deal the same margin, which no
            // confidence can outweigh.
            let net = fake(Some(index));
            let mut hybrid = bot(net, 2, Baseline::Network, None);
            hybrid.search.confidence = 1e9;
            assert_eq!(&hybrid.act(&view, &legal, &mut rng), pick);
            // A prior of one weighs nothing but the favourite: one call.
            let net = fake(Some(index));
            let mut hybrid = bot(net, 1, Baseline::Network, Some(0));
            assert_eq!(&hybrid.act(&view, &legal, &mut rng), pick);
            assert_eq!(net.calls.load(Ordering::Relaxed), 1);
        }
    }

    /// Threads split the worlds; every choice is legal, and the same seed
    /// gives the same choice.
    #[test]
    fn threads_choose_legally_and_reproducibly() {
        let (state, seat) = mid_play(5);
        let view = Mighty::view(&state, Viewer::Seat(seat));
        let legal = Mighty::legal_actions(&state);
        let net = fake(None);
        let mut hybrid = bot(net, 3, Baseline::Network, Some(1));
        hybrid.search.threads = 3;
        let a = hybrid.act(&view, &legal, &mut ChaCha8Rng::seed_from_u64(9));
        let b = hybrid.act(&view, &legal, &mut ChaCha8Rng::seed_from_u64(9));
        assert!(legal.contains(&a));
        assert_eq!(a, b);
    }

    /// A network that always fails.
    struct Broken(Spec);

    impl ActionValues for Broken {
        fn action_values(&self, _: &[&Observation]) -> Result<Vec<Vec<(usize, f32)>>, BeliefError> {
            Err(BeliefError("the model is gone".into()))
        }

        fn spec(&self) -> &Spec {
            &self.0
        }
    }

    /// A network that fails to answer leaves the simple bot's choice (the
    /// baseline it falls back to) instead of a panic, whatever it was
    /// asked for.
    #[test]
    fn a_failing_network_falls_back_to_the_simple_bot() {
        let options = crate::Options {
            rules: crate::rules::Preset::Gshs.rules(),
            first_bidder: 0,
        };
        let broken: &'static Broken = Box::leak(Box::new(Broken(Mighty::spec(&options).unwrap())));
        for seed in 0..3 {
            let (state, seat) = mid_play(seed);
            let view = Mighty::view(&state, Viewer::Seat(seat));
            let legal = Mighty::legal_actions(&state);
            let simple = crate::bot::SimpleBot::default().act(&view, &legal, &mut ChaCha8Rng::seed_from_u64(0));
            for (prior, baseline, leaf) in [(2, Baseline::Network, None), (0, Baseline::Simple, Some(1))] {
                let mut hybrid = HybridBot {
                    values: broken,
                    ..bot(fake(None), prior, baseline, leaf)
                };
                let choice = hybrid.act(&view, &legal, &mut ChaCha8Rng::seed_from_u64(seed));
                if leaf.is_some() {
                    assert_eq!(choice, simple, "leaves the network cannot value");
                } else {
                    assert!(legal.contains(&choice));
                }
            }
        }
    }

    #[test]
    fn a_wide_lead_overrides_the_baseline_and_a_narrow_one_does_not() {
        let weights = vec![0.25; 4];
        let base = vec![0.0, 1.0, 0.0, 1.0];
        assert_eq!(
            confident_best(&[base.clone(), vec![10.0, 11.0, 10.0, 11.0]], &weights, 0, 1.0),
            1
        );
        assert_eq!(confident_best(&[base, vec![3.0, -2.0, 2.0, -1.0]], &weights, 0, 1.0), 0);
    }
}
