//! The declarer's exchange of a recorded hand done another way: another
//! bot's, or searched whole (every set of discards and the friend call on
//! sampled deals), then the card play as recorded.

use crate::error::{LabError, Result};
use crate::record::{Record, apply, outcome, replay};
use crate::stream::{LabUse, Stream, lab, streams};
use crate::table::{Actor, Phase, Table, advance, phase};
use engine::{Game, Seat, Viewer};
use mighty::card::{ACE, Card, Suit};
use mighty::rules::{Contract, Rules};
use mighty::{Action, FriendCall, Mighty, PhaseView, State};
use mighty_ai::{SearchBot, SimpleBot, play_out};
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};

/// How the declarer exchanged in one variant, and how the hand went.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExchangeResult {
    pub deal: u64,
    pub variant: String,
    pub contract: Contract,
    pub base_contract: Contract,
    pub discards: Vec<Card>,
    pub base_discards: Vec<Card>,
    pub call: FriendCall,
    pub base_call: FriendCall,
    pub payoff: i64,
    pub base: i64,
    pub team_points: u8,
    pub base_team_points: u8,
}

/// How the declarer exchanges in an experiment.
#[derive(Debug, Clone)]
pub enum Exchanger {
    /// The recorded bot's discards, and a bot's friend call.
    Bot(Actor),
    /// Searches whole sets of discards (and changes of trump) at once,
    /// then the friend call, on `worlds` sampled deals.
    Joint { worlds: usize },
    /// The recorded discards, then the joint search's friend call.
    CallOnly { worlds: usize },
    /// One bot's discards (and change of trump), another's friend call.
    Split { discard: Actor, call: Actor },
}

fn exchange_actions(record: &Record) -> &[Action] {
    &record.log[record.exchange_at..record.play_at]
}

fn discards_of(actions: &[Action]) -> Vec<Card> {
    actions
        .iter()
        .filter_map(|a| match a {
            Action::Discard(c) => Some(*c),
            _ => None,
        })
        .collect()
}

pub fn exchange_variant(
    rules: &Rules,
    record: &Record,
    play: &Actor,
    name: &str,
    how: &Exchanger,
) -> Result<ExchangeResult> {
    let seats = rules.players;
    let deal = record.deal;
    let mut state = replay(rules, record, record.exchange_at)?;
    let declarer = record.declarer;
    let mut log = Vec::new();
    let mut lab_rng = lab(deal, LabUse::ExchangeSearch);
    match how {
        Exchanger::Bot(actor) => {
            let mut rngs = streams(deal, Stream::Exchange, seats);
            advance(
                deal,
                &mut state,
                &Table::of(actor),
                &mut rngs,
                &mut log,
                Phase::Exchange,
                &mut |_| {},
            )?;
        }
        Exchanger::Split { discard, call } => {
            let mut rngs = streams(deal, Stream::Exchange, seats);
            while phase(&state) == Phase::Exchange {
                let calling = engine::legal_on_turn::<Mighty>(&state)
                    .iter()
                    .any(|a| matches!(a, Action::CallFriend(_)));
                let who = if calling { call } else { discard };
                let a = who.act(&state, declarer, &mut rngs[declarer]);
                apply(deal, &mut state, a.clone())?;
                log.push(a);
            }
        }
        Exchanger::Joint { worlds } => {
            for a in joint_exchange(&state, declarer, *worlds, true, &mut lab_rng) {
                apply(deal, &mut state, a.clone())?;
                log.push(a);
            }
        }
        Exchanger::CallOnly { worlds } => {
            let recorded = exchange_actions(record);
            let Some((_, discards)) = recorded.split_last() else {
                return Err(LabError::Hand {
                    deal,
                    what: "the record has no exchange".into(),
                });
            };
            for a in discards {
                apply(deal, &mut state, a.clone())?;
                log.push(a.clone());
            }
            for a in joint_exchange(&state, declarer, *worlds, false, &mut lab_rng) {
                apply(deal, &mut state, a.clone())?;
                log.push(a);
            }
        }
    }
    let PhaseView::Play { contract, .. } = Mighty::view(&state, Viewer::Spectator).phase else {
        return Err(LabError::Hand {
            deal,
            what: format!("the exchange by {name} did not end"),
        });
    };
    let Some(&Action::CallFriend(call)) = log.last() else {
        return Err(LabError::Hand {
            deal,
            what: format!("the exchange by {name} called no friend"),
        });
    };
    let mut rngs = streams(deal, Stream::Play, seats);
    advance(
        deal,
        &mut state,
        &Table::of(play),
        &mut rngs,
        &mut Vec::new(),
        Phase::Play,
        &mut |_| {},
    )?;
    let done = outcome(deal, &state)?;
    Ok(ExchangeResult {
        deal,
        variant: name.to_string(),
        contract,
        base_contract: record.contract,
        discards: discards_of(&log),
        base_discards: discards_of(exchange_actions(record)),
        call,
        base_call: record.call,
        payoff: done.payoffs[declarer],
        base: record.payoffs[declarer],
        team_points: done.team_points,
        base_team_points: record.team_points,
    })
}

