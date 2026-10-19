use super::*;
use engine::{HandReport, Table};
use rand::{SeedableRng, rngs::StdRng};

fn state(stacks: &[u16]) -> PokerState {
    let mut s = Poker::new_game(&PokerOptions {
        rules: PokerRules {
            players: stacks.len(),
            starting_stack: 100,
        },
        dealer: 0,
        starting_stacks: stacks.to_vec(),
    })
    .unwrap();
    Poker::apply_chance(
        &mut s,
        PokerAction::Deal {
            deck: (0..52).collect(),
        },
    )
    .unwrap();
    s
}
fn play(s: &mut PokerState, action: PokerAction) {
    let Turn::Seat(seat) = Poker::turn(s) else {
        panic!("not betting")
    };
    Poker::apply(s, seat, action).unwrap();
    Poker::check_invariants(s).unwrap();
}
fn runout(s: &mut PokerState) {
    for _ in 0..100 {
        match Poker::turn(s) {
            Turn::Chance => Poker::apply_chance(s, PokerAction::Reveal).unwrap(),
            Turn::Seat(_) => {
                let a = Poker::legal_actions(s, s.actor.unwrap());
                play(
                    s,
                    a.iter()
                        .find(|a| matches!(a, PokerAction::Check | PokerAction::Call))
                        .unwrap()
                        .clone(),
                )
            }
            Turn::Over => return,
        }
        Poker::check_invariants(s).unwrap();
    }
    panic!("hand did not end")
}
fn cards(text: &str) -> Vec<PokerCard> {
    text.split_whitespace()
        .map(|s| {
            let rank = match &s[..1] {
                "A" => 14,
                "K" => 13,
                "Q" => 12,
                "J" => 11,
                "T" => 10,
                r => r.parse().unwrap(),
            };
            let suit = match &s[1..] {
                "c" => PokerSuit::Clubs,
                "d" => PokerSuit::Diamonds,
                "h" => PokerSuit::Hearts,
                "s" => PokerSuit::Spades,
                _ => panic!(),
            };
            PokerCard { rank, suit }
        })
        .collect()
}

