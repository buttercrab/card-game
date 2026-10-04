//! Bots named on the command line: `random`, `simple` or
//! `search[:SAMPLES[:CONFIDENCE[:BUDGET_MS]]]`, with `@name=value,...`
//! weights. See `sim --help`.

use engine::{Bot, RandomBot};
use mighty::Mighty;
use mighty::bot::SimpleBot;
use mighty::search::{Reading, SearchBot};
use std::str::FromStr;
use std::time::Duration;

#[derive(Clone, Copy, Debug)]
pub enum Spec {
    Random,
    Simple(SimpleBot),
    Search(SearchBot),
}

impl FromStr for Spec {
    type Err = String;

    fn from_str(s: &str) -> Result<Spec, String> {
        let (name, weights) = s.split_once('@').unwrap_or((s, ""));
        let mut policy = SimpleBot::default();
        let mut reading = Reading::default();
        let mut search_threads = 1;
        for setting in weights.split(',').filter(|w| !w.is_empty()) {
            let (key, value) = setting.split_once('=').ok_or(format!("bad weight {setting:?}"))?;
            match key.strip_prefix("read.") {
                Some(key) if name.starts_with("search") => set_reading(&mut reading, key, value)?,
                None if key == "threads" && name.starts_with("search") => {
                    search_threads = value.parse().map_err(|_| format!("bad value {value:?} for threads"))?;
                }
                _ => set_weight(&mut policy, key, value)?,
            }
        }
        match name {
            "random" => return Ok(Spec::Random),
            "simple" => return Ok(Spec::Simple(policy)),
            _ => {}
        }
        let mut parts = name.split(':');
        if parts.next() != Some("search") {
            return Err(format!("unknown bot {s:?}"));
        }
        let mut bot = SearchBot {
            policy,
            reading,
            threads: search_threads,
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
        Ok(Spec::Search(bot))
    }
}

impl Spec {
    pub fn build(self) -> Box<dyn Bot<Mighty>> {
        match self {
            Spec::Random => Box::new(RandomBot),
            Spec::Simple(bot) => Box::new(bot),
            Spec::Search(bot) => Box::new(bot),
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
