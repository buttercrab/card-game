use clap::{Parser, ValueEnum};
use engine::{Bot, RandomBot};
use mighty::bot::SimpleBot;
use mighty::rules::Preset;
use mighty::{Mighty, Options};
use sim::Checks;
use std::process::ExitCode;

/// Play many Mighty games with bots, checking every invariant after each step.
#[derive(Parser)]
struct Args {
    /// House rules to play; all presets when omitted.
    #[arg(long)]
    preset: Option<Preset>,
    /// Games per preset.
    #[arg(long, default_value_t = 1000)]
    games: u64,
    #[arg(long, default_value_t = 0)]
    seed: u64,
    #[arg(long, value_enum, default_value_t = Bots::Mixed)]
    bots: Bots,
}

#[derive(Clone, Copy, ValueEnum)]
enum Bots {
    Random,
    Simple,
    /// Alternate simple and random bots around the table.
    Mixed,
}

fn table(bots: Bots, seats: usize) -> Vec<Box<dyn Bot<Mighty>>> {
    (0..seats)
        .map(|seat| -> Box<dyn Bot<Mighty>> {
            match (bots, seat % 2) {
                (Bots::Random, _) | (Bots::Mixed, 1) => Box::new(RandomBot),
                _ => Box::new(SimpleBot),
            }
        })
        .collect()
}

fn main() -> ExitCode {
    let args = Args::parse();
    let presets = args.preset.map_or(Preset::ALL.to_vec(), |p| vec![p]);
    for preset in presets {
        let rules = preset.rules();
        let seats = rules.players;
        let mut steps = 0;
        for game in 0..args.games {
            let seed = args.seed + game;
            let options = Options {
                rules: rules.clone(),
                first_bidder: (seed % seats as u64) as usize,
            };
            let mut bots = table(args.bots, seats);
            match sim::play::<Mighty>(&options, &mut bots, seed, Checks::default()) {
                Ok(report) => steps += report.steps,
                Err(failure) => {
                    eprintln!("{preset}: {failure}");
                    return ExitCode::FAILURE;
                }
            }
        }
        let per_game = steps as f64 / args.games as f64;
        println!("{preset:>8}: {} games ok, {per_game:.1} steps per game", args.games);
    }
    ExitCode::SUCCESS
}
