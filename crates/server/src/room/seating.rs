//! Who sits where: the occupants, the connections and the seat tokens, the
//! away marks, and every way of sitting down, leaving and moving seats.

use super::{ConnId, Msg, Room};
use crate::protocol::{ErrorCode, SeatsMoved, ServerError};
use crate::session::SessionGame;
use crate::stats::Event;
use mighty::bot::Level;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::mpsc::UnboundedSender;
use tokio::time::Instant;

/// The longest name a seat takes, in characters; longer ones are cut.
pub const NAME_MAX: usize = 24;

/// Bots go by small, warm names. Each bot gets one when it sits down and
/// keeps it when it moves, so a shuffle never looks like bots trading
/// identities; it also keeps its temperament (see [`SessionGame::bot`]),
/// which is the name's place in this list.
pub const BOT_NAMES: [&str; 7] = ["두부", "모과", "호두", "보리", "단추", "콩떡", "소금"];

/// A seated bot's temperament: its name's place in [`BOT_NAMES`], so it
/// keeps it when it moves; the seat's for a name not on the list.
pub(super) fn bot_temper(name: &str, seat: usize) -> usize {
    BOT_NAMES.iter().position(|n| *n == name).unwrap_or(seat)
}

/// Bots keep no state between moves, so a seat only records that one sits there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum Occupant {
    Empty,
    Human {
        name: String,
        token: String,
        /// The player's id in the stats: a salted hash, never the raw id.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        player: Option<String>,
    },
    Bot {
        level: Level,
        /// Given when the bot sits down; see [`BOT_NAMES`].
        name: String,
    },
}

pub(super) struct Conn {
    pub tx: UnboundedSender<String>,
    pub seat: Option<usize>,
    /// When this connection last reacted, to keep reactions from flooding.
    pub reacted: Option<Instant>,
    /// When this connection last asked for a hint; a bot's think is not free.
    pub hinted: Option<Instant>,
}

impl Conn {
    pub fn new(tx: UnboundedSender<String>) -> Conn {
        Conn {
            tx,
            seat: None,
            reacted: None,
            hinted: None,
        }
    }
}

/// The seats and the connections watching or playing at them.
pub(super) struct Seating {
    pub seats: Vec<Occupant>,
    pub conns: HashMap<ConnId, Conn>,
    /// Seats whose turn ran out and was played for them (자리 비움), until
    /// their player does something.
    pub away: Vec<bool>,
}

impl Seating {
    pub fn new(n: usize) -> Seating {
        Seating {
            seats: vec![Occupant::Empty; n],
            conns: HashMap::new(),
            away: vec![false; n],
        }
    }

    pub fn len(&self) -> usize {
        self.seats.len()
    }

    /// How many seats hold people, and how many bots.
    pub fn counts(&self) -> (usize, usize) {
        let humans = self
            .seats
            .iter()
            .filter(|s| matches!(s, Occupant::Human { .. }))
            .count();
        let bots = self.seats.iter().filter(|s| matches!(s, Occupant::Bot { .. })).count();
        (humans, bots)
    }

    pub fn seat_of(&self, conn: ConnId) -> Option<usize> {
        self.conns.get(&conn).and_then(|c| c.seat)
    }

    pub fn connected(&self, seat: usize) -> bool {
        self.conns.values().any(|c| c.seat == Some(seat))
    }

    pub fn is_human(&self, seat: usize) -> bool {
        matches!(self.seats.get(seat), Some(Occupant::Human { .. }))
    }

    /// The bot at `seat`, if one sits there: its level and its temperament.
    pub fn bot(&self, seat: usize) -> Option<(Level, usize)> {
        match self.seats.get(seat) {
            Some(Occupant::Bot { level, name }) => Some((*level, bot_temper(name, seat))),
            _ => None,
        }
    }

    pub fn any_empty(&self) -> bool {
        self.seats.iter().any(|s| matches!(s, Occupant::Empty))
    }

    /// Connections without a seat: people watching.
    pub fn watching(&self) -> usize {
        self.conns.values().filter(|c| c.seat.is_none()).count()
    }

