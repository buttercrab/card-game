//! How the rule-based bot spends its jokers, checked on hand-built views.

use engine::{Bot, Viewer};
use mighty::bot::{Clumsy, SimpleBot};
use mighty::card::{Card, Color, Suit};
use mighty::rules::{Contract, Preset};
use mighty::trick::{Played, Trick};
use mighty::{Action, FriendCall, Lead, PhaseView, View};
use rand::SeedableRng;
use rand::rngs::StdRng;

const BJ: Card = Card::Joker(Color::Black);

fn play(card: Card) -> Action {
    Action::Play {
        card,
        joker_lead: None,
        call_joker: false,
    }
}

/// Seat 0 declares ♦ under 경기과고 rules, where jokers have no power on
/// the last trick, and holds `hand` on the second-to-last one. `others`
/// are still in the other hands; every other card went in earlier tricks
/// or the discards. `plays` are already on this trick.
fn view(hand: &[Card], others: &[Card], plays: &[Played]) -> View {
    let rules = Preset::Gshs.rules();
    let held: Vec<Card> = hand
        .iter()
        .chain(others)
        .chain(plays.iter().map(|p| &p.card))
        .copied()
        .collect();
    let gone: Vec<Card> = rules.cards().into_iter().filter(|c| !held.contains(c)).collect();
    let (discards, played) = gone.split_at(4);
    let tricks: Vec<Trick> = played
        .chunks(5)
        .map(|cards| Trick {
            plays: cards
                .iter()
                .enumerate()
                .map(|(seat, &card)| Played {
                    seat,
                    card,
                    powered: true,
                })
                .collect(),
            lead: Lead::Suit(Suit::Spade),
            winner: 0,
        })
        .collect();
    assert_eq!(tricks.len(), 8, "the second-to-last trick");
    let leader = plays.first().map_or(0, |p| p.seat);
    View {
        viewer: Viewer::Seat(0),
        first_bidder: 0,
        hand: hand.to_vec(),
        hand_sizes: (0..5)
            .map(|s| {
                if s == 0 {
                    hand.len()
                } else {
                    2 - usize::from(plays.iter().any(|p| p.seat == s))
                }
            })
            .collect(),
        points_taken: vec![Vec::new(); 5],
        phase: PhaseView::Play {
            declarer: 0,
            contract: Contract {
                trump: Some(Suit::Diamond),
                count: 17,
            },
            call: FriendCall::Card(Card::new(Suit::Spade, 14)),
            friend: Some(1),
            no_friend: false,
            trick_no: 8,
            leader,
            lead: plays.first().map(|p| match p.card.suit() {
                Some(suit) => Lead::Suit(suit),
                None => Lead::Suit(Suit::Spade),
            }),
            plays: plays.to_vec(),
            leading: None,
            called_joker: None,
            tricks,
            discards: Some(discards.to_vec()),
        },
        rules,
        bids: Vec::new(),
        redealt: None,
    }
}

fn choose(view: &View, legal: &[Action]) -> Card {
    let mut rng = StdRng::seed_from_u64(0);
    match SimpleBot::default().act(view, legal, &mut rng) {
        Action::Play { card, .. } => card,
        other => panic!("not a play: {other:?}"),
    }
}

/// Room uqzt45: holding a joker into the last trick, where it has no
/// power, threw it away. With a sure winner in hand as well, the joker
/// goes first and the sure winner takes the last trick.
#[test]
fn a_joker_is_led_before_the_last_trick_strips_it() {
    let sk = Card::new(Suit::Spade, 13);
    let others: Vec<Card> = [(Suit::Heart, 2), (Suit::Heart, 4), (Suit::Club, 2), (Suit::Club, 4)]
        .into_iter()
        .chain([(Suit::Heart, 5), (Suit::Heart, 6), (Suit::Club, 5), (Suit::Club, 6)])
        .map(|(s, r)| Card::new(s, r))
        .collect();
    let v = view(&[BJ, sk], &others, &[]);
    let mut legal: Vec<Action> = Suit::ALL
        .into_iter()
        .map(|s| Action::Play {
            card: BJ,
            joker_lead: Some(Lead::Suit(s)),
            call_joker: false,
        })
        .collect();
    legal.push(play(sk));
    assert_eq!(choose(&v, &legal), BJ);
}

/// When the trick is lost anyway, the joker that would be powerless next
/// trick is the card to give up, not a winner for the last trick.
#[test]
fn a_doomed_joker_is_the_cheapest_card_to_lose() {
    let sk = Card::new(Suit::Spade, 13);
    // An opponent leads trump; the black joker ranks below it under ♦.
    let lead = Played {
        seat: 4,
        card: Card::new(Suit::Diamond, 2),
        powered: true,
    };
    let others: Vec<Card> = [(Suit::Heart, 2), (Suit::Heart, 4), (Suit::Club, 2)]
        .into_iter()
        .chain([(Suit::Heart, 5), (Suit::Heart, 6), (Suit::Club, 5), (Suit::Club, 6)])
        .map(|(s, r)| Card::new(s, r))
        .collect();
    let v = view(&[BJ, sk], &others, &[lead]);
    assert_eq!(choose(&v, &[play(BJ), play(sk)]), BJ);
}

