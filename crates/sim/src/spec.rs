//! Bots named on the command line, in eval suites and in research
//! configs, all written `name[:positional][@key=value,...]` and read by one
//! tokenizer ([`Syntax`]), which prints them back as written:
//!
//! - `random`;
//! - `simple`, the rule-based bot, its weights settable by name
//!   (`simple@bid_base=7`) and `slips=P` to slip to a cheap card that
//!   often;
//! - `search[:SAMPLES[:CONFIDENCE[:BUDGET_MS]]]`, the search bot, which
//!   also takes `threads`, `endgame` and `read.*` (how it reads the other
//!   players);
//! - the table's levels `easy`, `normal` and `hard` (or `초보`, `보통`,
//!   `고수`), each bidding a little bolder or more carefully by seat as at
//!   the table; `hard` is the search without the table's clock;
//! - `belief:MODEL_DIR:SAMPLES`: `hard` at that many samples, dealing by
//!   a belief model;
//! - `dmc:MODEL_DIR[:TEMPERATURE]`: playing by a Q network;
//! - `hybrid:MODEL_DIR:SAMPLES`: `hard` leaning on a Q network, by
//!   `prior=K`, `base=q` and `leaf=K` besides the search's settings;
//! - `phased:BID+EXCHANGE+PLAY`: one bot per phase of the hand.
//!
//! Each kind declares the settings it takes ([`Spec::keys`]) and refuses
//! the rest. See `sim --help`.

use crate::phased::Phased;
use engine::{Bot, RandomBot, Seat};
use mighty::Mighty;
use mighty::bot::Level;
use mighty_ai::{Baseline, Clumsy, HybridBot, LevelBots, Reading, Sampler, SearchBot, SimpleBot};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::fmt;
use std::path::Path;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

pub use mighty_ai::{EASY_SLIPS, TEMPER};

/// A bot spec as written: a name, what follows its colon, and settings.
/// One tokenizer reads every kind; [`fmt::Display`] prints it back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Syntax {
    pub name: String,
    /// Everything between the name's colon and the settings, as written:
    /// numbers for a search, a model directory (which may hold colons of
    /// its own) and a number for a model bot, three bots for `phased`.
    pub positional: Option<String>,
    /// `key=value` pairs, in order.
    pub settings: Vec<(String, String)>,
}

impl FromStr for Syntax {
    type Err = String;

    fn from_str(s: &str) -> Result<Syntax, String> {
        // A phased bot's parts are bots, settings and all.
        if let Some(parts) = s.strip_prefix("phased:") {
            return Ok(Syntax {
                name: "phased".into(),
                positional: Some(parts.into()),
                settings: Vec::new(),
            });
        }
        let (head, settings) = s.split_once('@').unwrap_or((s, ""));
        let (name, positional) = match head.split_once(':') {
            Some((name, rest)) => (name, Some(rest.to_string())),
            None => (head, None),
        };
        let settings = settings
            .split(',')
            .filter(|w| !w.is_empty())
            .map(|setting| {
                let (key, value) = setting
                    .split_once('=')
                    .ok_or(format!("{s}: setting {setting:?} needs a value, as name=value"))?;
                Ok((key.to_string(), value.to_string()))
            })
            .collect::<Result<_, String>>()?;
        Ok(Syntax {
            name: name.into(),
            positional,
            settings,
        })
    }
}

impl fmt::Display for Syntax {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.name)?;
        if let Some(positional) = &self.positional {
            write!(f, ":{positional}")?;
        }
        for (i, (key, value)) in self.settings.iter().enumerate() {
            write!(f, "{}{key}={value}", if i == 0 { '@' } else { ',' })?;
        }
        Ok(())
    }
}

/// The kinds of bot, by the settings they take.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Which {
    Random,
    Simple,
    Search,
    Belief,
    Dmc,
    Hybrid,
    Phased,
}

