//! Native admission seams. A certificate is tied to canonical frozen rules;
//! unknown games receive no guessed resource promise.
use super::Room;
use crate::{
    game::ServerGame,
    resource_budget::{
        BudgetError, HandReservation, KIB, MIB, PreparedUsage, Resource, ResourceProfile, RetainedUsage,
        TransitionKind, reserve_hand, resume_hand, serialized_size_capped,
    },
};
pub(super) const COMMAND_CONTROL_BYTES: usize = 34 * MIB;
pub(super) const LIFECYCLE_CONTROL_BYTES: usize = 4 * MIB;
const CONTROL_TAIL_BYTES: usize = 64 * KIB;
const TURN_METADATA_BYTES: usize = 16 * KIB;
// Finite recovery allowance, separate from the normal hand and each admitted
// socket's guaranteed cleanup. Optional metadata cannot spend this allowance.
const RECOVERY_REVISIONS: usize = 4096;
#[derive(Default)]
pub(super) struct NativeResources {
    pub reservation: Option<HandReservation>,
    pub profile: Option<ResourceProfile>,
    pub held: Option<BudgetError>,
    pub held_is_legacy: bool,
    pub persistence_refusal: Option<BudgetError>,
    pub restart_allowed: bool,
    pub pass_restarts: bool,
    pub restart_refusal: Option<BudgetError>,
    changed: bool,
    policy_initialized: bool,
    #[cfg(test)]
    policy_refreshes: usize,
}
impl NativeResources {
    pub(super) fn admitted(profile: ResourceProfile, reservation: HandReservation) -> Self {
        Self {
            profile: Some(profile),
            reservation: Some(reservation),
            ..Self::default()
        }
    }
}
fn refusal(error: BudgetError) -> crate::protocol::ServerError {
    crate::protocol::ServerError::with_detail(crate::protocol::ErrorCode::ResourceCapacity, format!("{error:?}"))
}
fn checked_add(a: usize, b: usize) -> Result<usize, BudgetError> {
    a.checked_add(b).ok_or(BudgetError::Arithmetic)
}

impl<G: ServerGame> Room<G> {
    pub(super) fn resource_usage(&self) -> Result<RetainedUsage, BudgetError> {
        let limits = self.env.resources;
        let (archives, period_records, total_records) = self.retained_counts(limits)?;
        serialized_size_capped(&self.settings, Resource::Settings, 256 * KIB)?;
        if let Some(context) = &self.hand.replay_context {
            serialized_size_capped(context, Resource::Settings, 256 * KIB)?;
        }
        Ok(RetainedUsage {
            session_bytes: serialized_size_capped(
                &self.session_envelope_ref(),
                Resource::Session,
                limits.session_bytes,
            )?,
            snapshot_bytes: serialized_size_capped(&self.snapshot_ref(), Resource::Snapshot, limits.snapshot_bytes)?,
            archives,
            period_records,
            total_records,
            control_reserve_bytes: checked_add(self.resource_control_headroom()?, CONTROL_TAIL_BYTES)?,
        })
    }
    fn score_capacity() -> BudgetError {
        BudgetError::Capacity {
            resource: Resource::Score,
            limit: crate::command_protocol::MAX_COMMAND_SEQUENCE as usize,
        }
    }
    fn safe_score(value: i64, change: i64) -> Result<i64, BudgetError> {
        let total = value.checked_add(change).ok_or_else(Self::score_capacity)?;
        let limit = crate::command_protocol::MAX_COMMAND_SEQUENCE as i64;
        if !(-limit..=limit).contains(&total) {
            return Err(Self::score_capacity());
        }
        Ok(total)
    }
    fn require_score_checkpoint(&self) -> Result<(), BudgetError> {
        for score in self.session.scores.iter().chain(self.session.history.iter().flatten()) {
            Self::safe_score(*score, 0)?;
        }
        for person in self.lifecycle.standings.values() {
            Self::safe_score(person.score, 0)?;
        }
        if !self.recorded_scores_fit(crate::command_protocol::MAX_COMMAND_SEQUENCE as i64) {
            return Err(Self::score_capacity());
        }
        Ok(())
    }
    fn require_score_runway(&self, profile: ResourceProfile, start: bool) -> Result<(), BudgetError> {
        let delta = profile.max_payoff();
        for score in &self.session.scores {
            Self::safe_score(*score, delta)?;
            Self::safe_score(*score, -delta)?;
        }
        let members = if start || self.lifecycle.hand_members.len() != self.seating.len() {
            (0..self.seating.len())
                .map(|seat| self.member(seat))
                .collect::<Vec<_>>()
        } else {
            self.lifecycle.hand_members.clone()
        };
        let mut identities = std::collections::BTreeSet::new();
        for person in members {
            if !identities.insert(person.id.clone()) {
                return Err(BudgetError::InvalidTransition);
            }
            let score = self.lifecycle.standings.get(&person.id).map_or(0, |entry| entry.score);
            Self::safe_score(score, delta)?;
            Self::safe_score(score, -delta)?;
        }
        Ok(())
    }
    fn require_finished_scores(
        &self,
        profile: ResourceProfile,
        payoffs: &[i64],
        start: bool,
    ) -> Result<(), BudgetError> {
        if payoffs.len() != self.seating.len() {
            return Err(BudgetError::InvalidTransition);
        }
        let mut identities = std::collections::BTreeSet::new();
        for (seat, payoff) in payoffs.iter().enumerate() {
            if !(-profile.max_payoff()..=profile.max_payoff()).contains(payoff) {
                return Err(BudgetError::InvalidTransition);
            }
            Self::safe_score(self.session.scores[seat], *payoff)?;
            let person = if !start && self.lifecycle.hand_members.len() == self.seating.len() {
                self.lifecycle.hand_members[seat].clone()
            } else {
                self.member(seat)
            };
            if !identities.insert(person.id.clone()) {
                return Err(BudgetError::InvalidTransition);
            }
            let score = self.lifecycle.standings.get(&person.id).map_or(0, |entry| entry.score);
            Self::safe_score(score, *payoff)?;
        }
        if self.session.hands_played == u32::MAX {
            return Err(BudgetError::Capacity {
                resource: Resource::HandNumber,
                limit: u32::MAX as usize,
            });
        }
        Ok(())
    }

