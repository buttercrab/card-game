//! Any game behind one object-safe interface, with JSON in and out.
//!
//! [`Game`] is generic, which suits code written for one game. A service
//! that hosts several games, by id, wants one type for all of them: that is
//! [`DynGame`] (the game: names, presets, rule checks, new hands) and
//! [`DynState`] (one hand in progress). A game opts in by implementing
//! [`JsonGame`]; the JSON plumbing is shared, so every game behaves the
//! same at this boundary.

use crate::{Game, Seat, Turn, Viewer};
use rand::RngCore;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::fmt::{self, Debug};
use std::marker::PhantomData;

/// A named rule set a game ships with.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PresetInfo {
    /// Stable, for links and saved tables.
    pub id: String,
    /// For people.
    pub name: String,
    /// The rules, as the game's rules type serializes them.
    pub rules: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DynError {
    /// The JSON does not describe a value of the expected type.
    #[error("bad {what}: {message}")]
    Json { what: &'static str, message: String },
    /// The game refused it: invalid rules, an illegal action.
    #[error("{0}")]
    Game(String),
}

/// What a [`Game`] adds to be driven through JSON: serde for its types,
/// its names and its presets.
pub trait JsonGame:
    Game<
        Options: Serialize + DeserializeOwned,
        State: Send + Sync,
        Action: Serialize + DeserializeOwned,
        View: Serialize,
    > + 'static
{
    /// A rule set: what presets hold and players edit. Part of the options.
    type Rules: Serialize + DeserializeOwned;

    /// Stable id, for URLs and stored data: `mighty`.
    const ID: &'static str;
    /// For people: `마이티`.
    const NAME: &'static str;

    /// The presets, in the order players pick them: (id, name, rules).
    fn presets() -> Vec<(&'static str, &'static str, Self::Rules)>;

    /// Why `rules` cannot be played, if they cannot.
    fn validate(rules: &Self::Rules) -> Result<(), String>;
}

/// A game, without its types: everything is JSON.
pub trait DynGame: Send + Sync {
    fn id(&self) -> &'static str;

    fn name(&self) -> &'static str;

    fn presets(&self) -> Vec<PresetInfo>;

    /// Checks a rule set, such as one a player edited.
    fn validate_rules(&self, rules: &Value) -> Result<(), DynError>;

    /// A new hand from the game's options (rules and whatever else a hand
    /// needs, such as who bids first).
    fn new_game(&self, options: &Value) -> Result<Box<dyn DynState>, DynError>;
}

/// One hand in progress, as [`Game`] sees a state, with JSON for actions
/// and views.
pub trait DynState: Send + Sync + Debug {
    fn seat_count(&self) -> usize;

    fn turn(&self) -> Turn;

    /// See [`Game::legal_actions`].
    fn legal_actions(&self) -> Vec<Value>;

    /// See [`Game::sample_chance`].
    fn sample_chance(&self, rng: &mut dyn RngCore) -> Value;

    /// See [`Game::apply`]; on error the state is unchanged.
    fn apply(&mut self, action: &Value) -> Result<(), DynError>;

    /// See [`Game::out_of_turn_actions`].
    fn out_of_turn_actions(&self, seat: Seat) -> Vec<Value>;

    /// See [`Game::apply_out_of_turn`]; an action not in
    /// [`DynState::out_of_turn_actions`] is refused, and on error the state
    /// is unchanged.
    fn apply_out_of_turn(&mut self, seat: Seat, action: &Value) -> Result<(), DynError>;

    /// See [`Game::view`].
    fn view(&self, viewer: Viewer) -> Value;

    /// See [`Game::payoffs`].
    fn payoffs(&self) -> Option<Vec<i64>>;

    fn clone_box(&self) -> Box<dyn DynState>;
}

impl Clone for Box<dyn DynState> {
    fn clone(&self) -> Box<dyn DynState> {
        self.clone_box()
    }
}

/// `G` as a [`DynGame`].
pub struct Erased<G>(PhantomData<fn() -> G>);

impl<G: JsonGame> Erased<G> {
    pub fn new() -> Erased<G> {
        Erased(PhantomData)
    }
}

impl<G: JsonGame> Default for Erased<G> {
    fn default() -> Erased<G> {
        Erased::new()
    }
}

impl<G> Debug for Erased<G> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("Erased").field(&std::any::type_name::<G>()).finish()
    }
}

fn parse<T: DeserializeOwned>(what: &'static str, json: &Value) -> Result<T, DynError> {
    T::deserialize(json).map_err(|e| DynError::Json {
        what,
        message: e.to_string(),
    })
}

