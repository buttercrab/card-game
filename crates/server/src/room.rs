//! One table. A room runs as its own task and handles one command at a time,
//! so its state needs no locks. Bots think on a blocking thread and send
//! their move back as a command.

use crate::bots::RemoteBots;
use crate::session::{BotLevel, SessionGame};
use crate::stats::{Event, Hand, Stats};
use engine::{Turn, Viewer};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::any::Any;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, WeakUnboundedSender};

pub type ConnId = u64;

/// How long a room waits past a move's thinking time for a bot worker's
/// answer before thinking itself.
const REMOTE_GRACE: Duration = Duration::from_secs(2);

/// A bot's move time against the server's bot delay. Stronger bots take
/// longer, as people do, and the 고수 bot spends it thinking.
fn pace(level: BotLevel) -> f32 {
    match level {
        BotLevel::Easy => 0.75,
        BotLevel::Normal => 1.0,
        BotLevel::Hard => 1.6,
    }
}

/// How long a hint may think: the player is waiting for it.
const HINT_THINK: Duration = Duration::from_millis(800);

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
    /// What a problem report should carry about this room.
    Report {
        reply: tokio::sync::oneshot::Sender<Value>,
    },
    /// The preset and empty seats, for a share link's preview.
    Describe {
        reply: tokio::sync::oneshot::Sender<Value>,
    },
    /// A bot's chosen action (a boxed `G::Action`), for game `version`.
    BotMove {
        version: u64,
        seat: usize,
        action: Box<dyn Any + Send>,
    },
    /// The server is stopping: save the room, keep its file, and end. `done`
    /// answers once the snapshot is written.
    Shutdown {
        done: tokio::sync::oneshot::Sender<()>,
    },
    /// A bot's out-of-turn action (a boxed `G::Action`), decided when deal
    /// number `deal` landed.
    BotOutOfTurn {
        deal: u64,
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
        /// An id the browser keeps across tables, if it sends one; only its
        /// salted hash is kept, to count returning players.
        #[serde(default)]
        device: Option<String>,
    },
    /// Give up your seat; a bot takes over if a hand is in progress.
    Leave,
    /// Seat a bot in an empty seat, or in place of a disconnected player.
    /// On a bot's seat, changes how well it plays.
    AddBot {
        seat: usize,
        #[serde(default)]
        level: BotLevel,
    },
    RemoveBot {
        seat: usize,
    },
    /// Change the table's settings between hands. The seat count must stay.
    SetSettings {
        settings: Value,
    },
    /// Ask what the bot would do in your place, on your turn.
    Hint,
    /// Show a quick reaction from your seat to the whole table.
    React {
        text: String,
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
    Human {
        name: String,
        token: String,
        /// The player's id in the stats: a salted hash, never the raw id.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        player: Option<String>,
    },
    Bot {
        #[serde(default)]
        level: BotLevel,
    },
}

struct Conn {
    tx: UnboundedSender<String>,
    seat: Option<usize>,
    /// When this connection last reacted, to keep reactions from flooding.
    reacted: Option<Instant>,
    /// When this connection last asked for a hint; a bot's think is not free.
    hinted: Option<Instant>,
}

/// The reactions a player can send; anything else is refused.
pub const REACTIONS: [&str; 12] = [
    "👏",
    "😂",
    "😮",
    "😭",
    "🔥",
    "🙏",
    "나이스",
    "아…",
    "ㅋㅋㅋ",
    "빨리요~",
    "미안",
    "굿",
];

