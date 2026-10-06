//! The batched environment: reproducible, consistent with the game and
//! its encoding, and with the seats, rewards and errors it promises.

mod common;

use common::{choose, env, legal, setup};
use engine::{Game, Turn, Viewer};
use engine_ml::Encode;
use env::{Batch, Error};
use mighty::Mighty;

/// Slot `slot`'s part of every field of `batch`, as bytes, for comparing
/// slots across batches of different sizes.
fn slot_bytes(batch: &Batch, slot: usize) -> Vec<u8> {
    fn part<T: Copy>(v: &[T], n: usize, slot: usize, bytes: impl Fn(T) -> Vec<u8>) -> Vec<u8> {
        let w = v.len() / n;
        v[slot * w..(slot + 1) * w].iter().flat_map(|&x| bytes(x)).collect()
    }
    let n = batch.seat.len();
    let f = |x: f32| x.to_le_bytes().to_vec();
    let i = |x: i32| x.to_le_bytes().to_vec();
    let b = |x: bool| vec![u8::from(x)];
    [
        part(&batch.global, n, slot, f),
        part(&batch.cards, n, slot, f),
        part(&batch.events, n, slot, f),
        part(&batch.event_cards, n, slot, i),
        part(&batch.events_len, n, slot, i),
        part(&batch.legal, n, slot, b),
        part(&batch.seat, n, slot, i),
        part(&batch.reward, n, slot, f),
        part(&batch.done, n, slot, b),
    ]
    .concat()
}

/// Same seed, same trajectory: whatever the thread count, and slot by slot
/// whatever the batch size.
#[test]
fn same_seeds_same_trajectories() {
    let run = |num_envs, threads| {
        let mut env = env(setup("varied", &[0, 1, 2, 3, 4, 5, 6], &[]), num_envs, 11, threads);
        let actions = env.spec().actions.len();
        let mut batches = vec![env.reset(None).unwrap()];
        for step in 0..150 {
            let chosen = choose(&batches[step], actions, step);
            batches.push(env.step(&chosen).unwrap());
        }
        batches
    };
    let (one, many) = (run(6, 1), run(6, 4));
    assert_eq!(one, many, "threads change nothing");
    assert!(one.iter().any(|b| b.done.iter().any(|&d| d)), "hands end on the way");

    // The choice depends on the slot only, so a smaller batch plays the
    // first slots' hands the same way.
    let small = run(3, 2);
    for (a, b) in small.iter().zip(&one) {
        for slot in 0..3 {
            assert_eq!(slot_bytes(a, slot), slot_bytes(b, slot));
        }
    }

    let mut other = env(setup("varied", &[0, 1, 2, 3, 4, 5, 6], &[]), 6, 12, 0);
    assert_ne!(other.reset(None).unwrap(), one[0], "another seed, other hands");
}

/// Each slot's row is the encoding of its hand's view for the seat to act,
/// and the reward of a finished hand is its payoffs.
#[test]
fn rows_are_the_hands_encoded() {
    let mut env = env(setup("varied", &[0, 1, 2, 3, 4, 5, 6], &[]), 4, 3, 0);
    let spec = env.spec().clone();
    let (actions, g) = (spec.actions.len(), spec.global.len());
    let mut batch = env.reset(None).unwrap();
    let mut hands_ended = 0;
    for step in 0..400 {
        let targets = env.belief_targets().unwrap();
        for (slot, hand) in env.hands().enumerate() {
            let state = hand.state();
            let Turn::Seat(seat) = Mighty::turn(state) else {
                panic!("slot {slot} waits on the caller");
            };
            assert_eq!(batch.seat[slot], seat as i32);
            let obs = Mighty::encode(
                &Mighty::view(state, Viewer::Seat(seat)),
                &Mighty::legal_actions(state, seat),
            );
            spec.check(&obs).unwrap();
            assert_eq!(obs.global, batch.global[slot * g..(slot + 1) * g]);
            assert_eq!(obs.legal, batch.legal[slot * actions..(slot + 1) * actions]);
            assert_eq!(obs.events_len as i32, batch.events_len[slot]);
            let cards = spec.cards.len();
            assert_eq!(
                Mighty::belief_targets(state, seat),
                targets[slot * cards..(slot + 1) * cards]
            );
        }
        let chosen = choose(&batch, actions, step);
        batch = env.step(&chosen).unwrap();
        for slot in 0..4 {
            let reward = &batch.reward[slot * 8..(slot + 1) * 8];
            if batch.done[slot] {
                hands_ended += 1;
                assert_eq!(reward.iter().sum::<f32>(), 0.0, "Mighty is zero-sum");
            } else {
                assert!(reward.iter().all(|&r| r == 0.0), "rewards only when a hand ends");
            }
        }
    }
    assert!(hands_ended > 5, "only {hands_ended} hands ended");
}