/// A game's own types always serialize; failing to is a bug in the game.
fn to_json(value: &impl Serialize) -> Value {
    serde_json::to_value(value).expect("game types serialize to JSON")
}

impl<G: JsonGame> DynGame for Erased<G> {
    fn id(&self) -> &'static str {
        G::ID
    }

    fn name(&self) -> &'static str {
        G::NAME
    }

    fn presets(&self) -> Vec<PresetInfo> {
        G::presets()
            .into_iter()
            .map(|(id, name, rules)| PresetInfo {
                id: id.to_string(),
                name: name.to_string(),
                rules: to_json(&rules),
            })
            .collect()
    }

    fn validate_rules(&self, rules: &Value) -> Result<(), DynError> {
        G::validate(&parse("rules", rules)?).map_err(DynError::Game)
    }

    fn new_game(&self, options: &Value) -> Result<Box<dyn DynState>, DynError> {
        let options: G::Options = parse("options", options)?;
        let state = G::new_game(&options).map_err(|e| DynError::Game(e.to_string()))?;
        Ok(Box::new(Hand::<G> { state }))
    }
}

/// A [`Game::State`] as a [`DynState`].
struct Hand<G: Game> {
    state: G::State,
}

impl<G: Game> Debug for Hand<G> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.state.fmt(f)
    }
}

impl<G: JsonGame> DynState for Hand<G> {
    fn seat_count(&self) -> usize {
        G::seat_count(&self.state)
    }

    fn turn(&self) -> Turn {
        G::turn(&self.state)
    }

    fn legal_actions(&self) -> Vec<Value> {
        G::legal_actions(&self.state).iter().map(to_json).collect()
    }

    fn sample_chance(&self, rng: &mut dyn RngCore) -> Value {
        to_json(&G::sample_chance(&self.state, rng))
    }

    fn apply(&mut self, action: &Value) -> Result<(), DynError> {
        let action: G::Action = parse("action", action)?;
        G::apply(&mut self.state, action).map_err(|e| DynError::Game(e.to_string()))
    }

    fn out_of_turn_actions(&self, seat: Seat) -> Vec<Value> {
        G::out_of_turn_actions(&self.state, seat).iter().map(to_json).collect()
    }

    fn apply_out_of_turn(&mut self, seat: Seat, action: &Value) -> Result<(), DynError> {
        let action: G::Action = parse("action", action)?;
        if !G::out_of_turn_actions(&self.state, seat).contains(&action) {
            return Err(DynError::Game(format!("seat {seat} may not take {action:?} now")));
        }
        G::apply_out_of_turn(&mut self.state, seat, action).map_err(|e| DynError::Game(e.to_string()))
    }

    fn view(&self, viewer: Viewer) -> Value {
        to_json(&G::view(&self.state, viewer))
    }

    fn payoffs(&self) -> Option<Vec<i64>> {
        G::payoffs(&self.state)
    }

    fn clone_box(&self) -> Box<dyn DynState> {
        Box::new(Hand::<G> {
            state: self.state.clone(),
        })
    }
}

/// The games a service offers, by id.
#[derive(Default)]
pub struct Registry {
    games: Vec<Box<dyn DynGame>>,
}

impl Registry {
    pub fn new() -> Registry {
        Registry::default()
    }

    /// Adds `G`. Two games with one id would make ids ambiguous, so that
    /// panics.
    pub fn with<G: JsonGame>(mut self) -> Registry {
        self.register(Box::new(Erased::<G>::new()));
        self
    }

    pub fn register(&mut self, game: Box<dyn DynGame>) {
        assert!(self.get(game.id()).is_none(), "game `{}` registered twice", game.id());
        self.games.push(game);
    }

    pub fn get(&self, id: &str) -> Option<&dyn DynGame> {
        self.games.iter().find(|g| g.id() == id).map(|g| g.as_ref())
    }

    /// Every game, in the order registered.
    pub fn games(&self) -> impl Iterator<Item = &dyn DynGame> {
        self.games.iter().map(|g| g.as_ref())
    }
}