    /// The stats ids of the people seated.
    pub fn players(&self) -> Vec<String> {
        self.seats
            .iter()
            .filter_map(|s| match s {
                Occupant::Human { player, .. } => player.clone(),
                _ => None,
            })
            .collect()
    }

    /// Clears the away mark of `conn`'s seat; returns whether it had one.
    pub fn back(&mut self, conn: ConnId) -> bool {
        let seat = self.seat_of(conn);
        seat.is_some_and(|s| std::mem::take(&mut self.away[s]))
    }

    /// Unseats every connection at `seat`: they watch now.
    pub fn detach(&mut self, seat: usize) {
        for c in self.conns.values_mut().filter(|c| c.seat == Some(seat)) {
            c.seat = None;
        }
    }

    /// Puts `occupant` in `seat`, clearing its away mark.
    pub fn put(&mut self, seat: usize, occupant: Occupant) {
        self.seats[seat] = occupant;
        self.away[seat] = false;
    }

    /// A name for a bot sitting down at `seat`: the seat's own name from
    /// [`BOT_NAMES`] when nobody at the table goes by it, else the first
    /// one free.
    pub fn new_bot_name(&self, seat: usize) -> String {
        let taken = |candidate: &str| {
            self.seats.iter().any(|s| match s {
                Occupant::Bot { name, .. } | Occupant::Human { name, .. } => name == candidate,
                Occupant::Empty => false,
            })
        };
        let k = BOT_NAMES.len();
        (0..k)
            .map(|i| BOT_NAMES[(seat + i) % k])
            .find(|n| !taken(n))
            .map_or_else(|| format!("봇 {}", seat + 1), str::to_string)
    }

    /// The seat whose player holds `token`.
    pub fn seat_with_token(&self, token: &str) -> Option<usize> {
        self.seats
            .iter()
            .position(|s| matches!(s, Occupant::Human { token: t, .. } if t == token))
    }

    /// Moves whoever sits at each seat `s` to `new_seat[s]`, with their away
    /// marks and connections; returns each seated connection's new seat.
    pub fn reseat(&mut self, new_seat: &[usize]) -> Vec<(ConnId, usize)> {
        self.seats = moved(std::mem::take(&mut self.seats), new_seat);
        self.away = moved(std::mem::take(&mut self.away), new_seat);
        let mut moved_conns = Vec::new();
        for (&id, c) in &mut self.conns {
            if let Some(s) = c.seat {
                c.seat = Some(new_seat[s]);
                moved_conns.push((id, new_seat[s]));
            }
        }
        moved_conns
    }
}

/// `items` with the one at `s` moved to `new_seat[s]`.
pub(super) fn moved<T>(items: Vec<T>, new_seat: &[usize]) -> Vec<T> {
    let mut slots: Vec<Option<T>> = items.iter().map(|_| None).collect();
    for (s, item) in items.into_iter().enumerate() {
        slots[new_seat[s]] = Some(item);
    }
    slots
        .into_iter()
        .map(|s| s.expect("seats move by a permutation"))
        .collect()
}

impl<G: SessionGame> Room<G> {
    /// Whether `seat` is away (자리 비움): its last turn ran out, or, under a
    /// turn limit, its player's connection is gone.
    pub(super) fn is_away(&self, seat: usize) -> bool {
        self.seating.is_human(seat)
            && (self.seating.away[seat] || (self.table.turn_secs > 0 && !self.seating.connected(seat)))
    }

    /// Seat changes wait for the hand to end, and only players make them.
    pub(super) fn may_move_seats(&self, my_seat: Option<usize>) -> Result<(), ServerError> {
        my_seat.ok_or(ErrorCode::NotSeated)?;
        if self.hand.in_hand() {
            return Err(ErrorCode::SeatsBetweenHands.into());
        }
        Ok(())
    }

