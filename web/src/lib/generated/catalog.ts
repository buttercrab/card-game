// Generated from the server's Rust types (crates/server/src/codegen.rs).
// Do not edit: run `cargo run -p server -- --write-generated web/src/lib/generated`.

import type { Catalog } from './protocol';

export const CATALOG: Catalog = {
  "protocol": "5da433930134",
  "presets": [
    {
      "id": "default",
      "title": "기본",
      "rules": {
        "players": 5,
        "hand_size": 10,
        "deck": "OneJoker",
        "lowest_rank": 2,
        "extra_cards": [],
        "misdeal": {
          "point_value": 2,
          "joker_value": -2,
          "card_values": [
            [
              {
                "Normal": [
                  "Spade",
                  10
                ]
              },
              1
            ],
            [
              {
                "Normal": [
                  "Diamond",
                  10
                ]
              },
              1
            ],
            [
              {
                "Normal": [
                  "Heart",
                  10
                ]
              },
              1
            ],
            [
              {
                "Normal": [
                  "Club",
                  10
                ]
              },
              1
            ],
            [
              {
                "Normal": [
                  "Spade",
                  14
                ]
              },
              0
            ]
          ],
          "threshold": 1,
          "all_points": false,
          "after_bidding": false,
          "declarer": false,
          "ask_first": true,
          "caller_deals": true
        },
        "bidding": {
          "min": 14,
          "max": 20,
          "allow_no_trump": true,
          "no_trump_bonus": 1,
          "no_trump_wins_ties": false,
          "first_bidder_may_pass": true,
          "change_trump_cost": 2,
          "change_to_no_trump_cost": null,
          "pass_is_final": true,
          "last_chance_min": 13,
          "raise_on_exchange": true
        },
        "friend": {
          "by_card": true,
          "by_seat": true,
          "first_trick": true,
          "last_trick": false,
          "fake": true,
          "alone": true
        },
        "policy": {
          "mighty": {
            "first": "Valid",
            "last": "Valid"
          },
          "trump": {
            "first": "NoLead",
            "last": "Valid"
          },
          "joker": {
            "first": "NoEffect",
            "last": "NoEffect"
          },
          "joker_call": {
            "first": "NoEffect",
            "last": "NoEffect"
          },
          "overrides": [],
          "release_with_mighty": false
        },
        "joker_call": {
          "calls": [
            [
              {
                "Normal": [
                  "Club",
                  3
                ]
              },
              {
                "Normal": [
                  "Spade",
                  3
                ]
              }
            ]
          ],
          "mighty_defense": true,
          "called_joker_has_power": false
        },
        "joker_lead": {
          "by_color": false,
          "powerless_passes": false,
          "not_first_trick": true
        },
        "scoring": {
          "win": {
            "BothOver": 13
          },
          "lose": "Shortfall",
          "no_trump": "Always",
          "alone": "Always",
          "run": true,
          "back_run": {
            "TeamAtMost": 10
          },
          "full_contract": "Always",
          "discards_to_declarer": true
        },
        "reveal_discards": false,
        "next_dealer": "FriendOrDeclarer"
      }
    },
    {
      "id": "gshs",
      "title": "경기과고",
      "note": "조커 두 장",
      "rules": {
        "players": 5,
        "hand_size": 10,
        "deck": "TwoJokers",
        "lowest_rank": 2,
        "extra_cards": [],
        "misdeal": {
          "point_value": 2,
          "joker_value": -1,
          "card_values": [
            [
              {
                "Normal": [
                  "Spade",
                  14
                ]
              },
              -2
            ]
          ],
          "threshold": 2,
          "all_points": false,
          "after_bidding": false,
          "declarer": false,
          "ask_first": false,
          "caller_deals": false
        },
        "bidding": {
          "min": 14,
          "max": 20,
          "allow_no_trump": true,
          "no_trump_bonus": 1,
          "no_trump_wins_ties": false,
          "first_bidder_may_pass": true,
          "change_trump_cost": 2,
          "change_to_no_trump_cost": null,
          "pass_is_final": true,
          "last_chance_min": null,
          "raise_on_exchange": false
        },
        "friend": {
          "by_card": true,
          "by_seat": true,
          "first_trick": true,
          "last_trick": true,
          "fake": true,
          "alone": true
        },
        "policy": {
          "mighty": {
            "first": "Valid",
            "last": "Valid"
          },
          "trump": {
            "first": "NoLead",
            "last": "Valid"
          },
          "joker": {
            "first": "NoEffect",
            "last": "NoEffect"
          },
          "joker_call": {
            "first": "Valid",
            "last": "Valid"
          },
          "overrides": [],
          "release_with_mighty": true
        },
        "joker_call": {
          "calls": [
            [
              {
                "Normal": [
                  "Club",
                  3
                ]
              },
              {
                "Normal": [
                  "Spade",
                  3
                ]
              }
            ],
            [
              {
                "Normal": [
                  "Heart",
                  3
                ]
              },
              {
                "Normal": [
                  "Diamond",
                  3
                ]
              }
            ]
          ],
          "mighty_defense": true,
          "called_joker_has_power": false
        },
        "joker_lead": {
          "by_color": true,
          "powerless_passes": true,
          "not_first_trick": false
        },
        "scoring": {
          "win": "OverTen",
          "lose": {
            "PaysBack": 10
          },
          "no_trump": "Win",
          "alone": "Win",
          "run": true,
          "back_run": {
            "TeamAtMost": 10
          },
          "full_contract": "Never",
          "discards_to_declarer": true
        },
        "reveal_discards": true,
        "next_dealer": "Rotate"
      }
    },
    {
      "id": "ddshs",
      "title": "대전동신과고",
      "rules": {
        "players": 5,
        "hand_size": 10,
        "deck": "OneJoker",
        "lowest_rank": 2,
        "extra_cards": [],
        "misdeal": {
          "point_value": 1,
          "joker_value": 0,
          "card_values": [],
          "threshold": 0,
          "all_points": false,
          "after_bidding": false,
          "declarer": false,
          "ask_first": false,
          "caller_deals": false
        },
        "bidding": {
          "min": 13,
          "max": 20,
          "allow_no_trump": false,
          "no_trump_bonus": 0,
          "no_trump_wins_ties": true,
          "first_bidder_may_pass": true,
          "change_trump_cost": 1,
          "change_to_no_trump_cost": null,
          "pass_is_final": true,
          "last_chance_min": null,
          "raise_on_exchange": false
        },
        "friend": {
          "by_card": true,
          "by_seat": false,
          "first_trick": false,
          "last_trick": false,
          "fake": true,
          "alone": true
        },
        "policy": {
          "mighty": {
            "first": "Valid",
            "last": "Valid"
          },
          "trump": {
            "first": "NoLead",
            "last": "Valid"
          },
          "joker": {
            "first": "NoEffect",
            "last": "NoEffect"
          },
          "joker_call": {
            "first": "Valid",
            "last": "Valid"
          },
          "overrides": [],
          "release_with_mighty": true
        },
        "joker_call": {
          "calls": [
            [
              {
                "Normal": [
                  "Club",
                  3
                ]
              },
              {
                "Normal": [
                  "Club",
                  3
                ]
              }
            ]
          ],
          "mighty_defense": true,
          "called_joker_has_power": false
        },
        "joker_lead": {
          "by_color": false,
          "powerless_passes": false,
          "not_first_trick": false
        },
        "scoring": {
          "win": "OverTen",
          "lose": {
            "PaysBack": 10
          },
          "no_trump": "Win",
          "alone": "Win",
          "run": true,
          "back_run": {
            "TeamAtMost": 10
          },
          "full_contract": "Never",
          "discards_to_declarer": true
        },
        "reveal_discards": true,
        "next_dealer": "Rotate"
      }
    },
    {
      "id": "dshs",
      "title": "대구과고",
      "rules": {
        "players": 5,
        "hand_size": 10,
        "deck": "OneJoker",
        "lowest_rank": 2,
        "extra_cards": [],
        "misdeal": {
          "point_value": 1,
          "joker_value": 0,
          "card_values": [],
          "threshold": 0,
          "all_points": false,
          "after_bidding": false,
          "declarer": false,
          "ask_first": false,
          "caller_deals": false
        },
        "bidding": {
          "min": 12,
          "max": 23,
          "allow_no_trump": true,
          "no_trump_bonus": 0,
          "no_trump_wins_ties": true,
          "first_bidder_may_pass": false,
          "change_trump_cost": 2,
          "change_to_no_trump_cost": null,
          "pass_is_final": true,
          "last_chance_min": null,
          "raise_on_exchange": false
        },
        "friend": {
          "by_card": true,
          "by_seat": true,
          "first_trick": true,
          "last_trick": true,
          "fake": true,
          "alone": true
        },
        "policy": {
          "mighty": {
            "first": "NoEffect",
            "last": "Valid"
          },
          "trump": {
            "first": "NoLead",
            "last": "Valid"
          },
          "joker": {
            "first": "NoEffect",
            "last": "NoEffect"
          },
          "joker_call": {
            "first": "Valid",
            "last": "Valid"
          },
          "overrides": [],
          "release_with_mighty": true
        },
        "joker_call": {
          "calls": [
            [
              {
                "Normal": [
                  "Club",
                  3
                ]
              },
              {
                "Normal": [
                  "Spade",
                  3
                ]
              }
            ]
          ],
          "mighty_defense": true,
          "called_joker_has_power": false
        },
        "joker_lead": {
          "by_color": false,
          "powerless_passes": false,
          "not_first_trick": false
        },
        "scoring": {
          "win": "OverTen",
          "lose": {
            "PaysBack": 10
          },
          "no_trump": "Win",
          "alone": "Win",
          "run": true,
          "back_run": {
            "TeamAtMost": 10
          },
          "full_contract": "Never",
          "discards_to_declarer": true
        },
        "reveal_discards": true,
        "next_dealer": "Rotate"
      }
    },
    {
      "id": "kmla",
      "title": "민사고",
      "rules": {
        "players": 5,
        "hand_size": 10,
        "deck": "OneJoker",
        "lowest_rank": 2,
        "extra_cards": [],
        "misdeal": {
          "point_value": 1,
          "joker_value": -1,
          "card_values": [],
          "threshold": 1,
          "all_points": false,
          "after_bidding": false,
          "declarer": false,
          "ask_first": false,
          "caller_deals": false
        },
        "bidding": {
          "min": 13,
          "max": 20,
          "allow_no_trump": true,
          "no_trump_bonus": 0,
          "no_trump_wins_ties": true,
          "first_bidder_may_pass": true,
          "change_trump_cost": 2,
          "change_to_no_trump_cost": null,
          "pass_is_final": true,
          "last_chance_min": null,
          "raise_on_exchange": false
        },
        "friend": {
          "by_card": true,
          "by_seat": true,
          "first_trick": true,
          "last_trick": true,
          "fake": true,
          "alone": true
        },
        "policy": {
          "mighty": {
            "first": "Valid",
            "last": "Valid"
          },
          "trump": {
            "first": "NoLead",
            "last": "Valid"
          },
          "joker": {
            "first": "NoEffect",
            "last": "NoEffect"
          },
          "joker_call": {
            "first": "Valid",
            "last": "Valid"
          },
          "overrides": [],
          "release_with_mighty": true
        },
        "joker_call": {
          "calls": [
            [
              {
                "Normal": [
                  "Club",
                  3
                ]
              },
              {
                "Normal": [
                  "Spade",
                  3
                ]
              }
            ]
          ],
          "mighty_defense": false,
          "called_joker_has_power": false
        },
        "joker_lead": {
          "by_color": false,
          "powerless_passes": false,
          "not_first_trick": false
        },
        "scoring": {
          "win": "OverTen",
          "lose": {
            "PaysBack": 10
          },
          "no_trump": "Win",
          "alone": "Win",
          "run": true,
          "back_run": {
            "TeamAtMost": 10
          },
          "full_contract": "Never",
          "discards_to_declarer": true
        },
        "reveal_discards": true,
        "next_dealer": "Rotate"
      }
    },
    {
      "id": "gsa",
      "title": "광주과고",
      "rules": {
        "players": 5,
        "hand_size": 10,
        "deck": "OneJoker",
        "lowest_rank": 2,
        "extra_cards": [],
        "misdeal": {
          "point_value": 1,
          "joker_value": 0,
          "card_values": [],
          "threshold": 0,
          "all_points": false,
          "after_bidding": false,
          "declarer": false,
          "ask_first": false,
          "caller_deals": false
        },
        "bidding": {
          "min": 12,
          "max": 20,
          "allow_no_trump": true,
          "no_trump_bonus": 0,
          "no_trump_wins_ties": true,
          "first_bidder_may_pass": true,
          "change_trump_cost": 2,
          "change_to_no_trump_cost": null,
          "pass_is_final": true,
          "last_chance_min": null,
          "raise_on_exchange": false
        },
        "friend": {
          "by_card": true,
          "by_seat": true,
          "first_trick": true,
          "last_trick": true,
          "fake": true,
          "alone": true
        },
        "policy": {
          "mighty": {
            "first": "NoEffect",
            "last": "Valid"
          },
          "trump": {
            "first": "NoLead",
            "last": "Valid"
          },
          "joker": {
            "first": "Valid",
            "last": "Valid"
          },
          "joker_call": {
            "first": "Valid",
            "last": "Valid"
          },
          "overrides": [],
          "release_with_mighty": true
        },
        "joker_call": {
          "calls": [
            [
              {
                "Normal": [
                  "Club",
                  3
                ]
              },
              {
                "Normal": [
                  "Spade",
                  3
                ]
              }
            ]
          ],
          "mighty_defense": true,
          "called_joker_has_power": false
        },
        "joker_lead": {
          "by_color": false,
          "powerless_passes": false,
          "not_first_trick": false
        },
        "scoring": {
          "win": "OverTen",
          "lose": {
            "PaysBack": 10
          },
          "no_trump": "Win",
          "alone": "Win",
          "run": true,
          "back_run": {
            "TeamAtMost": 10
          },
          "full_contract": "Never",
          "discards_to_declarer": true
        },
        "reveal_discards": true,
        "next_dealer": "Rotate"
      }
    },
    {
      "id": "skku",
      "title": "성균관대",
      "rules": {
        "players": 5,
        "hand_size": 10,
        "deck": "OneJoker",
        "lowest_rank": 2,
        "extra_cards": [],
        "misdeal": {
          "point_value": 1,
          "joker_value": 0,
          "card_values": [],
          "threshold": 0,
          "all_points": false,
          "after_bidding": false,
          "declarer": false,
          "ask_first": false,
          "caller_deals": false
        },
        "bidding": {
          "min": 12,
          "max": 20,
          "allow_no_trump": true,
          "no_trump_bonus": 0,
          "no_trump_wins_ties": true,
          "first_bidder_may_pass": true,
          "change_trump_cost": 0,
          "change_to_no_trump_cost": null,
          "pass_is_final": true,
          "last_chance_min": null,
          "raise_on_exchange": false
        },
        "friend": {
          "by_card": true,
          "by_seat": true,
          "first_trick": true,
          "last_trick": true,
          "fake": true,
          "alone": true
        },
        "policy": {
          "mighty": {
            "first": "Valid",
            "last": "Valid"
          },
          "trump": {
            "first": "Valid",
            "last": "Valid"
          },
          "joker": {
            "first": "Valid",
            "last": "Valid"
          },
          "joker_call": {
            "first": "Valid",
            "last": "Valid"
          },
          "overrides": [],
          "release_with_mighty": true
        },
        "joker_call": {
          "calls": [
            [
              {
                "Normal": [
                  "Club",
                  3
                ]
              },
              {
                "Normal": [
                  "Spade",
                  3
                ]
              }
            ]
          ],
          "mighty_defense": true,
          "called_joker_has_power": true
        },
        "joker_lead": {
          "by_color": false,
          "powerless_passes": false,
          "not_first_trick": false
        },
        "scoring": {
          "win": "OverTen",
          "lose": {
            "PaysBack": 10
          },
          "no_trump": "Win",
          "alone": "Win",
          "run": true,
          "back_run": {
            "TeamAtMost": 10
          },
          "full_contract": "Never",
          "discards_to_declarer": true
        },
        "reveal_discards": true,
        "next_dealer": "Rotate"
      }
    },
    {
      "id": "sshs",
      "title": "서울과고",
      "rules": {
        "players": 5,
        "hand_size": 10,
        "deck": "OneJoker",
        "lowest_rank": 2,
        "extra_cards": [],
        "misdeal": {
          "point_value": 2,
          "joker_value": -1,
          "card_values": [
            [
              {
                "Normal": [
                  "Spade",
                  10
                ]
              },
              1
            ],
            [
              {
                "Normal": [
                  "Diamond",
                  10
                ]
              },
              1
            ],
            [
              {
                "Normal": [
                  "Heart",
                  10
                ]
              },
              1
            ],
            [
              {
                "Normal": [
                  "Club",
                  10
                ]
              },
              1
            ],
            [
              {
                "Normal": [
                  "Spade",
                  14
                ]
              },
              1
            ]
          ],
          "threshold": 1,
          "all_points": false,
          "after_bidding": false,
          "declarer": false,
          "ask_first": false,
          "caller_deals": false
        },
        "bidding": {
          "min": 13,
          "max": 20,
          "allow_no_trump": true,
          "no_trump_bonus": 0,
          "no_trump_wins_ties": true,
          "first_bidder_may_pass": true,
          "change_trump_cost": 2,
          "change_to_no_trump_cost": null,
          "pass_is_final": true,
          "last_chance_min": null,
          "raise_on_exchange": false
        },
        "friend": {
          "by_card": true,
          "by_seat": false,
          "first_trick": true,
          "last_trick": true,
          "fake": true,
          "alone": true
        },
        "policy": {
          "mighty": {
            "first": "Valid",
            "last": "Valid"
          },
          "trump": {
            "first": "NoLead",
            "last": "Valid"
          },
          "joker": {
            "first": "NoEffect",
            "last": "NoEffect"
          },
          "joker_call": {
            "first": "NoEffect",
            "last": "Valid"
          },
          "overrides": [],
          "release_with_mighty": true
        },
        "joker_call": {
          "calls": [
            [
              {
                "Normal": [
                  "Club",
                  3
                ]
              },
              {
                "Normal": [
                  "Spade",
                  3
                ]
              }
            ]
          ],
          "mighty_defense": true,
          "called_joker_has_power": false
        },
        "joker_lead": {
          "by_color": false,
          "powerless_passes": false,
          "not_first_trick": false
        },
        "scoring": {
          "win": "OverTen",
          "lose": {
            "PaysBack": 10
          },
          "no_trump": "Win",
          "alone": "Win",
          "run": true,
          "back_run": {
            "TeamAtMost": 10
          },
          "full_contract": "Never",
          "discards_to_declarer": true
        },
        "reveal_discards": true,
        "next_dealer": "Rotate"
      }
    },
    {
      "id": "yonsei",
      "title": "연세대",
      "rules": {
        "players": 5,
        "hand_size": 10,
        "deck": "OneJoker",
        "lowest_rank": 2,
        "extra_cards": [],
        "misdeal": {
          "point_value": 2,
          "joker_value": 0,
          "card_values": [
            [
              {
                "Normal": [
                  "Spade",
                  10
                ]
              },
              1
            ],
            [
              {
                "Normal": [
                  "Heart",
                  10
                ]
              },
              1
            ],
            [
              {
                "Normal": [
                  "Spade",
                  14
                ]
              },
              1
            ]
          ],
          "threshold": 1,
          "all_points": false,
          "after_bidding": false,
          "declarer": false,
          "ask_first": false,
          "caller_deals": false
        },
        "bidding": {
          "min": 14,
          "max": 23,
          "allow_no_trump": false,
          "no_trump_bonus": 0,
          "no_trump_wins_ties": true,
          "first_bidder_may_pass": false,
          "change_trump_cost": 2,
          "change_to_no_trump_cost": null,
          "pass_is_final": true,
          "last_chance_min": null,
          "raise_on_exchange": false
        },
        "friend": {
          "by_card": true,
          "by_seat": true,
          "first_trick": true,
          "last_trick": true,
          "fake": true,
          "alone": true
        },
        "policy": {
          "mighty": {
            "first": "Valid",
            "last": "Valid"
          },
          "trump": {
            "first": "NoLead",
            "last": "Valid"
          },
          "joker": {
            "first": "NoEffect",
            "last": "NoEffect"
          },
          "joker_call": {
            "first": "NoEffect",
            "last": "Valid"
          },
          "overrides": [],
          "release_with_mighty": true
        },
        "joker_call": {
          "calls": [
            [
              {
                "Normal": [
                  "Club",
                  3
                ]
              },
              {
                "Normal": [
                  "Spade",
                  3
                ]
              }
            ]
          ],
          "mighty_defense": true,
          "called_joker_has_power": false
        },
        "joker_lead": {
          "by_color": false,
          "powerless_passes": false,
          "not_first_trick": false
        },
        "scoring": {
          "win": "OverTen",
          "lose": {
            "PaysBack": 10
          },
          "no_trump": "Win",
          "alone": "Win",
          "run": true,
          "back_run": {
            "TeamAtMost": 10
          },
          "full_contract": "Never",
          "discards_to_declarer": true
        },
        "reveal_discards": true,
        "next_dealer": "Rotate"
      }
    }
  ],
  "default_preset": "default",
  "rule_defaults": {
    "players": 5,
    "hand_size": 10,
    "deck": "OneJoker",
    "lowest_rank": 2,
    "extra_cards": [],
    "misdeal": {
      "point_value": 1,
      "joker_value": 0,
      "card_values": [],
      "threshold": 0,
      "all_points": false,
      "after_bidding": false,
      "declarer": false,
      "ask_first": false,
      "caller_deals": false
    },
    "bidding": {
      "min": 13,
      "max": 20,
      "allow_no_trump": true,
      "no_trump_bonus": 0,
      "no_trump_wins_ties": true,
      "first_bidder_may_pass": true,
      "change_trump_cost": 2,
      "change_to_no_trump_cost": null,
      "pass_is_final": true,
      "last_chance_min": null,
      "raise_on_exchange": false
    },
    "friend": {
      "by_card": true,
      "by_seat": true,
      "first_trick": true,
      "last_trick": true,
      "fake": true,
      "alone": true
    },
    "policy": {
      "mighty": {
        "first": "Valid",
        "last": "Valid"
      },
      "trump": {
        "first": "NoLead",
        "last": "Valid"
      },
      "joker": {
        "first": "NoEffect",
        "last": "NoEffect"
      },
      "joker_call": {
        "first": "Valid",
        "last": "Valid"
      },
      "overrides": [],
      "release_with_mighty": true
    },
    "joker_call": {
      "calls": [
        [
          {
            "Normal": [
              "Club",
              3
            ]
          },
          {
            "Normal": [
              "Spade",
              3
            ]
          }
        ]
      ],
      "mighty_defense": true,
      "called_joker_has_power": false
    },
    "joker_lead": {
      "by_color": false,
      "powerless_passes": false,
      "not_first_trick": false
    },
    "scoring": {
      "win": "OverTen",
      "lose": "Shortfall",
      "no_trump": "Win",
      "alone": "Win",
      "run": true,
      "back_run": {
        "TeamAtMost": 10
      },
      "full_contract": "Never",
      "discards_to_declarer": true
    },
    "reveal_discards": true,
    "next_dealer": "Rotate"
  },
  "bot_levels": [
    {
      "id": "easy",
      "label": "초보"
    },
    {
      "id": "normal",
      "label": "보통"
    },
    {
      "id": "hard",
      "label": "고수"
    }
  ],
  "default_bot_level": "hard",
  "turn_limits": [
    0,
    20,
    40,
    60
  ],
  "reactions": [
    "👏",
    "😂",
    "😮",
    "😭",
    "🔥",
    "🙏",
    "나이스",
    "아…",
    "ㅋㅋㅋ",
    "빨리요~",
    "미안",
    "굿"
  ],
  "name_max": 24,
  "report_max": 2000,
  "report_days": 14,
  "first_bid_grace_ms": 2000,
  "idle_minutes": 30
};
