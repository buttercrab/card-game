//! 기본 (`Preset::Default`): the owner's written rules, one scenario per
//! rule, in the order the rules give them (see RULES.md, "기본").

use engine::{Game, Turn, Viewer};
use mighty::card::{Card, Color, Suit};
use mighty::rules::{Contract, Preset, Rules};
use mighty::{Action, FriendCall, HandSummary, Mighty, Options, PhaseView, Redeal, State};

fn cards(s: &str) -> Vec<Card> {
    s.split_whitespace()
        .map(|t| match t {
            "BJ" => Card::Joker(Color::Black),
            _ => {
                let suit = match &t[..1] {
                    "S" => Suit::Spade,
                    "D" => Suit::Diamond,
                    "H" => Suit::Heart,
                    "C" => Suit::Club,
                    _ => panic!("bad suit in {t}"),
                };
                let rank = match &t[1..] {
                    "J" => 11,
                    "Q" => 12,
                    "K" => 13,
                    "A" => 14,
                    n => n.parse().expect("bad rank"),
                };
                Card::new(suit, rank)
            }
        })
        .collect()
}

fn card(s: &str) -> Card {
    cards(s)[0]
}

fn basic() -> Rules {
    Preset::Default.rules()
}

/// Deals the given hands to the first seats and the given kitty; the rest
/// of the deck fills the other seats, then the kitty. Seat 0 deals and
/// bids first.
fn start(fixed: &[&str], kitty: &str) -> State {
    let rules = basic();
    let mut state = Mighty::new_game(&Options {
        rules: rules.clone(),
        first_bidder: 0,
    })
    .unwrap();
    let mut hands: Vec<Vec<Card>> = fixed.iter().map(|h| cards(h)).collect();
    let mut kitty = cards(kitty);
    let used: Vec<Card> = hands.iter().flatten().chain(&kitty).copied().collect();
    let mut rest = rules.cards().into_iter().filter(|c| !used.contains(c));
    while hands.len() < rules.players {
        hands.push(rest.by_ref().take(rules.hand_size).collect());
    }
    kitty.extend(rest);
    Mighty::apply(&mut state, Action::Deal { hands, kitty }).unwrap();
    state
}

fn act(state: &mut State, action: Action) {
    Mighty::apply(state, action.clone()).unwrap_or_else(|e| panic!("{action:?}: {e}"));
}

fn legal(state: &State) -> Vec<Action> {
    Mighty::legal_actions(state)
}

/// Takes the first legal action.
fn act_first(state: &mut State) {
    let action = legal(state)[0].clone();
    act(state, action);
}

fn bid(trump: Option<Suit>, count: u8) -> Action {
    Action::Bid(Contract { trump, count })
}

/// Everyone answers "no misdeal".
fn no_misdeals(state: &mut State) {
    for _ in 0..5 {
        act(state, Action::Pass);
    }
}

/// Seat 0 wins the bidding with `contract`, the others passing.
fn win_bid(state: &mut State, trump: Option<Suit>, count: u8) {
    no_misdeals(state);
    act(state, bid(trump, count));
    for _ in 1..5 {
        act(state, Action::Pass);
    }
}

fn play(card: Card) -> Action {
    Action::Play {
        card,
        joker_lead: None,
        call_joker: false,
    }
}