#[test]
fn ranking_wheel_kickers_full_houses_and_best_five() {
    use PokerHandCategory::*;
    assert_eq!(
        rank(&cards("Ac 2d 3h 4s 5c Kc Qc")).unwrap(),
        PokerHandRank {
            category: Straight,
            kickers: vec![5]
        }
    );
    assert!(rank(&cards("2c 3c 4c 5c 6c Ad Ah")).unwrap() > rank(&cards("As Ac Ad Ah Kc Qc Jc")).unwrap());
    assert_eq!(
        rank(&cards("Ac Ad Ah Kc Kd Kh 2c")).unwrap(),
        PokerHandRank {
            category: FullHouse,
            kickers: vec![14, 13]
        }
    );
    assert!(rank(&cards("Ac Ad Kc Qc Jc 3d 2d")).unwrap() > rank(&cards("Ah As Kd Qd Tc 3h 2h")).unwrap());
    assert_eq!(
        rank(&cards("Ac Kd Qh Js Tc 2d 3h")).unwrap(),
        rank(&cards("Ad Kh Qs Jc Td 4d 5h")).unwrap()
    );
    assert_eq!(rank(&cards("Ac Ac Qh Js Tc")).unwrap_err(), PokerError::Cards);
}
#[test]
fn all_integer_raises_are_offered_and_errors_are_atomic() {
    let mut s = state(&[200, 200, 200]);
    let legal = Poker::legal_actions(&s, 0);
    let raises: Vec<_> = legal
        .iter()
        .filter_map(|a| {
            if let PokerAction::RaiseTo { amount } = a {
                Some(*amount)
            } else {
                None
            }
        })
        .collect();
    assert_eq!(raises, (4..=200).collect::<Vec<_>>());
    let before = s.clone();
    assert!(Poker::apply(&mut s, 0, PokerAction::RaiseTo { amount: 3 }).is_err());
    assert_eq!(s, before);
    assert!(Poker::apply(&mut s, 1, PokerAction::Call).is_err());
    assert_eq!(s, before);
    assert!(Poker::apply_chance(&mut s, PokerAction::Reveal).is_err());
    assert_eq!(s, before);
    let mut initial = Poker::new_game(&PokerOptions::default()).unwrap();
    let before = initial.clone();
    assert!(Poker::apply_chance(&mut initial, PokerAction::Deal { deck: vec![0; 52] }).is_err());
    assert_eq!(initial, before);
    assert!(
        Poker::new_game(&PokerOptions {
            rules: PokerRules {
                players: 2,
                starting_stack: 100
            },
            ..PokerOptions::default()
        })
        .is_err()
    );
    assert!(
        Poker::new_game(&PokerOptions {
            starting_stacks: vec![201; 3],
            ..PokerOptions::default()
        })
        .is_err()
    );
}
#[test]
fn blind_option_rounds_burns_and_dealer_rotation() {
    let mut s = state(&[100; 3]);
    assert_eq!(s.actor, Some(0));
    play(&mut s, PokerAction::Call);
    play(&mut s, PokerAction::Call);
    assert_eq!(s.actor, Some(2));
    assert!(Poker::legal_actions(&s, 2).contains(&PokerAction::RaiseTo { amount: 4 }));
    play(&mut s, PokerAction::Check);
    assert_eq!(Poker::turn(&s), Turn::Chance);
    Poker::apply_chance(&mut s, PokerAction::Reveal).unwrap();
    assert_eq!(s.actor, Some(1));
    assert_eq!(s.board, vec![7, 8, 9]);
    assert_eq!(s.burns, vec![6]);
    runout(&mut s);
    assert_eq!(s.board, vec![7, 8, 9, 11, 13]);
    assert_eq!(s.burns, vec![6, 10, 12]);
    assert_eq!(Poker::payoffs(&s).unwrap().iter().sum::<i64>(), 0);
    let settings = PokerSettings::default();
    assert_eq!(
        (0..6)
            .map(|hand| Poker::hand_options(&settings, hand, None, 0).dealer)
            .collect::<Vec<_>>(),
        [0, 1, 2, 0, 1, 2]
    );
}
#[test]
fn folds_refund_uncalled_chips_and_do_not_reveal() {
    let mut s = state(&[100; 3]);
    play(&mut s, PokerAction::RaiseTo { amount: 50 });
    play(&mut s, PokerAction::Fold);
    play(&mut s, PokerAction::Fold);
    assert_eq!(s.refunds, [48, 0, 0]);
    assert_eq!(s.pots[0].amount, 5);
    assert_eq!(Poker::payoffs(&s), Some(vec![3, -1, -2]));
    assert!(!s.showdown);
    assert!(
        Poker::view(&s, Viewer::Spectator)
            .players
            .iter()
            .all(|p| p.hole.is_none())
    );
}
#[test]
fn short_all_in_requires_calls_but_does_not_reopen_a_prior_caller() {
    // Dealer acts first: raise to 10, SB calls 10, BB's 13 is short of 18.
    let mut s = state(&[100, 100, 13]);
    play(&mut s, PokerAction::RaiseTo { amount: 10 });
    play(&mut s, PokerAction::Call);
    play(&mut s, PokerAction::AllIn);
    assert_eq!(s.actor, Some(0));
    assert!(
        !Poker::legal_actions(&s, 0)
            .iter()
            .any(|a| matches!(a, PokerAction::RaiseTo { .. } | PokerAction::AllIn))
    );
    play(&mut s, PokerAction::Call);
    assert_eq!(s.actor, Some(1));
    assert!(
        !Poker::legal_actions(&s, 1)
            .iter()
            .any(|a| matches!(a, PokerAction::RaiseTo { .. } | PokerAction::AllIn))
    );
    play(&mut s, PokerAction::Call);
    assert_eq!(Poker::turn(&s), Turn::Chance);
    runout(&mut s);
}
#[test]
fn cumulative_short_all_ins_reopen_only_after_a_full_raise_is_faced() {
    let mut s = state(&[100, 100, 13, 18]);
    assert_eq!(s.actor, Some(3));
    play(&mut s, PokerAction::Call); // seat3 has not gone all-in yet.
    play(&mut s, PokerAction::RaiseTo { amount: 10 }); // seat0 full raise +8
    play(&mut s, PokerAction::Call); // seat1 acted at10
    play(&mut s, PokerAction::AllIn); // seat2 to13, short +3
    play(&mut s, PokerAction::AllIn); // seat3 to18, short +5 cumulatively +8
    assert_eq!(s.actor, Some(0));
    assert!(Poker::legal_actions(&s, 0).contains(&PokerAction::RaiseTo { amount: 26 }));
}
#[test]
fn no_dry_side_pot_raises_and_short_blinds_run_out() {
    let mut s = state(&[100, 1, 2]);
    assert_eq!(s.actor, Some(0));
    let legal = Poker::legal_actions(&s, 0);
    assert_eq!(legal, vec![PokerAction::Fold, PokerAction::Call]);
    play(&mut s, PokerAction::Call);
    assert_eq!(Poker::turn(&s), Turn::Chance);
    runout(&mut s);
    let mut s = state(&[1, 1, 1]);
    runout(&mut s);
    assert_eq!(s.board.len(), 5);
    Poker::check_invariants(&s).unwrap();
}
#[test]
fn side_pots_include_folded_money_and_odd_chips_start_left_of_button() {
    // Synthetic completed board isolates payout arithmetic. All live hands tie by board.
    let mut s = state(&[100; 3]);
    s.board = vec![6, 7, 8, 9, 10]; // 8c..Qc straight flush on board
    for (p, total) in s.players.iter_mut().zip([10, 20, 20]) {
        p.total = total;
        p.bet = total;
        p.stack = p.initial - total;
        p.folded = false;
    }
    s.showdown();
    assert_eq!(s.pots.iter().map(|p| p.amount).collect::<Vec<_>>(), vec![30, 20]);
    assert_eq!(
        s.players.iter().map(|p| p.stack).collect::<Vec<_>>(),
        vec![100, 100, 100]
    );
    let mut s = state(&[100; 3]);
    s.board = vec![6, 7, 8, 9, 10];
    for p in &mut s.players {
        p.total = 3;
        p.bet = 3;
        p.stack = 97;
    }
    s.players[0].folded = true;
    s.showdown();
    assert_eq!(s.pots[0].winners, vec![1, 2]);
    assert_eq!(
        s.players.iter().map(|p| p.stack).collect::<Vec<_>>(),
        vec![97, 102, 101]
    );
    assert_eq!(Poker::payoffs(&s).unwrap().iter().sum::<i64>(), 0);
}
#[test]
fn side_pot_all_in_runout_conserves_chips() {
    let mut s = state(&[20, 50, 100]);
    play(&mut s, PokerAction::AllIn);
    play(&mut s, PokerAction::AllIn);
    assert_eq!(Poker::legal_actions(&s, 2), vec![PokerAction::Fold, PokerAction::Call]);
    play(&mut s, PokerAction::Call);
    runout(&mut s);
    assert_eq!(s.pots.iter().map(|p| p.amount).collect::<Vec<_>>(), vec![60, 60]);
    assert_eq!(s.players.iter().map(|p| p.stack).sum::<u16>(), 170);
}
#[test]
fn replay_and_hidden_reshuffle_preserve_each_authorized_view() {
    for seed in 0..30 {
        let mut rng = StdRng::seed_from_u64(seed);
        let options = PokerOptions::default();
        let mut s = Poker::new_game(&options).unwrap();
        let mut log = Vec::new();
        for _ in 0..100 {
            Poker::check_invariants(&s).unwrap();
            for viewer in [Viewer::Spectator, Viewer::Seat(0), Viewer::Seat(1), Viewer::Seat(2)] {
                assert_eq!(
                    Poker::view(&s, viewer),
                    Poker::view(&Poker::reshuffle_hidden(&s, viewer, &mut rng), viewer)
                );
            }
            match Poker::turn(&s) {
                Turn::Over => break,
                Turn::Chance => {
                    let a = Poker::sample_chance(&s, &mut rng);
                    log.push((None, a.clone()));
                    Poker::apply_chance(&mut s, a).unwrap();
                }
                Turn::Seat(seat) => {
                    let legal = Poker::legal_actions(&s, seat);
                    let a = legal[(rng.next_u64() as usize) % legal.len()].clone();
                    log.push((Some(seat), a.clone()));
                    Poker::apply(&mut s, seat, a).unwrap();
                }
            }
        }
        assert!(s.over);
        let mut replay = Poker::new_game(&options).unwrap();
        for (seat, a) in log {
            if let Some(seat) = seat {
                Poker::apply(&mut replay, seat, a).unwrap()
            } else {
                Poker::apply_chance(&mut replay, a).unwrap()
            }
        }
        assert_eq!(s, replay);
        assert_eq!(Poker::payoffs(&s).unwrap().iter().sum::<i64>(), 0);
        let public = serde_json::to_value(Poker::view(&s, Viewer::Spectator)).unwrap();
        assert!(public.get("deck").is_none());
        assert!(public.get("burns").is_none());
        assert!(Poker::summary(&s).is_some());
    }
}

