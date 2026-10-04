//! Reading the table. A sampled deal is likelier when the other players'
//! bids, passes and cards so far are what a sensible player, modelled by
//! [`SimpleBot`], would have chosen with the hands that deal gives them.
//! Someone who feeds points to the declarer's trick plays like the friend,
//! so deals that make them the friend count for more.
//!
//! People are not the simple bot: every decision may be a slip, and bids
//! are read on a sliding scale, so no single odd play rules a deal out.

use crate::bot::{SimpleBot, bit};
use crate::card::{Card, Suit};
use crate::rules::{Contract, Rules};
use crate::state::{Action, Exchange, FriendCall, Phase, Play, State};
use crate::view::View;
use engine::Seat;
use std::collections::HashMap;

/// How the search weighs its sampled deals by what the other players did.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Reading {
    /// Whether to weigh the deals at all; off, every deal counts the same.
    pub on: bool,
    /// How often a player is taken to play some other legal card than the
    /// simple bot's, picked at random.
    pub slip: f64,
    /// How loosely bids and passes are read, in points of the simple bot's
    /// hand estimate: a hand this far short of a bid made it about e times
    /// less often. 0 ignores the bidding.
    pub bid_scale: f64,
    /// The least share of the deals the weights must effectively keep.
    /// When a few deals take nearly all the weight, the model of the other
    /// players is more likely wrong than those deals certain, so the
    /// weights are flattened until this share is kept.
    pub min_share: f64,
    /// Deals sampled for each one played out, the likelier kept more
    /// often. Weights alone leave most playouts on deals that hardly
    /// count; this spends them where the weight is.
    pub draws: usize,
}

impl Default for Reading {
    fn default() -> Reading {
        Reading {
            on: true,
            slip: 0.2,
            bid_scale: 1.0,
            min_share: 0.1,
            draws: 32,
        }
    }
}

/// Weight of a card a seat could not have played in that deal. Deals are
/// only dealt that way when the seats' voids cannot all be honoured.
const IMPOSSIBLE: f64 = -12.0;

/// About how many friend calls are worth considering.
const CALLS: f64 = 6.0;

/// Weight of calling a card the declarer holds itself, playing alone in
/// secret.
const OWN_CALL: f64 = -4.0;

/// The simple bot's choice at each past decision, by the hand it held:
/// many deals give a seat the same hand, especially late in the hand.
#[derive(Debug, Default)]
pub(crate) struct Memo {
    /// Keyed by the decision's place in the hand, the hand, and the
    /// declarer's discards when the declarer is the one deciding. Holds the
    /// legal cards and the card chosen.
    plays: HashMap<(usize, u64, u64), (u64, Card)>,
}

impl Reading {
    /// The log of how likely, up to a constant, the other players' bids
    /// and cards so far are in `world`, as seen by `me`.
    pub(crate) fn log_weight(&self, policy: &SimpleBot, world: &State, me: Seat, memo: &mut Memo) -> f64 {
        if !self.on {
            return 0.0;
        }
        let hands = hands_before_play(world);
        let mut log = 0.0;
        if self.bid_scale > 0.0 {
            log += self.bidding(policy, world, &hands, me);
        }
        if let Phase::Play(p) = &world.phase {
            log += self.play(policy, world, p, hands, me, memo);
        }
        log
    }

    /// Normalized weights for deals with these log weights, flattened as
    /// little as keeps `min_share` of them effectively in play.
    pub(crate) fn weights(&self, log_weights: &[f64]) -> Vec<f64> {
        let n = log_weights.len();
        let top = log_weights.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let tempered = |power: f64| {
            let w: Vec<f64> = log_weights.iter().map(|l| (power * (l - top)).exp()).collect();
            let total: f64 = w.iter().sum();
            w.into_iter().map(|x| x / total).collect::<Vec<f64>>()
        };
        let enough = |w: &[f64]| 1.0 / w.iter().map(|x| x * x).sum::<f64>() >= self.min_share * n as f64;
        if !self.on || n == 0 || !top.is_finite() {
            return vec![1.0 / n as f64; n];
        }
        let full = tempered(1.0);
        if enough(&full) {
            return full;
        }
        let (mut low, mut high) = (0.0, 1.0);
        for _ in 0..20 {
            let mid = (low + high) / 2.0;
            if enough(&tempered(mid)) {
                low = mid;
            } else {
                high = mid;
            }
        }
        tempered(low)
    }

