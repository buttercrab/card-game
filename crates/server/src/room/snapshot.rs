//! A room saved to disk, so it survives a restart, and as a problem report
//! carries it.
//!
//! A room is saved as a [`SnapshotV2`]: the seats, the session and the
//! hand as its typed log. Logs saved before moves were addressed by seat
//! kept a 딜미스 off the caller's turn as an `out_of_turn` entry; it reads
//! as the seat's move (`LogEntry::Act`) like any other. Files in the first format (an untyped log) still
//! restore through [`migrate_v1`], so tables saved by the last server come
//! back across the deploy that brings this one; they are written in the
//! new format from then on.
//!
//! Writing is a [`Persister`]'s job: a task of the room's own that writes
//! the latest snapshot it was handed, off the room's loop.

use super::hand::{LogEntry, replay};
use super::seating::Occupant;
use super::{Room, RoomEnv, TableSettings};
use crate::session::SessionGame;
use engine::Turn;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};

/// The format [`Room::snapshot`] writes.
const FORMAT: u32 = 2;

/// Everything needed to rebuild a room after a restart. The hand is kept
/// as its log, since a game replays exactly from it.
#[derive(Serialize, Deserialize)]
#[serde(bound = "")]
pub struct SnapshotV2<G: SessionGame> {
    /// Always [`FORMAT`].
    format: u32,
    id: String,
    game: String,
    settings: G::Settings,
    seats: Vec<Occupant>,
    scores: Vec<i64>,
    hands_played: u32,
    history: Vec<Vec<i64>>,
    hands: Vec<G::Summary>,
    table: TableSettings,
    rotation: usize,
    hand: Option<SavedHand<G::Action>>,
}

/// The hand on the table, as saved.
#[derive(Serialize, Deserialize)]
struct SavedHand<A> {
    number: u32,
    log: Vec<LogEntry<A>>,
    /// When it was dealt, in Unix seconds.
    #[serde(default)]
    started: Option<u64>,
}

/// Reads a snapshot in the first format, where the hand's log was a list
/// of bare actions (whoever's turn it was, or the deal) and out-of-turn
/// ones as `{"out_of_turn": {seat, action}}`: replaying it tells which
/// each bare action was.
pub fn migrate_v1<G: SessionGame>(v1: Value) -> Result<SnapshotV2<G>, String> {
    #[derive(Deserialize)]
    #[serde(bound = "")]
    struct V1<G: SessionGame> {
        id: String,
        game: String,
        settings: G::Settings,
        seats: Vec<Occupant>,
        scores: Vec<i64>,
        hands_played: u32,
        history: Vec<Vec<i64>>,
        hands: Vec<G::Summary>,
        table: TableSettings,
        rotation: usize,
        hand: Option<V1Hand>,
    }
    #[derive(Deserialize)]
    struct V1Hand {
        number: u32,
        actions: Vec<Value>,
        #[serde(default)]
        started: Option<u64>,
    }
    let v1: V1<G> = serde_json::from_value(v1).map_err(|e| e.to_string())?;
    let hand = match v1.hand {
        None => None,
        Some(hand) => {
            let options = G::hand_options(
                &v1.settings,
                hand.number,
                (v1.hands.len() == hand.number as usize)
                    .then(|| v1.hands.last())
                    .flatten(),
                v1.rotation,
            );
            let mut game = G::new_game(&options).map_err(|e| e.to_string())?;
            let mut log = Vec::with_capacity(hand.actions.len());
            for (i, entry) in hand.actions.into_iter().enumerate() {
                let parse = |v: Value| serde_json::from_value::<G::Action>(v).map_err(|e| format!("action {i}: {e}"));
                let entry = match entry.get("out_of_turn") {
                    Some(o) => LogEntry::Act {
                        seat: o["seat"].as_u64().ok_or(format!("action {i}: no seat"))? as usize,
                        action: parse(o["action"].clone())?,
                    },
                    None => match G::turn(&game) {
                        Turn::Chance => LogEntry::Chance { action: parse(entry)? },
                        Turn::Seat(seat) => LogEntry::Act {
                            seat,
                            action: parse(entry)?,
                        },
                        Turn::Over => return Err(format!("action {i}: after the hand was over")),
                    },
                };
                replay::<G>(&mut game, std::slice::from_ref(&entry))?;
                log.push(entry);
            }
            Some(SavedHand {
                number: hand.number,
                log,
                started: hand.started,
            })
        }
    };
    Ok(SnapshotV2 {
        format: FORMAT,
        id: v1.id,
        game: v1.game,
        settings: v1.settings,
        seats: v1.seats,
        scores: v1.scores,
        hands_played: v1.hands_played,
        history: v1.history,
        hands: v1.hands,
        table: v1.table,
        rotation: v1.rotation,
        hand,
    })
}

