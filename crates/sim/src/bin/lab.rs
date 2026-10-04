//! Experiments on where the bots lose points; see `sim::lab`.
//!
//! ```text
//! lab gen --deals 1000 --out hands.jsonl             # hands played by 고수 bots
//! lab play --records hands.jsonl --variant x10=search:2000:1:0 --variant cheat=cheat
//! lab bid --records hands.jsonl
//! lab exchange --records hands.jsonl --variant simple=bot:simple --variant joint=joint:400
//! ```
//!
//! Every subcommand writes one JSON line per result, as results come in.

use clap::{Parser, Subcommand};
use mighty::rules::Preset;
use sim::lab::{self, Actor, Exchanger, Record};
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

#[derive(Parser)]
struct Args {
    #[arg(long, default_value = "gshs")]
    preset: Preset,
    /// Worker threads; all cores when omitted.
    #[arg(long)]
    threads: Option<usize>,
    /// Where to write results, one JSON line each.
    #[arg(long)]
    out: PathBuf,
    #[command(subcommand)]
    command: Command,
}

/// The production 고수 bot without its time limit, so runs reproduce.
const HARD: &str = "search:200:1:0";

#[derive(Subcommand)]
enum Command {
    /// Play and record hands, every seat the same bot.
    Gen {
        #[arg(long, default_value_t = 1000)]
        deals: u64,
        #[arg(long, default_value_t = 0)]
        start: u64,
        #[arg(long, default_value = HARD)]
        bot: String,
    },
    /// Replay the card play of recorded hands with another bot in one
    /// seat (seat = hand number mod 5, or every seat with --rotate).
    Play {
        #[arg(long)]
        records: PathBuf,
        /// The bot everywhere else; the recorded one.
        #[arg(long, default_value = HARD)]
        base: String,
        /// `name=bot`, where bot is a `sim` bot or `cheat`.
        #[arg(long, required = true)]
        variant: Vec<String>,
        #[arg(long)]
        rotate: bool,
        /// Only the first this many records.
        #[arg(long)]
        limit: Option<usize>,
        /// Skip this many records first.
        #[arg(long, default_value_t = 0)]
        skip: usize,
    },
    /// Bidding: the declarer passing instead of its winning bid, the
    /// closest pass bidding instead, and what playouts thought of both.
    Bid {
        #[arg(long)]
        records: PathBuf,
        #[arg(long, default_value = HARD)]
        bot: String,
        /// Deals sampled for the playout oracle.
        #[arg(long, default_value_t = 300)]
        worlds: usize,
        #[arg(long)]
        limit: Option<usize>,
    },
    /// Count plays that look wasteful in hindsight in recorded hands.
    Audit {
        #[arg(long)]
        records: PathBuf,
    },
    /// Hindsight regret of every card played in recorded hands.
    Regret {
        #[arg(long)]
        records: PathBuf,
        /// Tricks at the end solved exactly.
        #[arg(long, default_value_t = 4)]
        endgame: usize,
    },
    /// Replay the declarer's exchange another way, then the card play
    /// with the recorded bot.
    Exchange {
        #[arg(long)]
        records: PathBuf,
        #[arg(long, default_value = HARD)]
        play: String,
        /// `name=bot:SPEC` (a bot's exchange), `name=joint:WORLDS` (search
        /// whole discard sets and the call) or `name=call:WORLDS` (the
        /// recorded discards, searched call).
        #[arg(long, required = true)]
        variant: Vec<String>,
        #[arg(long)]
        limit: Option<usize>,
    },
}

fn load(path: &PathBuf, limit: Option<usize>) -> Vec<Record> {
    let file = File::open(path).expect("records file");
    let mut records: Vec<Record> = BufReader::new(file)
        .lines()
        .map(|l| serde_json::from_str(&l.expect("readable")).expect("a record"))
        .collect();
    records.sort_by_key(|r| r.deal);
    records.truncate(limit.unwrap_or(usize::MAX));
    records
}