impl Which {
    fn named(self) -> &'static str {
        match self {
            Which::Random => "the random bot",
            Which::Simple => "a simple bot",
            Which::Search => "a search bot",
            Which::Belief => "a belief bot",
            Which::Dmc => "a dmc bot",
            Which::Hybrid => "a hybrid bot",
            Which::Phased => "a phased bot",
        }
    }

    /// The settings it takes, by name.
    fn keys(self) -> Vec<String> {
        let fields = |value: serde_json::Value| -> Vec<String> {
            value.as_object().map_or_else(Vec::new, |o| o.keys().cloned().collect())
        };
        let weights = fields(serde_json::to_value(SimpleBot::default()).expect("weights serialize"));
        let reading = fields(serde_json::to_value(Reading::default()).expect("settings serialize"));
        let search = || {
            let mut keys = weights.clone();
            keys.extend(["threads", "endgame"].map(String::from));
            keys.extend(reading.iter().map(|k| format!("read.{k}")));
            keys
        };
        match self {
            Which::Random | Which::Dmc | Which::Phased => Vec::new(),
            Which::Simple => weights.iter().cloned().chain(["slips".to_string()]).collect(),
            Which::Search | Which::Belief => search(),
            Which::Hybrid => search()
                .into_iter()
                .chain(["prior", "base", "leaf"].map(String::from))
                .collect(),
        }
    }

    /// The error for a setting it does not take.
    fn refuses(self, s: &Syntax, key: &str) -> String {
        if self == Which::Random || self == Which::Dmc {
            return format!("{s}: {} takes no settings", self.named());
        }
        if let Some(read) = key.strip_prefix("read.")
            && self.keys().iter().any(|k| k.starts_with("read."))
        {
            return format!("{s}: unknown setting read.{read}");
        }
        let takes = self.keys();
        format!(
            "{s}: {} has no setting {key:?} (it takes {})",
            self.named(),
            if takes.is_empty() {
                "none".into()
            } else {
                takes.join(", ")
            }
        )
    }
}

/// A bot by name, built afresh for each seat it fills.
#[derive(Clone, Debug)]
pub struct Spec {
    /// As written, and printed back by [`fmt::Display`].
    pub syntax: Syntax,
    pub kind: Kind,
    /// Bid a little bolder or more carefully by seat, as the server's
    /// bots do ([`TEMPER`]); set for the table's levels and the bots
    /// built on 고수.
    pub temper: bool,
}

/// Two specs are the same bot when they are written the same way.
impl PartialEq for Spec {
    fn eq(&self, other: &Spec) -> bool {
        self.syntax == other.syntax
    }
}

impl fmt::Display for Spec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.syntax.fmt(f)
    }
}

#[derive(Clone, Debug)]
pub enum Kind {
    Random,
    Simple(SimpleBot),
    /// The simple bot, slipping to a random cheap card this often
    /// ([`Clumsy`]); the table's 초보 also bids more carefully.
    Clumsy(SimpleBot, f64),
    /// The search, `belief:` bots included (dealing by their model).
    Search(SearchBot),
    /// A Q network's choice (`dmc:MODEL_DIR[:TEMPERATURE]`).
    Dmc(infer::QBot),
    /// The search with a Q network (`hybrid:MODEL_DIR:SAMPLES@...`).
    Hybrid(Box<HybridBot>),
    /// One bot per phase of the hand (`phased:BID+EXCHANGE+PLAY`).
    Phased(Box<Phased>),
}

/// A spec read but for its model: what [`check`] judges, and what
/// [`Spec::from_str`] loads the model of.
enum Recipe {
    Ready(Kind),
    Belief { dir: String, search: SearchBot },
    Dmc { dir: String, temperature: f32 },
    Hybrid { dir: String, hybrid: Box<Hybrid> },
}

/// A hybrid's settings, its network aside.
struct Hybrid {
    search: SearchBot,
    prior: usize,
    baseline: Baseline,
    leaf: Option<usize>,
}

/// `value`, a number, or why not.
fn number<T: FromStr>(s: &Syntax, what: &str, value: &str) -> Result<T, String> {
    value.parse().map_err(|_| format!("bad {what} {value:?} in {s}"))
}