fn set_showdown_cards(s: &mut PokerState, hands: &[&str], board: &str) {
    let mut assigned = Vec::new();
    for (seat, hand) in hands.iter().enumerate() {
        for (position, card) in s.holes[seat].iter().zip(cards(hand)) {
            assigned.push((*position, card.id().unwrap()));
        }
    }
    s.board = vec![
        s.holes.len() * 2 + 1,
        s.holes.len() * 2 + 2,
        s.holes.len() * 2 + 3,
        s.holes.len() * 2 + 5,
        s.holes.len() * 2 + 7,
    ];
    for (position, card) in s.board.iter().zip(cards(board)) {
        assigned.push((*position, card.id().unwrap()));
    }
    let mut remaining = (0..52).filter(|card| !assigned.iter().any(|(_, used)| used == card));
    for position in 0..52 {
        s.deck[position] = assigned
            .iter()
            .find(|(index, _)| *index == position)
            .map(|(_, card)| *card)
            .unwrap_or_else(|| remaining.next().unwrap());
    }
}
#[test]
fn different_side_pot_winners_and_folded_best_hand_are_paid_correctly() {
    let mut s = state(&[20, 50, 100]);
    set_showdown_cards(&mut s, &["Ah Ad", "Kh Kd", "Qh Qd"], "2c 3d 7h 8s 9c");
    for (p, total) in s.players.iter_mut().zip([20, 50, 50]) {
        p.total = total;
        p.bet = total;
        p.stack = p.initial - total;
    }
    s.showdown();
    assert_eq!(
        s.pots,
        vec![
            PokerPot {
                amount: 60,
                winners: vec![0]
            },
            PokerPot {
                amount: 60,
                winners: vec![1]
            }
        ]
    );
    assert_eq!(s.players.iter().map(|p| p.stack).collect::<Vec<_>>(), vec![60, 60, 50]);
    let mut s = state(&[100; 3]);
    set_showdown_cards(&mut s, &["Ah Ad", "Kh Kd", "Qh Qd"], "2c 3d 7h 8s 9c");
    for (p, total) in s.players.iter_mut().zip([20, 50, 50]) {
        p.total = total;
        p.bet = total;
        p.stack = p.initial - total;
    }
    s.players[0].folded = true;
    s.showdown();
    assert_eq!(s.players.iter().map(|p| p.stack).collect::<Vec<_>>(), vec![80, 170, 50]);
    let spectator = Poker::view(&s, Viewer::Spectator);
    assert!(spectator.players[0].hole.is_none());
    assert!(spectator.players[1].shown);
    assert!(spectator.players[2].shown);
}
#[test]
fn unmatched_all_in_excess_is_returned_before_runout() {
    let mut s = state(&[100, 50, 20]);
    play(&mut s, PokerAction::AllIn);
    play(&mut s, PokerAction::AllIn);
    play(&mut s, PokerAction::AllIn);
    assert_eq!(s.refunds, vec![50, 0, 0]);
    assert_eq!(s.players.iter().map(|p| p.total).collect::<Vec<_>>(), vec![50, 50, 20]);
    runout(&mut s);
    assert_eq!(s.pots.iter().map(|p| p.amount).sum::<u16>(), 120);
    assert_eq!(Poker::payoffs(&s).unwrap().iter().sum::<i64>(), 0);
}
#[test]
fn random_bounded_stacks_three_to_six_seats_finish_and_conserve_every_chip() {
    for players in 3..=6 {
        for seed in 0..100 {
            let mut rng = StdRng::seed_from_u64(1000 * players as u64 + seed);
            let stacks = (0..players).map(|_| 1 + (rng.next_u32() % 200) as u16).collect();
            let mut s = Poker::new_game(&PokerOptions {
                rules: PokerRules {
                    players,
                    starting_stack: 100,
                },
                dealer: seed as usize % players,
                starting_stacks: stacks,
            })
            .unwrap();
            for _ in 0..300 {
                Poker::check_invariants(&s).unwrap();
                match Poker::turn(&s) {
                    Turn::Over => break,
                    Turn::Chance => {
                        let a = Poker::sample_chance(&s, &mut rng);
                        Poker::apply_chance(&mut s, a).unwrap();
                    }
                    Turn::Seat(seat) => {
                        let legal = Poker::legal_actions(&s, seat);
                        assert!(!legal.is_empty());
                        let action = legal[rng.next_u32() as usize % legal.len()].clone();
                        Poker::apply(&mut s, seat, action).unwrap();
                    }
                }
            }
            assert!(s.over, "players={players} seed={seed}");
            Poker::check_invariants(&s).unwrap();
            assert_eq!(Poker::payoffs(&s).unwrap().iter().sum::<i64>(), 0);
        }
    }
}

