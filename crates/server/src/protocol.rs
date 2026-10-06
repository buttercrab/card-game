//! What the server and the web client say to each other. Every type here,
//! and the game's types inside them, derives [`TS`]; [`crate::codegen`]
//! writes them to `web/src/lib/generated/`, so the client is typed by the
//! server's own definitions.
//!
//! The messages are generic over the game's types (its settings, rules,
//! view, actions, notes and hand summaries); the game's own appear here
//! only where the TypeScript is made concrete (`#[ts(concrete)]`,
//! `#[ts(as)]`), which is what the client is built against.

use crate::room::TableSettings;
use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use engine::{Level, Turn};
use mighty::rules::{InvalidRules, Preset, Rules};
use mighty::table::{MightyNotes, MightySettings};
use mighty::{Action, HandSummary, View};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

/// Which protocol the server speaks: a digest of the generated types, so
/// any change to a message changes it. A page built for another one (a
/// tab left open across a deploy) offers to reload.
pub fn version() -> &'static str {
    static VERSION: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    VERSION.get_or_init(|| {
        use sha2::{Digest, Sha256};
        crate::stats::hex(&Sha256::digest(crate::codegen::typescript().as_bytes())[..6])
    })
}

/// Why the server refused something, as a code: the client words each in
/// Korean, and the compiler makes it word every one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// Only a seated player may do that, and this connection is not seated.
    NotSeated,
    /// This connection already has a seat.
    AlreadySeated,
    /// A seat needs a name.
    NameRequired,
    TableFull,
    SeatTaken,
    NoSuchSeat,
    /// Clearing a seat that holds no player.
    NoPlayerInSeat,
    /// Removing a bot from a seat that holds none.
    NoBotInSeat,
    /// Swapping two empty seats.
    NobodyToMove,
    /// Clearing your own seat (leave instead).
    LeaveOwnSeat,
    /// Seats move only between hands.
    SeatsBetweenHands,
    /// The rules change only between hands.
    RulesBetweenHands,
    /// Bots stay until the hand is over.
    BotsStayInHand,
    /// Starting while a hand is on.
    HandInProgress,
    /// Starting with an empty seat.
    EmptySeats,
    NoHand,
    NotYourTurn,
    /// The game refused the action.
    IllegalAction,
    /// The first bid waits a moment after the deal, for a 딜미스.
    WaitAfterDeal,
    NoSuchTurnLimit,
    /// The rules do not hold together; `rule` says why.
    InvalidRules,
    /// The rules would change the number of seats.
    PlayerCountFixed,
    UnknownReaction,
    /// Too many hints are being worked out across the server.
    HintsBusy,
    /// This connection asks for hints too fast.
    HintsTooOften,
    /// Not a message the server understands; `detail` says what was wrong.
    BadMessage,
    /// Too many requests from this address.
    RateLimited,
    /// The server has as many tables open as it allows.
    TooManyTables,
    UnknownPreset,
    /// A problem report with no text.
    EmptyReport,
    /// Too many problem reports this hour, from everyone.
    TooManyReports,
    /// The table closed (nobody was there for a while) as this connection
    /// came; it hangs up after this.
    TableGone,
}

/// A refusal: on a table's connection as `{type: "error", ...}`, over
/// HTTP as the body of an error status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ServerError {
    pub code: ErrorCode,
    /// Which rule check failed, for [`ErrorCode::InvalidRules`], as the
    /// game names it.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(as = "Option<InvalidRules>", optional)]
    pub rule: Option<Value>,
    /// More, in English, for the logs and for whoever debugs the client.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<String>,
}

impl ServerError {
    pub fn new(code: ErrorCode) -> ServerError {
        ServerError {
            code,
            rule: None,
            detail: None,
        }
    }

    pub fn with_detail(code: ErrorCode, detail: impl ToString) -> ServerError {
        ServerError {
            detail: Some(detail.to_string()),
            ..ServerError::new(code)
        }
    }

    /// The game refused the rules, for `rule` (the game's
    /// [`engine::GameInfo::RulesError`]).
    pub fn rules(rule: &impl Serialize) -> ServerError {
        ServerError {
            rule: Some(serde_json::to_value(rule).expect("a rule error serializes")),
            ..ServerError::new(ErrorCode::InvalidRules)
        }
    }

