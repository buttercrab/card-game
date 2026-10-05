//! Exact play of a hand's last few tricks with every hand known. The search
//! bot deals the cards it cannot see in many ways; in each such world the
//! end of the hand needs no guessing, so rather than playing it out with
//! rules of thumb, [`solve`] plays it perfectly: alpha-beta over every way
//! the remaining cards can fall, the declarer's side taking as many points
//! as it can and the defence as few. Every payoff rises with the declarer's
//! side's points, so the sides' best play for points is their best play for
//! payoff too.

use crate::card::{Card, Suit};
use crate::rules::Rules;
use crate::state::{self, Action, FriendCall, Phase, Play, State, TrickState};
use crate::trick::{self, Lead, Played, TrickContext};
use engine::Seat;
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// Every seat's payoff when the rest of the hand in `state` is played
/// perfectly by every seat, knowing every hand. `None` unless the hand is
/// being played with at most `tricks` tricks left (counting the one under
/// way), and the sides are settled: a friend named by who wins the first or
/// last trick is not yet known, and then the sides are not two.
pub fn solve(state: &State, tricks: usize) -> Option<Vec<i64>> {
    let Phase::Play(p) = &state.phase else { return None };
    let rules = &state.rules;
    if rules.hand_size - p.trick_no > tricks {
        return None;
    }
    // Playing for points is playing for payoff only where more points
    // never pay less.
    if !state::payoff_rises_with_points(rules, p.contract, p.call == FriendCall::Alone) {
        return None;
    }
    let friend = friend(state, p)?;
    let seats = rules.players;
    let attack: Vec<bool> = (0..seats).map(|s| s == p.declarer || Some(s) == friend).collect();
    let won: usize = (0..seats)
        .filter(|&s| attack[s])
        .flat_map(|s| &state.taken[s])
        .filter(|c| c.is_point())
        .count();
    let won = won + state::discard_points(rules, &p.discards);
    let mut solver = Solver::new(state, p, attack);
    let rest = solver.trick(p.trick_no, p.leader, p.trick(), 0, solver.left);
    let team_points = (won + usize::from(rest)) as u8;
    Some(state::settle(
        rules,
        p.declarer,
        friend,
        p.contract,
        p.call,
        team_points,
    ))
}

/// Who the friend will turn out to be, when every hand is known: `None`
/// inside when the declarer plays alone, `None` outside when the tricks
/// still to come decide it.
fn friend(state: &State, p: &Play) -> Option<Option<Seat>> {
    if p.friend.is_some() {
        return Some(p.friend);
    }
    match p.call {
        // Whoever holds the card; nobody if the declarer does, or it was
        // discarded or already played by the declarer.
        FriendCall::Card(card) => {
            Some((0..state.rules.players).find(|&s| s != p.declarer && state.hands[s].contains(&card)))
        }
        FriendCall::Seat(_) | FriendCall::Alone => Some(None),
        // The declarer took the first trick itself.
        FriendCall::FirstTrick if p.trick_no > 0 => Some(None),
        FriendCall::FirstTrick | FriendCall::LastTrick => None,
    }
}

/// The remaining cards of every seat as bits, for recognising a position
/// reached by playing the same cards in another order.
type Key = ([u64; 8], usize);

/// A quick hash for keys of card sets, which are already well spread bits;
/// the standard one is built to resist attacks and costs more than the
/// searches that use it.
#[derive(Default)]
pub(crate) struct Mix(u64);

impl Hasher for Mix {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.write_u64(u64::from(b));
        }
    }

    fn write_u64(&mut self, n: u64) {
        self.0 = (self.0.rotate_left(5) ^ n).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
    }

    fn write_usize(&mut self, n: usize) {
        self.write_u64(n as u64);
    }
}

fn bit(card: Card) -> u64 {
    match card {
        Card::Normal(suit, rank) => {
            let suit = Suit::ALL.iter().position(|&s| s == suit).expect("every suit is listed");
            1 << (suit * 13 + usize::from(rank) - 2)
        }
        Card::Joker(color) => 1 << (52 + color as usize),
    }
}

fn card_of(action: &Action) -> Card {
    match action {
        Action::Play { card, .. } => *card,
        _ => unreachable!("only plays while playing"),
    }
}

