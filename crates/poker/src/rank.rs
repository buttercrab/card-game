use crate::{PokerCard, PokerError};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PokerHandCategory {
    HighCard,
    Pair,
    TwoPair,
    ThreeOfAKind,
    Straight,
    Flush,
    FullHouse,
    FourOfAKind,
    StraightFlush,
}

/// Category then descending rank kickers. Suits never break a tie.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
pub struct PokerHandRank {
    pub category: PokerHandCategory,
    pub kickers: Vec<u8>,
}

pub fn rank(cards: &[PokerCard]) -> Result<PokerHandRank, PokerError> {
    if !(5..=7).contains(&cards.len()) {
        return Err(PokerError::Cards);
    }
    let mut ids = Vec::new();
    for card in cards {
        let id = card.id().ok_or(PokerError::Cards)?;
        if ids.contains(&id) {
            return Err(PokerError::Cards);
        }
        ids.push(id);
    }
    let mut best = None;
    for a in 0..cards.len() - 4 {
        for b in a + 1..cards.len() - 3 {
            for c in b + 1..cards.len() - 2 {
                for d in c + 1..cards.len() - 1 {
                    for e in d + 1..cards.len() {
                        let candidate = five([cards[a], cards[b], cards[c], cards[d], cards[e]]);
                        if best.as_ref().is_none_or(|old| candidate > *old) {
                            best = Some(candidate);
                        }
                    }
                }
            }
        }
    }
    Ok(best.expect("at least five cards"))
}
fn five(cards: [PokerCard; 5]) -> PokerHandRank {
    use PokerHandCategory::*;
    let mut ranks: Vec<_> = cards.iter().map(|c| c.rank).collect();
    ranks.sort_unstable_by(|a, b| b.cmp(a));
    let flush = cards.iter().all(|c| c.suit == cards[0].suit);
    let mut unique = ranks.clone();
    unique.dedup();
    let straight = if unique.len() == 5 && unique[0] - unique[4] == 4 {
        Some(unique[0])
    } else if unique == [14, 5, 4, 3, 2] {
        Some(5)
    } else {
        None
    };
    let mut groups: Vec<(usize, u8)> = unique
        .iter()
        .map(|r| (ranks.iter().filter(|v| *v == r).count(), *r))
        .collect();
    groups.sort_unstable_by(|a, b| b.cmp(a));
    let (category, kickers) = if let (true, Some(high)) = (flush, straight) {
        (StraightFlush, vec![high])
    } else if groups[0].0 == 4 {
        (FourOfAKind, vec![groups[0].1, groups[1].1])
    } else if groups[0].0 == 3 && groups[1].0 == 2 {
        (FullHouse, vec![groups[0].1, groups[1].1])
    } else if flush {
        (Flush, ranks)
    } else if let Some(high) = straight {
        (Straight, vec![high])
    } else if groups[0].0 == 3 {
        (ThreeOfAKind, groups.iter().map(|g| g.1).collect())
    } else if groups[0].0 == 2 && groups[1].0 == 2 {
        (TwoPair, groups.iter().map(|g| g.1).collect())
    } else if groups[0].0 == 2 {
        (Pair, groups.iter().map(|g| g.1).collect())
    } else {
        (HighCard, ranks)
    };
    PokerHandRank { category, kickers }
}
