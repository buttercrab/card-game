//! Games as model inputs: what one seat may see, as fixed-shape numeric
//! arrays, and the traits learned models answer through.
//!
//! Kept out of `engine` so that the game core stays what every game and
//! the server need, and this, what the environment, the evals' models and
//! inference need, grows on its own.
//!
//! A game describes its layout once, as a [`Spec`], and encodes every
//! position into an [`Observation`] of exactly that shape. One spec covers
//! every rule set and table size the game supports, so a single model plays
//! all of them: what changes between rule sets is carried by the values
//! (rule features, per-card meanings, presence masks), never by the shape.
//!
//! Observations come from the view, never from the full state, so they
//! cannot leak what the seat may not know. Where hidden cards really are is
//! a separate function of the full state ([`Encode::belief_targets`]), used
//! only as a training label.

use engine::{Game, Seat};
use serde::{Deserialize, Serialize};
use std::fmt;

/// The shape of a game's observations and the meaning of every number in
/// them. Feature names are for debugging, tests and the Python side; a
/// model depends only on the lengths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Spec {
    /// Which encoding this is, such as `mighty-1`. Data and models record
    /// it; any change to the layout or to what a feature means gets a new
    /// one.
    pub version: String,
    /// The global vector: the rules, then the public state of the hand.
    pub global: Vec<String>,
    /// One name per card slot: the rows of [`Observation::cards`], one for
    /// every card of the largest deck the game supports.
    pub cards: Vec<String>,
    /// The columns of [`Observation::cards`].
    pub card_features: Vec<String>,
    /// Rows of [`Observation::events`].
    pub max_events: usize,
    /// The columns of [`Observation::events`].
    pub event_features: Vec<String>,
    /// One name per action index: the length of [`Observation::legal`].
    pub actions: Vec<String>,
    /// What a [`Encode::belief_targets`] value means: where a hidden card
    /// can be.
    pub belief_classes: Vec<String>,
}

impl Spec {
    /// Whether `obs` has exactly this spec's shape.
    pub fn check(&self, obs: &Observation) -> Result<(), String> {
        let expect = |what: &str, got: usize, want: usize| {
            if got == want {
                Ok(())
            } else {
                Err(format!("{what}: {got} values, the spec says {want}"))
            }
        };
        expect("global", obs.global.len(), self.global.len())?;
        expect("cards", obs.cards.len(), self.cards.len() * self.card_features.len())?;
        expect("events", obs.events.len(), self.max_events * self.event_features.len())?;
        expect("event cards", obs.event_cards.len(), self.max_events)?;
        expect("legal", obs.legal.len(), self.actions.len())?;
        if obs.events_len > self.max_events {
            return Err(format!("{} events, at most {}", obs.events_len, self.max_events));
        }
        let slots = self.cards.len() as i32;
        if obs.event_cards.iter().any(|&c| c < -1 || c >= slots) {
            return Err("an event names a card slot that does not exist".into());
        }
        Ok(())
    }
}

/// One position as one seat sees it. Every array is flat and row-major,
/// with the lengths its [`Spec`] gives, so the Python side can view it as
/// tensors without knowing the game.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Observation {
    /// `[global]`: rule features and the public state of the hand.
    pub global: Vec<f32>,
    /// `[cards, card_features]`: what each card means now and where the
    /// viewer knows it to be.
    pub cards: Vec<f32>,
    /// `[max_events, event_features]`: what happened, oldest first, the
    /// rows past `events_len` all zero.
    pub events: Vec<f32>,
    /// `[max_events]`: the card slot each event is about, or -1, so a model
    /// can share one card embedding between the card rows and the events.
    pub event_cards: Vec<i32>,
    /// How many rows of `events` are real.
    pub events_len: usize,
    /// `[actions]`: which action indices are legal now. All false when it
    /// is not the viewer's turn.
    pub legal: Vec<bool>,
}

/// Options an encoding cannot represent, such as a contract number beyond
/// its action space.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unsupported(pub String);

