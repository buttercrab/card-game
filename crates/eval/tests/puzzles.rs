//! Suite v1's puzzles: every one replays to a decision, and every scored
//! one's answer is proven. Also the miner that found them (ignored).

use engine::{Game, Seat, Turn, Viewer};
use eval::puzzle::{self, Puzzle};
use eval::suite::Loaded;
use mighty::card::Card;
use mighty::rules::{CardPolicy, Preset};
use mighty::{Action, FriendCall, Mighty, Options, PhaseView, State};
use mighty_ai::endgame;
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use serde_json::json;
use sha2::{Digest, Sha256};

/// Ways the hidden cards are dealt again to prove an answer, besides the
/// real deal.
const WORLDS: usize = 300;

/// The most tricks left for which an answer is proven: solving more takes
/// too long ([`endgame`] costs about 1.5 ms for five tricks, per world and
/// action).
const PROVABLE_TRICKS: usize = 3;

fn suite() -> Loaded {
    Loaded::load(concat!(env!("CARGO_MANIFEST_DIR"), "/../../research/evals/v1")).expect("suite v1 loads")
}

fn puzzles() -> Vec<Puzzle<Mighty>> {
    let suite = suite();
    let p = suite.suite.puzzles.as_ref().expect("v1 has puzzles");
    puzzle::parse(
        &suite
            .read(&p.file, &p.sha256)
            .expect("the puzzle file matches its hash"),
    )
    .expect("puzzles parse")
}

/// The proven answer for the seat to act, if there is one: the actions
/// that do best in every world, the real deal and [`WORLDS`] others that
/// seat cannot tell from it, each played on perfectly with every hand
/// known ([`endgame::solve`]); provided some exist, and every other action
/// does strictly worse on the real deal (so it is a real mistake, not one
/// only in some unlikely world). `None` when there is no such answer, the
/// rest of the hand is too long to solve ([`PROVABLE_TRICKS`]) or the
/// sides are not settled.
///
/// The other worlds ignore what the play so far showed (a seat that did
/// not follow a suit may be dealt that suit), so they are more than the
/// seat could believe: an answer proven here holds in the worlds it could.
fn proven(state: &State, seed: u64) -> Option<Vec<Action>> {
    let Turn::Seat(me) = Mighty::turn(state) else {
        return None;
    };
    let view = Mighty::view(state, Viewer::Seat(me));
    let PhaseView::Play { trick_no, .. } = view.phase else {
        return None;
    };
    let tricks = view.rules.hand_size - trick_no;
    if tricks > PROVABLE_TRICKS {
        return None;
    }
    let legal = engine::legal_on_turn::<Mighty>(state);
    let values = |world: &State| {
        legal
            .iter()
            .map(|action| {
                let mut s = world.clone();
                engine::apply_on_turn::<Mighty>(&mut s, action.clone()).expect("legal");
                Some(Mighty::payoffs(&s).or_else(|| endgame::solve(&s, tricks))?[me])
            })
            .collect::<Option<Vec<i64>>>()
    };
    let real = values(state)?;
    let top = *real.iter().max().expect("a legal action");
    // Best on the real deal, and every other action worse there.
    let mut best: Vec<usize> = (0..legal.len()).filter(|&i| real[i] == top).collect();
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    for _ in 0..WORLDS {
        let values = values(&Mighty::reshuffle_hidden(state, Viewer::Seat(me), &mut rng))?;
        let top = *values.iter().max().expect("a legal action");
        best.retain(|&i| values[i] == top);
    }
    let all_best_on_real = (0..legal.len()).filter(|&i| real[i] == top).count() == best.len();
    (!best.is_empty() && all_best_on_real).then(|| best.into_iter().map(|i| legal[i].clone()).collect())
}

fn same_set(a: &[Action], b: &[Action]) -> bool {
    a.iter().all(|x| b.contains(x)) && b.iter().all(|x| a.contains(x))
}

