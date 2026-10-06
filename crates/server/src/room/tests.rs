//! The room on its own, driven through its channels on a paused clock: the
//! turn timer, away marks, the grace after a deal, closing when idle, and
//! bots that fail to think. Time only moves when every task waits, so a
//! 20-second turn runs out at once and exactly.

use super::bots::Internal;
use super::*;
use crate::protocol::ClientMsg;
use crate::session::MightySettings;
use mighty::Mighty;
use mighty::rules::Preset;
use serde_json::{Value, json};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio::task::JoinHandle;

/// Longer than anything a test waits for, on the paused clock.
const PATIENCE: Duration = Duration::from_secs(3600);

/// A room running as its own task.
struct Table {
    tx: UnboundedSender<Command>,
    task: JoinHandle<()>,
    next: ConnId,
    stats: Arc<Stats>,
}

/// One connection to it.
struct Client {
    conn: ConnId,
    rx: UnboundedReceiver<String>,
    tx: UnboundedSender<Command>,
    /// The latest session message it was sent.
    session: Value,
}

impl Table {
    fn open(settings: MightySettings) -> Table {
        Table::open_with(settings, RoomEnv::new(Duration::ZERO))
    }

    fn open_with(settings: MightySettings, env: RoomEnv) -> Table {
        let stats = env.stats.clone();
        let room = Room::<Mighty>::new("t".into(), settings, Arc::new(env));
        let (tx, rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(room.run(rx));
        Table {
            tx,
            task,
            next: 0,
            stats,
        }
    }

    fn connect(&mut self) -> Client {
        let (tx, rx) = mpsc::unbounded_channel();
        self.next += 1;
        let conn = self.next;
        self.tx.send(Command::Connect { conn, tx }).unwrap();
        Client {
            conn,
            rx,
            tx: self.tx.clone(),
            session: Value::Null,
        }
    }

    fn turns_timed_out(&self) -> u32 {
        self.stats.summary(crate::stats::now()).totals.turns_timed_out
    }
}

impl Client {
    fn send(&self, msg: Value) {
        let msg: ClientMsg = serde_json::from_value(msg).unwrap();
        let conn = self.conn;
        self.tx.send(Command::Message { conn, msg }).unwrap();
    }

    /// The next message of type `kind` that satisfies `pred`. Kind
    /// `table` is a room message with the latest session's fields added, as
    /// the web client keeps it.
    async fn next_where(&mut self, kind: &str, pred: impl Fn(&Value) -> bool) -> Value {
        let wait = async {
            loop {
                let text = self.rx.recv().await.expect("the room hung up");
                let mut msg: Value = serde_json::from_str(&text).unwrap();
                if msg["type"] == "session" {
                    self.session = msg.clone();
                }
                if kind == "table" && msg["type"] == "room" {
                    for field in ["scores", "hands_played", "history", "hands"] {
                        msg[field] = self.session[field].clone();
                    }
                    msg["type"] = json!("table");
                }
                if msg["type"] == kind && pred(&msg) {
                    return msg;
                }
            }
        };
        tokio::time::timeout(PATIENCE, wait)
            .await
            .unwrap_or_else(|_| panic!("no {kind} came"))
    }

    async fn next(&mut self, kind: &str) -> Value {
        self.next_where(kind, |_| true).await
    }

    /// Sits down; returns the seat and its token.
    async fn join(&mut self, name: &str) -> (usize, String) {
        self.send(json!({ "type": "join", "name": name }));
        let welcome = self.next("welcome").await;
        let seat = welcome["seat"].as_u64().unwrap() as usize;
        (seat, welcome["token"].as_str().unwrap().to_string())
    }