impl<G: SessionGame> Room<G> {
    /// The room as saved; see [`SnapshotV2`].
    pub fn snapshot(&self) -> SnapshotV2<G> {
        let session = &self.session;
        SnapshotV2 {
            format: FORMAT,
            id: self.id.clone(),
            game: G::NAME.to_string(),
            settings: self.settings.clone(),
            seats: self.seating.seats.clone(),
            scores: session.scores.clone(),
            hands_played: session.hands_played,
            history: session.history.clone(),
            hands: session.hands.clone(),
            table: self.table.clone(),
            rotation: session.rotation,
            hand: self.hand.game.as_ref().map(|_| SavedHand {
                number: self.hand.number,
                log: self.hand.log.clone(),
                started: self.hand.started,
            }),
        }
    }

    /// The room for a problem report: like [`Room::snapshot`], but seats show
    /// only names, never the tokens that reclaim them.
    pub(super) fn report(&self) -> Value {
        let mut report = serde_json::to_value(self.snapshot()).expect("snapshots serialize");
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

    /// Rebuilds a room from a saved snapshot, of this format or the first
    /// ([`migrate_v1`]), by replaying its hand.
    pub fn restore(snapshot: Value, env: Arc<RoomEnv>) -> Result<Room<G>, String> {
        let s: SnapshotV2<G> = match snapshot.get("format").and_then(Value::as_u64) {
            Some(1) => migrate_v1(snapshot)?,
            Some(2) => serde_json::from_value(snapshot).map_err(|e| e.to_string())?,
            format => return Err(format!("unknown snapshot format {format:?}")),
        };
        if s.game != G::NAME {
            return Err(format!("not a {} room", G::NAME));
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
            replay::<G>(&mut game, &hand.log)?;
            // A hand saved over was booked before it was saved.
            room.hand.booked = G::turn(&game) == Turn::Over;
            room.hand.game = Some(game);
            room.hand.log = hand.log;
            room.hand.number = hand.number;
            room.hand.started = hand.started;
        }
        Ok(room)
    }
}

/// Writes through a temporary file so a crash never leaves half a snapshot.
fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents)?;
    std::fs::rename(tmp, path)
}

enum Persist {
    Write(String),
    /// Answers once every write before it is on disk.
    Flush(oneshot::Sender<()>),
    /// The room closed for good: its file goes, and the task ends.
    Remove,
}

/// A room's writer: a task that writes the latest snapshot it was handed
/// to the room's file, on a blocking thread. Snapshots handed over faster
/// than they are written are skipped but for the last.
pub(super) struct Persister {
    tx: mpsc::UnboundedSender<Persist>,
    task: tokio::task::JoinHandle<()>,
}

