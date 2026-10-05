//! A bot that searches. For each bid, discard, friend call and card it
//! plays, it deals the cards it cannot see in many ways consistent with
//! what it has seen and with the bidding, plays every candidate to the end
//! of the hand with [`SimpleBot`] in every seat, and picks the one with the
//! best average payoff (Perfect Information Monte Carlo, [`crate::pimc`]).
//! Deals count by how well they explain what the other players have bid
//! and played; see [`Reading`]. How the unseen cards are dealt is a
//! setting too: uniformly, or by a belief model ([`Sampler`]).

use crate::deal::Sampler;
use crate::pimc::{self, Deal, Dealer, Dealt, Outcome, best_average, confident_best, scatter};
use crate::read::{Memo, Reading};
use crate::seen::Seen;
use crate::simple::SimpleBot;
use engine::{ActionValues, Bot, Observation, Seat, Viewer};
use mighty::card::{ACE, Card};
use mighty::{Action, FriendCall, Mighty, PhaseView, State, View};
use rand::{Rng, RngCore};
use std::time::{Duration, Instant};

/// Positions valued by one network call at the leaves.
pub(crate) const LEAF_BATCH: usize = 256;

#[derive(Debug, Clone, PartialEq)]
pub struct SearchBot {
    /// Most deals sampled per decision. Up to a few hundred, more is
    /// measurably stronger.
    pub samples: usize,
    /// How sure the search must be before it overrides [`SimpleBot`]: the
    /// gain over the simple bot's choice, across the sampled deals, must
    /// exceed this many standard errors. 0 takes the best average.
    pub confidence: f64,
    /// Stop dealing once a decision has taken this long, so that one with
    /// many candidates, or a slow machine, still answers in time.
    pub budget: Option<Duration>,
    /// The bot that plays every seat in the playouts, and whose choice the
    /// search must beat.
    pub policy: SimpleBot,
    /// How much each sampled deal counts, by how well it explains what the
    /// other players have done.
    pub reading: Reading,
    /// Threads dealing and playing out deals at once. The deals are split
    /// between them, and so is the budget's work.
    pub threads: usize,
    /// Playouts solve the last this many tricks exactly, every hand being
    /// known in a sampled deal (see [`crate::endgame`]), instead of playing
    /// them with the simple bot. 0 plays every trick with the simple bot.
    pub endgame: usize,
    /// How the unseen cards are dealt. Uniformly by default, as at the
    /// table; by a belief model's predictions with [`Sampler::Belief`].
    pub sampler: Sampler,
}

impl Default for SearchBot {
    fn default() -> SearchBot {
        SearchBot {
            samples: 200,
            confidence: 1.0,
            budget: Some(Duration::from_secs(1)),
            policy: SimpleBot::default(),
            reading: Reading::default(),
            threads: 1,
            endgame: 0,
            sampler: Sampler::Uniform,
        }
    }
}

impl Bot<Mighty> for SearchBot {
    fn act(&mut self, view: &View, legal: &[Action], rng: &mut dyn RngCore) -> Action {
        let usual = |bot: &SearchBot| bot.policy.decide(&Seen::of_view(view), legal);
        if !searched(view) {
            return usual(self);
        }
        let candidates = candidates(view, legal);
        if candidates.len() == 1 {
            return candidates[0].clone();
        }
        let Some(scored) = self.evaluate(view, legal, &candidates, None, rng) else {
            return usual(self);
        };
        let usual = usual(self);
        let choice = match candidates.iter().position(|a| *a == usual) {
            Some(base) => confident_best(&scored.scores, &scored.weights, base, self.confidence),
            None => best_average(&scored.scores, &scored.weights),
        };
        candidates[choice].clone()
    }
}

/// Where playouts stop to ask a network instead ([`crate::HybridBot`]):
/// at the searching seat's first turn once `more` more tricks are done,
/// valued as its best legal action.
#[derive(Clone, Copy)]
pub(crate) struct Leaf<'a> {
    pub more: usize,
    pub values: &'a dyn ActionValues,
}

/// Every candidate played out on the same sampled worlds.
pub(crate) struct Scored {
    /// `[candidate][world]`: the searching seat's payoff, or the network's
    /// value at a leaf.
    pub scores: Vec<Vec<f64>>,
    /// Each world's weight by [`Reading`]; they sum to 1.
    pub weights: Vec<f64>,
}

/// Whether the search decides for this view: a seat bidding, exchanging
/// or playing.
pub(crate) fn searched(view: &View) -> bool {
    matches!(
        (&view.viewer, &view.phase),
        (
            Viewer::Seat(_),
            PhaseView::Bidding { .. } | PhaseView::Exchange { .. } | PhaseView::Play { .. }
        )
    )
}