#[test]
fn every_puzzle_replays_to_its_decision() {
    let puzzles = puzzles();
    assert!(puzzles.iter().filter(|p| p.scored).count() >= 3);
    for p in &puzzles {
        p.position().unwrap_or_else(|e| panic!("{e}"));
        assert!(!p.title.is_empty() && !p.why.is_empty(), "{}: say what it tests", p.id);
    }
}

/// A position in a few hex digits: every seat's view of it (the rules
/// aside), the seat to act and its legal actions.
fn digest(position: &puzzle::Position<Mighty>) -> String {
    let views: Vec<serde_json::Value> = (0..Mighty::seat_count(&position.state))
        .map(|seat| {
            let mut view = serde_json::to_value(Mighty::view(&position.state, Viewer::Seat(seat))).unwrap();
            view.as_object_mut().unwrap().remove("rules");
            view
        })
        .collect();
    let text = json!({ "views": views, "seat": position.seat, "legal": position.legal }).to_string();
    let hash = Sha256::digest(text.as_bytes());
    hash[..8].iter().map(|b| format!("{b:02x}")).collect()
}

/// Suite v1's logs were recorded before puzzle files carried a log
/// version, under 기본's old misdeal round; they replay, upgraded, to the
/// positions they always did. Pinned from the replay before versions.
#[test]
fn v1_puzzles_reach_their_pinned_positions() {
    let pinned = [
        ("joker-before-last-trick-follow", "5918a3358af7a009"),
        ("joker-before-last-trick-default", "f7ac0db26e88d12d"),
        ("joker-before-last-trick-lead", "d724be36a2b5cb38"),
        ("joker-before-last-trick-trick-nine", "ca9514126b6c7968"),
        ("partner-trick-bank-the-queen", "ffdaba63cde9e082"),
        ("joker-before-last-trick-not-always", "a1c374776e8368ab"),
        ("early-joker-call-own-side-1", "ab9d835e2afe32d1"),
        ("early-joker-call-own-side-2", "bb554bdf0d50c2de"),
        ("early-joker-call-own-side-3", "9de9c918a15abcf0"),
        ("joker-onto-partners-mighty", "64e383155af6ec8c"),
    ];
    let got: Vec<(String, String)> = puzzles()
        .iter()
        .map(|p| (p.id.clone(), digest(&p.position().unwrap_or_else(|e| panic!("{e}")))))
        .collect();
    let want: Vec<(String, String)> = pinned.iter().map(|(i, d)| (i.to_string(), d.to_string())).collect();
    assert_eq!(got, want, "a v1 puzzle reaches another position");
}

#[test]
fn every_scored_answer_is_proven() {
    for p in puzzles().iter().filter(|p| p.scored) {
        let position = p.position().expect("replays");
        let best = proven(&position.state, 0).unwrap_or_else(|| panic!("{}: cannot be solved", p.id));
        assert!(
            same_set(&best, &p.acceptable),
            "{}: the acceptable actions are {:?}, not {:?}",
            p.id,
            best,
            p.acceptable
        );
    }
}

/// What the miner looks for.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Pattern {
    /// Second-to-last trick, a joker in hand that the last trick would
    /// strip of its power.
    JokerBeforeLastTrick,
    /// Last to play to a trick the own side is winning, holding a joker,
    /// three tricks or fewer from the end.
    JokerOntoPartner,
    /// The same, earlier in the hand: not provable.
    JokerOntoPartnerEarly,
    /// The declarer leads the second or third trick and may call the
    /// joker, which the friend holds: calling forces the own side's joker
    /// out. Not provable this early.
    CallingOwnJoker,
}

fn is_joker(action: &Action) -> bool {
    matches!(
        action,
        Action::Play {
            card: Card::Joker(_),
            ..
        }
    )
}

/// The seat holding `card`, read from each seat's own view.
fn holder(state: &State, card: Card) -> Option<Seat> {
    (0..Mighty::seat_count(state)).find(|&s| Mighty::view(state, Viewer::Seat(s)).hand.contains(&card))
}

