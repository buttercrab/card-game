//! How the search deals the cards it cannot see.
//!
//! [`Sampler`] is the setting: uniformly over the deals the view allows
//! (the table's 고수), or by a belief model's predictions. Once per
//! decision it makes a [`Deal`], the strategy every sampled world of that
//! decision is dealt by, so a model is asked once per decision, not once
//! per world.
//!
//! Both deal card by card, each to a seat with room or face down, and
//! keep every constraint: exact hand sizes and face-down count, the cards
//! the viewer knows, the suits a seat has shown it lacks; the search then
//! redeals until the bidding agrees ([`crate::search`]). Uniformly, a card
//! goes to a place in proportion to the room left there. By beliefs, in
//! proportion to `room × exp(logit)`, the model's logits being relative to
//! the counts alone (see `cardgame_ml.models.belief`): so a model that
//! says nothing deals exactly as uniformly does.

use crate::card::Card;
use crate::encode::{BURIED, MAX_SEATS, SLOTS, slot};
use crate::search::{Dealer, Dealt};
use crate::state::Action;
use crate::view::View;
use crate::{Mighty, bot};
use engine::{Belief, Encode};
use rand::{Rng, RngCore};
use std::fmt;

/// How a search deals the cards it cannot see.
///
/// A model is loaded once and kept for the life of the process (leak a
/// `Box` for the `'static` reference), which keeps search bots, and the
/// bot specs built on them, `Copy`.
#[derive(Clone, Copy, Default)]
pub enum Sampler {
    /// Every deal the view allows alike: the table's 고수.
    #[default]
    Uniform,
    /// By a belief model's predictions, from the seat's observation.
    Belief(&'static dyn Belief),
}

impl fmt::Debug for Sampler {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Sampler::Uniform => write!(f, "Uniform"),
            Sampler::Belief(_) => write!(f, "Belief"),
        }
    }
}

/// Samplers are equal when they deal the same way: the same model, not
/// merely an equal one.
impl PartialEq for Sampler {
    fn eq(&self, other: &Sampler) -> bool {
        match (self, other) {
            (Sampler::Uniform, Sampler::Uniform) => true,
            (Sampler::Belief(a), Sampler::Belief(b)) => std::ptr::addr_eq(*a, *b),
            _ => false,
        }
    }
}

/// Deals a world's unseen cards: what a [`Sampler`] sets up for one
/// decision.
pub(crate) trait Deal: Sync {
    /// Every seat's hand (`me`'s empty) and the cards face down, or `None`
    /// when no deal was found.
    fn hands(&self, dealer: &Dealer, rng: &mut dyn RngCore) -> Option<Dealt>;
}

impl Sampler {
    /// The strategy for one decision of the seat that sees `view`, with
    /// `legal` its legal actions. A model that fails to answer leaves the
    /// deal uniform.
    pub(crate) fn prepare(&self, view: &View, legal: &[Action], dealer: &Dealer) -> Box<dyn Deal> {
        match self {
            Sampler::Uniform => Box::new(Uniform),
            Sampler::Belief(model) => {
                let obs = Mighty::encode(view, legal);
                match model.logits(&[&obs]) {
                    Ok(logits) if logits.len() == 1 => Box::new(ByBelief::new(&logits[0], dealer)),
                    _ => Box::new(Uniform),
                }
            }
        }
    }
}

/// Every allowed deal alike.
pub(crate) struct Uniform;

impl Deal for Uniform {
    fn hands(&self, dealer: &Dealer, rng: &mut dyn RngCore) -> Option<Dealt> {
        dealer.deal_hands(rng)
    }
}

/// Tries at dealing by beliefs before dealing uniformly instead: a draw
/// dead-ends only when the beliefs crowd the last cards towards seats
/// whose voids refuse them.
const TRIES: usize = 10;

/// The least weight, against the likeliest place, that a belief leaves any
/// place: a model is not a rule, and a confidently wrong belief must not
/// starve every deal of the real one.
const FLOOR: f64 = 1e-3;

/// Deals by a belief model's odds.
pub(crate) struct ByBelief {
    /// Per card slot, the odds of each absolute seat, then of face down,
    /// against the counts alone.
    odds: Vec<[f64; MAX_SEATS + 1]>,
}

