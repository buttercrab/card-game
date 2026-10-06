//! Self-play data: bots play each other over sampled rule sets and every
//! decision is written down for training.
//!
//! A dataset is a directory of shards, `shard-00000.npz` and on, with
//! `meta.json` (the config, the spec, the bot styles, each shard's counts,
//! the excluded rule sets' file with its SHA-256, and the run's [`Stats`])
//! and `rules.jsonl.gz` (every rule set played,
//! one JSON line `{"id", "rules"}` each). Each shard is a NumPy archive
//! with one row per decision, whole games only, in game order:
//!
//! | Array | dtype | Shape | What |
//! | --- | --- | --- | --- |
//! | `global` | f32 | `[n, global]` | the observation, as the [`engine_ml::Spec`] lays it out |
//! | `cards` | f32 | `[n, cards, card_features]` | |
//! | `events` | f32 | `[rows, event_features]` | each decision's `events_len` rows, one after another (the zero padding is not stored) |
//! | `event_cards` | i16 | `[rows]` | likewise |
//! | `events_len` | u16 | `[n]` | |
//! | `legal` | bool | `[n, actions]` | the legal mask |
//! | `action` | i16 | `[n]` | the action taken, an index into the spec's actions |
//! | `seat` | u8 | `[n]` | the absolute seat that acted |
//! | `belief` | i8 | `[n, cards]` | where each card hidden from that seat was (an index into the spec's belief classes), -1 where it knew |
//! | `payoff` | i64 | `[n]` | the acting seat's payoff for the whole hand |
//! | `style` | u8 | `[n]` | the bot that acted, an index into `meta.json`'s `bots` |
//! | `game` | u64 | `[n]` | game number in the dataset |
//! | `decision` | u16 | `[n]` | decision number in the game |
//! | `seed` | u64 | `[n]` | the game's seed ([`crate::Hand`]) |
//! | `rules` | u64 | `[n]` | the first 64 bits of the rules id ([`rules_id`]) |
//!
//! Why `.npz`: NumPy alone reads it (no Arrow or Parquet dependency on
//! the training side), arrays load one at a time, and deflate shrinks the
//! mostly-zero, one-hot observations about fortyfold (some 20 KB a
//! decision to about 0.5 KB). The events are stored ragged because
//! padding them to the spec's 160 rows would triple the raw size. A shard
//! is loaded whole, so `shard_decisions` sizes it by memory: 200 000
//! decisions are about 4 GB of arrays, about 100 MB on disk.
//!
//! Game `g` uses the first seed of stream `g` of the dataset seed, the
//! same hand an [`crate::Env`] with that seed deals in slot `g` first, and
//! games are written in order whatever the thread count, so a dataset is
//! reproducible byte for byte from its config.

use crate::Error;
use crate::game::{EnvGame, RuleSampler, RuleSource, load_rule_sets, rules_id, rules_key};
use crate::hand::{BotPool, Decision, Hand, Setup, Status, stream};
use crate::npz::{Element, NpzWriter};
use engine_ml::{Observation, Spec};
use flate2::{Compression, GzBuilder};
use rand::RngCore;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

/// One bot style in the mix, with its share of the seats.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BotWeight {
    /// A bot spec, as [`EnvGame::parse_bot`] reads it.
    pub spec: String,
    pub weight: f64,
}

/// Everything a dataset depends on, read from a TOML file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// The dataset's name: its directory in the artifact store and its
    /// manifest's name.
    pub name: String,
    /// The game, by [`engine::GameInfo::ID`].
    pub game: String,
    pub seed: u64,
    pub games: u64,
    /// A rule source, as [`RuleSource::parse`] reads it, or `file:PATH`:
    /// a pool of rule sets from a JSON array file, relative to the
    /// repository root.
    pub rules: String,
    /// Rule sets never to play (a JSON array), relative to the repository
    /// root: the evals' held-out rule sets.
    pub exclude: Option<PathBuf>,
    /// Each seat of each game draws its bot from these, by weight.
    pub bots: Vec<BotWeight>,
    /// A shard closes after the game that takes it to this many decisions.
    pub shard_decisions: usize,
    /// Data to measure with, never to train on (games on the evals'
    /// held-out rule sets, say): `meta.json` says so, the manifest's kind
    /// is `eval`, and the training side refuses it.
    #[serde(default)]
    pub eval_only: bool,
}

