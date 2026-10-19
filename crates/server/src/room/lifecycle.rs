//! Room participation and session boundaries, independent of game rules.
use super::seating::Occupant;
use super::{ConnId, Msg, REACTIONS, Room};
use crate::game::ServerGame;
use crate::protocol::{
    ErrorCode, ObserverInfo, ParticipantResult, ParticipationRequest, RecordedHand, ServerError, SessionArchive,
};
use engine::Viewer;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Guest {
    id: String,
    name: String,
    requested: bool,
    pub(super) seat_token: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Lifecycle {
    /// Private observer credentials. Never sent in a room or problem report.
    pub(super) guests: BTreeMap<String, Guest>,
    pub ready: BTreeSet<String>,
    pub ended: bool,
    pub id: u32,
    pub hand_members: Vec<ParticipantResult>,
    records: Vec<RecordedHand>,
    #[serde(default)]
    current_hand: Option<RecordedHand>,
    /// Restored requests are never confirmations: restore clears this queue.
    #[serde(default)]
    queue: Vec<Admission>,
    pub(super) standings: BTreeMap<String, ParticipantResult>,
    archives: Vec<SessionArchive>,
    pub(super) bot_ids: BTreeMap<String, String>,
}

#[derive(Clone, Copy)]
enum Standings<'a> {
    Map(&'a BTreeMap<String, ParticipantResult>),
    Rows(&'a [ParticipantResult]),
}
impl Serialize for Standings<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeSeq;
        let len = match self {
            Self::Map(map) => map.len(),
            Self::Rows(rows) => rows.len(),
        };
        let mut seq = serializer.serialize_seq(Some(len))?;
        match self {
            Self::Map(map) => {
                for value in map.values() {
                    seq.serialize_element(value)?;
                }
            }
            Self::Rows(rows) => {
                for value in *rows {
                    seq.serialize_element(value)?;
                }
            }
        }
        seq.end()
    }
}
#[derive(Serialize)]
struct SessionRef<'a, H, A> {
    room_version: u64,
    scores: &'a [i64],
    hands_played: u32,
    history: &'a [Vec<i64>],
    hands: &'a [H],
    session_id: u32,
    ended: bool,
    records: &'a [RecordedHand],
    current_hand: &'a Option<RecordedHand>,
    standings: Standings<'a>,
    archives: A,
}

#[derive(Serialize)]
struct ArchiveSummaryRef<'a, H> {
    hands: &'a [H],
    hands_played: u32,
    history: &'a [Vec<i64>],
    scores: &'a [i64],
}
#[derive(Serialize)]
struct ArchiveRef<'a, H> {
    id: u32,
    standings: Standings<'a>,
    records: &'a [RecordedHand],
    summary: ArchiveSummaryRef<'a, H>,
}
struct ArchivesRef<'a, H> {
    existing: &'a [SessionArchive],
    next: ArchiveRef<'a, H>,
}
impl<H: Serialize> Serialize for ArchivesRef<'_, H> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeSeq;
        let mut seq = serializer.serialize_seq(Some(self.existing.len() + 1))?;
        for archive in self.existing {
            seq.serialize_element(archive)?;
        }
        seq.serialize_element(&self.next)?;
        seq.end()
    }
}