    /// How likely every other seat's bids and passes were with the hand
    /// `world` dealt it. The declarer is judged on the cards it kept.
    fn bidding(&self, policy: &SimpleBot, world: &State, hands: &[Vec<Card>], me: Seat) -> f64 {
        let rules = &world.rules;
        let mut best: Option<Contract> = None;
        let mut log = 0.0;
        for bid in &world.bids {
            if bid.seat != me {
                log += self.bid(policy, rules, &hands[bid.seat], best, bid.contract);
            }
            best = bid.contract.or(best);
        }
        log
    }

    /// The simple bot bids the cheapest bid in its best suit when its
    /// estimate reaches it, and passes otherwise; a bid says the estimate
    /// in its suit reaches the bid. No-trump bids and forced bids say
    /// nothing here.
    fn bid(
        &self,
        policy: &SimpleBot,
        rules: &Rules,
        hand: &[Card],
        best: Option<Contract>,
        made: Option<Contract>,
    ) -> f64 {
        let estimate = |trump: Suit| f64::from(policy.estimate(rules, hand, Some(trump)));
        let cheapest = best.map_or(rules.bidding.min, |b| rules.bidding.min.max(rules.bid_value(b) + 1));
        let forced = best.is_none() && !rules.bidding.first_bidder_may_pass;
        if cheapest > rules.bidding.max || forced {
            return 0.0;
        }
        match made {
            None => {
                let top = Suit::ALL.map(estimate).into_iter().fold(f64::NEG_INFINITY, f64::max);
                log_sigmoid((f64::from(cheapest) - top) / self.bid_scale)
            }
            Some(Contract {
                trump: Some(trump),
                count,
            }) => log_sigmoid((estimate(trump) - f64::from(count)) / self.bid_scale),
            Some(_) => 0.0,
        }
    }

    /// Replays the hand from its first lead with the cards `world` gives
    /// each seat, and asks the simple bot, at every card another seat
    /// played, what it would have played instead.
    fn play(
        &self,
        policy: &SimpleBot,
        world: &State,
        now: &Play,
        hands: Vec<Vec<Card>>,
        me: Seat,
        memo: &mut Memo,
    ) -> f64 {
        let rules = &world.rules;
        let trump = now.contract.trump;
        let discards = if me == now.declarer {
            0
        } else {
            now.discards.iter().fold(0, |m, &c| m | bit(c))
        };
        let mut state = State {
            rules: rules.clone(),
            first_bidder: world.first_bidder,
            phase: Phase::Exchange(Exchange {
                declarer: now.declarer,
                contract: now.contract,
                discards: now.discards.clone(),
                trump_changed: false,
            }),
            hands,
            kitty: Vec::new(),
            taken: vec![Vec::new(); rules.players],
            bids: world.bids.clone(),
            redealt: None,
        };
        let mut log = 0.0;
        if me != now.declarer {
            log += self.friend_call(policy, &state, now.call);
        }
        state.phase = Phase::Play(Play {
            declarer: now.declarer,
            contract: now.contract,
            discards: now.discards.clone(),
            call: now.call,
            friend: match now.call {
                FriendCall::Seat(s) => Some(s),
                _ => None,
            },
            trick_no: 0,
            leader: now.declarer,
            lead: None,
            plays: Vec::new(),
            called_joker: None,
            tricks: Vec::new(),
        });
        let finished = now.tricks.iter().map(|t| (t.plays.as_slice(), Some(t.lead), Some(t)));
        let mut index = 0;
        for (plays, lead, done) in finished.chain([(now.plays.as_slice(), now.lead, None)]) {
            // Who must play a called joker is not on record for finished
            // tricks; the cards after a joker-call card are not read.
            let call_card = plays.first().is_some_and(|first| {
                (rules.deck.jokers().iter()).any(|&j| rules.joker_call_card(j, trump) == Some(first.card))
            });
            for (i, played) in plays.iter().enumerate() {
                let seat = played.seat;
                play_mut(&mut state).lead = if i == 0 { None } else { lead };
                if seat != me && !(call_card && i > 0) {
                    let hand = state.hands[seat].iter().fold(0, |m, &c| m | bit(c));
                    let key = (index, hand, if seat == now.declarer { discards } else { 0 });
                    let (legal, choice) = *memo.plays.entry(key).or_insert_with(|| decide(policy, &state, seat));
                    log += self.card(legal, choice, played.card);
                }
                state.hands[seat].retain(|&c| c != played.card);
                let p = play_mut(&mut state);
                p.plays.push(*played);
                if p.call == FriendCall::Card(played.card) && seat != p.declarer {
                    p.friend = Some(seat);
                }
                index += 1;
            }
            if let Some(trick) = done {
                state.taken[trick.winner].extend(trick.plays.iter().map(|p| p.card));
                let p = play_mut(&mut state);
                if p.call == FriendCall::FirstTrick && p.trick_no == 0 && trick.winner != p.declarer {
                    p.friend = Some(trick.winner);
                }
                p.tricks.push(trick.clone());
                p.plays.clear();
                p.trick_no += 1;
                p.leader = trick.winner;
            }
        }
        log
    }

