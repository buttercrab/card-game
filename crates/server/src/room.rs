//! One table. A room runs as its own task and handles one command at a time,
//! so its state needs no locks. Bots think on a blocking thread and send
//! their move back as a command.

use crate::session::SessionGame;
use engine::{Turn, Viewer};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::any::Any;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, WeakUnboundedSender};

pub type ConnId = u64;

/// Bumped when [`Room::snapshot`] changes incompatibly; older files are skipped.
const SNAPSHOT_FORMAT: u32 = 1;

/// Writes through a temporary file so a crash never leaves half a snapshot.
fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents)?;
    std::fs::rename(tmp, path)
}

/// One line of JSON per move, so a hand can be replayed from the server log.
fn log_action(action: &impl serde::Serialize) -> String {
    serde_json::to_string(action).unwrap_or_else(|e| format!("unserializable: {e}"))
}

pub enum Command {
    Connect {
        conn: ConnId,
        tx: UnboundedSender<String>,
    },
    Disconnect {
        conn: ConnId,
    },
    Message {
        conn: ConnId,
        msg: ClientMsg,
    },
    /// A bot's chosen action (a boxed `G::Action`), for game `version`.
    BotMove {
        version: u64,
        seat: usize,
        action: Box<dyn Any + Send>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    /// Take a seat, or reclaim one with the token from an earlier `welcome`.
    Join {
        name: String,
        #[serde(default)]
        token: Option<String>,
        #[serde(default)]
        seat: Option<usize>,
    },
    /// Give up your seat; a bot takes over if a hand is in progress.
    Leave,
    /// Seat a bot in an empty seat, or in place of a disconnected player.
    AddBot {
        seat: usize,
    },
    RemoveBot {
        seat: usize,
    },
    /// Change the table's settings between hands. The seat count must stay.
    SetSettings {
        settings: Value,
    },
    /// Deal the next hand once every seat is filled.
    Start,
    Act {
        action: Value,
    },
}

/// Bots keep no state between moves, so a seat only records that one sits there.
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Occupant {
    Empty,
    Human { name: String, token: String },
    Bot,
}

struct Conn {
    tx: UnboundedSender<String>,
    seat: Option<usize>,
}

pub struct Room<G: SessionGame> {
    id: String,
    settings: G::Settings,
    seats: Vec<Occupant>,
    conns: HashMap<ConnId, Conn>,
    /// The current hand, or the last one once it is over.
    game: Option<G::State>,
    /// Every action of `game` so far, deals included, so it can be replayed.
    log: Vec<Value>,
    /// The session hand number `game` was dealt as.
    hand_no: u32,
    hands_played: u32,
    scores: Vec<i64>,
    rng: StdRng,
    bot_delay: Duration,
    /// Bumped whenever the hand changes, so a bot's stale move is dropped.
    version: u64,
    thinking: bool,
    /// Weak so the room still ends when every other sender is gone.
    me: Option<WeakUnboundedSender<Command>>,
}

impl<G: SessionGame> Room<G> {
    pub fn new(id: String, settings: G::Settings, bot_delay: Duration) -> Room<G> {
        let n = G::seats(&settings);
        Room {
            id,
            settings,
            seats: (0..n).map(|_| Occupant::Empty).collect(),
            conns: HashMap::new(),
            game: None,
            log: Vec::new(),
            hand_no: 0,
            hands_played: 0,
            scores: vec![0; n],
            rng: StdRng::from_os_rng(),
            bot_delay,
            version: 0,
            thinking: false,
            me: None,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    /// `me` must send to `rx`; bots use it to report their moves. Returns
    /// once nobody has been connected for `idle`.
    ///
    /// With `save`, the room is written there after every change and the
    /// file removed when the room closes.
    pub async fn run(
        mut self,
        me: WeakUnboundedSender<Command>,
        mut rx: UnboundedReceiver<Command>,
        idle: Duration,
        save: Option<PathBuf>,
    ) {
        self.me = Some(me);
        // A restored room may have a bot to act.
        self.think();
        let mut saved = String::new();
        let mut empty_since = Some(tokio::time::Instant::now());
        loop {
            let next = match empty_since {
                Some(since) => tokio::select! {
                    cmd = rx.recv() => cmd,
                    () = tokio::time::sleep_until(since + idle) => None,
                },
                None => rx.recv().await,
            };
            let Some(cmd) = next else { break };
            self.handle(cmd);
            self.think();
            if let Some(path) = &save {
                let snapshot = serde_json::to_string(&self.snapshot()).expect("snapshots serialize");
                if snapshot != saved {
                    if let Err(e) = write_atomic(path, &snapshot) {
                        tracing::error!(room = %self.id, "could not save the room: {e}");
                    }
                    saved = snapshot;
                }
            }
            empty_since = match (self.conns.is_empty(), empty_since) {
                (true, None) => Some(tokio::time::Instant::now()),
                (true, since) => since,
                (false, _) => None,
            };
        }
        if let Some(path) = &save {
            let _ = std::fs::remove_file(path);
        }
    }

    /// Everything needed to rebuild the room after a restart. The hand is
    /// kept as its action log, since a game replays exactly from it.
    pub fn snapshot(&self) -> Value {
        json!({
            "format": SNAPSHOT_FORMAT,
            "id": self.id,
            "game": G::NAME,
            "settings": self.settings,
            "seats": self.seats,
            "scores": self.scores,
            "hands_played": self.hands_played,
            "hand": self.game.as_ref().map(|_| json!({ "number": self.hand_no, "actions": self.log })),
        })
    }

    /// Rebuilds a room from [`Room::snapshot`] by replaying its hand.
    pub fn restore(snapshot: Value, bot_delay: Duration) -> Result<Room<G>, String> {
        #[derive(Deserialize)]
        struct Hand {
            number: u32,
            actions: Vec<Value>,
        }
        #[derive(Deserialize)]
        struct Snapshot<S> {
            format: u32,
            id: String,
            game: String,
            settings: S,
            seats: Vec<Occupant>,
            scores: Vec<i64>,
            hands_played: u32,
            hand: Option<Hand>,
        }
        let s: Snapshot<G::Settings> = serde_json::from_value(snapshot).map_err(|e| e.to_string())?;
        if s.format != SNAPSHOT_FORMAT || s.game != G::NAME {
            return Err(format!("not a {} room in format {SNAPSHOT_FORMAT}", G::NAME));
        }
        let mut room = Room::new(s.id, s.settings, bot_delay);
        if s.seats.len() != room.seats.len() || s.scores.len() != room.seats.len() {
            return Err("seat count does not match the settings".into());
        }
        room.seats = s.seats;
        room.scores = s.scores;
        room.hands_played = s.hands_played;
        if let Some(hand) = s.hand {
            let options = G::hand_options(&room.settings, hand.number);
            let mut game = G::new_game(&options).map_err(|e| e.to_string())?;
            for (i, entry) in hand.actions.iter().enumerate() {
                let action: G::Action =
                    serde_json::from_value(entry.clone()).map_err(|e| format!("action {i}: {e}"))?;
                G::apply(&mut game, action).map_err(|e| format!("action {i}: {e}"))?;
            }
            room.game = Some(game);
            room.log = hand.actions;
            room.hand_no = hand.number;
        }
        Ok(room)
    }

    fn handle(&mut self, cmd: Command) {
        match cmd {
            Command::Connect { conn, tx } => {
                self.conns.insert(conn, Conn { tx, seat: None });
            }
            Command::Disconnect { conn } => {
                self.conns.remove(&conn);
            }
            Command::Message { conn, msg } => {
                if let Err(message) = self.on_message(conn, msg) {
                    self.send(conn, &json!({ "type": "error", "message": message }));
                    return;
                }
            }
            Command::BotMove { version, seat, action } => {
                self.thinking = false;
                if !self.bot_move(version, seat, action) {
                    return;
                }
            }
        }
        self.broadcast();
    }

    fn on_message(&mut self, conn: ConnId, msg: ClientMsg) -> Result<(), String> {
        let my_seat = self.conns.get(&conn).and_then(|c| c.seat);
        match msg {
            ClientMsg::Join { name, token, seat } => self.join(conn, name, token, seat),
            ClientMsg::Leave => {
                let seat = my_seat.ok_or("you are not seated")?;
                self.seats[seat] = if self.in_hand() { Occupant::Bot } else { Occupant::Empty };
                self.detach(seat);
                Ok(())
            }
            ClientMsg::AddBot { seat } => {
                my_seat.ok_or("only seated players can add bots")?;
                let free = match self.seats.get(seat).ok_or("no such seat")? {
                    Occupant::Empty => true,
                    Occupant::Human { .. } => !self.connected(seat),
                    Occupant::Bot => false,
                };
                if !free {
                    return Err("that seat is taken".into());
                }
                self.seats[seat] = Occupant::Bot;
                Ok(())
            }
            ClientMsg::RemoveBot { seat } => {
                my_seat.ok_or("only seated players can remove bots")?;
                if self.in_hand() {
                    return Err("bots stay until the hand is over".into());
                }
                match self.seats.get(seat) {
                    Some(Occupant::Bot) => {
                        self.seats[seat] = Occupant::Empty;
                        Ok(())
                    }
                    _ => Err("no bot in that seat".into()),
                }
            }
            ClientMsg::SetSettings { settings } => {
                my_seat.ok_or("only seated players can change the rules")?;
                if self.in_hand() {
                    return Err("rules can change only between hands".into());
                }
                let settings: G::Settings = serde_json::from_value(settings).map_err(|e| format!("bad settings: {e}"))?;
                G::validate(&settings)?;
                if G::seats(&settings) != self.seats.len() {
                    return Err("the number of players cannot change".into());
                }
                tracing::info!(room = %self.id, settings = %log_action(&settings), "settings");
                self.settings = settings;
                Ok(())
            }
            ClientMsg::Start => {
                my_seat.ok_or("only seated players can start")?;
                if self.in_hand() {
                    return Err("a hand is already in progress".into());
                }
                if self.seats.iter().any(|s| matches!(s, Occupant::Empty)) {
                    return Err("every seat needs a player or a bot".into());
                }
                let options = G::hand_options(&self.settings, self.hands_played);
                let state = G::new_game(&options).map_err(|e| e.to_string())?;
                self.game = Some(state);
                self.log.clear();
                self.hand_no = self.hands_played;
                self.advance();
                Ok(())
            }
            ClientMsg::Act { action } => {
                let seat = my_seat.ok_or("you are not seated")?;
                let game = self.game.as_mut().ok_or("no hand in progress")?;
                if G::turn(game) != Turn::Seat(seat) {
                    return Err("it is not your turn".into());
                }
                let action: G::Action = serde_json::from_value(action).map_err(|e| format!("bad action: {e}"))?;
                let logged = log_action(&action);
                let entry = serde_json::to_value(&action).map_err(|e| e.to_string())?;
                G::apply(game, action).map_err(|e| e.to_string())?;
                self.log.push(entry);
                tracing::info!(room = %self.id, seat, action = %logged, "move");
                self.advance();
                Ok(())
            }
        }
    }

    fn join(&mut self, conn: ConnId, name: String, token: Option<String>, seat: Option<usize>) -> Result<(), String> {
        let name = name.trim().chars().take(24).collect::<String>();
        if name.is_empty() {
            return Err("pick a name".into());
        }
        if self.conns.get(&conn).is_some_and(|c| c.seat.is_some()) {
            return Err("you are already seated".into());
        }
        let reclaimed = token.as_ref().and_then(|t| {
            self.seats
                .iter()
                .position(|s| matches!(s, Occupant::Human { token, .. } if token == t))
        });
        let seat = match reclaimed {
            Some(seat) => seat,
            None => seat
                .filter(|&s| matches!(self.seats.get(s), Some(Occupant::Empty)))
                .or_else(|| self.seats.iter().position(|s| matches!(s, Occupant::Empty)))
                .ok_or("the table is full")?,
        };
        // A newer connection for the same seat wins; the old tab becomes a spectator.
        self.detach(seat);
        let token = match (&self.seats[seat], reclaimed) {
            (Occupant::Human { token, .. }, Some(_)) => token.clone(),
            _ => format!("{:032x}", self.rng.random::<u128>()),
        };
        self.seats[seat] = Occupant::Human {
            name,
            token: token.clone(),
        };
        if let Some(c) = self.conns.get_mut(&conn) {
            c.seat = Some(seat);
        }
        self.send(conn, &json!({ "type": "welcome", "seat": seat, "token": token }));
        Ok(())
    }

    fn detach(&mut self, seat: usize) {
        for c in self.conns.values_mut().filter(|c| c.seat == Some(seat)) {
            c.seat = None;
        }
    }

    fn connected(&self, seat: usize) -> bool {
        self.conns.values().any(|c| c.seat == Some(seat))
    }

    fn in_hand(&self) -> bool {
        self.game.as_ref().is_some_and(|g| G::turn(g) != Turn::Over)
    }

    fn bot_to_act(&self) -> Option<usize> {
        match self.game.as_ref().map(G::turn) {
            Some(Turn::Seat(s)) if matches!(self.seats[s], Occupant::Bot) => Some(s),
            _ => None,
        }
    }

    /// Starts a bot thinking if one is to act. Its move arrives as
    /// [`Command::BotMove`] no sooner than the bot delay.
    fn think(&mut self) {
        if self.thinking {
            return;
        }
        let me = self.me.as_ref().and_then(WeakUnboundedSender::upgrade);
        let (Some(seat), Some(game), Some(tx)) = (self.bot_to_act(), self.game.as_ref(), me) else {
            return;
        };
        let view = G::view(game, Viewer::Seat(seat));
        let legal = G::legal_actions(game);
        let (seed, version, delay) = (self.rng.random::<u64>(), self.version, self.bot_delay);
        self.thinking = true;
        tokio::spawn(async move {
            let started = Instant::now();
            let choice =
                tokio::task::spawn_blocking(move || G::bot().act(&view, &legal, &mut StdRng::seed_from_u64(seed)))
                    .await;
            // Thinking time counts toward the delay that lets people follow along.
            tokio::time::sleep(delay.saturating_sub(started.elapsed())).await;
            let action: Box<dyn Any + Send> = match choice {
                Ok(action) => Box::new(action),
                Err(e) => {
                    tracing::error!("bot failed: {e}");
                    Box::new(())
                }
            };
            let _ = tx.send(Command::BotMove { version, seat, action });
        });
    }

    /// Applies a bot's move if the hand has not moved on. Returns whether it did.
    fn bot_move(&mut self, version: u64, seat: usize, action: Box<dyn Any + Send>) -> bool {
        if version != self.version || self.bot_to_act() != Some(seat) {
            return false;
        }
        let Ok(action) = action.downcast::<G::Action>() else {
            return false;
        };
        let Some(game) = self.game.as_mut() else { return false };
        let logged = log_action(&*action);
        let Ok(entry) = serde_json::to_value(&*action) else { return false };
        if let Err(e) = G::apply(game, *action) {
            tracing::error!(room = %self.id, seat, action = %logged, "bot chose an illegal action: {e}");
            return false;
        }
        self.log.push(entry);
        tracing::info!(room = %self.id, seat, action = %logged, "bot move");
        self.advance();
        true
    }

    /// Plays chance actions and books the score when the hand ends.
    fn advance(&mut self) {
        self.version += 1;
        let Some(game) = self.game.as_mut() else { return };
        while G::turn(game) == Turn::Chance {
            let deal = G::sample_chance(game, &mut self.rng);
            tracing::info!(room = %self.id, action = %log_action(&deal), "deal");
            self.log.push(serde_json::to_value(&deal).expect("actions serialize"));
            G::apply(game, deal).expect("a sampled chance action is legal");
        }
        if G::turn(game) == Turn::Over
            && let Some(payoffs) = G::payoffs(game)
        {
            for (score, payoff) in self.scores.iter_mut().zip(payoffs) {
                *score += payoff;
            }
            self.hands_played += 1;
        }
    }

    fn room_message(&self) -> Value {
        let seats: Vec<Value> = self
            .seats
            .iter()
            .enumerate()
            .map(|(i, s)| match s {
                Occupant::Empty => json!({ "kind": "empty" }),
                Occupant::Human { name, .. } => {
                    json!({ "kind": "human", "name": name, "connected": self.connected(i) })
                }
                Occupant::Bot => json!({ "kind": "bot", "name": format!("Bot {}", i + 1) }),
            })
            .collect();
        json!({
            "type": "room",
            "id": self.id,
            "game": G::NAME,
            "settings": self.settings,
            "seats": seats,
            "scores": self.scores,
            "hands_played": self.hands_played,
            "in_hand": self.in_hand(),
        })
    }

    fn broadcast(&self) {
        let room = self.room_message().to_string();
        for (&id, conn) in &self.conns {
            let _ = conn.tx.send(room.clone());
            if let Some(state) = self.state_message(conn.seat) {
                self.send(id, &state);
            }
        }
    }

    /// The hand as `seat` may see it, with its legal actions on its turn.
    fn state_message(&self, seat: Option<usize>) -> Option<Value> {
        let game = self.game.as_ref()?;
        let viewer = seat.map_or(Viewer::Spectator, Viewer::Seat);
        let turn = G::turn(game);
        let legal = match seat {
            Some(s) if turn == Turn::Seat(s) => G::legal_actions(game),
            _ => Vec::new(),
        };
        Some(json!({ "type": "state", "view": G::view(game, viewer), "legal": legal, "turn": turn }))
    }

    fn send(&self, conn: ConnId, message: &Value) {
        if let Some(c) = self.conns.get(&conn) {
            let _ = c.tx.send(message.to_string());
        }
    }
}
