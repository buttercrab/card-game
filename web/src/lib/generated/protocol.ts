// Generated from the server's Rust types (crates/server/src/codegen.rs).
// Do not edit: run `cargo run -p server -- --write-generated web/src/lib/generated`.

/**
 * A refusal: on a table's connection as `{type: "error", ...}`, over
 * HTTP as the body of an error status.
 */
export type ServerError = { code: ErrorCode, 
/**
 * Which rule check failed, for [`ErrorCode::InvalidRules`].
 */
rule?: InvalidRules, 
/**
 * More, in English, for the logs and for whoever debugs the client.
 */
detail?: string, };

/**
 * Why [`Rules::validate`] refuses a set of rules. The web client words
 * each one for players, by its snake_case name.
 */
export type InvalidRules = "point_cards_missing" | "bad_extra_cards" | "table_size" | "too_few_cards" | "joker_call_not_in_deck" | "empty_bid_range" | "no_trump_bonus_too_high" | "joker_call_per_joker" | "pays_back_too_much" | "no_friend_rule";

/**
 * Why the server refused something, as a code: the client words each in
 * Korean, and the compiler makes it word every one.
 */
export type ErrorCode = "not_seated" | "already_seated" | "name_required" | "table_full" | "seat_taken" | "no_such_seat" | "no_player_in_seat" | "no_bot_in_seat" | "nobody_to_move" | "leave_own_seat" | "seats_between_hands" | "rules_between_hands" | "bots_stay_in_hand" | "hand_in_progress" | "empty_seats" | "no_hand" | "not_your_turn" | "illegal_action" | "wait_after_deal" | "no_such_turn_limit" | "invalid_rules" | "player_count_fixed" | "unknown_reaction" | "hints_busy" | "hints_too_often" | "bad_message" | "rate_limited" | "too_many_tables" | "unknown_preset" | "empty_report" | "too_many_reports";