    pub(super) fn join(
        &mut self,
        conn: ConnId,
        name: String,
        token: Option<String>,
        seat: Option<usize>,
        device: Option<String>,
        reclaim: bool,
    ) -> Result<(), ServerError> {
        let name = name.trim().chars().take(NAME_MAX).collect::<String>();
        if name.is_empty() {
            return Err(ErrorCode::NameRequired.into());
        }
        if self.seating.seat_of(conn).is_some() {
            return Err(ErrorCode::AlreadySeated.into());
        }
        let reclaimed = token.as_deref().and_then(|t| self.seating.seat_with_token(t));
        if reclaim && reclaimed.is_none() {
            // The seat was given away while this tab was gone: it watches.
            self.send(conn, &Msg::<G>::Unseated);
            return Ok(());
        }
        // Between hands a newcomer may also take a bot's seat.
        let in_hand = self.hand.in_hand();
        let open = |s: &Occupant| match s {
            Occupant::Empty => true,
            Occupant::Bot { .. } => !in_hand,
            Occupant::Human { .. } => false,
        };
        let seats = &self.seating.seats;
        let seat = match reclaimed {
            Some(seat) => seat,
            None => seat
                .filter(|&s| seats.get(s).is_some_and(open))
                .or_else(|| seats.iter().position(|s| matches!(s, Occupant::Empty)))
                .ok_or(ErrorCode::TableFull)?,
        };
        if reclaimed.is_none() {
            // Scores belong to players: whoever sat here before (a player
            // who left, a bot) took theirs with them.
            self.session.scores[seat] = 0;
        }
        // A newer connection for the same seat wins; the old tab becomes a spectator.
        self.seating.detach(seat);
        let (token, player) = match (&self.seating.seats[seat], reclaimed) {
            (Occupant::Human { token, player, .. }, Some(_)) => (token.clone(), player.clone()),
            _ => (format!("{:032x}", self.rng.random::<u128>()), None),
        };
        // The browser's own id if it sends one, else the seat's token, which
        // the browser keeps for this table.
        let device = device.filter(|d| !d.is_empty() && d.len() <= 128);
        let stats = &self.env.stats;
        let player = match device {
            Some(device) => Some(stats.player(&device)),
            None => player.or_else(|| Some(stats.player(&token))),
        };
        if reclaimed.is_none() {
            self.record(Event::SeatFilled {
                table: self.id.clone(),
                seat,
                bot: None,
                player: player.clone(),
            });
        }
        // Coming back clears 자리 비움 too: the `back` check before this
        // message ran while the connection was not yet seated.
        self.seating.put(
            seat,
            Occupant::Human {
                name,
                token: token.clone(),
                player,
            },
        );
        if let Some(c) = self.seating.conns.get_mut(&conn) {
            c.seat = Some(seat);
        }
        self.send(conn, &Msg::<G>::Welcome { seat, token });
        Ok(())
    }

    /// The player at `seat` gives it up; a bot takes over mid-hand.
    pub(super) fn leave(&mut self, seat: usize) {
        let mid_hand = self.hand.in_hand();
        if mid_hand {
            self.record(Event::LeftMidHand {
                table: self.id.clone(),
                seat,
            });
        }
        let occupant = if mid_hand {
            Occupant::Bot {
                level: Level::default(),
                name: self.seating.new_bot_name(seat),
            }
        } else {
            Occupant::Empty
        };
        self.seating.put(seat, occupant);
        self.seating.detach(seat);
    }

    /// Between hands: the player at `seat` goes back to watching.
    pub(super) fn clear_seat(&mut self, my_seat: Option<usize>, seat: usize) -> Result<(), ServerError> {
        self.may_move_seats(my_seat)?;
        if my_seat == Some(seat) {
            return Err(ErrorCode::LeaveOwnSeat.into());
        }
        if !self.seating.is_human(seat) {
            return Err(ErrorCode::NoPlayerInSeat.into());
        }
        self.seating.put(seat, Occupant::Empty);
        let unseated: Vec<ConnId> = self
            .seating
            .conns
            .iter()
            .filter(|(_, c)| c.seat == Some(seat))
            .map(|(&id, _)| id)
            .collect();
        for id in unseated {
            self.send(id, &Msg::<G>::Unseated);
        }
        self.seating.detach(seat);
        Ok(())
    }

