//! The room's task: it waits for a command, its turn timer or its idle
//! timeout, handles the one that comes, and settles.

use super::seating::Conn;
use super::view::Preview;
use super::{ConnId, Msg, REACTIONS, Room, TURN_LIMITS, log_action};
use crate::protocol::{ClientMsg, ErrorCode, ServerError};
use crate::session::SessionGame;
use crate::stats::Event;
use serde_json::Value;
use std::any::Any;
use std::time::{Duration, Instant};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, WeakUnboundedSender};
use tokio::sync::oneshot;

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
        reply: oneshot::Sender<Value>,
    },
    /// The preset and empty seats, for a share link's preview.
    Describe {
        reply: oneshot::Sender<Preview>,
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
        done: oneshot::Sender<()>,
    },
    /// A bot's out-of-turn action (a boxed `G::Action`), decided when deal
    /// number `deal` landed.
    BotOutOfTurn {
        deal: u64,
        seat: usize,
        action: Box<dyn Any + Send>,
    },
}

/// What the room's loop woke up for.
enum Wake {
    Command(Command),
    Clock,
    Closed,
}

/// What handling one wake did, for [`Room::settle`].
#[derive(Debug, Default, Clone, Copy)]
pub(super) struct Effects {
    /// Something everyone sees changed: send the table again.
    pub changed: bool,
}

impl Effects {
    const NONE: Effects = Effects { changed: false };
    const CHANGED: Effects = Effects { changed: true };
}

impl<G: SessionGame> Room<G> {
    /// `me` must send to `rx`; bots use it to report their moves. Returns
    /// once nobody has been connected for the server's idle time.
    ///
    /// With a data directory, the room is written there after every change
    /// and the file removed when the room closes.
    pub async fn run(mut self, me: WeakUnboundedSender<Command>, mut rx: UnboundedReceiver<Command>) {
        self.me = Some(me);
        let idle = self.env.idle;
        // A restored room may have a bot to act.
        self.settle(Effects::NONE);
        let mut empty_since = Some(tokio::time::Instant::now());
        loop {
            let now = tokio::time::Instant::now();
            let deadline = self.clock.deadline();
            let next = tokio::select! {
                cmd = rx.recv() => cmd.map_or(Wake::Closed, Wake::Command),
                () = tokio::time::sleep_until(empty_since.map_or(now, |since| since + idle)), if empty_since.is_some() => Wake::Closed,
                () = tokio::time::sleep_until(deadline.unwrap_or(now)), if deadline.is_some() => Wake::Clock,
            };
            let effects = match next {
                Wake::Command(Command::Shutdown { done }) => {
                    self.saver.save_now(&self.id, &self.snapshot());
                    let _ = done.send(());
                    return;
                }
                Wake::Command(cmd) => self.handle(cmd),
                Wake::Clock => Effects {
                    changed: self.on_clock(),
                },
                Wake::Closed => break,
            };
            self.settle(effects);
            empty_since = match (self.seating.conns.is_empty(), empty_since) {
                (true, None) => Some(tokio::time::Instant::now()),
                (true, since) => since,
                (false, _) => None,
            };
        }
        if self.hand.in_hand() {
            self.record(Event::HandAbandoned {
                hand: self.hand_stats(),
                secs: self.hand_secs(),
            });
        }
        self.saver.remove();
    }

    /// After every wake: the hand plays its chance actions (and is booked
    /// when over), the turn timer follows whoever is to act, a bot starts
    /// thinking if it is to act, and the room is saved and, if anything
    /// changed, sent to everyone.
    fn settle(&mut self, effects: Effects) {
        let mut changed = effects.changed;
        changed |= self.advance();
        changed |= self.arm_clock();
        self.think();
        let snapshot = self.snapshot();
        self.saver.save(&self.id, &snapshot);
        if changed {
            self.broadcast();
        }
    }

