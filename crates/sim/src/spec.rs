//! Bots named on the command line and in eval suites: `random`, `simple`
//! or `search[:SAMPLES[:CONFIDENCE[:BUDGET_MS]]]`, with `@name=value,...`
//! settings, the table's levels `easy`, `normal` and `hard`, and
//! `belief:MODEL_DIR:SAMPLES`: `hard` at that many samples, dealing by a
//! belief model (needs the `belief` feature). See `sim --help`.

use engine::{Bot, RandomBot, Seat};
use mighty::Mighty;
use mighty::bot::{Clumsy, SimpleBot};
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
}

pub use mighty::bot::{EASY_SLIPS, TEMPER};

impl FromStr for Spec {
    type Err = String;

    fn from_str(s: &str) -> Result<Spec, String> {
        let (name, settings) = s.split_once('@').unwrap_or((s, ""));
        if let Some(rest) = name.strip_prefix("belief:") {
            return belief(rest, settings);
        }
        // The table's levels, as the server builds them. 고수 thinks
        // until a time budget runs out there; here it deals a fixed 200
        // times instead, so runs reproduce.
        let mut policy = SimpleBot::default();
        let (name, temper, mut slips) = match name {
            "easy" => {
                policy = Clumsy::easy(policy).inner;
                ("simple", true, Some(EASY_SLIPS))
            }
            "normal" => ("simple", true, None),
            "hard" => ("search:200:1:0", true, None),
            _ => (name, false, None),
        };
        let search = name.starts_with("search");
        let mut reading = Reading::default();
        let mut search_threads = 1;
        let mut endgame = 0;
        for setting in settings.split(',').filter(|w| !w.is_empty()) {
            let (key, value) = setting.split_once('=').ok_or(format!("bad weight {setting:?}"))?;
            match key.strip_prefix("read.") {
                Some(key) if search => set_reading(&mut reading, key, value)?,
                None if key == "threads" && search => {
                    search_threads = value.parse().map_err(|_| format!("bad value {value:?} for threads"))?;
                }
                None if key == "endgame" && search => {
                    endgame = value.parse().map_err(|_| format!("bad value {value:?} for endgame"))?;
                }
                None if key == "slips" && name == "simple" => {
                    slips = Some(value.parse().map_err(|_| format!("bad value {value:?} for slips"))?);
                }
                _ => set_weight(&mut policy, key, value)?,
            }
        }
        let kind = match name {
            "random" => Kind::Random,
            "simple" => match slips {
                Some(slips) => Kind::Clumsy(policy, slips),
                None => Kind::Simple(policy),
            },
            _ => {
                let mut parts = name.split(':');
                if parts.next() != Some("search") {
                    return Err(format!("unknown bot {s:?}"));
                }
                let mut bot = SearchBot {
                    policy,
                    reading,
                    threads: search_threads,
                    endgame,
                    ..SearchBot::default()
                };
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
                Kind::Search(bot)
            }
        };
        Ok(Spec { kind, temper })
    }
}

/// `belief:MODEL_DIR:SAMPLES@SETTINGS`: the table's 고수 (seat temper
/// included) at `SAMPLES` deals, dealing by the model in `MODEL_DIR`, and
/// not reading the table on top (`read.on=false`, unless the settings say
/// otherwise): the model's beliefs already rest on every bid and card
/// played, and weighing its deals by them again counts that evidence
/// twice (the `beliefs` example of `crates/infer` measures it).
fn belief(rest: &str, settings: &str) -> Result<Spec, String> {
    let (dir, samples) = rest
        .rsplit_once(':')
        .ok_or(format!("belief:{rest}: expected belief:MODEL_DIR:SAMPLES"))?;
    let samples: usize = samples.parse().map_err(|_| format!("bad sample count {samples:?}"))?;
    let mut spec: Spec = format!("search:{samples}:1:0@read.on=false,{settings}").parse()?;
    let Kind::Search(bot) = &mut spec.kind else {
        unreachable!("parsed as a search")
    };
    bot.sampler = load_belief(dir)?;
    spec.temper = true;
    Ok(spec)
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
    let options = mighty::Options {
        rules: mighty::rules::Preset::Default.rules(),
        first_bidder: 0,
    };
    let spec = <Mighty as engine::Encode>::spec(&options).map_err(|e| e.to_string())?;
    if net.spec() != &spec {
        return Err(format!(
            "{dir}: the model reads {}, not {}",
            net.spec().version,
            spec.version
        ));
    }
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
        }
    }

    /// Whether the bot decides the same way in every run: true unless it
    /// stops thinking on a clock.
    pub fn reproducible(self) -> bool {
        match self.kind {
            Kind::Search(bot) => bot.budget.is_none(),
            Kind::Random | Kind::Simple(_) | Kind::Clumsy(..) => true,
        }
    }
}

/// Sets one of the simple bot's weights by name, for tuning from the
/// command line.
fn set_weight(bot: &mut SimpleBot, key: &str, value: &str) -> Result<(), String> {
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
        _ => return Err(format!("unknown weight {key:?}")),
    }
    Ok(())
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
        assert!(matches!(spec("easy").kind, Kind::Clumsy(_, s) if s == EASY_SLIPS));
        assert!(matches!(spec("normal").kind, Kind::Simple(_)));
        let Kind::Search(hard) = spec("hard").kind else {
            panic!("hard searches")
        };
        assert_eq!((hard.samples, hard.confidence, hard.budget), (200, 1.0, None));
        assert!(["easy", "normal", "hard"].iter().all(|s| spec(s).temper));
        assert!(!spec("search:200:1:0").temper);
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
}