/// Reads `syntax` up to the model it names: positional parts and settings
/// checked against what its kind takes. The recipe and whether the bot
/// bids by seat.
fn recipe(syntax: &Syntax) -> Result<(Recipe, bool), String> {
    let s = syntax;
    let level = s.name.parse::<Level>().ok();
    let which = match (level, s.name.as_str()) {
        (Some(level), _) if level.search().is_some() => Which::Search,
        (Some(_), _) => Which::Simple,
        (None, "random") => Which::Random,
        (None, "simple") => Which::Simple,
        (None, "search") => Which::Search,
        (None, "belief") => Which::Belief,
        (None, "dmc") => Which::Dmc,
        (None, "hybrid") => Which::Hybrid,
        (None, "phased") => Which::Phased,
        _ => return Err(format!("unknown bot {:?}", s.to_string())),
    };
    let positional = s.positional.as_deref();
    let keys = which.keys();
    if let Some((key, _)) = s.settings.iter().find(|(key, _)| !keys.contains(key)) {
        return Err(which.refuses(s, key));
    }
    let setting = |key: &str| s.settings.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v.as_str());

    // The search a level or kind starts from, its settings applied.
    let search = |base: SearchBot| -> Result<SearchBot, String> {
        let mut bot = base;
        for (key, value) in &s.settings {
            match key.strip_prefix("read.") {
                Some(read) => {
                    set_field(&mut bot.reading, read, value)?;
                }
                None if key == "threads" => bot.threads = number(s, "thread count", value)?,
                None if key == "endgame" => bot.endgame = number(s, "endgame", value)?,
                None if ["prior", "base", "leaf"].contains(&key.as_str()) => {}
                None => {
                    set_field(&mut bot.policy, key, value)?;
                }
            }
        }
        Ok(bot)
    };
    let model_and_samples = |kind: &str| -> Result<(String, usize), String> {
        let rest = positional.unwrap_or_default();
        let (dir, samples) = rest
            .rsplit_once(':')
            .ok_or(format!("{s}: expected {kind}:MODEL_DIR:SAMPLES"))?;
        Ok((dir.to_string(), number(s, "sample count", samples)?))
    };
    let fixed = |samples: usize| SearchBot {
        samples,
        confidence: 1.0,
        budget: None,
        ..SearchBot::default()
    };
    let recipe = match which {
        Which::Random | Which::Simple if positional.is_some() => {
            return Err(format!("unknown bot {:?}", s.to_string()));
        }
        _ if level.is_some() && positional.is_some() => return Err(format!("unknown bot {:?}", s.to_string())),
        Which::Random => Recipe::Ready(Kind::Random),
        Which::Simple => {
            let mut policy = level.map_or_else(SimpleBot::default, LevelBots::policy);
            for (key, value) in s.settings.iter().filter(|(k, _)| k != "slips") {
                set_field(&mut policy, key, value)?;
            }
            let slips = match setting("slips") {
                Some(value) => Some(number(s, "slips", value)?),
                None => level.and_then(LevelBots::slips),
            };
            Recipe::Ready(match slips {
                Some(slips) => Kind::Clumsy(policy, slips),
                None => Kind::Simple(policy),
            })
        }
        Which::Search => {
            let mut bot = search(level.and_then(LevelBots::search).unwrap_or_default())?;
            let mut parts = positional.map(|p| p.split(':')).into_iter().flatten();
            if let Some(samples) = parts.next() {
                bot.samples = number(s, "sample count", samples)?;
            }
            if let Some(confidence) = parts.next() {
                bot.confidence = number(s, "confidence", confidence)?;
            }
            if let Some(budget) = parts.next() {
                let ms: u64 = number(s, "budget", budget)?;
                bot.budget = (ms > 0).then(|| Duration::from_millis(ms));
            }
            let extra: Vec<&str> = parts.collect();
            if !extra.is_empty() {
                return Err(format!(
                    "{s}: a search bot is search[:SAMPLES[:CONFIDENCE[:BUDGET_MS]]]; {:?} is extra",
                    extra.join(":")
                ));
            }
            Recipe::Ready(Kind::Search(bot))
        }
        // 고수 at its own sample count, dealing by the model and not
        // reading the table on top unless asked: the model's beliefs
        // already rest on every bid and card played, and weighing its
        // deals by them again counts that evidence twice (the `beliefs`
        // example of `crates/infer` measures it).
        Which::Belief => {
            let (dir, samples) = model_and_samples("belief")?;
            let mut base = fixed(samples);
            base.reading.on = false;
            Recipe::Belief {
                dir,
                search: search(base)?,
            }
        }
        Which::Dmc => {
            let rest = positional.ok_or(format!("{s}: expected dmc:MODEL_DIR[:TEMPERATURE]"))?;
            let (dir, temperature): (&str, f32) = match rest.rsplit_once(':') {
                // A directory may hold a colon; a temperature is a number.
                Some((dir, t)) if t.parse::<f32>().is_ok() => (dir, number(s, "temperature", t)?),
                _ => (rest, 0.0),
            };
            if !(temperature >= 0.0 && temperature.is_finite()) {
                return Err(format!("{s}: the temperature must be a number of points, at least 0"));
            }
            Recipe::Dmc {
                dir: dir.to_string(),
                temperature,
            }
        }
        Which::Hybrid => {
            let (dir, samples) = model_and_samples("hybrid")?;
            let bad = |key: &str, value: &str| format!("{s}: bad value {value:?} for {key}");
            let prior = match setting("prior") {
                Some(v) => v.parse().map_err(|_| bad("prior", v))?,
                None => 0,
            };
            let baseline = match setting("base") {
                None | Some("simple") => Baseline::Simple,
                Some("q") => Baseline::Network,
                Some(v) => return Err(bad("base", v)),
            };
            let leaf = match setting("leaf") {
                None | Some("end") => None,
                Some(v) => Some(v.parse().map_err(|_| bad("leaf", v))?),
            };
            Recipe::Hybrid {
                dir,
                hybrid: Box::new(Hybrid {
                    search: search(fixed(samples))?,
                    prior,
                    baseline,
                    leaf,
                }),
            }
        }
        Which::Phased => {
            let rest = positional.unwrap_or_default();
            let parts: Vec<&str> = rest.split('+').collect();
            let [bid, exchange, play] = parts[..] else {
                return Err(format!("{s}: expected phased:BID+EXCHANGE+PLAY"));
            };
            let part = |p: &str| -> Result<Spec, String> {
                if p.starts_with("phased:") {
                    return Err(format!("{s}: phases do not nest"));
                }
                p.parse()
            };
            Recipe::Ready(Kind::Phased(Box::new(Phased {
                bid: part(bid)?,
                exchange: part(exchange)?,
                play: part(play)?,
            })))
        }
    };
    let temper = level.is_some() || matches!(which, Which::Belief | Which::Hybrid);
    Ok((recipe, temper))
}

