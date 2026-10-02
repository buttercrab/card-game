//! Rule scenarios driven through the public `Game` interface.

use engine::{Game, Turn, Viewer};
use mighty::card::{Card, Color, Suit};
use mighty::rules::{Contract, Preset, Rules};
use mighty::{Action, FriendCall, Lead, Mighty, Options, PhaseView, State};

/// Parses cards such as `"SA D10 HK C3 BJ"`.
fn cards(s: &str) -> Vec<Card> {
    s.split_whitespace()
        .map(|t| match t {
            "BJ" => Card::Joker(Color::Black),
            "RJ" => Card::Joker(Color::Red),
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

/// Deals the given hands to the first seats and the given kitty; the rest
/// of the deck fills the remaining seats, then the kitty, in order.
fn start(rules: Rules, fixed: &[&str], kitty: &str) -> State {
    let mut state = Mighty::new_game(&Options {
        rules: rules.clone(),
        first_bidder: 0,
    })
    .unwrap();
    let mut hands: Vec<Vec<Card>> = fixed.iter().map(|h| cards(h)).collect();
    let mut kitty = cards(kitty);
    let used: Vec<Card> = hands.iter().flatten().chain(&kitty).copied().collect();
    let mut rest = rules.deck.cards().into_iter().filter(|c| !used.contains(c));
    while hands.len() < rules.players {
        hands.push(rest.by_ref().take(rules.hand_size).collect());
    }
    kitty.extend(rest);
    Mighty::apply(&mut state, Action::Deal { hands, kitty }).unwrap();
    state
}

fn act(state: &mut State, action: Action) {
    Mighty::apply(state, action).unwrap();
}

/// Seat 0 wins the bid with hearts, discards three clubs and calls `call`.
fn to_play(state: &mut State, call: FriendCall) {
    act(
        state,
        Action::Bid(Contract {
            trump: Some(Suit::Heart),
            count: 13,
        }),
    );
    for _ in 1..5 {
        act(state, Action::Pass);
    }
    for card in cards("C5 C6 C7") {
        act(state, Action::Discard(card));
    }
    act(state, Action::CallFriend(call));
}

fn lead(state: &mut State, card: &str) {
    let card = cards(card)[0];
    act(
        state,
        Action::Play {
            card,
            joker_lead: None,
            call_joker: false,
        },
    );
}

fn legal_cards(state: &State) -> Vec<Card> {
    let mut out: Vec<Card> = Mighty::legal_actions(state)
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

fn sorted(s: &str) -> Vec<Card> {
    let mut v = cards(s);
    v.sort();
    v
}

const DECLARER: &str = "D2 D3 D4 D5 D6 D7 D8 D9 C3 C4";
const KITTY: &str = "C5 C6 C7";

#[test]
fn everyone_passing_redeals() {
    let mut state = start(Rules::default(), &[], "");
    for _ in 0..5 {
        act(&mut state, Action::Pass);
    }
    assert_eq!(Mighty::turn(&state), Turn::Chance);
}

#[test]
fn some_presets_forbid_passing_first() {
    let state = start(Preset::Dshs.rules(), &[], "");
    assert!(!Mighty::legal_actions(&state).contains(&Action::Pass));
}

#[test]
fn bids_must_rise_and_no_trump_wins_ties() {
    let mut state = start(Rules::default(), &[], "");
    act(
        &mut state,
        Action::Bid(Contract {
            trump: Some(Suit::Spade),
            count: 14,
        }),
    );
    let legal = Mighty::legal_actions(&state);
    assert!(!legal.contains(&Action::Bid(Contract {
        trump: Some(Suit::Heart),
        count: 14
    })));
    assert!(legal.contains(&Action::Bid(Contract { trump: None, count: 14 })));
    assert!(legal.contains(&Action::Bid(Contract {
        trump: Some(Suit::Heart),
        count: 15
    })));
}

#[test]
fn declarer_takes_the_kitty_then_discards() {
    let mut state = start(Rules::default(), &[DECLARER], KITTY);
    act(
        &mut state,
        Action::Bid(Contract {
            trump: Some(Suit::Heart),
            count: 13,
        }),
    );
    for _ in 1..5 {
        act(&mut state, Action::Pass);
    }
    assert_eq!(Mighty::view(&state, Viewer::Seat(0)).hand.len(), 13);
    assert_eq!(Mighty::view(&state, Viewer::Seat(1)).hand_sizes[0], 13);
}

#[test]
fn must_follow_suit_but_mighty_and_joker_are_free() {
    let hand = "D10 SA BJ H2 H3 S2 S3 S4 S5 S6";
    let mut state = start(Rules::default(), &[DECLARER, hand], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    lead(&mut state, "D2");
    assert_eq!(legal_cards(&state), sorted("D10 SA BJ"));
}

#[test]
fn trump_is_held_back_on_the_first_trick() {
    let hand = "SA BJ H2 H3 S2 S3 S4 S5 S6 S7";
    let mut state = start(Rules::default(), &[DECLARER, hand], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    lead(&mut state, "D2");
    assert_eq!(legal_cards(&state), sorted("SA BJ S2 S3 S4 S5 S6 S7"));
}

#[test]
fn trump_led_on_the_first_trick_must_still_be_followed() {
    // A joker may name the trump suit on the first trick; holding trump
    // then means following with it, even though trump is otherwise held back.
    let declarer = "BJ D3 D4 D5 D6 D7 D8 D9 C3 C4";
    let hand = "SA H2 H3 D2 S2 S3 S4 S5 S6 S7";
    let mut state = start(Rules::default(), &[declarer, hand], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    act(
        &mut state,
        Action::Play {
            card: Card::Joker(Color::Black),
            joker_lead: Some(Lead::Suit(Suit::Heart)),
            call_joker: false,
        },
    );
    assert_eq!(legal_cards(&state), sorted("SA H2 H3"));
}

#[test]
fn only_trump_and_a_joker_left_forces_trump() {
    // Void in the led suit on the first trick: trump is held back, but a
    // joker alone is no real choice, so trump becomes playable.
    let hand = "BJ H2 H3 H4 H5 H6 H7 H8 H9 H10";
    let mut state = start(Rules::default(), &[DECLARER, hand], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    lead(&mut state, "D2");
    assert_eq!(legal_cards(&state), sorted(hand));
}

#[test]
fn a_joker_may_lead_its_colour_where_allowed() {
    let mut rules = Rules::default();
    rules.joker_lead.by_color = true;
    let declarer = "BJ D3 D4 D5 D6 D7 D8 D9 C3 C4";
    let hand = "SA H2 D2 S2 S3 S4 S5 S6 S7 S8";
    let mut state = start(rules, &[declarer, hand], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    let by_colour = Action::Play {
        card: Card::Joker(Color::Black),
        joker_lead: Some(Lead::Color(Color::Red)),
        call_joker: false,
    };
    assert!(Mighty::legal_actions(&state).contains(&by_colour));
    act(&mut state, by_colour);
    // Either red suit follows; trump (hearts) too, since it follows.
    assert_eq!(legal_cards(&state), sorted("SA H2 D2"));
}

#[test]
fn joker_call_forces_the_joker_out() {
    let hand = "BJ C8 C9 S2 S3 S4 S5 S6 S7 S8";
    let mut state = start(Rules::default(), &[DECLARER, hand], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    let call = Action::Play {
        card: cards("C3")[0],
        joker_lead: None,
        call_joker: true,
    };
    assert!(Mighty::legal_actions(&state).contains(&call));
    act(&mut state, call);
    assert_eq!(legal_cards(&state), sorted("BJ"));
}

#[test]
fn mighty_may_defend_a_called_joker() {
    let hand = "BJ SA C8 S2 S3 S4 S5 S6 S7 S8";
    let mut state = start(Rules::default(), &[DECLARER, hand], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    act(
        &mut state,
        Action::Play {
            card: cards("C3")[0],
            joker_lead: None,
            call_joker: true,
        },
    );
    assert_eq!(legal_cards(&state), sorted("BJ SA"));

    let mut kmla = start(Preset::Kmla.rules(), &[DECLARER, hand], KITTY);
    to_play(&mut kmla, FriendCall::FirstTrick);
    act(
        &mut kmla,
        Action::Play {
            card: cards("C3")[0],
            joker_lead: None,
            call_joker: true,
        },
    );
    assert_eq!(legal_cards(&kmla), sorted("BJ"));
}

#[test]
fn card_friend_is_revealed_when_the_card_is_played() {
    let friend = "CA S2 S3 S4 S5 S6 S7 S8 S9 S10";
    let mut state = start(
        Rules::default(),
        &[DECLARER, "D10 H2 H3 H4 H5 H6 H7 H8 H9 H10", friend],
        KITTY,
    );
    to_play(&mut state, FriendCall::Card(cards("CA")[0]));
    let friend_of = |state: &State| match Mighty::view(state, Viewer::Spectator).phase {
        PhaseView::Play { friend, .. } => friend,
        other => panic!("not playing: {other:?}"),
    };
    lead(&mut state, "D2");
    lead(&mut state, "D10");
    assert_eq!(friend_of(&state), None);
    lead(&mut state, "CA");
    assert_eq!(friend_of(&state), Some(2));
}

#[test]
fn illegal_actions_change_nothing() {
    let mut state = start(Rules::default(), &[DECLARER], KITTY);
    let before = state.clone();
    let too_low = Action::Bid(Contract {
        trump: Some(Suit::Spade),
        count: 12,
    });
    assert!(Mighty::apply(&mut state, too_low).is_err());
    assert!(Mighty::apply(&mut state, Action::Discard(cards("D2")[0])).is_err());
    assert_eq!(state, before);
}

#[test]
fn others_never_see_the_discards() {
    let mut state = start(Rules::default(), &[DECLARER], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    let discards = |viewer| match Mighty::view(&state, viewer).phase {
        PhaseView::Play { discards, .. } => discards,
        other => panic!("not playing: {other:?}"),
    };
    assert_eq!(discards(Viewer::Seat(0)), Some(cards("C5 C6 C7")));
    assert_eq!(discards(Viewer::Seat(1)), None);
    assert_eq!(discards(Viewer::Spectator), None);
}
