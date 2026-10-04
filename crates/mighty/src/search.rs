//! A bot that searches. For each bid, discard, friend call and card it
//! plays, it deals the cards it cannot see in many ways consistent with
//! what it has seen and with the bidding, plays every candidate to the end
//! of the hand with [`SimpleBot`] in every seat, and picks the one with the
//! best average payoff (Perfect Information Monte Carlo). Deals count by
//! how well they explain what the other players have bid and played; see
//! [`Reading`].

use crate::Mighty;
use crate::bot::SimpleBot;
use crate::card::{ACE, Card, Suit};
use crate::read::Memo;
pub use crate::read::Reading;
use crate::state::{Action, Bidding, Exchange, FriendCall, Phase, Play, State};
use crate::view::{PhaseView, View};
use engine::{Bot, Seat, Turn, Viewer};
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::{Rng, RngCore, SeedableRng};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq)]
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
        }
    }
}

impl Bot<Mighty> for SearchBot {
    fn act(&mut self, view: &View, legal: &[Action], rng: &mut dyn RngCore) -> Action {
        let candidates = match (&view.viewer, &view.phase) {
            (Viewer::Seat(_), PhaseView::Play { trick_no, .. }) => play_candidates(legal, *trick_no),
            (Viewer::Seat(_), PhaseView::Bidding { .. }) => bid_candidates(legal),
            (Viewer::Seat(_), PhaseView::Exchange { .. }) => exchange_candidates(view, legal),
            _ => return self.policy.act(view, legal, rng),
        };
        let Viewer::Seat(me) = view.viewer else {
            unreachable!("matched above")
        };
        if candidates.len() == 1 {
            return candidates[0].clone();
        }
        // Every candidate is scored on the same deals, so luck in the
        // sampling affects them all alike.
        let started = Instant::now();
        let threads = self.threads.max(1);
        let (scores, log_weights) = if threads == 1 {
            self.search(view, me, &candidates, self.samples, started, rng)
        } else {
            let share = self.samples.div_ceil(threads);
            let seeds: Vec<u64> = (0..threads).map(|_| rng.next_u64()).collect();
            let bot: &SearchBot = self;
            let parts: Vec<_> = std::thread::scope(|scope| {
                let handles: Vec<_> = seeds
                    .into_iter()
                    .map(|seed| {
                        let candidates = &candidates;
                        scope.spawn(move || {
                            let mut rng = StdRng::seed_from_u64(seed);
                            bot.search(view, me, candidates, share, started, &mut rng)
                        })
                    })
                    .collect();
                handles
                    .into_iter()
                    .map(|h| h.join().expect("search thread panicked"))
                    .collect()
            });
            // Each part is a run of whole deals, so joining them keeps the
            // candidates' scores paired deal by deal.
            let mut scores = vec![Vec::new(); candidates.len()];
            let mut log_weights = Vec::new();
            for (part_scores, part_weights) in parts {
                for (all, part) in scores.iter_mut().zip(part_scores) {
                    all.extend(part);
                }
                log_weights.extend(part_weights);
            }
            (scores, log_weights)
        };
        if scores[0].is_empty() {
            return self.policy.act(view, legal, rng);
        }
        let weights = self.reading.weights(&log_weights);
        let usual = self.policy.act(view, legal, rng);
        let choice = match candidates.iter().position(|a| *a == usual) {
            Some(base) => confident_best(&scores, &weights, base, self.confidence),
            None => best_average(&scores, &weights),
        };
        candidates[choice].clone()
    }
}

impl SearchBot {
    /// Deals up to `samples` worlds, until the budget runs out, and plays
    /// every candidate out on each: the payoffs per candidate, deal by deal,
    /// and each deal's log weight.
    fn search(
        &self,
        view: &View,
        me: Seat,
        candidates: &[Action],
        samples: usize,
        started: Instant,
        rng: &mut dyn RngCore,
    ) -> (Vec<Vec<i64>>, Vec<f64>) {
        let mut scores: Vec<Vec<i64>> = vec![Vec::new(); candidates.len()];
        let mut log_weights = Vec::new();
        let mut memo = Memo::default();
        for _ in 0..samples {
            if self.budget.is_some_and(|budget| started.elapsed() >= budget) {
                break;
            }
            let Some((world, log_weight)) = self.draw(view, me, rng, &mut memo) else {
                continue;
            };
            log_weights.push(log_weight);
            for (action, scores) in candidates.iter().zip(&mut scores) {
                scores.push(rollout(self.policy, &world, action, me, rng));
            }
        }
        (scores, log_weights)
    }

