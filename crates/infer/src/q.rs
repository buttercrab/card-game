//! Q networks, as `cardgame_ml.train.dmc` trains them: how many points
//! each legal action is worth to the seat taking it, and a bot that plays
//! by them.
//!
//! The ONNX graph takes the observation and `actions` `[n, k]` (action
//! indices, int64) and returns `values` `[n, k]` in the network's units;
//! `config.json` says how many of those a point is (`reward_scale`), and
//! [`QNet::values`] returns points.

use crate::{Agreement, ModelError, error, largest_difference, observation_inputs, plan, read_json};
use engine::{ActionValues, BeliefError, Bot, Encode, Observation, Spec};
use rand::{Rng, RngCore};
use serde::Deserialize;
use std::path::Path;
use std::sync::Arc;
use tract_onnx::prelude::*;

/// A Q network, ready to run. Cheap to share between threads: runs take
/// `&self`.
#[derive(Debug, Clone)]
pub struct QNet {
    plan: Arc<TypedRunnableModel>,
    spec: Spec,
    reward_scale: f32,
}

#[derive(Deserialize)]
struct Config {
    spec: Spec,
    reward_scale: f32,
}

/// Observations with the values PyTorch gave their legal actions.
#[derive(Debug, Clone, Deserialize)]
pub struct QParity {
    pub tolerance: f32,
    pub observations: Vec<Observation>,
    /// `[observations][legal actions, in index order]`, in the network's
    /// units (not points).
    pub values: Vec<Vec<f32>>,
}

impl QParity {
    pub fn load(path: &Path) -> Result<QParity, ModelError> {
        read_json(path)
    }
}

impl QNet {
    /// Loads the network in directory `dir` (see the crate docs).
    pub fn open(dir: &Path) -> Result<QNet, ModelError> {
        let config: Config = read_json(&dir.join("config.json"))?;
        if config.reward_scale.is_nan() || config.reward_scale <= 0.0 {
            return Err(ModelError(format!(
                "reward_scale {} is not positive",
                config.reward_scale
            )));
        }
        Ok(QNet {
            plan: plan(&dir.join("model.onnx"))?,
            spec: config.spec,
            reward_scale: config.reward_scale,
        })
    }

    /// The encoding the network reads.
    pub fn spec(&self) -> &Spec {
        &self.spec
    }

    /// Runs one batch in the network's own units: per observation, the
    /// value of each legal action (by [`Observation::legal`]) as `(index,
    /// value)`, in index order. Observations without a legal action get
    /// none.
    pub fn raw_values(&self, observations: &[&Observation]) -> Result<Vec<Vec<(usize, f32)>>, ModelError> {
        let legal: Vec<Vec<usize>> = observations
            .iter()
            .map(|o| (0..o.legal.len()).filter(|&i| o.legal[i]).collect())
            .collect();
        let asked: Vec<usize> = (0..observations.len()).filter(|&i| !legal[i].is_empty()).collect();
        let mut out = vec![Vec::new(); observations.len()];
        if asked.is_empty() {
            return Ok(out);
        }
        let batch: Vec<&Observation> = asked.iter().map(|&i| observations[i]).collect();
        let k = asked.iter().map(|&i| legal[i].len()).max().unwrap_or(1);
        // Rows padded with their first legal action, whose value is dropped.
        let mut actions: Vec<i64> = Vec::with_capacity(asked.len() * k);
        for &i in &asked {
            let row = &legal[i];
            actions.extend((0..k).map(|j| *row.get(j).unwrap_or(&row[0]) as i64));
        }
        let mut inputs = observation_inputs(&self.spec, &batch)?;
        let actions = Tensor::from_shape(&[batch.len(), k], &actions).map_err(|e| error("actions", e))?;
        inputs.push(actions.into());
        let outputs = self.plan.run(inputs).map_err(|e| error("run", e))?;
        let values = outputs[0]
            .to_plain_array_view::<f32>()
            .map_err(|e| error("output", e))?;
        if values.len() != batch.len() * k {
            return Err(ModelError(format!(
                "{} values for {} observations of {k} actions",
                values.len(),
                batch.len()
            )));
        }
        let flat: Vec<f32> = values.iter().copied().collect();
        for (row, &i) in flat.chunks(k).zip(&asked) {
            out[i] = legal[i].iter().zip(row).map(|(&a, &v)| (a, v)).collect();
        }
        Ok(out)
    }