#[test]
fn checked_player_cannot_raise_a_short_opening_all_in_but_unacted_player_can() {
    // TDA rule49: a check is an action; a short opening bet does not reopen it.
    let mut s = state(&[100, 100, 3]);
    play(&mut s, PokerAction::Call);
    play(&mut s, PokerAction::Call);
    play(&mut s, PokerAction::Check);
    Poker::apply_chance(&mut s, PokerAction::Reveal).unwrap();
    play(&mut s, PokerAction::Check); // seat1 checks before the opening bet.
    play(&mut s, PokerAction::AllIn); // seat2 has one chip left, below BB2.
    assert_eq!(s.actor, Some(0));
    assert!(Poker::legal_actions(&s, 0).contains(&PokerAction::RaiseTo { amount: 3 }));
    let mut full = s.clone();
    play(&mut full, PokerAction::RaiseTo { amount: 3 });
    assert!(Poker::legal_actions(&full, 1).contains(&PokerAction::RaiseTo { amount: 5 }));
    play(&mut s, PokerAction::Call);
    assert_eq!(s.actor, Some(1));
    assert_eq!(Poker::legal_actions(&s, 1), vec![PokerAction::Fold, PokerAction::Call]);
}

#[test]
fn two_deep_players_may_create_a_side_pot_and_short_raise_minimum_is_an_offered_amount() {
    let mut s = state(&[100, 100, 2]);
    play(&mut s, PokerAction::Call);
    play(&mut s, PokerAction::Call);
    Poker::apply_chance(&mut s, PokerAction::Reveal).unwrap();
    assert_eq!(s.actor, Some(1));
    assert!(Poker::legal_actions(&s, 1).contains(&PokerAction::RaiseTo { amount: 2 }));
    play(&mut s, PokerAction::RaiseTo { amount: 2 });
    play(&mut s, PokerAction::Call);
    runout(&mut s);
    assert!(s.pots.len() >= 2);
    let s = state(&[3, 100, 100]);
    assert_eq!(Poker::view(&s, Viewer::Seat(0)).min_raise_to, Some(3));
    assert_eq!(
        Poker::notes(&s, Some(0), &Poker::legal_actions(&s, 0)).min_raise_to,
        Some(3)
    );
    assert!(Poker::legal_actions(&s, 0).contains(&PokerAction::RaiseTo { amount: 3 }));
}

