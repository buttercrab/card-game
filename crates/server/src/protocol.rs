//! What the server and the web client say to each other. Every type here,
//! and the game's types inside them, derives [`TS`]; [`crate::codegen`]
//! writes them to `web/src/lib/generated/`, so the client is typed by the
//! server's own definitions.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use mighty::rules::InvalidRules;
use serde::Serialize;
use ts_rs::TS;

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
}

/// A refusal: on a table's connection as `{type: "error", ...}`, over
/// HTTP as the body of an error status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ServerError {
    pub code: ErrorCode,
    /// Which rule check failed, for [`ErrorCode::InvalidRules`].
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rule: Option<InvalidRules>,
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

    pub fn rules(rule: InvalidRules) -> ServerError {
        ServerError {
            rule: Some(rule),
            ..ServerError::new(ErrorCode::InvalidRules)
        }
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

impl From<InvalidRules> for ServerError {
    fn from(rule: InvalidRules) -> ServerError {
        ServerError::rules(rule)
    }
}

impl std::fmt::Display for ServerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let code = serde_json::to_value(self.code).unwrap_or_default();
        write!(f, "{}", code.as_str().unwrap_or("error"))?;
        if let Some(rule) = self.rule {
            write!(f, ": {rule}")?;
        }
        if let Some(detail) = &self.detail {
            write!(f, ": {detail}")?;
        }
        Ok(())
    }
}
