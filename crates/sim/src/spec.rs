//! Bots named on the command line and in eval suites: `random`, `simple`
//! or `search[:SAMPLES[:CONFIDENCE[:BUDGET_MS]]]`, with `@name=value,...`
//! settings, the table's levels `easy`, `normal` and `hard`,
//! `belief:MODEL_DIR:SAMPLES`: `hard` at that many samples, dealing by a
//! belief model (needs the `belief` feature), and
//! `dmc:MODEL_DIR[:TEMPERATURE]`: playing by a Q network, and
//! `hybrid:MODEL_DIR:SAMPLES`: `hard` leaning on one (both need the `dmc`
//! feature). See `sim --help`.

use engine::{Bot, RandomBot, Seat};
use mighty::Mighty;
use mighty::bot::{Clumsy, Level, SimpleBot};
use mighty::search::{Reading, Sampler, SearchBot};
use std::str::FromStr;
use std::time::Duration;

/// A bot by name, built afresh for each seat it fills.
#[derive(Clone, Copy, Debug)]
pub struct Spec {
    pub kind: Kind,
    /// Bid a little bolder or more carefully by seat, as the server's
    /// bots do ([`TEMPER`]); set for the table's levels.
    pub temper: bool,
}

#[derive(Clone, Copy, Debug)]
pub enum Kind {
    Random,
    Simple(SimpleBot),
    /// The simple bot, slipping to a random cheap card this often
    /// ([`Clumsy`]); the table's 초보 also bids more carefully.
    Clumsy(SimpleBot, f64),
    Search(SearchBot),
    /// A Q network's choice (`dmc:MODEL_DIR[:TEMPERATURE]`).
    #[cfg(feature = "dmc")]
    Dmc(infer::QBot),
    /// The search with a Q network (`hybrid:MODEL_DIR:SAMPLES@...`);
    /// leaked, as its network is, to keep specs small and `Copy`.
    #[cfg(feature = "dmc")]
    Hybrid(&'static mighty::hybrid::HybridBot),
}

pub use mighty::bot::{EASY_SLIPS, TEMPER};

impl FromStr for Spec {
    type Err = String;

    fn from_str(s: &str) -> Result<Spec, String> {
        let (name, settings) = s.split_once('@').unwrap_or((s, ""));
        if let Some(rest) = name.strip_prefix("belief:") {
            return belief(rest, settings);
        }
        if let Some(rest) = name.strip_prefix("dmc:") {
            let (dir, temperature) = dmc(rest, settings)?;
            return load_dmc(dir, temperature);
        }
        if let Some(rest) = name.strip_prefix("hybrid:") {
            return hybrid(rest, settings);
        }
        // The table's levels (`hard` or `고수`), as mighty::bot::Level
        // defines them: 고수 without a clock, so runs reproduce.
        let level = name.parse::<Level>().ok();
        let mut policy = level.map_or_else(SimpleBot::default, Level::policy);
        let mut slips = level.and_then(Level::slips);
        let base_search = level.and_then(Level::search).unwrap_or_default();
        let temper = level.is_some();
        let which = match (level, name) {
            (Some(level), _) if level.search().is_some() => Which::Search,
            (Some(_), _) => Which::Simple,
            (None, "random") => Which::Random,
            (None, "simple") => Which::Simple,
            (None, _) if name == "search" || name.starts_with("search:") => Which::Search,
            _ => return Err(format!("unknown bot {s:?}")),
        };
        if which == Which::Random && !settings.is_empty() {
            return Err(format!("{s}: the random bot takes no settings"));
        }
        let search = which == Which::Search;
        let mut reading = Reading::default();
        let mut search_threads = 1;
        let mut endgame = 0;
        for setting in settings.split(',').filter(|w| !w.is_empty()) {
            let (key, value) = setting
                .split_once('=')
                .ok_or(format!("{s}: setting {setting:?} needs a value, as name=value"))?;
            match key.strip_prefix("read.") {
                Some(key) if search => set_reading(&mut reading, key, value)?,
                None if key == "threads" && search => {
                    search_threads = value.parse().map_err(|_| format!("bad value {value:?} for threads"))?;
                }
                None if key == "endgame" && search => {
                    endgame = value.parse().map_err(|_| format!("bad value {value:?} for endgame"))?;
                }
                None if key == "slips" && which == Which::Simple => {
                    slips = Some(value.parse().map_err(|_| format!("bad value {value:?} for slips"))?);
                }
                None if set_weight(&mut policy, key, value)? => {}
                _ => return Err(format!("{s}: {}", which.unknown(key))),
            }
        }
        let kind = match which {
            Which::Random => Kind::Random,
            Which::Simple => match slips {
                Some(slips) => Kind::Clumsy(policy, slips),
                None => Kind::Simple(policy),
            },
            Which::Search => {
                let mut bot = SearchBot {
                    policy,
                    reading,
                    threads: search_threads,
                    endgame,
                    ..base_search
                };
                let mut parts = name.split(':').skip(1);
                if let Some(samples) = parts.next() {
                    bot.samples = samples.parse().map_err(|_| format!("bad sample count in {s:?}"))?;
                }
                if let Some(confidence) = parts.next() {
                    bot.confidence = confidence.parse().map_err(|_| format!("bad confidence in {s:?}"))?;
                }
                if let Some(budget) = parts.next() {
                    let ms: u64 = budget.parse().map_err(|_| format!("bad budget in {s:?}"))?;
                    bot.budget = (ms > 0).then(|| Duration::from_millis(ms));
                }
                let extra: Vec<&str> = parts.collect();
                if !extra.is_empty() {
                    return Err(format!(
                        "{s}: a search bot is search[:SAMPLES[:CONFIDENCE[:BUDGET_MS]]]; {:?} is extra",
                        extra.join(":")
                    ));
                }
                Kind::Search(bot)
            }
        };
        Ok(Spec { kind, temper })
    }
}

/// The built-in bots by name, for which settings each takes.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Which {
    Random,
    Simple,
    Search,
}