/// A seat bidding first under `preset` with `hand`, the misdeal allowed.
fn bidding(preset: Preset, hand: Vec<Card>) -> (View, Vec<Action>) {
    let rules = preset.rules();
    let mut legal = vec![Action::Misdeal, Action::Pass];
    legal.extend(
        (rules.bidding.min..=rules.bidding.max)
            .flat_map(|count| Suit::ALL.map(|s| Action::Bid(Contract { trump: Some(s), count }))),
    );
    let view = View {
        viewer: Viewer::Seat(0),
        first_bidder: 0,
        hand,
        hand_sizes: vec![10; 5],
        points_taken: vec![Vec::new(); 5],
        phase: PhaseView::Bidding {
            to_act: 0,
            best: None,
            passed: vec![false; 5],
            has_bid: vec![false; 5],
            asking_misdeal: false,
        },
        rules,
        bids: Vec::new(),
        redealt: None,
    };
    (view, legal)
}

fn decide(view: &View, legal: &[Action]) -> Action {
    SimpleBot::default().act(view, legal, &mut StdRng::seed_from_u64(0))
}

/// A hand with no point cards may be thrown in, but eight trumps and both
/// jokers are worth a contract: the bot bids instead. A weak one it still
/// throws in.
#[test]
fn only_hands_below_the_minimum_bid_are_thrown_in() {
    let mut strong: Vec<Card> = (2..10).map(|r| Card::new(Suit::Diamond, r)).collect();
    strong.extend([BJ, Card::Joker(Color::Red)]);
    let (v, legal) = bidding(Preset::Gshs, strong);
    assert!(matches!(decide(&v, &legal), Action::Bid(c) if c.trump == Some(Suit::Diamond)));
    let weak: Vec<Card> = [(Suit::Diamond, 2), (Suit::Diamond, 3), (Suit::Club, 2), (Suit::Club, 4)]
        .into_iter()
        .chain([(Suit::Heart, 2), (Suit::Heart, 3), (Suit::Heart, 4)])
        .chain([(Suit::Spade, 2), (Suit::Spade, 4), (Suit::Spade, 5)])
        .map(|(s, r)| Card::new(s, r))
        .collect();
    let (v, legal) = bidding(Preset::Gshs, weak);
    assert_eq!(decide(&v, &legal), Action::Misdeal);
}

/// Where a failed contract pays back what it would have won (the school
/// presets), a hand must clear a bid by a margin; where making pays more
/// than failing costs (기본), the estimate is enough.
#[test]
fn bids_need_a_margin_only_where_failing_costs_more() {
    let bot = SimpleBot::default();
    let contract = |count| Contract {
        trump: Some(Suit::Spade),
        count,
    };
    for count in 14..=18 {
        assert_eq!(bot.needed(&Preset::Default.rules(), contract(count)), f32::from(count));
        let needed = bot.needed(&Preset::Gshs.rules(), contract(count));
        assert!(
            needed > f32::from(count) && needed < f32::from(count) + 2.0,
            "{count}: {needed}"
        );
    }
}

/// Following with cards that come to the same is no real choice; with an
/// unseen card between them, it is.
#[test]
fn alike_follows_are_obvious() {
    let lead = Played {
        seat: 4,
        card: Card::new(Suit::Heart, 9),
        powered: true,
    };
    let others: Vec<Card> = [(Suit::Club, 2), (Suit::Club, 3), (Suit::Club, 4), (Suit::Club, 5)]
        .into_iter()
        .chain([(Suit::Club, 6), (Suit::Club, 7), (Suit::Heart, 4)])
        .map(|(s, r)| Card::new(s, r))
        .collect();
    let [h2, h3, h5] = [2, 3, 5].map(|r| Card::new(Suit::Heart, r));
    let v = view(&[h2, h3], &others, &[lead]);
    assert!(v.obvious(&[play(h2), play(h3)]));
    // ♥4 is still out, between ♥2 and ♥5.
    let v = view(&[h2, h5], &others, &[lead]);
    assert!(!v.obvious(&[play(h2), play(h5)]));
    // A lead is always a choice.
    let mut more = others.clone();
    more.push(Card::new(Suit::Club, 8));
    let v = view(&[h2, h3], &more, &[]);
    assert!(!v.obvious(&[play(h2), play(h3)]));
}

/// 초보 slips to cheap cards only: it never throws the joker away when the
/// simple bot would keep it.
#[test]
fn clumsy_slips_never_throw_a_joker() {
    let lead = Played {
        seat: 4,
        card: Card::new(Suit::Diamond, 2),
        powered: true,
    };
    let others: Vec<Card> = [(Suit::Heart, 2), (Suit::Heart, 4), (Suit::Club, 2)]
        .into_iter()
        .chain([(Suit::Heart, 5), (Suit::Heart, 6), (Suit::Club, 5), (Suit::Club, 6)])
        .map(|(s, r)| Card::new(s, r))
        .collect();
    let [d9, d10] = [9, 10].map(|r| Card::new(Suit::Diamond, r));
    let mut clumsy = Clumsy {
        inner: SimpleBot::default(),
        slips: 1.0,
    };
    let mut rng = StdRng::seed_from_u64(1);
    let v = view(&[d9, d10], &others, &[lead]);
    let legal = [play(d9), play(d10)];
    let picks: Vec<Action> = (0..50).map(|_| clumsy.act(&v, &legal, &mut rng)).collect();
    assert!(
        picks.contains(&legal[0]) && picks.contains(&legal[1]),
        "slips pick either"
    );
    // With a joker and one cheap card, a slip is the cheap card or the usual.
    let v = view(&[BJ, d9], &others, &[lead]);
    let legal = [play(BJ), play(d9)];
    let usual = decide(&v, &legal);
    let picks: Vec<Action> = (0..50).map(|_| clumsy.act(&v, &legal, &mut rng)).collect();
    assert!(picks.iter().all(|a| *a == usual || *a == play(d9)));
}