/// Plays `actions` from `world`, then the friend call `call` (or the simple
/// bot's), then the hand out with simple bots: the declarer's payoff.
fn score_exchange(world: &State, actions: &[Action], call: Option<FriendCall>, me: Seat, rng: &mut ChaCha8Rng) -> i64 {
    let mut s = world.clone();
    for a in actions {
        if engine::apply_on_turn::<Mighty>(&mut s, a.clone()).is_err() {
            return i64::MIN / 4;
        }
    }
    let policy = SimpleBot::default();
    while phase(&s) == Phase::Exchange {
        let legal = engine::legal_on_turn::<Mighty>(&s);
        let action = match call {
            Some(c) if legal.contains(&Action::CallFriend(c)) => Action::CallFriend(c),
            _ => {
                let view = Mighty::view(&s, Viewer::Seat(me));
                engine::Bot::act(&mut policy.clone(), &view, &legal, rng)
            }
        };
        engine::apply_on_turn::<Mighty>(&mut s, action).expect("legal");
    }
    play_out(policy, 0, s, me)
}

/// Weighted mean of each candidate's payoffs over the same worlds.
fn means(scores: &[Vec<i64>], weights: &[f64]) -> Vec<f64> {
    scores
        .iter()
        .map(|s| s.iter().zip(weights).map(|(&x, w)| x as f64 * w).sum::<f64>() / weights.iter().sum::<f64>())
        .collect()
}

/// Searches the exchange from `state` (the declarer about to discard, or
/// about to call a friend when `discard` is false): every set of discards
/// among the cards worth considering, for the current trump and for any
/// trump the simple bot rates nearly as well, scored on sampled deals by
/// successive halving; then every sensible friend call. The actions to
/// take, in order.
pub fn joint_exchange(state: &State, me: Seat, worlds: usize, discard: bool, rng: &mut ChaCha8Rng) -> Vec<Action> {
    let view = Mighty::view(state, Viewer::Seat(me));
    let search = SearchBot::default();
    let sampled = search.worlds(&view, worlds, rng);
    let weights: Vec<f64> = sampled.iter().map(|w| w.1).collect();
    let policy = SimpleBot::default();
    let PhaseView::Exchange { contract, .. } = view.phase else {
        panic!("not exchanging");
    };
    let rules = &view.rules;
    let kitty = rules.kitty_size();
    let mut chosen: Vec<Action> = Vec::new();
    if discard {
        // The simple bot's own exchange, as the plan to beat.
        let mut usual = Vec::new();
        let mut s = state.clone();
        while phase(&s) == Phase::Exchange && discards_of(&usual).len() < kitty {
            let legal = engine::legal_on_turn::<Mighty>(&s);
            let v = Mighty::view(&s, Viewer::Seat(me));
            let a = engine::Bot::act(&mut policy.clone(), &v, &legal, rng);
            engine::apply_on_turn::<Mighty>(&mut s, a.clone()).expect("legal");
            usual.push(a);
        }
        let mut plans: Vec<Vec<Action>> = vec![usual];
        let legal = engine::legal_on_turn::<Mighty>(state);
        let current = policy.estimate(rules, &view.hand, contract.trump);
        let trumps = std::iter::once(None).chain(legal.iter().filter_map(|a| match a {
            Action::ChangeTrump(t) if t.is_some() && policy.estimate(rules, &view.hand, *t) >= current - 1.0 => {
                Some(Some(*t))
            }
            _ => None,
        }));
        for change in trumps {
            let trump = change.unwrap_or(contract.trump);
            let mighty = rules.mighty(trump);
            let keep = |c: &Card| {
                *c == mighty
                    || c.is_joker()
                    || (c.suit() == trump && trump.is_some() && c.rank() >= Some(ACE - 2))
                    || (c.rank() == Some(ACE))
            };
            let pool: Vec<Card> = view.hand.iter().copied().filter(|c| !keep(c)).collect();
            if pool.len() < kitty {
                continue;
            }
            let prefix: Vec<Action> = change.map(Action::ChangeTrump).into_iter().collect();
            for set in combinations(pool.len(), kitty) {
                let mut plan = prefix.clone();
                plan.extend(set.iter().map(|&i| Action::Discard(pool[i])));
                plans.push(plan);
            }
        }
        let best = halving(&sampled, &weights, &plans, me, rng);
        chosen = plans[best].clone();
    }
    // The friend call, on the chosen discards.
    let mut after = state.clone();
    for a in &chosen {
        engine::apply_on_turn::<Mighty>(&mut after, a.clone()).expect("legal");
    }
    let legal = engine::legal_on_turn::<Mighty>(&after);
    let v = Mighty::view(&after, Viewer::Seat(me));
    let usual = engine::Bot::act(&mut policy.clone(), &v, &legal, rng);
    let PhaseView::Exchange { contract, .. } = v.phase else {
        panic!("still exchanging")
    };
    let trump = contract.trump;
    let mut wanted: Vec<Card> = vec![rules.mighty(trump)];
    wanted.extend(rules.deck.jokers());
    if let Some(t) = trump {
        wanted.extend((ACE - 4..=ACE).map(|r| Card::new(t, r)));
    }
    wanted.extend(
        Suit::ALL
            .into_iter()
            .filter(|&s| Some(s) != trump)
            .map(|s| Card::new(s, ACE)),
    );
    let mut calls: Vec<Action> = vec![usual.clone()];
    calls.extend(wanted.into_iter().map(|c| Action::CallFriend(FriendCall::Card(c))));
    calls.extend(
        [FriendCall::FirstTrick, FriendCall::LastTrick, FriendCall::Alone]
            .into_iter()
            .map(Action::CallFriend),
    );
    calls.retain(|a| legal.contains(a) && !matches!(a, Action::CallFriend(FriendCall::Card(c)) if v.hand.contains(c)));
    calls.dedup();
    if !calls.contains(&usual) {
        calls.insert(0, usual);
    }
    let plans: Vec<Vec<Action>> = calls
        .iter()
        .map(|c| chosen.iter().cloned().chain([c.clone()]).collect())
        .collect();
    let best = halving(&sampled, &weights, &plans, me, rng);
    plans[best].clone()
}