    fn version_capacity(resource: Resource) -> BudgetError {
        BudgetError::Capacity {
            resource,
            limit: crate::command_protocol::MAX_COMMAND_SEQUENCE as usize,
        }
    }
    fn require_counter(version: u64, steps: usize, resource: Resource) -> Result<(), BudgetError> {
        let steps = u64::try_from(steps).map_err(|_| BudgetError::Arithmetic)?;
        if version
            .checked_add(steps)
            .is_none_or(|end| end > crate::command_protocol::MAX_COMMAND_SEQUENCE)
        {
            return Err(Self::version_capacity(resource));
        }
        Ok(())
    }
    pub(super) fn normal_revision_steps(
        hand: &super::hand::Hand<G>,
        profile: ResourceProfile,
    ) -> Result<usize, BudgetError> {
        if !hand.in_hand() {
            return Ok(0);
        }
        let epoch_start = if profile.permits_restart() {
            hand.log
                .iter()
                .rposition(|entry| matches!(entry, super::hand::LogEntry::Chance { .. }))
                .unwrap_or(0)
        } else {
            0
        };
        let used = serialized_size_capped(
            &hand.log[epoch_start..],
            Resource::HandLog,
            profile.normal_finish_log_bytes(),
        )?;
        // Every future game transition writes at least one byte. Two additional
        // revision fences cover policy/finish publication independent of moves.
        checked_add(profile.normal_finish_log_bytes().saturating_sub(used), 2)
    }
    pub(super) fn require_room_control(&self, optional: bool, new_connection: bool) -> Result<(), BudgetError> {
        let finish = if self.hand.in_hand() {
            Self::normal_revision_steps(&self.hand, ResourceProfile::table::<G>(&self.settings)?)?
        } else {
            0
        };
        let cleanup = checked_add(self.seating.conns.len(), usize::from(new_connection))?;
        let steps = checked_add(
            checked_add(checked_add(finish, cleanup)?, 1)?,
            if optional { RECOVERY_REVISIONS } else { 0 },
        )?;
        Self::require_counter(self.commands.room_version, steps, Resource::RoomVersion)
    }
    /// A new socket's Connect, unchanged Observe, reclaim Join and eventual
    /// Disconnect all require distinct revisions. This is entry eligibility,
    /// not authorization or a promise of unlimited future recovery.
    pub(super) fn refresh_committed_entry_status(&self) {
        let result = (|| {
            let finish = if self.hand.in_hand() {
                Self::normal_revision_steps(&self.hand, ResourceProfile::table::<G>(&self.settings)?)?
            } else {
                0
            };
            Self::require_counter(
                self.commands.room_version,
                checked_add(checked_add(finish, self.seating.conns.len())?, 4)?,
                Resource::RoomVersion,
            )
        })();
        *self.committed_entry_refusal.lock().expect("entry status lock") = result
            .err()
            .map(|error| crate::protocol::NativeCapacityReason::from_budget(&error, false));
    }

    pub(super) fn require_game_edit_revision(&self) -> Result<(), crate::protocol::ServerError> {
        Self::require_counter(self.hand.version, 1, Resource::GameVersion).map_err(refusal)
    }

    pub(super) fn require_optional_room_control(&self) -> Result<(), crate::protocol::ServerError> {
        self.require_room_control(true, false).map_err(refusal)
    }
    fn require_version_runway(&self, remaining_steps: usize) -> Result<(), BudgetError> {
        Self::require_counter(self.hand.version, remaining_steps, Resource::GameVersion)?;
        Self::require_counter(
            self.commands.room_version,
            checked_add(remaining_steps, self.seating.conns.len())?,
            Resource::RoomVersion,
        )
    }
    pub(super) fn native_start_baseline(&self) -> Result<(ResourceProfile, HandReservation), BudgetError> {
        if self.session.hands_played == u32::MAX {
            return Err(BudgetError::Capacity {
                resource: Resource::HandNumber,
                limit: u32::MAX as usize,
            });
        }
        let profile = ResourceProfile::table::<G>(&self.settings)?;
        self.require_score_runway(profile, true)?;
        // Every version increment appends at least one log byte; include the
        // initial start/deal fence. This is conservative, independent of cards.
        self.require_version_runway(checked_add(
            checked_add(self.env.resources.hand_log_bytes, 2)?,
            RECOVERY_REVISIONS,
        )?)?;
        let reservation = reserve_hand(self.env.resources, profile, self.resource_usage()?)?;
        Ok((profile, reservation))
    }