impl Which {
    /// The error for a setting this bot does not take, with those it does.
    fn unknown(self, key: &str) -> String {
        let (bot, takes) = match self {
            Which::Random => ("the random bot", "none"),
            Which::Simple => ("a simple bot", "the simple bot's weights and slips"),
            Which::Search => (
                "a search bot",
                "the simple bot's weights, threads, endgame and read.on, read.slip, read.bid_scale, \
                 read.min_share, read.draws",
            ),
        };
        format!("{bot} has no setting {key:?} (it takes {takes})")
    }
}

/// `belief:MODEL_DIR:SAMPLES@SETTINGS`: the table's 고수 (seat temper
/// included) at `SAMPLES` deals, dealing by the model in `MODEL_DIR`, and
/// not reading the table on top (`read.on=false`, unless the settings say
/// otherwise): the model's beliefs already rest on every bid and card
/// played, and weighing its deals by them again counts that evidence
/// twice (the `beliefs` example of `crates/infer` measures it).
fn belief(rest: &str, settings: &str) -> Result<Spec, String> {
    let (dir, mut spec) = belief_search(rest, settings)?;
    let Kind::Search(bot) = &mut spec.kind else {
        unreachable!("parsed as a search")
    };
    bot.sampler = load_belief(dir)?;
    Ok(spec)
}

/// A `belief:` spec's model directory, and the search it is but for the
/// model.
fn belief_search<'a>(rest: &'a str, settings: &str) -> Result<(&'a str, Spec), String> {
    let (dir, samples) = rest
        .rsplit_once(':')
        .ok_or(format!("belief:{rest}: expected belief:MODEL_DIR:SAMPLES"))?;
    let samples: usize = samples.parse().map_err(|_| format!("bad sample count {samples:?}"))?;
    let mut spec: Spec = format!("search:{samples}:1:0@read.on=false,{settings}").parse()?;
    spec.temper = true;
    Ok((dir, spec))
}

/// The belief model in directory `dir`, checked to read Mighty's encoding.
/// Loaded once per directory and kept for the life of the process.
#[cfg(feature = "belief")]
fn load_belief(dir: &str) -> Result<Sampler, String> {
    use std::collections::BTreeMap;
    use std::sync::{Mutex, PoisonError};
    static LOADED: Mutex<BTreeMap<String, &'static infer::BeliefNet>> = Mutex::new(BTreeMap::new());
    let mut loaded = LOADED.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(&net) = loaded.get(dir) {
        return Ok(Sampler::Belief(net));
    }
    let net = infer::BeliefNet::open(std::path::Path::new(dir)).map_err(|e| e.to_string())?;
    check_encoding(dir, net.spec())?;
    let net: &'static infer::BeliefNet = Box::leak(Box::new(net));
    loaded.insert(dir.to_string(), net);
    Ok(Sampler::Belief(net))
}

#[cfg(not(feature = "belief"))]
fn load_belief(dir: &str) -> Result<Sampler, String> {
    Err(format!(
        "{dir}: this build has no belief models (build with --features belief)"
    ))
}