impl Default for Lifecycle {
    fn default() -> Self {
        Self {
            guests: BTreeMap::new(),
            ready: BTreeSet::new(),
            ended: false,
            id: 1,
            hand_members: vec![],
            records: vec![],
            current_hand: None,
            queue: vec![],
            standings: BTreeMap::new(),
            archives: vec![],
            bot_ids: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Admission {
    id: String,
    preferred: Option<usize>,
    seat: Option<usize>,
    target_id: Option<String>,
    offered_by: Option<String>,
}

fn public_id(token: &str) -> String {
    use sha2::{Digest, Sha256};
    crate::stats::hex(&Sha256::digest(token.as_bytes())[..16])
}

impl<G: ServerGame> Room<G> {
    pub(super) fn member(&self, seat: usize) -> ParticipantResult {
        let (id, name, bot) = match &self.seating.seats[seat] {
            Occupant::Human { token, name, .. } => (
                self.lifecycle
                    .guests
                    .values()
                    .find(|g| g.seat_token.as_ref() == Some(token))
                    .map_or_else(|| public_id(token), |g| g.id.clone()),
                name.clone(),
                false,
            ),
            Occupant::Bot { name, .. } => (
                self.lifecycle
                    .bot_ids
                    .get(name)
                    .cloned()
                    .unwrap_or_else(|| format!("bot:{name}")),
                name.clone(),
                true,
            ),
            Occupant::Empty => (format!("empty:{seat}"), format!("{}번 자리", seat + 1), false),
        };
        ParticipantResult {
            id,
            name,
            bot,
            score: 0,
        }
    }

    pub(super) fn visitor_welcome(&self, conn: ConnId, token: &str) {
        if let Some(g) = self.lifecycle.guests.get(token) {
            self.send(
                conn,
                &Msg::<G>::VisitorWelcome {
                    seat: self.seating.seat_of(conn),
                    id: g.id.clone(),
                    name: g.name.clone(),
                    token: token.into(),
                },
            );
            // Authentication/reclaim can advance room_version without changing
            // session.revision. Publish this connection's public checkpoint at
            // the same committed revision as its following Room/window.
            self.public_session_checkpoint(conn);
        }
    }

    /// Rename an existing authenticated identity. No credentials are created,
    /// rebound or accepted from this command's payload.
    pub(super) fn rename(&mut self, conn: ConnId, name: String) -> Result<(), ServerError> {
        let name = name.trim().chars().take(super::NAME_MAX).collect::<String>();
        if name.is_empty() {
            return Err(ErrorCode::NameRequired.into());
        }
        let actor = self.room_command_scope(conn).ok_or(ErrorCode::IllegalAction)?.actor_id;
        let keys: Vec<_> = self
            .lifecycle
            .guests
            .iter()
            .filter_map(|(key, guest)| (guest.id == actor).then_some(key.clone()))
            .collect();
        let seats: Vec<_> = (0..self.seating.len())
            .filter(|seat| {
                matches!(self.seating.seats[*seat], Occupant::Human { .. }) && self.member(*seat).id == actor
            })
            .collect();
        if keys.is_empty() && seats.is_empty() {
            return Err(ErrorCode::IllegalAction.into());
        }
        let growth = match self.lifecycle.standings.get(&actor) {
            Some(person) => {
                use crate::resource_budget::{Resource, serialized_size_capped};
                let old = serialized_size_capped(&person.name, Resource::Session, 146)
                    .map_err(|error| ServerError::with_detail(ErrorCode::ResourceCapacity, format!("{error:?}")))?;
                let new = serialized_size_capped(&name, Resource::Session, 146)
                    .map_err(|error| ServerError::with_detail(ErrorCode::ResourceCapacity, format!("{error:?}")))?;
                new.saturating_sub(old)
            }
            None => 0,
        };
        self.guard_native_name_growth(growth)?;
        for key in &keys {
            self.lifecycle.guests.get_mut(key).expect("known identity").name = name.clone();
        }
        for seat in seats {
            if let Occupant::Human { name: current, .. } = &mut self.seating.seats[seat] {
                *current = name.clone();
            }
        }
        if let Some(person) = self.lifecycle.standings.get_mut(&actor)
            && person.name != name
        {
            person.name = name;
            self.session.revision += 1;
        }
        // Frozen hand members and archived records keep the names at the time
        // of that hand. Current identities and current standings use the rename.
        let peers: Vec<_> = self
            .seating
            .conns
            .iter()
            .filter_map(|(&id, connection)| {
                connection
                    .visitor
                    .as_ref()
                    .filter(|key| keys.contains(key))
                    .map(|key| (id, key.clone()))
            })
            .collect();
        for (peer, key) in peers {
            self.visitor_welcome(peer, &key);
        }
        Ok(())
    }

    /// Existing bootstrap identity with no name edit may spend finite recovery
    /// revisions. Unknown credentials never gain this admission class.
    pub(super) fn recovery_observe(&self, name: &str, token: Option<&str>) -> bool {
        token
            .and_then(|key| self.lifecycle.guests.get(key))
            .is_some_and(|guest| name.trim().is_empty() || name.trim() == guest.name)
    }

    pub(super) fn observe(&mut self, conn: ConnId, name: String, token: Option<String>) -> Result<(), ServerError> {
        let seat = self.seating.seat_of(conn);
        let existing = seat.and_then(|s| match &self.seating.seats[s] {
            Occupant::Human { token, .. } => self
                .lifecycle
                .guests
                .iter()
                .find(|(_, g)| g.seat_token.as_ref() == Some(token))
                .map(|(key, _)| key.clone()),
            _ => None,
        });
        let key = existing
            .or_else(|| token.filter(|t| self.lifecycle.guests.contains_key(t)))
            .or_else(|| self.seating.conns.get(&conn).and_then(|c| c.visitor.clone()))
            .unwrap_or_else(|| format!("{:032x}", self.rng.random::<u128>()));
        if !self.lifecycle.guests.contains_key(&key) && self.lifecycle.guests.len() >= 1024 {
            return Err(ErrorCode::RateLimited.into());
        }
        let trimmed: String = name.trim().chars().take(super::NAME_MAX).collect();
        let generated = format!("관전자 {}", self.lifecycle.guests.len() + 1);
        let id = seat
            .map(|s| self.member(s).id)
            .unwrap_or_else(|| format!("{:032x}", self.rng.random::<u128>()));
        let guest = self.lifecycle.guests.entry(key.clone()).or_insert(Guest {
            id,
            name: generated,
            requested: false,
            seat_token: None,
        });
        if !trimmed.is_empty() {
            guest.name = trimmed.clone();
            if let Some(s) = seat
                && let Occupant::Human { name, .. } = &mut self.seating.seats[s]
            {
                *name = trimmed;
            }
        }
        if let Some(c) = self.seating.conns.get_mut(&conn) {
            c.visitor = Some(key.clone());
        }
        if let Some(s) = seat {
            self.bind_visitor(conn, s);
        }
        // Copies of this visitor already possess the same credentials;
        // synchronize their display name without changing their seats.
        let peers: Vec<_> = self
            .seating
            .conns
            .iter()
            .filter_map(|(&id, c)| (c.visitor.as_ref() == Some(&key)).then_some(id))
            .collect();
        for peer in peers {
            self.visitor_welcome(peer, &key);
        }
        Ok(())
    }

    pub(super) fn bind_visitor(&mut self, conn: ConnId, seat: usize) {
        let Occupant::Human { token, name, .. } = &self.seating.seats[seat] else {
            return;
        };
        let token = token.clone();
        let name = name.clone();
        let existing = self
            .lifecycle
            .guests
            .iter()
            .find(|(_, g)| g.seat_token.as_ref() == Some(&token))
            .map(|(key, _)| key.clone());
        let key = existing.or_else(|| self.seating.conns.get(&conn).and_then(|c| c.visitor.clone()));
        if let Some(key) = key {
            let legacy_id = public_id(&token);
            let legacy = self.lifecycle.standings.contains_key(&legacy_id);
            if let Some(g) = self.lifecycle.guests.get_mut(&key) {
                if g.seat_token.is_none() && legacy {
                    g.id = legacy_id;
                }
                g.name = name;
                g.seat_token = Some(token);
                g.requested = false;
            }
            if let Some(c) = self.seating.conns.get_mut(&conn) {
                c.visitor = Some(key.clone());
            }
            self.visitor_welcome(conn, &key);
        }
    }

    pub(super) fn observers(&self) -> Vec<ObserverInfo> {
        let seated: BTreeSet<_> = self
            .seating
            .conns
            .values()
            .filter_map(|c| c.seat.map(|s| self.member(s).id))
            .collect();
        let mut seen = BTreeSet::new();
        let mut result: Vec<_> = self
            .seating
            .conns
            .values()
            .filter(|c| c.seat.is_none())
            .filter_map(|c| c.visitor.as_ref().and_then(|t| self.lifecycle.guests.get(t)))
            .filter(|g| !seated.contains(&g.id) && seen.insert(g.id.clone()))
            .map(|g| ObserverInfo {
                id: g.id.clone(),
                name: g.name.clone(),
                requested: g.requested,
            })
            .collect();
        result.sort_by(|a, b| a.id.cmp(&b.id));
        result
    }

    pub(super) fn observer_count(&self) -> usize {
        self.observers().len() + self.seating.watching()
            - self
                .seating
                .conns
                .values()
                .filter(|c| c.seat.is_none() && c.visitor.is_some())
                .count()
    }

    pub(super) fn visitor_id(&self, conn: ConnId) -> Option<String> {
        self.seating
            .conns
            .get(&conn)
            .and_then(|c| c.visitor.as_ref())
            .and_then(|key| self.lifecycle.guests.get(key))
            .map(|guest| guest.id.clone())
    }

    fn observer_id(&self, conn: ConnId) -> Result<String, ServerError> {
        if self.seating.seat_of(conn).is_some() {
            return Err(ErrorCode::AlreadySeated.into());
        }
        let guest = self
            .seating
            .conns
            .get(&conn)
            .and_then(|c| c.visitor.as_ref())
            .and_then(|key| self.lifecycle.guests.get(key))
            .ok_or(ErrorCode::NameRequired)?;
        if guest
            .seat_token
            .as_ref()
            .is_some_and(|t| self.seating.seat_with_token(t).is_some())
        {
            return Err(ErrorCode::AlreadySeated.into());
        }
        Ok(guest.id.clone())
    }

    pub(super) fn participation(&self) -> Vec<ParticipationRequest> {
        self.lifecycle
            .queue
            .iter()
            .enumerate()
            .map(|(i, q)| ParticipationRequest {
                id: q.id.clone(),
                name: self
                    .lifecycle
                    .guests
                    .values()
                    .find(|g| g.id == q.id)
                    .map_or_else(String::new, |g| g.name.clone()),
                order: i as u32 + 1,
                seat: q.seat,
                target_id: q.target_id.clone(),
                offered_by: q.offered_by.clone(),
            })
            .collect()
    }

    /// Reservations freeze both coordinate and occupant. Mutations revoke stale
    /// consent rather than transferring it to whoever now holds that seat.
    pub(super) fn reconcile_admissions(&mut self) {
        let observers: BTreeSet<_> = self.observers().into_iter().map(|g| g.id).collect();
        self.lifecycle.queue.retain(|q| observers.contains(&q.id));
        for i in 0..self.lifecycle.queue.len() {
            let q = &self.lifecycle.queue[i];
            let stale = q
                .seat
                .is_some_and(|s| s >= self.seating.len() || Some(self.member(s).id) != q.target_id);
            if stale {
                let q = &mut self.lifecycle.queue[i];
                q.seat = None;
                q.target_id = None;
                q.offered_by = None;
                q.preferred = None;
            }
        }
        let mut reserved: BTreeSet<_> = self.lifecycle.queue.iter().filter_map(|q| q.seat).collect();
        for i in 0..self.lifecycle.queue.len() {
            if self.lifecycle.queue[i].seat.is_some() {
                continue;
            }
            let preferred = self.lifecycle.queue[i].preferred;
            let target = (0..self.seating.len()).find(|s| {
                !reserved.contains(s)
                    && preferred.is_none_or(|p| p == *s)
                    && matches!(self.seating.seats[*s], Occupant::Empty | Occupant::Bot { .. })
            });
            if let Some(seat) = target {
                let id = self.member(seat).id;
                let q = &mut self.lifecycle.queue[i];
                q.seat = Some(seat);
                q.target_id = Some(id);
                reserved.insert(seat);
            }
        }
        let waiting: BTreeSet<_> = self.lifecycle.queue.iter().map(|q| &q.id).collect();
        for guest in self.lifecycle.guests.values_mut() {
            guest.requested = waiting.contains(&guest.id);
        }
    }

    pub(super) fn request_seat(
        &mut self,
        conn: ConnId,
        requested: bool,
        seat: Option<usize>,
    ) -> Result<(), ServerError> {
        let id = self.observer_id(conn)?;
        if let Some(seat) = seat {
            if seat >= self.seating.len() {
                return Err(ErrorCode::NoSuchSeat.into());
            }
            if requested && self.seating.is_human(seat) {
                return Err(ErrorCode::SeatTaken.into());
            }
        }
        if requested {
            if let Some(q) = self.lifecycle.queue.iter_mut().find(|q| q.id == id) {
                // Repeating the same request does not lose FIFO priority.
                if seat.is_some() && q.preferred != seat {
                    q.preferred = seat;
                    q.seat = None;
                    q.target_id = None;
                    q.offered_by = None;
                }
            } else {
                self.lifecycle.queue.push(Admission {
                    id,
                    preferred: seat,
                    seat: None,
                    target_id: None,
                    offered_by: None,
                });
            }
        } else {
            self.lifecycle.queue.retain(|q| q.id != id);
        }
        self.reconcile_admissions();
        Ok(())
    }

    pub(super) fn offer_seat(&mut self, seat: usize, requester: Option<String>) -> Result<(), ServerError> {
        let outgoing = self.member(seat).id;
        let Some(requester) = requester else {
            for q in &mut self.lifecycle.queue {
                if q.offered_by.as_ref() == Some(&outgoing) {
                    q.seat = None;
                    q.target_id = None;
                    q.offered_by = None;
                }
            }
            self.reconcile_admissions();
            return Ok(());
        };
        self.reconcile_admissions();
        if self.lifecycle.queue.iter().any(|q| q.seat == Some(seat)) {
            return Err(ErrorCode::SeatTaken.into());
        }
        // Human offers resolve the oldest unassigned request, never skip a person.
        let q = self
            .lifecycle
            .queue
            .iter_mut()
            .find(|q| q.seat.is_none())
            .ok_or(ErrorCode::NoPlayerInSeat)?;
        if q.id != requester {
            return Err(ErrorCode::SeatTaken.into());
        }
        q.seat = Some(seat);
        q.target_id = Some(outgoing.clone());
        q.offered_by = Some(outgoing);
        self.lifecycle.ready.clear();
        Ok(())
    }

    pub(super) fn accept_seat(&mut self, conn: ConnId, seat: usize, target_id: String) -> Result<(), ServerError> {
        if self.hand.in_hand() {
            return Err(ErrorCode::SeatsBetweenHands.into());
        }
        let id = self.observer_id(conn)?;
        self.reconcile_admissions();
        let q = self
            .lifecycle
            .queue
            .iter()
            .find(|q| q.id == id)
            .ok_or(ErrorCode::SeatTaken)?;
        if q.seat != Some(seat)
            || q.target_id.as_ref() != Some(&target_id)
            || seat >= self.seating.len()
            || self.member(seat).id != target_id
        {
            return Err(ErrorCode::SeatTaken.into());
        }
        if self.seating.is_human(seat) && q.offered_by.as_ref() != Some(&target_id) {
            return Err(ErrorCode::SeatTaken.into());
        }
        let name = self
            .lifecycle
            .guests
            .values()
            .find(|g| g.id == id)
            .ok_or(ErrorCode::NameRequired)?
            .name
            .clone();
        // Commit as one room action: later requests cannot reserve the temporary
        // vacancy between detaching the consenting human and seating this guest.
        let mut remaining = std::mem::take(&mut self.lifecycle.queue);
        remaining.retain(|q| q.id != id);
        if self.seating.is_human(seat) {
            self.leave(seat);
        }
        let joined = self.join(conn, name, None, Some(seat), None, false);
        self.lifecycle.queue = remaining;
        joined?;
        self.lifecycle.ready.clear();
        self.reconcile_admissions();
        Ok(())
    }

    /// A settled seat is private only to its original recorded participant.
    /// Restored hand_members may be a legacy reconstruction from current seats,
    /// so they cannot establish this audience permission. Missing proof is public.
    pub(super) fn owns_current_replay(&self, seat: usize) -> bool {
        self.lifecycle
            .current_hand
            .as_ref()
            .and_then(|record| record.participant_ids.get(seat))
            .is_some_and(|original| original == &self.member(seat).id)
    }

    pub(super) fn clear_current_replay(&mut self) {
        if self.lifecycle.current_hand.take().is_some() {
            self.session.revision += 1;
        }
    }

    pub(super) fn admissions_pending(&self) -> bool {
        self.lifecycle.queue.iter().any(|q| q.seat.is_some())
    }

    pub(super) fn clear_pending_admissions(&mut self) {
        self.lifecycle.queue.clear();
        self.lifecycle.ready.clear();
        self.lifecycle.ended = false;
        for guest in self.lifecycle.guests.values_mut() {
            guest.requested = false;
        }
    }

    pub(super) fn restore_current_replay(&mut self) {
        if self.hand.in_hand() {
            self.lifecycle.current_hand = None;
        } else if self.hand.game.is_some() && self.lifecycle.current_hand.is_none() {
            self.lifecycle.current_hand = self.lifecycle.records.last().cloned();
        }
    }

    pub(super) fn observer_react(&mut self, conn: ConnId, text: String) -> Result<(), ServerError> {
        if !REACTIONS.contains(&text.as_str()) {
            return Err(ErrorCode::UnknownReaction.into());
        }
        let g = self
            .seating
            .conns
            .get(&conn)
            .and_then(|c| c.visitor.as_ref())
            .and_then(|t| self.lifecycle.guests.get(t))
            .ok_or(ErrorCode::NotSeated)?;
        self.tell_all(&Msg::<G>::ObserverReaction { id: g.id.clone(), text });
        Ok(())
    }

    pub(super) fn readiness(&self) -> Vec<bool> {
        (0..self.seating.len())
            .map(|s| match self.seating.seats[s] {
                Occupant::Bot { .. } => true,
                Occupant::Human { .. } => {
                    self.seating.connected(s) && self.lifecycle.ready.contains(&self.member(s).id)
                }
                Occupant::Empty => false,
            })
            .collect()
    }

    pub(super) fn set_ready(&mut self, seat: usize, ready: bool) -> Result<(), ServerError> {
        if self.hand.in_hand() {
            return Err(ErrorCode::HandInProgress.into());
        }
        if self.lifecycle.ended {
            return Err(ErrorCode::SessionEnded.into());
        }
        let id = self.member(seat).id;
        if ready {
            self.lifecycle.ready.insert(id);
        } else {
            self.lifecycle.ready.remove(&id);
        }
        Ok(())
    }

    pub(super) fn seed_standings(&mut self) {
        if self.lifecycle.standings.is_empty() && self.session.hands_played > 0 {
            for s in 0..self.seating.len() {
                let mut p = self.member(s);
                p.score = self.session.scores[s];
                self.lifecycle.standings.insert(p.id.clone(), p);
            }
        }
    }

    pub(super) fn retained_counts(
        &self,
        limits: crate::resource_budget::ResourceLimits,
    ) -> Result<(usize, usize, usize), crate::resource_budget::BudgetError> {
        use crate::resource_budget::{BudgetError, Resource};
        let life = &self.lifecycle;
        if life.archives.len() > limits.archives {
            return Err(BudgetError::Capacity {
                resource: Resource::Archives,
                limit: limits.archives,
            });
        }
        if life.records.len() > limits.period_records {
            return Err(BudgetError::Capacity {
                resource: Resource::PeriodRecords,
                limit: limits.period_records,
            });
        }
        let mut total = life.records.len();
        for archive in &life.archives {
            total = total
                .checked_add(archive.records.len())
                .ok_or(BudgetError::Arithmetic)?;
        }
        if total > limits.total_records {
            return Err(BudgetError::Capacity {
                resource: Resource::TotalRecords,
                limit: limits.total_records,
            });
        }
        Ok((life.archives.len(), life.records.len(), total))
    }

    /// Typed public fields and known archive score arrays only; never inspect
    /// or clone recorded views or unrelated summary extension fields.
    pub(super) fn recorded_scores_fit(&self, limit: i64) -> bool {
        let fits = |score: i64| (-limit..=limit).contains(&score);
        self.lifecycle
            .records
            .iter()
            .chain(self.lifecycle.current_hand.iter())
            .all(|record| record.payoffs.iter().copied().all(fits))
            && self.lifecycle.archives.iter().all(|archive| {
                let row_fits = |row: &serde_json::Value| {
                    row.as_array()
                        .is_some_and(|row| row.iter().all(|score| score.as_i64().is_some_and(fits)))
                };
                let scores = archive.summary.get("scores").is_none_or(row_fits);
                let history = archive
                    .summary
                    .get("history")
                    .is_none_or(|history| history.as_array().is_some_and(|rows| rows.iter().all(row_fits)));
                scores
                    && history
                    && archive.standings.iter().all(|person| fits(person.score))
                    && archive
                        .records
                        .iter()
                        .all(|record| record.payoffs.iter().copied().all(fits))
            })
    }

    pub(super) fn prepared_record(&self, game: &G::State, payoffs: &[i64]) -> RecordedHand {
        let members = if self.lifecycle.hand_members.len() == self.seating.len() {
            self.lifecycle.hand_members.clone()
        } else {
            (0..self.seating.len()).map(|seat| self.member(seat)).collect()
        };
        RecordedHand {
            session_id: Some(self.lifecycle.id),
            number: self.session.hands_played + 1,
            names: members.iter().map(|person| person.name.clone()).collect(),
            participant_ids: members.iter().map(|person| person.id.clone()).collect(),
            payoffs: payoffs.to_vec(),
            rules: serde_json::to_value(G::table_rules(&self.settings)).expect("rules serialize"),
            view: serde_json::to_value(G::view(game, Viewer::Spectator)).expect("views serialize"),
        }
    }

    pub(super) fn book_record(&mut self, payoffs: &[i64]) {
        if self.lifecycle.hand_members.len() != self.seating.len() {
            self.lifecycle.hand_members = (0..self.seating.len()).map(|s| self.member(s)).collect();
        }
        for (p, payoff) in self.lifecycle.hand_members.iter().zip(payoffs) {
            let entry = self
                .lifecycle
                .standings
                .entry(p.id.clone())
                .or_insert_with(|| p.clone());
            entry.score += payoff;
        }
        if let Some(game) = &self.hand.game {
            let record = self.prepared_record(game, payoffs);
            self.lifecycle.current_hand = Some(record.clone());
            self.lifecycle.records.push(record);
        }
    }

    /// Validate the private, non-history control envelope before it can support
    /// a native completion reservation. Legacy violations are capacity failures,
    /// never a request to discard identities or records.
    pub(super) fn lifecycle_control_bytes(&self) -> Result<usize, crate::resource_budget::BudgetError> {
        use crate::resource_budget::{BudgetError, Resource, serialized_size_capped};
        let id = |value: &str| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"-_:./".contains(&byte) || !byte.is_ascii())
        };
        let name = |value: &str| value.chars().count() <= super::NAME_MAX;
        let life = &self.lifecycle;
        if life.standings.len() > self.env.resources.total_records.saturating_mul(8).saturating_add(8)
            || life
                .standings
                .iter()
                .any(|(key, person)| !id(key) || !id(&person.id) || !name(&person.name))
            || life.guests.len() > 1024
            || life.queue.len() > 1024
            || life.ready.len() > 1024
            || life.bot_ids.len() > 16
            || life.hand_members.len() > 8
            || life.guests.iter().any(|(key, guest)| {
                !id(key)
                    || !id(&guest.id)
                    || !name(&guest.name)
                    || guest.seat_token.as_deref().is_some_and(|token| !id(token))
            })
            || life.ready.iter().any(|key| !id(key))
            || life.bot_ids.iter().any(|(key, value)| !name(key) || !id(value))
            || life
                .hand_members
                .iter()
                .any(|person| !id(&person.id) || !name(&person.name))
            || life.queue.iter().any(|entry| {
                !id(&entry.id)
                    || entry.target_id.as_deref().is_some_and(|value| !id(value))
                    || entry.offered_by.as_deref().is_some_and(|value| !id(value))
            })
        {
            return Err(BudgetError::InvalidProfile);
        }
        #[derive(Serialize)]
        struct Control<'a> {
            guests: &'a BTreeMap<String, Guest>,
            ready: &'a BTreeSet<String>,
            hand_members: &'a [ParticipantResult],
            queue: &'a [Admission],
            bot_ids: &'a BTreeMap<String, String>,
        }
        serialized_size_capped(
            &Control {
                guests: &life.guests,
                ready: &life.ready,
                hand_members: &life.hand_members,
                queue: &life.queue,
                bot_ids: &life.bot_ids,
            },
            Resource::Snapshot,
            super::resources::LIFECYCLE_CONTROL_BYTES,
        )
    }