    fn resumed_reservation(&self) -> Result<(ResourceProfile, HandReservation), BudgetError> {
        let profile = ResourceProfile::table::<G>(&self.settings)?;
        if self.session.hands_played == u32::MAX {
            return Err(BudgetError::Capacity {
                resource: Resource::HandNumber,
                limit: u32::MAX as usize,
            });
        }
        self.require_score_runway(profile, false)?;
        let usage = self.resource_usage()?;
        let log_bytes = serialized_size_capped(&self.hand.log, Resource::HandLog, self.env.resources.hand_log_bytes)?;
        let epoch_start = if profile.permits_restart() {
            self.hand
                .log
                .iter()
                .rposition(|entry| matches!(entry, super::hand::LogEntry::Chance { .. }))
                .unwrap_or(0)
        } else {
            0
        };
        let epoch_bytes = serialized_size_capped(
            &self.hand.log[epoch_start..],
            Resource::HandLog,
            profile.normal_finish_log_bytes(),
        )?;
        self.require_version_runway(profile.normal_finish_log_bytes().saturating_sub(epoch_bytes))?;
        let reservation = resume_hand(self.env.resources, profile, usage, log_bytes, epoch_bytes)?;
        Ok((profile, reservation))
    }
    pub(super) fn ensure_native_reservation(&mut self) -> Result<(), crate::protocol::ServerError> {
        if let Some(error) = self.resources.held.clone() {
            return Err(refusal(error));
        }
        if self.resources.reservation.is_some() {
            return Ok(());
        }
        match self.resumed_reservation() {
            Ok((profile, reservation)) => {
                self.resources.profile = Some(profile);
                self.resources.reservation = Some(reservation);
                Ok(())
            }
            Err(error) => {
                self.resources.held = Some(error.clone());
                self.resources.changed = true;
                Err(refusal(error))
            }
        }
    }
    fn admit_native_candidate(
        &self,
        profile: ResourceProfile,
        reservation: HandReservation,
        hand: &super::hand::Hand<G>,
        advanced: &super::hand::Advanced<G>,
        start: bool,
    ) -> Result<HandReservation, BudgetError> {
        let remaining = Self::normal_revision_steps(hand, profile)?;
        Self::require_counter(hand.version, remaining, Resource::GameVersion)?;
        Self::require_counter(
            self.commands.room_version,
            checked_add(checked_add(remaining, self.seating.conns.len())?, 1)?,
            Resource::RoomVersion,
        )?;
        let usage = self.resource_usage()?;
        let limits = self.env.resources;
        let log_bytes = serialized_size_capped(&hand.log, Resource::HandLog, limits.hand_log_bytes)?;
        let old_log_bytes = if start {
            0
        } else {
            serialized_size_capped(&self.hand.log, Resource::HandLog, limits.hand_log_bytes)?
        };
        let delta = log_bytes
            .checked_sub(old_log_bytes)
            .ok_or(BudgetError::InvalidTransition)?;
        let chance_bytes = if advanced.dealt {
            serialized_size_capped(
                &hand.log[advanced.chance_start..],
                Resource::ChanceBatch,
                profile.max_chance_batch_bytes(),
            )?
        } else {
            0
        };
        let mut growth = TURN_METADATA_BYTES;
        let kind = if let Some(finished) = &advanced.finished {
            self.require_finished_scores(profile, &finished.payoffs, start)?;
            let game = hand.game.as_ref().ok_or(BudgetError::InvalidTransition)?;
            let record = self.prepared_record(game, &finished.payoffs);
            let record_bytes = serialized_size_capped(&record, Resource::Record, profile.max_record_bytes())?;
            let summary_bytes =
                serialized_size_capped(&finished.summary, Resource::Summary, profile.max_summary_bytes())?;
            growth = checked_add(
                growth,
                checked_add(checked_add(record_bytes, record_bytes)?, summary_bytes)?,
            )?;
            TransitionKind::Finish {
                record_bytes,
                summary_bytes,
            }
        } else if !start && advanced.dealt && profile.permits_restart() {
            TransitionKind::Restart {
                new_epoch_prefix_bytes: chance_bytes,
            }
        } else {
            TransitionKind::Progress
        };
        reservation.admit_with_control(
            PreparedUsage {
                post_log_bytes: log_bytes,
                post_session_bytes: checked_add(usage.session_bytes, growth)?,
                post_snapshot_bytes: checked_add(checked_add(usage.snapshot_bytes, delta)?, growth)?,
                chance_batch_bytes: chance_bytes,
                chance_settled: hand.turn().is_none_or(|turn| turn != engine::Turn::Chance),
                kind,
            },
            usage.control_reserve_bytes,
        )
    }
    pub(super) fn reserve_native_start(
        &self,
        baseline: (ResourceProfile, HandReservation),
        hand: &super::hand::Hand<G>,
        advanced: &super::hand::Advanced<G>,
    ) -> Result<(ResourceProfile, HandReservation), crate::protocol::ServerError> {
        let (profile, reservation) = baseline;
        self.admit_native_candidate(profile, reservation, hand, advanced, true)
            .map(|reservation| (profile, reservation))
            .map_err(refusal)
    }
    pub(super) fn reserve_native_action(
        &mut self,
        hand: &super::hand::Hand<G>,
        advanced: &super::hand::Advanced<G>,
    ) -> Result<HandReservation, crate::protocol::ServerError> {
        self.ensure_native_reservation()?;
        let result = self.admit_native_candidate(
            self.resources.profile.expect("validated profile"),
            self.resources.reservation.expect("validated reservation"),
            hand,
            advanced,
            false,
        );
        match result {
            Ok(reservation) => Ok(reservation),
            Err(error) => {
                if !(advanced.dealt && self.resources.profile.is_some_and(|profile| profile.permits_restart())) {
                    self.resources.held = Some(error.clone());
                    self.resources.changed = true;
                }
                Err(refusal(error))
            }
        }
    }

    pub(super) fn guard_native_name_growth(
        &mut self,
        public_growth: usize,
    ) -> Result<(), crate::protocol::ServerError> {
        let guard = || {
            let usage = self.resource_usage()?;
            let session = checked_add(usage.session_bytes, public_growth)?;
            // Up to1024 aliases plus current seats can share an actor. Their
            // private rename expansion is bounded separately by the control cap.
            let snapshot = checked_add(checked_add(usage.snapshot_bytes, public_growth)?, 256 * KIB)?;
            if self.hand.in_hand() {
                let (profile, resumed) = self.resumed_reservation()?;
                let reservation = self.resources.reservation.unwrap_or(resumed);
                let _ = profile;
                reservation.admit_metadata(
                    checked_add(session, TURN_METADATA_BYTES)?,
                    snapshot,
                    usage.control_reserve_bytes,
                )?;
            } else {
                if checked_add(session, TURN_METADATA_BYTES)? > self.env.resources.session_bytes {
                    return Err(BudgetError::Capacity {
                        resource: Resource::Session,
                        limit: self.env.resources.session_bytes,
                    });
                }
                if checked_add(snapshot, usage.control_reserve_bytes)? > self.env.resources.snapshot_bytes {
                    return Err(BudgetError::Capacity {
                        resource: Resource::Snapshot,
                        limit: self.env.resources.snapshot_bytes,
                    });
                }
            }
            Ok(())
        };
        guard().map_err(refusal)
    }