impl FromStr for Spec {
    type Err = String;

    fn from_str(s: &str) -> Result<Spec, String> {
        let syntax: Syntax = s.parse()?;
        let (recipe, temper) = recipe(&syntax)?;
        let kind = match recipe {
            Recipe::Ready(kind) => kind,
            Recipe::Belief { dir, mut search } => {
                search.sampler = Sampler::Belief(load_belief(&dir)?);
                Kind::Search(search)
            }
            Recipe::Dmc { dir, temperature } => Kind::Dmc(infer::QBot {
                net: load_q(&dir)?,
                temperature,
            }),
            Recipe::Hybrid { dir, hybrid } => Kind::Hybrid(Box::new(HybridBot {
                search: hybrid.search,
                values: load_q(&dir)?,
                prior: hybrid.prior,
                baseline: hybrid.baseline,
                leaf: hybrid.leaf,
            })),
        };
        Ok(Spec { syntax, kind, temper })
    }
}

/// Models by directory, loaded once and shared by every spec naming them.
struct Models<T>(std::sync::Mutex<std::collections::BTreeMap<String, Arc<T>>>);

impl<T> Models<T> {
    const fn new() -> Models<T> {
        Models(std::sync::Mutex::new(std::collections::BTreeMap::new()))
    }

    fn get(&self, dir: &str, open: impl FnOnce(&Path) -> Result<T, String>) -> Result<Arc<T>, String> {
        let mut loaded = self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(model) = loaded.get(dir) {
            return Ok(model.clone());
        }
        let model = Arc::new(open(Path::new(dir))?);
        loaded.insert(dir.to_string(), model.clone());
        Ok(model)
    }
}

/// The belief model in directory `dir`, checked to read Mighty's encoding.
fn load_belief(dir: &str) -> Result<Arc<infer::BeliefNet>, String> {
    static LOADED: Models<infer::BeliefNet> = Models::new();
    LOADED.get(dir, |path| {
        let net = infer::BeliefNet::open(path).map_err(|e| e.to_string())?;
        check_encoding(dir, net.spec())?;
        Ok(net)
    })
}

/// The Q network in directory `dir`, checked to read Mighty's encoding.
fn load_q(dir: &str) -> Result<Arc<infer::QNet>, String> {
    static LOADED: Models<infer::QNet> = Models::new();
    LOADED.get(dir, |path| {
        let net = infer::QNet::open(path).map_err(|e| e.to_string())?;
        check_encoding(dir, net.spec())?;
        Ok(net)
    })
}

/// Whether a model reads Mighty's encoding.
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
    /// `random`, `simple`, `search`, `belief`, `dmc`, `hybrid` or `phased`.
    pub kind: &'static str,
    /// Decides the same way in every run ([`Spec::reproducible`]).
    pub reproducible: bool,
    /// Why, in a few words.
    pub reason: String,
}