    /// Seats a bot in an empty seat or for a player who dropped, or changes
    /// the level of the bot already there.
    pub(super) fn add_bot(&mut self, seat: usize, level: Level) -> Result<(), ServerError> {
        let free = match self.seating.seats.get(seat).ok_or(ErrorCode::NoSuchSeat)? {
            Occupant::Empty | Occupant::Bot { .. } => true,
            Occupant::Human { .. } => !self.seating.connected(seat),
        };
        if !free {
            return Err(ErrorCode::SeatTaken.into());
        }
        // A bot already there only changes how well it plays; a new one
        // gets a name of its own.
        let name = match &self.seating.seats[seat] {
            Occupant::Bot { name, .. } => name.clone(),
            occupant => {
                // A bot in an empty seat starts from nothing; one standing
                // in for a player who dropped plays on from their score.
                if matches!(occupant, Occupant::Empty) {
                    self.session.scores[seat] = 0;
                }
                self.record(Event::SeatFilled {
                    table: self.id.clone(),
                    seat,
                    bot: Some(level),
                    player: None,
                });
                self.seating.new_bot_name(seat)
            }
        };
        self.seating.put(seat, Occupant::Bot { level, name });
        Ok(())
    }

    pub(super) fn remove_bot(&mut self, seat: usize) -> Result<(), ServerError> {
        if self.hand.in_hand() {
            return Err(ErrorCode::BotsStayInHand.into());
        }
        match self.seating.seats.get(seat) {
            Some(Occupant::Bot { .. }) => {
                self.seating.put(seat, Occupant::Empty);
                Ok(())
            }
            _ => Err(ErrorCode::NoBotInSeat.into()),
        }
    }

    /// Between hands: whoever sits at `a` and at `b` trade seats.
    pub(super) fn swap_seats(&mut self, my_seat: Option<usize>, a: usize, b: usize) -> Result<(), ServerError> {
        self.may_move_seats(my_seat)?;
        let n = self.seating.len();
        if a >= n || b >= n || a == b {
            return Err(ErrorCode::NoSuchSeat.into());
        }
        let seats = &self.seating.seats;
        if matches!(seats[a], Occupant::Empty) && matches!(seats[b], Occupant::Empty) {
            return Err(ErrorCode::NobodyToMove.into());
        }
        let new_seat: Vec<usize> = (0..n)
            .map(|s| match s {
                s if s == a => b,
                s if s == b => a,
                s => s,
            })
            .collect();
        self.reseat(&new_seat, SeatsMoved::Swap { seats: [a, b] });
        Ok(())
    }

    /// Moves whoever sits at each seat `s` to `new_seat[s]`, with their
    /// score, their past hands and their connections, so the scores follow
    /// the players. The last hand's table is put away: it no longer
    /// matches who sits where. Everyone hears `news` first, so a table on
    /// screen can note where each seat was before its own seat changes.
    pub(super) fn reseat(&mut self, new_seat: &[usize], news: SeatsMoved) {
        self.tell_all(&Msg::<G>::SeatsMoved(news));
        self.session.reseat(new_seat);
        self.hand.put_away();
        // Each player's tab learns its new seat; the token stays the same.
        for (id, seat) in self.seating.reseat(new_seat) {
            if let Occupant::Human { token, .. } = &self.seating.seats[seat] {
                let token = token.clone();
                self.send(id, &Msg::<G>::Welcome { seat, token });
            }
        }
    }

    /// Deals everyone into random seats, and everyone at the table into a
    /// seat other than their own: a shuffle that leaves someone where they
    /// were (or only trades empty seats) looks like it did not happen.
    pub(super) fn shuffle_seats(&mut self) {
        use rand::seq::SliceRandom;
        let n = self.seating.len();
        let mut order: Vec<usize> = (0..n).collect();
        let occupied: Vec<bool> = self
            .seating
            .seats
            .iter()
            .map(|s| !matches!(s, Occupant::Empty))
            .collect();
        let everyone_moves = |order: &[usize]| (0..n).all(|s| !occupied[s] || order[s] != s);
        // About a third of shuffles move everyone, so this rarely runs out;
        // if it does, everyone moves the same random number of seats round.
        let found = (0..64).any(|_| {
            order.shuffle(&mut self.rng);
            everyone_moves(&order)
        });
        if !found && n > 1 {
            let k = self.rng.random_range(1..n);
            order = (0..n).map(|s| (s + k) % n).collect();
        }
        // `order[s]`: where the seat `s` went, so tables can slide each one there.
        let news = SeatsMoved::Shuffle { order: order.clone() };
        self.reseat(&order, news);
    }
}