    pub(super) fn require_restart_policy(&self) -> Result<HandReservation, BudgetError> {
        let Some(profile) = self.resources.profile else {
            return Err(BudgetError::InvalidProfile);
        };
        if !profile.permits_restart() {
            return Err(BudgetError::InvalidProfile);
        }
        self.require_version_runway(checked_add(profile.normal_finish_log_bytes(), 3)?)?;
        let Some(reservation) = self.resources.reservation else {
            return Err(BudgetError::InvalidProfile);
        };
        let usage = self.resource_usage()?;
        let log = serialized_size_capped(&self.hand.log, Resource::HandLog, self.env.resources.hand_log_bytes)?;
        // The two restart-capable actions are unit variants; 128B also covers
        // the seat/log envelope. Reserve a maximum complete chance batch, and
        // assume only one byte of it reduces the new epoch's remaining runway.
        let delta = checked_add(profile.max_chance_batch_bytes(), 130)?;
        reservation.admit_with_control(
            PreparedUsage {
                post_log_bytes: checked_add(log, delta)?,
                post_session_bytes: checked_add(usage.session_bytes, TURN_METADATA_BYTES)?,
                post_snapshot_bytes: checked_add(checked_add(usage.snapshot_bytes, delta)?, TURN_METADATA_BYTES)?,
                chance_batch_bytes: profile.max_chance_batch_bytes(),
                chance_settled: true,
                kind: TransitionKind::Restart {
                    new_epoch_prefix_bytes: 1,
                },
            },
            usage.control_reserve_bytes,
        )
    }
    pub(super) fn policy_actions(&self, actions: &[G::Action]) -> Vec<G::Action> {
        if self.resources.held.is_some() {
            return vec![];
        }
        actions
            .iter()
            .filter(|action| {
                let any: &dyn std::any::Any = *action;
                match any.downcast_ref::<mighty::Action>() {
                    Some(mighty::Action::Misdeal) => self.resources.restart_allowed,
                    Some(mighty::Action::Pass) if self.resources.pass_restarts => self.resources.restart_allowed,
                    _ => true,
                }
            })
            .cloned()
            .collect()
    }
    pub(super) fn resource_policy_needs_refresh(&self) -> bool {
        !self.resources.policy_initialized || self.resources.changed
    }
    #[cfg(test)]
    pub(super) fn resource_policy_refreshes(&self) -> usize {
        self.resources.policy_refreshes
    }

    pub(super) fn refresh_resource_policy(&mut self) -> bool {
        self.resources.policy_initialized = true;
        #[cfg(test)]
        {
            self.resources.policy_refreshes += 1;
        }
        let changed = std::mem::take(&mut self.resources.changed);
        let before = (
            self.resources.held.clone(),
            self.resources.restart_allowed,
            self.resources.pass_restarts,
        );
        self.resources.restart_allowed = false;
        self.resources.pass_restarts = false;
        self.resources.restart_refusal = None;
        if self.hand.in_hand() && self.ensure_native_reservation().is_ok() {
            match self.resumed_reservation() {
                Ok((profile, reservation)) => {
                    self.resources.profile = Some(profile);
                    self.resources.reservation = Some(reservation);
                }
                Err(error) => self.resources.held = Some(error),
            }

            if self.resources.profile.is_some_and(|profile| profile.permits_restart()) {
                match self.require_restart_policy() {
                    Ok(_) => self.resources.restart_allowed = true,
                    Err(error @ BudgetError::Capacity { .. }) => self.resources.restart_refusal = Some(error),
                    Err(error) => self.resources.held = Some(error),
                }
            }
            if self.resources.held.is_none()
                && let Some(engine::Turn::Seat(seat)) = self.hand.turn()
            {
                let game = self.hand.game.as_ref().expect("hand");
                let legal = G::legal_actions(game, seat);
                for action in &legal {
                    let any: &dyn std::any::Any = action;
                    if matches!(any.downcast_ref::<mighty::Action>(), Some(mighty::Action::Pass)) {
                        let mut next = game.clone();
                        if G::apply(&mut next, seat, action.clone()).is_ok() && G::turn(&next) == engine::Turn::Chance {
                            self.resources.pass_restarts = true;
                        }
                    }
                }
                if self.policy_actions(&legal).is_empty() {
                    self.resources.held = Some(BudgetError::InvalidTransition);
                }
            }
        }
        changed
            || before
                != (
                    self.resources.held.clone(),
                    self.resources.restart_allowed,
                    self.resources.pass_restarts,
                )
    }

    /// Reopening is admission, not migration: no history is truncated and no
    /// candidate is progressed until both delivery and normal finish are safe.
    pub(crate) fn admit_restore(&mut self, delivery_limit: usize) -> Result<(), BudgetError> {
        let usage = self.resource_usage()?;
        self.require_score_checkpoint()?;
        self.require_room_control(false, true)?;
        let finish = if self.hand.in_hand() {
            Self::normal_revision_steps(&self.hand, ResourceProfile::table::<G>(&self.settings)?)?
        } else {
            0
        };
        Self::require_counter(
            self.commands.room_version,
            checked_add(finish, 4)?,
            Resource::RoomVersion,
        )?;
        let public_limit = self.env.resources.session_bytes.min(delivery_limit);
        let public_bytes = serialized_size_capped(&self.session_envelope_ref(), Resource::Session, public_limit)?;
        if checked_add(public_bytes, crate::resource_budget::SESSION_RECOVERY_BYTES)? > public_limit {
            return Err(BudgetError::Capacity {
                resource: Resource::Session,
                limit: public_limit,
            });
        }
        if checked_add(usage.snapshot_bytes, usage.control_reserve_bytes)? > self.env.resources.snapshot_bytes {
            return Err(BudgetError::Capacity {
                resource: Resource::Snapshot,
                limit: self.env.resources.snapshot_bytes,
            });
        }
        if self.hand.in_hand() {
            let (profile, reservation) = self.resumed_reservation()?;
            self.resources = NativeResources::admitted(profile, reservation);
        }
        Ok(())
    }

    pub(super) fn capacity_status(&self) -> crate::protocol::NativeCapacityStatus {
        use crate::protocol::{NativeCapacityReason as Reason, NativeCapacityStatus};
        let reason = Reason::from_budget;
        let start = self.native_start_baseline();
        let archive = self.preflight_archive(self.lifecycle.ended);
        let play = self.hand.in_hand() && self.resources.held.is_none() && self.resumed_reservation().is_ok();
        let explanation = self
            .resources
            .held
            .as_ref()
            .map(|error| reason(error, self.resources.held_is_legacy))
            .or_else(|| start.as_ref().err().map(|error| reason(error, false)))
            .or_else(|| archive.as_ref().err().map(|error| reason(error, false)))
            .or_else(|| {
                self.resources
                    .restart_refusal
                    .as_ref()
                    .map(|error| reason(error, false))
            });
        NativeCapacityStatus {
            can_start: start.is_ok(),
            can_archive: archive.is_ok(),
            can_play: play,
            reason: explanation,
        }
    }

    /// Remaining possible control growth after bounded canonical metadata
    /// validation. This number alone does not admit a hand or mutate the room.
    pub fn resource_control_headroom(&self) -> Result<usize, BudgetError> {
        let command = self.commands.resource_control_bytes(self.hand.version)?;
        let lifecycle = self.lifecycle_control_bytes()?;
        Ok((COMMAND_CONTROL_BYTES - command) + (LIFECYCLE_CONTROL_BYTES - lifecycle))
    }
}