pub struct Room<G: SessionGame> {
    id: String,
    settings: G::Settings,
    seats: Vec<Occupant>,
    conns: HashMap<ConnId, Conn>,
    /// The current hand, or the last one once it is over.
    game: Option<G::State>,
    /// Every action of `game` so far, deals included, so it can be replayed.
    /// An out-of-turn action is logged as `{"out_of_turn": {seat, action}}`.
    log: Vec<Value>,
    /// The session hand number `game` was dealt as.
    hand_no: u32,
    hands_played: u32,
    scores: Vec<i64>,
    /// Each finished hand's payoffs, in order, for the session summary.
    history: Vec<Vec<i64>>,
    /// Each finished hand in brief, in order. Rooms saved before these were
    /// kept have fewer of them than `history`.
    hands: Vec<G::Summary>,
    rng: StdRng,
    /// A 보통 bot's move time; see [`pace`].
    bot_delay: Duration,
    /// The most a 고수 bot may think on this server, if limited.
    think_cap: Option<Duration>,
    /// Another machine that thinks for bots, when one is connected.
    remote: Option<Arc<RemoteBots>>,
    /// Bumped whenever the hand changes, so a bot's stale move is dropped.
    version: u64,
    thinking: bool,
    /// Weak so the room still ends when every other sender is gone.
    me: Option<WeakUnboundedSender<Command>>,
    stats: Option<Arc<Stats>>,
    /// When the current hand was dealt, in Unix seconds, if known.
    hand_started: Option<u64>,
    /// When the cards last landed, for [`SessionGame::grace`]; unknown
    /// after a restart, when any grace is long over.
    dealt_at: Option<Instant>,
    /// Deals so far, so a bot's out-of-turn action for an earlier deal is
    /// dropped.
    deals: u64,
}

