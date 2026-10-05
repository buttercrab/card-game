//! Model inference from Rust: ONNX models trained in `ml/`, run on
//! [`engine::Observation`]s by [tract](https://github.com/sonos/tract), a
//! pure-Rust runtime (no native library to install or ship, and nothing
//! but the CPU it runs on).
//!
//! A model is a directory as `cardgame_ml.export` writes it:
//!
//! - `model.onnx`: the network. Inputs `global` `[n, global]`, `cards`
//!   `[n, cards, card_features]`, `events` `[n, e, event_features]`,
//!   `event_cards` `[n, e]` (int64) and `events_len` `[n]` (int64), for
//!   any batch size `n` and any `e` up to the spec's `max_events`. A
//!   belief model outputs `logits` `[n, cards, belief_classes]`; a Q
//!   network ([`q`]) also takes `actions` `[n, k]` (int64) and outputs
//!   their `values` `[n, k]`.
//! - `config.json`: how it was trained, with the encoding [`Spec`] under
//!   `spec`, which says the shapes.
//! - `parity.json`: observations and the outputs PyTorch gave for them,
//!   which [`BeliefNet::check_parity`] and [`QNet::check_parity`] compare
//!   against.
//!
//! [`BeliefNet`] implements [`engine::Belief`], so a search can deal
//! hidden cards by its predictions; [`QBot`] plays by a [`QNet`].

pub mod q;

pub use q::{QBot, QNet, QParity};

use engine::{Belief, BeliefError, Observation, Spec};
use serde::Deserialize;
use std::fmt;
use std::path::Path;
use std::sync::Arc;
use tract_onnx::prelude::*;

/// Why a model could not be loaded or run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelError(pub String);

impl fmt::Display for ModelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "model: {}", self.0)
    }
}

impl std::error::Error for ModelError {}

impl From<ModelError> for BeliefError {
    fn from(e: ModelError) -> BeliefError {
        BeliefError(e.0)
    }
}

pub(crate) fn error(context: &str, e: impl fmt::Display) -> ModelError {
    ModelError(format!("{context}: {e}"))
}

/// A belief model, ready to run. Cheap to share between threads: runs
/// take `&self`.
#[derive(Debug, Clone)]
pub struct BeliefNet {
    plan: Arc<TypedRunnableModel>,
    spec: Spec,
}

#[derive(Deserialize)]
struct Config {
    spec: Spec,
}

/// Observations with the logits PyTorch gave for them.
#[derive(Debug, Clone, Deserialize)]
pub struct Parity {
    /// How far apart the logits may be: float sums in another order.
    pub tolerance: f32,
    pub observations: Vec<Observation>,
    /// `[observations][cards × belief_classes]`.
    pub logits: Vec<Vec<f32>>,
}

/// How far a model's outputs are from the ones recorded in Python.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Agreement {
    pub observations: usize,
    /// The largest absolute difference of any output.
    pub max_abs_diff: f32,
}

impl BeliefNet {
    /// Loads the model in directory `dir` (see the crate docs).
    pub fn open(dir: &Path) -> Result<BeliefNet, BeliefError> {
        let config: Config = read_json(&dir.join("config.json"))?;
        BeliefNet::load(&dir.join("model.onnx"), config.spec)
    }

    /// Loads an ONNX model whose inputs follow `spec`.
    pub fn load(path: &Path, spec: Spec) -> Result<BeliefNet, BeliefError> {
        Ok(BeliefNet {
            plan: plan(path)?,
            spec,
        })
    }

    /// The encoding the model reads.
    pub fn spec(&self) -> &Spec {
        &self.spec
    }

    /// Runs one batch: per observation, `[cards × belief_classes]` logits.
    /// Events are cut to the longest sequence in the batch.
    pub fn run(&self, observations: &[&Observation]) -> Result<Vec<Vec<f32>>, BeliefError> {
        let spec = &self.spec;
        let n = observations.len();
        if n == 0 {
            return Ok(Vec::new());
        }
        let inputs = observation_inputs(spec, observations)?;
        let outputs = self.plan.run(inputs).map_err(|e| error("run", e))?;
        let logits = outputs[0]
            .to_plain_array_view::<f32>()
            .map_err(|e| error("output", e))?;
        let per = spec.cards.len() * spec.belief_classes.len();
        if logits.len() != n * per {
            return Err(BeliefError(format!(
                "{} logits for {n} observations, expected {per} each",
                logits.len()
            )));
        }
        let flat: Vec<f32> = logits.iter().copied().collect();
        Ok(flat.chunks(per).map(<[f32]>::to_vec).collect())
    }

