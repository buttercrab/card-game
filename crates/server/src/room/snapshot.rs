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

use super::hand::{LogEntry, ReplayContext, replay};
use super::seating::Occupant;
use super::{Room, RoomEnv, TableSettings};
use crate::game::ServerGame;
use engine::TableBots;
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
pub struct SnapshotV2<G: ServerGame> {
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
    #[serde(default)]
    lifecycle: super::lifecycle::Lifecycle,
    #[serde(default)]
    commands: super::commands::CommandState,
}

pub(super) struct SessionSnapshotRef<'a, G: ServerGame> {
    pub room_version: u64,
    pub scores: &'a [i64],
    pub hands_played: u32,
    pub history: &'a [Vec<i64>],
    pub hands: &'a [G::Summary],
    pub rotation: usize,
}

/// The hand on the table, as saved.
#[derive(Serialize, Deserialize)]
struct SavedHand<A> {
    #[serde(default)]
    context: Option<ReplayContext>,
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
pub fn migrate_v1<G: ServerGame>(v1: Value) -> Result<SnapshotV2<G>, String> {
    #[derive(Deserialize)]
    #[serde(bound = "")]
    struct V1<G: ServerGame> {
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
                context: None,
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
        lifecycle: super::lifecycle::Lifecycle::default(),
        commands: super::commands::CommandState::default(),
    })
}

impl<G: ServerGame> Room<G> {
    /// Borrow the authoritative persisted schema without cloning retained records.
    pub(super) fn snapshot_ref(&self) -> impl Serialize + '_ {
        self.snapshot_projection(
            SessionSnapshotRef {
                room_version: self.commands.room_version,
                scores: &self.session.scores,
                hands_played: self.session.hands_played,
                history: &self.session.history,
                hands: &self.session.hands,
                rotation: self.session.rotation,
            },
            &self.lifecycle,
            Some(&self.hand),
        )
    }

    pub(super) fn snapshot_projection<'a, L: Serialize + 'a>(
        &'a self,
        session: SessionSnapshotRef<'a, G>,
        lifecycle: L,
        hand: Option<&'a super::hand::Hand<G>>,
    ) -> impl Serialize + 'a {
        #[derive(Serialize)]
        struct SavedHandRef<'a, A> {
            context: &'a Option<ReplayContext>,
            number: u32,
            log: &'a [LogEntry<A>],
            started: Option<u64>,
        }
        #[derive(Serialize)]
        struct SnapshotRef<'a, S, H, A, C, L> {
            format: u32,
            id: &'a str,
            game: &'static str,
            settings: &'a S,
            seats: &'a [Occupant],
            scores: &'a [i64],
            hands_played: u32,
            history: &'a [Vec<i64>],
            hands: &'a [H],
            table: &'a TableSettings,
            rotation: usize,
            hand: Option<SavedHandRef<'a, A>>,
            lifecycle: L,
            commands: C,
        }
        SnapshotRef {
            format: FORMAT,
            id: &self.id,
            game: G::ID,
            settings: &self.settings,
            seats: &self.seating.seats,
            scores: session.scores,
            hands_played: session.hands_played,
            history: session.history,
            hands: session.hands,
            table: &self.table,
            rotation: session.rotation,
            hand: hand.filter(|hand| hand.game.is_some()).map(|hand| SavedHandRef {
                context: &hand.replay_context,
                number: hand.number,
                log: &hand.log,
                started: hand.started,
            }),
            lifecycle,
            commands: self.commands.snapshot_ref_at(self.hand.version, session.room_version),
        }
    }

    /// The room as saved; see [`SnapshotV2`].
    pub fn snapshot(&self) -> SnapshotV2<G> {
        let session = &self.session;
        SnapshotV2 {
            format: FORMAT,
            id: self.id.clone(),
            game: G::ID.to_string(),
            settings: self.settings.clone(),
            seats: self.seating.seats.clone(),
            scores: session.scores.clone(),
            hands_played: session.hands_played,
            history: session.history.clone(),
            hands: session.hands.clone(),
            table: self.table.clone(),
            rotation: session.rotation,
            lifecycle: self.lifecycle.clone(),
            commands: {
                let mut commands = self.commands.clone();
                commands.version = self.hand.version;
                commands
            },
            hand: self.hand.game.as_ref().map(|_| SavedHand {
                context: self.hand.replay_context.clone(),
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
        // Operation digests and private sequence/receipt history are not reports.
        report
            .as_object_mut()
            .expect("snapshot is an object")
            .remove("commands");
        // Guest credentials and seat links are private, like reclaim tokens.
        report["lifecycle"]["guests"] = json!([]);
        report
    }

    /// Rebuilds a room from a saved snapshot, of this format or the first
    /// ([`migrate_v1`]), by replaying its hand.
    pub fn restore(snapshot: Value, env: Arc<RoomEnv>, bots: Arc<dyn TableBots<G>>) -> Result<Room<G>, String> {
        let s: SnapshotV2<G> = match snapshot.get("format").and_then(Value::as_u64) {
            Some(1) => migrate_v1(snapshot)?,
            Some(2) => serde_json::from_value(snapshot).map_err(|e| e.to_string())?,
            format => return Err(format!("unknown snapshot format {format:?}")),
        };
        if s.game != G::ID {
            return Err(format!("not a {} room", G::ID));
        }
        let mut room = Room::new(s.id, s.settings, env, bots);
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
        room.lifecycle = s.lifecycle;
        s.commands.validate_room(&room.id, n)?;
        room.hand.version = s.commands.version;
        room.commands = s.commands;
        room.clear_pending_admissions();
        room.seed_standings();
        if let Some(hand) = s.hand {
            if room.lifecycle.hand_members.len() != n {
                room.lifecycle.hand_members = (0..n).map(|s| room.member(s)).collect();
            }
            let context = hand.context.unwrap_or(ReplayContext {
                settings: serde_json::to_value(&room.settings).map_err(|e| e.to_string())?,
                previous: room
                    .session
                    .last_hand(hand.number)
                    .map(|h| serde_json::to_value(h).expect("summary serializes")),
                rotation: room.session.rotation,
            });
            let settings: G::Settings = serde_json::from_value(context.settings.clone()).map_err(|e| e.to_string())?;
            let previous: Option<G::Summary> = context
                .previous
                .clone()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|e| e.to_string())?;
            let options = G::hand_options(&settings, hand.number, previous.as_ref(), context.rotation);
            room.hand.replay_context = Some(context);
            let mut game = G::new_game(&options).map_err(|e| e.to_string())?;
            replay::<G>(&mut game, &hand.log)?;
            // A hand saved over was booked before it was saved.
            room.hand.booked = G::turn(&game) == Turn::Over;
            room.hand.game = Some(game);
            room.hand.log = hand.log;
            room.hand.number = hand.number;
            room.hand.started = hand.started;
        }
        room.restore_current_replay();
        Ok(room)
    }
}

/// Writes through a temporary file so a crash never leaves half a snapshot.
fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("tmp");
    let mut file = std::fs::File::create(&tmp)?;
    file.write_all(contents.as_bytes())?;
    file.sync_all()?;
    std::fs::rename(tmp, path)?;
    std::fs::File::open(path.parent().unwrap_or_else(|| Path::new(".")))?.sync_all()
}

