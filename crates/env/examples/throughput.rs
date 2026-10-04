//! How fast the environment runs with random play in every seat, and
//! where the time goes:
//!
//! ```sh
//! cargo run --release -p env --example throughput -- [NUM_ENVS] [STEPS] [THREADS]
//! ```
//!
//! Reports steps (decisions) and finished hands per second over varied
//! rules, then the encoder's cost per observation on one thread.

use engine::{Encode, Game, Turn, Viewer};
use env::{BotPool, Config, Env, RuleSampler, RuleSource, Setup};
use mighty::Mighty;
use rand::seq::IteratorRandom;
use rand::{RngCore, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::time::Instant;

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
    let actions = env.spec().actions.len();
    let mut rng = ChaCha8Rng::seed_from_u64(0);
    let mut batch = env.reset(Some(0)).unwrap();
    let mut chosen = vec![0; num_envs];
    let (mut hands, start) = (0, Instant::now());
    for _ in 0..steps {
        for (i, choice) in chosen.iter_mut().enumerate() {
            let legal = &batch.legal[i * actions..(i + 1) * actions];
            *choice = (0..actions)
                .filter(|&a| legal[a])
                .choose(&mut rng)
                .expect("a legal action");
        }
        env.step_into(&chosen, &mut batch).unwrap();
        hands += batch.done.iter().filter(|&&d| d).count();
    }
    let secs = start.elapsed().as_secs_f64();
    println!(
        "{num_envs} envs, {steps} steps: {:.0} decisions/s, {:.0} hands/s",
        (num_envs * steps) as f64 / secs,
        hands as f64 / secs
    );

    // The encoder alone, on one thread, over positions of random games.
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
                    let legal = Mighty::legal_actions(&state);
                    positions.push((Mighty::view(&state, Viewer::Seat(seat)), legal.clone()));
                    legal.into_iter().choose(&mut rng).unwrap()
                }
            };
            Mighty::apply(&mut state, action).unwrap();
        }
    }
    let start = Instant::now();
    for (view, legal) in &positions {
        std::hint::black_box(Mighty::encode(view, legal));
    }
    let per = start.elapsed().as_secs_f64() / positions.len() as f64;
    println!("encode: {:.1} µs an observation on one thread", per * 1e6);
}
