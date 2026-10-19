//! Native serialized-resource certificates and pure admission arithmetic.
//!
//! The room coordinator prepares a cloned
//! Game state + RNG, apply the requested action AND mandatory chance batch,
//! measures the candidate with these capped serializers, then commits exactly that
//! prepared candidate. Restoration, persistence and publication have their own gates.
//!
//! Mighty restarts have no finite lifetime bound. Their log prefix therefore
//! consumes a separate allowance while retaining one normal-epoch completion
//! runway. This policy does not choose a bid, replace an action, prune a record,
//! acknowledge a receipt, or pause/retry a game on behalf of an application.
use serde::{Deserialize, Serialize};
use std::io::{self, Write};

pub const KIB: usize = 1024;
pub const MIB: usize = KIB * KIB;
/// Retain public checkpoint/version/score metadata runway alongside private control.
pub const SESSION_RECOVERY_BYTES: usize = 16 * KIB;
pub const MAX_MIGHTY_BID_ROWS: usize = (512 + 2) * 8;
pub const MAX_POKER_LOG_ENTRIES: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename = "NativeResource")]
pub enum Resource {
    Rooms,
    Rules,
    Settings,
    Session,
    Snapshot,
    HandLog,
    Record,
    Summary,
    ChanceBatch,
    Archives,
    PeriodRecords,
    TotalRecords,
    HandNumber,
    SessionNumber,
    GameVersion,
    RoomVersion,
    Score,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BudgetError {
    Capacity { resource: Resource, limit: usize },
    Serialization,
    InvalidProfile,
    InvalidTransition,
    Arithmetic,
}

/// Serializes into no more than `limit` bytes. All measurements use actual UTF-8
/// JSON including escaping, never Rust string character counts or guessed heap.
/// Count-only measurement allocates no output buffer; use borrowed candidate
/// serializers so callers also avoid cloning full histories before preflight.
struct LimitedWriter {
    limit: usize,
    used: usize,
    exceeded: bool,
    bytes: Option<Vec<u8>>,
}
impl Write for LimitedWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.used) {
            self.exceeded = true;
            return Err(io::Error::other("resource serialization capacity"));
        }
        if let Some(output) = &mut self.bytes {
            output.extend_from_slice(bytes);
        }
        self.used += bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn write_capped<T: Serialize + ?Sized>(
    value: &T,
    resource: Resource,
    limit: usize,
    keep: bool,
) -> Result<LimitedWriter, BudgetError> {
    let mut writer = LimitedWriter {
        limit,
        used: 0,
        exceeded: false,
        bytes: keep.then(Vec::new),
    };
    match serde_json::to_writer(&mut writer, value) {
        Ok(()) => Ok(writer),
        Err(_) if writer.exceeded => Err(BudgetError::Capacity { resource, limit }),
        Err(_) => Err(BudgetError::Serialization),
    }
}
pub fn serialize_capped<T: Serialize + ?Sized>(
    value: &T,
    resource: Resource,
    limit: usize,
) -> Result<Vec<u8>, BudgetError> {
    Ok(write_capped(value, resource, limit, true)?.bytes.unwrap())
}
pub fn serialized_size_capped<T: Serialize + ?Sized>(
    value: &T,
    resource: Resource,
    limit: usize,
) -> Result<usize, BudgetError> {
    Ok(write_capped(value, resource, limit, false)?.used)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CertifiedGame {
    Mighty,
    Poker,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourceProfile {
    game: CertifiedGame,
    max_record_bytes: usize,
    max_summary_bytes: usize,
    max_view_bytes: usize,
    normal_finish_log_bytes: usize,
    max_chance_batch_bytes: usize,
    permits_restart: bool,
    max_payoff: i64,
}
impl ResourceProfile {
    /// Resolve only registered server games from their bounded canonical rules.
    /// An arbitrary Table implementation receives no default certificate.
    pub fn table<G: crate::game::ServerGame>(settings: &G::Settings) -> Result<Self, BudgetError> {
        use std::any::TypeId;
        let kind = if TypeId::of::<G>() == TypeId::of::<mighty::Mighty>() {
            CertifiedGame::Mighty
        } else if TypeId::of::<G>() == TypeId::of::<poker::Poker>() {
            CertifiedGame::Poker
        } else {
            return Err(BudgetError::InvalidProfile);
        };
        let bytes = serialize_capped(&G::table_rules(settings), Resource::Rules, 64 * KIB)?;
        match kind {
            CertifiedGame::Mighty => {
                Self::mighty(&serde_json::from_slice(&bytes).map_err(|_| BudgetError::InvalidProfile)?)
            }
            CertifiedGame::Poker => {
                Self::poker(&serde_json::from_slice(&bytes).map_err(|_| BudgetError::InvalidProfile)?)
            }
        }
    }

    pub fn supports(game: &str) -> bool {
        Self::registered(game).is_some()
    }
    pub fn game(&self) -> CertifiedGame {
        self.game
    }
    pub fn max_record_bytes(&self) -> usize {
        self.max_record_bytes
    }
    pub fn max_summary_bytes(&self) -> usize {
        self.max_summary_bytes
    }
    pub fn max_view_bytes(&self) -> usize {
        self.max_view_bytes
    }
    pub fn normal_finish_log_bytes(&self) -> usize {
        self.normal_finish_log_bytes
    }
    pub fn max_chance_batch_bytes(&self) -> usize {
        self.max_chance_batch_bytes
    }
    pub fn max_payoff(&self) -> i64 {
        self.max_payoff
    }
    pub fn permits_restart(&self) -> bool {
        self.permits_restart
    }

    /// Closed metadata registry. Only typed rules certificates are public
    /// constructors; there is no default promise for arbitrary Table games.
    fn registered(game: &str) -> Option<Self> {
        match game {
            // At most255 suit ranks +255 no-trump ranks: <=512 ascending bid keys; at most eight
            // responses per key plus the extra first-bidder pass cycle.
            // Rules appear twice in a record: <=2*64KiB. 4112 public bid rows
            // fit below 256KiB; <=54 plays, names, scores and metadata leave
            // ample room in 512KiB. A single normal epoch's <=4112 log bids
            // plus <=54 discards/plays and bounded chance fit below 1MiB.
            "mighty" => Some(Self {
                game: CertifiedGame::Mighty,
                max_record_bytes: 512 * KIB,
                max_summary_bytes: 16 * KIB,
                max_view_bytes: MIB,
                normal_finish_log_bytes: MIB,
                max_chance_batch_bytes: 4 * KIB,
                permits_restart: true,
                // Every score formula uses u8 inputs: base <=1275, at most
                // five doublings (including loss-only backrun), and <=7
                // opposing seats. 1275*32*7 <1,000,000, even beyond reachable deals.
                max_payoff: 1_000_000,
            }),
            // Six 200-chip stacks: <=1200 initial chips plus <=4 unmatched
            // refunds of <=200 gives <=2000 positive-payment actions. Add
            // <=24 checks, <=6 folds and <=4 chance events: <4096 entries.
            // Act entries are <128 JSON bytes; the sole full 52-card deal
            // also fits within the remaining envelope. Six players, five
            // board cards and <=six pot tiers make 32KiB a generous record.
            "poker" => Some(Self {
                game: CertifiedGame::Poker,
                max_record_bytes: 32 * KIB,
                max_summary_bytes: 8 * KIB,
                max_view_bytes: 64 * KIB,
                normal_finish_log_bytes: 512 * KIB,
                max_chance_batch_bytes: 4 * KIB,
                permits_restart: false,
                // All six <=200-chip stacks bound any one seat's net change.
                max_payoff: 1200,
            }),
            _ => None,
        }
    }
    /// Resource shape only, not a replacement for game rule validation. The
    /// coordinator must bind this certificate to its frozen settings and renew
    /// it on settings changes. New/restored live roster metadata must satisfy
    /// server name/ID bounds before a record can rely on this envelope.
    pub fn mighty(rules: &mighty::rules::Rules) -> Result<Self, BudgetError> {
        serialized_size_capped(rules, Resource::Rules, 64 * KIB)?;
        if !(2..=8).contains(&rules.players)
            || rules.extra_cards.len() > 54
            || rules.deck_size() > 54
            || rules.hand_size == 0
            || rules
                .players
                .checked_mul(rules.hand_size)
                .is_none_or(|count| count > 54)
        {
            return Err(BudgetError::InvalidProfile);
        }
        Ok(Self::registered("mighty").unwrap())
    }
    pub fn poker(rules: &poker::PokerRules) -> Result<Self, BudgetError> {
        if !(3..=6).contains(&rules.players) || !(1..=poker::MAX_STACK).contains(&rules.starting_stack) {
            return Err(BudgetError::InvalidProfile);
        }
        serialized_size_capped(rules, Resource::Rules, 64 * KIB)?;
        Ok(Self::registered("poker").unwrap())
    }
}

/// Proposed conservative defaults. They cap serialized envelopes, not heap or
/// elapsed time. No Config/Room/transport currently consumes these settings.
#[derive(Debug, Clone, Copy)]
pub struct ResourceLimits {
    pub session_bytes: usize,
    pub snapshot_bytes: usize,
    pub hand_log_bytes: usize,
    pub archives: usize,
    pub period_records: usize,
    pub total_records: usize,
}
impl ResourceLimits {
    /// Public refusal limits must remain exact JSON/JavaScript integers.
    /// Zero quotas are valid explicit refusal policies; physical RAM tuning
    /// remains the operator's responsibility rather than a heap guarantee.
    pub fn validate(self) -> Result<Self, &'static str> {
        if [
            self.session_bytes,
            self.snapshot_bytes,
            self.hand_log_bytes,
            self.archives,
            self.period_records,
            self.total_records,
        ]
        .into_iter()
        .any(|limit| limit as u128 > crate::command_protocol::MAX_COMMAND_SEQUENCE as u128)
        {
            return Err("native resource limits exceed the exact public integer range");
        }
        Ok(self)
    }
}
impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            session_bytes: 4 * MIB,
            // 38MiB closed command/private-control ceiling plus public Session,
            // hand-log/finish runway, duplicated standing keys and frozen inputs.
            snapshot_bytes: 64 * MIB,
            hand_log_bytes: 2 * MIB,
            archives: 64,
            period_records: 2048,
            total_records: 8192,
        }
    }
}
#[derive(Debug, Clone, Copy, Default)]
pub struct RetainedUsage {
    pub session_bytes: usize,
    pub snapshot_bytes: usize,
    pub archives: usize,
    pub period_records: usize,
    pub total_records: usize,
    /// Caller-proven control/receipt headroom. Zero is deliberately refused:
    /// history admission must not consume the last bytes needed for recovery.
    pub control_reserve_bytes: usize,
}
fn add(a: usize, b: usize) -> Result<usize, BudgetError> {
    a.checked_add(b).ok_or(BudgetError::Arithmetic)
}
fn within(resource: Resource, value: usize, limit: usize) -> Result<(), BudgetError> {
    if value > limit {
        Err(BudgetError::Capacity { resource, limit })
    } else {
        Ok(())
    }
}
fn existing(limits: ResourceLimits, usage: RetainedUsage) -> Result<(), BudgetError> {
    within(Resource::Session, usage.session_bytes, limits.session_bytes)?;
    within(Resource::Snapshot, usage.snapshot_bytes, limits.snapshot_bytes)?;
    within(Resource::Archives, usage.archives, limits.archives)?;
    within(Resource::PeriodRecords, usage.period_records, limits.period_records)?;
    within(Resource::TotalRecords, usage.total_records, limits.total_records)
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HandReservation {
    profile: ResourceProfile,
    max_log_bytes: usize,
    session_limit: usize,
    snapshot_limit: usize,
    used_log_bytes: usize,
    normal_epoch_bytes: usize,
    finish_reserve_bytes: usize,
    control_reserve_bytes: usize,
    finished: bool,
}
pub fn reserve_hand(
    limits: ResourceLimits,
    profile: ResourceProfile,
    usage: RetainedUsage,
) -> Result<HandReservation, BudgetError> {
    existing(limits, usage)?;
    let expected = match profile.game {
        CertifiedGame::Mighty => ResourceProfile::registered("mighty"),
        CertifiedGame::Poker => ResourceProfile::registered("poker"),
    };
    if usage.control_reserve_bytes == 0 || Some(profile) != expected {
        return Err(BudgetError::InvalidProfile);
    }
    within(
        Resource::PeriodRecords,
        add(usage.period_records, 1)?,
        limits.period_records,
    )?;
    within(
        Resource::TotalRecords,
        add(usage.total_records, 1)?,
        limits.total_records,
    )?;
    within(
        Resource::HandLog,
        add(profile.normal_finish_log_bytes, profile.max_chance_batch_bytes)?,
        limits.hand_log_bytes,
    )?;
    // A full record appears in records AND current_hand. Keep both, even if
    // Start will release an older current_hand; do not rely on optimistic credit.
    let finished = add(
        add(profile.max_record_bytes, profile.max_record_bytes)?,
        add(profile.max_summary_bytes, 4 * KIB + SESSION_RECOVERY_BYTES)?,
    )?;
    within(
        Resource::Session,
        add(usage.session_bytes, finished)?,
        limits.session_bytes,
    )?;
    let reserved = add(add(finished, limits.hand_log_bytes)?, usage.control_reserve_bytes)?;
    within(
        Resource::Snapshot,
        add(usage.snapshot_bytes, reserved)?,
        limits.snapshot_bytes,
    )?;
    Ok(HandReservation {
        profile,
        max_log_bytes: limits.hand_log_bytes,
        session_limit: limits.session_bytes,
        snapshot_limit: limits.snapshot_bytes,
        used_log_bytes: 0,
        normal_epoch_bytes: 0,
        finish_reserve_bytes: finished,
        control_reserve_bytes: usage.control_reserve_bytes,
        finished: false,
    })
}
/// Reconstruct a live reservation after authoritative log replay. The caller
/// derives epoch bytes from the final Mighty deal (Poker has one normal epoch).
/// Unlike a new Start, existing log bytes are charged once, with only the
/// remaining normal completion runway reserved beyond them.
pub fn resume_hand(
    limits: ResourceLimits,
    profile: ResourceProfile,
    usage: RetainedUsage,
    log_bytes: usize,
    epoch_bytes: usize,
) -> Result<HandReservation, BudgetError> {
    existing(limits, usage)?;
    if usage.control_reserve_bytes == 0
        || ResourceProfile::registered(match profile.game {
            CertifiedGame::Mighty => "mighty",
            CertifiedGame::Poker => "poker",
        }) != Some(profile)
        || log_bytes == 0
        || epoch_bytes == 0
        || epoch_bytes > log_bytes
    {
        return Err(BudgetError::InvalidProfile);
    }
    within(
        Resource::PeriodRecords,
        add(usage.period_records, 1)?,
        limits.period_records,
    )?;
    within(
        Resource::TotalRecords,
        add(usage.total_records, 1)?,
        limits.total_records,
    )?;
    within(Resource::HandLog, epoch_bytes, profile.normal_finish_log_bytes)?;
    within(
        Resource::HandLog,
        add(log_bytes, profile.normal_finish_log_bytes - epoch_bytes)?,
        limits.hand_log_bytes,
    )?;
    let finished = add(
        add(profile.max_record_bytes, profile.max_record_bytes)?,
        add(profile.max_summary_bytes, 4 * KIB + SESSION_RECOVERY_BYTES)?,
    )?;
    within(
        Resource::Session,
        add(usage.session_bytes, finished)?,
        limits.session_bytes,
    )?;
    within(
        Resource::Snapshot,
        add(
            add(
                add(usage.snapshot_bytes, finished)?,
                profile.normal_finish_log_bytes - epoch_bytes,
            )?,
            usage.control_reserve_bytes,
        )?,
        limits.snapshot_bytes,
    )?;
    Ok(HandReservation {
        profile,
        max_log_bytes: limits.hand_log_bytes,
        session_limit: limits.session_bytes,
        snapshot_limit: limits.snapshot_bytes,
        used_log_bytes: log_bytes,
        normal_epoch_bytes: epoch_bytes,
        finish_reserve_bytes: finished,
        control_reserve_bytes: usage.control_reserve_bytes,
        finished: false,
    })
}

/// Exact borrowed prospective archive serialization must be supplied. This
/// check does not alter ResetScores semantics or estimate cumulative summaries.
pub fn admit_archive(
    limits: ResourceLimits,
    usage: RetainedUsage,
    prospective_session_bytes: usize,
    prospective_snapshot_bytes: usize,
) -> Result<(), BudgetError> {
    existing(limits, usage)?;
    if usage.control_reserve_bytes == 0 {
        return Err(BudgetError::InvalidProfile);
    }
    within(Resource::Archives, add(usage.archives, 1)?, limits.archives)?;
    within(
        Resource::Session,
        add(prospective_session_bytes, SESSION_RECOVERY_BYTES)?,
        limits.session_bytes,
    )?;
    within(
        Resource::Snapshot,
        add(prospective_snapshot_bytes, usage.control_reserve_bytes)?,
        limits.snapshot_bytes,
    )
}
#[derive(Debug, Clone, Copy)]
pub enum TransitionKind {
    Progress,
    /// New-deal log prefix is included in post_log_bytes, not double charged.
    Restart {
        new_epoch_prefix_bytes: usize,
    },
    Finish {
        record_bytes: usize,
        summary_bytes: usize,
    },
}
#[derive(Debug, Clone, Copy)]
pub struct PreparedUsage {
    pub post_log_bytes: usize,
    pub post_session_bytes: usize,
    pub post_snapshot_bytes: usize,
    pub chance_batch_bytes: usize,
    /// Must be derived from the actual prepared Game turn after chance ends.
    pub chance_settled: bool,
    pub kind: TransitionKind,
}
impl HandReservation {
    /// Admit a prospective native metadata edit without consuming a game/log
    /// step. A rename must not spend the hand's reserved public finish bytes.
    pub fn admit_metadata(
        &self,
        session_bytes: usize,
        snapshot_bytes: usize,
        remaining_control_bytes: usize,
    ) -> Result<Self, BudgetError> {
        if remaining_control_bytes == 0 {
            return Err(BudgetError::InvalidProfile);
        }
        let finish = if self.finished { 0 } else { self.finish_reserve_bytes };
        let normal = if self.finished {
            0
        } else {
            self.profile.normal_finish_log_bytes - self.normal_epoch_bytes
        };
        within(Resource::Session, add(session_bytes, finish)?, self.session_limit)?;
        within(
            Resource::Snapshot,
            add(add(add(snapshot_bytes, finish)?, normal)?, remaining_control_bytes)?,
            self.snapshot_limit,
        )?;
        Ok(Self {
            control_reserve_bytes: remaining_control_bytes,
            ..*self
        })
    }

    /// The coordinator remeasures the remaining closed control envelope at each
    /// prepared turn. Growth already present in the snapshot is not reserved twice.
    pub fn admit_with_control(&self, next: PreparedUsage, remaining_control_bytes: usize) -> Result<Self, BudgetError> {
        if remaining_control_bytes == 0 {
            return Err(BudgetError::InvalidProfile);
        }
        Self {
            control_reserve_bytes: remaining_control_bytes,
            ..*self
        }
        .admit(next)
    }

    pub fn remaining_normal_runway(&self) -> usize {
        if self.finished {
            0
        } else {
            self.profile.normal_finish_log_bytes - self.normal_epoch_bytes
        }
    }
    /// Pure guard returns a new reservation. Refusal leaves the original token
    /// unchanged; no Action/RNG or callback is accepted by this helper.
    pub fn admit(&self, next: PreparedUsage) -> Result<Self, BudgetError> {
        if self.finished || !next.chance_settled || next.post_log_bytes < self.used_log_bytes {
            return Err(BudgetError::InvalidTransition);
        }
        within(
            Resource::ChanceBatch,
            next.chance_batch_bytes,
            self.profile.max_chance_batch_bytes,
        )?;
        within(Resource::HandLog, next.post_log_bytes, self.max_log_bytes)?;
        within(Resource::Session, next.post_session_bytes, self.session_limit)?;
        within(Resource::Snapshot, next.post_snapshot_bytes, self.snapshot_limit)?;
        let delta = next.post_log_bytes - self.used_log_bytes;
        if delta == 0 || next.chance_batch_bytes > delta {
            return Err(BudgetError::InvalidTransition);
        }
        let epoch = match next.kind {
            TransitionKind::Restart { new_epoch_prefix_bytes } => {
                if !self.profile.permits_restart
                    || new_epoch_prefix_bytes == 0
                    || new_epoch_prefix_bytes > delta
                    || new_epoch_prefix_bytes > next.chance_batch_bytes
                {
                    return Err(BudgetError::InvalidTransition);
                }
                within(
                    Resource::HandLog,
                    add(
                        next.post_log_bytes,
                        self.profile.normal_finish_log_bytes - new_epoch_prefix_bytes,
                    )?,
                    self.max_log_bytes,
                )?;
                new_epoch_prefix_bytes
            }
            TransitionKind::Progress | TransitionKind::Finish { .. } => add(self.normal_epoch_bytes, delta)?,
        };
        within(Resource::HandLog, epoch, self.profile.normal_finish_log_bytes)?;
        if let TransitionKind::Finish {
            record_bytes,
            summary_bytes,
        } = next.kind
        {
            within(Resource::Record, record_bytes, self.profile.max_record_bytes)?;
            within(Resource::Summary, summary_bytes, self.profile.max_summary_bytes)?;
        }
        let finishing = matches!(next.kind, TransitionKind::Finish { .. });
        let future = if finishing {
            0
        } else {
            add(self.finish_reserve_bytes, self.profile.normal_finish_log_bytes - epoch)?
        };
        within(
            Resource::Session,
            add(
                next.post_session_bytes,
                if finishing { 0 } else { self.finish_reserve_bytes },
            )?,
            self.session_limit,
        )?;
        within(
            Resource::Snapshot,
            add(add(next.post_snapshot_bytes, future)?, self.control_reserve_bytes)?,
            self.snapshot_limit,
        )?;
        Ok(Self {
            used_log_bytes: next.post_log_bytes,
            normal_epoch_bytes: epoch,
            finished: finishing,
            ..*self
        })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn configured_resource_limits_preserve_exact_public_integers_and_allow_explicit_zero_quotas() {
        assert!(
            super::ResourceLimits {
                session_bytes: 0,
                snapshot_bytes: 0,
                hand_log_bytes: 0,
                archives: 0,
                period_records: 0,
                total_records: 0
            }
            .validate()
            .is_ok()
        );
        assert!(
            super::ResourceLimits {
                archives: crate::command_protocol::MAX_COMMAND_SEQUENCE as usize + 1,
                ..Default::default()
            }
            .validate()
            .is_err()
        );
    }

    use super::*;
    use serde_json::json;
    fn usage() -> RetainedUsage {
        RetainedUsage {
            control_reserve_bytes: 64 * KIB,
            ..Default::default()
        }
    }
    fn prepared(log: usize, kind: TransitionKind) -> PreparedUsage {
        PreparedUsage {
            post_log_bytes: log,
            post_session_bytes: 100,
            post_snapshot_bytes: 100,
            chance_batch_bytes: 0,
            chance_settled: true,
            kind,
        }
    }
    #[test]
    fn json_limit_counts_utf8_escaping_and_never_returns_a_partial_payload() {
        let value = json!({"name":"한글\n\""});
        let expected = serde_json::to_vec(&value).unwrap();
        assert_eq!(
            serialized_size_capped(&value, Resource::Session, expected.len()).unwrap(),
            expected.len()
        );
        assert_eq!(
            serialize_capped(&value, Resource::Session, expected.len()).unwrap(),
            expected
        );
        assert_eq!(
            serialize_capped(&value, Resource::Session, expected.len() - 1),
            Err(BudgetError::Capacity {
                resource: Resource::Session,
                limit: expected.len() - 1
            })
        );
        assert!(serialize_capped(&vec![0; 10000], Resource::Snapshot, 1).is_err());
    }
    #[test]
    fn registration_is_explicit_and_rules_size_is_not_inferred_from_ingress() {
        assert!(ResourceProfile::registered("future-game").is_none());
        let mut rules = mighty::rules::Rules::web_mighty();
        assert!(ResourceProfile::mighty(&rules).is_ok());
        rules.misdeal.card_values = vec![(mighty::card::Card::Joker(mighty::card::Color::Black), 0); 10000];
        assert!(matches!(
            ResourceProfile::mighty(&rules),
            Err(BudgetError::Capacity {
                resource: Resource::Rules,
                ..
            })
        ));
        assert!(
            ResourceProfile::poker(&poker::PokerRules {
                players: 6,
                starting_stack: 200
            })
            .is_ok()
        );
        assert!(
            ResourceProfile::poker(&poker::PokerRules {
                players: 7,
                starting_stack: 200
            })
            .is_err()
        );
    }
    #[test]
    fn start_reserves_record_twice_log_and_control_bytes_before_any_growth() {
        let limits = ResourceLimits::default();
        let profile = ResourceProfile::registered("mighty").unwrap();
        let initial = reserve_hand(limits, profile, usage()).unwrap();
        assert_eq!(initial.remaining_normal_runway(), MIB);
        assert!(
            reserve_hand(
                limits,
                profile,
                RetainedUsage {
                    period_records: limits.period_records,
                    ..usage()
                }
            )
            .is_err()
        );
        assert!(
            reserve_hand(
                limits,
                profile,
                RetainedUsage {
                    session_bytes: limits.session_bytes - profile.max_record_bytes,
                    ..usage()
                }
            )
            .is_err()
        );
        assert!(
            reserve_hand(
                limits,
                profile,
                RetainedUsage {
                    snapshot_bytes: limits.snapshot_bytes - 1,
                    ..usage()
                }
            )
            .is_err()
        );
        assert_eq!(
            reserve_hand(limits, profile, RetainedUsage::default()),
            Err(BudgetError::InvalidProfile)
        );
        assert_eq!(
            reserve_hand(
                ResourceLimits {
                    period_records: usize::MAX,
                    ..limits
                },
                profile,
                RetainedUsage {
                    period_records: usize::MAX,
                    ..usage()
                }
            ),
            Err(BudgetError::Arithmetic)
        );
    }
    #[test]
    fn restart_capacity_retains_a_normal_finish_runway_and_does_not_mutate_token() {
        let profile = ResourceProfile::registered("mighty").unwrap();
        let token = reserve_hand(ResourceLimits::default(), profile, usage()).unwrap();
        let progressed = token.admit(prepared(800 * KIB, TransitionKind::Progress)).unwrap();
        let restart = PreparedUsage {
            chance_batch_bytes: 4 * KIB,
            ..prepared(
                900 * KIB,
                TransitionKind::Restart {
                    new_epoch_prefix_bytes: 4 * KIB,
                },
            )
        };
        let next = progressed.admit(restart).unwrap();
        assert_eq!(next.remaining_normal_runway(), MIB - 4 * KIB);
        let denied = next.admit(PreparedUsage {
            chance_batch_bytes: 4 * KIB,
            ..prepared(
                1200 * KIB,
                TransitionKind::Restart {
                    new_epoch_prefix_bytes: 4 * KIB,
                },
            )
        });
        assert!(matches!(
            denied,
            Err(BudgetError::Capacity {
                resource: Resource::HandLog,
                ..
            })
        ));
        assert_eq!(next.used_log_bytes, 900 * KIB);
        assert!(
            next.admit(prepared(1500 * KIB, TransitionKind::Progress)).is_ok(),
            "restart refusal does not consume the retained finishing runway"
        );
        assert!(
            next.admit(prepared(
                1800 * KIB,
                TransitionKind::Finish {
                    record_bytes: profile.max_record_bytes,
                    summary_bytes: profile.max_summary_bytes
                }
            ))
            .is_ok()
        );
    }
    #[test]
    fn partial_chance_oversized_chance_and_false_restart_are_never_admitted() {
        let token = reserve_hand(
            ResourceLimits::default(),
            ResourceProfile::registered("poker").unwrap(),
            usage(),
        )
        .unwrap();
        assert_eq!(
            token.admit(PreparedUsage {
                chance_settled: false,
                ..prepared(1, TransitionKind::Progress)
            }),
            Err(BudgetError::InvalidTransition)
        );
        assert!(
            token
                .admit(PreparedUsage {
                    chance_batch_bytes: 8 * KIB,
                    ..prepared(8 * KIB, TransitionKind::Progress)
                })
                .is_err()
        );
        assert_eq!(
            token.admit(prepared(
                1,
                TransitionKind::Restart {
                    new_epoch_prefix_bytes: 0
                }
            )),
            Err(BudgetError::InvalidTransition)
        );
        assert!(
            token
                .admit(prepared(
                    1,
                    TransitionKind::Finish {
                        record_bytes: 33 * KIB,
                        summary_bytes: 1
                    }
                ))
                .is_err()
        );
        assert_eq!(token.used_log_bytes, 0);
    }
    #[test]
    fn metadata_growth_cannot_spend_an_admitted_hand_completion_reserve() {
        let token = reserve_hand(
            ResourceLimits::default(),
            ResourceProfile::registered("mighty").unwrap(),
            RetainedUsage {
                snapshot_bytes: 3 * MIB,
                session_bytes: 2 * MIB,
                control_reserve_bytes: 38 * MIB,
                ..usage()
            },
        )
        .unwrap();
        let before = token.remaining_normal_runway();
        assert!(token.admit_metadata(3 * MIB, 4 * MIB, 37 * MIB).is_err());
        let admitted = token.admit_metadata(2500 * KIB, 4 * MIB, 37 * MIB).unwrap();
        assert_eq!(admitted.remaining_normal_runway(), before);
        assert_eq!(token.control_reserve_bytes, 38 * MIB);
    }

    #[test]
    fn restored_restart_prefix_retains_exact_remaining_normal_completion_runway() {
        let limits = ResourceLimits::default();
        let profile = ResourceProfile::registered("mighty").unwrap();
        let restored_usage = RetainedUsage {
            snapshot_bytes: 3 * MIB,
            session_bytes: MIB,
            control_reserve_bytes: 38 * MIB,
            ..usage()
        };
        let resumed = resume_hand(limits, profile, restored_usage, 1900 * KIB, 900 * KIB).unwrap();
        assert_eq!(resumed.remaining_normal_runway(), 124 * KIB);
        assert!(
            resumed
                .admit(PreparedUsage {
                    post_snapshot_bytes: 3 * MIB + 124 * KIB,
                    post_session_bytes: MIB,
                    ..prepared(
                        2024 * KIB,
                        TransitionKind::Finish {
                            record_bytes: profile.max_record_bytes,
                            summary_bytes: profile.max_summary_bytes
                        }
                    )
                })
                .is_ok()
        );
        assert!(
            resume_hand(limits, profile, restored_usage, 2000 * KIB, 900 * KIB).is_err(),
            "unreservable legacy log cannot inherit a normal finish promise"
        );
    }

    #[test]
    fn remeasuring_remaining_control_growth_does_not_charge_it_twice() {
        let limits = ResourceLimits {
            snapshot_bytes: 44 * MIB,
            ..ResourceLimits::default()
        };
        let token = reserve_hand(
            limits,
            ResourceProfile::registered("mighty").unwrap(),
            RetainedUsage {
                snapshot_bytes: MIB,
                control_reserve_bytes: 38 * MIB,
                ..usage()
            },
        )
        .unwrap();
        let next = PreparedUsage {
            post_snapshot_bytes: 6 * MIB,
            ..prepared(1024, TransitionKind::Progress)
        };
        assert!(
            token.admit(next).is_err(),
            "a frozen original control reserve double-charges admitted metadata growth"
        );
        assert!(token.admit_with_control(next, 33 * MIB).is_ok());
        assert!(token.admit_with_control(next, 0).is_err());
    }

    #[test]
    fn archive_append_checks_exact_prospective_payload_without_compacting_any_data() {
        let limits = ResourceLimits::default();
        assert!(admit_archive(limits, usage(), 100, 100).is_ok());
        assert!(
            admit_archive(
                limits,
                RetainedUsage {
                    archives: limits.archives,
                    ..usage()
                },
                100,
                100
            )
            .is_err()
        );
        assert!(admit_archive(limits, usage(), limits.session_bytes + 1, 100).is_err());
        assert!(admit_archive(limits, usage(), 100, limits.snapshot_bytes).is_err());
    }

    #[test]
    fn staged_progress_cannot_spend_record_or_control_recovery_reserves() {
        let limits = ResourceLimits::default();
        let token = reserve_hand(limits, ResourceProfile::registered("mighty").unwrap(), usage()).unwrap();
        assert!(
            token
                .admit(PreparedUsage {
                    post_session_bytes: limits.session_bytes - 1,
                    ..prepared(1, TransitionKind::Progress)
                })
                .is_err()
        );
        assert!(
            token
                .admit(PreparedUsage {
                    post_snapshot_bytes: limits.snapshot_bytes - 1,
                    ..prepared(
                        1,
                        TransitionKind::Finish {
                            record_bytes: 1,
                            summary_bytes: 1
                        }
                    )
                })
                .is_err()
        );
        let mut forged = ResourceProfile::registered("mighty").unwrap();
        forged.normal_finish_log_bytes = 1;
        assert_eq!(reserve_hand(limits, forged, usage()), Err(BudgetError::InvalidProfile));
        assert_eq!(token.used_log_bytes, 0);
    }

    fn mighty_shape(rules: mighty::rules::Rules, bid_rows: usize) -> serde_json::Value {
        let n = rules.players;
        let plays: Vec<_> = rules
            .cards()
            .iter()
            .take(54)
            .enumerate()
            .map(|(i, card)| json!({"seat":i%n,"card":card,"powered":false}))
            .collect();
        let tricks: Vec<_> = plays
            .chunks(n)
            .map(|chunk| json!({"plays":chunk,"lead":{"Suit":"Diamond"},"winner":n-1}))
            .collect();
        let bids: Vec<_> = (0..bid_rows)
            .map(|i| json!({"seat":i%n,"contract":{"trump":"Diamond","count":255}}))
            .collect();
        let contract = json!({"trump":"Diamond","count":255});
        let cards = rules.cards();
        let score_steps = vec![json!({"BidBonus":{"points":255,"contract":255,"bonus":i64::MIN,"total":i64::MIN}}); 16];
        let view = json!({"viewer":"Spectator","rules":rules,"first_bidder":n-1,"hand":[],"hand_sizes":vec![0;n],"points_taken":vec![cards.clone();n],"bids":bids,"redealt":{"why":{"Misdeal":{"seat":n-1,"hand":cards}},"count":u32::MAX},"phase":{"Done":{"declarer":0,"friend":null,"contract":contract,"call":"Alone","team_points":20,"payoffs":vec![i64::MIN;n],"value":{"contract":contract,"team_points":20,"made":false,"steps":score_steps,"value":i64::MIN},"tricks":tricks,"discards":cards}}});
        json!({"session_id":u32::MAX,"number":u32::MAX,"names":vec!["\u{0001}".repeat(24);n],"participant_ids":vec!["a".repeat(128);n],"payoffs":vec![i64::MIN;n],"rules":rules,"view":view})
    }

    #[test]
    fn default_and_permissive_mighty_serialized_shapes_fit_the_certificate() {
        let default = mighty::rules::Rules::web_mighty();
        let profile = ResourceProfile::mighty(&default).unwrap();
        let ordinary = mighty_shape(default, 40);
        assert!(serialized_size_capped(&ordinary, Resource::Record, profile.max_record_bytes).is_ok());
        let mut permissive = mighty::rules::Rules::web_mighty();
        permissive.players = 8;
        permissive.hand_size = 6;
        permissive.bidding.max = 255;
        permissive.bidding.no_trump_bonus = 0;
        permissive.bidding.pass_is_final = false;
        // Native validation currently accepts repeated override entries. This
        // fills a real variable-length rules member near the explicit byte cap.
        loop {
            let mut next = permissive.clone();
            next.misdeal
                .card_values
                .push((mighty::card::Card::Normal(mighty::card::Suit::Diamond, 2), 0));
            if serialized_size_capped(&next, Resource::Rules, 64 * KIB).is_err() {
                break;
            }
            permissive = next;
        }
        permissive.validate().unwrap();
        let profile = ResourceProfile::mighty(&permissive).unwrap();
        let rules_bytes = serialized_size_capped(&permissive, Resource::Rules, 64 * KIB).unwrap();
        assert!(rules_bytes > 63 * KIB);
        let worst_shape = mighty_shape(permissive, MAX_MIGHTY_BID_ROWS);
        let typed_view: mighty::View = serde_json::from_value(worst_shape["view"].clone()).unwrap();
        assert_eq!(typed_view.bids.len(), MAX_MIGHTY_BID_ROWS);
        let bytes = serialized_size_capped(&worst_shape, Resource::Record, profile.max_record_bytes).unwrap();
        let mut utf8_shape = worst_shape.clone();
        utf8_shape["names"] = json!(vec!["가".repeat(24); 8]);
        assert!(serialized_size_capped(&utf8_shape, Resource::Record, profile.max_record_bytes).is_ok());
        assert!(
            bytes > 128 * KIB,
            "native certificate is distinct from the disclosure's 128KiB acceptance boundary"
        );
        // This is a structural upper-envelope fixture, not a reachable play
        // trace or timing claim. Legal rank ordering is proved independently.
        let mut log: Vec<_> = (0..MAX_MIGHTY_BID_ROWS)
            .map(|_| json!({"kind":"act","seat":7,"action":{"Bid":{"trump":"Diamond","count":255}}}))
            .collect();
        let card = mighty::card::Card::Normal(mighty::card::Suit::Diamond, 14);
        log.push(json!({"kind":"chance","action":{"Deal":{"hands":vec![vec![card;7];8],"kitty":vec![card;54]}}}));
        for _ in 0..54 {
            log.push(json!({"kind":"act","seat":7,"action":{"Discard":card}}));
            log.push(json!({"kind":"act","seat":7,"action":{"Play":{"card":card,"joker_lead":{"Color":"Black"},"call_joker":false}}}));
        }
        log.push(json!({"kind":"act","seat":7,"action":{"Raise":{"trump":"Diamond","count":255}}}));
        log.push(json!({"kind":"act","seat":7,"action":{"CallFriend":{"Card":card}}}));
        assert!(serialized_size_capped(&log, Resource::HandLog, profile.normal_finish_log_bytes).is_ok());
    }

    #[test]
    fn maximum_poker_player_pot_and_action_shapes_fit_the_certificate() {
        let rules = poker::PokerRules {
            players: 6,
            starting_stack: 200,
        };
        let profile = ResourceProfile::poker(&rules).unwrap();
        let card = json!({"rank":14,"suit":"diamonds"});
        let pots: Vec<_> = (0..6).map(|_| json!({"amount":1200,"winners":[0,1,2,3,4,5]})).collect();
        let players:Vec<_>=(0..6).map(|_|json!({"stack":1200,"contributed":200,"street_bet":200,"folded":false,"all_in":false,"hole_count":2,"hole":[card,card],"shown":true})).collect();
        let record = json!({"session_id":u32::MAX,"number":u32::MAX,"names":vec!["가".repeat(24);6],"participant_ids":vec!["a".repeat(128);6],"payoffs":vec![1200;6],"rules":rules,"view":{"viewer":null,"dealer":5,"street":"river","actor":null,"board":vec![card;5],"players":players,"pot":1200,"current_bet":200,"min_raise_to":200,"showdown":true,"over":true,"pots":pots,"refunds":vec![200;6],"payoffs":vec![1200;6]}});
        assert!(serialized_size_capped(&record, Resource::Record, profile.max_record_bytes).is_ok());
        let mut log: Vec<_> = (0..MAX_POKER_LOG_ENTRIES)
            .map(|_| json!({"kind":"act","seat":5,"action":{"type":"raise_to","amount":200}}))
            .collect();
        log.push(json!({"kind":"chance","action":{"type":"deal","deck":(0..52).collect::<Vec<_>>()}}));
        assert!(serialized_size_capped(&log, Resource::HandLog, profile.normal_finish_log_bytes).is_ok());
    }

    #[test]
    fn finished_reservation_retires_normal_runway_and_cannot_advance_again() {
        let token = reserve_hand(
            ResourceLimits::default(),
            ResourceProfile::registered("poker").unwrap(),
            usage(),
        )
        .unwrap();
        let done = token
            .admit(prepared(
                100,
                TransitionKind::Finish {
                    record_bytes: 100,
                    summary_bytes: 10,
                },
            ))
            .unwrap();
        assert_eq!(done.remaining_normal_runway(), 0);
        assert_eq!(
            done.admit(prepared(101, TransitionKind::Progress)),
            Err(BudgetError::InvalidTransition)
        );
    }

    #[test]
    fn chance_bytes_must_be_in_the_staged_log_and_empty_transitions_are_refused() {
        let token = reserve_hand(
            ResourceLimits::default(),
            ResourceProfile::registered("mighty").unwrap(),
            usage(),
        )
        .unwrap();
        assert_eq!(
            token.admit(prepared(0, TransitionKind::Progress)),
            Err(BudgetError::InvalidTransition)
        );
        assert_eq!(
            token.admit(PreparedUsage {
                chance_batch_bytes: 100,
                ..prepared(1, TransitionKind::Progress)
            }),
            Err(BudgetError::InvalidTransition)
        );
    }
    #[test]
    fn payout_bounds_cover_custom_scoring_extremes_and_all_poker_initial_chips() {
        use mighty::rules::{BackRun, Contract, Doubling, LoseScore, WinScore};
        let mut rules = mighty::rules::Rules::web_mighty();
        rules.players = 8;
        rules.hand_size = 6;
        rules.scoring.no_trump = Doubling::Always;
        rules.scoring.alone = Doubling::Always;
        rules.scoring.full_contract = Doubling::Always;
        rules.scoring.run = true;
        rules.scoring.back_run = BackRun::TeamAtMost(255);
        let limit = ResourceProfile::mighty(&rules).unwrap().max_payoff();
        // Broad typed-u8 formula envelope: base<=255+2*510, <=5 doublings,
        // <=7 opposing seats. Misdeal card-value overrides never enter payout.
        assert!((255 + 2 * 510) * 32 * 7 < limit);
        for win in [
            WinScore::OverTen,
            WinScore::OverMin,
            WinScore::OverBid,
            WinScore::BidBonus,
            WinScore::BothOver(0),
            WinScore::BothOver(255),
        ] {
            for lose in [LoseScore::Shortfall, LoseScore::PaysBack(0), LoseScore::PaysBack(255)] {
                for bonus in [0, 1, 254] {
                    for minimum in [1, 255] {
                        rules.scoring.win = win;
                        rules.scoring.lose = lose;
                        rules.bidding.no_trump_bonus = bonus;
                        rules.bidding.min = minimum;
                        for count in [1, 20, 254, 255] {
                            for points in [0, 19, 20, 254, 255] {
                                let contract = Contract { trump: None, count };
                                for (friend, call) in [
                                    (None, mighty::FriendCall::Alone),
                                    (Some(1), mighty::FriendCall::Seat(1)),
                                ] {
                                    let payoffs = mighty::world::settle(&rules, 0, friend, contract, call, points);
                                    assert!(payoffs.into_iter().all(|amount| (-limit..=limit).contains(&amount)));
                                }
                            }
                        }
                    }
                }
            }
        }
        let poker = poker::PokerRules {
            players: 6,
            starting_stack: 200,
        };
        assert_eq!(ResourceProfile::poker(&poker).unwrap().max_payoff(), 6 * 200);
    }
}
