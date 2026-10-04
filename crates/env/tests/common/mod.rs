//! Helpers shared by the environment's tests.

use env::{Batch, BotPool, Config, Env, RuleSampler, RuleSource, Setup};
use mighty::Mighty;

/// Mighty with `rules` (as [`RuleSource::parse`] reads them), the caller
/// in `controlled` seats and `bots` in the rest.
pub fn setup(rules: &str, controlled: &[usize], bots: &[&str]) -> Setup<Mighty> {
    let mut seats = vec![false; mighty::encode::MAX_SEATS];
    for &seat in controlled {
        seats[seat] = true;
    }
    let bots: Vec<String> = bots.iter().map(|b| b.to_string()).collect();
    Setup {
        rules: RuleSampler::new(RuleSource::parse::<Mighty>(rules).unwrap(), Vec::new()).unwrap(),
        bots: BotPool::uniform::<Mighty>(&bots).unwrap(),
        controlled: seats,
    }
}

pub fn env(setup: Setup<Mighty>, num_envs: usize, seed: u64, threads: usize) -> Env<Mighty> {
    let config = Config {
        num_envs,
        seed,
        reward_scale: 1.0,
        threads,
    };
    Env::new(setup, config).unwrap()
}

/// Slot `slot`'s legal action indices in `batch`, ascending.
pub fn legal(batch: &Batch, actions: usize, slot: usize) -> Vec<usize> {
    let mask = &batch.legal[slot * actions..(slot + 1) * actions];
    (0..actions).filter(|&a| mask[a]).collect()
}

/// A choice anyone can repeat, the Python side included: of the legal
/// indices, ascending, the one at `(7 * step + slot) mod count`.
pub fn choose(batch: &Batch, actions: usize, step: usize) -> Vec<usize> {
    (0..batch.seat.len())
        .map(|slot| {
            let legal = legal(batch, actions, slot);
            legal[(7 * step + slot) % legal.len()]
        })
        .collect()
}