impl SearchBot {
    /// Up to `n` worlds `view` cannot tell from the real one, each with its
    /// weight by [`Reading`] (the weights sum to 1). For experiments that
    /// search choices this bot does not, such as whole sets of discards.
    pub fn worlds(&self, view: &View, n: usize, rng: &mut dyn RngCore) -> Vec<(State, f64)> {
        let mut memo = Memo::default();
        let me = match view.viewer {
            Viewer::Seat(me) => me,
            Viewer::Spectator => return Vec::new(),
        };
        let Some(dealer) = Dealer::new(view) else {
            return Vec::new();
        };
        // Whatever the seat may do next: these worlds are for any choice.
        let deal = self.sampler.prepare(view, &[], &dealer);
        let world = Worlds {
            dealer: &dealer,
            deal: &*deal,
        };
        let drawn: Vec<(State, f64)> = (0..n).filter_map(|_| self.draw(&world, me, rng, &mut memo)).collect();
        let log_weights: Vec<f64> = drawn.iter().map(|(_, w)| *w).collect();
        let weights = self.reading.weights(&log_weights);
        drawn.into_iter().map(|(s, _)| s).zip(weights).collect()
    }

    /// Plays every candidate out on up to [`SearchBot::samples`] worlds
    /// `view`'s seat cannot tell from the real one, until the budget runs
    /// out, split between the threads; with a `leaf`, playouts stop there.
    /// Every candidate meets the same worlds, so luck in the sampling
    /// affects them all alike. `None` when no world could be dealt, or the
    /// network failed to value a leaf.
    pub(crate) fn evaluate(
        &self,
        view: &View,
        legal: &[Action],
        candidates: &[Action],
        leaf: Option<Leaf>,
        rng: &mut dyn RngCore,
    ) -> Option<Scored> {
        let Viewer::Seat(me) = view.viewer else { return None };
        let dealer = Dealer::new(view)?;
        let started = Instant::now();
        // Worked out once for the whole decision: a model is asked once.
        let deal = self.sampler.prepare(view, legal, &dealer);
        let worlds = Worlds {
            dealer: &dealer,
            deal: &*deal,
        };
        let threads = self.threads.max(1);
        let share = self.samples.div_ceil(threads);
        let parts = scatter(threads, rng, |_, rng| {
            self.search(&worlds, me, candidates, share, started, leaf, rng)
        });
        // Each part is a run of whole worlds, so joining them keeps the
        // candidates' scores paired world by world.
        let mut scores = vec![Vec::new(); candidates.len()];
        let mut log_weights = Vec::new();
        for part in parts {
            let (part_scores, part_weights) = part?;
            for (all, part) in scores.iter_mut().zip(part_scores) {
                all.extend(part);
            }
            log_weights.extend(part_weights);
        }
        if log_weights.is_empty() {
            return None;
        }
        let weights = self.reading.weights(&log_weights);
        Some(Scored { scores, weights })
    }

    /// One thread's share of [`SearchBot::evaluate`]: deals up to `samples`
    /// worlds and plays every candidate out on each. The scores per
    /// candidate, world by world, and each world's log weight; `None` when
    /// the network fails.
    #[allow(clippy::too_many_arguments)]
    fn search(
        &self,
        worlds: &Worlds,
        me: Seat,
        candidates: &[Action],
        samples: usize,
        started: Instant,
        leaf: Option<Leaf>,
        rng: &mut dyn RngCore,
    ) -> Option<(Vec<Vec<f64>>, Vec<f64>)> {
        let mut scores: Vec<Vec<f64>> = vec![Vec::new(); candidates.len()];
        let mut log_weights = Vec::new();
        let mut memo = Memo::default();
        let mut pending: Vec<(usize, usize, Observation)> = Vec::new();
        for _ in 0..samples {
            if self.budget.is_some_and(|budget| started.elapsed() >= budget) {
                break;
            }
            let Some((world, log_weight)) = self.draw(worlds, me, rng, &mut memo) else {
                continue;
            };
            let w = log_weights.len();
            log_weights.push(log_weight);
            for (c, action) in candidates.iter().enumerate() {
                let outcome = pimc::playout(&self.policy, self.endgame, &world, action, me, leaf.map(|l| l.more));
                scores[c].push(match outcome {
                    Outcome::Payoff(payoff) => payoff as f64,
                    Outcome::Leaf(obs) => {
                        pending.push((c, w, obs));
                        f64::NAN
                    }
                });
                if let Some(leaf) = leaf
                    && pending.len() >= LEAF_BATCH
                {
                    value_leaves(leaf.values, &mut pending, &mut scores)?;
                }
            }
        }
        if let Some(leaf) = leaf {
            value_leaves(leaf.values, &mut pending, &mut scores)?;
        }
        Some((scores, log_weights))
    }