impl ByBelief {
    /// From one observation's logits, `[cards × classes]`, classes being
    /// seats relative to the viewer and then face down.
    pub(crate) fn new(logits: &[f32], dealer: &Dealer) -> ByBelief {
        let classes = MAX_SEATS + 1;
        let seats = dealer.capacity.len();
        let odds = (0..SLOTS)
            .map(|card| {
                let row = &logits[card * classes..(card + 1) * classes];
                // Absolute seat s is relative seat (s - me) mod seats.
                let mut out = [0.0; MAX_SEATS + 1];
                for (seat, odds) in out.iter_mut().enumerate().take(seats) {
                    *odds = f64::from(row[(seat + seats - dealer.me) % seats]);
                }
                out[MAX_SEATS] = f64::from(row[BURIED as usize]);
                let top = out
                    .iter()
                    .take(seats)
                    .chain([&out[MAX_SEATS]])
                    .fold(f64::MIN, |a, &b| a.max(b));
                out.map(|logit| (logit - top).exp().max(FLOOR))
            })
            .collect();
        ByBelief { odds }
    }
}

impl Deal for ByBelief {
    fn hands(&self, dealer: &Dealer, rng: &mut dyn RngCore) -> Option<Dealt> {
        let mut unseen = dealer.unseen.clone();
        for _ in 0..TRIES {
            rand::seq::SliceRandom::shuffle(unseen.as_mut_slice(), rng);
            if let Some(dealt) = self.deal(&unseen, dealer, rng) {
                return Some(dealt);
            }
        }
        dealer.deal_hands(rng)
    }
}

impl ByBelief {
    /// `cards`, in this order, each to a seat with room (and no void in its
    /// suit) or face down, in proportion to room left times odds.
    fn deal(&self, cards: &[Card], dealer: &Dealer, rng: &mut dyn RngCore) -> Option<Dealt> {
        let seats = dealer.capacity.len();
        let mut held = [0usize; MAX_SEATS];
        let mut hands = [0u64; MAX_SEATS];
        let mut down = Vec::with_capacity(dealer.hidden_down);
        for &card in cards {
            let suit = card.suit().map_or(0, |s| 1 << s as u8);
            let odds = &self.odds[slot(card)];
            let mut weights = [0.0; MAX_SEATS + 1];
            for s in 0..seats {
                if held[s] < dealer.capacity[s] && dealer.void[s] & suit == 0 {
                    weights[s] = (dealer.capacity[s] - held[s]) as f64 * odds[s];
                }
            }
            weights[MAX_SEATS] = (dealer.hidden_down - down.len()) as f64 * odds[MAX_SEATS];
            let total: f64 = weights.iter().sum();
            if total <= 0.0 {
                return None;
            }
            let mut pick = rng.random::<f64>() * total;
            // The last place with weight, should rounding run past the end.
            let mut place = weights.iter().rposition(|&w| w > 0.0).expect("total > 0");
            for (i, &w) in weights.iter().enumerate() {
                if w > 0.0 && pick < w {
                    place = i;
                    break;
                }
                pick -= w;
            }
            if place == MAX_SEATS {
                down.push(card);
            } else {
                held[place] += 1;
                hands[place] |= bot::bit(card);
            }
        }
        Some((hands, down))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::{Preset, Rules};
    use crate::search::SearchBot;
    use crate::state::{Phase, State};
    use crate::{Options, card::Suit};
    use engine::{BeliefError, Bot, Game, Observation, Turn, Viewer};
    use rand::SeedableRng;
    use rand::seq::IndexedRandom;
    use rand_chacha::ChaCha8Rng;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const CLASSES: usize = MAX_SEATS + 1;

    /// A model that answers with fixed logits, counting its calls.
    struct Fixed {
        logits: Vec<f32>,
        calls: AtomicUsize,
    }

    impl Belief for Fixed {
        fn logits(&self, observations: &[&Observation]) -> Result<Vec<Vec<f32>>, BeliefError> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            Ok(vec![self.logits.clone(); observations.len()])
        }
    }