impl<G: SessionGame> Room<G> {
    /// The hand before hand number `hand`, in brief, when every hand so far
    /// was kept (rooms saved before summaries were kept have fewer).
    fn last_hand(&self, hand: u32) -> Option<&G::Summary> {
        (self.hands.len() == hand as usize).then(|| self.hands.last()).flatten()
    }

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
            history: Vec::new(),
            hands: Vec::new(),
            rng: StdRng::from_os_rng(),
            bot_delay,
            think_cap: None,
            remote: None,
            version: 0,
            thinking: false,
            me: None,
            stats: None,
            hand_started: None,
            dealt_at: None,
            deals: 0,
        }
    }

    /// Notes what happens here in the stats log; see [`crate::stats`].
    pub fn use_stats(&mut self, stats: Arc<Stats>) {
        self.stats = Some(stats);
    }

    fn record(&self, event: Event) {
        if let Some(stats) = &self.stats {
            stats.record(event);
        }
    }

    /// The current hand's table and seats, for the stats.
    fn hand_stats(&self) -> Hand {
        Hand {
            table: self.id.clone(),
            preset: G::preset_id(&self.settings).to_string(),
            custom: G::customized(&self.settings),
            humans: self
                .seats
                .iter()
                .filter(|s| matches!(s, Occupant::Human { .. }))
                .count(),
            bots: self.seats.iter().filter(|s| matches!(s, Occupant::Bot { .. })).count(),
        }
    }

    fn hand_secs(&self) -> Option<u64> {
        self.hand_started.map(|t| crate::stats::now().saturating_sub(t))
    }

    /// Caps how long a 고수 bot thinks here, for small servers. A bot worker
    /// is not held to it.
    pub fn limit_think(&mut self, think: Duration) {
        self.think_cap = Some(think);
    }

    /// Lets bots think on a connected worker; see [`crate::bots`].
    pub fn use_remote(&mut self, remote: Arc<RemoteBots>) {
        self.remote = Some(remote);
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
            if let Command::Shutdown { done } = cmd {
                self.save_for_restart(save.as_deref());
                let _ = done.send(());
                return;
            }
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
        if self.in_hand() {
            self.record(Event::HandAbandoned {
                hand: self.hand_stats(),
                secs: self.hand_secs(),
            });
        }
        if let Some(path) = &save {
            let _ = std::fs::remove_file(path);
        }
    }

    /// Writes the room for the next server to restore; see [`Command::Shutdown`].
    fn save_for_restart(&self, save: Option<&Path>) {
        let Some(path) = save else { return };
        let snapshot = serde_json::to_string(&self.snapshot()).expect("snapshots serialize");
        if let Err(e) = write_atomic(path, &snapshot) {
            tracing::error!(room = %self.id, "could not save the room for a restart: {e}");
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
            "history": self.history,
            "hands": self.hands,
            "hand": self.game.as_ref().map(|_| json!({
                "number": self.hand_no, "actions": self.log, "started": self.hand_started,
            })),
        })
    }

    /// The room for a problem report: like [`Room::snapshot`], but seats show
    /// only names, never the tokens that reclaim them.
    fn report(&self) -> Value {
        let mut report = self.snapshot();
        report["seats"] = self
            .seats
            .iter()
            .map(|s| match s {
                Occupant::Empty => json!("empty"),
                Occupant::Human { name, .. } => json!({ "human": name }),
                Occupant::Bot { level } => json!({ "bot": level }),
            })
            .collect();
        report
    }

    /// Rebuilds a room from [`Room::snapshot`] by replaying its hand.
    pub fn restore(snapshot: Value, bot_delay: Duration) -> Result<Room<G>, String> {
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
            #[serde(default)]
            history: Vec<Vec<i64>>,
            #[serde(default = "Vec::new")]
            hands: Vec<T>,
            hand: Option<SavedHand>,
        }
        let s: Snapshot<G::Settings, G::Summary> = serde_json::from_value(snapshot).map_err(|e| e.to_string())?;
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
        room.history = s.history;
        room.hands = s.hands;
        if let Some(hand) = s.hand {
            let options = G::hand_options(&room.settings, hand.number, room.last_hand(hand.number));
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
            room.game = Some(game);
            room.log = hand.actions;
            room.hand_no = hand.number;
            room.hand_started = hand.started;
        }
        Ok(room)
    }

    fn handle(&mut self, cmd: Command) {
        match cmd {
            Command::Connect { conn, tx } => {
                self.conns.insert(
                    conn,
                    Conn {
                        tx,
                        seat: None,
                        reacted: None,
                        hinted: None,
                    },
                );
            }
            Command::Disconnect { conn } => {
                self.conns.remove(&conn);
            }
            Command::Message { conn, msg } => {
                // A reaction changes nothing the room or the hand shows.
                let quiet = matches!(msg, ClientMsg::React { .. } | ClientMsg::Hint);
                if let Err(message) = self.on_message(conn, msg) {
                    self.send(conn, &json!({ "type": "error", "message": message }));
                    return;
                }
                if quiet {
                    return;
                }
            }
            Command::Report { reply } => {
                let _ = reply.send(self.report());
                return;
            }
            Command::Describe { reply } => {
                let empty = self.seats.iter().filter(|s| matches!(s, Occupant::Empty)).count();
                let _ = reply.send(json!({
                    "preset": G::preset_id(&self.settings),
                    "custom": G::customized(&self.settings),
                    "empty": empty,
                }));
                return;
            }
            Command::BotMove { version, seat, action } => {
                self.thinking = false;
                if !self.bot_move(version, seat, action) {
                    return;
                }
            }
            // Handled by `run`, which ends the room.
            Command::Shutdown { .. } => return,
            Command::BotOutOfTurn { deal, seat, action } => {
                if !self.bot_out_of_turn(deal, seat, action) {
                    return;
                }
            }
        }
        self.broadcast();
    }

    fn on_message(&mut self, conn: ConnId, msg: ClientMsg) -> Result<(), String> {
        let my_seat = self.conns.get(&conn).and_then(|c| c.seat);
        match msg {
            ClientMsg::Join {
                name,
                token,
                seat,
                device,
            } => self.join(conn, name, token, seat, device),
            ClientMsg::Leave => {
                let seat = my_seat.ok_or("you are not seated")?;
                self.seats[seat] = if self.in_hand() {
                    Occupant::Bot {
                        level: BotLevel::default(),
                    }
                } else {
                    Occupant::Empty
                };
                self.detach(seat);
                Ok(())
            }
            ClientMsg::AddBot { seat, level } => {
                my_seat.ok_or("only seated players can add bots")?;
                let free = match self.seats.get(seat).ok_or("no such seat")? {
                    Occupant::Empty | Occupant::Bot { .. } => true,
                    Occupant::Human { .. } => !self.connected(seat),
                };
                if !free {
                    return Err("that seat is taken".into());
                }
                if !matches!(self.seats[seat], Occupant::Bot { .. }) {
                    self.record(Event::SeatFilled {
                        table: self.id.clone(),
                        seat,
                        bot: Some(level),
                        player: None,
                    });
                }
                self.seats[seat] = Occupant::Bot { level };
                Ok(())
            }
            ClientMsg::RemoveBot { seat } => {
                my_seat.ok_or("only seated players can remove bots")?;
                if self.in_hand() {
                    return Err("bots stay until the hand is over".into());
                }
                match self.seats.get(seat) {
                    Some(Occupant::Bot { .. }) => {
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
                let mut settings: G::Settings =
                    serde_json::from_value(settings).map_err(|e| format!("bad settings: {e}"))?;
                G::freeze(&mut settings);
                G::validate(&settings)?;
                if G::seats(&settings) != self.seats.len() {
                    return Err("the number of players cannot change".into());
                }
                tracing::info!(room = %self.id, settings = %log_action(&settings), "settings");
                self.settings = settings;
                Ok(())
            }
            ClientMsg::Hint => {
                let seat = my_seat.ok_or("you are not seated")?;
                let game = self.game.as_ref().ok_or("no hand in progress")?;
                if G::turn(game) != Turn::Seat(seat) {
                    return Err("it is not your turn".into());
                }
                let c = self.conns.get_mut(&conn).ok_or("not connected")?;
                if c.hinted.is_some_and(|t| t.elapsed() < Duration::from_secs(1)) {
                    return Ok(());
                }
                // Searches are capped across the server; see `limit::HINTS`.
                let permit = crate::limit::hint_permit().ok_or("hints are busy")?;
                c.hinted = Some(Instant::now());
                let tx = c.tx.clone();
                let view = G::view(game, Viewer::Seat(seat));
                let legal = G::legal_actions(game);
                let (seed, version) = (self.rng.random::<u64>(), self.version);
                tokio::task::spawn_blocking(move || {
                    let _permit = permit;
                    let action = G::bot(BotLevel::Hard, seat, HINT_THINK, 1).act(
                        &view,
                        &legal,
                        &mut StdRng::seed_from_u64(seed),
                    );
                    let msg = json!({ "type": "hint", "version": version, "action": action });
                    let _ = tx.send(msg.to_string());
                });
                Ok(())
            }
            ClientMsg::React { text } => {
                let seat = my_seat.ok_or("you are not seated")?;
                if !REACTIONS.contains(&text.as_str()) {
                    return Err("unknown reaction".into());
                }
                let c = self.conns.get_mut(&conn).ok_or("not connected")?;
                // Too fast: drop it quietly rather than nag.
                if c.reacted.is_some_and(|t| t.elapsed() < Duration::from_millis(700)) {
                    return Ok(());
                }
                c.reacted = Some(Instant::now());
                let msg = json!({ "type": "reaction", "seat": seat, "text": text }).to_string();
                for c in self.conns.values() {
                    let _ = c.tx.send(msg.clone());
                }
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
                let options = G::hand_options(&self.settings, self.hands_played, self.last_hand(self.hands_played));
                let state = G::new_game(&options).map_err(|e| e.to_string())?;
                self.game = Some(state);
                self.log.clear();
                self.hand_no = self.hands_played;
                self.hand_started = Some(crate::stats::now());
                let players = self
                    .seats
                    .iter()
                    .filter_map(|s| match s {
                        Occupant::Human { player, .. } => player.clone(),
                        _ => None,
                    })
                    .collect();
                self.record(Event::HandStarted {
                    hand: self.hand_stats(),
                    players,
                });
                self.advance();
                Ok(())
            }
            ClientMsg::Act { action } => {
                let seat = my_seat.ok_or("you are not seated")?;
                let game = self.game.as_mut().ok_or("no hand in progress")?;
                let action: G::Action = serde_json::from_value(action).map_err(|e| format!("bad action: {e}"))?;
                if G::turn(game) != Turn::Seat(seat) {
                    if !G::out_of_turn_actions(game, seat).contains(&action) {
                        return Err("it is not your turn".into());
                    }
                    return self.out_of_turn(seat, action);
                }
                if self.dealt_at.is_some_and(|t| t.elapsed() < G::grace(game, &action)) {
                    return Err("wait a moment after the deal".into());
                }
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

    /// Applies `seat`'s out-of-turn action, already known to be allowed.
    fn out_of_turn(&mut self, seat: usize, action: G::Action) -> Result<(), String> {
        let game = self.game.as_mut().ok_or("no hand in progress")?;
        let logged = log_action(&action);
        let entry = json!({ "out_of_turn": { "seat": seat, "action": action } });
        G::apply_out_of_turn(game, seat, action).map_err(|e| e.to_string())?;
        self.log.push(entry);
        tracing::info!(room = %self.id, seat, action = %logged, "out-of-turn move");
        self.advance();
        Ok(())
    }

    fn join(
        &mut self,
        conn: ConnId,
        name: String,
        token: Option<String>,
        seat: Option<usize>,
        device: Option<String>,
    ) -> Result<(), String> {
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
        let (token, player) = match (&self.seats[seat], reclaimed) {
            (Occupant::Human { token, player, .. }, Some(_)) => (token.clone(), player.clone()),
            _ => (format!("{:032x}", self.rng.random::<u128>()), None),
        };
        // The browser's own id if it sends one, else the seat's token, which
        // the browser keeps for this table.
        let device = device.filter(|d| !d.is_empty() && d.len() <= 128);
        let player = match (&self.stats, device) {
            (Some(stats), Some(device)) => Some(stats.player(&device)),
            (Some(stats), None) => player.or_else(|| Some(stats.player(&token))),
            (None, _) => player,
        };
        if reclaimed.is_none() {
            self.record(Event::SeatFilled {
                table: self.id.clone(),
                seat,
                bot: None,
                player: player.clone(),
            });
        }
        self.seats[seat] = Occupant::Human {
            name,
            token: token.clone(),
            player,
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
            Some(Turn::Seat(s)) if matches!(self.seats[s], Occupant::Bot { .. }) => Some(s),
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
        let Occupant::Bot { level } = self.seats[seat] else {
            return;
        };
        let view = G::view(game, Viewer::Seat(seat));
        let legal = G::legal_actions(game);
        let (seed, version) = (self.rng.random::<u64>(), self.version);
        // People take a moment, and longer when there is a real choice: a
        // forced move comes quicker, and every move varies a little.
        let forced = if legal.len() == 1 { 0.5 } else { 1.0 };
        let jitter = self.rng.random_range(0.8..1.2);
        let delay = self.bot_delay.mul_f32(pace(level) * forced * jitter);
        // A move that must wait after the deal waits a little past it.
        let grace = legal.iter().map(|a| G::grace(game, a)).max().unwrap_or_default();
        let waited = self.dealt_at.map_or(grace, |t| t.elapsed());
        let delay = match grace.checked_sub(waited) {
            Some(left) if !left.is_zero() => delay.max(left + Duration::from_millis(300)),
            _ => delay,
        };
        // Bots wait out the delay anyway so people can follow along; spend
        // most of it thinking, leaving a little for the move to travel.
        let think = delay.mul_f32(0.8);
        let local_think = self.think_cap.map_or(think, |cap| think.min(cap));
        let remote = self.remote.clone().filter(|r| r.available());
        let job = remote.as_ref().map(|_| {
            json!({
                "level": level, "seat": seat, "seed": seed, "think_ms": think.as_millis() as u64,
                "view": view, "legal": legal,
            })
        });
        self.thinking = true;
        tokio::spawn(async move {
            let started = Instant::now();
            // A worker gets the move's thinking time and a grace period; past
            // that, or with no worker, the room thinks for itself.
            let mut remote_choice = None;
            if let (Some(remote), Some(job)) = (remote, job)
                && let Some(answer) = remote.ask(job, think + REMOTE_GRACE).await
            {
                remote_choice = serde_json::from_value::<G::Action>(answer)
                    .ok()
                    .filter(|a| legal.contains(a));
            }
            let choice = match remote_choice {
                Some(action) => Ok(action),
                None => {
                    tokio::task::spawn_blocking(move || {
                        G::bot(level, seat, local_think, 1).act(&view, &legal, &mut StdRng::seed_from_u64(seed))
                    })
                    .await
                }
            };
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
        let Ok(entry) = serde_json::to_value(&*action) else {
            return false;
        };
        if let Err(e) = G::apply(game, *action) {
            tracing::error!(room = %self.id, seat, action = %logged, "bot chose an illegal action: {e}");
            return false;
        }
        self.log.push(entry);
        tracing::info!(room = %self.id, seat, action = %logged, "bot move");
        self.advance();
        true
    }

    /// Applies a bot's out-of-turn action if it is still allowed. Returns
    /// whether it did.
    fn bot_out_of_turn(&mut self, deal: u64, seat: usize, action: Box<dyn Any + Send>) -> bool {
        let Ok(action) = action.downcast::<G::Action>() else {
            return false;
        };
        let allowed = self
            .game
            .as_ref()
            .is_some_and(|g| G::out_of_turn_actions(g, seat).contains(&*action));
        if deal != self.deals || !matches!(self.seats[seat], Occupant::Bot { .. }) || !allowed {
            return false;
        }
        self.out_of_turn(seat, *action).is_ok()
    }

    /// Right after a deal, each bot decides once whether to act out of
    /// turn (a 딜미스), and does so after a short pause, as a person would.
    fn plan_out_of_turn(&mut self) {
        let Some(tx) = self.me.as_ref().and_then(WeakUnboundedSender::upgrade) else {
            return;
        };
        let Some(game) = self.game.as_ref() else { return };
        for seat in 0..self.seats.len() {
            let Occupant::Bot { level } = self.seats[seat] else {
                continue;
            };
            let Some(action) = G::bot_out_of_turn(level, seat, game, &mut self.rng) else {
                continue;
            };
            let pause = self.bot_delay.mul_f32(self.rng.random_range(1.0..1.5));
            let (tx, deal) = (tx.clone(), self.deals);
            tokio::spawn(async move {
                tokio::time::sleep(pause).await;
                let action: Box<dyn Any + Send> = Box::new(action);
                let _ = tx.send(Command::BotOutOfTurn { deal, seat, action });
            });
        }
    }

    /// Plays chance actions and books the score when the hand ends.
    fn advance(&mut self) {
        self.version += 1;
        let Some(game) = self.game.as_mut() else { return };
        let mut dealt = false;
        while G::turn(game) == Turn::Chance {
            let deal = G::sample_chance(game, &mut self.rng);
            tracing::info!(room = %self.id, action = %log_action(&deal), "deal");
            self.log.push(serde_json::to_value(&deal).expect("actions serialize"));
            G::apply(game, deal).expect("a sampled chance action is legal");
            dealt = true;
        }
        if dealt {
            self.deals += 1;
            self.dealt_at = Some(Instant::now());
            self.plan_out_of_turn();
        }
        let Some(game) = self.game.as_mut() else { return };
        if G::turn(game) == Turn::Over
            && let Some(payoffs) = G::payoffs(game)
        {
            for (score, payoff) in self.scores.iter_mut().zip(&payoffs) {
                *score += payoff;
            }
            self.history.push(payoffs);
            self.hands.extend(G::summary(game));
            self.hands_played += 1;
            let outcome = G::outcome(game).to_string();
            self.record(Event::HandFinished {
                hand: self.hand_stats(),
                outcome,
                secs: self.hand_secs(),
            });
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
                Occupant::Bot { level } => json!({ "kind": "bot", "name": format!("Bot {}", i + 1), "level": level }),
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
            "history": self.history,
            "hands": self.hands,
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

    /// The hand as `seat` may see it, with its legal actions on its turn
    /// and what it may do out of turn otherwise. `grace_ms` is how long
    /// the slowest of its legal actions must still wait after the deal.
    fn state_message(&self, seat: Option<usize>) -> Option<Value> {
        let game = self.game.as_ref()?;
        let viewer = seat.map_or(Viewer::Spectator, Viewer::Seat);
        let turn = G::turn(game);
        let (legal, out_of_turn) = match seat {
            Some(s) if turn == Turn::Seat(s) => (G::legal_actions(game), Vec::new()),
            Some(s) => (Vec::new(), G::out_of_turn_actions(game, s)),
            None => (Vec::new(), Vec::new()),
        };
        let grace = legal.iter().map(|a| G::grace(game, a)).max().unwrap_or_default();
        let waited = self.dealt_at.map_or(grace, |t| t.elapsed());
        let grace_ms = grace.saturating_sub(waited).as_millis() as u64;
        Some(json!({
            "type": "state", "view": G::view(game, viewer), "legal": legal, "turn": turn,
            "out_of_turn": out_of_turn, "grace_ms": grace_ms,
        }))
    }

    fn send(&self, conn: ConnId, message: &Value) {
        if let Some(c) = self.conns.get(&conn) {
            let _ = c.tx.send(message.to_string());
        }
    }
}