/// Which pattern the position fits, before proof.
fn pattern(state: &State, me: Seat, legal: &[Action]) -> Option<Pattern> {
    let view = Mighty::view(state, Viewer::Seat(me));
    let PhaseView::Play {
        declarer,
        contract,
        call,
        friend,
        trick_no,
        leader,
        plays,
        leading,
        ..
    } = &view.phase
    else {
        return None;
    };
    let rules = &view.rules;
    let calls = legal.iter().any(|a| matches!(a, Action::Play { call_joker: true, .. }));
    if me == *declarer && *leader == me && plays.is_empty() && (1..=2).contains(trick_no) && calls {
        let friend = match call {
            FriendCall::Card(card) => holder(state, *card),
            _ => *friend,
        };
        let friend_has_joker = rules
            .deck
            .jokers()
            .iter()
            .any(|&j| friend.is_some() && holder(state, j) == friend);
        return (friend != Some(me) && friend_has_joker).then_some(Pattern::CallingOwnJoker);
    }
    let jokers = legal.iter().filter(|a| is_joker(a)).count();
    if jokers == 0 || jokers == legal.len() {
        return None;
    }
    let left = rules.hand_size - trick_no;
    let joker = rules.deck.jokers()[0];
    let stripped = rules.policy(joker, contract.trump, rules.hand_size - 1) != CardPolicy::Valid;
    if left == 2 && stripped {
        return Some(Pattern::JokerBeforeLastTrick);
    }
    let side = |s: Seat| s == *declarer || Some(s) == *friend;
    let known = me == *declarer || Some(me) == *friend;
    let onto_partner =
        plays.len() + 1 == rules.players && known && friend.is_some() && leading.is_some_and(|s| side(s) && s != me);
    match (onto_partner, left <= PROVABLE_TRICKS) {
        (true, true) => Some(Pattern::JokerOntoPartner),
        (true, false) => Some(Pattern::JokerOntoPartnerEarly),
        (false, _) => None,
    }
}

/// Plays hands with the table's 고수 and prints positions that fit a
/// pattern, as puzzle drafts with the move the bot made there:
/// `cargo test -p eval --test puzzles -- --ignored mine --nocapture`.
#[test]
#[ignore = "a tool: prints puzzle drafts"]
fn mine() {
    let bot: sim::spec::Spec = "hard".parse().expect("a bot");
    let drafts: Vec<Vec<serde_json::Value>> = harness::parallel(400, None, |deal| {
        let preset = [Preset::Gshs, Preset::Default][deal as usize % 2];
        let options = Options {
            first_bidder: deal as usize % 5,
            rules: preset.rules(),
        };
        let mut state = Mighty::new_game(&options).expect("valid");
        let mut chance = ChaCha8Rng::seed_from_u64(deal);
        let mut rng = ChaCha8Rng::seed_from_u64(deal);
        rng.set_stream(1);
        let mut log = Vec::new();
        let mut found = Vec::new();
        loop {
            let action = match Mighty::turn(&state) {
                Turn::Over => break,
                Turn::Chance => Mighty::sample_chance(&state, &mut chance),
                Turn::Seat(seat) => {
                    let legal = engine::legal_on_turn::<Mighty>(&state);
                    let view = Mighty::view(&state, Viewer::Seat(seat));
                    let chose = bot.build(seat).act(&view, &legal, &mut rng);
                    if let Some(pattern) = pattern(&state, seat, &legal) {
                        let proof = proven(&state, deal);
                        found.push(json!({
                            "pattern": format!("{pattern:?}"),
                            "log_version": <Mighty as eval::Research>::LOG_VERSION,
                            "rules": preset.name(),
                            "deal": deal,
                            "seat": seat,
                            "chose": chose,
                            "proven": proof,
                            "legal": legal,
                            "log": log,
                        }));
                    }
                    chose
                }
            };
            engine::apply_on_turn::<Mighty>(&mut state, action.clone()).expect("legal");
            log.push(action);
        }
        found
    });
    for draft in drafts.into_iter().flatten() {
        println!("{draft}");
    }
}
