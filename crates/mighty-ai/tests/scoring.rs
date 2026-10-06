//! Whole hands played by the simple bot, scored as the rules say.

use engine::{Game, Viewer};
use mighty::rules::Preset;
use mighty::{FriendCall, Mighty, PhaseView, testing};
use mighty_ai::SimpleBot;
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;

/// 경기과고 hands played out by the simple bot pay what 실패 배상 says
/// (RULES.md): made, P − 10 (at least 1); failed, (C − 10) + (C − P),
/// doubled when the side took 10 or fewer; no-trump, playing openly
/// alone and a run double a win only.
#[test]
fn gshs_hands_pay_back_failed_contracts() {
    let rules = Preset::Gshs.rules();
    let (mut made, mut failed) = (0, 0);
    for seed in 0..60 {
        let mut rng = ChaCha8Rng::seed_from_u64(seed);
        let mut simple = testing::by(SimpleBot::default());
        let state = testing::play_hand(&testing::options(&rules, seed), &mut rng, &mut simple, &mut |_, _| true);
        let PhaseView::Done {
            declarer,
            contract,
            call,
            friend,
            team_points,
            payoffs,
            ..
        } = Mighty::view(&state, Viewer::Seat(0)).phase
        else {
            continue;
        };
        let (c, p) = (i64::from(contract.count), i64::from(team_points));
        let value = if p >= c {
            made += 1;
            let doubles = [contract.trump.is_none(), call == FriendCall::Alone, p == 20];
            (p - 10).max(1) * 2_i64.pow(doubles.iter().filter(|d| **d).count() as u32)
        } else {
            failed += 1;
            -((c - 10) + (c - p)) * if p <= 10 { 2 } else { 1 }
        };
        let defenders = (0..5).filter(|&s| s != declarer && Some(s) != friend);
        let share = if friend.is_some() { value } else { 0 };
        let mut expected = vec![-value; 5];
        expected[declarer] = value * defenders.count() as i64 - share;
        if let Some(friend) = friend {
            expected[friend] = value;
        }
        assert_eq!(payoffs, expected, "seed {seed}: {contract:?}, {team_points} points");
    }
    assert!(made > 5 && failed > 5, "{made} made, {failed} failed");
}