/// With one seat controlled, bots play the others and only that seat is
/// ever asked; its hands' payoffs are reported for every seat.
#[test]
fn bots_play_the_seats_nobody_controls() {
    let mut env = env(setup("gshs", &[2], &["simple", "random", "보통", "초보"]), 3, 5, 0);
    let actions = env.spec().actions.len();
    let mut batch = env.reset(None).unwrap();
    let mut done = 0;
    for step in 0..120 {
        assert!(batch.seat.iter().all(|&s| s == 2));
        for hand in env.hands() {
            assert_eq!(hand.style(2), None);
            assert!((0..5).filter(|&s| s != 2).all(|s| hand.style(s).is_some()));
        }
        batch = env.step(&choose(&batch, actions, step)).unwrap();
        done += batch.done.iter().filter(|&&d| d).count();
    }
    assert!(done >= 3, "{done} hands done");
}

#[test]
fn illegal_actions_change_nothing() {
    let mut a = env(setup("default", &[0, 1, 2, 3, 4], &[]), 2, 9, 0);
    let mut b = env(setup("default", &[0, 1, 2, 3, 4], &[]), 2, 9, 0);
    let actions = a.spec().actions.len();
    let batch = a.reset(None).unwrap();
    b.reset(None).unwrap();
    let illegal = (0..actions).find(|&i| !legal(&batch, actions, 1).contains(&i)).unwrap();
    let mut chosen = choose(&batch, actions, 0);
    let good = chosen.clone();
    chosen[1] = illegal;
    assert_eq!(
        a.step(&chosen),
        Err(Error::IllegalAction {
            slot: 1,
            index: illegal
        })
    );
    assert!(
        matches!(a.step(&good[..1]), Err(Error::Config(_))),
        "one action per slot"
    );
    assert_eq!(a.step(&good).unwrap(), b.step(&good).unwrap());
}

#[test]
fn step_needs_a_reset() {
    let mut env = env(setup("default", &[0], &["simple"]), 1, 0, 1);
    assert_eq!(env.step(&[0]), Err(Error::NotReset));
    assert_eq!(env.belief_targets(), Err(Error::NotReset));
}

#[test]
fn reset_with_a_seed_starts_over() {
    let mut env = env(setup("varied", &[0, 1, 2, 3, 4, 5, 6], &[]), 3, 21, 0);
    let actions = env.spec().actions.len();
    let first = env.reset(None).unwrap();
    env.step(&choose(&first, actions, 0)).unwrap();
    assert_ne!(env.reset(None).unwrap(), first, "the next hands");
    assert_eq!(env.reset(Some(21)).unwrap(), first, "the first hands again");
}

#[test]
fn seats_without_a_bot_are_refused() {
    let setup = setup("default", &[0], &[]);
    let config = env::Config {
        num_envs: 1,
        seed: 0,
        reward_scale: 1.0,
        threads: 1,
    };
    assert!(matches!(env::Env::new(setup, config), Err(Error::Bot(_))));
}

/// Rewards scale with the setting; seats a table lacks get none.
#[test]
fn rewards_are_scaled_payoffs() {
    let run = |scale| {
        let config = env::Config {
            num_envs: 2,
            seed: 4,
            reward_scale: scale,
            threads: 0,
        };
        let mut env = env::Env::new(setup("gshs/4", &[0, 1, 2, 3], &[]), config).unwrap();
        let actions = env.spec().actions.len();
        let mut batch = env.reset(None).unwrap();
        let mut rewards = Vec::new();
        for step in 0..200 {
            batch = env.step(&choose(&batch, actions, step)).unwrap();
            rewards.extend_from_slice(&batch.reward);
        }
        rewards
    };
    let (raw, scaled) = (run(1.0), run(0.1));
    assert!(raw.iter().any(|&r| r != 0.0));
    for (r, s) in raw.iter().zip(&scaled) {
        assert_eq!(r * 0.1, *s);
    }
    for seats in raw.chunks(8) {
        assert!(seats[4..].iter().all(|&r| r == 0.0), "four players");
    }
}
