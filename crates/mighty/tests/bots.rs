//! How the rule-based bot spends its jokers, checked on hand-built views.

use engine::{Bot, Viewer};
use mighty::bot::SimpleBot;
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