    /// How likely the declarer was to call `call`, its discards made, in
    /// `state`. The simple bot calls the strongest card it lacks; a slip
    /// picks among the few cards worth calling, and a card the declarer
    /// holds itself is hardly ever called.
    fn friend_call(&self, policy: &SimpleBot, state: &State, call: FriendCall) -> f64 {
        let Phase::Exchange(e) = &state.phase else {
            return 0.0;
        };
        if matches!(call, FriendCall::Card(c) if state.hands[e.declarer].contains(&c)) {
            return OWN_CALL;
        }
        let legal = state.legal_actions();
        let usual = policy.decide(&View::for_policy(state, e.declarer), &legal);
        let usual = if usual == Action::CallFriend(call) {
            1.0 - self.slip
        } else {
            0.0
        };
        (usual + self.slip / CALLS).ln()
    }

    /// How likely a seat whose legal cards were `legal` played `card`,
    /// when the simple bot would have played `choice`.
    fn card(&self, legal: u64, choice: Card, card: Card) -> f64 {
        let options = f64::from(legal.count_ones());
        if legal & bit(card) == 0 {
            IMPOSSIBLE
        } else if options <= 1.0 {
            0.0
        } else {
            let usual = if choice == card { 1.0 - self.slip } else { 0.0 };
            (usual + self.slip / options).ln()
        }
    }
}

/// The legal cards for `seat` in `state`, and the one the simple bot plays.
fn decide(policy: &SimpleBot, state: &State, seat: Seat) -> (u64, Card) {
    let legal = state.legal_actions();
    let cards = legal.iter().fold(0, |m, a| m | bit(card_of(a)));
    let choice = if cards.count_ones() > 1 {
        card_of(&policy.decide(&View::for_policy(state, seat), &legal))
    } else {
        card_of(&legal[0])
    };
    (cards, choice)
}

fn card_of(action: &Action) -> Card {
    match action {
        Action::Play { card, .. } => *card,
        other => unreachable!("{other:?} during play"),
    }
}

fn play_mut(state: &mut State) -> &mut Play {
    match &mut state.phase {
        Phase::Play(p) => p,
        _ => unreachable!("replaying the play"),
    }
}

/// Each seat's hand as the play began (as dealt, while bidding), counting
/// back the cards it has played since.
fn hands_before_play(world: &State) -> Vec<Vec<Card>> {
    let mut hands = world.hands.clone();
    if let Phase::Play(p) = &world.phase {
        for played in p.tricks.iter().flat_map(|t| &t.plays).chain(&p.plays) {
            hands[played.seat].push(played.card);
        }
        for hand in &mut hands {
            hand.sort();
        }
    }
    hands
}

