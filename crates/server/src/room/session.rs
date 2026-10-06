//! The session at a table: the scores, every finished hand's payoffs and
//! summary, and which hand comes next (with the rotation of the opening
//! seat, which follows the players when they move).

use super::seating::moved;
use crate::protocol::SessionMsg;
use crate::session::SessionGame;

pub(super) struct Session<G: SessionGame> {
    pub scores: Vec<i64>,
    pub hands_played: u32,
    /// Each finished hand's payoffs, in order.
    pub history: Vec<Vec<i64>>,
    /// Each finished hand in brief, in order. Rooms saved before these were
    /// kept have fewer of them than `history`.
    pub hands: Vec<G::Summary>,
    /// How many seats on the opening seat is from where the hand number
    /// alone puts it: moving seats moves the rotation with the players.
    pub rotation: usize,
    /// Bumped whenever the scores or the hands change, so the room sends
    /// the session only then.
    pub revision: u64,
}

impl<G: SessionGame> Session<G> {
    pub fn new(n: usize) -> Session<G> {
        Session {
            scores: vec![0; n],
            hands_played: 0,
            history: Vec::new(),
            hands: Vec::new(),
            rotation: 0,
            revision: 1,
        }
    }

    /// The session as the clients see it.
    pub fn message(&self) -> SessionMsg<G::Summary> {
        SessionMsg {
            scores: self.scores.clone(),
            hands_played: self.hands_played,
            history: self.history.clone(),
            hands: self.hands.clone(),
        }
    }

    /// Whoever sits at `seat` starts from nothing: the score there went
    /// with whoever earned it.
    pub fn reset_score(&mut self, seat: usize) {
        if self.scores[seat] != 0 {
            self.scores[seat] = 0;
            self.revision += 1;
        }
    }

    /// The hand before hand number `hand`, in brief, when every hand so far
    /// was kept (rooms saved before summaries were kept have fewer).
    pub fn last_hand(&self, hand: u32) -> Option<&G::Summary> {
        (self.hands.len() == hand as usize).then(|| self.hands.last()).flatten()
    }

    /// How hand number `hand` is set up under `settings`.
    pub fn options(&self, settings: &G::Settings, hand: u32) -> G::Options {
        G::hand_options(settings, hand, self.last_hand(hand), self.rotation)
    }

    /// Books a finished hand.
    pub fn book(&mut self, payoffs: Vec<i64>, summary: Option<G::Summary>) {
        for (score, payoff) in self.scores.iter_mut().zip(&payoffs) {
            *score += payoff;
        }
        self.history.push(payoffs);
        self.hands.extend(summary);
        self.hands_played += 1;
        self.revision += 1;
    }

    /// Whoever sat at seat `s` now sits at `new_seat[s]`: their score and
    /// past payoffs go with them, and whoever would have opened the next
    /// hand still does, from their new seat.
    pub fn reseat(&mut self, new_seat: &[usize]) {
        let n = self.scores.len();
        let played = self.hands_played as usize % n;
        let opener = (played + self.rotation) % n;
        self.rotation = (new_seat[opener] + n - played) % n;
        self.scores = moved(std::mem::take(&mut self.scores), new_seat);
        for payoffs in self.history.iter_mut().filter(|p| p.len() == n) {
            *payoffs = moved(std::mem::take(payoffs), new_seat);
        }
        for summary in &mut self.hands {
            G::reseat(summary, new_seat);
        }
        self.revision += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::MightySettings;
    use mighty::Mighty;

    /// Seats moving between hands keep the opening seat with its player.
    #[test]
    fn the_rotation_follows_the_player_who_opens_next() {
        let settings = MightySettings::default();
        let mut session = Session::<Mighty>::new(5);
        session.hands_played = 3;
        let opener = |s: &Session<Mighty>| s.options(&settings, s.hands_played).first_bidder;
        assert_eq!(opener(&session), 3);
        // Seat 3 goes to seat 0, the rest one further round.
        session.reseat(&[1, 2, 4, 0, 3]);
        assert_eq!(opener(&session), 0);
        session.reseat(&[4, 3, 2, 1, 0]);
        assert_eq!(opener(&session), 4);
    }
}
