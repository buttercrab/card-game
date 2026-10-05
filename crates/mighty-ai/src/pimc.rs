//! Perfect Information Monte Carlo, the core the search bots share: deal
//! worlds a seat cannot tell from the real one ([`Dealer`], by a [`Deal`]
//! strategy), play every candidate out on the same worlds ([`playout`]),
//! split the work over threads ([`scatter`]), and keep a candidate only
//! when it beats the baseline by enough ([`confident_best`]).

use crate::endgame;
use crate::seen::Seen;
use crate::simple::SimpleBot;
use engine::{Encode, Game, Observation, Seat, Turn, Viewer};
use mighty::card::{Card, CardSet, Suit};
use mighty::rules::{Contract, MAX_PLAYERS};
use mighty::world::Phase;
use mighty::{Action, Mighty, PhaseView, State, View};
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::{Rng, RngCore, SeedableRng};

/// Deals a world's unseen cards: the strategy a [`crate::Sampler`] sets
/// up for one decision.
pub(crate) trait Deal: Sync {
    /// Every seat's hand (`me`'s empty) and the cards face down, or `None`
    /// when no deal was found.
    fn hands(&self, dealer: &Dealer, rng: &mut dyn RngCore) -> Option<Dealt>;
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
    pub(crate) me: Seat,
    /// The cards `me` has not seen, in deck order.
    pub(crate) unseen: Vec<Card>,
    /// How many unseen cards each seat holds; none for `me`.
    pub(crate) capacity: Vec<usize>,
    /// Unseen cards lying face down: the kitty, or the discards.
    pub(crate) hidden_down: usize,
    /// The suits each seat has shown it lacks, a bit each.
    pub(crate) void: Vec<u8>,
    hand: Vec<Card>,
    /// The world, but for the unseen cards.
    pub(crate) template: State,
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
                                void[p.seat][suit.index()] = true;
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
        let seen: CardSet = seen.iter().collect();
        let unseen: Vec<Card> = (rules.card_set() - seen).iter().collect();
        let mut capacity: Vec<usize> = view.hand_sizes.clone();
        capacity[me] = 0;

        let state = State::from_public(view)?;
        let bidder = match state.phase() {
            Phase::Bidding(b) => b.best.map(|(seat, contract)| (seat, contract, Vec::new())),
            Phase::Play(p) => {
                let played = p.tricks.iter().flat_map(|t| &t.plays).chain(&p.plays);
                let cards = played
                    .filter(|pl| pl.seat == p.declared.declarer)
                    .map(|pl| pl.card)
                    .collect();
                Some((p.declared.declarer, p.declared.contract, cards))
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
    pub(crate) fn agrees_with_bidding(&self, policy: &SimpleBot, (hands, _): &Dealt) -> bool {
        let Some((seat, contract, played)) = &self.bidder else {
            return true;
        };
        let mut hand: Vec<Card> = hands[*seat].iter().collect();
        hand.extend(played);
        let rules = self.template.rules();
        policy.estimate(rules, &hand, contract.trump) >= policy.needed(rules, *contract)
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
    pub(crate) fn deal_hands(&self, rng: &mut dyn RngCore) -> Option<Dealt> {
        let mut unseen = self.unseen.clone();
        (0..20).find_map(|attempt| {
            unseen.shuffle(rng);
            // After repeated failures, a wrong inference is likelier than bad
            // luck; deal without the void constraints.
            deal(&unseen, &self.capacity, self.hidden_down, &self.void, attempt < 10, rng)
        })
    }

    /// Puts these cards into `world`, a copy of the template.
    pub(crate) fn fill(&self, world: &mut State, (hands, down): Dealt) {
        world.fill_hidden(self.me, &self.hand, &hands, down);
    }
}

/// Cards dealt to every seat, and the cards dealt face down.
pub(crate) type Dealt = ([CardSet; MAX_PLAYERS], Vec<Card>);

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
    let mut held = [0usize; MAX_PLAYERS];
    let mut hands = [CardSet::EMPTY; MAX_PLAYERS];
    let mut down = Vec::with_capacity(discards);
    for &card in cards {
        let suit = card.suit().map_or(0, |s| 1 << s as u8);
        let mut rooms = [0usize; MAX_PLAYERS];
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
                hands[s].insert(card);
            }
            None => down.push(card),
        }
    }
    Some((hands, down))
}

/// How a playout ended: a payoff, or, at a leaf, a position for a network
/// to value.
pub(crate) enum Outcome {
    Payoff(i64),
    Leaf(Observation),
}