    /// A world to play out, and its log weight. Reading the table samples
    /// several and keeps one in proportion to its weight, so that fewer
    /// playouts go to deals the other players' actions rule out; the one
    /// kept carries their average weight.
    fn draw(&self, view: &View, me: Seat, rng: &mut dyn RngCore, memo: &mut Memo) -> Option<(State, f64)> {
        if !self.reading.on {
            return Some((self.sample(view, rng)?, 0.0));
        }
        let mut kept = None;
        let mut total = f64::NEG_INFINITY;
        let draws = self.reading.draws.max(1);
        for _ in 0..draws {
            let world = self.sample(view, rng)?;
            let log_weight = self.reading.log_weight(&self.policy, &world, me, memo);
            let top = total.max(log_weight);
            total = top + ((total - top).exp() + (log_weight - top).exp()).ln();
            if rng.random::<f64>() < (log_weight - total).exp() {
                kept = Some(world);
            }
        }
        Some((kept?, total - (draws as f64).ln()))
    }

    /// A determinized world, redealt up to 20 times until the policy would
    /// have bid what the declarer, or the best bidder so far, did. Past
    /// that, a wrong guess about how they bid is likelier than bad luck.
    fn sample(&self, view: &View, rng: &mut dyn RngCore) -> Option<State> {
        let mut world = determinize(view, rng)?;
        for _ in 0..20 {
            if self.agrees_with_bidding(&world, view) {
                break;
            }
            world = determinize(view, rng)?;
        }
        Some(world)
    }

    /// Whether the policy would bid as high as the bidder did on its hand
    /// in `world`; for a declarer, on the cards it kept.
    fn agrees_with_bidding(&self, world: &State, view: &View) -> bool {
        let Viewer::Seat(me) = view.viewer else { return true };
        let (seat, contract, hand) = match &world.phase {
            Phase::Bidding(b) => match b.best {
                Some((seat, contract)) => (seat, contract, world.hands[seat].clone()),
                None => return true,
            },
            Phase::Play(p) => {
                let played = p.tricks.iter().flat_map(|t| &t.plays).chain(&p.plays);
                let mut hand = world.hands[p.declarer].clone();
                hand.extend(played.filter(|pl| pl.seat == p.declarer).map(|pl| pl.card));
                (p.declarer, p.contract, hand)
            }
            _ => return true,
        };
        seat == me || self.policy.estimate(&world.rules, &hand, contract.trump) >= f32::from(contract.count)
    }
}

fn best_average(scores: &[Vec<i64>], weights: &[f64]) -> usize {
    let average = |s: &Vec<i64>| s.iter().zip(weights).map(|(&x, w)| x as f64 * w).sum::<f64>();
    (0..scores.len())
        .max_by(|&a, &b| average(&scores[a]).total_cmp(&average(&scores[b])))
        .expect("at least one candidate")
}

