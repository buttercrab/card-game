//! Checks an exported model from Rust:
//!
//! ```sh
//! cargo run --release -p infer -- check ~/card-game-artifacts/models/<run>
//! ```
//!
//! runs `parity.json`'s observations through `model.onnx`, one at a time
//! and all at once, and compares the logits with PyTorch's; then times one
//! observation at a time on one thread, as a search calls it.

use clap::{Parser, Subcommand};
use infer::{BeliefNet, Parity};
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

fn check(dir: &Path, reps: usize) -> Result<bool, String> {
    let net = BeliefNet::open(dir).map_err(|e| e.to_string())?;
    let parity = Parity::load(&dir.join("parity.json")).map_err(|e| e.to_string())?;
    let agreement = net.check_parity(&parity).map_err(|e| e.to_string())?;
    let ok = agreement.max_abs_diff <= parity.tolerance;
    println!(
        "parity: {} observations, logits within {:.2e} of PyTorch's (tolerance {:.0e}): {}",
        agreement.observations,
        agreement.max_abs_diff,
        parity.tolerance,
        if ok { "ok" } else { "FAILED" }
    );

    let mut times: Vec<f64> = Vec::new();
    for obs in &parity.observations {
        for _ in 0..reps {
            let started = Instant::now();
            net.run(&[obs]).map_err(|e| e.to_string())?;
            times.push(started.elapsed().as_secs_f64() * 1000.0);
        }
    }
    times.sort_by(f64::total_cmp);
    let at = |q: f64| times[((times.len() - 1) as f64 * q).round() as usize];
    let events: Vec<usize> = parity.observations.iter().map(|o| o.events_len).collect();
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
