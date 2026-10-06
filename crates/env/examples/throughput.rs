//! How fast the environment runs with random play in every seat, and
//! where the time goes:
//!
//! ```sh
//! cargo run --release -p env --example throughput -- [NUM_ENVS] [STEPS] [THREADS]
//! ```
//!
//! Reports decisions and finished hands per second over varied rules,
//! stepping into one reused batch and into a fresh batch each step (as
//! Python gets them), then the encoder's cost per observation on one
//! thread.

use engine::{Encode, Game, Turn, Viewer};
use env::{Batch, BotPool, Config, Env, RuleSampler, RuleSource, Setup};
use mighty::Mighty;
use rand::seq::IteratorRandom;
use rand::{RngCore, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::time::Instant;

/// Uniformly random legal actions for every slot of `batch`.
fn random(batch: &Batch, actions: usize, rng: &mut ChaCha8Rng) -> Vec<usize> {
    batch
        .legal
        .chunks(actions)
        .map(|legal| (0..actions).filter(|&a| legal[a]).choose(rng).expect("a legal action"))
        .collect()
}

/// Plays `steps` steps and prints the rates.
fn measure(env: &mut Env<Mighty>, steps: usize, fresh: bool) {
    let actions = env.spec().actions.len();
    let mut rng = ChaCha8Rng::seed_from_u64(0);
    let mut batch = env.reset(None).unwrap();
    let (mut hands, start) = (0, Instant::now());
    for _ in 0..steps {
        let chosen = random(&batch, actions, &mut rng);
        if fresh {
            batch = env.step(&chosen).unwrap();
        } else {
            env.step_into(&chosen, &mut batch).unwrap();
        }
        hands += batch.done.iter().filter(|&&d| d).count();
    }
    let secs = start.elapsed().as_secs_f64();
    println!(
        "{} envs, {steps} steps, {} batches: {:.0} decisions/s, {:.0} hands/s",
        env.num_envs(),
        if fresh { "fresh" } else { "reused" },
        (env.num_envs() * steps) as f64 / secs,
        hands as f64 / secs
    );
}

fn main() {
    let mut args = std::env::args().skip(1).map(|a| a.parse::<usize>().expect("a number"));
    let num_envs = args.next().unwrap_or(1024);
    let steps = args.next().unwrap_or(200);
    let threads = args.next().unwrap_or(0);

    let setup = Setup::<Mighty> {
        rules: RuleSampler::new(RuleSource::parse::<Mighty>("varied").unwrap(), Vec::new()).unwrap(),
        bots: BotPool::uniform::<Mighty>(&[]).unwrap(),
        controlled: vec![true; mighty::encode::MAX_SEATS],
    };
    let config = Config {
        num_envs,
        seed: 0,
        reward_scale: 1.0,
        threads,
    };
    let mut env = Env::new(setup, config).unwrap();
    measure(&mut env, steps, false);
    measure(&mut env, steps, true);

    // The encoder alone, on one thread, over positions of random games.
    let mut rng = ChaCha8Rng::seed_from_u64(0);
    let mut positions = Vec::new();
    while positions.len() < 20_000 {
        let rules = mighty::rules::Preset::ALL[positions.len() % 9].rules().varied(&mut rng);
        let first_bidder = (rng.next_u32() as usize) % rules.players;
        let mut state = Mighty::new_game(&mighty::Options { rules, first_bidder }).unwrap();
        loop {
            let action = match Mighty::turn(&state) {
                Turn::Over => break,
                Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                Turn::Seat(seat) => {
                    let legal = engine::legal_on_turn::<Mighty>(&state);
                    positions.push((Mighty::view(&state, Viewer::Seat(seat)), legal.clone()));
                    legal.into_iter().choose(&mut rng).unwrap()
                }
            };
            engine::apply_on_turn::<Mighty>(&mut state, action).unwrap();
        }
    }
    let start = Instant::now();
    for (view, legal) in &positions {
        std::hint::black_box(Mighty::encode(view, legal));
    }
    let per = start.elapsed().as_secs_f64() / positions.len() as f64;
    println!("encode: {:.1} µs an observation on one thread", per * 1e6);
}
