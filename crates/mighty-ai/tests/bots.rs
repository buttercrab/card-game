//! How the rule-based bot spends its jokers, checked on hand-built views.

use engine::{Bot, Game, Viewer};
use mighty::card::{Card, Color, Suit};
use mighty::rules::{Contract, Preset, Rules};
use mighty::testing::{PlayPosition, dealt_cards};
use mighty::trick::Played;
use mighty::{Action, FriendCall, Lead, Mighty, PhaseView, View};
use mighty_ai::{Clumsy, SimpleBot};
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
    let diamonds = Contract {
        trump: Some(Suit::Diamond),
        count: 17,
    };
    let mut position = PlayPosition::new(rules.clone(), 0, diamonds)
        .call(FriendCall::Card(Card::new(Suit::Spade, 14)), Some(1))
        .hand(0, hand)
        .trick(&plays.iter().map(|p| (p.seat, p.card)).collect::<Vec<_>>());
    // Two cards a seat, less the one it has played to this trick.
    let mut placed: Vec<Card> = hand.iter().copied().chain(plays.iter().map(|p| p.card)).collect();
    let mut others = others.iter().copied();
    for seat in 1..5 {
        let held = 2 - usize::from(plays.iter().any(|p| p.seat == seat));
        let cards: Vec<Card> = others.by_ref().take(held).collect();
        placed.extend(&cards);
        position = position.hand(seat, &cards);
    }
    let gone: Vec<Card> = rules.cards().into_iter().filter(|c| !placed.contains(c)).collect();
    let view = position
        .discards(&gone[..4])
        .rest_in_tricks(Lead::Suit(Suit::Spade), 0)
        .view(0);
    assert!(
        matches!(view.phase, PhaseView::Play { trick_no: 8, .. }),
        "the second-to-last trick"
    );
    view
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

/// A seat bidding first under `preset` with `hand`, and what it may do.
fn bidding(preset: Preset, hand: Vec<Card>) -> (View, Vec<Action>) {
    let state = dealt_cards(preset.rules(), 0, &[hand], &[]);
    (
        Mighty::view(&state, Viewer::Seat(0)),
        engine::legal_on_turn::<Mighty>(&state),
    )
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

/// Seat 0 declares ♥ alone at `players` (3마 or 4마 rules) and leads the
/// eighth trick holding ♣K, ♦9 and ♠7. Every heart, the mighty, the joker
/// and ♣A went in earlier tricks; the other seats hold only low spades and
/// diamonds, and so do the discards.
fn short_deck_lead(players: usize) -> (View, Vec<Action>) {
    let rules = Rules::web_mighty().for_players(players).unwrap();
    let hand = vec![
        Card::new(Suit::Club, 13),
        Card::new(Suit::Diamond, 9),
        Card::new(Suit::Spade, 7),
    ];
    let mighty = rules.mighty(Some(Suit::Heart));
    let rest: Vec<Card> = rules.cards().into_iter().filter(|c| !hand.contains(c)).collect();
    let harmless = |c: &Card| matches!(c.suit(), Some(Suit::Spade | Suit::Diamond)) && *c != mighty;
    let held = (players - 1) * 3 + rules.kitty_size();
    let quiet: Vec<Card> = rest.iter().copied().filter(harmless).take(held).collect();
    let (discards, others) = quiet.split_at(rules.kitty_size());
    let hearts = Contract {
        trump: Some(Suit::Heart),
        count: 14,
    };
    let mut position = PlayPosition::new(rules.clone(), 0, hearts)
        .hand(0, &hand)
        .discards(discards);
    for (seat, cards) in others.chunks(3).enumerate() {
        position = position.hand(seat + 1, cards);
    }
    let view = position.rest_in_tricks(Lead::Suit(Suit::Spade), 0).view(0);
    assert!(
        matches!(view.phase, PhaseView::Play { trick_no: 7, .. }),
        "the eighth trick"
    );
    let legal = hand.iter().map(|&c| play(c)).collect();
    (view, legal)
}

/// Regression: the bot counted 3마's and 4마's never-dealt low hearts as
/// trumps still out, so it never trusted a side card no dealt card can
/// beat. With every dealt trump gone, ♣K wins the trick and is led.
#[test]
fn a_sure_side_card_is_led_at_three_and_four_players() {
    for players in [3, 4] {
        let (v, legal) = short_deck_lead(players);
        assert_eq!(decide(&v, &legal), play(Card::new(Suit::Club, 13)), "{players} players");
    }
}