/// `ln(1 / (1 + e^-x))`, without overflow.
fn log_sigmoid(x: f64) -> f64 {
    if x > 0.0 {
        -(-x).exp().ln_1p()
    } else {
        x - x.exp().ln_1p()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::determinize;
    use crate::state::Options;
    use engine::Viewer;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    /// Parses cards such as `"SA D10 HK"`.
    fn cards(s: &str) -> Vec<Card> {
        s.split_whitespace()
            .map(|t| {
                let suit = match &t[..1] {
                    "S" => Suit::Spade,
                    "D" => Suit::Diamond,
                    "H" => Suit::Heart,
                    _ => Suit::Club,
                };
                let rank = match &t[1..] {
                    "J" => 11,
                    "Q" => 12,
                    "K" => 13,
                    "A" => 14,
                    n => n.parse().expect("a rank"),
                };
                Card::new(suit, rank)
            })
            .collect()
    }

    fn play(state: &mut State, card: &str) {
        let action = Action::Play {
            card: cards(card)[0],
            joker_lead: None,
            call_joker: false,
        };
        state.apply(action).expect("legal");
    }

    /// Seat 0 declares hearts, calls ♥A and leads the mighty. Seats 1 and
    /// 2 play their lowest spade, but seat 3, holding small spades, throws
    /// ♠10 onto the declarer's sure trick, as only the friend would.
    #[test]
    fn whoever_feeds_the_declarer_looks_like_the_friend() {
        let rules = Rules::default();
        let options = Options { rules, first_bidder: 0 };
        let mut state = State::new(&options).expect("valid rules");
        let mut hands: Vec<Vec<Card>> = [
            "SA HK HQ HJ H10 H9 DA CA DK D2",
            "S2 S5 D3 D4 D5 D6 C2 C4 C5 C6",
            "S3 S6 D7 D8 D9 C7 C8 C9 H2 H3",
            "HA S10 S4 S7 D10 C10 H4 H5 CJ DJ",
            "SQ SK DQ H6 H7 H8 C3 CQ CK",
        ]
        .map(cards)
        .to_vec();
        hands[4].push(Card::Joker(crate::card::Color::Black));
        let kitty = cards("S8 S9 SJ");
        let deal = Action::Deal {
            hands,
            kitty: kitty.clone(),
        };
        state.apply(deal).expect("a deal");
        let hearts = Contract {
            trump: Some(Suit::Heart),
            count: 13,
        };
        state.apply(Action::Bid(hearts)).expect("legal");
        for _ in 1..5 {
            state.apply(Action::Pass).expect("legal");
        }
        for card in kitty {
            state.apply(Action::Discard(card)).expect("legal");
        }
        let ace = Card::new(Suit::Heart, 14);
        state.apply(Action::CallFriend(FriendCall::Card(ace))).expect("legal");
        for card in ["SA", "S2", "S3", "S10"] {
            play(&mut state, card);
        }

        let view = View::new(&state, Viewer::Seat(4));
        let reading = Reading::default();
        let policy = SimpleBot::default();
        let mut rng = ChaCha8Rng::seed_from_u64(1);
        let mut memo = Memo::default();
        let worlds: Vec<State> = (0..400)
            .map(|_| determinize(&view, &mut rng).expect("a deal"))
            .collect();
        let logs: Vec<f64> = worlds
            .iter()
            .map(|w| reading.log_weight(&policy, w, 4, &mut memo))
            .collect();
        let weights = reading.weights(&logs);
        let friend = |w: &State| w.hands[3].contains(&ace);
        let prior = worlds.iter().filter(|w| friend(w)).count() as f64 / worlds.len() as f64;
        let read: f64 = worlds
            .iter()
            .zip(&weights)
            .filter(|(w, _)| friend(w))
            .map(|(_, x)| x)
            .sum();
        assert!(prior < 0.35, "seat 3 holds ♥A in {prior:.2} of the deals");
        assert!(
            read > 0.5 && read > 2.5 * prior,
            "seat 3 holds ♥A in {read:.2} of the weight"
        );
    }

    #[test]
    fn weights_are_flattened_before_one_deal_takes_them_all() {
        let reading = Reading::default();
        let mut logs = vec![0.0; 100];
        logs[0] = 50.0;
        let w = reading.weights(&logs);
        let kept = 1.0 / w.iter().map(|x| x * x).sum::<f64>();
        assert!((9.9..12.0).contains(&kept), "{kept}");
        assert!(w[0] > w[1]);
        assert_eq!(reading.weights(&[3.0, 3.0]), vec![0.5, 0.5]);
    }
}