/// A rough order of strength for move ordering: jokers above everything,
/// then by rank.
fn strength(card: Card) -> i32 {
    card.rank().map_or(15, i32::from)
}

struct Solver<'a> {
    rules: &'a Rules,
    seats: usize,
    hands: Vec<Vec<Card>>,
    attack: Vec<bool>,
    /// Jokers won in finished tricks; a gone joker can no longer be called.
    gone: Vec<Card>,
    /// The trick under way.
    plays: Vec<Played>,
    /// Points not yet won by anyone: in hands and in the trick under way.
    left: u8,
    /// Every seat's hand as bits, kept up to date as cards are played.
    masks: [u64; 8],
    /// The cards whose holders' order among a suit's ranks matters: in
    /// hands or on the table. Cards out of play are no longer in the way.
    live: u64,
    /// Cards with powers of their own, never interchangeable with a plain
    /// card of their suit: the mighty and the joker-call cards.
    special: u64,
    /// Whether plain cards of a suit, with nothing live between them, may
    /// be treated as one; not when the rules single out cards.
    merge: bool,
    /// Bounds on the points still to come from the start of a trick, by
    /// position: (at least, at most).
    known: HashMap<Key, (u8, u8), BuildHasherDefault<Mix>>,
    /// Positions searched, for tests and tuning.
    nodes: usize,
}

