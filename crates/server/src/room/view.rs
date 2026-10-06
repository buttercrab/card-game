//! What the room sends: the table to everyone, the hand as each seat (or a
//! spectator) may see it, and single messages to one connection.

use super::seating::Occupant;
use super::{ConnId, Msg, Room};
use crate::protocol::{RoomMsg, SeatInfo, ServerMsg, StateMsg};
use crate::session::SessionGame;
use engine::{Turn, Viewer};

/// A share link's preview of a table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Preview {
    /// The preset's id.
    pub preset: &'static str,
    /// Whether the table changed the preset's rules.
    pub custom: bool,
    /// How many seats are free.
    pub empty: usize,
}

impl<G: SessionGame> Room<G> {
    fn room_message(&self) -> Msg<G> {
        let seats = self
            .seating
            .seats
            .iter()
            .enumerate()
            .map(|(i, s)| match s {
                Occupant::Empty => SeatInfo::Empty,
                Occupant::Human { name, .. } => SeatInfo::Human {
                    name: name.clone(),
                    connected: self.seating.connected(i),
                    away: self.is_away(i),
                },
                Occupant::Bot { level, name } => SeatInfo::Bot {
                    name: name.clone(),
                    level: *level,
                },
            })
            .collect();
        ServerMsg::Room(RoomMsg {
            protocol: crate::protocol::version().to_string(),
            id: self.id.clone(),
            game: G::NAME.to_string(),
            settings: self.settings.clone(),
            rules: G::table_rules(&self.settings),
            customized: G::customized(&self.settings),
            seats,
            in_hand: self.hand.in_hand(),
            table: self.table.clone(),
            clock: self.clock.info(),
            watching: self.seating.watching(),
            showing: self.hand.game.is_some(),
        })
    }

    /// The hand as `seat` may see it, with its legal actions: as `legal`
    /// on its turn, as `out_of_turn` off it (what it may take or leave,
    /// such as a 딜미스). `grace_ms` is how long
    /// the slowest of its legal actions must still wait after the deal;
    /// `version` is the one a hint for this state carries, so the client
    /// can drop a hint that arrives after the hand moved on.
    fn state_message(&self, seat: Option<usize>) -> Option<Msg<G>> {
        let game = self.hand.game.as_ref()?;
        let viewer = seat.map_or(Viewer::Spectator, Viewer::Seat);
        let turn = G::turn(game);
        let (legal, out_of_turn) = match seat {
            Some(s) if turn == Turn::Seat(s) => (G::legal_actions(game, s), Vec::new()),
            Some(s) => (Vec::new(), G::legal_actions(game, s)),
            None => (Vec::new(), Vec::new()),
        };
        let grace_ms = self.hand.grace_left(&legal).as_millis() as u64;
        let notes = G::notes(game, seat, &legal);
        Some(ServerMsg::State(StateMsg {
            view: G::view(game, viewer),
            notes,
            legal,
            turn,
            out_of_turn,
            grace_ms,
            version: self.hand.version,
        }))
    }

    /// Sends everyone the session if it changed since they were last sent
    /// it, then the table, and each connection the hand as it may see it.
    pub(super) fn broadcast(&mut self) {
        if self.session.revision != self.session_sent {
            self.session_sent = self.session.revision;
            self.tell_all(&ServerMsg::Session(self.session.message()));
        }
        let room = serde_json::to_string(&self.room_message()).expect("messages serialize");
        for (&id, conn) in &self.seating.conns {
            let _ = conn.tx.send(room.clone());
            if let Some(state) = self.state_message(conn.seat) {
                self.send(id, &state);
            }
        }
    }

    /// Sends a new connection the session so far; the table follows.
    pub(super) fn greet(&self, conn: ConnId) {
        self.send(conn, &ServerMsg::Session(self.session.message()));
    }

    pub(super) fn tell_all(&self, message: &Msg<G>) {
        let text = serde_json::to_string(message).expect("messages serialize");
        for c in self.seating.conns.values() {
            let _ = c.tx.send(text.clone());
        }
    }

    pub(super) fn send(&self, conn: ConnId, message: &Msg<G>) {
        if let Some(c) = self.seating.conns.get(&conn) {
            let _ = c.tx.send(serde_json::to_string(message).expect("messages serialize"));
        }
    }

    /// The preset and the free seats, for a share link's preview.
    pub(super) fn describe(&self) -> Preview {
        Preview {
            preset: G::preset_id(&self.settings),
            custom: G::customized(&self.settings),
            empty: self
                .seating
                .seats
                .iter()
                .filter(|s| matches!(s, Occupant::Empty))
                .count(),
        }
    }
}
