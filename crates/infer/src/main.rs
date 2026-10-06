//! Checks an exported model from Rust:
//!
//! ```sh
//! cargo run --release -p infer -- check ~/card-game-artifacts/models/<run>
//! ```
//!
//! runs `parity.json`'s observations through `model.onnx`, one at a time
//! and all at once, and compares the outputs with PyTorch's; then times
//! one observation at a time on one thread, as a bot calls it. A belief
//! model or a Q network, whichever the directory holds (a Q network's
//! `config.json` has a `reward_scale`).

use clap::{Parser, Subcommand};
use engine::Observation;
use infer::{Agreement, BeliefNet, Parity, QNet};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

#[derive(Parser)]
struct Args {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Parity with PyTorch, then latency.
    Check {
        /// A model directory: `config.json`, `model.onnx`, `parity.json`.
        dir: PathBuf,
        /// Timed runs of each observation.
        #[arg(long, default_value_t = 50)]
        reps: usize,
    },
}

/// A model of either kind, as far as checking it goes.
trait Checked {
    fn agreement(&self, dir: &Path) -> Result<(Agreement, f32, Vec<Observation>), String>;
    fn run_one(&self, obs: &Observation) -> Result<(), String>;
}

impl Checked for BeliefNet {
    fn agreement(&self, dir: &Path) -> Result<(Agreement, f32, Vec<Observation>), String> {
        let parity = Parity::load(&dir.join("parity.json")).map_err(|e| e.to_string())?;
        let agreement = self.check_parity(&parity).map_err(|e| e.to_string())?;
        Ok((agreement, parity.tolerance, parity.observations))
    }

    fn run_one(&self, obs: &Observation) -> Result<(), String> {
        self.run(&[obs]).map(|_| ()).map_err(|e| e.to_string())
    }
}

impl Checked for QNet {
    fn agreement(&self, dir: &Path) -> Result<(Agreement, f32, Vec<Observation>), String> {
        let parity = Parity::load(&dir.join("parity.json")).map_err(|e| e.to_string())?;
        let agreement = self.check_parity(&parity).map_err(|e| e.to_string())?;
        Ok((agreement, parity.tolerance, parity.observations))
    }

    fn run_one(&self, obs: &Observation) -> Result<(), String> {
        self.values(&[obs]).map(|_| ()).map_err(|e| e.to_string())
    }
}

fn open(dir: &Path) -> Result<Box<dyn Checked>, String> {
    let text = std::fs::read_to_string(dir.join("config.json")).map_err(|e| e.to_string())?;
    let config: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if config.get("reward_scale").is_some() {
        println!("a Q network");
        Ok(Box::new(QNet::open(dir).map_err(|e| e.to_string())?))
    } else {
        println!("a belief model");
        Ok(Box::new(BeliefNet::open(dir).map_err(|e| e.to_string())?))
    }
}

fn check(dir: &Path, reps: usize) -> Result<bool, String> {
    let net = open(dir)?;
    let (agreement, tolerance, observations) = net.agreement(dir)?;
    let ok = agreement.max_abs_diff <= tolerance;
    println!(
        "parity: {} observations, outputs within {:.2e} of PyTorch's (tolerance {:.0e}): {}",
        agreement.observations,
        agreement.max_abs_diff,
        tolerance,
        if ok { "ok" } else { "FAILED" }
    );

    let mut times: Vec<f64> = Vec::new();
    for obs in &observations {
        for _ in 0..reps {
            let started = Instant::now();
            net.run_one(obs)?;
            times.push(started.elapsed().as_secs_f64() * 1000.0);
        }
    }
    times.sort_by(f64::total_cmp);
    let at = |q: f64| times[((times.len() - 1) as f64 * q).round() as usize];
    let events: Vec<usize> = observations.iter().map(|o| o.events_len).collect();
    println!(
        "latency, one observation a call on one thread ({} calls, {}–{} events): median {:.2} ms, p99 {:.2} ms",
        times.len(),
        events.iter().min().unwrap_or(&0),
        events.iter().max().unwrap_or(&0),
        at(0.5),
        at(0.99),
    );
    Ok(ok)
}

fn main() -> ExitCode {
    let Command::Check { dir, reps } = Args::parse().command;
    match check(&dir, reps) {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(e) => {
            eprintln!("infer: {e}");
            ExitCode::FAILURE
        }
    }
}
