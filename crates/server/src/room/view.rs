//! What the room sends: the table to everyone, the hand as each seat (or a
//! spectator) may see it, and single messages to one connection.

use super::seating::Occupant;
use super::{ConnId, Msg, Room};
use crate::game::ServerGame;
use crate::protocol::{RoomMsg, SeatInfo, ServerMsg, StateMsg};
use engine::{Turn, Viewer};

pub(super) fn session_envelope<T: serde::Serialize>(session: T) -> impl serde::Serialize {
    #[derive(serde::Serialize)]
    #[serde(tag = "type", rename_all = "snake_case")]
    enum Envelope<T> {
        Session(T),
    }
    Envelope::Session(session)
}

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

impl<G: ServerGame> Room<G> {
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
            room_version: self.commands.room_version,
            protocol: crate::protocol::version().to_string(),
            id: self.id.clone(),
            game: G::ID.to_string(),
            settings: self.settings.clone(),
            rules: G::table_rules(&self.settings),
            customized: G::customized(&self.settings),
            seats,
            in_hand: self.hand.in_hand(),
            table: self.table.clone(),
            clock: self.clock.info(),
            watching: self.observer_count(),
            observers: self.observers(),
            ready: self.readiness(),
            participant_ids: (0..self.seating.len()).map(|s| self.member(s).id).collect(),
            participation: self.participation(),
            showing: self.hand.game.is_some(),
            capacity: Some(self.capacity_status()),
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
        let turn = G::turn(game);
        // A newcomer owns the current seat, not the outgoing hand's private
        // cards. Live takeover remains unchanged; settled permission requires
        // the frozen original identity, including after restore or score reset.
        let seat = seat.filter(|&seat| turn != Turn::Over || self.owns_current_replay(seat));
        let viewer = seat.map_or(Viewer::Spectator, Viewer::Seat);
        let (legal, out_of_turn) = match seat {
            Some(s) if turn == Turn::Seat(s) => (G::legal_actions(game, s), Vec::new()),
            Some(s) => (Vec::new(), G::legal_actions(game, s)),
            None => (Vec::new(), Vec::new()),
        };
        let grace_ms = self.hand.grace_left(&legal).as_millis() as u64;
        let notes = G::notes(game, seat, &legal);
        Some(ServerMsg::State(StateMsg {
            room_version: self.commands.room_version,
            command: seat.and_then(|seat| self.command_window(seat)),
            view: G::view(game, viewer),
            notes,
            policy_actions: Some(crate::protocol::NativePolicyActions {
                legal: self.policy_actions(&legal),
                out_of_turn: self.policy_actions(&out_of_turn),
            }),
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
            for &conn in self.seating.conns.keys() {
                self.send_session(conn);
            }
        }
        let room = self.room_message();
        for (&id, conn) in &self.seating.conns {
            self.send(id, &room);
            if let Some(state) = self.state_message(conn.seat) {
                self.send(id, &state);
            }
            if let Some(command) = self.room_command_window(id) {
                self.send(id, &ServerMsg::RoomCommandWindow { command });
            }
        }
    }

    /// Queue a connection-local public checkpoint, materialized after the
    /// actor commits the room version. Never serialize a pre-settle marker.
    pub(super) fn public_session_checkpoint(&self, conn: ConnId) {
        if let Some(effect) = self
            .publication
            .push(super::publication::Effect::PublicSessionCheckpoint { conn })
        {
            self.publish_effect(effect);
        }
    }

    /// Sends a new connection the session so far; the table follows.
    pub(super) fn greet(&self, conn: ConnId) {
        self.public_session_checkpoint(conn);
    }

    pub(super) fn tell_all(&self, message: &Msg<G>) {
        for &conn in self.seating.conns.keys() {
            self.send(conn, message);
        }
    }

    pub(super) fn session_envelope_ref(&self) -> impl serde::Serialize + '_ {
        session_envelope(self.session_ref())
    }

    pub(super) fn send_session(&self, conn: ConnId) {
        self.send_serializable(conn, &self.session_envelope_ref());
    }

    pub(super) fn send(&self, conn: ConnId, message: &Msg<G>) {
        self.send_serializable(conn, message);
    }