    fn leave_table(self) {
        let _ = self.tx.send(Command::Disconnect { conn: self.conn });
    }
}

/// A table with `name` at seat 0 and 초보 bots in the other seats.
async fn with_bots(table: &mut Table, name: &str) -> Client {
    let mut a = table.connect();
    a.join(name).await;
    for seat in 1..5 {
        a.send(json!({ "type": "add_bot", "seat": seat, "level": "easy" }));
    }
    a.next_where("room", |r| r["seats"][4]["kind"] == "bot").await;
    a
}

#[tokio::test(start_paused = true)]
async fn a_turn_that_runs_out_is_played_for_the_seat_and_marks_it_away() {
    let mut table = Table::open(MightySettings::new(Preset::Gshs));
    let mut a = with_bots(&mut table, "Jae").await;
    // Only a listed limit is taken.
    a.send(json!({ "type": "set_table", "turn_secs": 25 }));
    assert_eq!(a.next("error").await["code"], "no_such_turn_limit");
    a.send(json!({ "type": "set_table", "turn_secs": 20 }));
    let msg = a.next_where("room", |r| r["table"]["turn_secs"] == 20).await;
    assert!(msg["clock"].is_null(), "no hand, no clock");

    a.send(json!({ "type": "start" }));
    // Jae never acts: the clock runs on the server and a stand-in moves.
    let clocked = a.next_where("room", |r| r["clock"]["seat"] == 0).await;
    assert_eq!(clocked["clock"]["total_ms"], 20_000);
    let started = tokio::time::Instant::now();
    let away = a.next_where("room", |r| r["seats"][0]["away"] == true).await;
    assert_eq!(
        started.elapsed(),
        Duration::from_secs(20),
        "the turn ran its whole time"
    );
    assert_eq!(table.turns_timed_out(), 1);
    assert_eq!(away["seats"][0]["connected"], true);
    // Away, the next turns get five seconds.
    let short = a
        .next_where("room", |r| r["clock"]["seat"] == 0 && r["seats"][0]["away"] == true)
        .await;
    assert_eq!(short["clock"]["total_ms"], 5_000);

    // Anything the player does clears the mark.
    a.send(json!({ "type": "react", "text": "미안" }));
    a.next_where("room", |r| r["seats"][0]["away"] == false).await;

    // The hand finishes on its own, the stand-in playing every late turn.
    let done = a.next_where("table", |r| r["hands_played"] == 1).await;
    assert_eq!(done["in_hand"], false);
    assert!(done["clock"].is_null());
}

/// The session (scores and hands) goes to a connection when it opens and
/// to everyone when it changes, just before the room; not otherwise.
#[tokio::test(start_paused = true)]
async fn the_session_is_sent_only_when_it_changes() {
    let mut table = Table::open(MightySettings::new(Preset::Gshs));
    let mut a = table.connect();
    let first = a.rx.recv().await.unwrap();
    assert!(first.starts_with(r#"{"type":"session""#), "{first}");
    assert!(a.rx.recv().await.unwrap().starts_with(r#"{"type":"room""#));
    a.send(json!({ "type": "join", "name": "A" }));
    a.next("welcome").await;
    for seat in 1..5 {
        a.send(json!({ "type": "add_bot", "seat": seat, "level": "easy" }));
    }
    a.send(json!({ "type": "set_table", "turn_secs": 20 }));
    a.send(json!({ "type": "start" }));
    // Nothing until the hand is over changes the session.
    let mut kinds = Vec::new();
    loop {
        let msg: Value = serde_json::from_str(&a.rx.recv().await.unwrap()).unwrap();
        kinds.push(msg["type"].as_str().unwrap().to_string());
        if msg["type"] == "session" {
            assert_eq!(msg["hands_played"], 1);
            let room: Value = serde_json::from_str(&a.rx.recv().await.unwrap()).unwrap();
            assert_eq!((&room["type"], &room["in_hand"]), (&json!("room"), &json!(false)));
            break;
        }
    }
    assert!(kinds.len() > 20, "{kinds:?}");
}

#[tokio::test(start_paused = true)]
async fn a_dropped_player_counts_as_away_only_under_a_time_limit() {
    let mut table = Table::open(MightySettings::new(Preset::Gshs));
    let mut a = table.connect();
    a.join("A").await;
    let mut b = table.connect();
    b.join("B").await;
    b.leave_table();
    let r = a.next_where("room", |r| r["seats"][1]["connected"] == false).await;
    assert_eq!(r["seats"][1]["away"], false, "without a limit nobody is away");
    a.send(json!({ "type": "set_table", "turn_secs": 60 }));
    a.next_where("room", |r| r["seats"][1]["away"] == true).await;
}

#[tokio::test(start_paused = true)]
async fn reclaiming_a_seat_clears_its_away_mark() {
    let mut table = Table::open(MightySettings::new(Preset::Gshs));
    let mut a = table.connect();
    let (seat, token) = a.join("Jae").await;
    for bot in 1..5 {
        a.send(json!({ "type": "add_bot", "seat": bot, "level": "easy" }));
    }
    a.send(json!({ "type": "set_table", "turn_secs": 20 }));
    a.send(json!({ "type": "start" }));
    // Jae's turn runs out, so the seat is marked away while still connected.
    a.next_where("room", |r| {
        r["seats"][0]["away"] == true && r["seats"][0]["connected"] == true
    })
    .await;
    a.leave_table();

    let mut again = table.connect();
    // A token that holds no seat only watches.
    again.send(json!({ "type": "join", "name": "Jae", "token": "wrong", "reclaim": true }));
    again.next("unseated").await;
    again.send(json!({ "type": "join", "name": "Jae", "token": token, "reclaim": true }));
    assert_eq!(again.next("welcome").await["seat"], seat);
    // The first room message after the welcome is the one the join made.
    let room = again.next("room").await;
    assert_eq!(room["seats"][0]["connected"], true);
    assert_eq!(room["seats"][0]["away"], false, "coming back clears 자리 비움: {room}");
}

/// Two players let every turn run out, so the hands play themselves.
#[tokio::test(start_paused = true)]
async fn seats_shuffle_and_swap_between_hands_and_scores_follow_the_players() {
    let mut table = Table::open(MightySettings::new(Preset::Gshs));
    let mut a = table.connect();
    let (_, token_a) = a.join("A").await;
    let mut b = table.connect();
    let (_, token_b) = b.join("B").await;
    let mut watcher = table.connect();
    for bot in 2..5 {
        a.send(json!({ "type": "add_bot", "seat": bot, "level": "easy" }));
    }
    // Spectators may not move anyone.
    watcher.send(json!({ "type": "set_table", "shuffle_next": true }));
    assert_eq!(watcher.next("error").await["code"], "not_seated");

    a.send(json!({ "type": "set_table", "turn_secs": 20 }));
    a.send(json!({ "type": "start" }));
    // Seats stay put while a hand is on.
    b.next_where("room", |r| r["in_hand"] == true).await;
    b.send(json!({ "type": "swap_seats", "a": 0, "b": 1 }));
    assert_eq!(b.next("error").await["code"], "seats_between_hands");
    let before = a.next_where("table", |r| r["hands_played"] == 1).await;
    assert_eq!(before["showing"], true);
    let score = |r: &Value, name: &str| -> (usize, i64) {
        let seats = r["seats"].as_array().unwrap();
        let seat = seats.iter().position(|s| s["name"] == name).unwrap();
        (seat, r["scores"][seat].as_i64().unwrap())
    };
    let (a_was, a_score) = score(&before, "A");
    let (_, b_score) = score(&before, "B");
    let a_hist = before["history"][0][a_was].clone();
    let declarer = before["hands"][0]["declarer"].as_u64().unwrap() as usize;
    let declarer_was = before["seats"][declarer].clone();

    // 섞기 waits for the next hand; 다음 판 shuffles, then deals.
    b.send(json!({ "type": "set_table", "shuffle_next": true }));
    watcher.next_where("room", |r| r["table"]["shuffle_next"] == true).await;
    b.send(json!({ "type": "start" }));
    let news = a.next_where("seats_moved", |m| m["how"] == "shuffle").await;
    // B hears where everyone went before its own new seat, so its table can
    // slide each seat from where it was.
    let b_news = b.next("seats_moved").await;
    let b_welcome = b.next("welcome").await;
    let after = watcher
        .next_where("table", |r| r["hands_played"] == 1 && r["in_hand"] == true)
        .await;
    assert_eq!(after["table"]["shuffle_next"], false, "a shuffle is used once");
    let (a_seat, a_after) = score(&after, "A");
    let (b_seat, b_after) = score(&after, "B");
    assert_eq!((a_after, b_after), (a_score, b_score), "scores follow the players");
    assert_eq!(after["history"][0][a_seat], a_hist, "so does each hand's payoff");
    let moved_declarer = after["hands"][0]["declarer"].as_u64().unwrap() as usize;
    assert_eq!(after["seats"][moved_declarer]["kind"], declarer_was["kind"]);
    // Bots keep their names too.
    assert_eq!(after["seats"][moved_declarer]["name"], declarer_was["name"]);
    assert_eq!(news["order"][a_was], a_seat, "the news says where each seat went");
    assert_eq!(b_news, news);
    // Each tab learns its new seat, and the token still finds it.
    assert_eq!(b_welcome["seat"].as_u64().unwrap() as usize, b_seat);

    // That hand plays itself out too before the seats move again.
    watcher.next_where("table", |r| r["hands_played"] == 2).await;
    b.leave_table();
    watcher
        .next_where("room", |r| r["seats"][b_seat]["connected"] == false)
        .await;
    let mut again = table.connect();
    again.send(json!({ "type": "join", "name": "B", "token": token_b }));
    let welcome = again.next("welcome").await;
    assert_eq!(
        (welcome["seat"].as_u64().unwrap() as usize, &welcome["token"]),
        (b_seat, &json!(token_b))
    );

    // A swap moves two seats.
    again.send(json!({ "type": "swap_seats", "a": a_seat, "b": b_seat }));
    assert_eq!(again.next("welcome").await["seat"].as_u64().unwrap() as usize, a_seat);
    let swapped = again.next_where("room", |r| r["seats"][b_seat]["name"] == "A").await;
    assert_eq!(swapped["seats"][a_seat]["name"], "B");

    // B sends A back to watching; A's tab is told, and its token no longer
    // seats it anywhere.
    again.send(json!({ "type": "clear_seat", "seat": b_seat }));
    a.next("unseated").await;
    let cleared = watcher
        .next_where("room", |r| r["seats"][b_seat]["kind"] == "empty")
        .await;
    assert_eq!(cleared["watching"], 2, "A and the first watcher");
    a.send(json!({ "type": "join", "name": "A", "token": token_a, "reclaim": true }));
    a.next("unseated").await;
    // A may sit again by choice.
    a.send(json!({ "type": "join", "name": "A", "seat": b_seat }));
    assert_eq!(a.next("welcome").await["seat"].as_u64().unwrap() as usize, b_seat);
}

#[tokio::test(start_paused = true)]
async fn an_idle_table_closes_and_counts_its_hand_as_abandoned() {
    let env = RoomEnv {
        idle: Duration::from_secs(600),
        ..RoomEnv::new(Duration::ZERO)
    };
    let mut table = Table::open_with(MightySettings::new(Preset::Gshs), env);
    let mut a = with_bots(&mut table, "Jae").await;
    a.send(json!({ "type": "start" }));
    a.next("state").await;
    a.leave_table();
    // Nobody there: it waits out the idle time, and no longer.
    tokio::time::sleep(Duration::from_secs(599)).await;
    assert!(!table.task.is_finished(), "closed early");
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(table.task.is_finished(), "still open");
    let totals = table.stats.summary(crate::stats::now()).totals;
    assert_eq!((totals.hands_started, totals.hands_abandoned), (1, 1));
}

#[tokio::test(start_paused = true)]
async fn somebody_connected_keeps_a_table_open() {
    let env = RoomEnv {
        idle: Duration::from_secs(600),
        ..RoomEnv::new(Duration::ZERO)
    };
    let mut table = Table::open_with(MightySettings::new(Preset::Gshs), env);
    let watcher = table.connect();
    tokio::time::sleep(Duration::from_secs(3600)).await;
    assert!(!table.task.is_finished());
    watcher.leave_table();
    tokio::time::sleep(Duration::from_secs(601)).await;
    assert!(table.task.is_finished());
}

/// 기본's rules with every hand one that may be thrown in.
fn misdeal_rules(preset: Preset) -> MightySettings {
    let mut rules = serde_json::to_value(preset.rules()).unwrap();
    rules["misdeal"]["threshold"] = json!(19);
    let mut settings = MightySettings::new(preset);
    settings.rules = Some(serde_json::from_value(rules).unwrap());
    settings
}

#[tokio::test(start_paused = true)]
async fn where_misdeals_come_first_the_first_bid_waits_after_the_deal() {
    let mut table = Table::open(misdeal_rules(Preset::Default));
    let mut players = Vec::new();
    for name in ["A", "B", "C", "D", "E"] {
        let mut c = table.connect();
        c.join(name).await;
        players.push(c);
    }
    players[0].send(json!({ "type": "start" }));
    let mut states = Vec::new();
    for c in &mut players {
        states.push(c.next("state").await);
    }
    let turn = states[0]["turn"]["Seat"].as_u64().unwrap() as usize;
    assert_eq!(states[turn]["grace_ms"], 2000, "the whole grace is left at the deal");
    let bid = states[turn]["legal"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a.get("Bid").is_some())
        .unwrap()
        .clone();
    players[turn].send(json!({ "type": "act", "action": bid }));
    assert_eq!(players[turn].next("error").await["code"], "wait_after_deal");
    tokio::time::sleep(Duration::from_millis(1999)).await;
    players[turn].send(json!({ "type": "act", "action": bid }));
    assert_eq!(players[turn].next("error").await["code"], "wait_after_deal");
    tokio::time::sleep(Duration::from_millis(1)).await;
    players[turn].send(json!({ "type": "act", "action": bid }));
    let mine = players[turn].next("state").await;
    assert_eq!(mine["view"]["bids"].as_array().unwrap().len(), 1);
}

/// A bot whose think fails (it panicked) does not hold the hand up: the
/// 보통 stand-in makes its move at once.
#[tokio::test]
async fn a_failed_bot_think_is_played_by_the_stand_in() {
    let env = Arc::new(RoomEnv::new(Duration::ZERO));
    let mut room = Room::<Mighty>::new("t".into(), MightySettings::new(Preset::Gshs), env);
    for seat in 0..5 {
        room.add_bot(seat, mighty::bot::Level::Easy).unwrap();
    }
    room.start().unwrap();
    room.advance();
    let seat = room.bot_to_act().expect("a bot is to act");
    let (version, logged) = (room.hand.version, room.hand.log.len());
    // A failure for a hand that has moved on is dropped.
    assert!(!room.on_internal(Internal::BotFailed {
        version: version - 1,
        seat
    }));
    assert!(room.on_internal(Internal::BotFailed { version, seat }));
    assert_eq!(room.hand.log.len(), logged + 1);
    assert!(matches!(room.hand.log[logged], hand::LogEntry::Act { seat: s, .. } if s == seat));
}

/// Five bots, the first hand dealt, and a bot to act.
fn bots_dealt() -> Room<Mighty> {
    let env = Arc::new(RoomEnv::new(Duration::from_secs(1)));
    let mut room = Room::<Mighty>::new("t".into(), MightySettings::new(Preset::Gshs), env);
    for seat in 0..5 {
        room.add_bot(seat, mighty::bot::Level::Easy).unwrap();
    }
    room.start().unwrap();
    room.advance();
    room
}

/// The hand moving on under a thinking bot (a 딜미스, say) sets it
/// thinking about the new state at once, and the stale think, when it
/// comes back, leaves the new one running.
#[tokio::test(start_paused = true)]
async fn a_bot_rethinks_at_once_when_the_hand_moves_under_it() {
    let mut room = bots_dealt();
    let seat = room.bot_to_act().unwrap();
    let old = room.hand.version;
    room.think();
    assert_eq!(room.thinking, Some(old));
    room.think();
    assert_eq!(room.thinking, Some(old), "one think per state");
    room.hand.version += 1;
    room.think();
    assert_eq!(room.thinking, Some(old + 1));
    let stale = room
        .hand
        .game
        .as_ref()
        .map(|g| <Mighty as engine::Game>::legal_actions(g, seat)[0].clone())
        .unwrap();
    assert!(!room.on_internal(Internal::BotMove {
        version: old,
        seat,
        action: stale
    }));
    assert_eq!(room.thinking, Some(old + 1), "still thinking about the new state");
}

/// A timer that ran out for a state the hand has left plays nothing, and
/// the next settle sets one for the state there is.
#[tokio::test(start_paused = true)]
async fn a_stale_turn_timer_plays_nothing_and_is_set_again() {
    let mut room = bots_dealt();
    let seat = room.bot_to_act().unwrap();
    // The seat to act is a person's, connected, under a limit.
    let (tx, _rx) = mpsc::unbounded_channel();
    room.seating.conns.insert(1, seating::Conn::new(tx));
    room.seating.seats[seat] = seating::Occupant::Human {
        name: "A".into(),
        token: "a".into(),
        player: None,
    };
    room.table.turn_secs = 20;
    assert!(room.arm_clock());
    room.hand.version += 1;
    let logged = room.hand.log.len();
    assert!(!room.on_clock(), "a stale timer plays nothing");
    assert_eq!(room.hand.log.len(), logged);
    assert!(room.clock.deadline().is_none());
    room.settle(actor::Effects::default());
    assert!(room.clock.deadline().is_some(), "and the turn has its timer again");
}

/// Whoever reaches a table as it closes hears it is gone.
#[tokio::test]
async fn a_connection_to_a_closing_table_hears_it_is_gone() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    actor::turn_away(Command::Connect { conn: 1, tx });
    let gone: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
    assert_eq!(gone, json!({ "type": "error", "code": "table_gone" }));
    assert!(rx.recv().await.is_none(), "and the room lets go of it");

    // A table closed for good refuses anyone after.
    let mut table = Table::open_with(
        MightySettings::new(Preset::Gshs),
        RoomEnv {
            idle: Duration::from_millis(10),
            ..RoomEnv::new(Duration::ZERO)
        },
    );
    (&mut table.task).await.unwrap();
    let (tx, _rx) = mpsc::unbounded_channel();
    assert!(table.tx.send(Command::Connect { conn: 9, tx }).is_err());
    assert!(table.tx.is_closed());
}