/// The candidate that beats `base` by the most, on the same deals, among
/// those that beat it by more than `z` standard errors; else `base`. With
/// a few dozen noisy playouts, small leads are mostly luck, and acting on
/// them throws good cards away. Deals count by `weights`, which sum to 1.
fn confident_best(scores: &[Vec<i64>], weights: &[f64], base: usize, z: f64) -> usize {
    // The effective number of deals, for the usual small-sample correction.
    let n = 1.0 / weights.iter().map(|w| w * w).sum::<f64>();
    let mut best = (0.0, base);
    for (i, s) in scores.iter().enumerate() {
        let diffs: Vec<f64> = s.iter().zip(&scores[base]).map(|(a, b)| (a - b) as f64).collect();
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
            .filter(|a| !matches!(a, Action::Discard(c) if *c == mighty || c.is_joker()))
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
    let out: Vec<Action> = calls
        .into_iter()
        .filter(|c| !matches!(c, FriendCall::Card(card) if view.hand.contains(card)))
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

/// Plays `action` in `world`, then plays the hand out with simple bots,
/// redealing if the hand is thrown in.
fn rollout(mut policy: SimpleBot, world: &State, action: &Action, me: Seat, rng: &mut dyn RngCore) -> i64 {
    let mut state = world.clone();
    state.step(me, action.clone());
    // Redeals could in principle repeat forever; give up and call it even.
    for _ in 0..2000 {
        match state.turn() {
            Turn::Over => return state.payoffs().map_or(0, |p| p[me]),
            Turn::Chance => {
                let deal = state.sample_deal(rng);
                state.apply(deal).expect("a sampled deal is legal");
            }
            Turn::Seat(seat) => {
                let view = View::new(&state, Viewer::Seat(seat));
                let legal = state.legal_actions();
                let choice = policy.act(&view, &legal, rng);
                state.step(seat, choice);
            }
        }
    }
    0
}

/// A full state that `view` cannot tell apart from the real one: the
/// unseen cards dealt at random, honouring every suit a seat has shown it
/// lacks. Works while bidding, exchanging and playing; `None` otherwise
/// and for spectators.
pub(crate) fn determinize(view: &View, rng: &mut dyn RngCore) -> Option<State> {
    let Viewer::Seat(me) = view.viewer else { return None };
    let rules = &view.rules;
    let seats = rules.players;
    let mut void = vec![[false; 4]; seats];
    let mut seen: Vec<Card> = view.hand.clone();
    let hidden_down = match &view.phase {
        // The kitty is face down.
        PhaseView::Bidding { .. } => rules.kitty_size(),
        PhaseView::Play {
            contract,
            lead,
            plays,
            tricks,
            discards,
            ..
        } => {
            seen.extend(tricks.iter().flat_map(|t| t.plays.iter().map(|p| p.card)));
            seen.extend(plays.iter().map(|p| p.card));
            seen.extend(discards.iter().flatten());
            // Playing off-suit (other than the mighty or a joker, which never
            // oblige following) shows a seat has none of the led suit.
            let mighty = rules.mighty(contract.trump);
            let finished = tricks.iter().map(|t| (t.plays.as_slice(), Some(t.lead)));
            for (trick, lead) in finished.chain([(plays.as_slice(), *lead)]) {
                let Some(lead) = lead else { continue };
                for p in trick.iter().skip(1) {
                    let free = p.card == mighty || p.card.is_joker();
                    if !free && !lead.follows(p.card) {
                        // Not following a colour shows both of its suits are gone.
                        for suit in Suit::ALL.into_iter().filter(|&s| lead.follows(Card::new(s, 2))) {
                            void[p.seat][suit_index(suit)] = true;
                        }
                    }
                }
            }
            // Only the declarer has seen the discards.
            if discards.is_some() { 0 } else { rules.kitty_size() }
        }
        // Only the declarer acts while exchanging, and it has seen the kitty.
        PhaseView::Exchange { discards, .. } => {
            seen.extend(discards.iter().flatten());
            0
        }
        _ => return None,
    };
    let mut unseen: Vec<Card> = rules.deck.cards().into_iter().filter(|c| !seen.contains(c)).collect();
    let mut capacity: Vec<usize> = view.hand_sizes.clone();
    capacity[me] = 0;

    let (mut hands, down) = (0..20).find_map(|attempt| {
        unseen.shuffle(rng);
        // After repeated failures, a wrong inference is likelier than bad
        // luck; deal without the void constraints.
        deal(&unseen, &capacity, hidden_down, &void, attempt < 10, rng)
    })?;
    hands[me] = view.hand.clone();
    for hand in &mut hands {
        hand.sort();
    }

    let mut state = State {
        rules: rules.clone(),
        first_bidder: view.first_bidder,
        phase: Phase::Dealing,
        hands,
        kitty: Vec::new(),
        taken: vec![Vec::new(); seats],
        bids: view.bids.clone(),
        redealt: view.redealt.clone(),
    };
    state.phase = match &view.phase {
        PhaseView::Bidding {
            to_act,
            best,
            passed,
            has_bid,
        } => {
            state.kitty = down;
            Phase::Bidding(Bidding {
                to_act: *to_act,
                best: *best,
                passed: passed.clone(),
                has_bid: has_bid.clone(),
            })
        }
        PhaseView::Play {
            declarer,
            contract,
            call,
            friend,
            trick_no,
            leader,
            lead,
            plays,
            called_joker,
            tricks,
            discards,
        } => {
            for t in tricks {
                state.taken[t.winner].extend(t.plays.iter().map(|p| p.card));
            }
            Phase::Play(Play {
                declarer: *declarer,
                contract: *contract,
                discards: discards.clone().unwrap_or(down),
                call: *call,
                friend: *friend,
                trick_no: *trick_no,
                leader: *leader,
                lead: *lead,
                plays: plays.clone(),
                called_joker: *called_joker,
                tricks: tricks.clone(),
            })
        }
        PhaseView::Exchange {
            declarer,
            contract,
            trump_changed,
            discards,
        } => Phase::Exchange(Exchange {
            declarer: *declarer,
            contract: *contract,
            discards: discards.clone().unwrap_or_default(),
            trump_changed: *trump_changed,
        }),
        _ => unreachable!("other phases returned above"),
    };
    Some(state)
}

/// Deals `cards` into hands of the given sizes plus `discards` face-down
/// cards. Each card goes to a random place with room, weighted by room left.
fn deal(
    cards: &[Card],
    capacity: &[usize],
    discards: usize,
    void: &[[bool; 4]],
    respect_voids: bool,
    rng: &mut dyn RngCore,
) -> Option<(Vec<Vec<Card>>, Vec<Card>)> {
    let mut hands: Vec<Vec<Card>> = vec![Vec::new(); capacity.len()];
    let mut down = Vec::new();
    for &card in cards {
        let fits = |seat: usize| {
            let lacks = card.suit().is_some_and(|s| void[seat][suit_index(s)]);
            hands[seat].len() < capacity[seat] && !(respect_voids && lacks)
        };
        let room: usize = (0..hands.len())
            .filter(|&s| fits(s))
            .map(|s| capacity[s] - hands[s].len())
            .sum();
        let total = room + (discards - down.len());
        if total == 0 {
            return None;
        }
        let mut pick = rng.random_range(0..total);
        let seat = (0..hands.len()).filter(|&s| fits(s)).find(|&s| {
            let r = capacity[s] - hands[s].len();
            if pick < r {
                true
            } else {
                pick -= r;
                false
            }
        });
        match seat {
            Some(s) => hands[s].push(card),
            None => down.push(card),
        }
    }
    Some((hands, down))
}

fn suit_index(suit: Suit) -> usize {
    Suit::ALL.iter().position(|&s| s == suit).expect("every suit is listed")
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine::Game;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    #[test]
    fn a_joker_is_not_thrown_away_on_the_first_trick() {
        use crate::card::Color;
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
        for preset in crate::rules::Preset::ALL {
            for game in 0..20 {
                let options = crate::Options {
                    rules: preset.rules(),
                    first_bidder: game % 5,
                };
                let mut state = Mighty::new_game(&options).unwrap();
                while let Turn::Chance | Turn::Seat(_) = Mighty::turn(&state) {
                    if let Turn::Seat(seat) = Mighty::turn(&state)
                        && matches!(state.phase, Phase::Bidding(_) | Phase::Exchange(_) | Phase::Play(_))
                    {
                        let view = Mighty::view(&state, Viewer::Seat(seat));
                        let world = determinize(&view, &mut rng).expect("a deal exists");
                        Mighty::check_invariants(&world).unwrap();
                        assert_eq!(Mighty::view(&world, Viewer::Seat(seat)), view);
                        assert_eq!(world.legal_actions(), state.legal_actions());
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