    fn send_serializable(&self, conn: ConnId, message: &impl serde::Serialize) {
        let Some(connection) = self.seating.conns.get(&conn) else {
            return;
        };
        let effect = match connection.tx.prepare(message) {
            Ok(frame) => super::publication::Effect::Message { conn, frame },
            Err(cause) => super::publication::Effect::Abort { conn, cause },
        };
        if let Some(effect) = self.publication.push(effect) {
            self.publish_effect(effect);
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

#[cfg(test)]
mod settled_audience_tests {
    use super::*;
    use crate::protocol::ClientMsg;
    use engine::{Game, TableBots};
    use serde_json::{Value, json};
    use std::{sync::Arc, time::Duration};

    fn occupied<G: ServerGame>(
        settings: G::Settings,
        bots: Arc<dyn TableBots<G>>,
    ) -> (Room<G>, Vec<crate::outbound::Receiver>) {
        let mut room = Room::new(
            "audience".into(),
            settings,
            Arc::new(super::super::RoomEnv::new(Duration::ZERO)),
            bots,
        );
        let mut receivers = Vec::new();
        for seat in 0..room.seating.len() {
            let conn = seat as u64 + 1;
            let (tx, rx) = crate::outbound::test_channel();
            room.seating.conns.insert(conn, super::super::seating::Conn::new(tx));
            room.on_message(
                conn,
                ClientMsg::Join {
                    name: format!("P{seat}"),
                    token: None,
                    seat: Some(seat),
                    device: None,
                    reclaim: false,
                },
            )
            .unwrap();
            room.on_message(conn, ClientMsg::Ready { ready: true }).unwrap();
            receivers.push(rx);
        }
        room.on_message(1, ClientMsg::Start).unwrap();
        room.advance();
        room.hand.dealt_at = None;
        (room, receivers)
    }
    fn state<G: ServerGame>(room: &Room<G>, seat: usize) -> Value {
        serde_json::to_value(room.state_message(Some(seat)).unwrap()).unwrap()
    }
    fn replace<G: ServerGame>(room: &mut Room<G>, seat: usize) {
        room.seating.put(
            seat,
            super::super::seating::Occupant::Human {
                name: "Replacement".into(),
                token: "new-unrelated-seat-token".into(),
                player: None,
            },
        );
    }
    fn finish_poker(room: &mut Room<poker::Poker>) {
        for _ in 0..3 {
            if !room.hand.in_hand() {
                return;
            }
            let Turn::Seat(seat) = room.hand.turn().unwrap() else {
                panic!("player turn");
            };
            room.act(seat, json!({"type":"fold"})).unwrap();
            room.advance();
        }
        assert!(!room.hand.in_hand());
    }
    fn assert_public_poker(value: &Value) {
        assert!(value["view"]["over"].as_bool().unwrap());
        assert!(value["view"]["viewer"].is_null());
        assert!(
            value["view"]["players"]
                .as_array()
                .unwrap()
                .iter()
                .all(|player| player["hole"].is_null() || player["shown"] == true)
        );
        assert_eq!(value["legal"], json!([]));
        assert_eq!(value["out_of_turn"], json!([]));
        assert!(value["command"].is_null());
    }

    #[test]
    fn settled_poker_replacement_gets_public_view_even_after_legacy_roster_reconstruction() {
        let (mut room, _receivers) =
            occupied::<poker::Poker>(poker::PokerSettings::default(), Arc::new(poker::PokerBots));
        finish_poker(&mut room);
        let original = state(&room, 0);
        assert_eq!(original["view"]["viewer"], 0);
        assert_eq!(original["view"]["players"][0]["hole"].as_array().unwrap().len(), 2);
        assert_eq!(original["view"]["players"][0]["shown"], false);
        replace(&mut room, 0);
        assert_public_poker(&state(&room, 0));
        let mut saved = serde_json::to_value(room.snapshot()).unwrap();
        // Restore may reconstruct this old optional roster from current seats;
        // only the frozen current replay can establish settled private ownership.
        saved["lifecycle"]["hand_members"] = json!([]);
        let restored = Room::<poker::Poker>::restore(saved, room.env.clone(), Arc::new(poker::PokerBots)).unwrap();
        assert_public_poker(&state(&restored, 0));
        assert_eq!(state(&restored, 1)["view"]["viewer"], 1);
    }

    #[test]
    fn original_poker_token_reclaim_retains_private_cards_and_missing_record_fails_closed() {
        let (mut room, _receivers) =
            occupied::<poker::Poker>(poker::PokerSettings::default(), Arc::new(poker::PokerBots));
        finish_poker(&mut room);
        let original = state(&room, 0);
        let original_id = room.member(0).id;
        let super::super::seating::Occupant::Human { token, .. } = room.seating.seats[0].clone() else {
            panic!("human");
        };
        let (tx, _rx) = crate::outbound::test_channel();
        room.seating.conns.insert(100, super::super::seating::Conn::new(tx));
        room.on_message(
            100,
            ClientMsg::Join {
                name: "Returning".into(),
                token: Some(token),
                seat: None,
                device: None,
                reclaim: true,
            },
        )
        .unwrap();
        assert_eq!(room.member(0).id, original_id);
        assert_eq!(
            state(&room, 0)["view"]["players"][0]["hole"],
            original["view"]["players"][0]["hole"]
        );
        assert_eq!(state(&room, 0)["view"]["viewer"], 0);
        room.clear_current_replay();
        assert_public_poker(&state(&room, 0));
    }

    #[test]
    fn live_takeover_private_projection_is_unchanged() {
        let (mut room, _receivers) =
            occupied::<poker::Poker>(poker::PokerSettings::default(), Arc::new(poker::PokerBots));
        let original = state(&room, 0);
        room.seating.put(
            0,
            super::super::seating::Occupant::Bot {
                name: "Takeover".into(),
                level: engine::Level::default(),
            },
        );
        assert!(room.hand.in_hand());
        assert_eq!(state(&room, 0)["view"]["viewer"], 0);
        assert_eq!(
            state(&room, 0)["view"]["players"][0]["hole"],
            original["view"]["players"][0]["hole"]
        );
    }

    #[test]
    fn settled_mighty_replacement_cannot_receive_original_declarer_private_discards() {
        let mut rules = mighty::rules::Rules::web_mighty();
        rules.reveal_discards = false;
        let settings = mighty::table::MightySettings {
            rules: Some(rules),
            ..Default::default()
        };
        let (mut room, _receivers) = occupied::<mighty::Mighty>(settings, super::super::mighty_bots());
        for _ in 0..256 {
            if !room.hand.in_hand() {
                break;
            }
            let Turn::Seat(seat) = room.hand.turn().unwrap() else {
                panic!("player turn");
            };
            let actions = mighty::Mighty::legal_actions(room.hand.game.as_ref().unwrap(), seat);
            let bid = actions
                .iter()
                .filter_map(|action| {
                    if let mighty::Action::Bid(contract) = action {
                        Some((contract, action))
                    } else {
                        None
                    }
                })
                .max_by_key(|(contract, _)| (contract.count, contract.trump.is_none()))
                .map(|(_, action)| action);
            let action = bid
                .or_else(|| {
                    actions
                        .iter()
                        .find(|action| matches!(action, mighty::Action::CallFriend(_)))
                })
                .or_else(|| {
                    actions
                        .iter()
                        .find(|action| matches!(action, mighty::Action::Discard(_)))
                })
                .or_else(|| {
                    actions
                        .iter()
                        .find(|action| matches!(action, mighty::Action::Play { .. }))
                })
                .or_else(|| actions.iter().find(|action| matches!(action, mighty::Action::Pass)))
                .unwrap();
            room.act(seat, serde_json::to_value(action).unwrap()).unwrap();
            room.advance();
            room.hand.dealt_at = None;
        }
        assert!(!room.hand.in_hand());
        let public = serde_json::to_value(room.state_message(None).unwrap()).unwrap();
        let declarer = public["view"]["phase"]["Done"]["declarer"].as_u64().unwrap() as usize;
        let original = state(&room, declarer);
        assert_eq!(original["view"]["viewer"], json!({"Seat":declarer}));
        assert_eq!(
            original["view"]["phase"]["Done"]["discards"].as_array().unwrap().len(),
            3
        );
        replace(&mut room, declarer);
        let replacement = state(&room, declarer);
        assert_eq!(replacement["view"]["viewer"], "Spectator");
        assert_eq!(replacement["view"]["phase"]["Done"]["discards"], json!([]));
        assert_eq!(replacement["view"], public["view"]);
        assert_eq!(replacement["legal"], json!([]));
        assert_eq!(replacement["out_of_turn"], json!([]));
        assert!(replacement["command"].is_null());
    }
}