impl Config {
    pub fn from_toml(text: &str) -> Result<Config, Error> {
        toml::from_str(text).map_err(|e| Error::Config(format!("self-play config: {e}")))
    }
}

/// Games handed to the workers at a time; results come back in order.
const CHUNK: u64 = 256;

/// One game's decisions, column by column.
#[derive(Debug, Default)]
struct Columns {
    global: Vec<f32>,
    cards: Vec<f32>,
    events: Vec<f32>,
    event_cards: Vec<i16>,
    events_len: Vec<u16>,
    legal: Vec<bool>,
    action: Vec<i16>,
    seat: Vec<u8>,
    belief: Vec<i8>,
    payoff: Vec<i64>,
    style: Vec<u8>,
    game: Vec<u64>,
    decision: Vec<u16>,
    seed: Vec<u64>,
    rules: Vec<u64>,
}

impl Columns {
    fn len(&self) -> usize {
        self.action.len()
    }

    fn push(&mut self, obs: Observation, event_width: usize) {
        self.global.extend_from_slice(&obs.global);
        self.cards.extend_from_slice(&obs.cards);
        self.events
            .extend_from_slice(&obs.events[..obs.events_len * event_width]);
        self.event_cards
            .extend(obs.event_cards[..obs.events_len].iter().map(|&c| c as i16));
        self.events_len.push(obs.events_len as u16);
        self.legal.extend_from_slice(&obs.legal);
    }

    /// Appends every column to the shard being written, in the order the
    /// module docs list them.
    fn spill(&self, spool: &mut Spool, spec: &Spec) -> std::io::Result<()> {
        spool.games += 1;
        spool.decisions += self.len();
        spool.put("global", &[spec.global.len()], &self.global)?;
        spool.put("cards", &[spec.cards.len(), spec.card_features.len()], &self.cards)?;
        spool.put("events", &[spec.event_features.len()], &self.events)?;
        spool.put("event_cards", &[], &self.event_cards)?;
        spool.put("events_len", &[], &self.events_len)?;
        spool.put("legal", &[spec.actions.len()], &self.legal)?;
        spool.put("action", &[], &self.action)?;
        spool.put("seat", &[], &self.seat)?;
        spool.put("belief", &[spec.cards.len()], &self.belief)?;
        spool.put("payoff", &[], &self.payoff)?;
        spool.put("style", &[], &self.style)?;
        spool.put("game", &[], &self.game)?;
        spool.put("decision", &[], &self.decision)?;
        spool.put("seed", &[], &self.seed)?;
        spool.put("rules", &[], &self.rules)
    }
}

/// One array of a shard being written, spooled raw to its own file.
struct Spooled {
    name: &'static str,
    descr: &'static str,
    /// The shape of one row; empty for one number a row.
    row: Vec<usize>,
    path: PathBuf,
    file: BufWriter<File>,
    values: usize,
}

/// A shard being written. Each array goes raw to its own file beside the
/// shard as games come in, and is deflated into the shard when it closes,
/// so memory stays small however large shards are.
struct Spool {
    dir: PathBuf,
    arrays: Vec<Spooled>,
    games: usize,
    decisions: usize,
}

impl Spool {
    fn new(dir: PathBuf) -> std::io::Result<Spool> {
        std::fs::create_dir(&dir)?;
        Ok(Spool {
            dir,
            arrays: Vec::new(),
            games: 0,
            decisions: 0,
        })
    }

    fn put<T: Element>(&mut self, name: &'static str, row: &[usize], values: &[T]) -> std::io::Result<()> {
        let i = match self.arrays.iter().position(|a| a.name == name) {
            Some(i) => i,
            None => {
                let path = self.dir.join(name);
                self.arrays.push(Spooled {
                    name,
                    descr: T::DESCR,
                    row: row.to_vec(),
                    file: BufWriter::new(File::create(&path)?),
                    path,
                    values: 0,
                });
                self.arrays.len() - 1
            }
        };
        let array = &mut self.arrays[i];
        debug_assert_eq!(array.descr, T::DESCR, "{name} keeps its type");
        let mut bytes = Vec::with_capacity(values.len() * 8);
        for &x in values {
            x.put(&mut bytes);
        }
        array.values += values.len();
        array.file.write_all(&bytes)
    }