/// `dmc:MODEL_DIR[:TEMPERATURE]`: plays by the Q network in `MODEL_DIR`
/// (an exported `cardgame_ml.train.dmc` run), the legal action of highest
/// value, or with a temperature in points drawn with probability
/// proportional to `exp(value / temperature)`. No search, no seat temper.
fn dmc<'a>(rest: &'a str, settings: &str) -> Result<(&'a str, f32), String> {
    if !settings.is_empty() {
        return Err(format!("dmc:{rest}@{settings}: a dmc bot takes no settings"));
    }
    let (dir, temperature) = match rest.rsplit_once(':') {
        // A directory may hold a colon; a temperature is a number.
        Some((dir, t)) if t.parse::<f32>().is_ok() => (dir, t.parse::<f32>().unwrap_or_default()),
        _ => (rest, 0.0),
    };
    if !(temperature >= 0.0 && temperature.is_finite()) {
        return Err(format!(
            "dmc:{rest}: the temperature must be a number of points, at least 0"
        ));
    }
    Ok((dir, temperature))
}

/// The Q network in directory `dir`, checked to read Mighty's encoding.
/// Loaded once per directory and kept for the life of the process.
#[cfg(feature = "dmc")]
fn load_q(dir: &str) -> Result<&'static infer::QNet, String> {
    use std::collections::BTreeMap;
    use std::sync::{Mutex, PoisonError};
    static LOADED: Mutex<BTreeMap<String, &'static infer::QNet>> = Mutex::new(BTreeMap::new());
    let mut loaded = LOADED.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(&net) = loaded.get(dir) {
        return Ok(net);
    }
    let net = infer::QNet::open(std::path::Path::new(dir)).map_err(|e| e.to_string())?;
    check_encoding(dir, net.spec())?;
    let net: &'static infer::QNet = Box::leak(Box::new(net));
    loaded.insert(dir.to_string(), net);
    Ok(net)
}

#[cfg(feature = "dmc")]
fn load_dmc(dir: &str, temperature: f32) -> Result<Spec, String> {
    Ok(Spec {
        kind: Kind::Dmc(infer::QBot {
            net: load_q(dir)?,
            temperature,
        }),
        temper: false,
    })
}

#[cfg(not(feature = "dmc"))]
fn load_dmc(dir: &str, _temperature: f32) -> Result<Spec, String> {
    Err(format!(
        "{dir}: this build has no Q networks (build with --features dmc)"
    ))
}

/// `hybrid:MODEL_DIR:SAMPLES@SETTINGS`: the table's 고수 (seat temper
/// included) at `SAMPLES` deals, leaning on the Q network in `MODEL_DIR`
/// ([`mighty::hybrid`]). Its own settings: `prior=K` weighs the `K` moves
/// the network values most instead of the search's candidates (0, the
/// default, keeps those), `base=q` makes the network's choice the one to
/// beat instead of the simple bot's (`base=simple`, the default), and
/// `leaf=K` values playouts by the network once `K` more tricks are done
/// instead of playing them out (`leaf=end`, the default). Any search
/// setting goes too (`read.*`, `threads`, `endgame`, weights).
fn hybrid(rest: &str, settings: &str) -> Result<Spec, String> {
    let h = hybrid_parts(rest, settings)?;
    load_hybrid(h.dir, h.search, h.prior, h.baseline, h.leaf)
}

/// A `hybrid:` spec but for its network.
struct Hybrid<'a> {
    dir: &'a str,
    search: SearchBot,
    prior: usize,
    baseline: mighty::hybrid::Baseline,
    leaf: Option<usize>,
}

fn hybrid_parts<'a>(rest: &'a str, settings: &str) -> Result<Hybrid<'a>, String> {
    use mighty::hybrid::Baseline;
    let (dir, samples) = rest
        .rsplit_once(':')
        .ok_or(format!("hybrid:{rest}: expected hybrid:MODEL_DIR:SAMPLES"))?;
    let samples: usize = samples.parse().map_err(|_| format!("bad sample count {samples:?}"))?;
    let (mut prior, mut baseline, mut leaf) = (0, Baseline::Simple, None);
    let mut search = Vec::new();
    for setting in settings.split(',').filter(|w| !w.is_empty()) {
        let (key, value) = setting.split_once('=').ok_or(format!("bad setting {setting:?}"))?;
        let bad = || format!("bad value {value:?} for {key}");
        match key {
            "prior" => prior = value.parse().map_err(|_| bad())?,
            "base" => {
                baseline = match value {
                    "simple" => Baseline::Simple,
                    "q" => Baseline::Network,
                    _ => return Err(bad()),
                }
            }
            "leaf" if value == "end" => leaf = None,
            "leaf" => leaf = Some(value.parse().map_err(|_| bad())?),
            _ => search.push(setting),
        }
    }
    let spec: Spec = format!("search:{samples}:1:0@{}", search.join(",")).parse()?;
    let Kind::Search(search) = spec.kind else {
        unreachable!("parsed as a search")
    };
    Ok(Hybrid {
        dir,
        search,
        prior,
        baseline,
        leaf,
    })
}