    /// Borrow the same public checkpoint schema used by SessionMsg, with no
    /// full retained-history clone and no credential-bearing lifecycle fields.
    pub(super) fn session_ref(&self) -> impl Serialize + '_ {
        SessionRef {
            room_version: self.commands.room_version,
            scores: &self.session.scores,
            hands_played: self.session.hands_played,
            history: &self.session.history,
            hands: &self.session.hands,
            session_id: self.lifecycle.id,
            ended: self.lifecycle.ended,
            records: &self.lifecycle.records,
            current_hand: &self.lifecycle.current_hand,
            standings: Standings::Map(&self.lifecycle.standings),
            archives: &self.lifecycle.archives,
        }
    }

    #[cfg(test)]
    pub(super) fn session_message(&self) -> crate::protocol::SessionMsg<G::Summary> {
        let mut msg = self.session.message();
        msg.room_version = self.commands.room_version;
        msg.session_id = self.lifecycle.id;
        msg.ended = self.lifecycle.ended;
        msg.records = self.lifecycle.records.clone();
        msg.current_hand = self.lifecycle.current_hand.clone();
        msg.standings = self.lifecycle.standings.values().cloned().collect();
        msg.archives = self.lifecycle.archives.clone();
        msg
    }

    pub(super) fn preflight_archive(
        &self,
        rematch: bool,
    ) -> Result<(usize, usize), crate::resource_budget::BudgetError> {
        use crate::resource_budget::{BudgetError, Resource, admit_archive, serialized_size_capped};
        let next_id = self.lifecycle.id.checked_add(1).ok_or(BudgetError::Capacity {
            resource: Resource::SessionNumber,
            limit: u32::MAX as usize,
        })?;
        let limits = self.env.resources;
        let usage = self.resource_usage()?;
        let seeded: Vec<_> = if !rematch && self.lifecycle.standings.is_empty() && self.session.hands_played > 0 {
            (0..self.seating.len())
                .map(|seat| {
                    let mut person = self.member(seat);
                    person.score = self.session.scores[seat];
                    person
                })
                .collect()
        } else {
            vec![]
        };
        let standings = if seeded.is_empty() {
            Standings::Map(&self.lifecycle.standings)
        } else {
            Standings::Rows(&seeded)
        };
        let archives = ArchivesRef {
            existing: &self.lifecycle.archives,
            next: ArchiveRef {
                id: self.lifecycle.id,
                standings,
                records: &self.lifecycle.records,
                summary: ArchiveSummaryRef {
                    hands: &self.session.hands,
                    hands_played: self.session.hands_played,
                    history: &self.session.history,
                    scores: &self.session.scores,
                },
            },
        };
        let scores = vec![0; self.seating.len()];
        let hands_played = if rematch { 0 } else { self.session.hands_played };
        let history = if rematch { &[][..] } else { &self.session.history[..] };
        let hands = if rematch { &[][..] } else { &self.session.hands[..] };
        let none = None;
        let current_hand = if rematch { &none } else { &self.lifecycle.current_hand };
        let prospective = SessionRef {
            room_version: self
                .commands
                .room_version
                .saturating_add(1)
                .min(crate::command_protocol::MAX_COMMAND_SEQUENCE),
            scores: &scores,
            hands_played,
            history,
            hands,
            session_id: next_id,
            ended: false,
            records: &[],
            current_hand,
            standings: Standings::Rows(&[]),
            archives: &archives,
        };
        let session_bytes = serialized_size_capped(
            &super::view::session_envelope(&prospective),
            Resource::Session,
            limits.session_bytes,
        )?;
        #[derive(Serialize)]
        struct LifecycleRef<'a, A> {
            guests: &'a BTreeMap<String, Guest>,
            ready: &'a BTreeSet<String>,
            ended: bool,
            id: u32,
            hand_members: &'a [ParticipantResult],
            records: &'a [RecordedHand],
            current_hand: &'a Option<RecordedHand>,
            queue: &'a [Admission],
            standings: &'a BTreeMap<String, ParticipantResult>,
            archives: A,
            bot_ids: &'a BTreeMap<String, String>,
        }
        let ready = BTreeSet::new();
        let empty_standings = BTreeMap::new();
        let lifecycle = LifecycleRef {
            guests: &self.lifecycle.guests,
            ready: &ready,
            ended: false,
            id: next_id,
            hand_members: if rematch { &[] } else { &self.lifecycle.hand_members },
            records: &[],
            current_hand,
            queue: &self.lifecycle.queue,
            standings: &empty_standings,
            archives: &archives,
            bot_ids: &self.lifecycle.bot_ids,
        };
        let snapshot = self.snapshot_projection(
            super::snapshot::SessionSnapshotRef {
                room_version: prospective.room_version,
                scores: &scores,
                hands_played,
                history,
                hands,
                rotation: if rematch { 0 } else { self.session.rotation },
            },
            lifecycle,
            if rematch { None } else { Some(&self.hand) },
        );
        let snapshot_bytes = serialized_size_capped(&snapshot, Resource::Snapshot, limits.snapshot_bytes)?;
        admit_archive(limits, usage, session_bytes, snapshot_bytes)?;
        Ok((session_bytes, snapshot_bytes))
    }

    pub(super) fn reset_scores(&mut self) -> Result<(), ServerError> {
        if self.hand.in_hand() {
            return Err(ErrorCode::HandInProgress.into());
        }
        self.preflight_archive(false)
            .map_err(|error| ServerError::with_detail(ErrorCode::ResourceCapacity, format!("{error:?}")))?;
        self.seed_standings();
        self.lifecycle.archives.push(SessionArchive { id: self.lifecycle.id,
            standings: self.lifecycle.standings.values().cloned().collect(),
            records: std::mem::take(&mut self.lifecycle.records),
            summary: serde_json::json!({"scores":self.session.scores,"hands_played":self.session.hands_played,"history":self.session.history,"hands":self.session.hands}) });
        self.lifecycle.id += 1;
        self.lifecycle.ended = false;
        self.lifecycle.ready.clear();
        self.lifecycle.standings.clear();
        // Only cumulative scores reset. Hand count, prior summaries and rotation
        // determine the next dealer and must continue across a score period.
        // Keep the finished hand and its booked flag: it must never be booked twice.
        self.session.scores.fill(0);
        self.session.revision += 1;
        Ok(())
    }

    pub(super) fn end_session(&mut self) -> Result<(), ServerError> {
        if self.hand.in_hand() {
            return Err(ErrorCode::HandInProgress.into());
        }
        if self.session.hands_played == 0 {
            return Err(ErrorCode::NoHand.into());
        }
        let growth = if self.lifecycle.standings.is_empty() {
            let seeded: Vec<_> = (0..self.seating.len())
                .map(|seat| {
                    let mut person = self.member(seat);
                    person.score = self.session.scores[seat];
                    person
                })
                .collect();
            crate::resource_budget::serialized_size_capped(
                &seeded,
                crate::resource_budget::Resource::Session,
                16 * crate::resource_budget::KIB,
            )
            .map_err(|error| ServerError::with_detail(ErrorCode::ResourceCapacity, format!("{error:?}")))?
            .saturating_sub(2)
        } else {
            0
        };
        self.guard_native_name_growth(growth)?;
        self.seed_standings();
        self.lifecycle.ended = true;
        self.lifecycle.ready.clear();
        self.session.revision += 1;
        Ok(())
    }

    pub(super) fn rematch(&mut self) -> Result<(), ServerError> {
        if !self.lifecycle.ended {
            return Err(ErrorCode::SessionNotEnded.into());
        }
        self.preflight_archive(true)
            .map_err(|error| ServerError::with_detail(ErrorCode::ResourceCapacity, format!("{error:?}")))?;
        self.lifecycle.archives.push(SessionArchive { id: self.lifecycle.id, standings: self.lifecycle.standings.values().cloned().collect(), records: std::mem::take(&mut self.lifecycle.records), summary: serde_json::json!({ "scores": self.session.scores, "hands_played": self.session.hands_played, "history": self.session.history, "hands": self.session.hands }) });
        self.lifecycle.id += 1;
        self.lifecycle.ended = false;
        self.lifecycle.ready.clear();
        self.lifecycle.standings.clear();
        self.lifecycle.hand_members.clear();
        self.clear_current_replay();
        let revision = self.session.revision + 1;
        self.session = super::session::Session::new(self.seating.len());
        self.session.revision = revision;
        // Accepted command receipts retain this room-wide game fence across sessions.
        let version = self.hand.version;
        self.hand = super::hand::Hand::default();
        self.hand.version = version;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::seating::Conn;
    use super::super::{RoomEnv, mighty_bots};
    use super::*;
    use crate::protocol::ClientMsg;
    use engine::{Game, Level, Turn};
    use mighty::rules::Preset;
    use mighty::table::MightySettings;
    use mighty::{Action, Mighty};
    use std::sync::Arc;
    use std::time::Duration;

    fn room() -> Room<Mighty> {
        Room::new(
            "lifecycle".into(),
            MightySettings::new(Preset::Gshs),
            Arc::new(RoomEnv::new(Duration::ZERO)),
            mighty_bots(),
        )
    }
    #[test]
    fn maximal_private_lifecycle_control_fits_closed_ceiling() {
        let mut r = room();
        // Escaping each ASCII control character is larger than UTF-8 names.
        let name = "\u{0001}".repeat(super::super::NAME_MAX);
        for index in 0..1024 {
            let id = format!("{index:0128}");
            r.lifecycle.guests.insert(
                id.clone(),
                Guest {
                    id: id.clone(),
                    name: name.clone(),
                    requested: true,
                    seat_token: Some("t".repeat(128)),
                },
            );
            r.lifecycle.ready.insert(id.clone());
            r.lifecycle.queue.push(Admission {
                id,
                preferred: Some(usize::MAX),
                seat: Some(usize::MAX),
                target_id: Some("a".repeat(128)),
                offered_by: Some("b".repeat(128)),
            });
        }
        for index in 0..16 {
            r.lifecycle.bot_ids.insert(format!("{index:024}"), "i".repeat(128));
        }
        r.lifecycle.hand_members = (0..8)
            .map(|_| ParticipantResult {
                id: "i".repeat(128),
                name: name.clone(),
                bot: false,
                score: i64::MIN,
            })
            .collect();
        assert!(r.lifecycle_control_bytes().unwrap() < super::super::resources::LIFECYCLE_CONTROL_BYTES);
        r.lifecycle.guests.values_mut().next().unwrap().name.push('x');
        assert!(
            r.lifecycle_control_bytes().is_err(),
            "legacy oversized name cannot certify future growth"
        );
    }

    fn connect(r: &mut Room<Mighty>, id: ConnId) {
        let (tx, _) = crate::outbound::test_channel();
        r.seating.conns.insert(id, Conn::new(tx));
    }
    fn finish(r: &mut Room<Mighty>) {
        for _ in 0..500 {
            r.advance();
            if !r.hand.in_hand() {
                return;
            }
            if let Turn::Seat(s) = Mighty::turn(r.hand.game.as_ref().unwrap()) {
                let legal = Mighty::legal_actions(r.hand.game.as_ref().unwrap(), s);
                let action = legal
                    .iter()
                    .find(|a| !matches!(a, Action::Pass | Action::Misdeal))
                    .unwrap_or(&legal[0])
                    .clone();
                r.apply_move(s, action, "test").unwrap();
            }
        }
        panic!("hand did not finish");
    }

    #[tokio::test]
    async fn seated_name_edit_preserves_participant_seat_score_and_credentials() {
        let mut r = room();
        let (tx, mut received) = crate::outbound::test_channel();
        r.seating.conns.insert(1, Conn::new(tx));
        r.observe(1, "수연".into(), None).unwrap();
        let visitor_token = r.seating.conns[&1].visitor.clone().unwrap();
        r.join(1, "수연".into(), None, Some(2), None, false).unwrap();
        let before = r.member(2);
        let seat_token = match &r.seating.seats[2] {
            Occupant::Human { token, .. } => token.clone(),
            _ => panic!("human seated"),
        };
        r.session.scores[2] = 17;
        while received.try_recv().is_ok() {}

        r.observe(1, "  재용  ".into(), Some(visitor_token.clone())).unwrap();

        assert_eq!(r.seating.seat_of(1), Some(2));
        assert_eq!(r.member(2).id, before.id);
        assert_eq!(r.member(2).name, "재용");
        assert_eq!(r.session.scores[2], 17);
        assert_eq!(r.seating.conns[&1].visitor.as_ref(), Some(&visitor_token));
        assert!(matches!(&r.seating.seats[2], Occupant::Human { token, .. } if token == &seat_token));
        let welcome: Vec<serde_json::Value> = std::iter::from_fn(|| received.try_recv().ok())
            .map(|message| serde_json::from_str(&message).unwrap())
            .filter(|message: &serde_json::Value| message["type"] == "visitor_welcome")
            .collect();
        assert!(!welcome.is_empty());
        for message in welcome {
            assert_eq!(message["name"], "재용");
            assert_eq!(message["id"], before.id);
            assert_eq!(message["seat"], 2);
            assert_eq!(message["token"], visitor_token);
        }
        // Empty Observe is a reconnect identity lookup, never a blank rename.
        r.observe(1, " ".into(), Some(visitor_token.clone())).unwrap();
        assert_eq!(r.member(2).name, "재용");
        // A browser holding the pre-edit name reclaims credentials, not a rename.
        r.seating.conns.remove(&1);
        connect(&mut r, 3);
        r.observe(3, "수연".into(), Some(visitor_token)).unwrap();
        r.join(3, "수연".into(), Some(seat_token), None, None, true).unwrap();
        assert_eq!(r.seating.seat_of(3), Some(2));
        assert_eq!(r.member(2).id, before.id);
        assert_eq!(r.member(2).name, "재용");
        assert_eq!(r.session.scores[2], 17);
    }

    #[tokio::test]
    async fn observer_identity_deduplicates_connections_without_granting_a_seat() {
        let mut r = room();
        connect(&mut r, 1);
        connect(&mut r, 2);
        r.observe(1, "수연".into(), None).unwrap();
        let token = r.seating.conns[&1].visitor.clone().unwrap();
        let id = r.observers()[0].id.clone();
        r.observe(2, "수연".into(), Some(token.clone())).unwrap();
        assert_eq!(r.observer_count(), 1);
        assert_eq!(r.observers()[0].id, id);
        assert_ne!(id, token);
        assert_eq!(
            r.on_message(1, ClientMsg::Ready { ready: true }).unwrap_err().code,
            ErrorCode::NotSeated
        );
        r.request_seat(1, true, None).unwrap();
        assert!(r.observers()[0].requested);
        r.accept_seat(1, 0, "empty:0".into()).unwrap();
        assert_eq!(r.member(0).id, id);
        assert_eq!(r.observer_count(), 0);
        assert_eq!(
            r.request_seat(2, true, None).unwrap_err().code,
            ErrorCode::AlreadySeated
        );
        assert_eq!(
            r.join(2, "수연".into(), None, Some(1), None, false).unwrap_err().code,
            ErrorCode::AlreadySeated
        );
        let report = r.report().to_string();
        assert!(!report.contains(&token));
        let seat_token = match &r.seating.seats[0] {
            Occupant::Human { token, .. } => token,
            _ => panic!(),
        };
        assert!(!report.contains(seat_token));
    }

    #[tokio::test]
    async fn readiness_and_session_boundaries_are_authoritative() {
        let mut r = room();
        connect(&mut r, 1);
        connect(&mut r, 2);
        r.observe(1, "재용".into(), None).unwrap();
        r.join(1, "재용".into(), None, Some(0), None, false).unwrap();
        for s in 1..5 {
            r.add_bot(s, Level::Easy).unwrap();
        }
        assert_eq!(r.readiness(), vec![false, true, true, true, true]);
        assert_eq!(
            r.on_message(2, ClientMsg::Start).unwrap_err().code,
            ErrorCode::NotSeated
        );
        assert_eq!(r.start().unwrap_err().code, ErrorCode::PlayersNotReady);
        r.set_ready(0, true).unwrap();
        r.start().unwrap();
        assert_eq!(r.end_session().unwrap_err().code, ErrorCode::HandInProgress);
        assert_eq!(r.set_ready(0, true).unwrap_err().code, ErrorCode::HandInProgress);
        finish(&mut r);
        let msg = r.session_message();
        assert_eq!(msg.records.len(), 1);
        assert_eq!(msg.records[0].names[0], "재용");
        assert_eq!(msg.records[0].view["viewer"], "Spectator");
        assert_eq!(msg.records[0].view["hand"], serde_json::json!([]));
        let old_seats = r.seating.seats.clone();
        r.end_session().unwrap();
        assert_eq!(r.start().unwrap_err().code, ErrorCode::SessionEnded);
        assert_eq!(
            r.on_message(2, ClientMsg::Rematch).unwrap_err().code,
            ErrorCode::NotSeated
        );
        r.rematch().unwrap();
        assert_eq!(r.seating.seats, old_seats);
        let new = r.session_message();
        assert_eq!(new.session_id, 2);
        assert_eq!(new.scores, vec![0; 5]);
        assert_eq!(new.hands_played, 0);
        assert_eq!(new.archives.len(), 1);
        assert_eq!(new.archives[0].records, msg.records);
        assert_eq!(r.readiness(), vec![false, true, true, true, true]);
        let value = serde_json::to_value(r.snapshot()).unwrap();
        let restored = Room::<Mighty>::restore(value, Arc::new(RoomEnv::new(Duration::ZERO)), mighty_bots()).unwrap();
        assert_eq!(restored.session_message().archives, new.archives);
        assert_eq!(restored.session_message().scores, new.scores);
    }

    #[tokio::test]
    async fn departed_people_keep_their_identity_in_finished_records() {
        let mut r = room();
        connect(&mut r, 1);
        r.observe(1, "지난 사람".into(), None).unwrap();
        let key = r.seating.conns[&1].visitor.clone().unwrap();
        r.join(1, "지난 사람".into(), None, Some(0), None, false).unwrap();
        for s in 1..5 {
            r.add_bot(s, Level::Easy).unwrap();
        }
        r.set_ready(0, true).unwrap();
        r.start().unwrap();
        r.leave(0);
        finish(&mut r);
        assert_eq!(r.session_message().records[0].names[0], "지난 사람");
        connect(&mut r, 3);
        r.observe(3, "지난 사람".into(), Some(key)).unwrap();
        r.join(3, "지난 사람".into(), None, Some(0), None, false).unwrap();
        let id = r.member(0).id;
        assert_eq!(r.session.scores[0], r.lifecycle.standings[&id].score);
    }
    #[tokio::test]
    async fn recorded_views_keep_private_discards_private_after_restore() {
        let mut r = room();
        let mut rules = r.settings.rules();
        rules.reveal_discards = false;
        r.settings.rules = Some(rules);
        for s in 0..5 {
            r.add_bot(s, Level::Easy).unwrap();
        }
        r.start().unwrap();
        finish(&mut r);
        let record = &r.session_message().records[0];
        assert_eq!(record.view["phase"]["Done"]["discards"], serde_json::json!([]));
        assert_eq!(record.view["hand"], serde_json::json!([]));
        let restored = Room::<Mighty>::restore(
            serde_json::to_value(r.snapshot()).unwrap(),
            Arc::new(RoomEnv::new(Duration::ZERO)),
            mighty_bots(),
        )
        .unwrap();
        assert_eq!(restored.session_message().records[0], *record);
    }
    fn player(r: &mut Room<Mighty>, conn: ConnId, seat: usize) {
        connect(r, conn);
        r.observe(conn, format!("사람{conn}"), None).unwrap();
        r.join(conn, format!("사람{conn}"), None, Some(seat), None, false)
            .unwrap();
    }
    fn observer(r: &mut Room<Mighty>, conn: ConnId) -> String {
        connect(r, conn);
        r.observe(conn, format!("관전{conn}"), None).unwrap();
        r.lifecycle.guests[r.seating.conns[&conn].visitor.as_ref().unwrap()]
            .id
            .clone()
    }

    #[tokio::test]
    async fn queue_reserves_fifo_and_cancel_releases_without_seating() {
        let mut r = room();
        player(&mut r, 1, 0);
        for s in 1..5 {
            r.add_bot(s, Level::Easy).unwrap();
        }
        let first = observer(&mut r, 10);
        let second = observer(&mut r, 11);
        r.request_seat(10, true, Some(2)).unwrap();
        r.request_seat(11, true, Some(2)).unwrap();
        let queue = r.participation();
        assert_eq!(queue[0].id, first);
        assert_eq!(queue[0].seat, Some(2));
        assert_eq!(queue[1].id, second);
        assert_eq!(queue[1].seat, None);
        r.request_seat(10, true, Some(2)).unwrap();
        assert_eq!(r.participation()[0].order, 1);
        assert_eq!(
            r.on_message(1, ClientMsg::Start).unwrap_err().code,
            ErrorCode::PlayersNotReady
        );
        assert_eq!(
            r.join(11, "bypass".into(), None, Some(2), None, false)
                .unwrap_err()
                .code,
            ErrorCode::SeatTaken
        );
        r.request_seat(10, false, None).unwrap();
        let queue = r.participation();
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].id, second);
        assert_eq!(queue[0].seat, Some(2));
        r.accept_seat(11, 2, queue[0].target_id.clone().unwrap()).unwrap();
        assert_eq!(r.member(2).id, second);
        assert!(r.participation().is_empty());
        assert_eq!(r.seating.seat_of(10), None);
        assert!(!r.readiness()[2]);
    }

    #[tokio::test]
    async fn live_reservation_never_grants_cards_and_requires_between_hand_acceptance() {
        let mut r = room();
        player(&mut r, 1, 0);
        for s in 1..5 {
            r.add_bot(s, Level::Easy).unwrap();
        }
        r.on_message(1, ClientMsg::Start).unwrap();
        r.advance();
        let (tx, mut messages) = crate::outbound::test_channel();
        r.seating.conns.insert(10, Conn::new(tx));
        r.observe(10, "incoming".into(), None).unwrap();
        r.request_seat(10, true, Some(1)).unwrap();
        let reservation = r.participation()[0].clone();
        assert_eq!(
            r.accept_seat(10, 1, reservation.target_id.clone().unwrap())
                .unwrap_err()
                .code,
            ErrorCode::SeatsBetweenHands
        );
        assert_eq!(
            r.join(10, "incoming".into(), None, Some(1), None, false)
                .unwrap_err()
                .code,
            ErrorCode::SeatsBetweenHands
        );
        r.broadcast();
        let state = std::iter::from_fn(|| messages.try_recv().ok())
            .map(|m| serde_json::from_str::<serde_json::Value>(&m).unwrap())
            .find(|m| m["type"] == "state")
            .unwrap();
        assert_eq!(state["view"]["hand"], serde_json::json!([]));
        assert_eq!(state["legal"], serde_json::json!([]));
        finish(&mut r);
        assert_eq!(
            r.on_message(1, ClientMsg::Start).unwrap_err().code,
            ErrorCode::PlayersNotReady
        );
        r.accept_seat(10, 1, reservation.target_id.unwrap()).unwrap();
        assert_eq!(r.seating.seat_of(10), Some(1));
        assert!(r.hand.booked);
    }

    #[tokio::test]
    async fn human_offer_is_owned_withdrawable_and_acceptance_keeps_other_seats() {
        let mut r = room();
        for s in 0..5 {
            player(&mut r, s as u64 + 1, s);
        }
        let first = observer(&mut r, 10);
        let second = observer(&mut r, 11);
        r.request_seat(10, true, None).unwrap();
        r.request_seat(11, true, None).unwrap();
        assert_eq!(r.offer_seat(0, Some(second)).unwrap_err().code, ErrorCode::SeatTaken);
        r.on_message(
            1,
            ClientMsg::OfferSeat {
                requester_id: Some(first.clone()),
            },
        )
        .unwrap();
        let reservation = r.participation()[0].clone();
        assert_eq!(
            r.on_message(10, ClientMsg::OfferSeat { requester_id: None })
                .unwrap_err()
                .code,
            ErrorCode::NotSeated
        );
        r.on_message(2, ClientMsg::OfferSeat { requester_id: None }).unwrap();
        assert_eq!(r.participation()[0], reservation);
        assert_eq!(
            r.accept_seat(11, 0, reservation.target_id.clone().unwrap())
                .unwrap_err()
                .code,
            ErrorCode::SeatTaken
        );
        r.on_message(1, ClientMsg::OfferSeat { requester_id: None }).unwrap();
        assert_eq!(
            r.accept_seat(10, 0, reservation.target_id.clone().unwrap())
                .unwrap_err()
                .code,
            ErrorCode::SeatTaken
        );
        r.on_message(
            1,
            ClientMsg::OfferSeat {
                requester_id: Some(first.clone()),
            },
        )
        .unwrap();
        let before = r.seating.seats.clone();
        r.accept_seat(10, 0, reservation.target_id.unwrap()).unwrap();
        assert_eq!(&r.seating.seats[1..], &before[1..]);
        assert_eq!(r.seating.seat_of(1), None);
        assert_eq!(r.seating.seat_of(10), Some(0));
        assert_eq!(r.participation().len(), 1);
        assert_eq!(r.participation()[0].seat, None);
        assert!(r.observers().iter().any(|p| p.name == "사람1"));
    }

    #[tokio::test]
    async fn target_mutation_revokes_human_consent_and_old_bot_identity() {
        let mut r = room();
        player(&mut r, 1, 0);
        r.add_bot(1, Level::Easy).unwrap();
        observer(&mut r, 10);
        r.request_seat(10, true, Some(1)).unwrap();
        let old = r.participation()[0].clone();
        r.remove_bot(1).unwrap();
        r.add_bot(1, Level::Easy).unwrap();
        assert_ne!(r.member(1).id, old.target_id.clone().unwrap());
        assert_eq!(
            r.accept_seat(10, 1, old.target_id.unwrap()).unwrap_err().code,
            ErrorCode::SeatTaken
        );
        // A consent attached to a human at coordinate 0 cannot evict a new occupant there.
        r.request_seat(10, false, None).unwrap();
        for s in 1..5 {
            r.remove_bot(s).ok();
            player(&mut r, s as u64 + 1, s);
        }
        let id = r.observers()[0].id.clone();
        r.request_seat(10, true, None).unwrap();
        r.offer_seat(0, Some(id)).unwrap();
        let old = r.participation()[0].clone();
        r.swap_seats(Some(0), 0, 1).unwrap();
        assert_eq!(r.participation()[0].seat, None);
        assert_eq!(
            r.accept_seat(10, 0, old.target_id.unwrap()).unwrap_err().code,
            ErrorCode::SeatTaken
        );
        assert!(r.seating.is_human(0));
    }

    #[tokio::test]
    async fn duplicate_observer_disconnect_preserves_request_until_last_connection() {
        let mut r = room();
        observer(&mut r, 10);
        let token = r.seating.conns[&10].visitor.clone();
        connect(&mut r, 11);
        r.observe(11, "same".into(), token).unwrap();
        r.request_seat(10, true, None).unwrap();
        r.seating.conns.remove(&10);
        r.reconcile_admissions();
        assert_eq!(r.participation().len(), 1);
        assert_eq!(r.observer_count(), 1);
        r.seating.conns.remove(&11);
        r.reconcile_admissions();
        assert!(r.participation().is_empty());
        assert!(!r.lifecycle.guests.values().next().unwrap().requested);
    }

    #[tokio::test]
    async fn restore_clears_pending_admission_and_normalizes_legacy_ended_without_reset() {
        let mut r = room();
        player(&mut r, 1, 0);
        observer(&mut r, 10);
        r.request_seat(10, true, None).unwrap();
        r.lifecycle.ended = true;
        r.session.scores[0] = 9;
        let snapshot = serde_json::to_value(r.snapshot()).unwrap();
        let restored =
            Room::<Mighty>::restore(snapshot.clone(), Arc::new(RoomEnv::new(Duration::ZERO)), mighty_bots()).unwrap();
        assert!(restored.participation().is_empty());
        assert!(!restored.lifecycle.ended);
        assert_eq!(restored.session.scores[0], 9);
        let mut legacy = snapshot;
        legacy.as_object_mut().unwrap().remove("lifecycle");
        let restored = Room::<Mighty>::restore(legacy, Arc::new(RoomEnv::new(Duration::ZERO)), mighty_bots()).unwrap();
        assert!(restored.participation().is_empty());
        assert_eq!(restored.session.scores[0], 9);
    }

    #[tokio::test]
    async fn solo_start_and_reset_preserve_completed_replay_without_rebooking() {
        let mut r = room();
        player(&mut r, 1, 0);
        for s in 1..5 {
            r.add_bot(s, Level::Easy).unwrap();
        }
        r.on_message(1, ClientMsg::Start).unwrap();
        assert!(r.hand.in_hand());
        assert_eq!(r.reset_scores().unwrap_err().code, ErrorCode::HandInProgress);
        finish(&mut r);
        let recorded = r.session_message().current_hand.unwrap();
        let old_hand_number = r.hand.number;
        let outgoing = r.member(0).id;
        r.leave(0);
        player(&mut r, 2, 0);
        r.on_message(2, ClientMsg::ResetScores).unwrap();
        assert_eq!(r.session.scores, vec![0; 5]);
        assert!(r.lifecycle.standings.is_empty(), "departed people's scores reset too");
        assert!(r.lifecycle.archives[0].standings.iter().any(|p| p.id == outgoing));
        assert_eq!(r.session_message().current_hand, Some(recorded.clone()));
        assert!(r.session_message().records.is_empty());
        assert_eq!(r.hand.number, old_hand_number);
        assert!(r.hand.booked);
        r.advance();
        assert_eq!(r.session.hands_played, old_hand_number + 1);
        // Changing rules after reset must not make old completed log un-restorable.
        r.settings = MightySettings::new(Preset::Default);
        let mut restored = Room::<Mighty>::restore(
            serde_json::to_value(r.snapshot()).unwrap(),
            Arc::new(RoomEnv::new(Duration::ZERO)),
            mighty_bots(),
        )
        .unwrap();
        assert_eq!(restored.session_message().current_hand, Some(recorded));
        assert!(restored.hand.booked);
        restored.advance();
        assert_eq!(restored.session.hands_played, old_hand_number + 1);
        assert_eq!(restored.session.scores, vec![0; 5]);
    }
    #[tokio::test]
    async fn resetting_scores_preserves_next_dealer_and_sequence_after_restore() {
        use mighty::rules::NextDealer;
        for (dealer, friend, expected) in [
            (NextDealer::Rotate, Some(3), 3),
            (NextDealer::FriendOrDeclarer, Some(3), 3),
            (NextDealer::FriendOrDeclarer, None, 4),
        ] {
            let mut r = room();
            player(&mut r, 1, 0);
            for s in 1..5 {
                r.add_bot(s, Level::Easy).unwrap();
            }
            r.on_message(1, ClientMsg::Start).unwrap();
            finish(&mut r);
            let mut rules = r.settings.rules();
            rules.next_dealer = dealer;
            r.settings.rules = Some(rules);
            r.session.rotation = 2;
            let last = r.session.hands.last_mut().unwrap();
            last.friend = friend;
            last.declarer = 4;
            let before = r.session.options(&r.settings, r.session.hands_played);
            assert_eq!(before.first_bidder, expected);
            let completed = r.session.hands_played;
            let summaries = r.session.hands.clone();
            let history = r.session.history.clone();
            let replay = r.session_message().current_hand;
            r.on_message(1, ClientMsg::ResetScores).unwrap();
            assert_eq!(r.session.hands_played, completed);
            assert_eq!(r.session.rotation, 2);
            assert_eq!(r.session.hands, summaries);
            assert_eq!(r.session.history, history);
            assert_eq!(r.session.scores, vec![0; 5]);
            assert_eq!(r.session_message().current_hand, replay);
            let mut restored = Room::<Mighty>::restore(
                serde_json::to_value(r.snapshot()).unwrap(),
                Arc::new(RoomEnv::new(Duration::ZERO)),
                mighty_bots(),
            )
            .unwrap();
            restored.on_message(1, ClientMsg::Start).unwrap_err(); // no restored connections
            connect(&mut restored, 2);
            let token = match &restored.seating.seats[0] {
                super::Occupant::Human { token, .. } => token.clone(),
                _ => unreachable!(),
            };
            restored
                .join(2, "재용".into(), Some(token), Some(0), None, true)
                .unwrap();
            restored.on_message(2, ClientMsg::Start).unwrap();
            assert_eq!(restored.hand.game.as_ref().unwrap().first_bidder(), before.first_bidder);
            assert_eq!(restored.hand.number, completed);
        }
    }

    #[tokio::test]
    async fn multiplayer_start_requires_each_human_and_observers_cannot_reset_scores() {
        let mut r = room();
        player(&mut r, 1, 0);
        player(&mut r, 2, 1);
        for s in 2..5 {
            r.add_bot(s, Level::Easy).unwrap();
        }
        observer(&mut r, 10);
        assert_eq!(
            r.on_message(10, ClientMsg::ResetScores).unwrap_err().code,
            ErrorCode::NotSeated
        );
        assert_eq!(
            r.on_message(1, ClientMsg::Start).unwrap_err().code,
            ErrorCode::PlayersNotReady
        );
        r.on_message(1, ClientMsg::Ready { ready: true }).unwrap();
        assert_eq!(
            r.on_message(1, ClientMsg::Start).unwrap_err().code,
            ErrorCode::PlayersNotReady
        );
        r.on_message(2, ClientMsg::Ready { ready: true }).unwrap();
        r.on_message(2, ClientMsg::Start).unwrap();
        assert!(r.hand.in_hand());
        assert!(!r.lifecycle.ready.contains(&r.member(0).id));
    }

    #[tokio::test]
    async fn recorded_origin_survives_score_reset_restore_and_rematch_number_reuse() {
        let mut r = room();
        player(&mut r, 1, 0);
        for seat in 1..5 {
            r.add_bot(seat, Level::Easy).unwrap();
        }
        r.on_message(1, ClientMsg::Start).unwrap();
        finish(&mut r);
        let first = r.session_message().current_hand.unwrap();
        assert_eq!(first.session_id, Some(1));
        assert_eq!(first.number, 1);
        r.reset_scores().unwrap();
        assert_eq!(r.lifecycle.id, 2);
        assert_eq!(r.session_message().current_hand, Some(first.clone()));
        assert_eq!(r.lifecycle.archives[0].records[0].session_id, Some(1));
        let restored = Room::<Mighty>::restore(
            serde_json::to_value(r.snapshot()).unwrap(),
            Arc::new(RoomEnv::new(Duration::ZERO)),
            mighty_bots(),
        )
        .unwrap();
        assert_eq!(restored.session_message().current_hand.unwrap().session_id, Some(1));
        r.end_session().unwrap();
        r.rematch().unwrap();
        assert_eq!(r.lifecycle.id, 3);
        assert!(r.session_message().current_hand.is_none());
        r.on_message(1, ClientMsg::Start).unwrap();
        finish(&mut r);
        let rematched = r.session_message().current_hand.unwrap();
        assert_eq!(rematched.number, first.number);
        assert_eq!(rematched.session_id, Some(3));
        assert_ne!(rematched.session_id, first.session_id);
    }

    #[tokio::test]
    async fn legacy_record_origin_remains_unknown_after_restore_instead_of_inheriting_current_period() {
        let mut r = room();
        player(&mut r, 1, 0);
        for seat in 1..5 {
            r.add_bot(seat, Level::Easy).unwrap();
        }
        r.on_message(1, ClientMsg::Start).unwrap();
        finish(&mut r);
        r.reset_scores().unwrap();
        let mut snapshot = serde_json::to_value(r.snapshot()).unwrap();
        snapshot["lifecycle"]["current_hand"]
            .as_object_mut()
            .unwrap()
            .remove("session_id");
        for archive in snapshot["lifecycle"]["archives"].as_array_mut().unwrap() {
            for record in archive["records"].as_array_mut().unwrap() {
                record.as_object_mut().unwrap().remove("session_id");
            }
        }
        let restored =
            Room::<Mighty>::restore(snapshot, Arc::new(RoomEnv::new(Duration::ZERO)), mighty_bots()).unwrap();
        let message = restored.session_message();
        assert_eq!(message.session_id, 2);
        assert_eq!(message.current_hand.as_ref().unwrap().session_id, None);
        assert_eq!(message.archives[0].records[0].session_id, None);
        let public = serde_json::to_value(message).unwrap();
        assert!(public["current_hand"].get("session_id").is_none());
        assert!(public["archives"][0]["records"][0].get("session_id").is_none());
    }
}