enum Persist {
    Write(String),
    /// Answers once every write before it is on disk.
    Flush(oneshot::Sender<Result<(), String>>),
    /// The room closed for good: its file goes, and the task ends.
    Remove(oneshot::Sender<Result<(), String>>),
}

/// A room's writer: a task that writes the latest snapshot it was handed
/// to the room's file, on a blocking thread. Snapshots handed over faster
/// than they are written are skipped but for the last.
pub(super) struct Persister {
    tx: mpsc::Sender<Persist>,
    task: tokio::task::JoinHandle<()>,
}

impl Persister {
    /// Starts the writer for `path`, the file of room `room`.
    pub fn start(room: String, path: PathBuf) -> Persister {
        let (tx, mut rx) = mpsc::channel(2);
        let task = tokio::spawn(async move {
            let mut last_error = None;
            while let Some(first) = rx.recv().await {
                let mut latest = None;
                let mut acks = Vec::new();
                let mut remove = false;
                let mut next = Some(first);
                while let Some(message) = next {
                    match message {
                        Persist::Write(text) => latest = Some(text),
                        Persist::Flush(ack) => acks.push(ack),
                        Persist::Remove(ack) => {
                            remove = true;
                            acks.push(ack);
                        }
                    }
                    next = rx.try_recv().ok();
                }
                let path = path.clone();
                let had_write = latest.is_some();
                let result = tokio::task::spawn_blocking(move || {
                    if remove {
                        match std::fs::remove_file(&path) {
                            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                            Ok(()) => std::fs::File::open(path.parent().unwrap_or_else(|| Path::new(".")))?.sync_all(),
                            Err(error) => Err(error),
                        }
                    } else if let Some(text) = latest {
                        write_atomic(&path, &text)
                    } else {
                        Ok(())
                    }
                })
                .await;
                match result {
                    Ok(Ok(())) if had_write || remove => last_error = None,
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => {
                        tracing::error!(room, "could not save the room: {error}");
                        last_error = Some(error.to_string());
                    }
                    Err(error) => last_error = Some(error.to_string()),
                }
                for ack in acks {
                    let _ = ack.send(last_error.clone().map_or(Ok(()), Err));
                }
                if remove {
                    break;
                }
            }
        });
        Persister { tx, task }
    }

    /// Hands over the room as it is now.
    pub async fn save(&self, snapshot: String) -> Result<(), String> {
        self.tx
            .send(Persist::Write(snapshot))
            .await
            .map_err(|_| "room writer closed".to_owned())
    }

    /// Waits until everything handed over is on disk.
    pub async fn flush(&self) -> Result<(), String> {
        let (ack, done) = oneshot::channel();
        self.tx
            .send(Persist::Flush(ack))
            .await
            .map_err(|_| "room writer closed".to_owned())?;
        done.await.map_err(|_| "room writer stopped before flush".to_owned())?
    }

