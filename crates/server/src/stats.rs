//! Game stats without cookies. The server notes what happens at its tables,
//! one JSON line per event in `<data>/stats.jsonl` (in memory without a data
//! directory), and its owner reads the totals at `/stats`.
//!
//! Nothing here names a person: no IPs, no player names. A player is told
//! apart only by a salted hash of the id their browser already keeps to
//! reclaim a seat, so the log can count who came back but not who they are.

use crate::session::BotLevel;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, Write};
use std::path::Path;
use std::sync::Mutex;

/// Seconds since the Unix epoch.
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

const DAY: u64 = 86_400;

/// Days count in Korean time, where the players are.
pub fn day(t: u64) -> u64 {
    (t + 9 * 3600) / DAY
}

/// `day` as `YYYY-MM-DD`.
pub fn date(day: u64) -> String {
    // Howard Hinnant's civil_from_days.
    let z = day as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

/// One line of the log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Record {
    pub t: u64,
    #[serde(flatten)]
    pub event: Event,
}

/// Who sat at a hand, and under which rules.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hand {
    pub table: String,
    pub preset: String,
    /// Whether the table changed the preset's rules.
    #[serde(default)]
    pub custom: bool,
    pub humans: usize,
    pub bots: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    TableCreated {
        table: String,
        preset: String,
    },
    /// A new player or a bot took an empty seat; reclaiming a seat is not one.
    SeatFilled {
        table: String,
        seat: usize,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bot: Option<BotLevel>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        player: Option<String>,
    },
    HandStarted {
        #[serde(flatten)]
        hand: Hand,
        /// Hashed ids of the people seated.
        #[serde(default)]
        players: Vec<String>,
    },
    HandFinished {
        #[serde(flatten)]
        hand: Hand,
        /// How the contract went, as the game puts it (`made`, `failed`).
        outcome: String,
        #[serde(default)]
        secs: Option<u64>,
    },
    /// The table closed with a hand still in play.
    HandAbandoned {
        #[serde(flatten)]
        hand: Hand,
        #[serde(default)]
        secs: Option<u64>,
    },
    /// A player's turn ran out and a bot played it for them.
    TurnTimedOut {
        table: String,
    },
    /// A player left their seat with a hand in play, and a bot took it over.
    LeftMidHand {
        table: String,
        seat: usize,
    },
    Report {
        #[serde(default)]
        table: Option<String>,
    },
    ClientError {
        group: String,
        message: String,
        frame: String,
        #[serde(default)]
        version: Option<String>,
    },
}

/// The log, with the last month of it in memory for the dashboard.
pub struct Stats {
    salt: String,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    file: Option<std::fs::File>,
    /// Records of the last [`KEEP_DAYS`], oldest first.
    recent: Vec<Record>,
    /// The day each player was first seen, over the whole log.
    first_seen: HashMap<String, u64>,
    /// When each error group was last seen, over the whole log.
    error_seen: HashMap<String, u64>,
}

/// Days of records kept in memory; the dashboard looks back 30.
const KEEP_DAYS: u64 = 31;

impl Stats {
    /// Keeps the log in memory only, with a salt that dies with the process.
    pub fn in_memory() -> Stats {
        Stats::with_salt(random_salt())
    }

    fn with_salt(salt: String) -> Stats {
        Stats {
            salt,
            inner: Mutex::default(),
        }
    }

    /// Opens (or starts) the log under `dir`. The salt comes from
    /// `STATS_SALT` if set, else from `<dir>/stats-salt`, made on first use.
    pub fn open(dir: &Path) -> std::io::Result<Stats> {
        std::fs::create_dir_all(dir)?;
        let salt = match std::env::var("STATS_SALT").ok().filter(|s| !s.is_empty()) {
            Some(salt) => salt,
            None => {
                let path = dir.join("stats-salt");
                match std::fs::read_to_string(&path) {
                    Ok(salt) if !salt.trim().is_empty() => salt.trim().to_string(),
                    _ => {
                        let salt = random_salt();
                        std::fs::write(&path, &salt)?;
                        salt
                    }
                }
            }
        };
        let stats = Stats::with_salt(salt);
        let path = dir.join("stats.jsonl");
        let cutoff = now().saturating_sub(KEEP_DAYS * DAY);
        if let Ok(file) = std::fs::File::open(&path) {
            let mut inner = stats.inner.lock().expect("stats poisoned");
            for line in std::io::BufReader::new(file).lines() {
                // A line from a newer or broken version is skipped, not fatal.
                let Ok(record) = serde_json::from_str::<Record>(&line?) else {
                    continue;
                };
                inner.note(&record);
                if record.t >= cutoff {
                    inner.recent.push(record);
                }
            }
        }
        let file = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
        stats.inner.lock().expect("stats poisoned").file = Some(file);
        Ok(stats)
    }