    /// Writes the shard to `path` and removes the spooled files.
    fn finish(self, path: &Path) -> std::io::Result<()> {
        let mut npz = NpzWriter::create(path)?;
        for array in self.arrays {
            let file = array.file.into_inner().map_err(|e| e.into_error())?;
            drop(file);
            let width: usize = array.row.iter().product();
            let shape: Vec<usize> = std::iter::once(array.values / width.max(1)).chain(array.row).collect();
            npz.raw(array.name, array.descr, &shape, File::open(&array.path)?)?;
        }
        npz.finish()?;
        std::fs::remove_dir_all(&self.dir)
    }
}

/// One game played out and written down.
struct Game<R> {
    columns: Columns,
    rules: R,
    players: usize,
}

fn play<G: EnvGame>(setup: &Setup<G>, spec: &Spec, game: u64, seed: u64) -> Result<Game<G::Rules>, Error> {
    let mut hand = Hand::new(setup, seed)?;
    let key = rules_key(hand.rules());
    let event_width = spec.event_features.len();
    let mut c = Columns::default();
    let mut record = |d: Decision<'_, G>| {
        let index = G::action_index(d.view, d.action).expect("a seat's action has an index");
        c.push(G::encode(d.view, d.legal), event_width);
        c.action.push(index as i16);
        c.seat.push(d.seat as u8);
        c.belief
            .extend(G::belief_targets(d.state, d.seat).into_iter().map(|b| b as i8));
        c.style.push(d.style as u8);
        c.decision.push(c.decision.len() as u16);
    };
    let status = hand.advance(&mut record)?;
    assert_eq!(status, Status::Over, "bots play every seat");
    let payoffs = hand.payoffs().expect("a hand over has payoffs");
    let n = c.action.len();
    c.payoff = c.seat.iter().map(|&s| payoffs[usize::from(s)]).collect();
    c.game = vec![game; n];
    c.seed = vec![seed; n];
    c.rules = vec![key; n];
    Ok(Game {
        columns: c,
        rules: hand.rules().clone(),
        players: hand.seats(),
    })
}

/// What a run produced. Only what the config decides, so that
/// `meta.json`, which holds it, is reproducible too; the time a run took
/// is [`Dataset::seconds`].
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Stats {
    pub games: u64,
    pub decisions: u64,
    /// Bytes of shards on disk.
    pub bytes: u64,
    /// Distinct rule sets played.
    pub rule_sets: usize,
    /// Games by table size.
    pub players: BTreeMap<usize, u64>,
    /// Decisions by bot spec.
    pub decisions_by_bot: BTreeMap<String, u64>,
}

/// A shard the run wrote; its path is relative to the dataset.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Shard {
    pub path: String,
    pub games: usize,
    pub decisions: usize,
}

/// A finished dataset.
#[derive(Debug, Clone, PartialEq)]
pub struct Dataset {
    /// The encoding version of its observations.
    pub encoding: String,
    pub shards: Vec<Shard>,
    pub stats: Stats,
    /// How long playing and writing took.
    pub seconds: f64,
}

impl Dataset {
    /// Every file of the dataset, relative to its directory.
    pub fn files(&self) -> Vec<String> {
        self.shards
            .iter()
            .map(|s| s.path.clone())
            .chain(["meta.json".to_string(), RULES.to_string()])
            .collect()
    }
}

fn io(path: &Path) -> impl Fn(std::io::Error) -> Error + '_ {
    move |e| Error::Io(format!("{}: {e}", path.display()))
}

