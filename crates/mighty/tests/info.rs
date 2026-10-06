//! Mighty as the platform names it (`engine::GameInfo`): its presets, its
//! rule checks, and JSON for every value that crosses a wire or a file.

use engine::{Game, GameInfo, Viewer};
use mighty::rules::{Preset, Rules};
use mighty::{Action, Mighty, Options, View, testing};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::fmt::Debug;

fn round_trip<T: Serialize + DeserializeOwned + PartialEq + Debug>(value: &T) {
    let json = serde_json::to_value(value).unwrap();
    assert_eq!(&serde_json::from_value::<T>(json).unwrap(), value);
}

#[test]
fn presets_are_every_preset_in_order_and_playable() {
    assert_eq!((Mighty::ID, Mighty::NAME), ("mighty", "마이티"));
    let presets = Mighty::presets();
    assert_eq!(presets.len(), Preset::ALL.len());
    for (info, preset) in presets.iter().zip(Preset::ALL) {
        assert_eq!((info.id, info.name), (preset.name(), preset.title()));
        assert_eq!(info.rules, preset.rules());
        assert_eq!(Mighty::validate(&info.rules), Ok(()));
        assert_eq!(Mighty::seats(&info.rules), info.rules.players);
        round_trip(&info.rules);
    }
    assert_eq!(engine::info::preset::<Mighty>("gshs"), Some(Preset::Gshs.rules()));
    assert_eq!(engine::info::preset::<Mighty>("nope"), None);
    let mut broken = Rules::web_mighty();
    broken.hand_size = 0;
    assert!(Mighty::validate(&broken).is_err());
}

/// Every option set, action and view of random hands reads back from JSON
/// as it was.
#[test]
fn hands_cross_json_unchanged() {
    let mut rng = ChaCha8Rng::seed_from_u64(3);
    for preset in Preset::ALL {
        let options = Options {
            rules: preset.rules().varied(&mut rng),
            first_bidder: 0,
        };
        round_trip(&options);
        testing::play_hand(&options, &mut rng, &mut testing::random, &mut |state, seat| {
            for action in Mighty::legal_actions(state, seat) {
                round_trip::<Action>(&action);
            }
            for viewer in (0..Mighty::seat_count(state))
                .map(Viewer::Seat)
                .chain([Viewer::Spectator])
            {
                round_trip::<View>(&Mighty::view(state, viewer));
            }
            true
        });
    }
}
