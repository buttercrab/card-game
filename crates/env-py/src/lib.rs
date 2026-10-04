//! The extension module `cardgame_env._core`: [`env::Env`] and the
//! self-play generator for Python. The typed, documented API is the
//! package around it, in `python/cardgame_env`.
//!
//! Every step hands Python fresh arrays that own the buffers the Rust
//! side filled (no copy), one per field, and runs without the GIL.

use env::selfplay::Config as SelfplayConfig;
use env::{Batch, BotPool, Config, Env, EnvGame, Error, RuleSampler, RuleSource, Setup, load_excluded};
use mighty::Mighty;
use numpy::{IntoPyArray, PyArrayMethods, PyReadonlyArray1};
use pyo3::exceptions::{PyOSError, PyValueError};
use pyo3::prelude::*;
use pyo3::types::PyDict;
use std::path::PathBuf;
use std::sync::Mutex;

fn py_err(e: Error) -> PyErr {
    match e {
        Error::Io(message) => PyOSError::new_err(message),
        e => PyValueError::new_err(e.to_string()),
    }
}

/// An environment of some game, without its types.
trait AnyEnv: Send {
    fn spec(&self) -> &engine::Spec;
    fn max_seats(&self) -> usize;
    fn reset(&mut self, seed: Option<u64>) -> Result<Batch, Error>;
    fn step(&mut self, actions: &[usize]) -> Result<Batch, Error>;
    fn belief_targets(&self) -> Result<Vec<i32>, Error>;
    /// Each slot's rules, as JSON.
    fn rules(&self) -> Vec<String>;
    fn hand_seeds(&self) -> Vec<u64>;
}

impl<G: EnvGame> AnyEnv for Env<G> {
    fn spec(&self) -> &engine::Spec {
        Env::spec(self)
    }

    fn max_seats(&self) -> usize {
        G::MAX_SEATS
    }

    fn reset(&mut self, seed: Option<u64>) -> Result<Batch, Error> {
        Env::reset(self, seed)
    }

    fn step(&mut self, actions: &[usize]) -> Result<Batch, Error> {
        Env::step(self, actions)
    }

    fn belief_targets(&self) -> Result<Vec<i32>, Error> {
        Env::belief_targets(self)
    }

    fn rules(&self) -> Vec<String> {
        self.hands()
            .map(|h| serde_json::to_string(h.rules()).expect("rules serialize"))
            .collect()
    }

    fn hand_seeds(&self) -> Vec<u64> {
        self.hands().map(|h| h.seed()).collect()
    }
}

/// What `Env(...)` was given, before the game is known.
struct Options {
    num_envs: usize,
    seed: u64,
    rules: String,
    exclude: Option<PathBuf>,
    controlled: Option<Vec<usize>>,
    bots: Vec<(String, f64)>,
    reward_scale: f32,
    threads: usize,
}

fn build<G: EnvGame>(o: Options) -> Result<Box<dyn AnyEnv>, Error> {
    let excluded = match &o.exclude {
        Some(path) => load_excluded(path)?,
        None => Vec::new(),
    };
    let mut controlled = vec![o.controlled.is_none(); G::MAX_SEATS];
    for seat in o.controlled.into_iter().flatten() {
        *controlled
            .get_mut(seat)
            .ok_or_else(|| Error::Config(format!("seat {seat}: at most {} seats", G::MAX_SEATS)))? = true;
    }
    let setup = Setup {
        rules: RuleSampler::new(RuleSource::parse::<G>(&o.rules)?, excluded)?,
        bots: BotPool::new::<G>(&o.bots)?,
        controlled,
    };
    let config = Config {
        num_envs: o.num_envs,
        seed: o.seed,
        reward_scale: o.reward_scale,
        threads: o.threads,
    };
    Ok(Box::new(Env::<G>::new(setup, config)?))
}

/// The batched environment; see `cardgame_env.Env`.
#[pyclass(module = "cardgame_env._core", name = "Env")]
struct PyEnv {
    // Steps run without the GIL; the lock keeps them one at a time.
    inner: Mutex<Box<dyn AnyEnv>>,
    spec: engine::Spec,
    max_seats: usize,
    num_envs: usize,
}

impl PyEnv {
    fn with<T>(&self, f: impl FnOnce(&mut dyn AnyEnv) -> T) -> T {
        f(self.inner.lock().expect("no step panicked").as_mut())
    }