/// Checks the spec `s` as [`Spec::from_str`] reads it, but for loading the
/// model a `belief:`, `dmc:` or `hybrid:` bot names.
pub fn check(s: &str) -> Result<Check, String> {
    let (recipe, _) = recipe(&s.parse()?)?;
    let fixed = |samples: usize| format!("a fixed {samples} samples a decision, on no clock");
    Ok(match recipe {
        Recipe::Belief { search, .. } => Check {
            kind: "belief",
            reproducible: true,
            reason: fixed(search.samples),
        },
        Recipe::Dmc { .. } => Check {
            kind: "dmc",
            reproducible: true,
            reason: "plays by its network on no clock; a temperature draws from the seeded generator".into(),
        },
        Recipe::Hybrid { hybrid, .. } => Check {
            kind: "hybrid",
            reproducible: true,
            reason: fixed(hybrid.search.samples),
        },
        Recipe::Ready(kind) => {
            let reproducible = reproducible(&kind);
            let (kind, reason) = match &kind {
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
                Kind::Phased(_) => (
                    "phased",
                    "each phase by its own bot: reproducible when every part is".to_string(),
                ),
                Kind::Dmc(_) | Kind::Hybrid(_) => unreachable!("model bots are read above"),
            };
            Check {
                kind,
                reproducible,
                reason,
            }
        }
    })
}

/// Whether a bot decides the same way in every run: true unless it stops
/// thinking on a clock.
fn reproducible(kind: &Kind) -> bool {
    match kind {
        Kind::Search(bot) => bot.budget.is_none(),
        Kind::Random | Kind::Simple(_) | Kind::Clumsy(..) => true,
        // Its temperature draws from the game's seeded generator.
        Kind::Dmc(_) => true,
        // Its search deals a fixed number of worlds, on no clock.
        Kind::Hybrid(_) => true,
        Kind::Phased(phased) => phased.reproducible(),
    }
}

impl Spec {
    /// The bot for `seat`.
    pub fn build(&self, seat: Seat) -> Box<dyn Bot<Mighty> + Send> {
        let temper = if self.temper { TEMPER[seat % TEMPER.len()] } else { 0.0 };
        let temper = |mut policy: SimpleBot| {
            policy.bid_base += temper;
            policy
        };
        match &self.kind {
            Kind::Random => Box::new(RandomBot),
            Kind::Simple(bot) => Box::new(temper(*bot)),
            Kind::Clumsy(bot, slips) => Box::new(Clumsy {
                inner: temper(*bot),
                slips: *slips,
            }),
            Kind::Search(bot) => Box::new(SearchBot {
                policy: temper(bot.policy),
                ..bot.clone()
            }),
            Kind::Dmc(bot) => Box::new(bot.clone()),
            Kind::Hybrid(bot) => Box::new(HybridBot {
                search: SearchBot {
                    policy: temper(bot.search.policy),
                    ..bot.search.clone()
                },
                ..(**bot).clone()
            }),
            Kind::Phased(phased) => Box::new(phased.build(seat)),
        }
    }

    /// Whether the bot decides the same way in every run: true unless it
    /// stops thinking on a clock.
    pub fn reproducible(&self) -> bool {
        reproducible(&self.kind)
    }

    /// The settings this bot takes, by name.
    pub fn keys(&self) -> Vec<String> {
        let which = match &self.kind {
            Kind::Random => Which::Random,
            Kind::Simple(_) | Kind::Clumsy(..) => Which::Simple,
            Kind::Search(_) if self.syntax.name == "belief" => Which::Belief,
            Kind::Search(_) => Which::Search,
            Kind::Dmc(_) => Which::Dmc,
            Kind::Hybrid(_) => Which::Hybrid,
            Kind::Phased(_) => Which::Phased,
        };
        which.keys()
    }
}

