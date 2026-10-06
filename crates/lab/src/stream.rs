//! Named random streams. Every seat draws its randomness from its own
//! stream, seeded by the hand and by what the stream serves, so a variant
//! that chooses exactly what the recorded bot chose replays the recorded
//! hand exactly, and the difference in payoff is the change's alone.

use engine::Seat;
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;

/// What a stream serves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stream {
    /// The bots and the dealer in the bidding.
    Bid,
    /// The bots in the declarer's exchange.
    Exchange,
    /// The bots in the card play.
    Play,
    /// Everything after a changed decision in the bidding.
    AfterBid,
    /// The rest of a hand replayed from trick `n` (0-based) on.
    FromTrick(usize),
    /// An experiment's own draws, apart from the bots'.
    Lab(LabUse),
}

/// What an experiment draws for itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LabUse {
    /// The simple bot's choice set beside a variant's, for a focus seat.
    Compare(Seat),
    /// The bidding experiment's oracle searches.
    BidOracle,
    /// The tables the oracle plays its worlds out at, one per seat.
    OracleTable(Seat),
    /// The exchange searches.
    ExchangeSearch,
    /// The search values of the `n`th bidding decision of a hand.
    Signal(usize),
}

impl Stream {
    /// The stream's part of the seed: which part of the hand, and, for an
    /// experiment's own draws, which draw. The numbers are those the
    /// experiments published so far ran on.
    fn tag_and_index(self, seat: Seat) -> (u64, u64) {
        match self {
            Stream::Bid => (1, seat as u64),
            Stream::Exchange => (2, seat as u64),
            Stream::Play => (3, seat as u64),
            Stream::AfterBid => (4, seat as u64),
            Stream::FromTrick(n) => (5 + 16 + n as u64, seat as u64),
            Stream::Lab(use_) => (
                5,
                match use_ {
                    LabUse::Compare(s) | LabUse::OracleTable(s) => s as u64,
                    LabUse::BidOracle => 99,
                    LabUse::ExchangeSearch => 7,
                    LabUse::Signal(n) => 1000 + n as u64,
                },
            ),
        }
    }
}

/// splitmix64.
fn mix(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9e37_79b9_7f4a_7c15);
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

/// The stream for `seat` (or the dealer, numbered after the seats) that
/// serves `stream` in hand `deal`.
pub fn stream(deal: u64, stream: Stream, seat: Seat) -> ChaCha8Rng {
    let (tag, index) = stream.tag_and_index(seat);
    ChaCha8Rng::seed_from_u64(mix(mix(deal) ^ (tag << 48) ^ index))
}

/// [`stream`] for every seat and then the dealer.
pub fn streams(deal: u64, part: Stream, seats: usize) -> Vec<ChaCha8Rng> {
    (0..=seats).map(|s| stream(deal, part, s)).collect()
}

/// An experiment's own draws in hand `deal`.
pub fn lab(deal: u64, use_: LabUse) -> ChaCha8Rng {
    stream(deal, Stream::Lab(use_), 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::Rng;

    /// The streams are the ones experiments ran on before they were named.
    #[test]
    fn streams_keep_their_seeds() {
        let old = |deal: u64, tag: u64, seat: u64| ChaCha8Rng::seed_from_u64(mix(mix(deal) ^ (tag << 48) ^ seat));
        let draw = |mut r: ChaCha8Rng| r.random::<u64>();
        assert_eq!(draw(stream(7, Stream::Play, 3)), draw(old(7, 3, 3)));
        assert_eq!(draw(stream(7, Stream::FromTrick(2), 1)), draw(old(7, 23, 1)));
        assert_eq!(draw(lab(7, LabUse::BidOracle)), draw(old(7, 5, 99)));
        assert_eq!(draw(lab(7, LabUse::Signal(4))), draw(old(7, 5, 1004)));
        assert_ne!(draw(stream(7, Stream::Bid, 0)), draw(stream(7, Stream::Exchange, 0)));
    }
}