fn playable(state: &State) -> Vec<Card> {
    let mut out: Vec<Card> = legal(state)
        .into_iter()
        .filter_map(|a| match a {
            Action::Play { card, .. } => Some(card),
            _ => None,
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

fn phase(state: &State) -> PhaseView {
    Mighty::view(state, Viewer::Spectator).phase
}

const H: Option<Suit> = Some(Suit::Heart);
const D: Option<Suit> = Some(Suit::Diamond);
const S: Option<Suit> = Some(Suit::Spade);

#[test]
fn deck_mighty_and_joker_call() {
    let r = basic();
    assert_eq!(r.cards().len(), 53);
    assert_eq!(r.cards().iter().filter(|c| c.is_point()).count(), 20);
    assert_eq!(r.mighty(H), card("SA"));
    assert_eq!(r.mighty(S), card("DA"));
    assert_eq!(r.mighty(None), card("SA"));
    let joker = Card::Joker(Color::Black);
    assert_eq!(r.joker_call_card(joker, H), Some(card("C3")));
    assert_eq!(r.joker_call_card(joker, Some(Suit::Club)), Some(card("S3")));
    assert_eq!(r.joker_call_card(joker, None), Some(card("C3")));
}

#[test]
fn misdeal_counts_halves() {
    let r = basic();
    let low = "S2 S3 S4 S5 S6 S7 S8 D2";
    let hand = |extra: &str| cards(&format!("{low} {extra}"));
    // ♠A is worth nothing, whatever trump will be.
    assert!(r.is_misdeal(&hand("SA D3")));
    // A ten is ½; two are 1.
    assert!(r.is_misdeal(&hand("D10 D3")));
    assert!(!r.is_misdeal(&hand("D10 H10")));
    // J, Q, K, A are 1 each; the joker takes one away.
    assert!(!r.is_misdeal(&hand("DJ D3")));
    assert!(r.is_misdeal(&hand("DJ BJ")));
    assert!(r.is_misdeal(&cards("S2 S3 S4 S5 S6 S7 S8 DJ BJ H10")));
    assert!(!r.is_misdeal(&cards("S2 S3 S4 S5 S6 S7 DK DJ BJ H10")));
}

const WEAK: &str = "S2 S3 S4 S5 S6 S7 S8 H2 H3 C2";

#[test]
fn everyone_answers_misdeal_before_any_bid() {
    let mut state = start(&["D2 D3 D4 D5 D6 D7 D8 D9 DA DK", WEAK], "");
    // The dealer first; a hand that does not qualify can only say no.
    assert!(matches!(
        phase(&state),
        PhaseView::Bidding {
            asking_misdeal: true,
            to_act: 0,
            ..
        }
    ));
    assert_eq!(legal(&state), vec![Action::Pass]);
    act(&mut state, Action::Pass);
    assert_eq!(legal(&state), vec![Action::Misdeal, Action::Pass]);
    for _ in 1..5 {
        act(&mut state, Action::Pass);
    }
    // Then the bidding, from the dealer; nobody may call a misdeal now.
    assert!(matches!(
        phase(&state),
        PhaseView::Bidding {
            asking_misdeal: false,
            to_act: 0,
            ..
        }
    ));
    assert!(Mighty::view(&state, Viewer::Spectator).bids.is_empty());
    act(&mut state, bid(S, 14));
    assert_eq!(Mighty::turn(&state), Turn::Seat(1));
    assert!(!legal(&state).contains(&Action::Misdeal));
}

#[test]
fn the_misdeal_nearest_the_dealer_is_shown_and_its_caller_deals() {
    let mut state = start(
        &["D2 D3 D4 D5 D6 D7 D8 D9 DA DK", "C4 C5 C6 C7 C8 C9 H4 H5 H6 H7", WEAK],
        "",
    );
    act(&mut state, Action::Pass);
    act(&mut state, Action::Pass);
    act(&mut state, Action::Misdeal);
    assert_eq!(Mighty::turn(&state), Turn::Chance);
    let deal = Mighty::sample_chance(&state, &mut rand::rng());
    act(&mut state, deal);
    let view = Mighty::view(&state, Viewer::Seat(4));
    assert_eq!(
        view.redealt.unwrap().why,
        Redeal::Misdeal {
            seat: 2,
            hand: cards(WEAK)
        }
    );
    // Seat 2 deals the new hand and so speaks first.
    assert_eq!(view.first_bidder, 2);
    assert_eq!(Mighty::turn(&state), Turn::Seat(2));
}

#[test]
fn bids_rise_by_difficulty_from_14() {
    let mut state = start(&[], "");
    no_misdeals(&mut state);
    let l = legal(&state);
    // 노기루다 counts one more: 노기루다 13 is worth 14, a suit must say 14.
    assert!(l.contains(&bid(None, 13)) && !l.contains(&bid(None, 12)));
    assert!(l.contains(&bid(S, 14)) && !l.contains(&bid(S, 13)));
    // A pass is allowed, also for the dealer.
    assert!(l.contains(&Action::Pass));
    act(&mut state, bid(S, 15));
    let l = legal(&state);
    // Strictly harder: 노기루다 14 (15) ties ♠15, so not enough.
    assert!(!l.contains(&bid(None, 14)) && l.contains(&bid(None, 15)));
    assert!(!l.contains(&bid(H, 15)) && l.contains(&bid(H, 16)));
    assert!(!l.contains(&bid(H, 21)));
}

#[test]
fn no_trump_20_ends_the_bidding() {
    let mut state = start(&[], "");
    no_misdeals(&mut state);
    act(&mut state, bid(None, 20));
    assert!(matches!(phase(&state), PhaseView::Exchange { declarer: 0, .. }));
}

#[test]
fn a_pass_is_final_and_the_last_bidder_declares() {
    let mut state = start(&[], "");
    no_misdeals(&mut state);
    act(&mut state, bid(S, 14)); // 0
    act(&mut state, Action::Pass); // 1
    act(&mut state, bid(H, 15)); // 2
    act(&mut state, Action::Pass); // 3
    act(&mut state, Action::Pass); // 4
    // Seat 1 passed and is skipped; only 0 and 2 go on.
    assert_eq!(Mighty::turn(&state), Turn::Seat(0));
    act(&mut state, Action::Pass);
    assert!(matches!(phase(&state), PhaseView::Exchange { declarer: 2, .. }));
}

#[test]
fn after_five_passes_the_dealer_may_bid_13_once() {
    let mut state = start(&[], "");
    no_misdeals(&mut state);
    for _ in 0..5 {
        act(&mut state, Action::Pass);
    }
    assert_eq!(Mighty::turn(&state), Turn::Seat(0));
    let l = legal(&state);
    assert!(l.contains(&bid(S, 13)) && l.contains(&bid(None, 12)) && !l.contains(&bid(S, 12)));
    let mut taken = state.clone();
    act(&mut taken, bid(S, 13));
    assert!(matches!(phase(&taken), PhaseView::Exchange { declarer: 0, .. }));

    // A second pass deals again with the same dealer; it is not a misdeal.
    act(&mut state, Action::Pass);
    assert_eq!(Mighty::turn(&state), Turn::Chance);
    let deal = Mighty::sample_chance(&state, &mut rand::rng());
    act(&mut state, deal);
    let view = Mighty::view(&state, Viewer::Spectator);
    assert_eq!(view.redealt.unwrap().why, Redeal::AllPassed);
    assert_eq!(view.first_bidder, 0);
}

const DECLARER: &str = "D2 D3 D4 D5 D6 D7 D8 D9 C3 C4";
const KITTY: &str = "C5 C6 C7";

#[test]
fn the_declarer_may_keep_raise_or_change_the_contract() {
    let mut state = start(&[DECLARER], KITTY);
    win_bid(&mut state, D, 14);
    let l = legal(&state);
    let raise = |trump, count| Action::Raise(Contract { trump, count });
    // Keep trump: raise to any count up to 20, or stay by discarding.
    assert!(l.contains(&raise(D, 15)) && l.contains(&raise(D, 20)) && !l.contains(&raise(D, 21)));
    assert!(l.contains(&Action::Discard(card("C5"))));
    // Change: worth at least 2 more. Suit to suit +2, to 노기루다 +1.
    assert!(l.contains(&Action::ChangeTrump(S)) && l.contains(&raise(S, 17)) && !l.contains(&raise(S, 15)));
    assert!(l.contains(&Action::ChangeTrump(None)) && l.contains(&raise(None, 16)));
    let mut changed = state.clone();
    act(&mut changed, Action::ChangeTrump(S));
    let mut no_trump = state.clone();
    act(&mut no_trump, Action::ChangeTrump(None));
    let contract = |s: &State| match phase(s) {
        PhaseView::Exchange { contract, .. } => contract,
        other => panic!("{other:?}"),
    };
    assert_eq!(contract(&changed), Contract { trump: S, count: 16 });
    assert_eq!(contract(&no_trump), Contract { trump: None, count: 15 });
    // Decided once, before discarding.
    assert!(
        !legal(&changed)
            .iter()
            .any(|a| matches!(a, Action::Raise(_) | Action::ChangeTrump(_)))
    );
    act(&mut state, raise(D, 16));
    assert_eq!(contract(&state), Contract { trump: D, count: 16 });

    // From 노기루다 to a suit costs 3.
    let mut state = start(&[DECLARER], KITTY);
    win_bid(&mut state, None, 14);
    act(&mut state, Action::ChangeTrump(H));
    assert_eq!(contract(&state), Contract { trump: H, count: 17 });
}

#[test]
fn any_card_may_be_discarded_and_discards_stay_hidden() {
    let mut state = start(&["SA BJ C3 D5 D6 D7 D8 D9 DK DQ"], KITTY);
    win_bid(&mut state, D, 14);
    for c in ["SA", "BJ", "C3"] {
        act(&mut state, Action::Discard(card(c)));
    }
    act(&mut state, Action::CallFriend(FriendCall::Alone));
    while Mighty::turn(&state) != Turn::Over {
        let action = legal(&state)[0].clone();
        act(&mut state, action);
    }
    let discards = |viewer| match Mighty::view(&state, viewer).phase {
        PhaseView::Done { discards, .. } => discards,
        other => panic!("{other:?}"),
    };
    assert_eq!(discards(Viewer::Seat(0)), cards("SA BJ C3"));
    assert!(discards(Viewer::Seat(1)).is_empty() && discards(Viewer::Spectator).is_empty());
    // ♠A in the discards counts for the declarer.
    let PhaseView::Done { team_points, .. } = phase(&state) else {
        unreachable!()
    };
    let won: usize = Mighty::view(&state, Viewer::Spectator).points_taken[0].len();
    assert_eq!(usize::from(team_points), won + 1);
}

#[test]
fn friend_forms() {
    let mut state = start(&[DECLARER], KITTY);
    win_bid(&mut state, D, 14);
    for c in ["C5", "C6", "C7"] {
        act(&mut state, Action::Discard(card(c)));
    }
    let l = legal(&state);
    let call = |c: FriendCall| Action::CallFriend(c);
    assert!(l.contains(&call(FriendCall::Alone)));
    assert!(l.contains(&call(FriendCall::Card(card("SA")))));
    // A card in hand or just discarded: a false no-friend.
    assert!(l.contains(&call(FriendCall::Card(card("D2")))) && l.contains(&call(FriendCall::Card(card("C5")))));
    assert!((1..5).all(|s| l.contains(&call(FriendCall::Seat(s)))));
    assert!(l.contains(&call(FriendCall::FirstTrick)));
    assert!(!l.contains(&call(FriendCall::LastTrick)));
    // A named player is known at once.
    act(&mut state, call(FriendCall::Seat(3)));
    assert!(matches!(phase(&state), PhaseView::Play { friend: Some(3), .. }));
}

/// Seat 0 declares hearts with `hand` plus the kitty, discards the kitty
/// and plays alone; returns what it may lead.
fn first_lead(hand: &str) -> Vec<Card> {
    let mut state = start(&[hand], KITTY);
    win_bid(&mut state, H, 14);
    for c in ["C5", "C6", "C7"] {
        act(&mut state, Action::Discard(card(c)));
    }
    act(&mut state, Action::CallFriend(FriendCall::Alone));
    playable(&state)
}

#[test]
fn the_first_lead_may_not_be_the_joker_or_trump() {
    assert_eq!(first_lead("H2 H3 H4 H5 H6 H7 H8 BJ D2 C3"), cards("D2 C3"));
    // Ten trumps, or nine and the joker: trump, still not the joker.
    assert_eq!(
        first_lead("H2 H3 H4 H5 H6 H7 H8 H9 H10 HJ"),
        cards("H2 H3 H4 H5 H6 H7 H8 H9 H10 HJ")
    );
    assert_eq!(
        first_lead("H2 H3 H4 H5 H6 H7 H8 H9 H10 BJ"),
        cards("H2 H3 H4 H5 H6 H7 H8 H9 H10")
    );
    // Nine trumps and the mighty: the mighty leads.
    assert_eq!(first_lead("H2 H3 H4 H5 H6 H7 H8 H9 H10 SA"), cards("SA"));
}

#[test]
fn the_joker_call_does_nothing_on_the_first_trick() {
    let mut state = start(&[DECLARER], KITTY);
    win_bid(&mut state, D, 14);
    for c in ["C5", "C6", "C7"] {
        act(&mut state, Action::Discard(card(c)));
    }
    act(&mut state, Action::CallFriend(FriendCall::Alone));
    assert!(legal(&state).contains(&play(card("C3"))));
    assert!(
        !legal(&state)
            .iter()
            .any(|a| matches!(a, Action::Play { call_joker: true, .. }))
    );
}

#[test]
fn others_may_play_trump_on_the_first_trick_and_a_joker_there_is_weak() {
    // Diamonds trump. Seats 1 and 2 have no clubs: seat 1 trumps, and
    // seat 2's joker is weak on the first trick.
    let mut state = start(
        &[
            DECLARER,
            "DJ DQ H2 H3 H4 H5 H6 H7 H8 H9",
            "BJ S4 S5 S6 S7 S8 S9 S10 SJ SQ",
        ],
        KITTY,
    );
    win_bid(&mut state, D, 14);
    for c in ["C5", "C6", "C7"] {
        act(&mut state, Action::Discard(card(c)));
    }
    act(&mut state, Action::CallFriend(FriendCall::Alone));
    act(&mut state, play(card("C4")));
    assert!(playable(&state).contains(&card("DJ")));
    act(&mut state, play(card("DJ")));
    act(&mut state, play(Card::Joker(Color::Black)));
    let PhaseView::Play { leading, plays, .. } = phase(&state) else {
        unreachable!()
    };
    assert_eq!(leading, Some(1));
    assert!(!plays[2].powered);
}

/// Every card dealt, so the first trick goes as planned: seat 0 declares
/// diamonds alone and wins trick 1 with ♣A; seat 2 holds `holder`, seats 3
/// and 4 the rest. Returns the state as seat 0 leads trick 2.
fn after_first_trick(seat0: &str, holder: &str, seat3: &str) -> State {
    let mut state = start(
        &[
            seat0,
            "H2 H3 H4 H5 H6 H7 H8 H9 H10 HJ",
            holder,
            seat3,
            "C8 D2 D3 D4 D5 D6 D7 DA HK HA",
        ],
        KITTY,
    );
    win_bid(&mut state, D, 14);
    for c in ["C5", "C6", "C7"] {
        act(&mut state, Action::Discard(card(c)));
    }
    act(&mut state, Action::CallFriend(FriendCall::Alone));
    act(&mut state, play(card("CA")));
    while matches!(phase(&state), PhaseView::Play { trick_no: 0, .. }) {
        // Follow with a plain card where possible.
        let cards = playable(&state);
        let c = *cards
            .iter()
            .find(|c| !c.is_joker() && **c != card("SA"))
            .unwrap_or(&cards[0]);
        act(&mut state, play(c));
    }
    assert_eq!(Mighty::turn(&state), Turn::Seat(0));
    state
}

const SEAT0: &str = "CA DK DQ DJ D10 D9 D8 C3 S2 S3";

#[test]
fn a_joker_call_forces_the_joker_out_weak_unless_the_mighty_defends() {
    let call = Action::Play {
        card: card("C3"),
        joker_lead: None,
        call_joker: true,
    };
    let mut state = after_first_trick(
        SEAT0,
        "BJ SK C9 C10 CJ CQ CK S4 S5 S6",
        "C2 C4 S7 S8 S9 S10 SJ SQ SA HQ",
    );
    // The leader says whether the call is on.
    assert!(legal(&state).contains(&call) && legal(&state).contains(&play(card("C3"))));
    act(&mut state, call.clone());
    act_first(&mut state);
    assert_eq!(playable(&state), vec![Card::Joker(Color::Black)]);
    act(&mut state, play(Card::Joker(Color::Black)));
    let PhaseView::Play { plays, .. } = phase(&state) else {
        unreachable!()
    };
    assert!(!plays.last().unwrap().powered);

    // Holding the mighty too, either may go.
    let mut state = after_first_trick(
        SEAT0,
        "BJ SA C9 C10 CJ CQ CK S4 S5 S6",
        "C2 C4 S7 S8 S9 S10 SJ SQ SK HQ",
    );
    act(&mut state, call);
    act_first(&mut state);
    let mut both = cards("SA BJ");
    both.sort();
    assert_eq!(playable(&state), both);
}

#[test]
fn a_joker_lead_names_exactly_one_suit() {
    let mut state = after_first_trick(
        "CA DK DQ DJ D10 D9 D8 BJ S2 S3",
        "C3 SK C9 C10 CJ CQ CK S4 S5 S6",
        "C2 C4 S7 S8 S9 S10 SJ SQ SA HQ",
    );
    let joker_leads: Vec<Option<mighty::Lead>> = legal(&state)
        .into_iter()
        .filter_map(|a| match a {
            Action::Play { card, joker_lead, .. } if card.is_joker() => Some(joker_lead),
            _ => None,
        })
        .collect();
    let suits: Vec<Option<mighty::Lead>> = Suit::ALL.map(|s| Some(mighty::Lead::Suit(s))).to_vec();
    assert_eq!(joker_leads, suits);
    act(
        &mut state,
        Action::Play {
            card: Card::Joker(Color::Black),
            joker_lead: Some(mighty::Lead::Suit(Suit::Heart)),
            call_joker: false,
        },
    );
    // Seat 1, all hearts, must follow; the joker is strong on trick 2.
    assert_eq!(playable(&state).len(), 9);
    act_first(&mut state);
    let PhaseView::Play { leading, .. } = phase(&state) else {
        unreachable!()
    };
    assert_eq!(leading, Some(0));
}

#[test]
fn the_mighty_must_follow_its_suit_unless_the_joker_is_held() {
    // Spades led, seat 1's only spade is the mighty.
    let lead_spade = |second: &str| {
        let mut state = start(&["S2 S3 S4 S5 S6 S7 S8 S9 S10 SJ", second], KITTY);
        win_bid(&mut state, D, 14);
        for c in ["C5", "C6", "C7"] {
            act(&mut state, Action::Discard(card(c)));
        }
        act(&mut state, Action::CallFriend(FriendCall::Alone));
        act(&mut state, play(card("S2")));
        playable(&state)
    };
    assert_eq!(lead_spade("SA H2 H3 H4 H5 H6 H7 H8 H9 H10"), cards("SA"));
    let mut both = cards("SA BJ");
    both.sort();
    assert_eq!(lead_spade("SA BJ H3 H4 H5 H6 H7 H8 H9 H10"), both);
}

#[test]
fn the_next_dealer_is_the_friend_or_else_the_declarer() {
    let r = basic();
    let summary = |friend| HandSummary {
        contract: Contract { trump: D, count: 14 },
        declarer: 1,
        friend,
        made: true,
        team_points: 15,
        rounds: Vec::new(),
        friend_revealed: None,
    };
    assert_eq!(r.first_bidder(1, Some(&summary(Some(3)))), 3);
    assert_eq!(r.first_bidder(1, Some(&summary(None))), 1);
    // The school presets still rotate.
    assert_eq!(Preset::Gshs.rules().first_bidder(7, Some(&summary(Some(3)))), 2);
}

#[test]
fn every_hand_ends_zero_sum_with_twenty_points() {
    use rand::SeedableRng;
    use rand::seq::IndexedRandom;
    for seed in 0..200 {
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(seed);
        let mut state = Mighty::new_game(&Options {
            rules: basic(),
            first_bidder: (seed % 5) as usize,
        })
        .unwrap();
        while Mighty::turn(&state) != Turn::Over {
            let action = match Mighty::turn(&state) {
                Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                _ => legal(&state).choose(&mut rng).unwrap().clone(),
            };
            act(&mut state, action);
            Mighty::check_invariants(&state).unwrap();
        }
        assert_eq!(Mighty::payoffs(&state).unwrap().iter().sum::<i64>(), 0);
    }
}
