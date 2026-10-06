//! One table. A room runs as its own task ([`actor`]) and handles one
//! command at a time, so its state needs no locks. After every command,
//! timer or bot move it settles: the hand advances, the turn clock is set,
//! a bot starts thinking, and what changed is saved and sent.
//!
//! - [`seating`]: who sits where, their connections and seat tokens;
//! - [`session`]: the scores and the hands played so far;
//! - [`hand`]: the hand in play and its log;
//! - [`clock`]: the turn timer;
//! - [`bots`]: how bots pace themselves and think;
//! - [`snapshot`]: saving and restoring a room, and problem reports;
//! - [`view`]: what each connection is sent.

mod actor;
mod bots;
mod clock;
mod hand;
mod seating;
mod session;
mod snapshot;
mod view;

#[cfg(test)]
mod tests;

pub use actor::Command;
pub use seating::{BOT_NAMES, NAME_MAX};
pub use snapshot::{SnapshotV2, migrate_v1};
pub use view::Preview;

use crate::bots::RemoteBots;
use crate::protocol::ServerMsg;
use crate::session::SessionGame;
use crate::stats::Stats;
use rand::SeedableRng;
use rand::rngs::StdRng;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};

pub type ConnId = u64;

/// The turn times a table may choose, in seconds; 0 is no limit.
pub const TURN_LIMITS: [u32; 4] = [0, 20, 40, 60];

/// The reactions a player can send; anything else is refused.
pub const REACTIONS: [&str; 12] = [
    "👏",
    "😂",
    "😮",
    "😭",
    "🔥",
    "🙏",
    "나이스",
    "아…",
    "ㅋㅋㅋ",
    "빨리요~",
    "미안",
    "굿",
];

/// The table's own settings, apart from the game's rules: they change how
/// the room runs, never how a hand is played or encoded.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
pub struct TableSettings {
    /// Seconds per decision, or 0 for no limit. The weightier decisions
    /// (see [`SessionGame::long_decision`]) get twice as long.
    pub turn_secs: u32,
    /// Deal the players into new seats before every hand.
    pub shuffle: bool,
    /// Deal the players into new seats when the next hand starts, once
    /// (섞기 between hands); cleared when it has.
    pub shuffle_next: bool,
}

/// How bots pace and think, server-wide.
#[derive(Debug, Clone)]
pub struct BotConfig {
    /// The unit of a bot's move time; see [`bots::pace`].
    pub delay: Duration,
    /// The most a 고수 bot may think here, if limited (a small server). A
    /// bot worker is not held to it.
    pub think_cap: Option<Duration>,
}

/// What every room on a server shares, handed to each when it opens.
#[derive(Clone)]
pub struct RoomEnv {
    pub bots: BotConfig,
    /// A room with nobody connected for this long closes.
    pub idle: Duration,
    /// Another machine that thinks for bots, when one is connected.
    pub remote: Arc<RemoteBots>,
    pub stats: Arc<Stats>,
    /// Where rooms are saved so they survive a restart, if anywhere.
    pub data: Option<PathBuf>,
    /// The places for hint searches, shared across the server.
    pub hints: crate::limit::HintPool,
}

impl RoomEnv {
    /// Rooms with bots that move at `delay`, and nothing else: no worker,
    /// stats in memory, nothing saved.
    pub fn new(delay: Duration) -> RoomEnv {
        RoomEnv {
            bots: BotConfig { delay, think_cap: None },
            idle: Duration::from_secs(crate::IDLE_MINUTES * 60),
            remote: Arc::default(),
            stats: Arc::new(Stats::in_memory()),
            data: None,
            hints: crate::limit::HintPool::default(),
        }
    }
}

/// What a room of game `G` sends.
type Msg<G> = ServerMsg<
    <G as SessionGame>::Settings,
    <G as SessionGame>::Summary,
    <G as SessionGame>::TableRules,
    <G as engine::Game>::View,
    <G as engine::Game>::Action,
    <G as SessionGame>::Notes,
>;

/// One line of JSON per move, so a hand can be replayed from the server log.
fn log_action(action: &impl Serialize) -> String {
    serde_json::to_string(action).unwrap_or_else(|e| format!("unserializable: {e}"))
}

pub struct Room<G: SessionGame> {
    id: String,
    settings: G::Settings,
    table: TableSettings,
    seating: seating::Seating,
    session: session::Session<G>,
    hand: hand::Hand<G>,
    clock: clock::TurnClock,
    /// The hand version a bot is thinking about, if any: the hand moving on
    /// (a 딜미스, say) starts a new think without waiting for the stale one.
    thinking: Option<u64>,
    rng: StdRng,
    /// What every room on the server shares.
    env: Arc<RoomEnv>,
    /// Where the room's bot tasks send their moves.
    internal: UnboundedSender<bots::Internal<G::Action>>,
    /// The other end, until [`Room::run`] takes it.
    inbox: Option<UnboundedReceiver<bots::Internal<G::Action>>>,
    /// The room's writer, while it runs with a data directory.
    persister: Option<snapshot::Persister>,
    /// Whether the room changed since it was last handed to the persister.
    dirty: bool,
    /// The session's revision everyone was last sent.
    session_sent: u64,
}

impl<G: SessionGame> Room<G> {
    pub fn new(id: String, settings: G::Settings, env: Arc<RoomEnv>) -> Room<G> {
        let n = G::seats(&settings);
        let (internal, inbox) = tokio::sync::mpsc::unbounded_channel();
        Room {
            internal,
            inbox: Some(inbox),
            persister: None,
            dirty: true,
            session_sent: 0,
            id,
            settings,
            table: TableSettings::default(),
            seating: seating::Seating::new(n),
            session: session::Session::new(n),
            hand: hand::Hand::default(),
            clock: clock::TurnClock::default(),
            thinking: None,
            rng: StdRng::from_os_rng(),
            env,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    /// Notes what happens here in the stats log; see [`crate::stats`].
    fn record(&self, event: crate::stats::Event) {
        self.env.stats.record(event);
    }

    /// The current hand's table and seats, for the stats.
    fn hand_stats(&self) -> crate::stats::Hand {
        let (humans, bots) = self.seating.counts();
        crate::stats::Hand {
            table: self.id.clone(),
            preset: G::preset_id(&self.settings).to_string(),
            custom: G::customized(&self.settings),
            humans,
            bots,
        }
    }
}