    /// A world to play out, and its log weight. Reading the table samples
    /// several and keeps one in proportion to its weight, so that fewer
    /// playouts go to deals the other players' actions rule out; the one
    /// kept carries their average weight.
    fn draw(&self, worlds: &Worlds, me: Seat, rng: &mut dyn RngCore, memo: &mut Memo) -> Option<(State, f64)> {
        let dealer = worlds.dealer;
        if !self.reading.on {
            return Some((self.sample(worlds, rng)?, 0.0));
        }
        let mut kept = None;
        let mut total = f64::NEG_INFINITY;
        let draws = self.reading.draws.max(1);
        // Most draws are read and dropped: deal them all into one world.
        let mut world = dealer.template.clone();
        for _ in 0..draws {
            dealer.fill(&mut world, self.sample_hands(worlds, rng)?);
            let log_weight = self.reading.log_weight(&self.policy, &world, me, memo);
            let top = total.max(log_weight);
            total = top + ((total - top).exp() + (log_weight - top).exp()).ln();
            if rng.random::<f64>() < (log_weight - total).exp() {
                kept = Some(world.clone());
            }
        }
        Some((kept?, total - (draws as f64).ln()))
    }

    /// A determinized world, redealt up to 20 times until the policy would
    /// have bid what the declarer, or the best bidder so far, did. Past
    /// that, a wrong guess about how they bid is likelier than bad luck.
    fn sample(&self, worlds: &Worlds, rng: &mut dyn RngCore) -> Option<State> {
        let mut world = worlds.dealer.template.clone();
        worlds.dealer.fill(&mut world, self.sample_hands(worlds, rng)?);
        Some(world)
    }

    /// The cards of [`SearchBot::sample`]'s world, before it is built.
    fn sample_hands(&self, worlds: &Worlds, rng: &mut dyn RngCore) -> Option<Dealt> {
        let Worlds { dealer, deal } = *worlds;
        let mut dealt = deal.hands(dealer, rng)?;
        for _ in 0..20 {
            if dealer.agrees_with_bidding(&self.policy, &dealt) {
                break;
            }
            dealt = deal.hands(dealer, rng)?;
        }
        Some(dealt)
    }
}

/// Values the pending leaves in one network call, each as its seat's best
/// legal action. `None` when the network fails.
fn value_leaves(
    values: &dyn ActionValues,
    pending: &mut Vec<(usize, usize, Observation)>,
    scores: &mut [Vec<f64>],
) -> Option<()> {
    if pending.is_empty() {
        return Some(());
    }
    let observations: Vec<&Observation> = pending.iter().map(|(_, _, o)| o).collect();
    let valued = values.action_values(&observations).ok()?;
    if valued.len() != pending.len() {
        return None;
    }
    for ((c, w, _), valued) in pending.iter().zip(valued) {
        let best = valued
            .iter()
            .map(|&(_, v)| f64::from(v))
            .fold(f64::NEG_INFINITY, f64::max);
        scores[*c][*w] = if best.is_finite() { best } else { 0.0 };
    }
    pending.clear();
    Some(())
}

/// What one decision's worlds are dealt from: the view, worked out, and
/// the [`Sampler`]'s strategy for it.
#[derive(Clone, Copy)]
struct Worlds<'a> {
    dealer: &'a Dealer,
    deal: &'a dyn Deal,
}

/// Every legal card, except a joker on the first trick when anything else
/// will do: it has no power there, and the playouts undervalue keeping it.
fn play_candidates(legal: &[Action], trick_no: usize) -> Vec<Action> {
    let keep = |a: &&Action| !(trick_no == 0 && matches!(a, Action::Play { card, .. } if card.is_joker()));
    let out: Vec<Action> = legal.iter().filter(keep).cloned().collect();
    if out.is_empty() { legal.to_vec() } else { out }
}