/// Plays `action` by `me` in `world`, then the hand on with `policy` in
/// every seat, the last `endgame` tricks solved exactly once the sides are
/// settled: `me`'s payoff, 0 for a hand thrown in. With a `leaf`, stops at
/// `me`'s first turn once that many more tricks are done, with the
/// position as `me` sees it.
pub(crate) fn playout(
    policy: &SimpleBot,
    endgame: usize,
    world: &State,
    action: &Action,
    me: Seat,
    leaf: Option<usize>,
) -> Outcome {
    let mut state = world.clone();
    state.step(me, action.clone());
    let horizon = leaf.map(|more| tricks_done(world) + more);
    play_on(policy, endgame, state, me, horizon)
}

/// Plays `state` to the end of the hand with `policy` in every seat:
/// `me`'s payoff, 0 if the hand is thrown in. The last `endgame` tricks
/// are solved exactly once the sides are settled (0 plays them all).
/// Public for experiments (`lab`), which use it as a perfect-information
/// player and as an oracle.
pub fn play_out(policy: SimpleBot, endgame: usize, state: State, me: Seat) -> i64 {
    match play_on(&policy, endgame, state, me, None) {
        Outcome::Payoff(payoff) => payoff,
        Outcome::Leaf(_) => unreachable!("no leaves without a horizon"),
    }
}

/// [`playout`] from `state`, stopping at `horizon` tricks done. It always
/// ends: a hand has finitely many moves, and a redeal stops it.
fn play_on(policy: &SimpleBot, endgame: usize, mut state: State, me: Seat, horizon: Option<usize>) -> Outcome {
    loop {
        match Mighty::turn(&state) {
            Turn::Over => return Outcome::Payoff(Mighty::payoffs(&state).map_or(0, |p| p[me])),
            // A redeal: the new hand is worth the same to every seat before
            // its cards are seen, so 0. Playing it out only added noise.
            Turn::Chance => return Outcome::Payoff(0),
            Turn::Seat(seat) => {
                if horizon.is_some_and(|h| seat == me && tricks_done(&state) >= h) {
                    let view = Mighty::view(&state, Viewer::Seat(me));
                    return Outcome::Leaf(Mighty::encode(&view, &Mighty::legal_actions(&state)));
                }
                if endgame > 0
                    && let Some(payoffs) = endgame::solve(&state, endgame)
                {
                    return Outcome::Payoff(payoffs[me]);
                }
                let legal = Mighty::legal_actions(&state);
                let choice = policy.decide(&Seen::of_state(&state, seat), &legal);
                state.step(seat, choice);
            }
        }
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

/// Runs `part` once per thread, `threads` at once, and returns the parts
/// in thread order. Each thread draws from its own generator, seeded from
/// `rng` in thread order; a single thread draws from `rng` itself.
pub(crate) fn scatter<P: Send>(
    threads: usize,
    rng: &mut dyn RngCore,
    part: impl Fn(usize, &mut dyn RngCore) -> P + Sync,
) -> Vec<P> {
    let threads = threads.max(1);
    if threads == 1 {
        return vec![part(0, rng)];
    }
    let seeds: Vec<u64> = (0..threads).map(|_| rng.next_u64()).collect();
    let part = &part;
    std::thread::scope(|scope| {
        let handles: Vec<_> = (seeds.into_iter().enumerate())
            .map(|(i, seed)| scope.spawn(move || part(i, &mut StdRng::seed_from_u64(seed))))
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("search thread panicked"))
            .collect()
    })
}

/// The candidate with the best average over the worlds, which count by
/// `weights`.
pub(crate) fn best_average(scores: &[Vec<f64>], weights: &[f64]) -> usize {
    let average = |s: &Vec<f64>| s.iter().zip(weights).map(|(&x, w)| x * w).sum::<f64>();
    (0..scores.len())
        .max_by(|&a, &b| average(&scores[a]).total_cmp(&average(&scores[b])))
        .expect("at least one candidate")
}

/// The candidate that beats `base` by the most, on the same deals, among
/// those that beat it by more than `z` standard errors; else `base`. With
/// a few dozen noisy playouts, small leads are mostly luck, and acting on
/// them throws good cards away. Deals count by `weights`, which sum to 1.
pub(crate) fn confident_best(scores: &[Vec<f64>], weights: &[f64], base: usize, z: f64) -> usize {
    // The effective number of deals, for the usual small-sample correction.
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