#[cfg(feature = "dmc")]
fn load_hybrid(
    dir: &str,
    search: SearchBot,
    prior: usize,
    baseline: mighty::hybrid::Baseline,
    leaf: Option<usize>,
) -> Result<Spec, String> {
    Ok(Spec {
        kind: Kind::Hybrid(Box::leak(Box::new(mighty::hybrid::HybridBot {
            search,
            values: load_q(dir)?,
            prior,
            baseline,
            leaf,
        }))),
        temper: true,
    })
}

#[cfg(not(feature = "dmc"))]
fn load_hybrid(
    dir: &str,
    _search: SearchBot,
    _prior: usize,
    _baseline: mighty::hybrid::Baseline,
    _leaf: Option<usize>,
) -> Result<Spec, String> {
    Err(format!(
        "{dir}: this build has no Q networks (build with --features dmc)"
    ))
}

/// Whether a model reads Mighty's encoding.
#[cfg(any(feature = "belief", feature = "dmc"))]
fn check_encoding(dir: &str, spec: &engine::Spec) -> Result<(), String> {
    let options = mighty::Options {
        rules: mighty::rules::Preset::Default.rules(),
        first_bidder: 0,
    };
    let ours = <Mighty as engine::Encode>::spec(&options).map_err(|e| e.to_string())?;
    if spec != &ours {
        return Err(format!("{dir}: the model reads {}, not {}", spec.version, ours.version));
    }
    Ok(())
}

/// What a bot spec is, read without loading any model: for tools that
/// must decide before a run (`eval check-bot`), on machines that may not
/// hold the model yet.
#[derive(Debug, Clone, PartialEq)]
pub struct Check {
    /// `random`, `simple`, `search`, `belief`, `dmc` or `hybrid`.
    pub kind: &'static str,
    /// Decides the same way in every run ([`Spec::reproducible`]).
    pub reproducible: bool,
    /// Why, in a few words.
    pub reason: String,
}

/// Checks the spec `s` as [`Spec::from_str`] reads it, but for loading the
/// model a `belief:`, `dmc:` or `hybrid:` bot names.
pub fn check(s: &str) -> Result<Check, String> {
    let (name, settings) = s.split_once('@').unwrap_or((s, ""));
    let fixed = |samples: usize| format!("a fixed {samples} samples a decision, on no clock");
    if let Some(rest) = name.strip_prefix("belief:") {
        let (_, spec) = belief_search(rest, settings)?;
        let Kind::Search(bot) = spec.kind else {
            unreachable!("parsed as a search")
        };
        return Ok(Check {
            kind: "belief",
            reproducible: true,
            reason: fixed(bot.samples),
        });
    }
    if let Some(rest) = name.strip_prefix("dmc:") {
        dmc(rest, settings)?;
        return Ok(Check {
            kind: "dmc",
            reproducible: true,
            reason: "plays by its network on no clock; a temperature draws from the seeded generator".into(),
        });
    }
    if let Some(rest) = name.strip_prefix("hybrid:") {
        let h = hybrid_parts(rest, settings)?;
        return Ok(Check {
            kind: "hybrid",
            reproducible: true,
            reason: fixed(h.search.samples),
        });
    }
    let spec: Spec = s.parse()?;
    let (kind, reason) = match spec.kind {
        Kind::Random => ("random", "no search, no clock".to_string()),
        Kind::Simple(_) | Kind::Clumsy(..) => ("simple", "rules, no search, no clock".to_string()),
        Kind::Search(bot) => (
            "search",
            match bot.budget {
                Some(budget) => format!(
                    "thinks on a clock: stops after {} ms a decision (a budget of 0 searches a fixed number of samples)",
                    budget.as_millis()
                ),
                None => fixed(bot.samples),
            },
        ),
        #[cfg(feature = "dmc")]
        Kind::Dmc(_) | Kind::Hybrid(_) => unreachable!("read above"),
    };
    Ok(Check {
        kind,
        reproducible: spec.reproducible(),
        reason,
    })
}

