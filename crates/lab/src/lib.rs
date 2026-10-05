//! Experiments on where the bots lose points, phase by phase. Hands are
//! first played by one table of bots and recorded ([`record::generate`]);
//! experiments then replay a recorded hand up to some decision and play it
//! on with a change: another bot in one seat for the card play
//! ([`play`]), the other choice at a bid ([`bid`]), another exchange
//! ([`exchange`]). Every seat draws its randomness from its own named
//! stream ([`stream`]), seeded by the hand and the phase, so a variant that
//! chooses exactly what the recorded bot chose replays the recorded hand
//! exactly, and the difference in payoff is the change's alone.
//!
//! Others read recorded hands in hindsight ([`audit`], [`regret`], by the
//! flags of [`hindsight`]), measure one seat's bidding ([`declare`]), or
//! how much of a hand's payoff shows at bidding time ([`signal`]).

pub mod audit;
pub mod bid;
pub mod declare;
pub mod error;
pub mod exchange;
pub mod hindsight;
pub mod play;
pub mod record;
pub mod regret;
pub mod signal;
pub mod stream;
pub mod table;

pub use error::{LabError, Result};
pub use record::Record;
pub use table::Actor;

#[cfg(test)]
mod tests {
    use crate::bid::bid_experiment;
    use crate::declare::{declare, declare_report};
    use crate::exchange::{Exchanger, exchange_variant, joint_exchange};
    use crate::hindsight::Flag;
    use crate::play::{play_from, play_variant};
    use crate::record::{Record, generate, replay};
    use crate::stream::{LabUse, lab};
    use crate::table::Actor;
    use crate::{audit, regret};
    use mighty::Action;
    use mighty::rules::{Preset, Rules};

    fn gshs() -> Rules {
        Preset::Gshs.rules()
    }

    fn records(bot: &Actor, deals: u64) -> Vec<Record> {
        (0..deals).map(|deal| generate(&gshs(), deal, bot).unwrap()).collect()
    }

    /// Replaying a recorded hand's play with the recorded bots reproduces it.
    #[test]
    fn replays_match_records() {
        let rules = gshs();
        let bot = Actor::parse("search:8:1:0").unwrap();
        for record in records(&bot, 3) {
            let again = play_variant(&rules, &record, &bot, 0, ("same", &bot)).unwrap();
            assert_eq!(again.payoff, again.base);
            assert!(again.differing.is_empty());
            let ex = exchange_variant(&rules, &record, &bot, "same", &Exchanger::Bot(bot.clone())).unwrap();
            assert_eq!(ex.payoff, ex.base);
        }
    }

    /// With the same bot in the focus seat as everywhere else, `declare`
    /// plays the hand `generate` records, and reads it right.
    #[test]
    fn declare_plays_the_recorded_hand() {
        let rules = gshs();
        let bot = Actor::parse("normal").unwrap();
        for record in records(&bot, 30) {
            let deal = record.deal;
            let result = declare(&rules, deal, &bot, &bot).unwrap();
            assert_eq!(result.focus, (deal / 5 % 5) as usize);
            assert_eq!(
                (result.declarer, result.contract, result.team_points),
                (record.declarer, record.contract, record.team_points)
            );
            assert_eq!(result.payoff, record.payoffs[result.focus]);
            assert_eq!(result.declarer_payoff, record.payoffs[record.declarer]);
            let bid = record
                .bids
                .iter()
                .any(|b| b.seat == result.focus && matches!(b.action, Action::Bid(_)));
            assert_eq!(result.bid, bid);
        }
        let bot = Actor::parse("normal").unwrap();
        let report = declare_report(&[("x".into(), vec![declare(&rules, 0, &bot, &bot).unwrap()])]);
        assert!(report.contains("| x | 1 |"));
    }