impl Debug for Registry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_list().entries(self.games().map(|g| g.id())).finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use serde_json::json;

    /// Two seats take turns adding 1 or 2 to a count; whoever reaches the
    /// target wins. Enough of a game to exercise the boundary.
    #[derive(Debug, Clone, Copy)]
    struct Race;

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    struct RaceRules {
        target: u32,
    }

    #[derive(Debug, Clone, PartialEq)]
    struct RaceState {
        target: u32,
        count: u32,
        to_act: Seat,
    }

    #[derive(Debug, thiserror::Error)]
    #[error("{0}")]
    struct RaceError(&'static str);

    impl Game for Race {
        type Options = RaceRules;
        type State = RaceState;
        type Action = u32;
        type View = u32;
        type Error = RaceError;

        fn new_game(options: &RaceRules) -> Result<RaceState, RaceError> {
            Race::validate(options).map_err(|_| RaceError("bad target"))?;
            Ok(RaceState {
                target: options.target,
                count: 0,
                to_act: 0,
            })
        }

        fn seat_count(_: &RaceState) -> usize {
            2
        }

        fn turn(state: &RaceState) -> Turn {
            if state.count >= state.target {
                Turn::Over
            } else {
                Turn::Seat(state.to_act)
            }
        }

        fn legal_actions(state: &RaceState) -> Vec<u32> {
            match Race::turn(state) {
                Turn::Seat(_) => vec![1, 2],
                _ => Vec::new(),
            }
        }

        fn sample_chance(_: &RaceState, _: &mut dyn RngCore) -> u32 {
            unreachable!("no chance in a race")
        }

        fn apply(state: &mut RaceState, action: u32) -> Result<(), RaceError> {
            if !Race::legal_actions(state).contains(&action) {
                return Err(RaceError("illegal"));
            }
            state.count += action;
            state.to_act = 1 - state.to_act;
            Ok(())
        }

        fn view(state: &RaceState, _: Viewer) -> u32 {
            state.count
        }

        fn payoffs(state: &RaceState) -> Option<Vec<i64>> {
            // The seat that just moved reached the target.
            (Race::turn(state) == Turn::Over).then(|| {
                let winner = 1 - state.to_act;
                (0..2).map(|s| if s == winner { 1 } else { -1 }).collect()
            })
        }

        fn reshuffle_hidden(state: &RaceState, _: Viewer, _: &mut dyn RngCore) -> RaceState {
            state.clone()
        }
    }

    impl JsonGame for Race {
        type Rules = RaceRules;
        const ID: &'static str = "race";
        const NAME: &'static str = "Race";

        fn presets() -> Vec<(&'static str, &'static str, RaceRules)> {
            vec![("short", "Short", RaceRules { target: 3 })]
        }

        fn validate(rules: &RaceRules) -> Result<(), String> {
            if rules.target == 0 {
                Err("the target must be above zero".into())
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn plays_through_json() {
        let registry = Registry::new().with::<Race>();
        let game = registry.get("race").expect("registered");
        assert_eq!((game.id(), game.name()), ("race", "Race"));
        let preset = &game.presets()[0];
        assert_eq!(preset.rules, json!({ "target": 3 }));
        let mut hand = game.new_game(&preset.rules).unwrap();
        while let Turn::Seat(_) = hand.turn() {
            assert_eq!(hand.legal_actions(), [json!(1), json!(2)]);
            let before = hand.clone();
            hand.apply(&json!(2)).unwrap();
            assert_ne!(before.view(Viewer::Spectator), hand.view(Viewer::Spectator));
        }
        assert_eq!(hand.view(Viewer::Seat(0)), json!(4));
        assert_eq!(hand.payoffs(), Some(vec![-1, 1]));
    }

    #[test]
    fn rejects_bad_json_and_bad_rules() {
        let game = Erased::<Race>::new();
        assert!(matches!(
            game.validate_rules(&json!({ "goal": 3 })),
            Err(DynError::Json { what: "rules", .. })
        ));
        assert_eq!(
            game.validate_rules(&json!({ "target": 0 })),
            Err(DynError::Game("the target must be above zero".into()))
        );
        assert!(game.new_game(&json!({ "target": 0 })).is_err());
        let mut hand = game.new_game(&json!({ "target": 3 })).unwrap();
        assert!(matches!(hand.apply(&json!("two")), Err(DynError::Json { .. })));
        assert_eq!(hand.apply(&json!(3)), Err(DynError::Game("illegal".into())));
        assert_eq!(hand.view(Viewer::Seat(0)), json!(0), "a refused action changes nothing");
        assert!(hand.out_of_turn_actions(1).is_empty(), "none by default");
        assert!(matches!(hand.apply_out_of_turn(1, &json!(1)), Err(DynError::Game(_))));
        assert_eq!(hand.view(Viewer::Seat(0)), json!(0));
    }

    #[test]
    #[should_panic(expected = "registered twice")]
    fn ids_are_unique() {
        let _ = Registry::new().with::<Race>().with::<Race>();
    }
}