impl fmt::Display for Unsupported {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "the encoding does not cover these options: {}", self.0)
    }
}

impl std::error::Error for Unsupported {}

/// A game whose positions can be fed to a model.
///
/// Seats in every encoding are relative to the viewer (the viewer is seat
/// 0, the next to play seat 1, and so on), so a model never learns
/// anything about absolute seat numbers.
pub trait Encode: Game {
    /// The layout of observations for games with `options`, or why this
    /// encoding cannot represent them. Games should return the same spec
    /// for every option set they support, so one model fits them all.
    fn spec(options: &Self::Options) -> Result<Spec, Unsupported>;

    /// The view as model inputs. `legal` is what the viewer may do now (as
    /// [`Game::legal_actions`] gives it), or empty when it is not their
    /// turn: bots get exactly these two things, and so does a model.
    fn encode(view: &Self::View, legal: &[Self::Action]) -> Observation;

    /// The index of `action`, taken by the viewer of `view`, in the spec's
    /// fixed action space. Distinct legal actions always get distinct
    /// indices. `None` for actions no seat takes, such as a deal.
    fn action_index(view: &Self::View, action: &Self::Action) -> Option<usize>;

    /// The legal action with index `index`, if one has it: how a model's
    /// choice becomes a move.
    fn action_from_index(view: &Self::View, legal: &[Self::Action], index: usize) -> Option<Self::Action> {
        legal
            .iter()
            .find(|action| Self::action_index(view, action) == Some(index))
            .cloned()
    }

    /// `[actions]`: true at the index of every action in `legal`.
    fn legal_mask(view: &Self::View, legal: &[Self::Action], actions: usize) -> Vec<bool> {
        let mut mask = vec![false; actions];
        for index in legal.iter().filter_map(|action| Self::action_index(view, action)) {
            if let Some(slot) = mask.get_mut(index) {
                *slot = true;
            }
        }
        mask
    }

    /// Training labels for a belief model: for each card slot, where that
    /// card really is as an index into [`Spec::belief_classes`], or -1 when
    /// `viewer` already knows (or the card is not in play). Reads the full
    /// state, so it must never feed a model's input.
    fn belief_targets(state: &Self::State, viewer: Seat) -> Vec<i32>;
}

/// A learned model of where hidden cards are: the predictions that
/// [`Encode::belief_targets`] trains. Bots that deal the unseen cards (a
/// determinised search) can deal them by its beliefs instead of
/// uniformly. Implemented outside the games, by an inference runtime
/// (`crates/infer`).
pub trait Belief: Send + Sync {
    /// For each observation, `[cards, belief_classes]` logits, row-major.
    /// A card's distribution is the softmax of its row over the classes
    /// that can hold a hidden card in that position; which can is for the
    /// caller to say (the model is trained with the impossible ones
    /// masked, so their logits mean nothing).
    fn logits(&self, observations: &[&Observation]) -> Result<Vec<Vec<f32>>, BeliefError>;
}

/// Why a [`Belief`] model could not answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BeliefError(pub String);

impl fmt::Display for BeliefError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "belief model: {}", self.0)
    }
}

impl std::error::Error for BeliefError {}

/// A learned value of each legal action: what a Q network trained by
/// self-play (`cardgame_ml.train.dmc`) predicts the acting seat's payoff
/// for the hand to be, in points, if it takes that action. A search can
/// lean on it to pick which moves to consider and to stop its playouts
/// early. Implemented outside the games, by an inference runtime
/// (`crates/infer`).
pub trait ActionValues: Send + Sync {
    /// For each observation, `(action index, value in points)` for every
    /// legal action by [`Observation::legal`], in index order; none for
    /// an observation without a legal action.
    fn action_values(&self, observations: &[&Observation]) -> Result<Vec<Vec<(usize, f32)>>, BeliefError>;

    /// The encoding the model reads.
    fn spec(&self) -> &Spec;
}