impl<'a> Solver<'a> {
    fn new(state: &'a State, p: &Play, attack: Vec<bool>) -> Solver<'a> {
        let rules = &state.rules;
        let gone = rules
            .deck
            .jokers()
            .iter()
            .copied()
            .filter(|j| state.taken.iter().any(|t| t.contains(j)))
            .collect();
        let in_play = state.hands.iter().flatten().chain(p.plays.iter().map(|pl| &pl.card));
        let left = in_play.filter(|c| c.is_point()).count() as u8;
        let mut masks = [0u64; 8];
        for (mask, hand) in masks.iter_mut().zip(&state.hands) {
            *mask = hand.iter().fold(0, |m, &c| m | bit(c));
        }
        let live = masks.iter().fold(0, |m, h| m | h) | p.plays.iter().fold(0, |m, pl| m | bit(pl.card));
        let trump = p.contract.trump;
        let calls = rules
            .deck
            .jokers()
            .iter()
            .filter_map(|&j| rules.joker_call_card(j, trump));
        let special = calls.fold(bit(rules.mighty(trump)), |m, c| m | bit(c));
        Solver {
            rules,
            seats: rules.players,
            hands: state.hands.clone(),
            attack,
            gone,
            plays: p.plays.clone(),
            left,
            masks,
            live,
            special,
            merge: rules.policy.overrides.is_empty(),
            known: HashMap::with_capacity_and_hasher(256, BuildHasherDefault::default()),
            nodes: 0,
        }
    }

    fn key(&self, leader: Seat) -> Key {
        (self.masks, leader)
    }

    /// Whether `card` can be left untried because the next lower card of
    /// its suit in the same hand is a legal play too, worth the same
    /// points, and no card still in play ranks between them: either falls
    /// the same way in every trick to come.
    fn redundant(&self, seat: Seat, card: Card, legal: u64) -> bool {
        let (Some(suit), Some(rank)) = (card.suit(), card.rank()) else {
            return false;
        };
        if !self.merge || self.special & bit(card) != 0 {
            return false;
        }
        let hand = &self.hands[seat];
        let Some(&lower) = hand
            .iter()
            .rev()
            .find(|c| c.suit() == Some(suit) && c.rank() < Some(rank))
        else {
            return false;
        };
        if lower.is_point() != card.is_point() || self.special & bit(lower) != 0 {
            return false;
        }
        if legal & bit(lower) == 0 {
            return false;
        }
        // The bits strictly between the two cards.
        let between = (bit(card) - 1) & !((bit(lower) << 1) - 1);
        between & self.live & !self.masks[seat] == 0
    }

    /// The points the declarer's side will win from here on, with the trick
    /// `t` under way (`self.plays` so far, `leader` having led), searching
    /// only for values strictly between `alpha` and `beta`: a result at or
    /// below `alpha` only says the value is no higher, one at or above
    /// `beta` that it is no lower.
    fn trick(&mut self, trick_no: usize, leader: Seat, t: TrickState, mut alpha: u8, mut beta: u8) -> u8 {
        self.nodes += 1;
        // Nothing left to win, or no way past the window.
        if self.left <= alpha || beta == 0 {
            return if self.left <= alpha { self.left } else { 0 };
        }
        let starting = self.plays.is_empty();
        let key = starting.then(|| self.key(leader));
        if let Some((low, high)) = key.and_then(|k| self.known.get(&k).copied()) {
            if low == high || low >= beta {
                return low;
            }
            if high <= alpha {
                return high;
            }
            alpha = alpha.max(low);
            beta = beta.min(high);
        }
        let (alpha0, beta0) = (alpha, beta);
        let seat = (leader + self.plays.len()) % self.seats;
        let gone = &self.gone;
        let mut moves = state::legal_plays(self.rules, &self.hands[seat], t, |j| gone.contains(&j));
        // The cards that may be played plainly, without calling a joker.
        let plain = moves.iter().fold(0, |m, a| match a {
            Action::Play {
                card,
                call_joker: false,
                ..
            } => m | bit(*card),
            _ => m,
        });
        moves.retain(
            |a| !matches!(a, Action::Play { card, call_joker: false, .. } if self.redundant(seat, *card, plain)),
        );
        let maximize = self.attack[seat];
        self.order(&mut moves, seat, t);
        let mut best: Option<u8> = None;
        for action in moves {
            let Action::Play {
                card,
                joker_lead,
                call_joker,
            } = action
            else {
                unreachable!("only plays while playing")
            };
            let value = self.play(trick_no, leader, t, seat, card, joker_lead, call_joker, alpha, beta);
            best = Some(match best {
                None => value,
                Some(b) if maximize => b.max(value),
                Some(b) => b.min(value),
            });
            if maximize {
                alpha = alpha.max(value);
            } else {
                beta = beta.min(value);
            }
            if alpha >= beta {
                break;
            }
        }
        let best = best.expect("a seat to play always has a card");
        if let Some(k) = key {
            let (mut low, mut high) = self.known.get(&k).copied().unwrap_or((0, u8::MAX));
            if best <= alpha0 {
                high = high.min(best);
            } else if best >= beta0 {
                low = low.max(best);
            } else {
                (low, high) = (best, best);
            }
            self.known.insert(k, (low, high));
        }
        best
    }

    /// Tries the likeliest best moves first, so the window closes sooner:
    /// cards that put the mover's side ahead in the trick, the cheapest of
    /// them; else the cards worth least, throwing points only to a partner
    /// ahead.
    fn order(&mut self, moves: &mut [Action], seat: Seat, t: TrickState) {
        if moves.len() < 2 {
            return;
        }
        let Some(lead) = t.lead else {
            // Leading: high cards first.
            moves.sort_by_key(|a| std::cmp::Reverse(strength(card_of(a))));
            return;
        };
        let ctx = TrickContext {
            trump: t.trump,
            mighty: self.rules.mighty(t.trump),
            deck: self.rules.deck,
            lead,
            powerless_joker_passes: self.rules.joker_lead.powerless_passes,
        };
        let side = self.attack[seat];
        let mut plays = std::mem::take(&mut self.plays);
        let partner_ahead = self.attack[plays[trick::winner(&ctx, &plays)].seat] == side;
        let key = |a: &Action, plays: &mut Vec<Played>| {
            let card = card_of(a);
            plays.push(Played {
                seat,
                card,
                powered: state::powered(self.rules, t, card),
            });
            let ahead = plays[trick::winner(&ctx, plays)].seat == seat;
            plays.pop();
            let point = i32::from(card.is_point());
            match (ahead, partner_ahead) {
                // Winning cheaply, but a point card wins a point too.
                (true, _) => (0, strength(card) - 20 * point),
                (false, true) => (1, -point),
                (false, false) => (2, point * 20 + strength(card)),
            }
        };
        // An insertion sort on the stack: there are only a few moves, and
        // this runs at most positions.
        let mut keys = [(0, 0); 32];
        if moves.len() <= keys.len() {
            for i in 0..moves.len() {
                let k = key(&moves[i], &mut plays);
                let mut j = i;
                while j > 0 && keys[j - 1] > k {
                    keys[j] = keys[j - 1];
                    moves.swap(j, j - 1);
                    j -= 1;
                }
                keys[j] = k;
            }
        } else {
            moves.sort_by_cached_key(|a| key(a, &mut plays));
        }
        self.plays = plays;
    }

    /// Plays `card` from `seat` into the trick and searches on: the points
    /// the declarer's side wins from this trick on.
    #[allow(clippy::too_many_arguments)]
    fn play(
        &mut self,
        trick_no: usize,
        leader: Seat,
        mut t: TrickState,
        seat: Seat,
        card: Card,
        joker_lead: Option<Lead>,
        call_joker: bool,
        alpha: u8,
        beta: u8,
    ) -> u8 {
        let index = self.hands[seat]
            .iter()
            .position(|&c| c == card)
            .expect("a legal card is held");
        self.hands[seat].remove(index);
        self.masks[seat] &= !bit(card);
        if self.plays.is_empty() {
            t.lead = if card.is_joker() {
                joker_lead
            } else {
                card.suit().map(Lead::Suit)
            };
            let gone = &self.gone;
            t.called_joker = if call_joker {
                state::callable_joker(self.rules, t, card, |j| gone.contains(&j))
            } else {
                None
            };
        }
        let powered = state::powered(self.rules, t, card);
        self.plays.push(Played { seat, card, powered });
        let value = if self.plays.len() < self.seats {
            self.trick(trick_no, leader, t, alpha, beta)
        } else {
            self.finish(trick_no, t, alpha, beta)
        };
        self.plays.pop();
        self.hands[seat].insert(index, card);
        self.masks[seat] |= bit(card);
        value
    }

    /// Settles the full trick and searches the next one.
    fn finish(&mut self, trick_no: usize, t: TrickState, alpha: u8, beta: u8) -> u8 {
        let ctx = TrickContext {
            trump: t.trump,
            mighty: self.rules.mighty(t.trump),
            deck: self.rules.deck,
            lead: t.lead.expect("a full trick has a lead"),
            powerless_joker_passes: self.rules.joker_lead.powerless_passes,
        };
        let winner = self.plays[trick::winner(&ctx, &self.plays)].seat;
        let points = self.plays.iter().filter(|p| p.card.is_point()).count() as u8;
        let won = if self.attack[winner] { points } else { 0 };
        if trick_no + 1 == self.rules.hand_size {
            return won;
        }
        let plays = std::mem::take(&mut self.plays);
        let jokers = self.gone.len();
        self.gone.extend(plays.iter().map(|p| p.card).filter(|c| c.is_joker()));
        self.left -= points;
        let out = plays.iter().fold(0, |m, p| m | bit(p.card));
        self.live &= !out;
        let next = TrickState {
            trump: t.trump,
            trick_no: trick_no + 1,
            lead: None,
            called_joker: None,
        };
        let rest = self.trick(
            trick_no + 1,
            winner,
            next,
            alpha.saturating_sub(won),
            beta.saturating_sub(won),
        );
        self.left += points;
        self.live |= out;
        self.gone.truncate(jokers);
        self.plays = plays;
        won + rest
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Mighty;
    use crate::bot::SimpleBot;
    use crate::rules::Preset;
    use engine::{Bot, Game, Turn, Viewer};
    use rand::{Rng, SeedableRng};
    use rand_chacha::ChaCha8Rng;

    /// Plain minimax over the game itself, every seat's move tried in turn:
    /// the declarer's side's final points.
    fn brute(state: &State, attack: &[bool]) -> u8 {
        match Mighty::turn(state) {
            Turn::Over => match &state.phase {
                Phase::Done(d) => d.team_points,
                _ => unreachable!(),
            },
            Turn::Seat(seat) => {
                let values = Mighty::legal_actions(state).into_iter().map(|a| {
                    let mut next = state.clone();
                    Mighty::apply(&mut next, a).unwrap();
                    brute(&next, attack)
                });
                if attack[seat] { values.max() } else { values.min() }.unwrap()
            }
            Turn::Chance => unreachable!(),
        }
    }

    /// Hands played by simple bots up to `tricks` tricks from the end, the
    /// trick under way cut off after a random number of cards.
    fn positions(preset: Preset, tricks: usize, n: u64) -> Vec<State> {
        positions_for(&preset.rules(), tricks, n)
    }

    /// [`positions`] under any rules.
    fn positions_for(rules: &Rules, tricks: usize, n: u64) -> Vec<State> {
        let mut out = Vec::new();
        let mut rng = ChaCha8Rng::seed_from_u64(n);
        let mut game = 0;
        while out.len() < n as usize {
            game += 1;
            let options = crate::Options {
                rules: rules.clone(),
                first_bidder: game % rules.players,
            };
            let mut state = Mighty::new_game(&options).unwrap();
            let cut = rng.random_range(0..rules.players);
            loop {
                if let Phase::Play(p) = &state.phase
                    && rules.hand_size - p.trick_no == tricks
                    && p.plays.len() == cut
                {
                    out.push(state.clone());
                    break;
                }
                let action = match Mighty::turn(&state) {
                    Turn::Over => break,
                    Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                    Turn::Seat(seat) => {
                        let view = Mighty::view(&state, Viewer::Seat(seat));
                        let legal = Mighty::legal_actions(&state);
                        SimpleBot::default().act(&view, &legal, &mut rng)
                    }
                };
                Mighty::apply(&mut state, action).unwrap();
            }
        }
        out
    }

    /// The solver agrees with plain minimax over the game's own rules, in
    /// every preset, for the last two tricks.
    #[test]
    fn matches_minimax_over_the_rules() {
        for preset in Preset::ALL {
            for state in positions(preset, 2, 12) {
                let Some(payoffs) = solve(&state, 2) else { continue };
                let Phase::Play(p) = &state.phase else { unreachable!() };
                let friend = friend(&state, p).unwrap();
                let attack: Vec<bool> = (0..5).map(|s| s == p.declarer || Some(s) == friend).collect();
                let points = brute(&state, &attack);
                let expected = state::settle(&state.rules, p.declarer, friend, p.contract, p.call, points);
                assert_eq!(payoffs, expected, "{preset}");
            }
        }
    }

    /// Three tricks from the end, against plain minimax too.
    #[test]
    fn matches_minimax_three_tricks_out() {
        for preset in [Preset::Gshs, Preset::Default] {
            for state in positions(preset, 3, 4) {
                let Some(payoffs) = solve(&state, 3) else { continue };
                let Phase::Play(p) = &state.phase else { unreachable!() };
                let friend = friend(&state, p).unwrap();
                let attack: Vec<bool> = (0..5).map(|s| s == p.declarer || Some(s) == friend).collect();
                let points = brute(&state, &attack);
                assert_eq!(
                    payoffs,
                    state::settle(&state.rules, p.declarer, friend, p.contract, p.call, points)
                );
            }
        }
    }

    /// The solver agrees with plain minimax under the optional rules too:
    /// other table sizes and decks, discards counting for the defence,
    /// trump released only beside jokers, no joker lead on the first trick,
    /// and every way of scoring a win or a loss; where more points can pay
    /// less, it declines.
    #[test]
    fn matches_minimax_under_the_optional_rules() {
        use crate::rules::{BackRun, Doubling, LoseScore, Scoring, WinScore};
        let mut variants = Vec::new();
        for preset in [Preset::Default, Preset::Gshs, Preset::Yonsei] {
            for players in [3, 4, 6, 7] {
                variants.push(preset.rules().for_players(players).unwrap());
            }
            let mut r = preset.rules();
            r.scoring.discards_to_declarer = !r.scoring.discards_to_declarer;
            r.policy.release_with_mighty = !r.policy.release_with_mighty;
            r.joker_lead.not_first_trick = !r.joker_lead.not_first_trick;
            variants.push(r);
            let wins = [
                WinScore::OverMin,
                WinScore::OverBid,
                WinScore::BidBonus,
                WinScore::BothOver(13),
            ];
            for (win, lose) in wins
                .into_iter()
                .flat_map(|win| [LoseScore::Shortfall, LoseScore::PaysBack(10)].map(|lose| (win, lose)))
            {
                let mut r = preset.rules();
                r.scoring = Scoring {
                    win,
                    lose,
                    no_trump: Doubling::Always,
                    alone: Doubling::Always,
                    run: true,
                    back_run: BackRun::DefenceReachesBid,
                    full_contract: Doubling::Always,
                    discards_to_declarer: false,
                };
                variants.push(r);
            }
        }
        let (mut solved, mut declined) = (0, 0);
        for rules in &variants {
            for state in positions_for(rules, 2, 6) {
                let Phase::Play(p) = &state.phase else { unreachable!() };
                let Some(friend) = friend(&state, p) else { continue };
                let rises = state::payoff_rises_with_points(rules, p.contract, p.call == FriendCall::Alone);
                let Some(payoffs) = solve(&state, 2) else {
                    assert!(!rises, "declined a position it could solve");
                    declined += 1;
                    continue;
                };
                let seats = rules.players;
                let attack: Vec<bool> = (0..seats).map(|s| s == p.declarer || Some(s) == friend).collect();
                let points = brute(&state, &attack);
                assert_eq!(
                    payoffs,
                    state::settle(rules, p.declarer, friend, p.contract, p.call, points),
                    "{rules:?}"
                );
                solved += 1;
            }
        }
        assert!(solved > 100, "only {solved} positions solved ({declined} declined)");
    }

    /// Searching a narrow window gives a bound on the right side of it, or
    /// the value itself inside it.
    #[test]
    fn windows_bound_the_value() {
        for preset in [Preset::Gshs, Preset::Skku] {
            for state in positions(preset, 4, 6) {
                let Phase::Play(p) = &state.phase else { unreachable!() };
                let Some(friend) = friend(&state, p) else { continue };
                let attack: Vec<bool> = (0..5).map(|s| s == p.declarer || Some(s) == friend).collect();
                let solver = || Solver::new(&state, p, attack.clone());
                let mut full = solver();
                let value = full.trick(p.trick_no, p.leader, p.trick(), 0, full.left);
                for alpha in 0..full.left {
                    for beta in alpha + 1..=full.left.min(alpha + 3) {
                        let r = solver().trick(p.trick_no, p.leader, p.trick(), alpha, beta);
                        if r <= alpha {
                            assert!(value <= r);
                        } else if r >= beta {
                            assert!(value >= r);
                        } else {
                            assert_eq!(value, r);
                        }
                    }
                }
            }
        }
    }

    /// Not solved: too many tricks left, or a friend the last trick names.
    #[test]
    fn declines_what_it_cannot_settle() {
        let state = &positions(Preset::Default, 5, 1)[0];
        assert!(solve(state, 4).is_none());
        let mut late = positions(Preset::Default, 2, 1).remove(0);
        if let Phase::Play(p) = &mut late.phase {
            p.call = FriendCall::LastTrick;
            p.friend = None;
        }
        assert!(solve(&late, 2).is_none());
    }

    /// Solving against playing out with the simple bot, by tricks left:
    /// `cargo test --release -p mighty solve_times -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn solve_times() {
        for tricks in 2..=5 {
            let states = positions(Preset::Gshs, tricks, 200);
            let started = std::time::Instant::now();
            let mut nodes = Vec::new();
            for state in &states {
                let Phase::Play(p) = &state.phase else { unreachable!() };
                let Some(friend) = friend(state, p) else { continue };
                let attack: Vec<bool> = (0..5).map(|s| s == p.declarer || Some(s) == friend).collect();
                let mut s = Solver::new(state, p, attack);
                s.trick(p.trick_no, p.leader, p.trick(), 0, s.left);
                nodes.push(s.nodes);
            }
            let solving = started.elapsed().as_secs_f64() * 1e6 / nodes.len() as f64;
            let started = std::time::Instant::now();
            let mut rng = ChaCha8Rng::seed_from_u64(1);
            for state in &states {
                crate::search::playout(SimpleBot::default(), state.clone(), 0, &mut rng);
            }
            let playing = started.elapsed().as_secs_f64() * 1e6 / states.len() as f64;
            println!(
                "{tricks} tricks: {:.0} positions on average, {} at most; {solving:.0} us solving, {playing:.0} us playing out",
                nodes.iter().sum::<usize>() as f64 / nodes.len() as f64,
                nodes.iter().max().unwrap_or(&0),
            );
        }
    }
}