impl Persister {
    /// Starts the writer for `path`, the file of room `room`.
    pub fn start(room: String, path: PathBuf) -> Persister {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(async move {
            while let Some(first) = rx.recv().await {
                let mut latest = None;
                let mut acks = Vec::new();
                let mut remove = false;
                let mut next = Some(first);
                while let Some(message) = next {
                    match message {
                        Persist::Write(text) => latest = Some(text),
                        Persist::Flush(ack) => acks.push(ack),
                        Persist::Remove => remove = true,
                    }
                    next = rx.try_recv().ok();
                }
                let path = path.clone();
                let room = room.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if remove {
                        let _ = std::fs::remove_file(&path);
                    } else if let Some(text) = latest
                        && let Err(e) = write_atomic(&path, &text)
                    {
                        tracing::error!(room, "could not save the room: {e}");
                    }
                })
                .await;
                for ack in acks {
                    let _ = ack.send(());
                }
                if remove {
                    break;
                }
            }
        });
        Persister { tx, task }
    }

    /// Hands over the room as it is now.
    pub fn save(&self, snapshot: String) {
        let _ = self.tx.send(Persist::Write(snapshot));
    }

    /// Waits until everything handed over is on disk.
    pub async fn flush(&self) {
        let (ack, done) = oneshot::channel();
        if self.tx.send(Persist::Flush(ack)).is_ok() {
            let _ = done.await;
        }
    }

    /// Removes the room's file once the writes before are done, and stops.
    pub async fn remove(self) {
        let _ = self.tx.send(Persist::Remove);
        let _ = self.task.await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::SeatsMoved;
    use crate::session::MightySettings;
    use mighty::Mighty;
    use std::time::Duration;

    fn env() -> Arc<RoomEnv> {
        Arc::new(RoomEnv::new(Duration::ZERO))
    }

    /// Seats moved between hands keep the opening seat with its player,
    /// saved and restored too.
    #[test]
    fn the_rotation_survives_a_restore() {
        let mut room = Room::<Mighty>::new("t".into(), MightySettings::default(), env());
        room.session.hands_played = 3;
        let opener = |r: &Room<Mighty>| r.session.options(&r.settings, r.session.hands_played).first_bidder;
        let moved = |order: &[usize]| SeatsMoved::Shuffle { order: order.to_vec() };
        room.reseat(&[1, 2, 4, 0, 3], moved(&[1, 2, 4, 0, 3]));
        room.reseat(&[4, 3, 2, 1, 0], moved(&[4, 3, 2, 1, 0]));
        assert_eq!(opener(&room), 4);
        let saved = serde_json::to_value(room.snapshot()).unwrap();
        let restored = Room::<Mighty>::restore(saved, env()).unwrap();
        assert_eq!(opener(&restored), 4);
    }

    /// A table saved mid-hand by the last server (format 1, with a deal
    /// thrown in out of turn) comes back in the same place, its log typed.
    #[test]
    fn a_first_format_snapshot_restores_mid_hand() {
        use engine::Game;
        use rand::SeedableRng;
        let mut rng = rand::rngs::StdRng::seed_from_u64(7);
        let settings = MightySettings::default();
        let mut room = Room::<Mighty>::new("abc".into(), settings.clone(), env());
        let mut game = Mighty::new_game(&room.session.options(&settings, 0)).unwrap();
        // Written as the first format wrote it: bare actions, and the
        // out-of-turn ones wrapped.
        let mut actions = Vec::new();
        let mut misdealt = None;
        for _ in 0..12 {
            let entry = match Mighty::turn(&game) {
                Turn::Chance => {
                    let deal = Mighty::sample_chance(&game, &mut rng);
                    Mighty::apply_chance(&mut game, deal.clone()).unwrap();
                    serde_json::to_value(deal).unwrap()
                }
                Turn::Seat(seat) => {
                    let other = (seat + 1) % 5;
                    let misdeal = mighty::Action::Misdeal;
                    if misdealt.is_none() && Mighty::legal_actions(&game, other).contains(&misdeal) {
                        misdealt = Some((actions.len(), other));
                        Mighty::apply(&mut game, other, misdeal.clone()).unwrap();
                        json!({ "out_of_turn": { "seat": other, "action": misdeal } })
                    } else {
                        let action = Mighty::legal_actions(&game, seat)[0].clone();
                        Mighty::apply(&mut game, seat, action.clone()).unwrap();
                        serde_json::to_value(action).unwrap()
                    }
                }
                Turn::Over => break,
            };
            actions.push(entry);
        }
        room.seating.seats[0] = Occupant::Human {
            name: "A".into(),
            token: "t0".into(),
            player: None,
        };
        let mut v1 = serde_json::to_value(room.snapshot()).unwrap();
        v1["format"] = json!(1);
        v1["hand"] = json!({ "number": 0, "actions": actions, "started": 123 });
        let restored = Room::<Mighty>::restore(v1, env()).unwrap();
        let view = |g: &mighty::State| Mighty::view(g, engine::Viewer::Seat(0));
        assert_eq!(view(restored.hand.game.as_ref().unwrap()), view(&game));
        assert_eq!(restored.hand.log.len(), actions.len());
        assert!(matches!(restored.hand.log[0], LogEntry::Chance { .. }));
        // The misdeal off turn reads as that seat's move.
        if let Some((i, seat)) = misdealt {
            let misdeal = mighty::Action::Misdeal;
            assert_eq!(restored.hand.log[i], LogEntry::Act { seat, action: misdeal });
        }
        assert_eq!(restored.hand.started, Some(123));
        assert_eq!(restored.seating.seats[0], room.seating.seats[0]);
        // Saved again, it is the new format, and restores the same.
        let v2 = serde_json::to_value(restored.snapshot()).unwrap();
        assert_eq!(v2["format"], 2);
        let again = Room::<Mighty>::restore(v2.clone(), env()).unwrap();
        assert_eq!(serde_json::to_value(again.snapshot()).unwrap(), v2);
    }

    /// A second-format file saved before moves were addressed by seat
    /// (a 딜미스 off turn as `out_of_turn`) restores, and is saved again
    /// with the misdeal as the seat's move.
    #[test]
    fn an_out_of_turn_entry_restores_as_the_seats_move() {
        use engine::Game;
        use rand::SeedableRng;
        let settings = MightySettings::default();
        let room = Room::<Mighty>::new("abc".into(), settings.clone(), env());
        let options = room.session.options(&settings, 0);
        let mut game = Mighty::new_game(&options).unwrap();
        let mut rng = rand::rngs::StdRng::seed_from_u64(0);
        let mut log = Vec::new();
        // Deal until a seat other than the first bidder may throw it in.
        let caller = loop {
            let deal = Mighty::sample_chance(&game, &mut rng);
            Mighty::apply_chance(&mut game, deal.clone()).unwrap();
            log.push(json!({ "kind": "chance", "action": deal }));
            let Turn::Seat(to_act) = Mighty::turn(&game) else {
                unreachable!()
            };
            if let Some(s) = (0..5).find(|&s| s != to_act && !Mighty::legal_actions(&game, s).is_empty()) {
                break s;
            }
            let pass = mighty::Action::Pass;
            if !Mighty::legal_actions(&game, to_act).contains(&pass) {
                // Nobody can pass: start over on a fresh hand.
                game = Mighty::new_game(&options).unwrap();
                log.clear();
                continue;
            }
            // Everyone passes: a redeal, and another try.
            while let Turn::Seat(s) = Mighty::turn(&game) {
                Mighty::apply(&mut game, s, pass.clone()).unwrap();
                log.push(json!({ "kind": "act", "seat": s, "action": pass }));
            }
        };
        Mighty::apply(&mut game, caller, mighty::Action::Misdeal).unwrap();
        log.push(json!({ "kind": "out_of_turn", "seat": caller, "action": "Misdeal" }));
        let mut saved = serde_json::to_value(room.snapshot()).unwrap();
        saved["hand"] = json!({ "number": 0, "log": log });
        let restored = Room::<Mighty>::restore(saved, env()).unwrap();
        assert_eq!(restored.hand.game.as_ref(), Some(&game));
        let again = serde_json::to_value(restored.snapshot()).unwrap();
        let last = again["hand"]["log"].as_array().unwrap().last().unwrap().clone();
        assert_eq!(last, json!({ "kind": "act", "seat": caller, "action": "Misdeal" }));
    }

    #[test]
    fn an_unknown_format_or_a_broken_log_is_refused() {
        let room = Room::<Mighty>::new("abc".into(), MightySettings::default(), env());
        let mut saved = serde_json::to_value(room.snapshot()).unwrap();
        saved["format"] = json!(3);
        assert!(Room::<Mighty>::restore(saved.clone(), env()).is_err());
        saved["format"] = json!(2);
        // A move by a seat whose turn it is not.
        saved["hand"] = json!({ "number": 0, "log": [{ "kind": "act", "seat": 0, "action": "Pass" }] });
        assert!(Room::<Mighty>::restore(saved, env()).is_err());
    }

    #[tokio::test]
    async fn the_persister_writes_the_last_snapshot_and_removes_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("abc.json");
        let persister = Persister::start("abc".into(), path.clone());
        for i in 0..50 {
            persister.save(format!("{{\"n\":{i}}}"));
        }
        persister.flush().await;
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"n\":49}");
        persister.save("{\"n\":50}".into());
        persister.remove().await;
        assert!(!path.exists(), "a closed room leaves no file");
    }
}