    /// Runs the observations in `parity` and compares with the logits
    /// recorded for them.
    pub fn check_parity(&self, parity: &Parity) -> Result<Agreement, BeliefError> {
        let observations: Vec<&Observation> = parity.observations.iter().collect();
        let mut max_abs_diff = 0f32;
        // One at a time and all at once: padding must not change anything.
        let batched = self.run(&observations)?;
        for (i, obs) in observations.iter().enumerate() {
            let single = self.run(&[obs])?;
            for ours in [&single[0], &batched[i]] {
                max_abs_diff = max_abs_diff.max(
                    largest_difference(ours, &parity.logits[i])
                        .map_err(|e| BeliefError(format!("observation {i}: {e}")))?,
                );
            }
        }
        Ok(Agreement {
            observations: observations.len(),
            max_abs_diff,
        })
    }
}

impl Parity {
    pub fn load(path: &Path) -> Result<Parity, BeliefError> {
        Ok(read_json(path)?)
    }
}

impl Belief for BeliefNet {
    fn logits(&self, observations: &[&Observation]) -> Result<Vec<Vec<f32>>, BeliefError> {
        self.run(observations)
    }
}

/// The largest absolute difference between two equally long lists.
pub(crate) fn largest_difference(ours: &[f32], theirs: &[f32]) -> Result<f32, String> {
    if ours.len() != theirs.len() {
        return Err(format!("{} outputs, {} recorded", ours.len(), theirs.len()));
    }
    Ok(ours.iter().zip(theirs).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max))
}

pub(crate) fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, ModelError> {
    let at = path.display().to_string();
    let text = std::fs::read_to_string(path).map_err(|e| error(&at, e))?;
    serde_json::from_str(&text).map_err(|e| error(&at, e))
}

/// Loads and optimises an ONNX model.
pub(crate) fn plan(path: &Path) -> Result<Arc<TypedRunnableModel>, ModelError> {
    tract_onnx::onnx()
        .model_for_path(path)
        .and_then(|model| model.into_optimized())
        .and_then(|model| model.into_runnable())
        .map_err(|e| error(&path.display().to_string(), e))
}

/// The inputs every model here reads, for a batch of observations checked
/// against `spec`: `global`, `cards`, `events`, `event_cards` and
/// `events_len`, events cut to the longest sequence among them.
pub(crate) fn observation_inputs(spec: &Spec, observations: &[&Observation]) -> Result<TVec<TValue>, ModelError> {
    let n = observations.len();
    for obs in observations {
        spec.check(obs).map_err(|e| error("observation", e))?;
    }
    let (globals, slots, card_width, event_width) = (
        spec.global.len(),
        spec.cards.len(),
        spec.card_features.len(),
        spec.event_features.len(),
    );
    let longest = observations.iter().map(|o| o.events_len).max().unwrap_or(0).max(1);
    let mut global = Vec::with_capacity(n * globals);
    let mut cards = Vec::with_capacity(n * slots * card_width);
    let mut events = Vec::with_capacity(n * longest * event_width);
    let mut event_cards = Vec::with_capacity(n * longest);
    let mut events_len = Vec::with_capacity(n);
    for obs in observations {
        global.extend_from_slice(&obs.global);
        cards.extend_from_slice(&obs.cards);
        events.extend_from_slice(&obs.events[..longest * event_width]);
        event_cards.extend(obs.event_cards[..longest].iter().map(|&c| i64::from(c)));
        events_len.push(obs.events_len as i64);
    }
    let tensor = |shape: &[usize], data: &[f32]| Tensor::from_shape(shape, data);
    [
        tensor(&[n, globals], &global),
        tensor(&[n, slots, card_width], &cards),
        tensor(&[n, longest, event_width], &events),
        Tensor::from_shape(&[n, longest], &event_cards),
        Tensor::from_shape(&[n], &events_len),
    ]
    .into_iter()
    .map(|t| t.map(TValue::from))
    .collect::<TractResult<_>>()
    .map_err(|e| error("inputs", e))
}
