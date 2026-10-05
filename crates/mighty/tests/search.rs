//! The search bot's decisions, pinned: whole hands of search bots over
//! frozen rule sets (`tests/pinned/search-games.json`), every move logged
//! in `tests/pinned/search.jsonl`, one line each. Faster searches and new
//! settings that are off must reproduce it exactly; when a change means to
//! decide differently, the diff shows which decisions moved. Rewrite it
//! with `scripts/regenerate-fixtures.sh` (or `cargo test -p mighty --test
//! search -- --ignored write`). Comparing two builds' eval digests checks
//! many more hands; this one runs in CI.

mod common;

use common::{PinnedGame, check_golden, pinned_games, write_golden};
use engine::{Bot, Game, Turn, Viewer};
use mighty::search::SearchBot;
use mighty::{Action, Mighty};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;

/// A deal as its hands and kitty, cards in order.
fn deal_text(hands: &[Vec<mighty::card::Card>], kitty: &[mighty::card::Card]) -> String {
    let cards = |cards: &[mighty::card::Card]| cards.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(" ");
    let hands: Vec<String> = hands.iter().map(|h| cards(h)).collect();
    format!("{} / kitty {}", hands.join(" / "), cards(kitty))
}

/// Plays `game` with `bot` in every seat; one line per move.
fn play(hand: usize, game: &PinnedGame, bot: SearchBot, log: &mut Vec<String>) {
    let mut rng = ChaCha8Rng::seed_from_u64(game.seed);
    let mut bots: Vec<SearchBot> = vec![bot; game.rules.players];
    let mut state = Mighty::new_game(&game.options()).unwrap();
    for turn in 0.. {
        let (who, action) = match Mighty::turn(&state) {
            Turn::Over => return,
            Turn::Chance => ("deal".to_string(), Mighty::sample_chance(&state, &mut rng)),
            Turn::Seat(seat) => {
                let view = Mighty::view(&state, Viewer::Seat(seat));
                let action = bots[seat].act(&view, &Mighty::legal_actions(&state), &mut rng);
                (format!("seat {seat}"), action)
            }
        };
        let text = match &action {
            Action::Deal { hands, kitty } => deal_text(hands, kitty),
            other => format!("{other:?}"),
        };
        log.push(serde_json::json!([hand, turn, who, text]).to_string());
        Mighty::apply(&mut state, action).unwrap();
    }
}

fn decisions() -> Vec<String> {
    let bot = SearchBot {
        samples: 4,
        budget: None,
        ..SearchBot::default()
    };
    let mut log = Vec::new();
    for (hand, game) in pinned_games("search-games.json").iter().enumerate() {
        play(hand, game, bot, &mut log);
    }
    log
}

#[test]
fn search_decisions_are_pinned() {
    check_golden("search.jsonl", &decisions(), "search");
}

#[test]
#[ignore]
fn write_search_decisions() {
    write_golden("search.jsonl", &decisions());
}