/// While discarding, every card but the mighty and jokers; when calling a
/// friend, the strongest cards not in hand, the first trick, and playing
/// alone.
fn exchange_candidates(view: &View, legal: &[Action]) -> Vec<Action> {
    let PhaseView::Exchange { contract, .. } = &view.phase else {
        return legal.to_vec();
    };
    let trump = contract.trump;
    let mighty = view.rules.mighty(trump);
    if legal.iter().any(|a| matches!(a, Action::Discard(_))) {
        let out: Vec<Action> = legal
            .iter()
            .filter(|a| {
                !matches!(a, Action::Discard(c) if *c == mighty || c.is_joker()) && !matches!(a, Action::Raise(_))
            })
            .cloned()
            .collect();
        return if out.is_empty() { legal.to_vec() } else { out };
    }
    let mut calls: Vec<FriendCall> = vec![FriendCall::Card(mighty)];
    calls.extend(view.rules.deck.jokers().iter().map(|&j| FriendCall::Card(j)));
    if let Some(t) = trump {
        calls.extend([ACE, ACE - 1, ACE - 2].map(|r| FriendCall::Card(Card::new(t, r))));
    }
    calls.extend([FriendCall::FirstTrick, FriendCall::Alone]);
    let discarded = crate::simple::discarded(&Seen::of_view(view));
    let out: Vec<Action> = calls
        .into_iter()
        .filter(|c| !matches!(c, FriendCall::Card(card) if view.hand.contains(card) || discarded.contains(card)))
        .map(Action::CallFriend)
        .filter(|a| legal.contains(a))
        .collect();
    if out.is_empty() { legal.to_vec() } else { out }
}

/// Passing, a misdeal when allowed, and the three cheapest bids in each
/// trump. Higher bids rarely pay and would multiply the work.
fn bid_candidates(legal: &[Action]) -> Vec<Action> {
    let mut out: Vec<Action> = legal
        .iter()
        .filter(|a| matches!(a, Action::Pass | Action::Misdeal))
        .cloned()
        .collect();
    let mut bids: Vec<_> = legal
        .iter()
        .filter_map(|a| match a {
            Action::Bid(c) => Some(*c),
            _ => None,
        })
        .collect();
    bids.sort_by_key(|c| (c.trump, c.count));
    for bid in &bids {
        let cheaper = bids
            .iter()
            .filter(|b| b.trump == bid.trump && b.count < bid.count)
            .count();
        if cheaper < 3 {
            out.push(Action::Bid(*bid));
        }
    }
    out
}

/// The moves [`SearchBot`] weighs for the seat to act in `view`, out of
/// `legal`: the cheapest bids, the sensible discards and friend calls,
/// every card (but a wasted joker); `legal` itself at any other decision.
pub fn candidates(view: &View, legal: &[Action]) -> Vec<Action> {
    match (&view.viewer, &view.phase) {
        (Viewer::Seat(_), PhaseView::Play { trick_no, .. }) => play_candidates(legal, *trick_no),
        (Viewer::Seat(_), PhaseView::Bidding { .. }) => bid_candidates(legal),
        (Viewer::Seat(_), PhaseView::Exchange { .. }) => exchange_candidates(view, legal),
        _ => legal.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pimc::determinize;
    use engine::{Game, Turn};
    use mighty::card::{Color, Suit};
    use mighty::rules::Preset;
    use mighty::world::Phase;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    #[test]
    fn a_joker_is_not_thrown_away_on_the_first_trick() {
        let play = |card| Action::Play {
            card,
            joker_lead: None,
            call_joker: false,
        };
        let joker = play(Card::Joker(Color::Red));
        let two = play(Card::new(Suit::Club, 2));
        assert_eq!(play_candidates(&[joker.clone(), two.clone()], 0), vec![two.clone()]);
        assert_eq!(play_candidates(&[joker.clone(), two], 1).len(), 2);
        assert_eq!(play_candidates(std::slice::from_ref(&joker), 0), vec![joker]);
    }

    /// A sampled world must look exactly like the real one to the bot,
    /// keep every card, and respect the voids it has seen.
    #[test]
    fn sampled_worlds_match_the_view() {
        let mut rng = ChaCha8Rng::seed_from_u64(7);
        for preset in Preset::ALL {
            for game in 0..20 {
                let options = mighty::Options {
                    rules: preset.rules(),
                    first_bidder: game % 5,
                };
                let mut state = Mighty::new_game(&options).unwrap();
                while let Turn::Chance | Turn::Seat(_) = Mighty::turn(&state) {
                    if let Turn::Seat(seat) = Mighty::turn(&state)
                        && matches!(state.phase(), Phase::Bidding(_) | Phase::Exchange(_) | Phase::Play(_))
                    {
                        let view = Mighty::view(&state, Viewer::Seat(seat));
                        let world = determinize(&view, &mut rng).expect("a deal exists");
                        Mighty::check_invariants(&world).unwrap();
                        assert_eq!(Mighty::view(&world, Viewer::Seat(seat)), view);
                        assert_eq!(Mighty::legal_actions(&world), Mighty::legal_actions(&state));
                    }
                    let action = match Mighty::turn(&state) {
                        Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                        _ => {
                            let legal = Mighty::legal_actions(&state);
                            legal[rng.random_range(0..legal.len())].clone()
                        }
                    };
                    Mighty::apply(&mut state, action).unwrap();
                }
            }
        }
    }
}
