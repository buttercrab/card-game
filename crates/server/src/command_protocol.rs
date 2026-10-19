//! Scoped action admission. These types carry no hidden game state.
use crate::protocol::ErrorCode;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const MAX_COMMAND_SEQUENCE: u64 = (1_u64 << 53) - 1;
/// Bounds staged rule work independently of the transport's byte limits.
pub const MAX_COMMAND_BATCH: usize = 32;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum CommandDomain {
    #[default]
    Game,
    Room,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct CommandScope {
    #[serde(default)]
    pub domain: CommandDomain,
    pub room_id: String,
    pub room_epoch: String,
    pub session_id: u32,
    pub hand: u32,
    pub version: u64,
    pub seat: Option<usize>,
    pub actor_id: String,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct CommandWindow {
    pub scope: CommandScope,
    pub next_sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum CommandRejection {
    ActorMismatch,
    /// Durable sequence fence: this operation must never execute.
    Cancelled,
    StaleScope,
    SequenceConflict,
    SequenceGap,
    Capacity,
    Rule,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ReceiptUnavailable {
    Unknown,
    Pruned,
    PersistenceFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CommandOutcome {
    Accepted {
        version: u64,
    },
    Rejected {
        reason: CommandRejection,
        error: Option<ErrorCode>,
    },
    Unavailable {
        reason: ReceiptUnavailable,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ReceiptDurability {
    /// No durable commit has been acknowledged. Never upgrade this on the client.
    Memory,
    /// Reserved for the checkpoint-before-publication boundary.
    Persisted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct CommandReceipt {
    pub operation_id: String,
    pub sequence: u64,
    pub scope: Option<CommandScope>,
    pub outcome: CommandOutcome,
    pub durability: ReceiptDurability,
}