    /// A player's id as the log keeps it: salted and hashed, never raw.
    pub fn player(&self, raw: &str) -> String {
        let digest = Sha256::new()
            .chain_update(self.salt.as_bytes())
            .chain_update(b"\0")
            .chain_update(raw.as_bytes())
            .finalize();
        hex(&digest[..8])
    }

    pub fn record(&self, event: Event) {
        self.record_at(now(), event);
    }

    pub fn record_at(&self, t: u64, event: Event) {
        let record = Record { t, event };
        let mut inner = self.inner.lock().expect("stats poisoned");
        if let Some(file) = &mut inner.file {
            let line = serde_json::to_string(&record).expect("records serialize");
            if let Err(e) = writeln!(file, "{line}") {
                tracing::error!("could not write stats: {e}");
            }
        }
        inner.note(&record);
        // Drop what the dashboard no longer shows, now and then.
        if inner.recent.first().is_some_and(|r| r.t + (KEEP_DAYS + 1) * DAY < t) {
            let cutoff = t.saturating_sub(KEEP_DAYS * DAY);
            inner.recent.retain(|r| r.t >= cutoff);
        }
        inner.recent.push(record);
    }

    /// When the error group `group` was last seen, before now.
    pub fn error_last_seen(&self, group: &str) -> Option<u64> {
        self.inner
            .lock()
            .expect("stats poisoned")
            .error_seen
            .get(group)
            .copied()
    }

    pub fn summary(&self, now: u64) -> Summary {
        let inner = self.inner.lock().expect("stats poisoned");
        summarize(&inner.recent, &inner.first_seen, now)
    }
}

impl Inner {
    /// Keeps the all-time indexes current.
    fn note(&mut self, record: &Record) {
        let d = day(record.t);
        let players: &[String] = match &record.event {
            Event::HandStarted { players, .. } => players,
            Event::SeatFilled { player: Some(p), .. } => std::slice::from_ref(p),
            Event::ClientError { group, .. } => {
                self.error_seen.insert(group.clone(), record.t);
                &[]
            }
            _ => &[],
        };
        for p in players {
            let first = self.first_seen.entry(p.clone()).or_insert(d);
            *first = (*first).min(d);
        }
    }
}

