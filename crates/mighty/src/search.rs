//! A bot that searches. For each bid and each card it plays, it deals the
//! cards it cannot see in many ways consistent with what it has seen, plays
//! every candidate to the end of the hand with [`SimpleBot`] in every seat,
//! and picks the one with the best average payoff (Perfect Information
//! Monte Carlo). The exchange is left to [`SimpleBot`]: searching discards
//! and friend calls, or weighting deals by the bids, did not measurably help.

use crate::Mighty;
use crate::bot::SimpleBot;
use crate::card::{Card, Suit};
use crate::state::{Action, Bidding, Phase, Play, State};
use crate::view::{PhaseView, View};
use engine::{Bot, Seat, Turn, Viewer};
use rand::seq::SliceRandom;
use rand::{Rng, RngCore};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SearchBot {
    /// Deals sampled per decision. More is slower, and past 40 barely stronger.
    pub samples: usize,
}

impl Default for SearchBot {
    fn default() -> SearchBot {
        SearchBot { samples: 40 }
    }
}

impl Bot<Mighty> for SearchBot {
    fn act(&mut self, view: &View, legal: &[Action], rng: &mut dyn RngCore) -> Action {
        let candidates = match (&view.viewer, &view.phase) {
            (Viewer::Seat(_), PhaseView::Play { .. }) => legal.to_vec(),
            (Viewer::Seat(_), PhaseView::Bidding { .. }) => bid_candidates(legal),
            _ => return SimpleBot.act(view, legal, rng),
        };
        let Viewer::Seat(me) = view.viewer else {
            unreachable!("matched above")
        };
        if candidates.len() == 1 {
            return candidates[0].clone();
        }
        let worlds: Vec<State> = (0..self.samples).filter_map(|_| determinize(view, rng)).collect();
        if worlds.is_empty() {
            return SimpleBot.act(view, legal, rng);
        }
        // Every candidate is scored on the same deals, so luck in the
        // sampling affects them all alike.
        let mut best = (i64::MIN, 0);
        for (i, action) in candidates.iter().enumerate() {
            let total: i64 = worlds.iter().map(|world| rollout(world, action, me, rng)).sum();
            if total > best.0 {
                best = (total, i);
            }
        }
        candidates[best.1].clone()
    }
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
fn rollout(world: &State, action: &Action, me: Seat, rng: &mut dyn RngCore) -> i64 {
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
                let choice = SimpleBot.act(&view, &legal, rng);
                state.step(seat, choice);
            }
        }
    }
    0
}

/// A full state that `view` cannot tell apart from the real one: the
/// unseen cards dealt at random, honouring every suit a seat has shown it
/// lacks. Works while bidding and playing; `None` otherwise and for
/// spectators.
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
                        && matches!(state.phase, Phase::Bidding(_) | Phase::Play(_))
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