    /// Played on from a trick with the recorded bots in every seat, the
    /// rest of the hand comes out the same both times; another bot in the
    /// focus seat is compared on the same cards.
    #[test]
    fn play_from_compares_on_the_same_cards() {
        let rules = gshs();
        let normal = Actor::parse("normal").unwrap();
        let random = Actor::parse("random").unwrap();
        for record in records(&normal, 6) {
            let same = play_from(&rules, &record, &normal, 1, ("same", &normal), 7).unwrap();
            assert_eq!((same.payoff, same.team_points), (same.base, same.base_team_points));
            assert!(same.differing.is_empty());
            let other = play_from(&rules, &record, &normal, 1, ("random", &random), 7).unwrap();
            assert_eq!(other.base, same.base, "the same replayed base");
            assert!(other.differing.iter().all(|d| d.trick_no >= 7));
        }
    }

    /// The audit counts what the hindsight flags say, and the regret
    /// experiment flags its decisions the same way, never claiming a
    /// best move worse than the one made.
    #[test]
    fn audits_and_regrets_agree_on_their_flags() {
        let rules = gshs();
        let (mut flagged, mut calls) = (0, 0);
        for record in records(&Actor::parse("normal").unwrap(), 20) {
            let a = audit::audit(&rules, &record).unwrap();
            let r = regret::regret(&rules, &record, 2).unwrap();
            assert_eq!(r.deal, record.deal);
            for d in &r.decisions {
                assert!(d.regret >= 0, "{d:?}");
                assert_eq!(d.best.is_some(), d.regret > 0);
            }
            let regret_flags = |f: Flag| {
                r.decisions
                    .iter()
                    .filter(|d| d.flags.contains(&f.name().into()))
                    .count()
            };
            // Regret looks only at decisions with a choice; the audit at all.
            assert!(regret_flags(Flag::JokerOnPartner) <= a.joker_on_partner as usize);
            assert_eq!(regret_flags(Flag::SpecialOnEmpty), a.special_on_empty as usize);
            flagged += a.special_on_empty + a.joker_on_partner + a.mighty_on_partner + a.joker_on_last_trick;
            calls += a.joker_calls;
        }
        assert!(flagged > 0 && calls > 0, "{flagged} flags, {calls} joker calls");
    }

    /// The bidding experiment replays the declarer passing instead, and
    /// asks the oracle about its bid.
    #[test]
    fn the_bid_experiment_tries_the_other_choice() {
        let rules = gshs();
        let normal = Actor::parse("normal").unwrap();
        let mut tried = 0;
        for record in records(&normal, 8) {
            let result = bid_experiment(&rules, &record, &normal, 8).unwrap();
            assert_eq!(result.declarer_payoff, record.payoffs[record.declarer]);
            if let Some(oracle) = &result.oracle {
                assert!((0.0..=20.0).contains(&oracle.mean_points));
                assert!((oracle.points.iter().sum::<f64>() - 1.0).abs() < 1e-6 || oracle.mean_points == 0.0);
                tried += 1;
            }
        }
        assert!(tried > 0);
    }

    /// The exchange search plays a whole exchange: discards as many as the
    /// kitty held, then a friend call, all of them legal.
    #[test]
    fn the_exchange_search_exchanges_whole() {
        let rules = gshs();
        let normal = Actor::parse("normal").unwrap();
        for record in records(&normal, 3) {
            let state = replay(&rules, &record, record.exchange_at).unwrap();
            let plan = joint_exchange(
                &state,
                record.declarer,
                16,
                true,
                &mut lab(record.deal, LabUse::ExchangeSearch),
            );
            let discards = plan.iter().filter(|a| matches!(a, Action::Discard(_))).count();
            assert_eq!(discards, rules.kitty_size());
            assert!(matches!(plan.last(), Some(Action::CallFriend(_))));
            let joint = exchange_variant(&rules, &record, &normal, "joint", &Exchanger::Joint { worlds: 16 }).unwrap();
            assert_eq!(joint.discards.len(), rules.kitty_size());
        }
    }

    /// A record made under other rules does not replay: an error, not a
    /// panic.
    #[test]
    fn a_record_of_other_rules_is_an_error() {
        let record = generate(&gshs(), 0, &Actor::parse("normal").unwrap()).unwrap();
        let other = Preset::Default.rules();
        assert!(replay(&other, &record, record.log.len()).is_err());
        assert!(audit::audit(&other, &record).is_err());
    }
}