    fn fixed(logits: Vec<f32>) -> &'static Fixed {
        Box::leak(Box::new(Fixed {
            logits,
            calls: AtomicUsize::new(0),
        }))
    }

    /// Positions a seat decides in, from random play: every bidding,
    /// exchange and play decision of `hands` hands of `rules`.
    fn positions(rules: &Rules, hands: u64, mut visit: impl FnMut(&State, usize)) {
        for seed in 0..hands {
            let mut rng = ChaCha8Rng::seed_from_u64(seed);
            let options = Options {
                rules: rules.clone(),
                first_bidder: seed as usize % rules.players,
            };
            let mut state = Mighty::new_game(&options).unwrap();
            loop {
                let action = match Mighty::turn(&state) {
                    Turn::Over => break,
                    Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                    Turn::Seat(seat) => {
                        if matches!(state.phase, Phase::Bidding(_) | Phase::Exchange(_) | Phase::Play(_)) {
                            visit(&state, seat);
                        }
                        Mighty::legal_actions(&state).choose(&mut rng).unwrap().clone()
                    }
                };
                Mighty::apply(&mut state, action).unwrap();
            }
        }
    }

    /// Dealt by strong, arbitrary beliefs, a world still looks exactly like
    /// the real one to the seat, keeps every card and hand size, and gives
    /// no seat a suit it has shown it lacks.
    #[test]
    fn deals_by_belief_keep_every_constraint() {
        let mut rng = ChaCha8Rng::seed_from_u64(5);
        let mut rule_sets: Vec<Rules> = Preset::ALL.iter().map(|p| p.rules()).collect();
        rule_sets.extend(Preset::ALL.iter().map(|p| p.rules().varied(&mut rng)));
        let (mut deals, mut dead_ends, mut uniform_dead_ends) = (0, 0, 0);
        for rules in &rule_sets {
            positions(rules, 3, |state, seat| {
                let view = Mighty::view(state, Viewer::Seat(seat));
                let dealer = Dealer::new(&view).unwrap();
                let logits: Vec<f32> = (0..SLOTS * CLASSES).map(|_| rng.random_range(-3.0..3.0)).collect();
                let beliefs = ByBelief::new(&logits, &dealer);
                let nothing = ByBelief::new(&[0.0; SLOTS * CLASSES], &dealer);
                for _ in 0..3 {
                    let mut unseen = dealer.unseen.clone();
                    rand::seq::SliceRandom::shuffle(unseen.as_mut_slice(), &mut rng);
                    deals += 1;
                    uniform_dead_ends += usize::from(nothing.deal(&unseen, &dealer, &mut rng).is_none());
                    let Some((hands, down)) = beliefs.deal(&unseen, &dealer, &mut rng) else {
                        dead_ends += 1;
                        continue;
                    };
                    for (s, &hand) in hands.iter().enumerate().take(rules.players) {
                        assert_eq!(hand.count_ones() as usize, dealer.capacity[s]);
                        for suit in Suit::ALL {
                            if dealer.void[s] & (1 << suit as u8) != 0 {
                                assert!(crate::bot::cards(hand).all(|c| c.suit() != Some(suit)));
                            }
                        }
                    }
                    assert_eq!(down.len(), dealer.hidden_down);
                    let mut world = dealer.template.clone();
                    dealer.fill(&mut world, (hands, down));
                    Mighty::check_invariants(&world).unwrap();
                    assert_eq!(Mighty::view(&world, Viewer::Seat(seat)), view);
                    assert_eq!(world.legal_actions(), state.legal_actions());
                }
            });
        }
        assert!(deals > 5_000, "only {deals} deals");
        // Random play shows many voids, and dealing card by card some deals
        // dead-end (they are dealt again, then uniformly): beliefs should
        // not make that much likelier than the uniform deal does.
        assert!(
            dead_ends < uniform_dead_ends * 3 / 2 + 20,
            "{dead_ends} of {deals} deals dead-ended, {uniform_dead_ends} uniformly"
        );
    }

    /// How often each card lands in each place, over `n` deals.
    fn frequencies(n: usize, mut deal: impl FnMut() -> Dealt) -> Vec<[f64; CLASSES]> {
        let mut counts = vec![[0.0; CLASSES]; SLOTS];
        for _ in 0..n {
            let (hands, down) = deal();
            for (seat, &hand) in hands.iter().enumerate() {
                for card in crate::bot::cards(hand) {
                    counts[slot(card)][seat] += 1.0;
                }
            }
            for card in down {
                counts[slot(card)][MAX_SEATS] += 1.0;
            }
        }
        counts.iter().map(|c| c.map(|x| x / n as f64)).collect()
    }

    /// A model with nothing to say (every logit zero) deals as the uniform
    /// sampler does: the same chance for every card in every place, within
    /// sampling error, voids and the face-down cards included.
    #[test]
    fn a_model_that_says_nothing_deals_uniformly() {
        let mut checked = 0;
        for preset in [Preset::Default, Preset::Gshs, Preset::Kmla] {
            let mut picked: Vec<View> = Vec::new();
            positions(&preset.rules(), 2, |state, seat| {
                if picked.len() < 6 && (state.legal_actions().len() > 1) {
                    picked.push(Mighty::view(state, Viewer::Seat(seat)));
                }
            });
            // Late positions too, where voids bite.
            positions(&preset.rules(), 1, |state, seat| {
                if matches!(&state.phase, Phase::Play(p) if p.trick_no >= 5) && picked.len() < 9 {
                    picked.push(Mighty::view(state, Viewer::Seat(seat)));
                }
            });
            for view in &picked {
                let dealer = Dealer::new(view).unwrap();
                let beliefs = ByBelief::new(&[0.0; SLOTS * CLASSES], &dealer);
                let n = 4000;
                let mut rng = ChaCha8Rng::seed_from_u64(1);
                let uniform = frequencies(n, || dealer.deal_hands(&mut rng).unwrap());
                let ours = frequencies(n, || beliefs.hands(&dealer, &mut rng).unwrap());
                for (a, b) in uniform.iter().zip(&ours) {
                    for (&p, &q) in a.iter().zip(b) {
                        let pooled = (p + q) / 2.0;
                        let sigma = (2.0 * pooled * (1.0 - pooled) / n as f64).sqrt();
                        assert!((p - q).abs() <= 5.0 * sigma + 1e-9, "{p} against {q}");
                    }
                }
                checked += 1;
            }
        }
        assert!(checked >= 20, "only {checked} positions");
    }

    /// Beliefs move cards: told the black joker is with the next seat, the
    /// deals put it there far more often than its share of the cards.
    #[test]
    fn beliefs_move_cards() {
        let rules = Preset::Default.rules();
        let mut view = None;
        positions(&rules, 1, |state, seat| {
            if view.is_none() && matches!(state.phase, Phase::Bidding(_)) {
                view = Some(Mighty::view(state, Viewer::Seat(seat)));
            }
        });
        let view = view.unwrap();
        let dealer = Dealer::new(&view).unwrap();
        let joker = slot(Card::Joker(crate::card::Color::Black));
        if view.hand.contains(&Card::Joker(crate::card::Color::Black)) {
            return;
        }
        let mut logits = vec![0.0; SLOTS * CLASSES];
        logits[joker * CLASSES + 1] = 5.0;
        let beliefs = ByBelief::new(&logits, &dealer);
        let mut rng = ChaCha8Rng::seed_from_u64(2);
        let next = (dealer.me + 1) % rules.players;
        let share = frequencies(2000, || beliefs.hands(&dealer, &mut rng).unwrap())[joker][next];
        let uniform = frequencies(2000, || dealer.deal_hands(&mut rng).unwrap())[joker][next];
        assert!(share > 0.9 && uniform < 0.4, "{share} against {uniform}");
    }

    /// The model is asked once per decision, whatever the samples and
    /// threads, and a search by beliefs still plays legal moves.
    #[test]
    fn a_decision_asks_the_model_once() {
        let model = fixed(vec![0.0; SLOTS * CLASSES]);
        let mut bot = SearchBot {
            samples: 12,
            threads: 3,
            budget: None,
            sampler: Sampler::Belief(model),
            ..SearchBot::default()
        };
        let mut asked = 0;
        positions(&Preset::Gshs.rules(), 1, |state, seat| {
            let view = Mighty::view(state, Viewer::Seat(seat));
            let legal = state.legal_actions();
            let before = model.calls.load(Ordering::Relaxed);
            let action = bot.act(&view, &legal, &mut ChaCha8Rng::seed_from_u64(3));
            assert!(legal.contains(&action));
            let calls = model.calls.load(Ordering::Relaxed) - before;
            assert!(calls <= 1, "{calls} calls for one decision");
            asked += calls;
        });
        assert!(asked > 10, "the model was asked {asked} times");
    }

    #[test]
    fn samplers_compare_by_model() {
        let (a, b) = (fixed(Vec::new()), fixed(Vec::new()));
        assert_eq!(Sampler::Belief(a), Sampler::Belief(a));
        assert_ne!(Sampler::Belief(a), Sampler::Belief(b));
        assert_eq!(Sampler::default(), Sampler::Uniform);
        assert_ne!(Sampler::Uniform, Sampler::Belief(a));
    }
}
