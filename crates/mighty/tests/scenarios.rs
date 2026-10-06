//! Rule scenarios driven through the public `Game` interface.

use engine::{Game, Turn, Viewer};
use mighty::card::{Card, Color, Suit};
use mighty::rules::{Contract, MisdealWindow, Preset, Rules};
use mighty::testing::{cards, dealt};
use mighty::{Action, Bid, FriendCall, Lead, Mighty, Options, PhaseView, Redeal, State};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;

/// Redeals here come from a fixed seed, so a failure replays exactly; the
/// assertions that follow one name it.
const SEED: u64 = 0x5eed;

fn rng() -> ChaCha8Rng {
    ChaCha8Rng::seed_from_u64(SEED)
}

/// Deals the given hands to the first seats and the given kitty; the rest
/// of the deck fills the remaining seats, then the kitty, in order.
fn start(rules: Rules, fixed: &[&str], kitty: &str) -> State {
    dealt(rules, 0, fixed, kitty)
}

fn act(state: &mut State, action: Action) {
    engine::apply_on_turn::<Mighty>(state, action).unwrap();
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
    let mut out: Vec<Card> = engine::legal_on_turn::<Mighty>(state)
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
    let mut state = start(Rules::web_mighty(), &[], "");
    for _ in 0..5 {
        act(&mut state, Action::Pass);
    }
    assert_eq!(Mighty::turn(&state), Turn::Chance);
}

#[test]
fn everyone_hears_every_bid_until_the_redeal() {
    let spade = |count| {
        Some(Contract {
            trump: Some(Suit::Spade),
            count,
        })
    };
    let heard = [
        (0, None),
        (1, spade(13)),
        (2, spade(14)),
        (3, None),
        (4, None),
        (1, None),
    ]
    .map(|(seat, contract)| Bid { seat, contract });
    let mut state = start(Rules::web_mighty(), &[DECLARER], KITTY);
    for bid in &heard {
        act(&mut state, bid.contract.map_or(Action::Pass, Action::Bid));
    }
    // Seat 2 declares; everyone still knows how the bidding went.
    let view = Mighty::view(&state, Viewer::Seat(3));
    assert!(matches!(view.phase, PhaseView::Exchange { declarer: 2, .. }));
    assert_eq!(view.bids, heard);
    assert_eq!(Mighty::view(&state, Viewer::Spectator).bids, heard);

    // A thrown-in deal starts a fresh record.
    let mut state = start(Rules::web_mighty(), &[], "");
    act(&mut state, Action::Pass);
    assert_eq!(Mighty::view(&state, Viewer::Spectator).bids.len(), 1);
    for _ in 1..5 {
        act(&mut state, Action::Pass);
    }
    assert!(Mighty::view(&state, Viewer::Spectator).bids.is_empty());
}

#[test]
fn everyone_sees_why_the_cards_were_dealt_again() {
    let weak = "S2 S3 S4 S5 D2 D3 D4 H2 H3 C2";
    let mut state = start(Rules::web_mighty(), &[weak], "");
    act(&mut state, Action::Misdeal);
    // The server deals again; the new deal's view says who threw in which hand.
    let deal = Mighty::sample_chance(&state, &mut rng());
    act(&mut state, deal);
    let seen = Mighty::view(&state, Viewer::Seat(3))
        .redealt
        .expect("a redeal is shown");
    assert_eq!(
        seen.why,
        Redeal::Misdeal {
            seat: 0,
            hand: cards(weak)
        },
        "seed {SEED}"
    );
    assert_eq!(seen.count, 1, "seed {SEED}");

    for _ in 0..5 {
        act(&mut state, Action::Pass);
    }
    let deal = Mighty::sample_chance(&state, &mut rng());
    act(&mut state, deal);
    let seen = Mighty::view(&state, Viewer::Spectator).redealt.unwrap();
    assert_eq!((seen.why, seen.count), (Redeal::AllPassed, 2), "seed {SEED}");
}

#[test]
fn some_presets_forbid_passing_first() {
    let state = start(Preset::Dshs.rules(), &[], "");
    assert!(!engine::legal_on_turn::<Mighty>(&state).contains(&Action::Pass));
}