/// Builds a feature vector and, on request, the name of every feature in
/// the same pass, so names and values cannot drift apart: a game writes
/// each group once, and its spec is that code run with names on.
#[derive(Debug, Clone, Default)]
pub struct Features {
    values: Vec<f32>,
    names: Option<Vec<String>>,
}

impl Features {
    /// Values only, for encoding.
    pub fn new() -> Features {
        Features::default()
    }

    /// Values only, with room for `capacity` of them.
    pub fn with_capacity(capacity: usize) -> Features {
        Features {
            values: Vec::with_capacity(capacity),
            names: None,
        }
    }

    /// Values and names, for building a [`Spec`].
    pub fn named() -> Features {
        Features {
            values: Vec::new(),
            names: Some(Vec::new()),
        }
    }

    /// Appends one value. `name` runs only when names are being kept, so
    /// encoding never formats strings.
    pub fn push(&mut self, name: impl FnOnce() -> String, value: f32) {
        self.values.push(value);
        if let Some(names) = &mut self.names {
            names.push(name());
        }
    }

    pub fn num(&mut self, name: &str, value: f32) {
        self.push(|| name.to_string(), value);
    }

    pub fn flag(&mut self, name: &str, on: bool) {
        self.num(name, if on { 1.0 } else { 0.0 });
    }

    /// One value per label, 1 at `index` and 0 elsewhere (all 0 for `None`).
    pub fn one_hot(&mut self, name: &str, labels: &[&str], index: Option<usize>) {
        for (i, label) in labels.iter().enumerate() {
            self.push(|| format!("{name}={label}"), if Some(i) == index { 1.0 } else { 0.0 });
        }
    }

    /// `count` values named `name[0]`, `name[1]`, ...: one per relative
    /// seat, say.
    pub fn each(&mut self, name: &str, count: usize, value: impl Fn(usize) -> f32) {
        for i in 0..count {
            self.push(|| format!("{name}[{i}]"), value(i));
        }
    }

    pub fn len(&self) -> usize {
        self.values.len()
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    pub fn values(&self) -> &[f32] {
        &self.values
    }

    /// The names, when made with [`Features::named`].
    pub fn names(&self) -> Option<&[String]> {
        self.names.as_deref()
    }

    pub fn into_values(self) -> Vec<f32> {
        self.values
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_follow_values() {
        let mut f = Features::named();
        f.num("players", 0.5);
        f.flag("open", true);
        f.one_hot("phase", &["bid", "play"], Some(1));
        f.each("seat", 2, |i| i as f32);
        assert_eq!(f.values(), &[0.5, 1.0, 0.0, 1.0, 0.0, 1.0]);
        assert_eq!(
            f.names().unwrap(),
            ["players", "open", "phase=bid", "phase=play", "seat[0]", "seat[1]"]
        );
    }

    #[test]
    fn values_only_keeps_no_names() {
        let mut f = Features::new();
        f.one_hot("phase", &["bid", "play"], None);
        assert_eq!(f.len(), 2);
        assert_eq!(f.names(), None);
    }

    #[test]
    fn check_catches_wrong_shapes() {
        let spec = Spec {
            version: "test-1".into(),
            global: vec!["a".into()],
            cards: vec!["x".into(), "y".into()],
            card_features: vec!["f".into()],
            max_events: 2,
            event_features: vec!["e".into()],
            actions: vec!["pass".into(), "go".into()],
            belief_classes: vec!["seat+0".into()],
        };
        let mut obs = Observation {
            global: vec![0.0],
            cards: vec![0.0; 2],
            events: vec![0.0; 2],
            event_cards: vec![-1, 1],
            events_len: 1,
            legal: vec![true, false],
        };
        assert_eq!(spec.check(&obs), Ok(()));
        obs.event_cards[1] = 2;
        assert!(spec.check(&obs).is_err(), "slot 2 does not exist");
        obs.event_cards[1] = -1;
        obs.cards.pop();
        assert!(spec.check(&obs).is_err());
    }
}