#[cfg(test)]
mod tests {
    use crate::resource_budget::ResourceProfile;
    use crate::room::{Room, RoomEnv, mighty_bots};
    use std::{sync::Arc, time::Duration};
    #[test]
    fn score_headroom_refuses_start_without_mutation_and_reset_preserves_old_total() {
        use rand::Rng;
        let mut room = Room::<mighty::Mighty>::new(
            "score".into(),
            Default::default(),
            Arc::new(RoomEnv::new(Duration::ZERO)),
            mighty_bots(),
        );
        for seat in 0..room.seating.len() {
            room.add_bot(seat, engine::Level::Normal).unwrap();
        }
        room.session.scores[0] = crate::command_protocol::MAX_COMMAND_SEQUENCE as i64;
        let before = serde_json::to_vec(&room.snapshot_ref()).unwrap();
        let rng = room.rng.clone().random::<u64>();
        assert_eq!(
            room.start().unwrap_err().code,
            crate::protocol::ErrorCode::ResourceCapacity
        );
        assert_eq!(serde_json::to_vec(&room.snapshot_ref()).unwrap(), before);
        assert_eq!(room.rng.clone().random::<u64>(), rng);
        room.reset_scores().unwrap();
        assert_eq!(
            room.session_message().archives[0].summary["scores"][0],
            crate::command_protocol::MAX_COMMAND_SEQUENCE
        );
        room.start().unwrap();
    }

    #[test]
    fn unsafe_final_score_is_refused_before_committing_the_last_card() {
        use engine::Game;
        use rand::Rng;
        let mut room = dealt_room();
        for _ in 0..500 {
            let Some(engine::Turn::Seat(seat)) = room.hand.turn() else {
                panic!("unfinished hand");
            };
            let legal = mighty::Mighty::legal_actions(room.hand.game.as_ref().unwrap(), seat);
            let action = legal
                .iter()
                .find(|action| matches!(action, mighty::Action::Bid(_)))
                .or_else(|| {
                    legal.iter().find(|action| {
                        matches!(
                            action,
                            mighty::Action::Discard(_) | mighty::Action::CallFriend(mighty::FriendCall::Alone)
                        )
                    })
                })
                .or_else(|| legal.iter().find(|action| !matches!(action, mighty::Action::Misdeal)))
                .unwrap()
                .clone();
            let mut candidate = room.hand.game.clone().unwrap();
            mighty::Mighty::apply(&mut candidate, seat, action.clone()).unwrap();
            if mighty::Mighty::turn(&candidate) == engine::Turn::Over {
                let payoffs = mighty::Mighty::payoffs(&candidate).unwrap();
                let positive = payoffs.iter().position(|payoff| *payoff > 0).unwrap();
                room.session.scores[positive] = crate::command_protocol::MAX_COMMAND_SEQUENCE as i64;
                let before = serde_json::to_vec(&room.snapshot_ref()).unwrap();
                let rng = room.rng.clone().random::<u64>();
                assert_eq!(
                    room.apply_move(seat, action, "test").unwrap_err().code,
                    crate::protocol::ErrorCode::ResourceCapacity
                );
                assert_eq!(serde_json::to_vec(&room.snapshot_ref()).unwrap(), before);
                assert_eq!(room.rng.clone().random::<u64>(), rng);
                assert_eq!(room.session.hands_played, 0);
                return;
            }
            room.apply_move(seat, action, "test").unwrap();
            room.advance();
        }
        panic!("expected normal finished hand");
    }

