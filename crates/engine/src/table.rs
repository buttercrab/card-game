//! What a game adds to be played at the server's tables, as three small
//! capabilities:
//!
//! - [`Table`]: a table's settings (a preset, pinned, and the table's own
//!   rules), checking them, how each hand of a session is set up, the
//!   game's catalog for the web client, and the waits and turn lengths
//!   its decisions call for;
//! - [`HandReport`]: a finished hand in brief for the session's story
//!   (with seats renumbered when players move), how it went in a word,
//!   and the notes a seat's table shows beside the view;
//! - [`TableBots`]: the bots that fill empty seats, by [`Level`], what
//!   they do off their turn, and what kind of decision a seat faces, which
//!   sets their pace.
//!
//! None has defaults: each answer is the game's to give. A game implements
//! [`Table`] and [`HandReport`] in its rules crate; [`TableBots`] belongs to
//! whatever crate holds its bots, which is why it is implemented by a type
//! of that crate rather than by the game.

use crate::info::GameInfo;
use crate::{Bot, Game, Level, Seat};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::fmt::Debug;
use std::time::Duration;

/// Why a table could not be set up as asked.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TableError<E> {
    #[error("no preset {0:?}")]
    UnknownPreset(String),
    #[error(transparent)]
    Rules(E),
}

/// A game's tables: their settings, and what the server needs to run a
/// session of hands under them.
pub trait Table: GameInfo + HandReport {
    /// What a table is set to play: a preset, the table's own rules when
    /// its players changed them, and the preset's rules as pinned when the
    /// table chose it.
    type Settings: Clone + Debug + PartialEq + Serialize + DeserializeOwned + Send + Sync + 'static;

    /// What the web client knows of this game before any table opens: the
    /// presets in the order players pick them, with their rules, and the
    /// like. Generated into the client's build.
    type Catalog: Serialize + ts_rs::TS + 'static;

    /// The rulebook's worked examples under a rule set: what a table under
    /// those rules would score in a few typical hands.
    type Examples: Serialize + 'static;

    /// A new table on preset `preset` (the game's default when `None`),
    /// pinned as the preset is now, playing `rules` when they differ from
    /// it. Refuses an unknown preset and rules that cannot be played.
    fn new_table(
        preset: Option<&str>,
        rules: Option<Self::Rules>,
    ) -> Result<Self::Settings, TableError<Self::RulesError>>;

    /// Pins whatever the settings take from outside the room (a preset's
    /// rules, say) as it is now, so the table keeps its rules for its whole
    /// life even if a later version of the server changes the preset.
    /// Settings pinned already stay as they are.
    fn freeze(settings: &mut Self::Settings);

    /// The rules `settings` play by: the table's own, or its preset's.
    fn table_rules(settings: &Self::Settings) -> Self::Rules;

    /// The preset the table plays, by id, for the stats and share links.
    fn preset_id(settings: &Self::Settings) -> &'static str;

    /// Whether the table's players changed the preset's rules.
    fn customized(settings: &Self::Settings) -> bool;

    /// Options for hand number `hand` (0-based) of a session; `last` is the
    /// hand before it in brief, when known. Where the opening seat moves
    /// round the table hand by hand, it is the one `shift` seats on from
    /// hand number `hand`'s, so the room can keep the rotation with the
    /// players when they change seats.
    fn hand_options(settings: &Self::Settings, hand: u32, last: Option<&Self::Summary>, shift: usize) -> Self::Options;

    /// How long after the cards land `action` must wait, so nobody loses
    /// an action off their turn (one of [`Game::legal_actions`] for a seat
    /// the hand does not wait on) to a fast tap.
    fn grace(state: &Self::State, action: &Self::Action) -> Duration;

    /// Whether the decision these actions offer deserves twice the table's
    /// turn time (a weightier choice than playing a card).
    fn long_decision(legal: &[Self::Action]) -> bool;

    /// The game's catalog ([`Table::Catalog`]).
    fn catalog() -> Self::Catalog;

    /// The rulebook's examples under `rules`, which must be playable.
    fn examples(rules: &Self::Rules) -> Self::Examples;
}

/// A hand as the session tells it.
pub trait HandReport: Game {
    /// A finished hand in brief, for the session's story.
    type Summary: Clone + Debug + Serialize + DeserializeOwned + Send + Sync + 'static;

    /// What a seat's table says beyond the view and the legal actions, so
    /// the client never works out the rules itself (why a card can't be
    /// played, say).
    type Notes: Clone + Debug + Serialize + Send + Sync + 'static;

    /// The hand in brief, once it is over.
    fn summary(state: &Self::State) -> Option<Self::Summary>;

    /// Renumbers the seats in a finished hand's summary after the players
    /// moved: whoever sat at seat `s` now sits at `new_seat[s]`.
    fn reseat(summary: &mut Self::Summary, new_seat: &[usize]);

    /// How a finished hand went, in a word, for the stats.
    fn outcome(state: &Self::State) -> &'static str;

    /// The notes for `seat` (none for a spectator), given its legal
    /// actions now.
    fn notes(state: &Self::State, seat: Option<Seat>, legal: &[Self::Action]) -> Self::Notes;
}

/// What a seat is deciding, for the pace of a bot's moves: people bid and
/// plan with care, lead with a moment's thought, and follow quickly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// No real choice: one legal move, or moves that all come to the same.
    Obvious,
    /// Following someone else's lead, with a choice to make.
    Follow,
    /// Leading.
    Lead,
    /// Bidding, or answering whether to throw the hand in.
    Bid,
    /// Setting the hand up: what to put back, whom to call.
    Plan,
}

/// The bots that sit at a game's tables.
pub trait TableBots<G: Game>: Send + Sync + 'static {
    /// A bot of this strength with temperament number `temper`, which may
    /// think for about `think` (zero for its own default) on `threads`
    /// threads. Bots differ a little in temperament so a table of bots
    /// does not play as one; a seated bot keeps its own when it moves.
    fn bot(&self, level: Level, temper: usize, think: Duration, threads: usize) -> Box<dyn Bot<G> + Send>;

    /// Whether a bot in `seat`, which the hand does not wait on, takes one
    /// of its `legal` actions anyway, and which. The room asks once each
    /// deal, and plays the answer after a short pause if it is still
    /// allowed then.
    fn off_turn(&self, level: Level, seat: Seat, view: &G::View, legal: &[G::Action]) -> Option<G::Action>;

    /// What kind of decision `view`'s seat faces among `legal`, which sets
    /// how long a bot seems to take over it.
    fn decision(&self, view: &G::View, legal: &[G::Action]) -> Decision;
}