/// Sets the field `key` of `value` to `raw`, through the type's serde
/// form, so the settings a bot takes are its own fields with no list kept
/// here: `raw` is read as JSON (a number or `true`), else as a string.
fn set_field<T: Serialize + DeserializeOwned>(value: &mut T, key: &str, raw: &str) -> Result<(), String> {
    let mut json = serde_json::to_value(&*value).map_err(|e| e.to_string())?;
    let Some(field) = json.as_object_mut().and_then(|fields| fields.get_mut(key)) else {
        return Err(format!("unknown setting {key}"));
    };
    *field = serde_json::from_str(raw).unwrap_or_else(|_| serde_json::Value::String(raw.to_string()));
    *value = serde_json::from_value(json).map_err(|_| format!("bad value {raw:?} for {key}"))?;
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
        assert_eq!(Some(hard.clone()), Level::Hard.search());
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

    /// Every spec prints back as it was written, and what it prints reads
    /// as the same bot.
    #[test]
    fn specs_print_back_as_written() {
        let tiny = concat!(env!("CARGO_MANIFEST_DIR"), "/../infer/tests/tiny");
        let tiny_q = concat!(env!("CARGO_MANIFEST_DIR"), "/../infer/tests/tiny-q");
        let written = [
            "random".to_string(),
            "simple".into(),
            "simple@bid_base=7,slips=0.25".into(),
            "easy".into(),
            "고수".into(),
            "hard@threads=4,read.on=false".into(),
            "search:200:1:0@endgame=3".into(),
            "phased:normal+random+hard@threads=2".into(),
            format!("belief:{tiny}:50@read.on=true"),
            format!("dmc:{tiny_q}:2.5"),
            format!("hybrid:{tiny_q}:40@prior=4,base=q,leaf=2,threads=2"),
        ];
        for s in written {
            let parsed = spec(&s);
            assert_eq!(parsed.to_string(), s);
            let again = spec(&parsed.to_string());
            assert_eq!(again, parsed);
            assert_eq!(format!("{:?}", again.kind), format!("{:?}", parsed.kind), "{s}");
            assert_eq!(again.temper, parsed.temper);
        }
    }

    /// Each kind says which settings it takes: the simple bot's weights
    /// by their names, the search's on top, nothing for the random bot.
    #[test]
    fn kinds_declare_their_settings() {
        let simple = spec("simple").keys();
        assert!(simple.contains(&"bid_base".to_string()) && simple.contains(&"slips".to_string()));
        let search = spec("hard").keys();
        assert!(search.contains(&"read.draws".to_string()) && search.contains(&"bid_base".to_string()));
        assert!(!search.contains(&"slips".to_string()));
        assert!(spec("random").keys().is_empty());
        // Every key a kind declares, it takes.
        for key in &search {
            let value = if key == "read.on" { "true" } else { "1" };
            spec(&format!("search:20:1:0@{key}={value}"));
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
    #[test]
    fn belief_bots_are_hard_dealing_by_a_model() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../infer/tests/tiny");
        let parsed = spec(&format!("belief:{dir}:50"));
        let Kind::Search(ref bot) = parsed.kind else {
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
    #[test]
    fn dmc_bots_play_by_a_q_network() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../infer/tests/tiny-q");
        let greedy = spec(&format!("dmc:{dir}"));
        let Kind::Dmc(ref bot) = greedy.kind else {
            panic!("a dmc bot")
        };
        assert_eq!(bot.temperature, 0.0);
        assert!(!greedy.temper && greedy.reproducible());
        let Kind::Dmc(warm) = spec(&format!("dmc:{dir}:2.5")).kind else {
            panic!("a dmc bot")
        };
        assert_eq!(warm.temperature, 2.5);
        assert!(std::sync::Arc::ptr_eq(&warm.net, &bot.net), "loaded once");
        assert!(format!("dmc:{dir}:-1").parse::<Spec>().is_err());
        assert!(format!("dmc:{dir}@threads=2").parse::<Spec>().is_err());
        assert!("dmc:/no/such/model".parse::<Spec>().is_err());
        // The belief fixture is no Q network.
        let belief = concat!(env!("CARGO_MANIFEST_DIR"), "/../infer/tests/tiny");
        assert!(format!("dmc:{belief}").parse::<Spec>().is_err());
    }

    /// `hybrid:` is `hard` at its own sample count with a Q network, its
    /// settings split between the hybrid and the search.
    #[test]
    fn hybrid_bots_are_hard_with_a_q_network() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../infer/tests/tiny-q");
        let plain = spec(&format!("hybrid:{dir}:40"));
        let Kind::Hybrid(ref bot) = plain.kind else {
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
        assert!(std::sync::Arc::ptr_eq(&tuned.values, &bot.values), "loaded once");
        for bad in ["base=best", "leaf=soon", "prior=-1", "nonsense=1"] {
            assert!(format!("hybrid:{dir}:40@{bad}").parse::<Spec>().is_err(), "{bad}");
        }
        assert!(format!("hybrid:{dir}").parse::<Spec>().is_err());
        let belief = concat!(env!("CARGO_MANIFEST_DIR"), "/../infer/tests/tiny");
        assert!(format!("hybrid:{belief}:40").parse::<Spec>().is_err());
    }

    /// A hybrid plays whole hands, every setting on, with the tiny network.
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
