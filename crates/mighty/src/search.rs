//! A bot that searches during play. For each decision it deals the cards
//! it cannot see in many ways consistent with what it has seen, plays every
//! candidate move to the end of the hand with [`SimpleBot`] in every seat,
//! and picks the move with the best average payoff (Perfect Information
//! Monte Carlo). Bidding and the exchange are left to [`SimpleBot`].

use crate::Mighty;
use crate::bot::SimpleBot;
use crate::card::{Card, Suit};
use crate::state::{Action, Phase, Play, State};
use crate::view::{PhaseView, View};
use engine::{Bot, Seat, Turn, Viewer};
use rand::seq::SliceRandom;
use rand::{Rng, RngCore};

#[derive(Debug, Clone, Copy)]
pub struct SearchBot {
    /// Deals sampled per decision. More is stronger and slower.
    pub samples: usize,
}

impl Default for SearchBot {
    fn default() -> SearchBot {
        SearchBot { samples: 40 }
    }
}

impl Bot<Mighty> for SearchBot {
    fn act(&mut self, view: &View, legal: &[Action], rng: &mut dyn RngCore) -> Action {
        let (Viewer::Seat(me), PhaseView::Play { .. }) = (view.viewer, &view.phase) else {
            return SimpleBot.act(view, legal, rng);
        };
        if legal.len() == 1 {
            return legal[0].clone();
        }
        let worlds: Vec<State> = (0..self.samples).filter_map(|_| determinize(view, rng)).collect();
        if worlds.is_empty() {
            return SimpleBot.act(view, legal, rng);
        }
        // Every candidate is scored on the same deals, so luck in the
        // sampling affects them all alike.
        let score = |action: &Action, rng: &mut dyn RngCore| -> i64 {
            worlds.iter().map(|world| rollout(world, action, me, rng)).sum()
        };
        let mut best = (i64::MIN, 0);
        for (i, action) in legal.iter().enumerate() {
            let total = score(action, rng);
            if total > best.0 {
                best = (total, i);
            }
        }
        legal[best.1].clone()
    }
}

/// Plays `action` in `world`, then plays the hand out with simple bots.
fn rollout(world: &State, action: &Action, me: Seat, rng: &mut dyn RngCore) -> i64 {
    let mut state = world.clone();
    state.step(me, action.clone());
    while let Turn::Seat(seat) = state.turn() {
        let view = View::new(&state, Viewer::Seat(seat));
        let legal = state.legal_actions();
        let choice = SimpleBot.act(&view, &legal, rng);
        state.step(seat, choice);
    }
    state.payoffs().map_or(0, |p| p[me])
}

/// A full state that `view` cannot tell apart from the real one: the
/// unseen cards dealt at random, honouring every suit a seat has shown it
/// lacks. `None` outside the play phase or for spectators.
pub(crate) fn determinize(view: &View, rng: &mut dyn RngCore) -> Option<State> {
    let PhaseView::Play {
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
    } = &view.phase
    else {
        return None;
    };
    let Viewer::Seat(me) = view.viewer else { return None };
    let rules = &view.rules;
    let seats = rules.players;
    let mighty = rules.mighty(contract.trump);

    let mut seen: Vec<Card> = view.hand.clone();
    seen.extend(tricks.iter().flat_map(|t| t.plays.iter().map(|p| p.card)));
    seen.extend(plays.iter().map(|p| p.card));
    seen.extend(discards.iter().flatten());
    let mut unseen: Vec<Card> = rules.deck.cards().into_iter().filter(|c| !seen.contains(c)).collect();

    // Playing off-suit (other than the mighty or a joker, which never
    // oblige following) shows a seat has none of the led suit.
    let mut void = vec![[false; 4]; seats];
    let finished = tricks.iter().map(|t| (t.plays.as_slice(), Some(t.lead)));
    for (trick, lead) in finished.chain([(plays.as_slice(), *lead)]) {
        let Some(lead) = lead else { continue };
        for p in trick.iter().skip(1) {
            let free = p.card == mighty || p.card.is_joker();
            if !free && p.card.suit() != Some(lead) {
                void[p.seat][suit_index(lead)] = true;
            }
        }
    }

    let mut capacity: Vec<usize> = view.hand_sizes.clone();
    capacity[me] = 0;
    let hidden_discards = if discards.is_some() { 0 } else { rules.kitty_size() };

    for attempt in 0..20 {
        unseen.shuffle(rng);
        // After repeated failures, a wrong inference is likelier than bad
        // luck; deal without the void constraints.
        let respect_voids = attempt < 10;
        let Some((mut hands, sampled_discards)) = deal(&unseen, &capacity, hidden_discards, &void, respect_voids, rng)
        else {
            continue;
        };
        hands[me] = view.hand.clone();
        for hand in &mut hands {
            hand.sort();
        }
        let mut taken = vec![Vec::new(); seats];
        for t in tricks {
            taken[t.winner].extend(t.plays.iter().map(|p| p.card));
        }
        return Some(State {
            rules: rules.clone(),
            first_bidder: view.first_bidder,
            phase: Phase::Play(Play {
                declarer: *declarer,
                contract: *contract,
                discards: discards.clone().unwrap_or(sampled_discards),
                call: *call,
                friend: *friend,
                trick_no: *trick_no,
                leader: *leader,
                lead: *lead,
                plays: plays.clone(),
                called_joker: *called_joker,
                tricks: tricks.clone(),
            }),
            hands,
            kitty: Vec::new(),
            taken,
        });
    }
    None
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
                        && matches!(state.phase, Phase::Play(_))
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
