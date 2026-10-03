use engine::{Bot, RandomBot};
use mighty::bot::SimpleBot;
use mighty::rules::Preset;
use mighty::{Mighty, Options};
use sim::Checks;

fn run(preset: Preset, games: u64, bot: fn(usize) -> Box<dyn Bot<Mighty>>) {
    let rules = preset.rules();
    for seed in 0..games {
        let options = Options {
            rules: rules.clone(),
            first_bidder: seed as usize % rules.players,
        };
        let mut bots: Vec<_> = (0..rules.players).map(bot).collect();
        if let Err(failure) = sim::play::<Mighty>(&options, &mut bots, seed, Checks::default()) {
            panic!("{preset}: {failure}");
        }
    }
}

#[test]
fn random_bots_keep_every_invariant() {
    for preset in Preset::ALL {
        run(preset, 100, |_| Box::new(RandomBot));
    }
}

#[test]
fn simple_bots_keep_every_invariant() {
    for preset in Preset::ALL {
        run(preset, 100, |_| Box::new(SimpleBot::default()));
    }
}