/// Successive halving over `plans` (each a list of exchange actions),
/// with plan 0 the default to beat: a plan replaces it only when ahead by
/// one standard error on the same deals.
fn halving(worlds: &[(State, f64)], weights: &[f64], plans: &[Vec<Action>], me: Seat, rng: &mut ChaCha8Rng) -> usize {
    let n = worlds.len();
    let mut alive: Vec<usize> = (0..plans.len()).collect();
    let mut used = (n / 8).max(16).min(n);
    let mut scores: Vec<Vec<i64>> = vec![Vec::new(); plans.len()];
    loop {
        for &p in &alive {
            let (actions, call) = split_call(&plans[p]);
            for (w, _) in worlds.iter().take(used).skip(scores[p].len()) {
                scores[p].push(score_exchange(w, &actions, call, me, rng));
            }
        }
        let m = means(
            &alive.iter().map(|&p| scores[p].clone()).collect::<Vec<_>>(),
            &weights[..used],
        );
        let mut order: Vec<(f64, usize)> = m.into_iter().zip(alive.iter().copied()).collect();
        order.sort_by(|a, b| b.0.total_cmp(&a.0));
        if used >= n {
            let best = order[0].1;
            if best == 0 || !alive.contains(&0) {
                return best;
            }
            // Beat the default by a standard error, deal by deal.
            let diffs: Vec<f64> = scores[best]
                .iter()
                .zip(&scores[0])
                .map(|(a, b)| (a - b) as f64)
                .collect();
            let w = &weights[..diffs.len()];
            let total: f64 = w.iter().sum();
            let mean = diffs.iter().zip(w).map(|(d, w)| d * w).sum::<f64>() / total;
            let ess = total * total / w.iter().map(|x| x * x).sum::<f64>();
            let var = diffs.iter().zip(w).map(|(d, w)| w * (d - mean).powi(2)).sum::<f64>() / total;
            let se = (var / ess.max(1.0)).sqrt();
            return if mean > se { best } else { 0 };
        }
        let keep = (order.len() / 3).clamp(2.min(order.len()), order.len());
        alive = order[..keep].iter().map(|o| o.1).collect();
        if !alive.contains(&0) {
            alive.push(0);
        }
        used = (used * 3).min(n);
    }
}

fn split_call(plan: &[Action]) -> (Vec<Action>, Option<FriendCall>) {
    match plan.last() {
        Some(Action::CallFriend(c)) => (plan[..plan.len() - 1].to_vec(), Some(*c)),
        _ => (plan.to_vec(), None),
    }
}

/// Every way to choose `k` of `n` indices.
fn combinations(n: usize, k: usize) -> Vec<Vec<usize>> {
    let mut out = Vec::new();
    let mut cur = Vec::new();
    fn go(start: usize, n: usize, k: usize, cur: &mut Vec<usize>, out: &mut Vec<Vec<usize>>) {
        if cur.len() == k {
            out.push(cur.clone());
            return;
        }
        for i in start..n {
            cur.push(i);
            go(i + 1, n, k, cur, out);
            cur.pop();
        }
    }
    go(0, n, k, &mut cur, &mut out);
    out
}