#[test]
fn all_in_hands_are_tabled_before_runout_but_folded_hands_and_future_board_stay_private() {
    let mut s = state(&[20, 50, 100, 100]);
    play(&mut s, PokerAction::Fold); // seat3 has folded; its cards stay hidden.
    play(&mut s, PokerAction::AllIn); // seat0 to20.
    play(&mut s, PokerAction::AllIn); // seat1 to50, seat2 still owes a decision.
    assert!(
        Poker::view(&s, Viewer::Spectator)
            .players
            .iter()
            .all(|p| !p.shown && p.hole.is_none())
    );
    play(&mut s, PokerAction::Call);
    assert_eq!(Poker::turn(&s), Turn::Chance);
    assert!(!s.over && !s.showdown, "tabling hands does not settle the hand");
    assert!(s.pots.is_empty());
    assert_eq!(Poker::payoffs(&s), None);
    let mut rng = StdRng::seed_from_u64(91);
    for visible_board in [0, 3, 4] {
        let view = Poker::view(&s, Viewer::Spectator);
        assert_eq!(view.board.len(), visible_board);
        assert_eq!(view.pot, 120);
        assert!(
            view.players[..3]
                .iter()
                .all(|p| p.shown && p.hole.as_ref().is_some_and(|cards| cards.len() == 2))
        );
        assert!(!view.players[3].shown);
        assert!(view.players[3].hole.is_none());
        assert_eq!(view.players[3].hole_count, 2);
        assert!(!view.over && !view.showdown);
        assert!(view.pots.is_empty());
        assert_eq!(
            view,
            Poker::view(
                &Poker::reshuffle_hidden(&s, Viewer::Spectator, &mut rng),
                Viewer::Spectator
            ),
            "tabled hands cannot be resampled as hidden cards"
        );
        let json = serde_json::to_value(&view).unwrap();
        assert!(json.get("deck").is_none() && json.get("burns").is_none());
        Poker::apply_chance(&mut s, PokerAction::Reveal).unwrap();
        Poker::check_invariants(&s).unwrap();
    }
    assert!(s.over && s.showdown);
    assert_eq!(Poker::view(&s, Viewer::Spectator).board.len(), 5);
    assert!(Poker::view(&s, Viewer::Spectator).players[3].hole.is_none());
    assert_eq!(Poker::payoffs(&s).unwrap().iter().sum::<i64>(), 0);
}

#[test]
fn one_all_in_does_not_table_hands_when_two_players_can_still_bet() {
    let mut s = state(&[100, 100, 2]);
    play(&mut s, PokerAction::Call);
    play(&mut s, PokerAction::Call);
    assert_eq!(Poker::turn(&s), Turn::Chance);
    assert!(
        Poker::view(&s, Viewer::Spectator)
            .players
            .iter()
            .all(|p| !p.shown && p.hole.is_none())
    );
    Poker::apply_chance(&mut s, PokerAction::Reveal).unwrap();
    assert!(matches!(Poker::turn(&s), Turn::Seat(_)));
    assert!(
        Poker::view(&s, Viewer::Spectator)
            .players
            .iter()
            .all(|p| !p.shown && p.hole.is_none())
    );
}