impl Spec {
    /// The bot for `seat`.
    pub fn build(self, seat: Seat) -> Box<dyn Bot<Mighty> + Send> {
        let temper = if self.temper { TEMPER[seat % TEMPER.len()] } else { 0.0 };
        let temper = |mut policy: SimpleBot| {
            policy.bid_base += temper;
            policy
        };
        match self.kind {
            Kind::Random => Box::new(RandomBot),
            Kind::Simple(bot) => Box::new(temper(bot)),
            Kind::Clumsy(bot, slips) => Box::new(Clumsy {
                inner: temper(bot),
                slips,
            }),
            Kind::Search(bot) => Box::new(SearchBot {
                policy: temper(bot.policy),
                ..bot
            }),
            #[cfg(feature = "dmc")]
            Kind::Dmc(bot) => Box::new(bot),
            #[cfg(feature = "dmc")]
            Kind::Hybrid(bot) => Box::new(mighty::hybrid::HybridBot {
                search: SearchBot {
                    policy: temper(bot.search.policy),
                    ..bot.search
                },
                ..*bot
            }),
        }
    }

    /// Whether the bot decides the same way in every run: true unless it
    /// stops thinking on a clock.
    pub fn reproducible(self) -> bool {
        match self.kind {
            Kind::Search(bot) => bot.budget.is_none(),
            Kind::Random | Kind::Simple(_) | Kind::Clumsy(..) => true,
            // Its temperature draws from the game's seeded generator.
            #[cfg(feature = "dmc")]
            Kind::Dmc(_) => true,
            // Its search deals a fixed number of worlds, on no clock.
            #[cfg(feature = "dmc")]
            Kind::Hybrid(_) => true,
        }
    }
}

/// Sets one of the simple bot's weights by name, for tuning from the
/// command line; false if it has no such weight.
fn set_weight(bot: &mut SimpleBot, key: &str, value: &str) -> Result<bool, String> {
    let bad = || format!("bad value {value:?} for {key}");
    let float = || value.parse::<f32>().map_err(|_| bad());
    let int = || value.parse::<i32>().map_err(|_| bad());
    let count = || value.parse::<usize>().map_err(|_| bad());
    match key {
        "bid_base" => bot.bid_base = float()?,
        "bid_trump" => bot.bid_trump = float()?,
        "bid_trump_honor" => bot.bid_trump_honor = float()?,
        "bid_mighty" => bot.bid_mighty = float()?,
        "bid_joker" => bot.bid_joker = float()?,
        "bid_sub_joker" => bot.bid_sub_joker = float()?,
        "bid_ace" => bot.bid_ace = float()?,
        "bid_king" => bot.bid_king = float()?,
        "change_trump" => bot.change_trump = float()?,
        "draw_trumps" => bot.draw_trumps = count()?,
        "late_tricks" => bot.late_tricks = count()?,
        "special_worth" => bot.special_worth = count()?,
        "lead_point_penalty" => bot.lead_point_penalty = int()?,
        "lead_joker" => bot.lead_joker = int()?,
        "lead_mighty" => bot.lead_mighty = int()?,
        "defend_trump" => bot.defend_trump = int()?,
        "plan_last_trick" => bot.plan_last_trick = value.parse().map_err(|_| bad())?,
        "aim_joker_call" => bot.aim_joker_call = value.parse().map_err(|_| bad())?,
        "spare_declarer_joker" => bot.spare_declarer_joker = value.parse().map_err(|_| bad())?,
        "misdeal_below_min" => bot.misdeal_below_min = value.parse().map_err(|_| bad())?,
        "bid_spread" => bot.bid_spread = float()?,
        "bid_caution" => bot.bid_caution = float()?,
        _ => return Ok(false),
    }
    Ok(true)
}