    fn handle(&mut self, cmd: Command) -> Effects {
        match cmd {
            Command::Connect { conn, tx } => {
                self.seating.conns.insert(conn, Conn::new(tx));
                Effects::CHANGED
            }
            Command::Disconnect { conn } => {
                self.seating.conns.remove(&conn);
                Effects::CHANGED
            }
            Command::Message { conn, msg } => {
                // A reaction or a hint changes nothing the room or the hand shows.
                let quiet = matches!(msg, ClientMsg::React { .. } | ClientMsg::Hint);
                // Anything a player does says they are back at the table.
                let back = self.seating.back(conn);
                let done = self.on_message(conn, msg);
                if let Err(error) = &done {
                    self.send(conn, &Msg::<G>::Error(error.clone()));
                }
                Effects {
                    changed: back || (done.is_ok() && !quiet),
                }
            }
            Command::Report { reply } => {
                let _ = reply.send(self.report());
                Effects::NONE
            }
            Command::Describe { reply } => {
                let _ = reply.send(self.describe());
                Effects::NONE
            }
            Command::BotMove { version, seat, action } => {
                self.thinking = false;
                Effects {
                    changed: self.bot_move(version, seat, action),
                }
            }
            // Handled by `run`, which ends the room.
            Command::Shutdown { .. } => Effects::NONE,
            Command::BotOutOfTurn { deal, seat, action } => Effects {
                changed: self.bot_out_of_turn(deal, seat, action),
            },
        }
    }

    pub(super) fn on_message(&mut self, conn: ConnId, msg: ClientMsg) -> Result<(), ServerError> {
        let my_seat = self.seating.seat_of(conn);
        let seated = || my_seat.ok_or(ServerError::from(ErrorCode::NotSeated));
        match msg {
            ClientMsg::Join {
                name,
                token,
                seat,
                device,
                reclaim,
            } => self.join(conn, name, token, seat, device, reclaim),
            ClientMsg::Leave => {
                self.leave(seated()?);
                Ok(())
            }
            ClientMsg::SetTable {
                turn_secs,
                shuffle,
                shuffle_next,
            } => self.set_table(my_seat, turn_secs, shuffle, shuffle_next),
            ClientMsg::SwapSeats { a, b } => self.swap_seats(my_seat, a, b),
            ClientMsg::ClearSeat { seat } => self.clear_seat(my_seat, seat),
            ClientMsg::AddBot { seat, level } => {
                seated()?;
                self.add_bot(seat, level)
            }
            ClientMsg::RemoveBot { seat } => {
                seated()?;
                self.remove_bot(seat)
            }
            ClientMsg::SetSettings { settings } => {
                seated()?;
                self.set_settings(settings)
            }
            ClientMsg::Hint => self.hint(conn, seated()?),
            ClientMsg::React { text } => self.react(conn, seated()?, text),
            ClientMsg::Start => {
                seated()?;
                self.start()
            }
            ClientMsg::Act { action } => self.act(seated()?, action),
        }
    }

    /// Changes the table's own settings; fields left out stay as they are.
    fn set_table(
        &mut self,
        my_seat: Option<usize>,
        turn_secs: Option<u32>,
        shuffle: Option<bool>,
        shuffle_next: Option<bool>,
    ) -> Result<(), ServerError> {
        my_seat.ok_or(ErrorCode::NotSeated)?;
        if shuffle_next.is_some() {
            self.may_move_seats(my_seat)?;
        }
        if let Some(secs) = turn_secs {
            if !TURN_LIMITS.contains(&secs) {
                return Err(ErrorCode::NoSuchTurnLimit.into());
            }
            self.table.turn_secs = secs;
        }
        if let Some(shuffle) = shuffle {
            self.table.shuffle = shuffle;
        }
        if let Some(next) = shuffle_next {
            self.table.shuffle_next = next;
        }
        Ok(())
    }

    /// Changes the game's settings between hands; the seat count stays.
    fn set_settings(&mut self, settings: Value) -> Result<(), ServerError> {
        if self.hand.in_hand() {
            return Err(ErrorCode::RulesBetweenHands.into());
        }
        let mut settings: G::Settings =
            serde_json::from_value(settings).map_err(|e| ServerError::with_detail(ErrorCode::BadMessage, e))?;
        G::freeze(&mut settings);
        G::validate(&settings)?;
        if G::seats(&settings) != self.seating.len() {
            return Err(ErrorCode::PlayerCountFixed.into());
        }
        tracing::info!(room = %self.id, settings = %log_action(&settings), "settings");
        self.settings = settings;
        Ok(())
    }

    /// Shows `seat`'s reaction to the whole table.
    fn react(&mut self, conn: ConnId, seat: usize, text: String) -> Result<(), ServerError> {
        if !REACTIONS.contains(&text.as_str()) {
            return Err(ErrorCode::UnknownReaction.into());
        }
        let c = self.seating.conns.get_mut(&conn).ok_or(ErrorCode::NotSeated)?;
        // Too fast: drop it quietly rather than nag.
        if c.reacted.is_some_and(|t| t.elapsed() < Duration::from_millis(700)) {
            return Ok(());
        }
        c.reacted = Some(Instant::now());
        self.tell_all(&Msg::<G>::Reaction { seat, text });
        Ok(())
    }
}