/// Runs `job` on every item across `threads` workers, writing each result
/// as a JSON line as soon as it is done.
fn run<T: Sync, R: serde::Serialize>(items: &[T], threads: usize, out: &PathBuf, job: impl Fn(&T) -> Vec<R> + Sync) {
    let file = Mutex::new(File::create(out).expect("output file"));
    let next = AtomicUsize::new(0);
    let started = Instant::now();
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(item) = items.get(i) else { return };
                    let results = job(item);
                    let mut file = file.lock().expect("output");
                    for r in results {
                        writeln!(file, "{}", serde_json::to_string(&r).expect("serializable")).expect("write");
                    }
                    file.flush().expect("flush");
                    eprintln!("{}/{} ({:.0} s)", i + 1, items.len(), started.elapsed().as_secs_f64());
                }
            });
        }
    });
}

fn named(variants: &[String]) -> Vec<(String, String)> {
    variants
        .iter()
        .map(|v| {
            let (name, spec) = v.split_once('=').expect("variants are name=spec");
            (name.to_string(), spec.to_string())
        })
        .collect()
}

fn actor(s: &str) -> Actor {
    Actor::parse(s).unwrap_or_else(|e| panic!("{e}"))
}

fn main() {
    let args = Args::parse();
    let rules = args.preset.rules();
    let threads = args
        .threads
        .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
    match &args.command {
        Command::Gen { deals, start, bot } => {
            let bot = actor(bot);
            let deals: Vec<u64> = (*start..start + deals).collect();
            run(&deals, threads, &args.out, |&deal| {
                vec![lab::generate(&rules, deal, bot)]
            });
        }
        Command::Play {
            records,
            base,
            variant,
            rotate,
            limit,
            skip,
        } => {
            let mut records = load(records, *limit);
            records.drain(..(*skip).min(records.len()));
            let base = actor(base);
            let variants: Vec<(String, Actor)> = named(variant).into_iter().map(|(n, s)| (n, actor(&s))).collect();
            let seats = rules.players;
            run(&records, threads, &args.out, |record| {
                let focus: Vec<usize> = if *rotate {
                    (0..seats).collect()
                } else {
                    vec![(record.deal / seats as u64 % seats as u64) as usize]
                };
                let mut out = Vec::new();
                for &seat in &focus {
                    for (name, v) in &variants {
                        out.push(lab::play_variant(&rules, record, base, seat, (name, *v)));
                    }
                }
                out
            });
        }
        Command::Bid {
            records,
            bot,
            worlds,
            limit,
        } => {
            let records = load(records, *limit);
            let bot = actor(bot);
            run(&records, threads, &args.out, |record| {
                vec![lab::bid_experiment(&rules, record, bot, *worlds)]
            });
        }
        Command::Regret { records, endgame } => {
            let records = load(records, None);
            run(&records, threads, &args.out, |record| {
                vec![lab::regret(&rules, record, *endgame)]
            });
        }
        Command::Audit { records } => {
            let records = load(records, None);
            run(&records, threads, &args.out, |record| vec![lab::audit(&rules, record)]);
        }
        Command::Exchange {
            records,
            play,
            variant,
            limit,
        } => {
            let records = load(records, *limit);
            let play = actor(play);
            let variants: Vec<(String, Exchanger)> = named(variant)
                .into_iter()
                .map(|(name, spec)| {
                    let how = if let Some(bot) = spec.strip_prefix("bot:") {
                        Exchanger::Bot(actor(bot))
                    } else if let Some(n) = spec.strip_prefix("joint:") {
                        Exchanger::Joint {
                            worlds: n.parse().expect("world count"),
                        }
                    } else if let Some(n) = spec.strip_prefix("call:") {
                        Exchanger::CallOnly {
                            worlds: n.parse().expect("world count"),
                        }
                    } else {
                        panic!("unknown exchange variant {spec:?}");
                    };
                    (name, how)
                })
                .collect();
            run(&records, threads, &args.out, |record| {
                variants
                    .iter()
                    .map(|(name, how)| lab::exchange_variant(&rules, record, play, name, *how))
                    .collect()
            });
        }
    }
}