fn random_salt() -> String {
    hex(&rand::rng().random::<[u8; 16]>())
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// What `/stats` shows, and `/api/stats` returns.
#[derive(Debug, Default, Serialize)]
pub struct Summary {
    pub generated: u64,
    /// The last 30 days, oldest first, in Korean time.
    pub days: Vec<DayCount>,
    /// Over the same 30 days.
    pub totals: Totals,
    /// Finished hands by how many people sat at them.
    pub hands_by_humans: BTreeMap<usize, u32>,
    /// Tables by the most people seated at any of their hands.
    pub tables_by_humans: BTreeMap<usize, u32>,
    /// Bot seats filled, by level.
    pub bots_by_level: BTreeMap<String, u32>,
    pub presets: Vec<PresetCount>,
    pub outcomes: BTreeMap<String, u32>,
    /// Median length of a finished hand, in seconds.
    pub median_hand_secs: Option<u64>,
    pub players: Players,
    /// Client errors by group, the most recently seen first.
    pub errors: Vec<ErrorGroup>,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
pub struct DayCount {
    pub date: String,
    pub tables: u32,
    pub hands_started: u32,
    pub hands_finished: u32,
    pub hands_abandoned: u32,
}

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct Totals {
    pub tables: u32,
    pub hands_started: u32,
    pub hands_finished: u32,
    pub hands_abandoned: u32,
    pub reports: u32,
    pub client_errors: u32,
    pub turns_timed_out: u32,
    /// Players who left mid-hand, a bot playing the hand out for them.
    pub left_mid_hand: u32,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct PresetCount {
    pub preset: String,
    pub hands: u32,
    /// Of those, hands under rules the table changed.
    pub custom: u32,
}

/// People who sat at a hand in the last 7 and 30 days, and how many of them
/// had played on an earlier day too.
#[derive(Debug, Default, PartialEq, Serialize)]
pub struct Players {
    pub active_7: u32,
    pub returning_7: u32,
    pub active_30: u32,
    pub returning_30: u32,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct ErrorGroup {
    pub group: String,
    pub message: String,
    pub frame: String,
    pub count: u32,
    pub last_seen: u64,
    pub version: Option<String>,
}

/// Totals over the 30 days to `now`. `first_seen` gives each player's first
/// day over the whole log, so a player is returning if seen before their
/// latest day in the window.
pub fn summarize(records: &[Record], first_seen: &HashMap<String, u64>, now: u64) -> Summary {
    const WINDOW: u64 = 30;
    let today = day(now);
    let first_day = today + 1 - WINDOW;
    let mut s = Summary {
        generated: now,
        days: (first_day..=today)
            .map(|d| DayCount {
                date: date(d),
                ..DayCount::default()
            })
            .collect(),
        ..Summary::default()
    };
    let mut table_humans: HashMap<&str, usize> = HashMap::new();
    let mut presets: BTreeMap<&str, (u32, u32)> = BTreeMap::new();
    let mut durations = Vec::new();
    // Each player's latest day in the window.
    let mut last_day: HashMap<&str, u64> = HashMap::new();
    let mut errors: HashMap<&str, ErrorGroup> = HashMap::new();
    for r in records {
        let d = day(r.t);
        if d < first_day || d > today {
            continue;
        }
        let slot = &mut s.days[(d - first_day) as usize];
        match &r.event {
            Event::TableCreated { .. } => {
                slot.tables += 1;
                s.totals.tables += 1;
            }
            Event::SeatFilled { bot, .. } => {
                if let Some(level) = bot {
                    let name = serde_json::to_value(level)
                        .ok()
                        .and_then(|v| v.as_str().map(String::from));
                    *s.bots_by_level.entry(name.unwrap_or_default()).or_default() += 1;
                }
            }
            Event::HandStarted { hand, players } => {
                slot.hands_started += 1;
                s.totals.hands_started += 1;
                let most = table_humans.entry(&hand.table).or_default();
                *most = (*most).max(hand.humans);
                for p in players {
                    let latest = last_day.entry(p).or_default();
                    *latest = (*latest).max(d);
                }
            }
            Event::HandFinished { hand, outcome, secs } => {
                slot.hands_finished += 1;
                s.totals.hands_finished += 1;
                *s.hands_by_humans.entry(hand.humans).or_default() += 1;
                let entry = presets.entry(&hand.preset).or_default();
                entry.0 += 1;
                entry.1 += u32::from(hand.custom);
                *s.outcomes.entry(outcome.clone()).or_default() += 1;
                durations.extend(*secs);
            }
            Event::HandAbandoned { .. } => {
                slot.hands_abandoned += 1;
                s.totals.hands_abandoned += 1;
            }
            Event::Report { .. } => s.totals.reports += 1,
            Event::TurnTimedOut { .. } => s.totals.turns_timed_out += 1,
            Event::LeftMidHand { .. } => s.totals.left_mid_hand += 1,
            Event::ClientError {
                group,
                message,
                frame,
                version,
            } => {
                s.totals.client_errors += 1;
                let g = errors.entry(group).or_insert_with(|| ErrorGroup {
                    group: group.clone(),
                    message: message.clone(),
                    frame: frame.clone(),
                    count: 0,
                    last_seen: 0,
                    version: None,
                });
                g.count += 1;
                if r.t >= g.last_seen {
                    g.last_seen = r.t;
                    g.version.clone_from(version);
                }
            }
        }
    }
    for humans in table_humans.into_values() {
        *s.tables_by_humans.entry(humans).or_default() += 1;
    }
    s.presets = presets
        .into_iter()
        .map(|(preset, (hands, custom))| PresetCount {
            preset: preset.to_string(),
            hands,
            custom,
        })
        .collect();
    s.presets
        .sort_by(|a, b| b.hands.cmp(&a.hands).then_with(|| a.preset.cmp(&b.preset)));
    durations.sort_unstable();
    s.median_hand_secs = durations.get(durations.len() / 2).copied();
    for (player, latest) in last_day {
        let returning = first_seen.get(player).is_some_and(|&first| first < latest);
        if latest + 7 > today {
            s.players.active_7 += 1;
            s.players.returning_7 += u32::from(returning);
        }
        s.players.active_30 += 1;
        s.players.returning_30 += u32::from(returning);
    }
    s.errors = errors.into_values().collect();
    s.errors
        .sort_by(|a, b| b.last_seen.cmp(&a.last_seen).then_with(|| a.group.cmp(&b.group)));
    s.errors.truncate(30);
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hand(table: &str, preset: &str, humans: usize) -> Hand {
        Hand {
            table: table.into(),
            preset: preset.into(),
            custom: false,
            humans,
            bots: 5 - humans,
        }
    }

    #[test]
    fn dates_are_korean_calendar_days() {
        assert_eq!(date(0), "1970-01-01");
        // 2026-10-04 15:30 UTC is already the 5th in Seoul.
        let t = 1_791_127_800;
        assert_eq!(date(day(t)), "2026-10-05");
        assert_eq!(date(day(t - 9 * 3600)), "2026-10-04");
        assert_eq!(date(day(951_782_400)), "2000-02-29");
    }

    #[test]
    fn records_read_back_as_written() {
        let record = Record {
            t: 5,
            event: Event::HandFinished {
                hand: hand("abc", "gshs", 2),
                outcome: "made".into(),
                secs: Some(300),
            },
        };
        let line = serde_json::to_string(&record).unwrap();
        assert!(line.contains(r#""type":"hand_finished""#), "{line}");
        assert!(line.contains(r#""preset":"gshs""#), "the hand is flattened: {line}");
        assert_eq!(serde_json::from_str::<Record>(&line).unwrap(), record);
    }

    #[test]
    fn players_are_hashed_with_the_salt() {
        let a = Stats::with_salt("one".into());
        let b = Stats::with_salt("two".into());
        assert_eq!(a.player("token"), a.player("token"));
        assert_ne!(a.player("token"), b.player("token"));
        assert!(!a.player("token").contains("token"));
        assert_eq!(a.player("token").len(), 16);
    }

    #[test]
    fn the_summary_counts_tables_hands_presets_and_returning_players() {
        let now = 1_791_127_800;
        let today = day(now);
        let at = |days_ago: u64| now - days_ago * DAY;
        let started = |table: &str, humans, players: &[&str]| Event::HandStarted {
            hand: hand(table, "gshs", humans),
            players: players.iter().map(|p| p.to_string()).collect(),
        };
        let records = vec![
            // Too old for the window.
            Record {
                t: at(40),
                event: Event::TableCreated {
                    table: "old".into(),
                    preset: "gshs".into(),
                },
            },
            Record {
                t: at(10),
                event: Event::TableCreated {
                    table: "a".into(),
                    preset: "gshs".into(),
                },
            },
            Record {
                t: at(10),
                event: Event::SeatFilled {
                    table: "a".into(),
                    seat: 1,
                    bot: Some(BotLevel::Hard),
                    player: None,
                },
            },
            Record {
                t: at(10),
                event: started("a", 2, &["p1", "p2"]),
            },
            Record {
                t: at(10),
                event: Event::HandFinished {
                    hand: hand("a", "gshs", 2),
                    outcome: "made".into(),
                    secs: Some(400),
                },
            },
            Record {
                t: at(1),
                event: Event::TableCreated {
                    table: "b".into(),
                    preset: "kmla".into(),
                },
            },
            Record {
                t: at(1),
                event: started("b", 1, &["p1"]),
            },
            Record {
                t: at(1),
                event: Event::HandFinished {
                    hand: Hand {
                        custom: true,
                        ..hand("b", "kmla", 1)
                    },
                    outcome: "failed".into(),
                    secs: Some(200),
                },
            },
            Record {
                t: at(0),
                event: started("b", 1, &["p3"]),
            },
            Record {
                t: at(0),
                event: Event::HandAbandoned {
                    hand: hand("b", "kmla", 1),
                    secs: Some(30),
                },
            },
            Record {
                t: at(0),
                event: Event::LeftMidHand {
                    table: "b".into(),
                    seat: 0,
                },
            },
            Record {
                t: at(0),
                event: Event::Report { table: None },
            },
        ];
        let mut first_seen = HashMap::new();
        first_seen.insert("p1".to_string(), today - 10);
        first_seen.insert("p2".to_string(), today - 10);
        first_seen.insert("p3".to_string(), today);
        let s = summarize(&records, &first_seen, now);

        assert_eq!(s.days.len(), 30);
        assert_eq!(s.days.last().unwrap().date, date(today));
        assert_eq!(s.days[29 - 10].tables, 1);
        assert_eq!(s.days[29].hands_abandoned, 1);
        assert_eq!(
            s.totals,
            Totals {
                tables: 2,
                hands_started: 3,
                hands_finished: 2,
                hands_abandoned: 1,
                reports: 1,
                client_errors: 0,
                turns_timed_out: 0,
                left_mid_hand: 1,
            }
        );
        assert_eq!(s.hands_by_humans, BTreeMap::from([(1, 1), (2, 1)]));
        assert_eq!(s.tables_by_humans, BTreeMap::from([(1, 1), (2, 1)]));
        assert_eq!(s.bots_by_level, BTreeMap::from([("hard".to_string(), 1)]));
        assert_eq!(
            s.presets,
            vec![
                PresetCount {
                    preset: "gshs".into(),
                    hands: 1,
                    custom: 0
                },
                PresetCount {
                    preset: "kmla".into(),
                    hands: 1,
                    custom: 1
                },
            ]
        );
        assert_eq!(s.outcomes["made"], 1);
        assert_eq!(s.median_hand_secs, Some(400));
        // p1 came back after ten days; p2 has not; p3 is new today.
        assert_eq!(
            s.players,
            Players {
                active_7: 2,
                returning_7: 1,
                active_30: 3,
                returning_30: 1,
            }
        );
    }

    #[test]
    fn errors_group_with_counts_and_the_latest_first() {
        let error = |group: &str, version: &str| Event::ClientError {
            group: group.into(),
            message: format!("{group} broke"),
            frame: "main.js".into(),
            version: Some(version.into()),
        };
        let now = 1_791_127_800;
        let records = vec![
            Record {
                t: now - 50,
                event: error("x", "1"),
            },
            Record {
                t: now - 40,
                event: error("y", "1"),
            },
            Record {
                t: now - 30,
                event: error("x", "2"),
            },
        ];
        let s = summarize(&records, &HashMap::new(), now);
        assert_eq!(s.totals.client_errors, 3);
        assert_eq!(s.errors.len(), 2);
        assert_eq!(s.errors[0].group, "x");
        assert_eq!(s.errors[0].count, 2);
        assert_eq!(s.errors[0].last_seen, now - 30);
        assert_eq!(s.errors[0].version.as_deref(), Some("2"));
        assert_eq!(s.errors[1].count, 1);
    }

    #[test]
    fn the_log_survives_a_restart() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let stats = Stats::open(dir).unwrap();
        let player = stats.player("token");
        stats.record(Event::HandStarted {
            hand: hand("a", "gshs", 1),
            players: vec![player.clone()],
        });
        stats.record(Event::ClientError {
            group: "g".into(),
            message: "m".into(),
            frame: String::new(),
            version: None,
        });
        drop(stats);
        std::fs::OpenOptions::new()
            .append(true)
            .open(dir.join("stats.jsonl"))
            .unwrap()
            .write_all(b"{\"t\":1,\"type\":\"from_the_future\"}\nnot json\n")
            .unwrap();

        let stats = Stats::open(dir).unwrap();
        assert_eq!(stats.player("token"), player, "the salt is kept");
        assert!(stats.error_last_seen("g").is_some());
        let s = stats.summary(now());
        assert_eq!(s.totals.hands_started, 1);
        assert_eq!(s.players.active_7, 1);
    }
}
