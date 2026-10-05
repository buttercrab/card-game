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
//! Mighty's; nothing here knows how it was trained. A network that fails
//! to answer leaves the search without it: its candidates and baseline at
//! the root, and the baseline's move when it cannot value the leaves.
//!
//! [`SimpleBot`]: crate::SimpleBot

use crate::pimc::confident_best;
use crate::search::{self, Leaf, SearchBot};
use crate::seen::Seen;
use engine::{ActionValues, Bot, Encode};
use mighty::{Action, Mighty, View};
use rand::RngCore;
use std::fmt;
use std::sync::Arc;

/// The choice a candidate must beat, and the move made when the search
/// has nothing to go on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Baseline {
    /// [`crate::SimpleBot`]'s, as [`SearchBot`] does.
    Simple,
    /// The legal action the network values most.
    Network,
}

/// [`SearchBot`] with a Q network: see the module docs.
#[derive(Clone)]
pub struct HybridBot {
    /// Deals, reading, threads, the playouts' policy, the confidence a
    /// candidate needs and the time budget.
    pub search: SearchBot,
    /// The network, shared by every seat and thread that plays by it.
    pub values: Arc<dyn ActionValues>,
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
            && Arc::ptr_eq(&self.values, &other.values)
            && self.prior == other.prior
            && self.baseline == other.baseline
            && self.leaf == other.leaf
    }
}

impl Bot<Mighty> for HybridBot {
    fn act(&mut self, view: &View, legal: &[Action], rng: &mut dyn RngCore) -> Action {
        if legal.len() == 1 {
            return legal[0].clone();
        }
        let simple = |bot: &HybridBot| bot.search.policy.decide(&Seen::of_view(view), legal);
        if !search::searched(view) {
            return simple(self);
        }
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
            _ => simple(self),
        };
        if !candidates.contains(&base) {
            candidates.push(base.clone());
        }
        if candidates.len() == 1 {
            return base;
        }
        let leaf = self.leaf.map(|more| Leaf {
            more,
            values: &*self.values,
        });
        // No world to play out, or leaves the network fails to value,
        // leave nothing to go on.
        let Some(scored) = self.search.evaluate(view, legal, &candidates, leaf, rng) else {
            return base;
        };
        let at = candidates
            .iter()
            .position(|a| *a == base)
            .expect("the baseline is a candidate");
        candidates[confident_best(&scored.scores, &scored.weights, at, self.search.confidence)].clone()
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::LEAF_BATCH;
    use crate::simple::SimpleBot;
    use engine::{BeliefError, Game, Observation, Seat, Spec, Viewer};
    use mighty::State;
    use mighty::rules::Preset;
    use mighty::testing;
    use mighty::world::Phase;
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

    fn spec() -> Spec {
        let options = mighty::Options {
            rules: Preset::Gshs.rules(),
            first_bidder: 0,
        };
        Mighty::spec(&options).unwrap()
    }

    fn fake(favourite: Option<usize>) -> Arc<Fake> {
        Arc::new(Fake {
            spec: spec(),
            favourite,
            asked: AtomicUsize::new(0),
            calls: AtomicUsize::new(0),
        })
    }

    fn bot(values: &Arc<Fake>, prior: usize, baseline: Baseline, leaf: Option<usize>) -> HybridBot {
        HybridBot {
            search: SearchBot {
                samples: 12,
                budget: None,
                ..SearchBot::default()
            },
            values: values.clone(),
            prior,
            baseline,
            leaf,
        }
    }

    /// A position mid-play of 경기과고, by random play from a seeded deal.
    fn mid_play(seed: u64) -> (State, Seat) {
        let mut rng = ChaCha8Rng::seed_from_u64(seed);
        let options = mighty::Options {
            rules: Preset::Gshs.rules(),
            first_bidder: 0,
        };
        loop {
            let mut found = None;
            testing::play_hand(
                &options,
                &mut rng,
                &mut testing::by(SimpleBot::default()),
                &mut |state, seat| {
                    let reached = matches!(state.phase(), Phase::Play(p) if p.tricks.len() == 3 && p.plays.is_empty());
                    if reached {
                        found = Some((state.clone(), seat));
                    }
                    !reached
                },
            );
            if let Some(found) = found {
                return found;
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
        let choice = bot(&net, 0, Baseline::Simple, None).act(&view, &legal, &mut rng);
        assert!(legal.contains(&choice));
        assert_eq!(net.asked.load(Ordering::Relaxed), 0, "no network without its settings");

        let net = fake(None);
        let mut hybrid = bot(&net, 0, Baseline::Simple, Some(1));
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
            let mut hybrid = bot(&net, 2, Baseline::Network, None);
            hybrid.search.confidence = 1e9;
            assert_eq!(&hybrid.act(&view, &legal, &mut rng), pick);
            // A prior of one weighs nothing but the favourite: one call.
            let net = fake(Some(index));
            let mut hybrid = bot(&net, 1, Baseline::Network, Some(0));
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
        let mut hybrid = bot(&net, 3, Baseline::Network, Some(1));
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
        let broken: Arc<dyn ActionValues> = Arc::new(Broken(spec()));
        for seed in 0..3 {
            let (state, seat) = mid_play(seed);
            let view = Mighty::view(&state, Viewer::Seat(seat));
            let legal = Mighty::legal_actions(&state);
            let simple = SimpleBot::default().act(&view, &legal, &mut ChaCha8Rng::seed_from_u64(0));
            for (prior, baseline, leaf) in [(2, Baseline::Network, None), (0, Baseline::Simple, Some(1))] {
                let mut hybrid = HybridBot {
                    values: broken.clone(),
                    ..bot(&fake(None), prior, baseline, leaf)
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