#[test]
fn bids_must_rise_and_no_trump_wins_ties() {
    let mut state = start(Rules::web_mighty(), &[], "");
    act(
        &mut state,
        Action::Bid(Contract {
            trump: Some(Suit::Spade),
            count: 14,
        }),
    );
    let legal = engine::legal_on_turn::<Mighty>(&state);
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
fn gshs_no_trump_counts_one_more_and_ties_never_win() {
    let nt = |count| Action::Bid(Contract { trump: None, count });
    let spade = |count| {
        Action::Bid(Contract {
            trump: Some(Suit::Spade),
            count,
        })
    };
    let state = start(Preset::Gshs.rules(), &[], "");
    // 노기루다 13 is worth 14, the minimum.
    let legal = engine::legal_on_turn::<Mighty>(&state);
    assert!(legal.contains(&nt(13)) && !legal.contains(&nt(12)));

    // 노기루다 14 is worth 15: a suit must say 16 to overrule it.
    let mut state = start(Preset::Gshs.rules(), &[], "");
    act(&mut state, nt(14));
    let legal = engine::legal_on_turn::<Mighty>(&state);
    assert!(!legal.contains(&spade(15)) && legal.contains(&spade(16)));

    // And an equal 노기루다 does not overrule a suit.
    let mut state = start(Preset::Gshs.rules(), &[], "");
    act(&mut state, spade(15));
    let legal = engine::legal_on_turn::<Mighty>(&state);
    assert!(!legal.contains(&nt(14)) && legal.contains(&nt(15)));
}

#[test]
fn declarer_takes_the_kitty_then_discards() {
    let mut state = start(Rules::web_mighty(), &[DECLARER], KITTY);
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
    let mut state = start(Rules::web_mighty(), &[DECLARER, hand], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    lead(&mut state, "D2");
    assert_eq!(legal_cards(&state), sorted("D10 SA BJ"));
}

#[test]
fn the_mighty_still_counts_as_its_own_suit() {
    // Spades are led and the only spade in hand is the mighty (♠A): it must follow.
    let declarer = "S2 D3 D4 D5 D6 D7 D8 D9 C3 C4";
    let hand = "SA D2 H2 H3 H4 C8 C9 C10 CJ CQ";
    let mut state = start(Rules::web_mighty(), &[declarer, hand], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    lead(&mut state, "S2");
    assert_eq!(legal_cards(&state), sorted("SA"));
}

#[test]
fn trump_may_follow_on_the_first_trick() {
    // Only leading trump is held back on the first trick: a seat void in
    // the led suit may trump it.
    let hand = "SA BJ H2 H3 S2 S3 S4 S5 S6 S7";
    let mut state = start(Rules::web_mighty(), &[DECLARER, hand], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    lead(&mut state, "D2");
    assert_eq!(legal_cards(&state), sorted(hand));
}

#[test]
fn trump_may_not_lead_the_first_trick() {
    let declarer = "SA BJ H2 H3 H4 D2 D3 D4 C6 C7";
    let mut state = start(Preset::Gshs.rules(), &[declarer], "C2 C3 C4 C5");
    act(
        &mut state,
        Action::Bid(Contract {
            trump: Some(Suit::Heart),
            count: 14,
        }),
    );
    for _ in 1..5 {
        act(&mut state, Action::Pass);
    }
    for card in cards("C2 C3 C4 C5") {
        act(&mut state, Action::Discard(card));
    }
    act(&mut state, Action::CallFriend(FriendCall::FirstTrick));
    assert_eq!(legal_cards(&state), sorted("SA BJ D2 D3 D4 C6 C7"));
}

#[test]
fn trump_led_on_the_first_trick_must_still_be_followed() {
    // A joker may name the trump suit on the first trick; holding trump
    // then means following with it, even though trump is otherwise held back.
    let declarer = "BJ D3 D4 D5 D6 D7 D8 D9 C3 C4";
    let hand = "SA H2 H3 D2 S2 S3 S4 S5 S6 S7";
    let mut state = start(Rules::web_mighty(), &[declarer, hand], KITTY);
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
    let mut state = start(Rules::web_mighty(), &[DECLARER, hand], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    lead(&mut state, "D2");
    assert_eq!(legal_cards(&state), sorted(hand));
}

#[test]
fn trump_may_lead_the_first_trick_when_only_specials_are_left() {
    // Leading the first trick with nothing but trump, the mighty and jokers:
    // the specials are no real choice, so trump may be led too.
    let declarer = "SA BJ RJ H2 H3 H4 H5 H6 H7 H8";
    let mut rules = Preset::Gshs.rules();
    rules.policy.trump.first = mighty::rules::CardPolicy::Invalid;
    let mut state = start(rules, &[declarer], "C2 C3 C4 C5");
    act(
        &mut state,
        Action::Bid(Contract {
            trump: Some(Suit::Heart),
            count: 14,
        }),
    );
    for _ in 1..5 {
        act(&mut state, Action::Pass);
    }
    for card in cards("C2 C3 C4 C5") {
        act(&mut state, Action::Discard(card));
    }
    act(&mut state, Action::CallFriend(FriendCall::FirstTrick));
    assert_eq!(legal_cards(&state), sorted(declarer));
}

/// 경기과고, seat 0 declaring `trump` 14 with `declarer` and calling the
/// first trick's winner, ready to lead the first trick.
fn gshs_first_lead(declarer: &str, trump: Suit) -> State {
    let mut state = start(Preset::Gshs.rules(), &[declarer], "C2 C3 C4 C5");
    act(
        &mut state,
        Action::Bid(Contract {
            trump: Some(trump),
            count: 14,
        }),
    );
    for _ in 1..5 {
        act(&mut state, Action::Pass);
    }
    for card in cards("C2 C3 C4 C5") {
        act(&mut state, Action::Discard(card));
    }
    act(&mut state, Action::CallFriend(FriendCall::FirstTrick));
    state
}

#[test]
fn gshs_nine_trumps_and_the_mighty_may_lead_trump_on_the_first_trick() {
    // Owner, 2026-10-05: keep as coded.
    let declarer = "SA H2 H3 H4 H5 H6 H7 H8 H9 H10";
    let state = gshs_first_lead(declarer, Suit::Heart);
    assert_eq!(legal_cards(&state), sorted(declarer));
}

#[test]
fn gshs_a_joker_led_on_the_first_trick_may_name_trump() {
    // Owner, 2026-10-05: keep as coded.
    let state = gshs_first_lead("BJ S2 S3 S4 D2 D3 D4 D5 C6 C7", Suit::Spade);
    let names_trump = Action::Play {
        card: Card::Joker(Color::Black),
        joker_lead: Some(Lead::Suit(Suit::Spade)),
        call_joker: false,
    };
    assert!(engine::legal_on_turn::<Mighty>(&state).contains(&names_trump));
}

#[test]
fn trump_may_follow_the_first_trick_when_only_specials_are_left() {
    let hand = "SA BJ H2 H3 H4 H5 H6 H7 H8 H9";
    let mut state = start(Rules::web_mighty(), &[DECLARER, hand], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    lead(&mut state, "D2");
    assert_eq!(legal_cards(&state), sorted(hand));
}

#[test]
fn a_joker_may_lead_its_colour_where_allowed() {
    let mut rules = Rules::web_mighty();
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
    assert!(engine::legal_on_turn::<Mighty>(&state).contains(&by_colour));
    act(&mut state, by_colour);
    // Either red suit follows; trump (hearts) too, since it follows.
    assert_eq!(legal_cards(&state), sorted("SA H2 D2"));
}

#[test]
fn joker_call_forces_the_joker_out() {
    let hand = "BJ C8 C9 S2 S3 S4 S5 S6 S7 S8";
    let mut state = start(Rules::web_mighty(), &[DECLARER, hand], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    let call = Action::Play {
        card: cards("C3")[0],
        joker_lead: None,
        call_joker: true,
    };
    assert!(engine::legal_on_turn::<Mighty>(&state).contains(&call));
    act(&mut state, call);
    assert_eq!(legal_cards(&state), sorted("BJ"));
}

#[test]
fn mighty_may_defend_a_called_joker() {
    let hand = "BJ SA C8 S2 S3 S4 S5 S6 S7 S8";
    let mut state = start(Rules::web_mighty(), &[DECLARER, hand], KITTY);
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
        Rules::web_mighty(),
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
fn the_view_says_who_is_winning_the_trick_so_far() {
    let mut state = start(
        Rules::web_mighty(),
        &[
            DECLARER,
            "D10 H2 H3 H4 H5 H6 H7 H8 H9 H10",
            "DJ S2 S3 S4 S5 S6 S7 S8 S9 S10",
        ],
        KITTY,
    );
    to_play(&mut state, FriendCall::FirstTrick);
    let leading = |state: &State| match Mighty::view(state, Viewer::Seat(3)).phase {
        PhaseView::Play { leading, .. } => leading,
        other => panic!("not playing: {other:?}"),
    };
    assert_eq!(leading(&state), None);
    lead(&mut state, "D2");
    assert_eq!(leading(&state), Some(0));
    lead(&mut state, "D10");
    assert_eq!(leading(&state), Some(1));
    lead(&mut state, "DJ");
    assert_eq!(leading(&state), Some(2));
    // The trick closes; the next one has no cards and so no one ahead.
    for _ in 0..2 {
        let card = legal_cards(&state)[0];
        act(
            &mut state,
            Action::Play {
                card,
                joker_lead: None,
                call_joker: false,
            },
        );
    }
    assert_eq!(leading(&state), None);
}

#[test]
fn illegal_actions_change_nothing() {
    let mut state = start(Rules::web_mighty(), &[DECLARER], KITTY);
    let before = state.clone();
    let too_low = Action::Bid(Contract {
        trump: Some(Suit::Spade),
        count: 12,
    });
    assert!(engine::apply_on_turn::<Mighty>(&mut state, too_low).is_err());
    assert!(engine::apply_on_turn::<Mighty>(&mut state, Action::Discard(cards("D2")[0])).is_err());
    assert_eq!(state, before);
}

#[test]
fn others_never_see_the_discards() {
    let mut state = start(Rules::web_mighty(), &[DECLARER], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    let discards = |viewer| match Mighty::view(&state, viewer).phase {
        PhaseView::Play { discards, .. } => discards,
        other => panic!("not playing: {other:?}"),
    };
    assert_eq!(discards(Viewer::Seat(0)), Some(cards("C5 C6 C7")));
    assert_eq!(discards(Viewer::Seat(1)), None);
    assert_eq!(discards(Viewer::Spectator), None);
}

#[test]
fn a_finished_hand_sums_up_every_trick() {
    use rand::seq::IndexedRandom;
    for seed in 0..40 {
        let mut rng = ChaCha8Rng::seed_from_u64(seed);
        let mut state = Mighty::new_game(&Options {
            rules: Rules::web_mighty(),
            first_bidder: 0,
        })
        .unwrap();
        loop {
            match Mighty::turn(&state) {
                Turn::Over => break,
                _ if state.summary().is_some() => panic!("seed {seed}: summed up before the end"),
                Turn::Chance => {
                    let deal = Mighty::sample_chance(&state, &mut rng);
                    act(&mut state, deal);
                }
                Turn::Seat(_) => {
                    let action = engine::legal_on_turn::<Mighty>(&state)
                        .choose(&mut rng)
                        .unwrap()
                        .clone();
                    act(&mut state, action);
                }
            }
        }
        let s = state.summary().expect("the hand is over");
        assert_eq!(s.rounds.len(), 10, "seed {seed}");
        let won: i32 = s.rounds.iter().filter(|&&r| r > 0).map(|&r| i32::from(r)).sum();
        let in_tricks: i32 = s.rounds.iter().map(|&r| i32::from(r.abs())).sum();
        // Whatever the tricks did not take was discarded, and counts for the declarer.
        let discarded = i32::from(s.team_points) - won;
        assert!((0..=3).contains(&discarded), "seed {seed}: {s:?}");
        assert_eq!(in_tricks + discarded, 20, "seed {seed}: {s:?}");
        assert_eq!(s.made, s.team_points >= s.contract.count, "seed {seed}");
        assert_eq!(s.friend.is_some(), s.friend_revealed.is_some(), "seed {seed}: {s:?}");
        assert!(s.friend_revealed.is_none_or(|r| r < 10), "seed {seed}");
    }
}

#[test]
fn a_bid_nobody_can_top_ends_the_bidding() {
    // 풀노 (no-trump 20) can never be outbid: the bidding ends at once, so
    // nobody after it can throw the deal in (나무위키, 선거과정).
    let weak = "S2 S3 S4 S5 S6 S7 S8 H2 H3 C2";
    let mut state = start(Rules::web_mighty(), &[DECLARER, weak], KITTY);
    act(&mut state, Action::Bid(Contract { trump: None, count: 20 }));
    let view = Mighty::view(&state, Viewer::Seat(1));
    assert!(
        matches!(view.phase, PhaseView::Exchange { declarer: 0, .. }),
        "{:?}",
        view.phase
    );
    assert_eq!(view.bids.len(), 1);

    // A suit 20 can still be topped by 풀노, so the bidding goes on.
    let mut state = start(Rules::web_mighty(), &[DECLARER, weak], KITTY);
    act(
        &mut state,
        Action::Bid(Contract {
            trump: Some(Suit::Spade),
            count: 20,
        }),
    );
    assert!(engine::legal_on_turn::<Mighty>(&state).contains(&Action::Misdeal));
}

fn bid(trump: Option<Suit>, count: u8) -> Action {
    Action::Bid(Contract { trump, count })
}

const WEAK: &str = "S2 S3 S4 S5 S6 S7 S8 H2 H3 C2";
const SECOND: &str = "H4 H5 H6 H7 H8 H9 C8 C9 S9 D10";

#[test]
fn gshs_throws_in_a_hand_worth_one_point_card_or_less() {
    // The hand the owner held on 2026-10-05: a lone ♣10.
    let lone_ten = "S4 S7 D5 D8 D9 H4 H5 C4 C6 C10";
    let lone_jack = "S4 S7 D5 D8 D9 H4 H5 C4 C6 CJ";
    let two = "S4 S7 D5 D8 D9 H4 H5 C4 DJ C10";
    for (hand, misdeal) in [(lone_ten, true), (lone_jack, true), (two, false)] {
        let state = start(Preset::Gshs.rules(), &[hand], "");
        assert_eq!(
            engine::legal_on_turn::<Mighty>(&state).contains(&Action::Misdeal),
            misdeal,
            "{hand}"
        );
    }
}

#[test]
fn a_hand_of_only_point_cards_may_be_thrown_in_where_allowed() {
    let rich = "S10 SJ SQ SK D10 DJ DQ DK DA HA";
    let mut rules = Rules::web_mighty();
    rules.misdeal.all_points = true;
    let state = start(rules, &[rich], "");
    assert!(engine::legal_on_turn::<Mighty>(&state).contains(&Action::Misdeal));
    let state = start(Rules::web_mighty(), &[rich], "");
    assert!(!engine::legal_on_turn::<Mighty>(&state).contains(&Action::Misdeal));
}

#[test]
fn passing_need_not_be_final() {
    // 나무위키's own example (딜 미스, footnote): 을 and 병 pass, then bid
    // again, and 병 throws the deal in after having bid.
    let mut rules = Rules::web_mighty();
    rules.bidding.pass_is_final = false;
    rules.misdeal.window = MisdealWindow::AllBidding;
    let (c, d, h, s) = (
        Some(Suit::Club),
        Some(Suit::Diamond),
        Some(Suit::Heart),
        Some(Suit::Spade),
    );
    let mut state = start(rules.clone(), &[DECLARER, SECOND, WEAK], KITTY);
    for action in [
        bid(c, 13),
        Action::Pass,
        Action::Pass,
        Action::Pass,
        bid(d, 14),
        Action::Pass,
        Action::Pass,
        bid(h, 15),
        bid(s, 16),
        Action::Pass,
        Action::Pass,
        Action::Pass,
    ] {
        act(&mut state, action);
    }
    assert_eq!(Mighty::turn(&state), Turn::Seat(2));
    assert!(engine::legal_on_turn::<Mighty>(&state).contains(&Action::Misdeal));

    // When everyone else passes in a row, the last bidder declares.
    let mut state = start(rules.clone(), &[DECLARER, SECOND, WEAK], KITTY);
    for action in [bid(c, 13), Action::Pass, bid(d, 14), Action::Pass, Action::Pass] {
        act(&mut state, action);
    }
    assert_eq!(Mighty::turn(&state), Turn::Seat(0));
    act(&mut state, Action::Pass);
    // Seat 1 passed before seat 2's bid, and may answer it.
    assert_eq!(Mighty::turn(&state), Turn::Seat(1));
    assert!(engine::legal_on_turn::<Mighty>(&state).contains(&bid(h, 15)));
    act(&mut state, Action::Pass);
    assert!(matches!(
        Mighty::view(&state, Viewer::Spectator).phase,
        PhaseView::Exchange { declarer: 2, .. }
    ));

    // By default a pass is final and a bidder can no longer call a misdeal.
    let mut state = start(Rules::web_mighty(), &[DECLARER, SECOND, WEAK], KITTY);
    for action in [
        bid(c, 13),
        Action::Pass,
        bid(d, 14),
        Action::Pass,
        Action::Pass,
        Action::Pass,
    ] {
        act(&mut state, action);
    }
    assert!(matches!(
        Mighty::view(&state, Viewer::Spectator).phase,
        PhaseView::Exchange { declarer: 2, .. }
    ));
    let mut state = start(Rules::web_mighty(), &[WEAK], KITTY);
    for action in [bid(c, 13), bid(d, 14), Action::Pass, Action::Pass, Action::Pass] {
        act(&mut state, action);
    }
    assert_eq!(Mighty::turn(&state), Turn::Seat(0));
    assert!(!engine::legal_on_turn::<Mighty>(&state).contains(&Action::Misdeal));
}

#[test]
fn a_weak_hand_may_misdeal_out_of_turn_until_it_bids() {
    // 경기과고 has no misdeal round: seat 1 may throw the deal in from the
    // moment the cards land, while seat 0 is still to bid, and until it
    // has bid itself.
    let lone_ten = "S4 S5 S6 S7 S8 H4 H5 H6 C8 C10";
    let state = start(Preset::Gshs.rules(), &[DECLARER, lone_ten], KITTY);
    assert_eq!(Mighty::turn(&state), Turn::Seat(0));
    assert_eq!(Mighty::legal_actions(&state, 1), vec![Action::Misdeal]);
    assert!(Mighty::legal_actions(&state, 0).contains(&Action::Pass), "seat 0 bids");
    assert!((2..5).all(|s| Mighty::legal_actions(&state, s).is_empty()));
    // Others bidding does not close it; seat 1's own bid does.
    let mut open = state.clone();
    act(&mut open, bid(Some(Suit::Spade), 14));
    assert_eq!(Mighty::turn(&open), Turn::Seat(1), "seat 1 is to act now");
    assert!(Mighty::legal_actions(&open, 1).contains(&Action::Misdeal));
    act(&mut open, bid(Some(Suit::Heart), 15));
    act(&mut open, Action::Pass);
    assert!(Mighty::legal_actions(&open, 1).is_empty(), "seat 1 has bid");
    // Called out of turn, it is shown and redealt as on a turn.
    let mut thrown = state.clone();
    Mighty::apply(&mut thrown, 1, Action::Misdeal).unwrap();
    assert_eq!(Mighty::turn(&thrown), Turn::Chance);
    let deal = Mighty::sample_chance(&thrown, &mut rng());
    act(&mut thrown, deal);
    let redealt = Mighty::view(&thrown, Viewer::Seat(3)).redealt.unwrap();
    assert!(matches!(redealt.why, Redeal::Misdeal { seat: 1, .. }), "seed {SEED}");
    // Only a qualifying seat, and only a misdeal.
    let mut refused = state.clone();
    assert!(Mighty::apply(&mut refused, 2, Action::Misdeal).is_err());
    assert!(Mighty::apply(&mut refused, 1, Action::Pass).is_err());
    assert_eq!(refused, state);
}

#[test]
fn after_bidding_keeps_the_window_open_all_through_the_bidding() {
    let mut rules = Preset::Gshs.rules();
    rules.misdeal.window = MisdealWindow::AllBidding;
    let lone_ten = "S4 S5 S6 S7 S8 H4 H5 H6 C8 C10";
    let mut state = start(rules, &[DECLARER, lone_ten], KITTY);
    act(&mut state, bid(Some(Suit::Spade), 14));
    act(&mut state, bid(Some(Suit::Heart), 15));
    assert_eq!(Mighty::legal_actions(&state, 1), vec![Action::Misdeal]);
    // Passing ends it: a seat that passed has had its say.
    act(&mut state, Action::Pass);
    act(&mut state, Action::Pass);
    act(&mut state, Action::Pass);
    assert_eq!(Mighty::turn(&state), Turn::Seat(0));
    act(&mut state, bid(Some(Suit::Spade), 16));
    assert_eq!(Mighty::turn(&state), Turn::Seat(1));
    act(&mut state, Action::Pass);
    assert!(matches!(
        Mighty::view(&state, Viewer::Spectator).phase,
        PhaseView::Exchange { declarer: 0, .. }
    ));
    assert!(Mighty::legal_actions(&state, 1).is_empty(), "the bidding is over");
}

#[test]
fn random_out_of_turn_misdeals_keep_the_state_sound() {
    use rand::Rng;
    let mut rng = rand::rngs::StdRng::seed_from_u64(7);
    for preset in Preset::ALL {
        let rules = preset.rules();
        let mut state = Mighty::new_game(&Options { rules, first_bidder: 0 }).unwrap();
        for _ in 0..400 {
            match Mighty::turn(&state) {
                Turn::Over => break,
                Turn::Chance => {
                    let deal = Mighty::sample_chance(&state, &mut rng);
                    act(&mut state, deal);
                }
                Turn::Seat(to_act) => {
                    let callers: Vec<usize> = (0..5)
                        .filter(|&s| s != to_act && !Mighty::legal_actions(&state, s).is_empty())
                        .collect();
                    if !callers.is_empty() && rng.random_bool(0.3) {
                        let seat = callers[rng.random_range(0..callers.len())];
                        assert_eq!(Mighty::legal_actions(&state, seat), [Action::Misdeal]);
                        Mighty::apply(&mut state, seat, Action::Misdeal).unwrap();
                    } else {
                        let legal = engine::legal_on_turn::<Mighty>(&state);
                        let action = legal[rng.random_range(0..legal.len())].clone();
                        act(&mut state, action);
                    }
                }
            }
            Mighty::check_invariants(&state).unwrap_or_else(|e| panic!("{}: {e}", preset.name()));
        }
    }
}

#[test]
fn the_declarer_may_throw_in_a_hand_the_kitty_left_weak() {
    let mut rules = Rules::web_mighty();
    rules.misdeal.declarer = true;
    let mut state = start(rules, &[WEAK], "C3 C4 C5");
    act(&mut state, bid(Some(Suit::Spade), 13));
    for _ in 1..5 {
        act(&mut state, Action::Pass);
    }
    assert!(engine::legal_on_turn::<Mighty>(&state).contains(&Action::Misdeal));
    act(&mut state, Action::Misdeal);
    assert_eq!(Mighty::turn(&state), Turn::Chance);
    let deal = Mighty::sample_chance(&state, &mut rng());
    act(&mut state, deal);
    let why = Mighty::view(&state, Viewer::Seat(1)).redealt.unwrap().why;
    assert!(
        matches!(why, Redeal::Misdeal { seat: 0, ref hand } if hand.len() == 13),
        "seed {SEED}"
    );

    // Not once a card is discarded, and never without the rule.
    let mut rules = Rules::web_mighty();
    rules.misdeal.declarer = true;
    let mut state = start(rules, &[WEAK], "C3 C4 C5");
    act(&mut state, bid(Some(Suit::Spade), 13));
    for _ in 1..5 {
        act(&mut state, Action::Pass);
    }
    act(&mut state, Action::Discard(cards("C3")[0]));
    assert!(!engine::legal_on_turn::<Mighty>(&state).contains(&Action::Misdeal));
    let mut state = start(Rules::web_mighty(), &[WEAK], "C3 C4 C5");
    act(&mut state, bid(Some(Suit::Spade), 13));
    for _ in 1..5 {
        act(&mut state, Action::Pass);
    }
    assert!(!engine::legal_on_turn::<Mighty>(&state).contains(&Action::Misdeal));
}

#[test]
fn changing_to_no_trump_may_cost_less() {
    // 나무위키 (선거과정): 셋다리 may become 섯삽 or 넷노.
    let mut rules = Rules::web_mighty();
    rules.bidding.change_to_no_trump_cost = Some(1);
    let changes = |rules: Rules| {
        let mut state = start(rules, &[DECLARER], KITTY);
        act(&mut state, bid(Some(Suit::Diamond), 13));
        for _ in 1..5 {
            act(&mut state, Action::Pass);
        }
        let mut no_trump = state.clone();
        act(&mut no_trump, Action::ChangeTrump(None));
        act(&mut state, Action::ChangeTrump(Some(Suit::Spade)));
        let contract = |s: &State| match Mighty::view(s, Viewer::Spectator).phase {
            PhaseView::Exchange { contract, .. } => contract.count,
            other => panic!("not exchanging: {other:?}"),
        };
        (contract(&state), contract(&no_trump))
    };
    assert_eq!(changes(rules), (15, 14));
    assert_eq!(changes(Rules::web_mighty()), (15, 15));
}

#[test]
fn other_player_counts_deal_the_whole_deck() {
    use rand::seq::IndexedRandom;
    for players in [3, 4, 6, 7] {
        let rules = Rules::web_mighty().for_players(players).unwrap();
        for seed in 0..30 {
            let mut rng = ChaCha8Rng::seed_from_u64(seed);
            let mut state = Mighty::new_game(&Options {
                rules: rules.clone(),
                first_bidder: 0,
            })
            .unwrap();
            while Mighty::turn(&state) != Turn::Over {
                let action = match Mighty::turn(&state) {
                    Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                    _ => engine::legal_on_turn::<Mighty>(&state)
                        .choose(&mut rng)
                        .unwrap()
                        .clone(),
                };
                act(&mut state, action);
                Mighty::check_invariants(&state).unwrap_or_else(|e| panic!("{players} players, seed {seed}: {e}"));
            }
            let s = state.summary().unwrap();
            assert_eq!(s.rounds.len(), rules.hand_size, "{players} players, seed {seed}");
            assert_eq!(Mighty::payoffs(&state).unwrap().len(), players);
        }
    }
}

#[test]
fn every_preset_lets_the_declarer_name_a_card_it_holds_or_discarded() {
    for preset in Preset::ALL {
        assert!(preset.rules().friend.fake, "{preset}");
        let mut rng = ChaCha8Rng::seed_from_u64(1);
        let mut state = Mighty::new_game(&Options {
            rules: preset.rules(),
            first_bidder: 0,
        })
        .unwrap();
        // Answer no misdeals, bid the cheapest, then pass; discard the first cards.
        let legal = loop {
            let legal = engine::legal_on_turn::<Mighty>(&state);
            if legal.iter().any(|a| matches!(a, Action::CallFriend(_))) {
                break legal;
            }
            let action = match Mighty::turn(&state) {
                Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                _ => legal
                    .iter()
                    .find(|a| matches!(a, Action::Bid(_) | Action::Discard(_)))
                    .or_else(|| legal.iter().find(|a| **a == Action::Pass))
                    .unwrap_or(&legal[0])
                    .clone(),
            };
            act(&mut state, action);
        };
        let PhaseView::Exchange { declarer, .. } = Mighty::view(&state, Viewer::Spectator).phase else {
            unreachable!()
        };
        let own = Mighty::view(&state, Viewer::Seat(declarer));
        let PhaseView::Exchange {
            discards: Some(discards),
            ..
        } = own.phase
        else {
            unreachable!()
        };
        for card in own.hand.iter().chain(&discards) {
            assert!(
                legal.contains(&Action::CallFriend(FriendCall::Card(*card))),
                "{preset}: {card}"
            );
        }
    }
}

/// Whether `seat` is shown that the 주공 plays without a friend.
fn sees_no_friend(state: &State, seat: usize) -> bool {
    match Mighty::view(state, Viewer::Seat(seat)).phase {
        PhaseView::Play { no_friend, .. } => no_friend,
        other => panic!("not in play: {other:?}"),
    }
}

/// The seats after the leader play their first legal card.
fn others_follow(state: &mut State) {
    for _ in 1..5 {
        let action = engine::legal_on_turn::<Mighty>(state)[0].clone();
        act(state, action);
    }
}

#[test]
fn everyone_sees_no_friend_once_the_declarer_takes_the_first_trick_friend() {
    let declarer = "SA D2 D3 D4 D5 D6 D7 D8 D9 C3";
    let mut state = start(Rules::web_mighty(), &[declarer], KITTY);
    to_play(&mut state, FriendCall::FirstTrick);
    assert!((0..5).all(|s| !sees_no_friend(&state, s)));
    // The mighty takes the first trick: the friend would be its winner.
    lead(&mut state, "SA");
    others_follow(&mut state);
    assert!((0..5).all(|s| sees_no_friend(&state, s)));
}

#[test]
fn a_card_of_the_declarers_own_is_no_friend_to_them_at_once_and_to_all_once_played() {
    let declarer = "SK D2 D3 D4 D5 D6 D7 D8 D9 C3";
    let mut state = start(Rules::web_mighty(), &[declarer], KITTY);
    to_play(&mut state, FriendCall::Card(cards("SK")[0]));
    assert!(sees_no_friend(&state, 0));
    assert!((1..5).all(|s| !sees_no_friend(&state, s)));
    lead(&mut state, "SK");
    assert!((0..5).all(|s| sees_no_friend(&state, s)));
}

#[test]
fn a_friend_by_seat_or_by_the_last_trick_is_never_no_friend_in_play() {
    for call in [FriendCall::Seat(2), FriendCall::LastTrick] {
        let mut state = start(Rules::web_mighty(), &[DECLARER], KITTY);
        to_play(&mut state, call);
        assert!((0..5).all(|s| !sees_no_friend(&state, s)), "{call:?}");
    }
}