    /// The error as sent on a table's connection.
    pub fn message(&self) -> String {
        let message = ServerMsg::<(), (), (), (), (), ()>::Error(self.clone());
        serde_json::to_string(&message).expect("errors serialize")
    }

    /// The error as an HTTP response with `status`.
    pub fn respond(self, status: StatusCode) -> Response {
        (status, Json(self)).into_response()
    }
}

impl From<ErrorCode> for ServerError {
    fn from(code: ErrorCode) -> ServerError {
        ServerError::new(code)
    }
}

impl std::fmt::Display for ServerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let code = serde_json::to_value(self.code).unwrap_or_default();
        write!(f, "{}", code.as_str().unwrap_or("error"))?;
        if let Some(rule) = &self.rule {
            match rule.as_str() {
                Some(rule) => write!(f, ": {rule}")?,
                None => write!(f, ": {rule}")?,
            }
        }
        if let Some(detail) = &self.detail {
            write!(f, ": {detail}")?;
        }
        Ok(())
    }
}

/// `POST /api/rooms`: a new table, on a preset (기본 by default) or on
/// rules of its own, which must hold together.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(bound(deserialize = "P: Deserialize<'de>, R: Deserialize<'de>"))]
#[ts(concrete(P = Preset, R = Rules))]
pub struct CreateRoom<P, R> {
    #[serde(default)]
    #[ts(optional)]
    pub preset: Option<P>,
    /// The table's own rules, changed from the preset's.
    #[serde(default)]
    #[ts(optional)]
    pub rules: Option<R>,
}

impl<P, R> Default for CreateRoom<P, R> {
    fn default() -> CreateRoom<P, R> {
        CreateRoom {
            preset: None,
            rules: None,
        }
    }
}

/// The answer to [`CreateRoom`]: the table's id, which is its link.
#[derive(Debug, Clone, Serialize, TS)]
pub struct CreatedRoom {
    pub id: String,
}

/// Who sits in a seat, as everyone at the table sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SeatInfo {
    Empty,
    Human {
        name: String,
        connected: bool,
        /// Its turn ran out and was played for it (자리 비움), or its
        /// connection is gone under a turn limit.
        away: bool,
    },
    Bot {
        name: String,
        level: Level,
    },
}

/// The running turn timer, as of the message that carries it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
pub struct ClockInfo {
    pub seat: usize,
    /// Time left, in milliseconds.
    pub ms: u64,
    /// The whole turn, in milliseconds.
    pub total_ms: u64,
}

/// The table: who sits where, the turn timer and the table's settings.
/// Sent to everyone after every change, and after a [`SessionMsg`] that
/// changed with it.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(concrete(S = MightySettings, R = Rules))]
pub struct RoomMsg<S, R> {
    /// The server's [`version`] of the protocol.
    pub protocol: String,
    pub id: String,
    pub game: String,
    /// The preset, the table's own rules if its players changed them, and
    /// the preset's rules as pinned when the table chose it.
    pub settings: S,
    /// The rules the table plays by.
    pub rules: R,
    /// Whether its players changed the preset's rules.
    pub customized: bool,
    pub seats: Vec<SeatInfo>,
    pub in_hand: bool,
    pub table: TableSettings,
    /// The turn timer, when one runs.
    pub clock: Option<ClockInfo>,
    /// Connections without a seat: people watching.
    pub watching: usize,
    /// Whether a hand, running or just finished, is on the table.
    pub showing: bool,
}

/// The session so far: the scores and every finished hand, by seat. Sent
/// when a connection opens and whenever it changes (a hand ends, someone
/// new sits down, the seats move), just before the [`RoomMsg`] that goes
/// with it.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(concrete(H = HandSummary))]
pub struct SessionMsg<H> {
    pub scores: Vec<i64>,
    pub hands_played: u32,
    /// Each finished hand's payoffs, in order.
    pub history: Vec<Vec<i64>>,
    /// Each finished hand in brief, in order.
    pub hands: Vec<H>,
}