    /// [`QNet::raw_values`] in points: the payoff for the hand the network
    /// expects for the seat after each legal action.
    pub fn values(&self, observations: &[&Observation]) -> Result<Vec<Vec<(usize, f32)>>, ModelError> {
        let mut values = self.raw_values(observations)?;
        for (_, v) in values.iter_mut().flatten() {
            *v /= self.reward_scale;
        }
        Ok(values)
    }

    /// Runs the observations in `parity`, one at a time and all at once,
    /// and compares with the values recorded for them.
    pub fn check_parity(&self, parity: &QParity) -> Result<Agreement, ModelError> {
        let observations: Vec<&Observation> = parity.observations.iter().collect();
        let batched = self.raw_values(&observations)?;
        let mut max_abs_diff = 0f32;
        for (i, obs) in observations.iter().enumerate() {
            let single = self.raw_values(&[obs])?;
            for ours in [&single[0], &batched[i]] {
                let ours: Vec<f32> = ours.iter().map(|&(_, v)| v).collect();
                let diff = largest_difference(&ours, &parity.values[i])
                    .map_err(|e| ModelError(format!("observation {i}: {e}")))?;
                max_abs_diff = max_abs_diff.max(diff);
            }
        }
        Ok(Agreement {
            observations: observations.len(),
            max_abs_diff,
        })
    }
}

impl ActionValues for QNet {
    fn action_values(&self, observations: &[&Observation]) -> Result<Vec<Vec<(usize, f32)>>, BeliefError> {
        self.values(observations).map_err(|e| BeliefError(e.to_string()))
    }

    fn spec(&self) -> &Spec {
        &self.spec
    }
}

/// A bot that plays by a [`QNet`], for any game the network's encoding
/// fits: the legal action of highest value or, with a `temperature` (in
/// points), one drawn with probability proportional to `exp(value /
/// temperature)`: weaker, and less predictable.
#[derive(Debug, Clone)]
pub struct QBot {
    /// Shared by every seat and thread that plays by it.
    pub net: Arc<QNet>,
    /// 0 plays the best action.
    pub temperature: f32,
}

impl QBot {
    /// The index to play among `values` (`(index, value in points)`, not
    /// empty).
    fn pick(&self, values: &[(usize, f32)], rng: &mut dyn RngCore) -> usize {
        let best = values
            .iter()
            .copied()
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .expect("a decision has a legal action");
        if self.temperature <= 0.0 {
            return best.0;
        }
        let weights: Vec<f64> = values
            .iter()
            .map(|&(_, v)| f64::from((v - best.1) / self.temperature).exp())
            .collect();
        let mut draw = rng.random::<f64>() * weights.iter().sum::<f64>();
        for (&(index, _), w) in values.iter().zip(&weights) {
            if draw < *w {
                return index;
            }
            draw -= w;
        }
        best.0
    }
}

impl<G: Encode> Bot<G> for QBot {
    fn act(&mut self, view: &G::View, legal: &[G::Action], rng: &mut dyn RngCore) -> G::Action {
        let obs = G::encode(view, legal);
        let values = self
            .net
            .values(&[&obs])
            .unwrap_or_else(|e| panic!("the Q network failed: {e}"));
        let index = self.pick(&values[0], rng);
        G::action_from_index(view, legal, index).expect("the network picks among the legal actions")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    fn bot(temperature: f32) -> QBot {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/tiny-q");
        QBot {
            net: Arc::new(QNet::open(&dir).unwrap()),
            temperature,
        }
    }

    #[test]
    fn greedy_picks_the_best_and_temperature_spreads() {
        let values = [(3, 1.0), (7, 4.0), (9, 2.0)];
        let mut rng = ChaCha8Rng::seed_from_u64(0);
        assert_eq!(bot(0.0).pick(&values, &mut rng), 7);
        let warm = bot(5.0);
        let picks: Vec<usize> = (0..200).map(|_| warm.pick(&values, &mut rng)).collect();
        assert!([3, 7, 9].iter().all(|i| picks.contains(i)));
        let cold = bot(0.01);
        assert!((0..50).all(|_| cold.pick(&values, &mut rng) == 7));
    }
}