/// Sets how the search bot reads the other players, for tuning from the
/// command line: `read.on`, `read.slip`, `read.bid_scale`, `read.min_share`, `read.draws`.
fn set_reading(reading: &mut Reading, key: &str, value: &str) -> Result<(), String> {
    let bad = || format!("bad value {value:?} for read.{key}");
    let float = || value.parse::<f64>().map_err(|_| bad());
    match key {
        "on" => reading.on = value.parse().map_err(|_| bad())?,
        "slip" => reading.slip = float()?,
        "bid_scale" => reading.bid_scale = float()?,
        "min_share" => reading.min_share = float()?,
        "draws" => reading.draws = value.parse().map_err(|_| bad())?,
        _ => return Err(format!("unknown setting read.{key}")),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(s: &str) -> Spec {
        s.parse().unwrap_or_else(|e| panic!("{s}: {e}"))
    }

    #[test]
    fn levels_are_the_tables_bots() {
        assert!(matches!(spec("easy").kind, Kind::Clumsy(p, s) if s == EASY_SLIPS && p == Level::Easy.policy()));
        assert!(matches!(spec("normal").kind, Kind::Simple(_)));
        let Kind::Search(hard) = spec("hard").kind else {
            panic!("hard searches")
        };
        assert_eq!(Some(hard), Level::Hard.search());
        assert_eq!((hard.samples, hard.confidence, hard.budget), (200, 1.0, None));
        assert!(["easy", "normal", "hard", "고수"].iter().all(|s| spec(s).temper));
        assert!(!spec("search:200:1:0").temper);
    }

    /// A level by name plays as the level builds itself, seat by seat.
    #[test]
    fn levels_build_as_mighty_defines_them() {
        use engine::{Game, Turn, Viewer};
        use rand::SeedableRng;
        use rand::seq::IndexedRandom;
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(5);
        let rules = mighty::rules::Preset::Gshs.rules();
        let mut state = Mighty::new_game(&mighty::Options { rules, first_bidder: 0 }).unwrap();
        let mut asked = 0;
        loop {
            let action = match Mighty::turn(&state) {
                Turn::Over => break,
                Turn::Chance => Mighty::sample_chance(&state, &mut rng),
                Turn::Seat(seat) => {
                    let view = Mighty::view(&state, Viewer::Seat(seat));
                    let legal = Mighty::legal_actions(&state);
                    for level in [Level::Easy, Level::Normal] {
                        let ask = |mut bot: Box<dyn Bot<Mighty> + Send>| {
                            bot.act(&view, &legal, &mut rand_chacha::ChaCha8Rng::seed_from_u64(asked))
                        };
                        assert_eq!(ask(spec(level.name()).build(seat)), ask(level.build(seat, None)));
                    }
                    asked += 1;
                    legal.choose(&mut rng).unwrap().clone()
                }
            };
            Mighty::apply(&mut state, action).unwrap();
        }
        assert!(asked > 20);
    }

    #[test]
    fn settings_apply_to_levels_and_names() {
        let Kind::Search(bot) = spec("hard@threads=4,read.on=false").kind else {
            panic!("hard searches")
        };
        assert_eq!((bot.threads, bot.reading.on), (4, false));
        assert!(matches!(spec("simple@slips=0.5").kind, Kind::Clumsy(_, s) if s == 0.5));
        assert!(matches!(spec("easy@slips=0.1").kind, Kind::Clumsy(_, s) if s == 0.1));
        assert!("search@slips=0.5".parse::<Spec>().is_err());
        assert!("expert".parse::<Spec>().is_err());
    }

    fn error(s: &str) -> String {
        match s.parse::<Spec>() {
            Ok(spec) => panic!("{s} parsed, as {spec:?}"),
            Err(e) => e,
        }
    }

    /// Regression: a setting a bot never reads was taken silently (a
    /// weight on the random bot, `slips` on a search), and extra parts of
    /// a search were ignored.
    #[test]
    fn settings_a_bot_does_not_take_are_refused() {
        let e = error("random@bid_base=7");
        assert!(e.contains("the random bot takes no settings"), "{e}");
        for (s, key, bot) in [
            ("simple@threads=2", "threads", "a simple bot"),
            ("normal@read.on=false", "read.on", "a simple bot"),
            ("easy@endgame=3", "endgame", "a simple bot"),
            ("simple@nonsense=1", "nonsense", "a simple bot"),
            ("search@slips=0.5", "slips", "a search bot"),
            ("hard@bid_bse=7", "bid_bse", "a search bot"),
        ] {
            let e = error(s);
            assert!(e.contains(&format!("{bot} has no setting {key:?}")), "{s}: {e}");
        }
        let e = error("search@read.nonsense=1");
        assert!(e.contains("unknown setting read.nonsense"), "{e}");
        // Known settings still apply where they belong.
        assert!(matches!(spec("simple@bid_base=7").kind, Kind::Simple(b) if b.bid_base == 7.0));
        let Kind::Search(bot) = spec("search:20@bid_base=7,endgame=3").kind else {
            panic!("a search")
        };
        assert_eq!((bot.policy.bid_base, bot.endgame), (7.0, 3));
    }

    #[test]
    fn a_setting_needs_a_value() {
        let e = error("simple@bid_base");
        assert!(e.contains("setting \"bid_base\" needs a value"), "{e}");
        let e = error("hard@threads");
        assert!(e.contains("setting \"threads\" needs a value"), "{e}");
    }

    #[test]
    fn a_search_has_at_most_three_numbers() {
        let e = error("search:20:1:0:junk");
        assert!(e.contains("\"junk\" is extra"), "{e}");
        assert!(error("search:20:1:0:5:6").contains("\"5:6\" is extra"));
        let Kind::Search(bot) = spec("search:20:1:0").kind else {
            panic!("a search")
        };
        assert_eq!((bot.samples, bot.budget), (20, None));
        for bad in ["searchlight", "random:2", "simple:3", "hard:5"] {
            assert!(error(bad).contains("unknown bot"), "{bad}");
        }
    }

    /// `check` reads a spec as `parse` does: the same kind and the same
    /// verdict on the clock. Regression: the research loop's regex took
    /// `search` and `search:400`, which keep the default 1 s budget, as
    /// reproducible, and did not know `hybrid:`.
    #[test]
    fn checks_decide_reproducibility_from_the_parsed_spec() {
        for (s, kind, reproducible) in [
            ("random", "random", true),
            ("simple@bid_base=7", "simple", true),
            ("easy", "simple", true),
            ("normal", "simple", true),
            ("hard", "search", true),
            ("hard@threads=4", "search", true),
            ("search", "search", false),
            ("search:400", "search", false),
            ("search:400:1", "search", false),
            ("search:400:1:0", "search", true),
            ("search:400:0.9:0@threads=4,read.on=false", "search", true),
            ("search:200:1:150", "search", false),
            ("search:60000:1:2400@threads=12", "search", false),
        ] {
            let c = check(s).unwrap_or_else(|e| panic!("{s}: {e}"));
            assert_eq!((c.kind, c.reproducible), (kind, reproducible), "{s}: {}", c.reason);
            assert_eq!(c.reproducible, spec(s).reproducible(), "{s}");
        }
        assert!(check("search:400").unwrap().reason.contains("1000 ms"));
        // Errors are the parser's.
        assert!(check("random@bid_base=7").unwrap_err().contains("takes no settings"));
        assert!(check("search:20:1:0:junk").unwrap_err().contains("extra"));
    }

    /// Model bots are checked without their model, which may not be on
    /// this machine yet: the spec's own parts still are.
    #[test]
    fn model_bots_are_checked_without_loading_them() {
        for (s, kind) in [
            ("belief:/no/such/model:50", "belief"),
            ("belief:/no/such/model:50@read.on=true,threads=2", "belief"),
            ("dmc:{artifacts}/models/dmc-v1", "dmc"),
            ("dmc:/no/such/model:2.5", "dmc"),
            ("hybrid:/no/such/model:40", "hybrid"),
            ("hybrid:/no/such/model:40@prior=4,base=q,leaf=2,threads=2", "hybrid"),
        ] {
            let c = check(s).unwrap_or_else(|e| panic!("{s}: {e}"));
            assert_eq!((c.kind, c.reproducible), (kind, true), "{s}");
        }
        for bad in [
            "belief:/m",
            "belief:/m:many",
            "belief:/m:50@slips=1",
            "dmc:/m:-1",
            "dmc:/m@threads=2",
            "hybrid:/m",
            "hybrid:/m:40@base=best",
            "hybrid:/m:40@nonsense=1",
        ] {
            assert!(check(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn only_a_clock_makes_a_bot_irreproducible() {
        assert!(spec("hard").reproducible());
        assert!(spec("search:200:1:0@threads=4").reproducible());
        assert!(!spec("search").reproducible());
        assert!(!spec("search:60000:1:1280@threads=4").reproducible());
    }

    /// `belief:` is `hard` at its own sample count, dealing by the model.
    #[cfg(feature = "belief")]
    #[test]
    fn belief_bots_are_hard_dealing_by_a_model() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../infer/tests/tiny");
        let parsed = spec(&format!("belief:{dir}:50"));
        let Kind::Search(bot) = parsed.kind else {
            panic!("a belief bot searches")
        };
        assert!(parsed.temper && parsed.reproducible());
        assert_eq!((bot.samples, bot.confidence, bot.budget), (50, 1.0, None));
        assert!(!bot.reading.on);
        assert!(matches!(bot.sampler, Sampler::Belief(_)));
        // Loaded once: the same model for every spec naming it.
        let Kind::Search(again) = spec(&format!("belief:{dir}:10@read.on=true")).kind else {
            panic!("a belief bot searches")
        };
        assert_eq!(again.sampler, bot.sampler);
        assert!(again.reading.on);
        assert!("belief:/no/such/model:50".parse::<Spec>().is_err());
        assert!(format!("belief:{dir}").parse::<Spec>().is_err());
    }

    /// `dmc:` plays by a Q network, greedy unless given a temperature.
    #[cfg(feature = "dmc")]
    #[test]
    fn dmc_bots_play_by_a_q_network() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../infer/tests/tiny-q");
        let greedy = spec(&format!("dmc:{dir}"));
        let Kind::Dmc(bot) = greedy.kind else {
            panic!("a dmc bot")
        };
        assert_eq!(bot.temperature, 0.0);
        assert!(!greedy.temper && greedy.reproducible());
        let Kind::Dmc(warm) = spec(&format!("dmc:{dir}:2.5")).kind else {
            panic!("a dmc bot")
        };
        assert_eq!(warm.temperature, 2.5);
        assert!(std::ptr::eq(warm.net, bot.net), "loaded once");
        assert!(format!("dmc:{dir}:-1").parse::<Spec>().is_err());
        assert!(format!("dmc:{dir}@threads=2").parse::<Spec>().is_err());
        assert!("dmc:/no/such/model".parse::<Spec>().is_err());
        // The belief fixture is no Q network.
        let belief = concat!(env!("CARGO_MANIFEST_DIR"), "/../infer/tests/tiny");
        assert!(format!("dmc:{belief}").parse::<Spec>().is_err());
    }

    /// `hybrid:` is `hard` at its own sample count with a Q network, its
    /// settings split between the hybrid and the search.
    #[cfg(feature = "dmc")]
    #[test]
    fn hybrid_bots_are_hard_with_a_q_network() {
        use mighty::hybrid::Baseline;
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../infer/tests/tiny-q");
        let plain = spec(&format!("hybrid:{dir}:40"));
        let Kind::Hybrid(bot) = plain.kind else {
            panic!("a hybrid bot")
        };
        assert!(plain.temper && plain.reproducible());
        assert_eq!((bot.prior, bot.baseline, bot.leaf), (0, Baseline::Simple, None));
        assert_eq!(bot.search.samples, 40);
        assert_eq!(bot.search.budget, None);
        let Kind::Hybrid(tuned) = spec(&format!(
            "hybrid:{dir}:40@prior=4,base=q,leaf=2,threads=2,read.on=false"
        ))
        .kind
        else {
            panic!("a hybrid bot")
        };
        assert_eq!(
            (tuned.prior, tuned.baseline, tuned.leaf),
            (4, Baseline::Network, Some(2))
        );
        assert_eq!(tuned.search.threads, 2);
        assert!(!tuned.search.reading.on);
        assert!(std::ptr::addr_eq(tuned.values, bot.values), "loaded once");
        for bad in ["base=best", "leaf=soon", "prior=-1", "nonsense=1"] {
            assert!(format!("hybrid:{dir}:40@{bad}").parse::<Spec>().is_err(), "{bad}");
        }
        assert!(format!("hybrid:{dir}").parse::<Spec>().is_err());
        let belief = concat!(env!("CARGO_MANIFEST_DIR"), "/../infer/tests/tiny");
        assert!(format!("hybrid:{belief}:40").parse::<Spec>().is_err());
    }

    /// A hybrid plays whole hands, every setting on, with the tiny network.
    #[cfg(feature = "dmc")]
    #[test]
    fn hybrid_bots_play_hands() {
        use engine::{Game, Turn, Viewer};
        use mighty::{Mighty, Options, rules::Preset};
        use rand::SeedableRng;
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../infer/tests/tiny-q");
        let hybrid = spec(&format!("hybrid:{dir}:6@prior=3,base=q,leaf=1"));
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(3);
        let options = Options {
            rules: Preset::Gshs.rules(),
            first_bidder: 0,
        };
        let mut bots: Vec<_> = (0..5).map(|seat| hybrid.build(seat)).collect();
        let mut state = Mighty::new_game(&options).unwrap();
        loop {
            match Mighty::turn(&state) {
                Turn::Over => break,
                Turn::Chance => {
                    let deal = Mighty::sample_chance(&state, &mut rng);
                    Mighty::apply(&mut state, deal).unwrap();
                }
                Turn::Seat(seat) => {
                    let view = Mighty::view(&state, Viewer::Seat(seat));
                    let legal = Mighty::legal_actions(&state);
                    let action = bots[seat].act(&view, &legal, &mut rng);
                    assert!(legal.contains(&action));
                    Mighty::apply(&mut state, action).unwrap();
                }
            }
        }
        assert!(Mighty::payoffs(&state).is_some());
    }
}