/// The hand as one seat (or a spectator) may see it.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(concrete(V = View, A = Action, N = MightyNotes))]
pub struct StateMsg<V, A, N> {
    pub view: V,
    /// What the seat may do, on its turn.
    pub legal: Vec<A>,
    pub turn: Turn,
    /// What the seat may do although it is not its turn: a 딜미스 from the
    /// moment the cards land, for a hand that qualifies.
    pub out_of_turn: Vec<A>,
    /// How long, in ms, the slowest legal action must still wait after the
    /// deal (the first bid where 딜미스 comes first).
    pub grace_ms: u64,
    /// Which state of the hand this is; a hint carries the version it was
    /// asked for, so one for an older state is dropped.
    pub version: u64,
    /// What the table needs told on the seat's turn: why a card can't be
    /// played, what each contract change sets.
    pub notes: N,
}

/// How the seats moved between hands. Sent before the seats change, so a
/// table on screen can slide each seat to its new place.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "how", rename_all = "snake_case")]
pub enum SeatsMoved {
    /// `order[s]`: where seat `s` went.
    Shuffle { order: Vec<usize> },
    /// The two seats traded places.
    Swap { seats: [usize; 2] },
}

/// Everything the server sends on a table's connection.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(concrete(S = MightySettings, H = HandSummary, R = Rules, V = View, A = Action, N = MightyNotes))]
pub enum ServerMsg<S, H, R, V, A, N> {
    Room(RoomMsg<S, R>),
    Session(SessionMsg<H>),
    State(StateMsg<V, A, N>),
    /// This connection sits at `seat`; `token` reclaims it after a reconnect.
    Welcome {
        seat: usize,
        token: String,
    },
    /// This connection's seat was given away: it watches now.
    Unseated,
    SeatsMoved(SeatsMoved),
    Reaction {
        seat: usize,
        text: String,
    },
    /// What the 고수 bot would do in the seat's place, for state `version`.
    Hint {
        version: u64,
        action: A,
    },
    Error(ServerError),
}

/// Everything a client may send on a table's connection.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    /// Take a seat, or reclaim one with the token from an earlier `welcome`.
    Join {
        name: String,
        #[serde(default)]
        #[ts(optional = nullable)]
        token: Option<String>,
        #[serde(default)]
        #[ts(optional = nullable)]
        seat: Option<usize>,
        /// An id the browser keeps across tables, if it sends one; only its
        /// salted hash is kept, to count returning players.
        #[serde(default)]
        #[ts(optional = nullable)]
        device: Option<String>,
        /// Only reclaim the token's seat: a reconnecting tab whose seat is
        /// gone (its player was moved out) watches instead of sitting
        /// somewhere new.
        #[serde(default)]
        #[ts(as = "Option<bool>", optional)]
        reclaim: bool,
    },
    /// Give up your seat; a bot takes over if a hand is in progress.
    Leave,
    /// Change the table's own settings (see [`TableSettings`]); fields left
    /// out stay as they are.
    SetTable {
        #[serde(default)]
        #[ts(optional)]
        turn_secs: Option<u32>,
        #[serde(default)]
        #[ts(optional)]
        shuffle: Option<bool>,
        /// Between hands: shuffle the seats when the next hand starts.
        #[serde(default)]
        #[ts(optional)]
        shuffle_next: Option<bool>,
    },
    /// Between hands: whoever sits at `a` and at `b` (maybe nobody) trade seats.
    SwapSeats {
        a: usize,
        b: usize,
    },
    /// Between hands: send the player at `seat` back to watching.
    ClearSeat {
        seat: usize,
    },
    /// Seat a bot in an empty seat, or in place of a disconnected player.
    /// On a bot's seat, changes how well it plays.
    AddBot {
        seat: usize,
        #[serde(default)]
        #[ts(as = "Option<Level>", optional)]
        level: Level,
    },
    RemoveBot {
        seat: usize,
    },
    /// Change the table's settings between hands. The seat count must stay.
    SetSettings {
        #[ts(as = "MightySettings")]
        settings: Value,
    },
    /// Ask what the bot would do in your place, on your turn.
    Hint,
    /// Show a quick reaction from your seat to the whole table.
    React {
        text: String,
    },
    /// Deal the next hand once every seat is filled.
    Start,
    Act {
        #[ts(as = "Action")]
        action: Value,
    },
}