    #[tokio::test]
    async fn duplicate_original_ids_cannot_amplify_standing_payoffs_on_restore() {
        let mut room = dealt_room();
        room.lifecycle.hand_members = (0..room.seating.len()).map(|seat| room.member(seat)).collect();
        room.lifecycle.hand_members[1].id = room.lifecycle.hand_members[0].id.clone();
        let person = room.lifecycle.hand_members[0].clone();
        room.lifecycle.standings.insert(
            person.id.clone(),
            crate::protocol::ParticipantResult {
                score: crate::command_protocol::MAX_COMMAND_SEQUENCE as i64 - 1_000_000,
                ..person
            },
        );
        let original = serde_json::to_vec(&room.snapshot_ref()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(format!("{}.json", room.id));
        std::fs::write(&path, &original).unwrap();
        let app = crate::AppState::new(crate::Config {
            data: Some(dir.path().into()),
            ..crate::Config::default()
        });
        assert_eq!(app.restore_rooms().unwrap(), 0);
        assert!(matches!(
            app.unavailable_reason(&room.id),
            Some(crate::protocol::NativeCapacityReason::UnreservableLegacy)
        ));
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }

    #[tokio::test]
    async fn archived_summary_scores_and_history_are_checked_without_record_view_projection() {
        for field in ["scores", "history"] {
            let mut room = dealt_room();
            prepare_finish(&mut room);
            room.advance();
            room.reset_scores().unwrap();
            let mut saved = serde_json::to_value(room.snapshot()).unwrap();
            saved["lifecycle"]["archives"][0]["summary"][field] = if field == "scores" {
                serde_json::json!([i64::MAX])
            } else {
                serde_json::json!([[i64::MAX]])
            };
            let original = serde_json::to_vec(&saved).unwrap();
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join(format!("{}.json", room.id));
            std::fs::write(&path, &original).unwrap();
            let app = crate::AppState::new(crate::Config {
                data: Some(dir.path().into()),
                ..crate::Config::default()
            });
            assert_eq!(app.restore_rooms().unwrap(), 0);
            assert!(matches!(
                app.unavailable_reason(&room.id),
                Some(crate::protocol::NativeCapacityReason::Capacity {
                    resource: crate::resource_budget::Resource::Score,
                    ..
                })
            ));
            assert_eq!(std::fs::read(&path).unwrap(), original);
        }
    }

    #[tokio::test]
    async fn unsafe_legacy_score_is_preserved_unavailable_instead_of_overflowing_after_replay() {
        let mut room = dealt_room();
        room.session.scores[0] = i64::MAX;
        let original = serde_json::to_vec(&room.snapshot_ref()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(format!("{}.json", room.id));
        std::fs::write(&path, &original).unwrap();
        let app = crate::AppState::new(crate::Config {
            data: Some(dir.path().into()),
            ..crate::Config::default()
        });
        assert_eq!(app.restore_rooms().unwrap(), 0);
        assert!(matches!(
            app.unavailable_reason(&room.id),
            Some(crate::protocol::NativeCapacityReason::Capacity {
                resource: crate::resource_budget::Resource::Score,
                ..
            })
        ));
        assert!(app.rooms.lock().is_empty());
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }

    #[tokio::test]
    async fn legacy_active_hand_without_normal_finish_runway_is_preserved_without_an_actor() {
        let room = dealt_room();
        let original = serde_json::to_vec(&room.snapshot_ref()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(format!("{}.json", room.id));
        std::fs::write(&path, &original).unwrap();
        let actual_log = serde_json::to_vec(&room.hand.log).unwrap().len();
        let app = crate::AppState::new(crate::Config {
            data: Some(dir.path().into()),
            resource_hand_log_bytes: actual_log + 64,
            ..crate::Config::default()
        });
        assert_eq!(app.restore_rooms().unwrap(), 0);
        assert!(app.rooms.lock().is_empty());
        assert!(app.unavailable_reason(&room.id).is_some());
        assert_eq!(app.shutdown(Duration::from_millis(10)).await, 0);
        assert_eq!(std::fs::read(&path).unwrap(), original);
        assert!(!path.with_extension("bad").exists());
    }

    #[test]
    fn largest_native_action_policy_packets_fit_existing_inert_client_budget() {
        use engine::Game;
        use rand::{SeedableRng, rngs::StdRng};
        fn nodes(value: &serde_json::Value) -> usize {
            1 + match value {
                serde_json::Value::Array(values) => values.iter().map(nodes).sum(),
                serde_json::Value::Object(values) => values.values().map(nodes).sum(),
                _ => 0,
            }
        }
        fn check<A: serde::Serialize>(label: &str, legal: &[A]) {
            let packet = serde_json::json!({"legal":legal,"out_of_turn":[],"policy":{"legal":legal,"out_of_turn":[]}});
            let size = nodes(&packet);
            eprintln!(
                "{label}: {} legal actions, {size} inert nodes with duplicated policy",
                legal.len()
            );
            assert!(legal.len() <= 4096);
            assert!(size <= 16384);
        }
        let mut rules = mighty::rules::Rules::web_mighty();
        rules.players = 2;
        rules.hand_size = 26;
        rules.bidding.min = 1;
        rules.bidding.max = 255;
        rules.bidding.allow_no_trump = true;
        rules.bidding.no_trump_bonus = 0;
        rules.bidding.raise_on_exchange = true;
        rules.bidding.change_trump_cost = 0;
        rules.bidding.change_to_no_trump_cost = Some(0);
        rules.validate().unwrap();
        let mut rng = StdRng::seed_from_u64(3);
        let mut game = mighty::Mighty::new_game(&mighty::Options { rules, first_bidder: 0 }).unwrap();
        let deal = mighty::Mighty::sample_chance(&game, &mut rng);
        mighty::Mighty::apply_chance(&mut game, deal).unwrap();
        let bidding = mighty::Mighty::legal_actions(&game, 0);
        assert!(bidding.len() > 1200);
        check("Mighty bidding", &bidding);
        mighty::Mighty::apply(
            &mut game,
            0,
            mighty::Action::Bid(mighty::rules::Contract {
                trump: Some(mighty::card::Suit::Spade),
                count: 1,
            }),
        )
        .unwrap();
        mighty::Mighty::apply(&mut game, 1, mighty::Action::Pass).unwrap();
        let exchange = mighty::Mighty::legal_actions(&game, 0);
        assert!(exchange.len() > 1200);
        check("Mighty exchange", &exchange);
        let mut poker = poker::Poker::new_game(&poker::PokerOptions {
            rules: poker::PokerRules {
                players: 6,
                starting_stack: 200,
            },
            dealer: 0,
            starting_stacks: vec![],
        })
        .unwrap();
        let deal = poker::Poker::sample_chance(&poker, &mut rng);
        poker::Poker::apply_chance(&mut poker, deal).unwrap();
        let engine::Turn::Seat(seat) = poker::Poker::turn(&poker) else {
            panic!("actor")
        };
        let legal = poker::Poker::legal_actions(&poker, seat);
        assert!(legal.len() > 190);
        check("Poker betting", &legal);
    }

    #[test]
    fn fresh_native_rooms_reserve_real_control_growth_and_completion_runway() {
        fn check<G: crate::game::ServerGame>(room: Room<G>) {
            use crate::resource_budget::{
                Resource, ResourceLimits, RetainedUsage, reserve_hand, serialized_size_capped,
            };
            let limits = ResourceLimits::default();
            let profile = ResourceProfile::table::<G>(&room.settings).unwrap();
            let usage = RetainedUsage {
                session_bytes: serialized_size_capped(&room.session_ref(), Resource::Session, limits.session_bytes)
                    .unwrap(),
                snapshot_bytes: serialized_size_capped(&room.snapshot_ref(), Resource::Snapshot, limits.snapshot_bytes)
                    .unwrap(),
                control_reserve_bytes: room.resource_control_headroom().unwrap(),
                ..RetainedUsage::default()
            };
            assert!(usage.control_reserve_bytes > 37 * crate::resource_budget::MIB);
            assert!(reserve_hand(limits, profile, usage).is_ok());
            assert!(
                reserve_hand(
                    ResourceLimits {
                        snapshot_bytes: 32 * crate::resource_budget::MIB,
                        ..limits
                    },
                    profile,
                    usage
                )
                .is_err()
            );
        }
        check(Room::<mighty::Mighty>::new(
            "mighty".into(),
            mighty::table::MightySettings::default(),
            Arc::new(RoomEnv::new(Duration::ZERO)),
            mighty_bots(),
        ));
        check(Room::<poker::Poker>::new(
            "poker".into(),
            poker::PokerSettings::default(),
            Arc::new(RoomEnv::new(Duration::ZERO)),
            Arc::new(poker::PokerBots),
        ));
    }

    fn dealt_room() -> Room<mighty::Mighty> {
        use engine::Game;
        let mut settings = mighty::table::MightySettings::default();
        let mut rules = mighty::rules::Rules::web_mighty();
        rules.bidding.first_bidder_may_pass = true;
        rules.bidding.last_chance_min = None;
        settings.rules = Some(rules);
        let mut room = Room::new(
            "staged".into(),
            settings,
            Arc::new(RoomEnv::new(Duration::ZERO)),
            mighty_bots(),
        );
        for seat in 0..room.seating.len() {
            room.add_bot(seat, engine::Level::Normal).unwrap();
        }
        let state = mighty::Mighty::new_game(&room.session.options(&room.settings, 0)).unwrap();
        room.hand.start(state, 0);
        room.hand.advance(&room.id, &mut room.rng);
        room
    }
    #[test]
    fn refused_start_preserves_seats_shuffle_scores_hand_and_rng() {
        use rand::Rng;
        let mut room = Room::<mighty::Mighty>::new(
            "capacity-start".into(),
            mighty::table::MightySettings::default(),
            Arc::new(RoomEnv::new(Duration::ZERO)),
            mighty_bots(),
        );
        for seat in 0..room.seating.len() {
            room.add_bot(seat, engine::Level::Normal).unwrap();
        }
        Arc::make_mut(&mut room.env).resources.period_records = 0;
        room.table.shuffle_next = true;
        let before = serde_json::to_vec(&room.snapshot_ref()).unwrap();
        let rng = room.rng.clone().random::<u64>();
        assert_eq!(
            room.start().unwrap_err().code,
            crate::protocol::ErrorCode::ResourceCapacity
        );
        assert_eq!(serde_json::to_vec(&room.snapshot_ref()).unwrap(), before);
        assert_eq!(room.rng.clone().random::<u64>(), rng);
        assert!(room.prepared_advance.is_none());
    }

    #[test]
    fn restart_exhaustion_filters_bot_choices_before_cognition_and_retains_normal_play() {
        use engine::Game;
        use rand::Rng;
        let mut room = dealt_room();
        Arc::make_mut(&mut room.env).resources.hand_log_bytes =
            crate::resource_budget::MIB + 4 * crate::resource_budget::KIB;
        room.advance();
        for _ in 1..room.seating.len() {
            let Some(engine::Turn::Seat(seat)) = room.hand.turn() else {
                panic!("bidder")
            };
            room.apply_move(seat, mighty::Action::Pass, "test").unwrap();
            room.advance();
        }
        let Some(engine::Turn::Seat(seat)) = room.hand.turn() else {
            panic!("last bidder")
        };
        let game_legal = mighty::Mighty::legal_actions(room.hand.game.as_ref().unwrap(), seat);
        assert!(game_legal.contains(&mighty::Action::Pass));
        let policy = room.policy_actions(&game_legal);
        assert!(!policy.contains(&mighty::Action::Pass));
        assert!(policy.iter().any(|action| matches!(action, mighty::Action::Bid(_))));
        let before = serde_json::to_vec(&room.snapshot_ref()).unwrap();
        let rng = room.rng.clone().random::<u64>();
        assert_eq!(
            room.apply_move(seat, mighty::Action::Pass, "human submitted restart")
                .unwrap_err()
                .code,
            crate::protocol::ErrorCode::ResourceCapacity
        );
        assert_eq!(serde_json::to_vec(&room.snapshot_ref()).unwrap(), before);
        assert_eq!(room.rng.clone().random::<u64>(), rng);
        assert!(room.resources.held.is_none());
        assert!(room.stand_in(seat, "pre-admitted normal choice"));
        let view = mighty::Mighty::view(room.hand.game.as_ref().unwrap(), engine::Viewer::Spectator);
        assert!(
            view.bids.last().unwrap().contract.is_some(),
            "the bot chose from admitted bids; no rejected-action fallback ran"
        );
        assert!(room.resources.held.is_none());
    }

    #[test]
    fn active_standing_rename_cannot_spend_reserved_finish_bytes() {
        use crate::resource_budget::{KIB, Resource, serialized_size_capped};
        use rand::Rng;
        let mut room = dealt_room();
        let (tx, _rx) = crate::outbound::test_channel();
        room.seating.conns.insert(99, super::super::seating::Conn::new(tx));
        room.observe(99, "a".into(), None).unwrap();
        let actor = room.visitor_id(99).unwrap();
        room.lifecycle.standings.insert(
            actor.clone(),
            crate::protocol::ParticipantResult {
                id: actor.clone(),
                name: "a".into(),
                bot: false,
                score: 0,
            },
        );
        let bytes = serialized_size_capped(
            &room.session_envelope_ref(),
            Resource::Session,
            4 * crate::resource_budget::MIB,
        )
        .unwrap();
        let profile = ResourceProfile::table::<mighty::Mighty>(&room.settings).unwrap();
        let finish = 2 * profile.max_record_bytes()
            + profile.max_summary_bytes()
            + 4 * KIB
            + crate::resource_budget::SESSION_RECOVERY_BYTES;
        let new_name = "\u{0001}".repeat(24);
        let growth = serialized_size_capped(&new_name, Resource::Session, 146).unwrap() - 3;
        Arc::make_mut(&mut room.env).resources.session_bytes = bytes + finish + 16 * KIB + growth - 1;
        room.ensure_native_reservation().unwrap();
        let before = serde_json::to_vec(&room.snapshot_ref()).unwrap();
        let rng = room.rng.clone().random::<u64>();
        assert_eq!(
            room.rename(99, new_name).unwrap_err().code,
            crate::protocol::ErrorCode::ResourceCapacity
        );
        assert_eq!(serde_json::to_vec(&room.snapshot_ref()).unwrap(), before);
        assert_eq!(room.rng.clone().random::<u64>(), rng);
        room.rename(99, "b".into()).unwrap();
        assert_eq!(room.lifecycle.standings[&actor].name, "b");
    }

    #[test]
    fn illegal_prepared_action_leaves_game_log_rng_and_effect_slot_unchanged() {
        use rand::Rng;
        let mut room = dealt_room();
        let before = serde_json::to_vec(&room.snapshot_ref()).unwrap();
        let expected_rng = room.rng.clone().random::<u64>();
        let action = mighty::Action::Play {
            card: mighty::card::Card::Normal(mighty::card::Suit::Diamond, 14),
            joker_lead: None,
            call_joker: false,
        };
        assert!(room.apply_move(0, action, "test").is_err());
        assert_eq!(serde_json::to_vec(&room.snapshot_ref()).unwrap(), before);
        assert_eq!(room.rng.clone().random::<u64>(), expected_rng);
        assert!(room.prepared_advance.is_none());
    }
    #[test]
    fn prepared_redeal_commits_chance_once_and_settle_reuses_it() {
        use rand::Rng;
        let mut room = dealt_room();
        let initial_deals = room.hand.deals;
        for _ in 0..room.seating.len() {
            let Some(engine::Turn::Seat(seat)) = room.hand.turn() else {
                panic!("bidder")
            };
            room.apply_move(seat, mighty::Action::Pass, "test").unwrap();
            if room.hand.deals == initial_deals {
                room.advance();
            }
        }
        assert_eq!(room.hand.deals, initial_deals + 1);
        assert!(room.prepared_advance.as_ref().unwrap().dealt);
        let game = room.hand.game.clone();
        let log = room.hand.log.clone();
        let rng = room.rng.clone().random::<u64>();
        assert!(room.advance());
        assert_eq!(room.hand.game, game);
        assert_eq!(room.hand.log, log);
        assert_eq!(room.rng.clone().random::<u64>(), rng);
        assert!(room.prepared_advance.is_none());
        assert!(!room.advance());
    }

    fn prepare_finish(room: &mut Room<mighty::Mighty>) {
        use engine::Game;
        for _ in 0..500 {
            let Some(engine::Turn::Seat(seat)) = room.hand.turn() else {
                break;
            };
            let legal = mighty::Mighty::legal_actions(room.hand.game.as_ref().unwrap(), seat);
            let action = legal
                .iter()
                .find(|action| matches!(action, mighty::Action::Bid(_)))
                .or_else(|| {
                    legal.iter().find(|action| {
                        matches!(
                            action,
                            mighty::Action::Discard(_) | mighty::Action::CallFriend(mighty::FriendCall::Alone)
                        )
                    })
                })
                .or_else(|| legal.iter().find(|action| !matches!(action, mighty::Action::Misdeal)))
                .unwrap()
                .clone();
            room.apply_move(seat, action, "test").unwrap();
            if !room.hand.in_hand() {
                break;
            }
            room.advance();
        }
    }

    #[test]
    fn archive_previews_match_actual_reset_and_rematch_without_losing_original_record() {
        use crate::resource_budget::{Resource, serialized_size_capped};
        let mut room = dealt_room();
        prepare_finish(&mut room);
        room.advance();
        let original = room.session_message().current_hand.unwrap();
        room.commands.room_version = 9;
        let (session, snapshot) = room.preflight_archive(false).unwrap();
        room.reset_scores().unwrap();
        room.commands.room_version += 1;
        assert_eq!(
            serialized_size_capped(&room.session_envelope_ref(), Resource::Session, usize::MAX).unwrap(),
            session
        );
        assert_eq!(
            serialized_size_capped(&room.snapshot_ref(), Resource::Snapshot, usize::MAX).unwrap(),
            snapshot
        );
        assert_eq!(room.session_message().current_hand, Some(original.clone()));
        assert_eq!(room.session_message().archives[0].records[0], original);
        room.end_session().unwrap();
        room.commands.room_version = 99;
        let (session, snapshot) = room.preflight_archive(true).unwrap();
        room.rematch().unwrap();
        room.commands.room_version += 1;
        assert_eq!(
            serialized_size_capped(&room.session_envelope_ref(), Resource::Session, usize::MAX).unwrap(),
            session
        );
        assert_eq!(
            serialized_size_capped(&room.snapshot_ref(), Resource::Snapshot, usize::MAX).unwrap(),
            snapshot
        );
        let public = room.session_message();
        assert!(public.current_hand.is_none());
        assert_eq!(public.archives[0].records[0], original);
        assert_eq!(public.archives[1].summary["hands_played"], 1);
        assert_eq!(public.archives[1].summary["history"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn archive_capacity_refusal_preserves_data_scores_identity_and_rng() {
        use rand::Rng;
        let mut room = dealt_room();
        prepare_finish(&mut room);
        room.advance();
        Arc::make_mut(&mut room.env).resources.archives = 0;
        let before = serde_json::to_vec(&room.snapshot_ref()).unwrap();
        let rng = room.rng.clone().random::<u64>();
        assert_eq!(
            room.reset_scores().unwrap_err().code,
            crate::protocol::ErrorCode::ResourceCapacity
        );
        assert_eq!(serde_json::to_vec(&room.snapshot_ref()).unwrap(), before);
        assert_eq!(room.rng.clone().random::<u64>(), rng);
        room.end_session().unwrap();
        let before = serde_json::to_vec(&room.snapshot_ref()).unwrap();
        assert_eq!(
            room.rematch().unwrap_err().code,
            crate::protocol::ErrorCode::ResourceCapacity
        );
        assert_eq!(serde_json::to_vec(&room.snapshot_ref()).unwrap(), before);
        assert_eq!(room.rng.clone().random::<u64>(), rng);
    }

    #[test]
    fn staged_finish_books_record_and_summary_exactly_once() {
        let mut room = dealt_room();
        prepare_finish(&mut room);
        assert_eq!(room.hand.turn(), Some(engine::Turn::Over));
        assert_eq!(
            room.session.hands_played, 0,
            "prepared finish has not booked business state"
        );
        assert!(room.advance());
        assert_eq!(room.session.hands_played, 1);
        assert_eq!(room.session_message().records.len(), 1);
        assert_eq!(room.session.hands.len(), 1);
        assert!(!room.advance());
        assert_eq!(room.session.hands_played, 1);
        assert_eq!(room.session_message().records.len(), 1);
    }

    #[test]
    fn borrowed_producers_preserve_authoritative_serialization() {
        let mut room = Room::<mighty::Mighty>::new(
            "borrowed".into(),
            mighty::table::MightySettings::default(),
            Arc::new(RoomEnv::new(Duration::ZERO)),
            mighty_bots(),
        );
        room.session.history.push(vec![1, -1, 0, 0, 0]);
        room.session.hands_played = 1;
        room.reset_scores().unwrap();
        room.session.history.push(vec![0, 0, 1, -1, 0]);
        room.session.hands_played = 2;
        let game = <mighty::Mighty as engine::Game>::new_game(&room.session.options(&room.settings, 2)).unwrap();
        room.hand.start(game, 2);
        room.hand.advance(&room.id, &mut room.rng);
        room.hand.version = 42;
        room.commands.version = 1;
        assert_eq!(
            serde_json::to_vec(&room.snapshot_ref()).unwrap(),
            serde_json::to_vec(&room.snapshot()).unwrap()
        );
        assert_eq!(
            serde_json::to_vec(&room.session_ref()).unwrap(),
            serde_json::to_vec(&room.session_message()).unwrap()
        );
        assert!(ResourceProfile::table::<mighty::Mighty>(&room.settings).is_ok());
    }
}