    /// `batch` as numpy arrays that take over its buffers, shaped by the spec.
    fn arrays<'py>(&self, py: Python<'py>, batch: Batch) -> PyResult<Bound<'py, PyDict>> {
        let (spec, n) = (&self.spec, self.num_envs);
        let dict = PyDict::new(py);
        let cards = [n, spec.cards.len(), spec.card_features.len()];
        let events = [n, spec.max_events, spec.event_features.len()];
        dict.set_item("global", batch.global.into_pyarray(py).reshape([n, spec.global.len()])?)?;
        dict.set_item("cards", batch.cards.into_pyarray(py).reshape(cards)?)?;
        dict.set_item("events", batch.events.into_pyarray(py).reshape(events)?)?;
        dict.set_item(
            "event_cards",
            batch.event_cards.into_pyarray(py).reshape([n, spec.max_events])?,
        )?;
        dict.set_item("events_len", batch.events_len.into_pyarray(py))?;
        dict.set_item("legal", batch.legal.into_pyarray(py).reshape([n, spec.actions.len()])?)?;
        dict.set_item("seat", batch.seat.into_pyarray(py))?;
        dict.set_item("reward", batch.reward.into_pyarray(py).reshape([n, self.max_seats])?)?;
        dict.set_item("done", batch.done.into_pyarray(py))?;
        Ok(dict)
    }
}

#[pymethods]
impl PyEnv {
    #[new]
    #[pyo3(signature = (game, num_envs, seed, rules, exclude, controlled, bots, reward_scale, threads))]
    #[allow(clippy::too_many_arguments)]
    fn new(
        game: &str,
        num_envs: usize,
        seed: u64,
        rules: String,
        exclude: Option<PathBuf>,
        controlled: Option<Vec<usize>>,
        bots: Vec<(String, f64)>,
        reward_scale: f32,
        threads: usize,
    ) -> PyResult<PyEnv> {
        let options = Options {
            num_envs,
            seed,
            rules,
            exclude,
            controlled,
            bots,
            reward_scale,
            threads,
        };
        let inner = match game {
            <Mighty as engine::JsonGame>::ID => build::<Mighty>(options),
            _ => Err(Error::Config(format!("unknown game {game:?}"))),
        }
        .map_err(py_err)?;
        Ok(PyEnv {
            spec: inner.spec().clone(),
            max_seats: inner.max_seats(),
            num_envs,
            inner: Mutex::new(inner),
        })
    }

    /// The encoding spec, as JSON.
    fn spec(&self) -> String {
        serde_json::to_string(&self.spec).expect("specs serialize")
    }

    #[getter]
    fn num_envs(&self) -> usize {
        self.num_envs
    }

    #[getter]
    fn max_seats(&self) -> usize {
        self.max_seats
    }

    #[pyo3(signature = (seed=None))]
    fn reset<'py>(&self, py: Python<'py>, seed: Option<u64>) -> PyResult<Bound<'py, PyDict>> {
        let batch = py.detach(|| self.with(|e| e.reset(seed))).map_err(py_err)?;
        self.arrays(py, batch)
    }

    fn step<'py>(&self, py: Python<'py>, actions: PyReadonlyArray1<'py, i64>) -> PyResult<Bound<'py, PyDict>> {
        let actions = actions
            .as_slice()?
            .iter()
            .map(|&a| usize::try_from(a).map_err(|_| PyValueError::new_err(format!("action {a} is negative"))))
            .collect::<PyResult<Vec<usize>>>()?;
        let batch = py.detach(|| self.with(|e| e.step(&actions))).map_err(py_err)?;
        self.arrays(py, batch)
    }

    fn belief_targets<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyAny>> {
        let targets = self.with(|e| e.belief_targets()).map_err(py_err)?;
        let shape = [self.num_envs, self.spec.cards.len()];
        Ok(targets.into_pyarray(py).reshape(shape)?.into_any())
    }

    fn rules(&self) -> Vec<String> {
        self.with(|e| e.rules())
    }

    fn hand_seeds(&self) -> Vec<u64> {
        self.with(|e| e.hand_seeds())
    }
}

/// Writes a self-play dataset into `out` from a TOML config; returns its
/// statistics as JSON. See `cardgame_env.selfplay`.
#[pyfunction]
fn selfplay(py: Python<'_>, config: &str, root: PathBuf, out: PathBuf, threads: usize) -> PyResult<String> {
    let config = SelfplayConfig::from_toml(config).map_err(py_err)?;
    let dataset = py
        .detach(|| match config.game.as_str() {
            <Mighty as engine::JsonGame>::ID => env::selfplay::run::<Mighty>(&config, &root, &out, threads, |_| {}),
            game => Err(Error::Config(format!("unknown game {game:?}"))),
        })
        .map_err(py_err)?;
    Ok(serde_json::to_string(&dataset.stats).expect("stats serialize"))
}

#[pymodule]
fn _core(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyEnv>()?;
    m.add_function(wrap_pyfunction!(selfplay, m)?)?;
    Ok(())
}
