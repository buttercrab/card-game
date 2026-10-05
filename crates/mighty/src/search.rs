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
use crate::rules::Contract;
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
    /// Playouts solve the last this many tricks exactly, every hand being
    /// known in a sampled deal (see [`crate::endgame`]), instead of playing
    /// them with the simple bot. 0 plays every trick with the simple bot.
    pub endgame: usize,
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
        let drawn: Vec<(State, f64)> = (0..n).filter_map(|_| self.draw(&dealer, me, rng, &mut memo)).collect();
        let log_weights: Vec<f64> = drawn.iter().map(|(_, w)| *w).collect();
        let weights = self.reading.weights(&log_weights);
        drawn.into_iter().map(|(s, _)| s).zip(weights).collect()
    }

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
        let Some(dealer) = Dealer::new(view) else {
            return (scores, log_weights);
        };
        for _ in 0..samples {
            if self.budget.is_some_and(|budget| started.elapsed() >= budget) {
                break;
            }
            let Some((world, log_weight)) = self.draw(&dealer, me, rng, &mut memo) else {
                continue;
            };
            log_weights.push(log_weight);
            for (action, scores) in candidates.iter().zip(&mut scores) {
                scores.push(rollout(self.policy, self.endgame, &world, action, me, rng));
            }
        }
        (scores, log_weights)
    }

    /// A world to play out, and its log weight. Reading the table samples
    /// several and keeps one in proportion to its weight, so that fewer
    /// playouts go to deals the other players' actions rule out; the one
    /// kept carries their average weight.
    fn draw(&self, dealer: &Dealer, me: Seat, rng: &mut dyn RngCore, memo: &mut Memo) -> Option<(State, f64)> {
        if !self.reading.on {
            return Some((self.sample(dealer, rng)?, 0.0));
        }
        let mut kept = None;
        let mut total = f64::NEG_INFINITY;
        let draws = self.reading.draws.max(1);
        // Most draws are read and dropped: deal them all into one world.
        let mut world = dealer.template.clone();
        for _ in 0..draws {
            dealer.fill(&mut world, self.sample_hands(dealer, rng)?);
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
    fn sample(&self, dealer: &Dealer, rng: &mut dyn RngCore) -> Option<State> {
        let mut world = dealer.template.clone();
        dealer.fill(&mut world, self.sample_hands(dealer, rng)?);
        Some(world)
    }

    /// The cards of [`SearchBot::sample`]'s world, before it is built.
    fn sample_hands(&self, dealer: &Dealer, rng: &mut dyn RngCore) -> Option<Dealt> {
        let mut dealt = dealer.deal_hands(rng)?;
        for _ in 0..20 {
            if dealer.agrees_with_bidding(&self.policy, &dealt) {
                break;
            }
            dealt = dealer.deal_hands(rng)?;
        }
        Some(dealt)
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
/// the last `endgame` tricks solved, redealing if the hand is thrown in.
fn rollout(policy: SimpleBot, endgame: usize, world: &State, action: &Action, me: Seat, rng: &mut dyn RngCore) -> i64 {
    let mut state = world.clone();
    state.step(me, action.clone());
    finish(policy, endgame, state, me, rng)
}

/// Plays `state` to the end of the hand with `policy` in every seat,
/// redealing if the hand is thrown in: `me`'s payoff. Public for
/// experiments (`sim`'s `lab`), which use it as a perfect-information
/// player and as an oracle.
pub fn playout(policy: SimpleBot, state: State, me: Seat, rng: &mut dyn RngCore) -> i64 {
    finish(policy, 0, state, me, rng)
}

/// [`playout`], solving the last `endgame` tricks exactly once the sides
/// are settled.
pub fn finish(mut policy: SimpleBot, endgame: usize, mut state: State, me: Seat, rng: &mut dyn RngCore) -> i64 {
    // Redeals could in principle repeat forever; give up and call it even.
    for _ in 0..2000 {
        match state.turn() {
            Turn::Over => return state.payoffs().map_or(0, |p| p[me]),
            Turn::Chance => {
                let deal = state.sample_deal(rng);
                state.apply(deal).expect("a sampled deal is legal");
            }
            Turn::Seat(seat) => {
                if endgame > 0
                    && let Some(payoffs) = crate::endgame::solve(&state, endgame)
                {
                    return payoffs[me];
                }
                let view = View::for_policy(&state, seat);
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
#[cfg(test)]
pub(crate) fn determinize(view: &View, rng: &mut dyn RngCore) -> Option<State> {
    Dealer::new(view)?.deal(rng)
}

/// What [`determinize`] works out from a view before dealing: worked out
/// once, it serves every deal of a search, which deals thousands.
pub(crate) struct Dealer {
    me: Seat,
    /// The cards `me` has not seen, in deck order.
    unseen: Vec<Card>,
    /// How many unseen cards each seat holds; none for `me`.
    capacity: Vec<usize>,
    /// Unseen cards lying face down: the kitty, or the discards.
    hidden_down: usize,
    /// The suits each seat has shown it lacks, a bit each.
    void: Vec<u8>,
    hand: Vec<Card>,
    /// The world, but for the unseen cards.
    template: State,
    /// Another seat that bid, what it bid, and the cards it has played
    /// since: a deal should give it a hand worth the bid.
    bidder: Option<(Seat, Contract, Vec<Card>)>,
}

impl Dealer {
    pub(crate) fn new(view: &View) -> Option<Dealer> {
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
        let seen = seen.iter().fold(0u64, |m, &c| m | crate::bot::bit(c));
        let unseen: Vec<Card> = rules
            .cards()
            .into_iter()
            .filter(|&c| seen & crate::bot::bit(c) == 0)
            .collect();
        let mut capacity: Vec<usize> = view.hand_sizes.clone();
        capacity[me] = 0;

        let mut state = State {
            rules: rules.clone(),
            first_bidder: view.first_bidder,
            phase: Phase::Dealing,
            hands: Vec::new(),
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
                asking_misdeal,
            } => Phase::Bidding(Bidding {
                to_act: *to_act,
                best: *best,
                passed: passed.clone(),
                has_bid: has_bid.clone(),
                asking: *asking_misdeal,
            }),
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
                // Derived from the plays; the rebuilt state works them out again.
                leading: _,
                no_friend: _,
            } => {
                for t in tricks {
                    state.taken[t.winner].extend(t.plays.iter().map(|p| p.card));
                }
                Phase::Play(Play {
                    declarer: *declarer,
                    contract: *contract,
                    // Dealt face down when not seen.
                    discards: discards.clone().unwrap_or_default(),
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
        let bidder = match &state.phase {
            Phase::Bidding(b) => b.best.map(|(seat, contract)| (seat, contract, Vec::new())),
            Phase::Play(p) => {
                let played = p.tricks.iter().flat_map(|t| &t.plays).chain(&p.plays);
                let cards = played.filter(|pl| pl.seat == p.declarer).map(|pl| pl.card).collect();
                Some((p.declarer, p.contract, cards))
            }
            _ => None,
        };
        let void = void
            .iter()
            .map(|v| (0..4).filter(|&i| v[i]).fold(0, |m, i| m | 1 << i))
            .collect();
        Some(Dealer {
            me,
            unseen,
            capacity,
            hidden_down,
            void,
            hand: view.hand.clone(),
            template: state,
            bidder: bidder.filter(|(seat, ..)| *seat != me),
        })
    }

    /// Whether the policy would bid as high as the bidder did on the hand
    /// `hands` deal it; for a declarer, on the cards it kept.
    fn agrees_with_bidding(&self, policy: &SimpleBot, (hands, _): &Dealt) -> bool {
        let Some((seat, contract, played)) = &self.bidder else {
            return true;
        };
        let mut hand: Vec<Card> = crate::bot::cards(hands[*seat]).collect();
        hand.extend(played);
        policy.estimate(&self.template.rules, &hand, contract.trump) >= f32::from(contract.count)
    }

    /// One world, dealt at random.
    #[cfg(test)]
    pub(crate) fn deal(&self, rng: &mut dyn RngCore) -> Option<State> {
        let mut world = self.template.clone();
        self.fill(&mut world, self.deal_hands(rng)?);
        Some(world)
    }

    /// The unseen cards dealt at random: every seat's hand (`me`'s still
    /// empty) and the cards face down.
    fn deal_hands(&self, rng: &mut dyn RngCore) -> Option<Dealt> {
        let mut unseen = self.unseen.clone();
        (0..20).find_map(|attempt| {
            unseen.shuffle(rng);
            // After repeated failures, a wrong inference is likelier than bad
            // luck; deal without the void constraints.
            deal(&unseen, &self.capacity, self.hidden_down, &self.void, attempt < 10, rng)
        })
    }

    /// Puts these cards into `world`, a copy of the template.
    fn fill(&self, world: &mut State, (hands, down): Dealt) {
        world.hands.resize(self.capacity.len(), Vec::new());
        for (seat, hand) in world.hands.iter_mut().enumerate() {
            hand.clear();
            if seat == self.me {
                hand.extend(&self.hand);
                hand.sort();
            } else {
                hand.extend(crate::bot::cards(hands[seat]));
            }
        }
        match &mut world.phase {
            Phase::Bidding(_) => world.kitty = down,
            Phase::Play(p) if self.hidden_down > 0 => p.discards = down,
            _ => {}
        }
    }
}

/// Cards dealt to every seat, as [`bit`](crate::bot::bit) sets, and the
/// cards dealt face down.
type Dealt = ([u64; 8], Vec<Card>);

/// Deals `cards` into hands of the given sizes plus `discards` face-down
/// cards. Each card goes to a random place with room, weighted by room left.
/// `void` holds a bit per suit a seat lacks.
fn deal(
    cards: &[Card],
    capacity: &[usize],
    discards: usize,
    void: &[u8],
    respect_voids: bool,
    rng: &mut dyn RngCore,
) -> Option<Dealt> {
    // Searches deal thousands of times a move, so this keeps to counts and
    // bit sets.
    let seats = capacity.len();
    let mut held = [0usize; 8];
    let mut hands = [0u64; 8];
    let mut down = Vec::with_capacity(discards);
    for &card in cards {
        let suit = card.suit().map_or(0, |s| 1 << s as u8);
        let mut rooms = [0usize; 8];
        for s in 0..seats {
            let lacks = respect_voids && void[s] & suit != 0;
            if held[s] < capacity[s] && !lacks {
                rooms[s] = capacity[s] - held[s];
            }
        }
        let room: usize = rooms.iter().sum();
        let total = room + (discards - down.len());
        if total == 0 {
            return None;
        }
        let mut pick = rng.random_range(0..total);
        let seat = (0..seats).find(|&s| {
            if pick < rooms[s] {
                true
            } else {
                pick -= rooms[s];
                false
            }
        });
        match seat {
            Some(s) => {
                held[s] += 1;
                hands[s] |= crate::bot::bit(card);
            }
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