    /// Removes the room's file once the writes before are done, and stops.
    pub async fn remove(self) -> Result<(), String> {
        let (ack, done) = oneshot::channel();
        self.tx
            .send(Persist::Remove(ack))
            .await
            .map_err(|_| "room writer closed".to_owned())?;
        let result = done
            .await
            .map_err(|_| "room writer stopped before removal".to_owned())?;
        self.task.await.map_err(|error| error.to_string())?;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::SeatsMoved;
    use mighty::Mighty;
    use mighty::table::MightySettings;
    use std::time::Duration;

    fn env() -> Arc<RoomEnv> {
        Arc::new(RoomEnv::new(Duration::ZERO))
    }

    /// Seats moved between hands keep the opening seat with its player,
    /// saved and restored too.
    #[test]
    fn the_rotation_survives_a_restore() {
        let mut room = Room::<Mighty>::new("t".into(), MightySettings::default(), env(), crate::room::mighty_bots());
        room.session.hands_played = 3;
        let opener = |r: &Room<Mighty>| r.session.options(&r.settings, r.session.hands_played).first_bidder;
        let moved = |order: &[usize]| SeatsMoved::Shuffle { order: order.to_vec() };
        room.reseat(&[1, 2, 4, 0, 3], moved(&[1, 2, 4, 0, 3]));
        room.reseat(&[4, 3, 2, 1, 0], moved(&[4, 3, 2, 1, 0]));
        assert_eq!(opener(&room), 4);
        let saved = serde_json::to_value(room.snapshot()).unwrap();
        let restored = Room::<Mighty>::restore(saved, env(), crate::room::mighty_bots()).unwrap();
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
        let mut room = Room::<Mighty>::new("abc".into(), settings.clone(), env(), crate::room::mighty_bots());
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
        let restored = Room::<Mighty>::restore(v1, env(), crate::room::mighty_bots()).unwrap();
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
        let again = Room::<Mighty>::restore(v2.clone(), env(), crate::room::mighty_bots()).unwrap();
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
        let room = Room::<Mighty>::new("abc".into(), settings.clone(), env(), crate::room::mighty_bots());
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
        let restored = Room::<Mighty>::restore(saved, env(), crate::room::mighty_bots()).unwrap();
        assert_eq!(restored.hand.game.as_ref(), Some(&game));
        let again = serde_json::to_value(restored.snapshot()).unwrap();
        let last = again["hand"]["log"].as_array().unwrap().last().unwrap().clone();
        assert_eq!(last, json!({ "kind": "act", "seat": caller, "action": "Misdeal" }));
    }

    #[test]
    fn an_unknown_format_or_a_broken_log_is_refused() {
        let room = Room::<Mighty>::new(
            "abc".into(),
            MightySettings::default(),
            env(),
            crate::room::mighty_bots(),
        );
        let mut saved = serde_json::to_value(room.snapshot()).unwrap();
        saved["format"] = json!(3);
        assert!(Room::<Mighty>::restore(saved.clone(), env(), crate::room::mighty_bots()).is_err());
        saved["format"] = json!(2);
        // A move by a seat whose turn it is not.
        saved["hand"] = json!({ "number": 0, "log": [{ "kind": "act", "seat": 0, "action": "Pass" }] });
        assert!(Room::<Mighty>::restore(saved, env(), crate::room::mighty_bots()).is_err());
    }

    #[tokio::test]
    async fn the_persister_writes_the_last_snapshot_and_removes_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("abc.json");
        let persister = Persister::start("abc".into(), path.clone());
        for i in 0..50 {
            persister.save(format!("{{\"n\":{i}}}")).await.unwrap();
        }
        persister.flush().await.unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"n\":49}");
        persister.save("{\"n\":50}".into()).await.unwrap();
        persister.remove().await.unwrap();
        assert!(!path.exists(), "a closed room leaves no file");
    }

    #[tokio::test]
    async fn failed_writes_stay_failed_until_a_new_checkpoint_succeeds() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().join("not-created");
        let path = parent.join("room.json");
        let writer = Persister::start("failure-test".into(), path.clone());
        writer.save("first".into()).await.unwrap();
        assert!(writer.flush().await.is_err());
        assert!(
            writer.flush().await.is_err(),
            "an empty flush cannot erase a failed write"
        );
        std::fs::create_dir(&parent).unwrap();
        writer.save("second".into()).await.unwrap();
        writer.flush().await.unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "second");
        writer.remove().await.unwrap();
    }

    #[tokio::test]
    async fn failed_rename_never_reports_a_successful_flush() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("room.json");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("keep"), "existing").unwrap();
        let writer = Persister::start("rename-test".into(), path.clone());
        writer.save("replacement".into()).await.unwrap();
        assert!(writer.flush().await.is_err());
        assert_eq!(std::fs::read_to_string(path.join("keep")).unwrap(), "existing");
    }
}