/// Plays `config.games` games of `G` on `threads` workers (0: one per
/// core) and writes the dataset into `out`, which must not exist yet.
/// `root` is where `config.exclude` is resolved (the repository).
/// `progress` hears the games done after each batch of games.
pub fn run<G: EnvGame>(
    config: &Config,
    root: &Path,
    out: &Path,
    threads: usize,
    progress: impl Fn(u64),
) -> Result<Dataset, Error> {
    if config.game != G::ID {
        return Err(Error::Config(format!("this runs {}, not {}", G::ID, config.game)));
    }
    if config.shard_decisions == 0 {
        return Err(Error::Config("shard_decisions must be at least 1".into()));
    }
    // The file may live outside this commit (the evals own it), so the
    // dataset records exactly which list it avoided.
    let (excluded, exclusion) = match &config.exclude {
        Some(path) => {
            let full = root.join(path);
            let excluded = load_rule_sets::<G::Rules>(&full)?;
            let bytes = std::fs::read(&full).map_err(io(&full))?;
            let sha256: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
            let record = json!({"path": path, "sha256": sha256, "rule_sets": excluded.len()});
            (excluded, record)
        }
        None => (Vec::new(), Value::Null),
    };
    let source = match config.rules.strip_prefix("file:") {
        Some(path) => RuleSource::Pool(load_rule_sets(&root.join(path))?),
        None => RuleSource::parse::<G>(&config.rules)?,
    };
    let bots: Vec<(String, f64)> = config.bots.iter().map(|b| (b.spec.clone(), b.weight)).collect();
    let setup = Setup::<G> {
        rules: RuleSampler::new(source, excluded)?,
        bots: BotPool::new::<G>(&bots)?,
        controlled: Vec::new(),
    };
    if setup.bots.names().len() > usize::from(u8::MAX) {
        return Err(Error::Config("at most 255 bot styles".into()));
    }
    let spec = {
        let mut rng = stream(config.seed, 0);
        let rules = setup.rules.draw::<G>(&mut rng)?;
        G::spec(&crate::game::draw_options::<G>(&rules, &mut rng)).map_err(|e| Error::Rules(e.to_string()))?
    };
    std::fs::create_dir(out).map_err(io(out))?;
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build()
        .map_err(|e| Error::Config(e.to_string()))?;

    let start = Instant::now();
    let mut rules: BTreeMap<String, G::Rules> = BTreeMap::new();
    let mut players: BTreeMap<usize, u64> = BTreeMap::new();
    let mut by_style = vec![0u64; setup.bots.names().len()];
    let mut shards: Vec<Shard> = Vec::new();
    let shard_name = |i: usize| format!("shard-{i:05}.npz");
    let new_spool = |i: usize| Spool::new(out.join(format!(".spool-{i:05}"))).map_err(io(out));
    let mut spool = new_spool(0)?;
    // Shards are compressed on their own thread while the next games play.
    let mut writing: Option<std::thread::JoinHandle<Result<(), Error>>> = None;
    let mut close = |spool: Spool, shards: &mut Vec<Shard>| -> Result<(), Error> {
        let name = shard_name(shards.len());
        shards.push(Shard {
            path: name.clone(),
            games: spool.games,
            decisions: spool.decisions,
        });
        if let Some(previous) = writing.take() {
            previous.join().expect("the shard writer does not panic")?;
        }
        let path = out.join(name);
        writing = Some(std::thread::spawn(move || spool.finish(&path).map_err(io(&path))));
        Ok(())
    };

    for first in (0..config.games).step_by(CHUNK as usize) {
        let games: Vec<u64> = (first..config.games.min(first + CHUNK)).collect();
        let played = pool.install(|| {
            games
                .par_iter()
                .map(|&game| play(&setup, &spec, game, stream(config.seed, game).next_u64()))
                .collect::<Result<Vec<_>, Error>>()
        })?;
        for game in played {
            rules.entry(rules_id(&game.rules)).or_insert(game.rules);
            *players.entry(game.players).or_default() += 1;
            for &style in &game.columns.style {
                by_style[usize::from(style)] += 1;
            }
            game.columns.spill(&mut spool, &spec).map_err(io(&spool.dir))?;
            if spool.decisions >= config.shard_decisions {
                let next = new_spool(shards.len() + 1)?;
                close(std::mem::replace(&mut spool, next), &mut shards)?;
            }
        }
        progress(*games.last().expect("a chunk has games") + 1);
    }
    if spool.decisions > 0 {
        close(spool, &mut shards)?;
    } else {
        std::fs::remove_dir_all(&spool.dir).map_err(io(&spool.dir))?;
    }
    if let Some(last) = writing.take() {
        last.join().expect("the shard writer does not panic")?;
    }

    let stats = Stats {
        games: config.games,
        decisions: shards.iter().map(|s| s.decisions as u64).sum(),
        bytes: shards
            .iter()
            .map(|s| std::fs::metadata(out.join(&s.path)).map(|m| m.len()))
            .sum::<std::io::Result<u64>>()
            .map_err(io(out))?,
        rule_sets: rules.len(),
        players,
        decisions_by_bot: setup.bots.names().iter().cloned().zip(by_style).collect(),
    };
    let meta = json!({
        "name": config.name,
        "game": G::ID,
        "encoding": spec.version,
        "config": config,
        "eval_only": config.eval_only,
        "bots": setup.bots.names(),
        "shards": shards,
        "rules": RULES,
        "excluded": exclusion,
        "stats": stats,
        "spec": spec,
    });
    write_json(&out.join("meta.json"), &meta)?;
    write_rules(&out.join(RULES), &rules)?;
    Ok(Dataset {
        encoding: spec.version,
        shards,
        stats,
        seconds: start.elapsed().as_secs_f64(),
    })
}

