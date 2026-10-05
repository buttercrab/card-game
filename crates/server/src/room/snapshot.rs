//! A room saved to disk, so it survives a restart, and as a problem report
//! carries it.

use super::seating::Occupant;
use super::{Room, RoomEnv, TableSettings};
use crate::session::SessionGame;
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Bumped when [`Room::snapshot`] changes incompatibly; older files are skipped.
const SNAPSHOT_FORMAT: u32 = 1;

/// Writes through a temporary file so a crash never leaves half a snapshot.
fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents)?;
    std::fs::rename(tmp, path)
}

/// Where a room is saved, if anywhere, and what was saved last.
pub(super) struct Saver {
    path: Option<PathBuf>,
    last: String,
}

impl Saver {
    pub fn new(path: Option<PathBuf>) -> Saver {
        Saver {
            path,
            last: String::new(),
        }
    }

    /// Writes `snapshot` if it differs from the last one written.
    pub fn save(&mut self, room: &str, snapshot: &Value) {
        let Some(path) = &self.path else { return };
        let text = serde_json::to_string(snapshot).expect("snapshots serialize");
        if text != self.last {
            if let Err(e) = write_atomic(path, &text) {
                tracing::error!(room, "could not save the room: {e}");
            }
            self.last = text;
        }
    }

    /// Writes `snapshot` for the next server to restore.
    pub fn save_now(&self, room: &str, snapshot: &Value) {
        let Some(path) = &self.path else { return };
        let text = serde_json::to_string(snapshot).expect("snapshots serialize");
        if let Err(e) = write_atomic(path, &text) {
            tracing::error!(room, "could not save the room for a restart: {e}");
        }
    }

    /// The room closed for good: its file goes.
    pub fn remove(&self) {
        if let Some(path) = &self.path {
            let _ = std::fs::remove_file(path);
        }
    }
}

impl<G: SessionGame> Room<G> {
    /// Everything needed to rebuild the room after a restart. The hand is
    /// kept as its action log, since a game replays exactly from it.
    pub fn snapshot(&self) -> Value {
        let session = &self.session;
        json!({
            "format": SNAPSHOT_FORMAT,
            "id": self.id,
            "game": G::NAME,
            "settings": self.settings,
            "seats": self.seating.seats,
            "scores": session.scores,
            "hands_played": session.hands_played,
            "history": session.history,
            "hands": session.hands,
            "table": self.table,
            "rotation": session.rotation,
            "hand": self.hand.game.as_ref().map(|_| json!({
                "number": self.hand.number, "actions": self.hand.log, "started": self.hand.started,
            })),
        })
    }

    /// The room for a problem report: like [`Room::snapshot`], but seats show
    /// only names, never the tokens that reclaim them.
    pub(super) fn report(&self) -> Value {
        let mut report = self.snapshot();
        report["seats"] = self
            .seating
            .seats
            .iter()
            .map(|s| match s {
                Occupant::Empty => json!("empty"),
                Occupant::Human { name, .. } => json!({ "human": name }),
                Occupant::Bot { level, name } => json!({ "bot": level, "name": name }),
            })
            .collect();
        report
    }

    /// Rebuilds a room from [`Room::snapshot`] by replaying its hand.
    pub fn restore(snapshot: Value, env: Arc<RoomEnv>) -> Result<Room<G>, String> {
        #[derive(Deserialize)]
        struct SavedHand {
            number: u32,
            actions: Vec<Value>,
            #[serde(default)]
            started: Option<u64>,
        }
        #[derive(Deserialize)]
        struct Snapshot<S, T> {
            format: u32,
            id: String,
            game: String,
            settings: S,
            seats: Vec<Occupant>,
            scores: Vec<i64>,
            hands_played: u32,
            history: Vec<Vec<i64>>,
            hands: Vec<T>,
            table: TableSettings,
            rotation: usize,
            hand: Option<SavedHand>,
        }
        let s: Snapshot<G::Settings, G::Summary> = serde_json::from_value(snapshot).map_err(|e| e.to_string())?;
        if s.format != SNAPSHOT_FORMAT || s.game != G::NAME {
            return Err(format!("not a {} room in format {SNAPSHOT_FORMAT}", G::NAME));
        }
        let mut room = Room::new(s.id, s.settings, env);
        let n = room.seating.len();
        if s.seats.len() != n || s.scores.len() != n {
            return Err("seat count does not match the settings".into());
        }
        room.seating.seats = s.seats;
        room.session.scores = s.scores;
        room.session.hands_played = s.hands_played;
        room.session.history = s.history;
        room.session.hands = s.hands;
        room.session.rotation = s.rotation;
        room.table = s.table;
        if let Some(hand) = s.hand {
            let options = room.session.options(&room.settings, hand.number);
            let mut game = G::new_game(&options).map_err(|e| e.to_string())?;
            for (i, entry) in hand.actions.iter().enumerate() {
                let parse =
                    |v: &Value| serde_json::from_value::<G::Action>(v.clone()).map_err(|e| format!("action {i}: {e}"));
                let applied = match entry.get("out_of_turn") {
                    Some(o) => {
                        let seat = o["seat"].as_u64().ok_or(format!("action {i}: no seat"))? as usize;
                        G::apply_out_of_turn(&mut game, seat, parse(&o["action"])?)
                    }
                    None => G::apply(&mut game, parse(entry)?),
                };
                applied.map_err(|e| format!("action {i}: {e}"))?;
            }
            // A hand saved over was booked before it was saved.
            room.hand.booked = G::turn(&game) == engine::Turn::Over;
            room.hand.game = Some(game);
            room.hand.log = hand.actions;
            room.hand.number = hand.number;
            room.hand.started = hand.started;
        }
        Ok(room)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::SeatsMoved;
    use crate::session::MightySettings;
    use mighty::Mighty;
    use std::time::Duration;

    /// Seats moved between hands keep the opening seat with its player,
    /// saved and restored too.
    #[test]
    fn the_rotation_survives_a_restore() {
        let env = Arc::new(RoomEnv::new(Duration::ZERO));
        let mut room = Room::<Mighty>::new("t".into(), MightySettings::default(), env.clone());
        room.session.hands_played = 3;
        let opener = |r: &Room<Mighty>| r.session.options(&r.settings, r.session.hands_played).first_bidder;
        let moved = |order: &[usize]| SeatsMoved::Shuffle { order: order.to_vec() };
        room.reseat(&[1, 2, 4, 0, 3], moved(&[1, 2, 4, 0, 3]));
        room.reseat(&[4, 3, 2, 1, 0], moved(&[4, 3, 2, 1, 0]));
        assert_eq!(opener(&room), 4);
        let restored = Room::<Mighty>::restore(room.snapshot(), env).unwrap();
        assert_eq!(opener(&restored), 4);
    }
}
