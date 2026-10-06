//! Experiments on where the bots lose points; see the `lab` crate.
//!
//! ```text
//! lab gen --deals 1000 --out hands.jsonl             # hands played by 고수 bots
//! lab play --records hands.jsonl --variant x10=search:2000:1:0 --variant cheat=cheat
//! lab bid --records hands.jsonl
//! lab exchange --records hands.jsonl --variant simple=bot:simple --variant joint=joint:400
//! lab declare --deals 400 --bot normal --field hard --out normal.jsonl
//! lab declare-report --run 보통=normal.jsonl --out report.md
//! ```
//!
//! Every subcommand writes one JSON line per result, as results come in.

use clap::{Parser, Subcommand};
use lab::declare::{self, DeclareResult};
use lab::exchange::{self, Exchanger};
use lab::signal::{self, SignalSetup};
use lab::{Actor, Record, audit, bid, play, record, regret};
use mighty::rules::{Preset, Rules};
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Parser)]
struct Args {
    #[arg(long, default_value = "gshs")]
    preset: Preset,
    /// A JSON file of rules to play instead of the preset.
    #[arg(long)]
    rules: Option<PathBuf>,
    /// Worker threads; all cores when omitted.
    #[arg(long)]
    threads: Option<usize>,
    /// Where to write results, one JSON line each.
    #[arg(long)]
    out: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Play and record hands, every seat the same bot.
    Gen {
        #[arg(long, default_value_t = 1000)]
        deals: u64,
        #[arg(long, default_value_t = 0)]
        start: u64,
        #[arg(long, default_value = "hard")]
        bot: String,
    },
    /// Replay the card play of recorded hands with another bot in one
    /// seat (seat = hand number mod 5, or every seat with --rotate).
    Play {
        #[arg(long)]
        records: PathBuf,
        /// The bot everywhere else; the recorded one.
        #[arg(long, default_value = "hard")]
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
        /// Replay the recorded hand up to this trick (1-based) and play
        /// only the rest, base and variant both.
        #[arg(long)]
        from_trick: Option<usize>,
    },
    /// Bidding: the declarer passing instead of its winning bid, the
    /// closest pass bidding instead, and what playouts thought of both.
    Bid {
        #[arg(long)]
        records: PathBuf,
        #[arg(long, default_value = "hard")]
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
    /// One seat's bidding and contracts: `bot` in one seat, `field` in
    /// the others, from the deal on.
    Declare {
        #[arg(long, default_value_t = 1000)]
        deals: u64,
        #[arg(long, default_value_t = 0)]
        start: u64,
        #[arg(long)]
        bot: String,
        #[arg(long, default_value = "hard")]
        field: String,
    },
    /// Every bidding decision of hands played by `bot` in every seat, with
    /// the seat's payoff and what the simple bot's reading, a Q network
    /// (`--net dmc:DIR`) and the search made of it (`sim::signal`).
    BidSignal {
        #[arg(long, default_value_t = 1000)]
        deals: u64,
        #[arg(long, default_value_t = 0)]
        start: u64,
        #[arg(long)]
        bot: String,
        /// A `dmc:MODEL_DIR` spec whose network values every decision.
        #[arg(long)]
        net: Option<String>,
        /// Deals per search value; 0 searches nothing.
        #[arg(long, default_value_t = 0)]
        worlds: usize,
        /// Search one decision in this many.
        #[arg(long, default_value_t = 1)]
        search_every: usize,
    },
    /// `declare` results side by side, as Markdown.
    DeclareReport {
        /// `name=results.jsonl`, one per run, in order.
        #[arg(long, required = true)]
        run: Vec<String>,
    },
    /// Replay the declarer's exchange another way, then the card play
    /// with the recorded bot.
    Exchange {
        #[arg(long)]
        records: PathBuf,
        #[arg(long, default_value = "hard")]
        play: String,
        /// `name=bot:SPEC` (a bot's exchange), `name=joint:WORLDS` (search
        /// whole discard sets and the call), `name=call:WORLDS` (the
        /// recorded discards, searched call) or `name=split:BOT/BOT` (one
        /// bot's discards, the other's call).
        #[arg(long, required = true)]
        variant: Vec<String>,
        #[arg(long)]
        limit: Option<usize>,
        #[arg(long, default_value_t = 0)]
        skip: usize,
    },
}

/// Why the lab could not start.
type Setup<T> = Result<T, String>;

fn load(path: &PathBuf, limit: Option<usize>) -> Setup<Vec<Record>> {
    let file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut records = Vec::new();
    for (n, line) in BufReader::new(file).lines().enumerate() {
        let line = line.map_err(|e| format!("{}: {e}", path.display()))?;
        records.push(serde_json::from_str(&line).map_err(|e| format!("{} line {}: {e}", path.display(), n + 1))?);
    }
    records.sort_by_key(|r: &Record| r.deal);
    records.truncate(limit.unwrap_or(usize::MAX));
    Ok(records)
}

/// Runs `job` on every item across `threads` workers, writing each result
/// as a JSON line as soon as it is done. An item whose experiment fails is
/// reported and skipped; the number of them is returned.
fn run<T: Sync, R: serde::Serialize>(
    items: &[T],
    threads: usize,
    out: &PathBuf,
    job: impl Fn(&T) -> lab::Result<Vec<R>> + Sync,
) -> Setup<usize> {
    let file = Mutex::new(File::create(out).map_err(|e| format!("{}: {e}", out.display()))?);
    let next = AtomicUsize::new(0);
    let failed = AtomicUsize::new(0);
    let started = Instant::now();
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(item) = items.get(i) else { return };
                    let results = match job(item) {
                        Ok(results) => results,
                        Err(e) => {
                            failed.fetch_add(1, Ordering::Relaxed);
                            eprintln!("{}/{}: {e}", i + 1, items.len());
                            continue;
                        }
                    };
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
    Ok(failed.into_inner())
}

fn named(variants: &[String]) -> Setup<Vec<(String, String)>> {
    variants
        .iter()
        .map(|v| {
            let (name, spec) = v.split_once('=').ok_or(format!("{v:?}: variants are name=spec"))?;
            Ok((name.to_string(), spec.to_string()))
        })
        .collect()
}

/// The Q network of a `dmc:MODEL_DIR` spec.
fn network(s: &str) -> Setup<Arc<dyn engine_ml::ActionValues>> {
    let spec: sim::spec::Spec = s.parse()?;
    match spec.kind {
        sim::spec::Kind::Dmc(bot) => Ok(bot.net),
        _ => Err("--net takes a dmc:MODEL_DIR spec".into()),
    }
}

fn actor(s: &str) -> Setup<Actor> {
    Actor::parse(s).map_err(|e| e.to_string())
}

fn exchanger(spec: &str) -> Setup<Exchanger> {
    let count = |n: &str| n.parse().map_err(|_| format!("{spec:?}: a world count"));
    Ok(if let Some(bot) = spec.strip_prefix("bot:") {
        Exchanger::Bot(actor(bot)?)
    } else if let Some(n) = spec.strip_prefix("joint:") {
        Exchanger::Joint { worlds: count(n)? }
    } else if let Some(pair) = spec.strip_prefix("split:") {
        let (discard, call) = pair
            .split_once('/')
            .ok_or(format!("{spec:?}: split:DISCARD_BOT/CALL_BOT"))?;
        Exchanger::Split {
            discard: actor(discard)?,
            call: actor(call)?,
        }
    } else if let Some(n) = spec.strip_prefix("call:") {
        Exchanger::CallOnly { worlds: count(n)? }
    } else {
        return Err(format!("unknown exchange variant {spec:?}"));
    })
}

fn main() -> ExitCode {
    match lab_main() {
        Ok(0) => ExitCode::SUCCESS,
        Ok(failed) => {
            eprintln!("lab: {failed} items failed");
            ExitCode::FAILURE
        }
        Err(e) => {
            eprintln!("lab: {e}");
            ExitCode::FAILURE
        }
    }
}

/// Runs the command; how many items failed.
fn lab_main() -> Setup<usize> {
    let args = Args::parse();
    let rules: Rules = match &args.rules {
        Some(path) => {
            let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
            serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?
        }
        None => args.preset.rules(),
    };
    rules.validate().map_err(|e| e.to_string())?;
    let threads = args
        .threads
        .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
    match &args.command {
        Command::Gen { deals, start, bot } => {
            let bot = actor(bot)?;
            let deals: Vec<u64> = (*start..start + deals).collect();
            run(&deals, threads, &args.out, |&deal| {
                Ok(vec![record::generate(&rules, deal, &bot)?])
            })
        }
        Command::Declare {
            deals,
            start,
            bot,
            field,
        } => {
            let (bot, field) = (actor(bot)?, actor(field)?);
            let deals: Vec<u64> = (*start..start + deals).collect();
            run(&deals, threads, &args.out, |&deal| {
                Ok(vec![declare::declare(&rules, deal, &bot, &field)?])
            })
        }
        Command::BidSignal {
            deals,
            start,
            bot,
            net,
            worlds,
            search_every,
        } => {
            let bot = actor(bot)?;
            let net = net.as_deref().map(network).transpose()?;
            let setup = SignalSetup {
                bot: &bot,
                net: net.as_deref(),
                worlds: *worlds,
                search_every: *search_every,
            };
            let deals: Vec<u64> = (*start..start + deals).collect();
            run(&deals, threads, &args.out, |&deal| {
                signal::bid_signal(&rules, deal, setup)
            })
        }
        Command::DeclareReport { run } => {
            let mut runs: Vec<(String, Vec<DeclareResult>)> = Vec::new();
            for (name, path) in named(run)? {
                let text = std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
                let mut results: Vec<DeclareResult> = text
                    .lines()
                    .map(serde_json::from_str)
                    .collect::<Result<_, _>>()
                    .map_err(|e| format!("{path}: {e}"))?;
                results.sort_by_key(|r| r.deal);
                runs.push((name, results));
            }
            std::fs::write(&args.out, declare::declare_report(&runs))
                .map_err(|e| format!("{}: {e}", args.out.display()))?;
            Ok(0)
        }
        Command::Play {
            records,
            base,
            variant,
            rotate,
            limit,
            skip,
            from_trick,
        } => {
            let mut records = load(records, *limit)?;
            records.drain(..(*skip).min(records.len()));
            let base = actor(base)?;
            let variants: Vec<(String, Actor)> = named(variant)?
                .into_iter()
                .map(|(n, s)| Ok((n, actor(&s)?)))
                .collect::<Setup<_>>()?;
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
                        out.push(match from_trick {
                            Some(t) => play::play_from(&rules, record, &base, seat, (name, v), t - 1)?,
                            None => play::play_variant(&rules, record, &base, seat, (name, v))?,
                        });
                    }
                }
                Ok(out)
            })
        }
        Command::Bid {
            records,
            bot,
            worlds,
            limit,
        } => {
            let records = load(records, *limit)?;
            let bot = actor(bot)?;
            run(&records, threads, &args.out, |record| {
                Ok(vec![bid::bid_experiment(&rules, record, &bot, *worlds)?])
            })
        }
        Command::Regret { records, endgame } => {
            let records = load(records, None)?;
            run(&records, threads, &args.out, |record| {
                Ok(vec![regret::regret(&rules, record, *endgame)?])
            })
        }
        Command::Audit { records } => {
            let records = load(records, None)?;
            run(&records, threads, &args.out, |record| {
                Ok(vec![audit::audit(&rules, record)?])
            })
        }
        Command::Exchange {
            records,
            play,
            variant,
            limit,
            skip,
        } => {
            let mut records = load(records, *limit)?;
            records.drain(..(*skip).min(records.len()));
            let play = actor(play)?;
            let variants: Vec<(String, Exchanger)> = named(variant)?
                .into_iter()
                .map(|(name, spec)| Ok((name, exchanger(&spec)?)))
                .collect::<Setup<_>>()?;
            run(&records, threads, &args.out, |record| {
                variants
                    .iter()
                    .map(|(name, how)| exchange::exchange_variant(&rules, record, &play, name, how))
                    .collect()
            })
        }
    }
}
