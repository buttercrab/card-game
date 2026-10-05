//! Helpers for tests of Mighty and of what plays it: cards by name
//! ([`cards!`](crate::cards!)), fixed deals ([`dealt`]), a driver that
//! plays whole hands ([`play_hand`]) and a builder for positions in the
//! card play ([`PlayPosition`]). In mighty's own tests, and elsewhere
//! behind the `test-support` feature.

use crate::card::{Card, Color, Suit};
use crate::rules::{Contract, Rules};
use crate::state::{Declared, FriendCall, Phase, Play};
use crate::trick::{Lead, Played, Trick};
use crate::{Action, Mighty, Options, State, View};
use engine::{Bot, Game, Seat, Turn, Viewer};
use rand::RngCore;
use rand::seq::IndexedRandom;
use std::sync::Arc;

/// Cards by name, such as `"SA D10 HK C3 BJ RJ"`: a suit letter (S, D, H,
/// C) and a rank (2 to 10, J, Q, K, A), or BJ and RJ for the jokers.
///
/// # Panics
///
/// On a name that is no card.
pub fn cards(names: &str) -> Vec<Card> {
    names.split_whitespace().map(card).collect()
}

/// One card by name; see [`cards`].
pub fn card(name: &str) -> Card {
    match name {
        "BJ" => return Card::Joker(Color::Black),
        "RJ" => return Card::Joker(Color::Red),
        _ => {}
    }
    let suit = match name.get(..1) {
        Some("S") => Suit::Spade,
        Some("D") => Suit::Diamond,
        Some("H") => Suit::Heart,
        Some("C") => Suit::Club,
        _ => panic!("no card {name:?}"),
    };
    let rank = match &name[1..] {
        "J" => 11,
        "Q" => 12,
        "K" => 13,
        "A" => 14,
        n => n.parse().unwrap_or_else(|_| panic!("no card {name:?}")),
    };
    Card::new(suit, rank)
}

/// Cards written out: `cards![SA D10 HK BJ]` is [`cards`]`("SA D10 HK BJ")`.
#[macro_export]
macro_rules! cards {
    ($($card:tt)*) => {
        $crate::testing::cards(stringify!($($card)*))
    };
}

/// A new game of `rules`, `first_bidder` to bid, dealt `fixed` hands to
/// the first seats (each by [`cards`]) and `kitty` to the kitty, the rest
/// of the deck filling the other seats, then the kitty, in card order.
///
/// # Panics
///
/// When the rules are invalid or the deal is not a whole deck.
pub fn dealt(rules: Rules, first_bidder: Seat, fixed: &[&str], kitty: &str) -> State {
    let fixed: Vec<Vec<Card>> = fixed.iter().map(|h| cards(h)).collect();
    dealt_cards(rules, first_bidder, &fixed, &cards(kitty))
}

/// [`dealt`], the fixed hands and kitty given as cards.
pub fn dealt_cards(rules: Rules, first_bidder: Seat, fixed: &[Vec<Card>], kitty: &[Card]) -> State {
    let mut hands = fixed.to_vec();
    let mut kitty = kitty.to_vec();
    let used: Vec<Card> = hands.iter().flatten().chain(&kitty).copied().collect();
    let mut rest = rules.cards().into_iter().filter(|c| !used.contains(c));
    while hands.len() < rules.players {
        hands.push(rest.by_ref().take(rules.hand_size).collect());
    }
    kitty.extend(rest);
    let mut state = Mighty::new_game(&Options { rules, first_bidder }).expect("valid rules");
    Mighty::apply(&mut state, Action::Deal { hands, kitty }).expect("a whole deck");
    state
}

/// How a seat chooses in [`play_hand`]: from the state, the seat, its
/// legal actions and a generator.
pub type Choose<'a> = dyn FnMut(&State, Seat, &[Action], &mut dyn RngCore) -> Action + 'a;

/// A legal action at random.
pub fn random(_: &State, _: Seat, legal: &[Action], rng: &mut dyn RngCore) -> Action {
    legal.choose(rng).expect("a legal action").clone()
}

