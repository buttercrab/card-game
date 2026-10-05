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
//!   any batch size `n` and any `e` up to the spec's `max_events`; output
//!   `logits` `[n, cards, belief_classes]`.
//! - `config.json`: how it was trained, with the encoding [`Spec`] under
//!   `spec`, which says the shapes.
//! - `parity.json`: observations and the logits PyTorch gave for them,
//!   which [`BeliefNet::check_parity`] compares against.
//!
//! [`BeliefNet`] implements [`engine::Belief`], so a search can deal
//! hidden cards by its predictions.

use engine::{Belief, BeliefError, Observation, Spec};
use serde::Deserialize;
use std::path::Path;
use std::sync::Arc;
use tract_onnx::prelude::*;

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

/// How far a model's logits are from the ones recorded in Python.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Agreement {
    pub observations: usize,
    /// The largest absolute difference of any logit.
    pub max_abs_diff: f32,
}

fn error(context: &str, e: impl std::fmt::Display) -> BeliefError {
    BeliefError(format!("{context}: {e}"))
}

impl BeliefNet {
    /// Loads the model in directory `dir` (see the crate docs).
    pub fn open(dir: &Path) -> Result<BeliefNet, BeliefError> {
        let text = std::fs::read_to_string(dir.join("config.json")).map_err(|e| error("config.json", e))?;
        let config: Config = serde_json::from_str(&text).map_err(|e| error("config.json", e))?;
        BeliefNet::load(&dir.join("model.onnx"), config.spec)
    }

    /// Loads an ONNX model whose inputs follow `spec`.
    pub fn load(path: &Path, spec: Spec) -> Result<BeliefNet, BeliefError> {
        let plan = tract_onnx::onnx()
            .model_for_path(path)
            .and_then(|model| model.into_optimized())
            .and_then(|model| model.into_runnable())
            .map_err(|e| error(&path.display().to_string(), e))?;
        Ok(BeliefNet { plan, spec })
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
        let inputs: TVec<TValue> = tvec![
            tensor(&[n, globals], &global),
            tensor(&[n, slots, card_width], &cards),
            tensor(&[n, longest, event_width], &events),
            Tensor::from_shape(&[n, longest], &event_cards),
            Tensor::from_shape(&[n], &events_len),
        ]
        .into_iter()
        .map(|t| t.map(TValue::from))
        .collect::<TractResult<_>>()
        .map_err(|e| error("inputs", e))?;
        let outputs = self.plan.run(inputs).map_err(|e| error("run", e))?;
        let logits = outputs[0]
            .to_plain_array_view::<f32>()
            .map_err(|e| error("output", e))?;
        let per = slots * spec.belief_classes.len();
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
            for (ours, theirs) in [&single[0], &batched[i]].into_iter().map(|l| (l, &parity.logits[i])) {
                if ours.len() != theirs.len() {
                    return Err(BeliefError(format!("observation {i}: logits differ in length")));
                }
                for (a, b) in ours.iter().zip(theirs) {
                    max_abs_diff = max_abs_diff.max((a - b).abs());
                }
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
        let text = std::fs::read_to_string(path).map_err(|e| error(&path.display().to_string(), e))?;
        serde_json::from_str(&text).map_err(|e| error(&path.display().to_string(), e))
    }
}

impl Belief for BeliefNet {
    fn logits(&self, observations: &[&Observation]) -> Result<Vec<Vec<f32>>, BeliefError> {
        self.run(observations)
    }
}
