//! Why a card may not be played, in the terms of the rule that holds it
//! back, so the table can say so instead of guessing. Which cards are
//! legal is decided by the game alone ([`crate::state::legal_plays`]);
//! this only explains the cards it leaves out.

use crate::card::Card;
use crate::rules::{CardPolicy, Rules};
use crate::state::{Action, TrickState, legal_plays};
use crate::trick::Lead;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Why a card in hand may not be played now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum Refusal {
    /// The joker was called and is in hand: it must come out (or the
    /// mighty, where the rules let the mighty defend it).
    CalledJoker,
    /// The hand holds a card of what was led, so it must follow.
    MustFollow(Lead),
    /// A joker may not lead the first trick.
    JokerFirstLead,
    /// The rules hold the card back on this trick (`leading`: from leading
    /// it, where it may still follow).
    HeldBack {
        card: Held,
        trick: TrickWhen,
        leading: bool,
    },
}

/// What kind of card the rules hold back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum Held {
    Mighty,
    Joker,
    /// A trump card.
    Trump,
    /// This card in particular (a per-card rule).
    Card,
}

/// The tricks the rules single out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum TrickWhen {
    First,
    Last,
}

/// Every card of `hand` that may not be played into trick `t`, with why.
pub(crate) fn refusals(
    rules: &Rules,
    hand: &[Card],
    t: TrickState,
    gone: impl Fn(Card) -> bool,
) -> Vec<(Card, Refusal)> {
    let legal = legal_plays(rules, hand, t, gone);
    let playable = |c: &Card| {
        legal
            .iter()
            .any(|a| matches!(a, Action::Play { card, .. } if card == c))
    };
    hand.iter()
        .filter(|c| !playable(c))
        .filter_map(|&c| Some((c, why(rules, hand, t, c)?)))
        .collect()
}

/// Why `card`, which the game does not offer, may not be played: the
/// first of the game's own checks it fails.
fn why(rules: &Rules, hand: &[Card], t: TrickState, card: Card) -> Option<Refusal> {
    let mighty = rules.mighty(t.trump);
    let held = |leading: bool| {
        let kind = if rules.policy.overrides.iter().any(|(c, _)| *c == card) {
            Held::Card
        } else if card == mighty {
            Held::Mighty
        } else if card.is_joker() {
            Held::Joker
        } else if card.suit().is_some() && card.suit() == t.trump {
            Held::Trump
        } else {
            Held::Card
        };
        let trick = if t.trick_no == 0 {
            TrickWhen::First
        } else {
            TrickWhen::Last
        };
        Refusal::HeldBack {
            card: kind,
            trick,
            leading,
        }
    };
    let policy = rules.policy(card, t.trump, t.trick_no);
    match t.lead {
        Some(lead) => {
            if t.called_joker.is_some_and(|j| hand.contains(&j)) {
                return Some(Refusal::CalledJoker);
            }
            let free = card == mighty || card.is_joker();
            let follows = hand.iter().any(|c| !c.is_joker() && lead.follows(*c));
            if follows && !free && !lead.follows(card) {
                return Some(Refusal::MustFollow(lead));
            }
            (policy == CardPolicy::Invalid).then(|| held(false))
        }
        None => {
            if card.is_joker() && t.trick_no == 0 && rules.joker_lead.not_first_trick {
                return Some(Refusal::JokerFirstLead);
            }
            matches!(policy, CardPolicy::Invalid | CardPolicy::NoLead).then(|| held(true))
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::Mighty;
    use crate::rules::{Preset, Rules};
    use crate::testing;
    use engine::Game;
    use rand::SeedableRng;

    /// Over many random hands under every preset and drawn rules, every
    /// card the game does not offer gets a reason, and no card it offers
    /// does.
    #[test]
    fn every_unplayable_card_has_a_reason() {
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(11);
        let mut rule_sets: Vec<Rules> = Preset::ALL.iter().map(|p| p.rules()).collect();
        for _ in 0..30 {
            rule_sets.push(Rules::web_mighty().varied(&mut rng));
        }
        let mut explained = 0;
        let mut kinds = std::collections::HashSet::new();
        for rules in rule_sets {
            for first_bidder in 0..2 {
                let options = crate::Options {
                    rules: rules.clone(),
                    first_bidder,
                };
                testing::play_hand(&options, &mut rng, &mut testing::random, &mut |state, seat| {
                    let legal = Mighty::legal_actions(state, seat);
                    let hand = &state.hands()[seat];
                    let refused = state.unplayable();
                    if matches!(state.phase(), crate::state::Phase::Play(_)) {
                        let legal_cards: Vec<_> = legal.iter().filter_map(crate::Action::played_card).collect();
                        let unplayable: Vec<_> = hand.iter().filter(|c| !legal_cards.contains(c)).collect();
                        assert_eq!(
                            refused.iter().map(|(c, _)| c).collect::<Vec<_>>(),
                            unplayable,
                            "{rules:?}"
                        );
                        explained += refused.len();
                        kinds.extend(refused.iter().map(|(_, why)| std::mem::discriminant(why)));
                    } else {
                        assert!(refused.is_empty());
                    }
                    true
                });
            }
        }
        assert!(explained > 1000, "{explained}");
        assert_eq!(kinds.len(), 4, "every kind of reason comes up");
    }
}