/// Choosing as `bot` does, from the seat's view.
pub fn by<B: Bot<Mighty>>(mut bot: B) -> impl FnMut(&State, Seat, &[Action], &mut dyn RngCore) -> Action {
    move |state, seat, legal, rng| bot.act(&Mighty::view(state, Viewer::Seat(seat)), legal, rng)
}

/// Plays a hand of a new game with `options`: chance from `rng`, every seat
/// by `choose`. Before each seat's decision `visit` sees the position;
/// returning false stops the hand there. The state where it stopped, or
/// the hand over.
///
/// # Panics
///
/// When an action is refused.
pub fn play_hand(
    options: &Options,
    rng: &mut dyn RngCore,
    choose: &mut Choose,
    visit: &mut dyn FnMut(&State, Seat) -> bool,
) -> State {
    let mut state = Mighty::new_game(options).expect("valid rules");
    loop {
        let action = match Mighty::turn(&state) {
            Turn::Over => return state,
            Turn::Chance => Mighty::sample_chance(&state, rng),
            Turn::Seat(seat) => {
                if !visit(&state, seat) {
                    return state;
                }
                let legal = Mighty::legal_actions(&state);
                choose(&state, seat, &legal, rng)
            }
        };
        Mighty::apply(&mut state, action).expect("a legal action");
    }
}

/// [`play_hand`] for hand number `hand` of `rules`: the first bidder turns
/// with the hand.
pub fn options(rules: &Rules, hand: u64) -> Options {
    Options {
        rules: rules.clone(),
        first_bidder: (hand % rules.players as u64) as usize,
    }
}

/// A game whose rules are frozen in a crate's `tests/pinned/*-games.json`,
/// copied once from the presets (and varied draws of them) of 2026-10:
/// changing a preset's house rules leaves them, and so the pins, alone.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PinnedGame {
    /// Seeds the game's deals and, for bots, their choices.
    pub seed: u64,
    pub first_bidder: Seat,
    pub rules: Rules,
}

impl PinnedGame {
    pub fn options(&self) -> Options {
        Options {
            rules: self.rules.clone(),
            first_bidder: self.first_bidder,
        }
    }
}

/// A crate's pinned games and golden files, in its `tests/pinned`: the
/// output tests pin, rewritten by `scripts/regenerate-fixtures.sh` when it
/// changes on purpose.
#[derive(Debug, Clone)]
pub struct Pinned {
    dir: std::path::PathBuf,
    package: &'static str,
}

impl Pinned {
    /// The pins of `package`, whose manifest is in `manifest_dir`
    /// (`env!("CARGO_MANIFEST_DIR")`).
    pub fn of(package: &'static str, manifest_dir: &str) -> Pinned {
        Pinned {
            dir: std::path::Path::new(manifest_dir).join("tests/pinned"),
            package,
        }
    }

    /// The games frozen in `tests/pinned/<name>`.
    pub fn games(&self, name: &str) -> Vec<PinnedGame> {
        let path = self.dir.join(name);
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    }

    /// Checks `lines` against the golden file `tests/pinned/<name>`,
    /// naming the first line that differs and how to rewrite the file
    /// (`writer` is the test target whose ignored test does).
    pub fn check(&self, name: &str, lines: &[String], writer: &str) {
        let path = self.dir.join(name);
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let golden: Vec<&str> = text.lines().collect();
        let rewrite = format!(
            "if the change is meant, rewrite it with scripts/regenerate-fixtures.sh \
             (or this file alone: cargo test -p {} --test {writer} -- --ignored write) and review the diff",
            self.package
        );
        for (i, (want, got)) in golden.iter().zip(lines).enumerate() {
            assert!(
                want == got,
                "tests/pinned/{name} line {}:\n  pinned: {want}\n  now:    {got}\n{rewrite}",
                i + 1
            );
        }
        assert_eq!(
            golden.len(),
            lines.len(),
            "tests/pinned/{name} has {} lines, now {}; {rewrite}",
            golden.len(),
            lines.len()
        );
    }

    /// Writes the golden file `tests/pinned/<name>`.
    pub fn write(&self, name: &str, lines: &[String]) {
        std::fs::write(self.dir.join(name), lines.join("\n") + "\n").expect("a golden file");
    }
}