#[cfg(test)]
mod tests {
    use super::super::RoomEnv;
    use super::*;
    use crate::protocol::ClientMsg;
    use crate::session::MightySettings;
    use mighty::Mighty;
    use mighty::rules::Preset;
    use std::sync::Arc;
    use std::time::Duration;

    fn room() -> Room<Mighty> {
        let env = Arc::new(RoomEnv::new(Duration::ZERO));
        Room::new("t".into(), MightySettings::new(Preset::Gshs), env)
    }

    /// Empty seats trading places is no shuffle, nor is one that leaves
    /// someone where they sat: everyone at the table moves, alone at it too.
    #[test]
    fn a_shuffle_moves_everyone_at_the_table() {
        let bot = |name: &str| Occupant::Bot {
            level: Level::Easy,
            name: name.into(),
        };
        let names = |r: &Room<Mighty>| {
            r.seating
                .seats
                .iter()
                .map(|s| match s {
                    Occupant::Bot { name, .. } => name.clone(),
                    _ => String::new(),
                })
                .collect::<Vec<_>>()
        };
        // One at the table (at seat 2), three, and a full table.
        for seated in [&[2][..], &[0, 1, 2], &[0, 1, 2, 3, 4]] {
            let mut room = room();
            for &seat in seated {
                room.seating.seats[seat] = bot(BOT_NAMES[seat]);
            }
            for _ in 0..200 {
                let before = names(&room);
                room.shuffle_seats();
                let after = names(&room);
                for (seat, name) in before.iter().enumerate().filter(|(_, n)| !n.is_empty()) {
                    assert_ne!(&after[seat], name, "{name} stayed at seat {seat}");
                }
                let (mut b, mut a) = (before, after);
                b.sort();
                a.sort();
                assert_eq!(a, b, "nobody comes or goes");
            }
        }
    }

    /// Whoever sits in a seat someone left starts at 0: the score went
    /// with the one who earned it. A bot standing in for a player who
    /// dropped keeps the player's.
    #[test]
    fn a_newcomer_does_not_inherit_the_last_occupants_score() {
        let mut room = room();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let join = |name: &str, seat| ClientMsg::Join {
            name: name.into(),
            token: None,
            seat: Some(seat),
            device: None,
            reclaim: false,
        };
        room.seating.conns.insert(1, Conn::new(tx.clone()));
        room.on_message(1, join("A", 0)).unwrap();
        room.session.scores = vec![5, 7, -4, -3, -5];
        // Seat 1 was left empty (its bot removed): a new bot starts at 0.
        let add = |seat| ClientMsg::AddBot {
            seat,
            level: Level::Easy,
        };
        room.on_message(1, add(1)).unwrap();
        assert_eq!(room.session.scores[1], 0);
        // Seat 2 holds a player who dropped: the bot plays on from -4.
        room.seating.seats[2] = Occupant::Human {
            name: "B".into(),
            token: "b".into(),
            player: None,
        };
        room.on_message(1, add(2)).unwrap();
        assert_eq!(room.session.scores[2], -4);
        // A watcher takes seat 3 (empty) or a bot's seat between hands: 0.
        room.seating.conns.insert(2, Conn::new(tx.clone()));
        room.on_message(2, join("C", 3)).unwrap();
        assert_eq!(room.session.scores[3], 0);
        room.seating.conns.insert(3, Conn::new(tx));
        room.on_message(3, join("D", 2)).unwrap();
        assert_eq!(room.session.scores[2], 0);
        assert_eq!(room.session.scores[0], 5, "a seated player keeps theirs");
    }

    /// A bot keeps its temperament wherever it sits.
    #[test]
    fn a_bots_temperament_goes_by_its_name() {
        assert_eq!(bot_temper("호두", 4), 2);
        assert_eq!(bot_temper("봇 5", 4), 4);
    }
}