/// Where a manifest's facts come from besides the dataset.
#[derive(Debug, Clone)]
pub struct Provenance {
    /// The commit that produced it, in full.
    pub commit: String,
    /// The config's path in the repository.
    pub config: String,
    /// `YYYY-MM-DD`.
    pub created: String,
}

/// The manifest of `dataset`, stored at `dir` under `prefix` in the
/// artifact store: `research/manifests/README.md` has the schema. Reads
/// every file to hash it.
pub fn manifest(
    config: &Config,
    dataset: &Dataset,
    dir: &Path,
    prefix: &str,
    provenance: &Provenance,
) -> Result<Value, Error> {
    let artifacts = dataset
        .files()
        .into_iter()
        .map(|file| {
            let path = dir.join(&file);
            let mut hasher = Sha256::new();
            let bytes =
                std::io::copy(&mut std::fs::File::open(&path).map_err(io(&path))?, &mut hasher).map_err(io(&path))?;
            let sha256: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
            Ok(json!({"path": format!("{prefix}/{file}"), "bytes": bytes, "sha256": sha256}))
        })
        .collect::<Result<Vec<Value>, Error>>()?;
    Ok(json!({
        "name": config.name,
        "kind": if config.eval_only { "eval" } else { "self-play" },
        "created": provenance.created,
        "commit": provenance.commit,
        "config": provenance.config,
        "seeds": [config.seed],
        "encoding": dataset.encoding,
        "artifacts": artifacts,
    }))
}

/// The file of every rule set played, by id.
const RULES: &str = "rules.jsonl.gz";

/// One line per rule set, `{"id": ..., "rules": ...}`, gzipped: thousands
/// of varied rule sets are megabytes of JSON, nearly all repeated.
fn write_rules<R: Serialize>(path: &Path, rules: &BTreeMap<String, R>) -> Result<(), Error> {
    let file = File::create(path).map_err(io(path))?;
    // No time stamp, so the bytes depend only on the rules.
    let mut gz = GzBuilder::new()
        .mtime(0)
        .write(BufWriter::new(file), Compression::default());
    for (id, rules) in rules {
        let line = serde_json::to_string(&json!({"id": id, "rules": rules})).expect("rules serialize");
        writeln!(gz, "{line}").map_err(io(path))?;
    }
    gz.finish().and_then(|mut w| w.flush()).map_err(io(path))
}

/// Writes `value` as pretty JSON with a final newline.
pub fn write_json(path: &Path, value: &Value) -> Result<(), Error> {
    let text = serde_json::to_string_pretty(value).expect("JSON values serialize") + "\n";
    std::fs::write(path, text).map_err(io(path))
}