/// A position in the card play, built by hand: for tests that need one the
/// game would take many moves to reach. The declarer, its contract, the
/// friend call, every hand, the discards, the trick under way and the
/// finished tricks are as given; nothing checks they could have happened.
#[derive(Debug, Clone)]
pub struct PlayPosition {
    rules: Rules,
    declared: Declared,
    call: FriendCall,
    friend: Option<Seat>,
    hands: Vec<Vec<Card>>,
    tricks: Vec<Trick>,
    plays: Vec<(Seat, Card)>,
}

impl PlayPosition {
    /// `declarer` playing `contract` under `rules`, alone, every hand empty.
    pub fn new(rules: Rules, declarer: Seat, contract: Contract) -> PlayPosition {
        let seats = rules.players;
        PlayPosition {
            rules,
            declared: Declared {
                declarer,
                contract,
                discards: Vec::new(),
            },
            call: FriendCall::Alone,
            friend: None,
            hands: vec![Vec::new(); seats],
            tricks: Vec::new(),
            plays: Vec::new(),
        }
    }

    /// The friend call, and the friend once known.
    pub fn call(mut self, call: FriendCall, friend: Option<Seat>) -> PlayPosition {
        self.call = call;
        self.friend = friend;
        self
    }

    pub fn hand(mut self, seat: Seat, cards: &[Card]) -> PlayPosition {
        self.hands[seat] = cards.to_vec();
        self.hands[seat].sort();
        self
    }

    pub fn discards(mut self, cards: &[Card]) -> PlayPosition {
        self.declared.discards = cards.to_vec();
        self
    }

    /// The trick under way: these cards played so far, in order, each with
    /// its power as the rules give it then.
    pub fn trick(mut self, plays: &[(Seat, Card)]) -> PlayPosition {
        self.plays = plays.to_vec();
        self
    }

    /// Finished tricks of `cards`, a card from each seat in turn, every one
    /// led by seat 0 as `lead` and won by `winner`.
    pub fn tricks(mut self, cards: &[Card], lead: Lead, winner: Seat) -> PlayPosition {
        self.tricks = cards
            .chunks(self.rules.players)
            .map(|trick| Trick {
                plays: (trick.iter().enumerate())
                    .map(|(seat, &card)| Played {
                        seat,
                        card,
                        powered: true,
                    })
                    .collect(),
                lead,
                winner,
            })
            .collect();
        self
    }

    /// Every card of the deck not placed yet (in a hand, the discards or
    /// the trick under way), as finished tricks: see [`PlayPosition::tricks`].
    pub fn rest_in_tricks(self, lead: Lead, winner: Seat) -> PlayPosition {
        let placed: Vec<Card> = (self.hands.iter().flatten())
            .chain(&self.declared.discards)
            .copied()
            .chain(self.plays.iter().map(|&(_, c)| c))
            .collect();
        let rest: Vec<Card> = self.rules.cards().into_iter().filter(|c| !placed.contains(c)).collect();
        self.tricks(&rest, lead, winner)
    }

    /// The position as a game state.
    pub fn state(self) -> State {
        let seats = self.rules.players;
        let mut taken = vec![Vec::new(); seats];
        for trick in &self.tricks {
            taken[trick.winner].extend(trick.plays.iter().map(|p| p.card));
        }
        let leader = self.plays.first().map_or(self.declared.declarer, |&(seat, _)| seat);
        let mut play = Play {
            declared: self.declared,
            call: self.call,
            friend: self.friend,
            trick_no: self.tricks.len(),
            leader,
            lead: None,
            plays: Vec::new(),
            called_joker: None,
            tricks: self.tricks,
        };
        if let Some(&(_, first)) = self.plays.first() {
            play.lead = Some(match first {
                Card::Normal(suit, _) => Lead::Suit(suit),
                Card::Joker(color) => Lead::Color(color),
            });
        }
        let t = play.trick();
        play.plays = (self.plays.iter())
            .map(|&(seat, card)| t.played(&self.rules, seat, card))
            .collect();
        State::from_parts(Arc::new(self.rules), 0, Phase::Play(play), self.hands, taken)
    }

    /// The position as `seat` sees it.
    pub fn view(self, seat: Seat) -> View {
        Mighty::view(&self.state(), Viewer::Seat(seat))
    }
}
