// Generated from the server's Rust types (crates/server/src/codegen.rs).
// Do not edit: run `cargo run -p server -- --write-generated web/src/lib/generated`.

export const MAX_COMMAND_BATCH = 32 as const;

export type Action = { "Deal": { hands: Array<Array<Card>>, kitty: Array<Card>, } } | "Misdeal" | { "Bid": Contract } | "Pass" | { "ChangeTrump": Suit | null } | { "Raise": Contract } | { "Discard": Card } | { "CallFriend": FriendCall } | { "Play": { card: Card, joker_lead: Lead | null, call_joker: boolean, } };

/**
 * When a failed contract counts double (백런).
 */
export type BackRun = "Never" | { "TeamAtMost": number } | { "ShortBy": number } | "DefenceReachesBid";

/**
 * One turn of the bidding, as everyone at the table heard it.
 */
export type Bid = { seat: number,
/**
 * `None` is a pass.
 */
contract: Contract | null, };

export type Bidding = {
/**
 * Lowest bid, counted as for a trump contract.
 */
min: number, max: number, allow_no_trump: boolean,
/**
 * A no-trump bid of `n` ranks as a trump bid of `n + no_trump_bonus`.
 */
no_trump_bonus: number,
/**
 * At equal rank a no-trump bid overrules a trump bid; otherwise every
 * bid must rank strictly higher.
 */
no_trump_wins_ties: boolean,
/**
 * Whether the first bidder may pass before anyone has bid.
 */
first_bidder_may_pass: boolean,
/**
 * Extra points the declarer must promise to change trump after taking the kitty.
 */
change_trump_cost: number,
/**
 * How much the contract's number rises to change to no-trump. `None`
 * treats it like any change: what the bid is worth rises by
 * `change_trump_cost`.
 */
change_to_no_trump_cost: number | null,
/**
 * A pass is final. Otherwise a player who passed may bid again later,
 * and the bidding ends once everyone else has passed in a row.
 */
pass_is_final: boolean,
/**
 * When everyone passes, the first bidder gets one more turn, with
 * this as the minimum; a second pass redeals.
 */
last_chance_min: number | null,
/**
 * After taking the kitty the declarer may also raise the contract,
 * keeping trump or changing it by more than the least it costs.
 */
raise_on_exchange: boolean, };

/**
 * How well a bot plays: the levels players pick at a table, whatever the
 * game. Each game says what plays at each ([`TableBots`]).
 */
export type BotLevel = "easy" | "normal" | "hard";

export type BotLevelInfo = { id: BotLevel,
/**
 * Its name at the table.
 */
label: string, };

/**
 * A playing card. Ranks run from 2 to 14 (ace).
 */
export type Card = { "Normal": [Suit, number] } | { "Joker": Color };

export type CardPolicies = { mighty: TrickPolicy, trump: TrickPolicy, joker: TrickPolicy,
/**
 * Whether leading a joker-call card can call the joker. `NoEffect`,
 * `Invalid` and `NoLead` all mean no call that trick.
 */
joker_call: TrickPolicy,
/**
 * Per-card policies that take precedence over the categories above.
 */
overrides: Array<[Card, TrickPolicy]>,
/**
 * A held-back card is released when nothing is left but jokers and
 * the mighty; otherwise only when nothing is left but jokers (with
 * nine trumps and the mighty, the mighty must lead).
 */
release_with_mighty: boolean, };

export type CardPolicy = "Valid" | "NoEffect" | "Invalid" | "NoLead";

/**
 * Everything the client takes from the server at build time, whatever the
 * game.
 */
export type Catalog = {
/**
 * The protocol the client is built for; see [`crate::protocol::version`].
 */
protocol: string,
/**
 * The games, the first being what the routes without a game id mean.
 */
games: Array<GameListing>,
/**
 * From weakest to strongest.
 */
bot_levels: Array<BotLevelInfo>,
/**
 * The level a bot sits down at unless asked for another.
 */
default_bot_level: BotLevel,
/**
 * The turn limits a table may choose, in seconds; 0 is none.
 */
turn_limits: Array<number>,
/**
 * The quick reactions a seat may send; anything else is refused.
 */
reactions: Array<string>,
/**
 * The longest name a seat takes, in characters.
 */
name_max: number,
/**
 * The longest problem report kept, in characters.
 */
report_max: number,
/**
 * How long reports and new client errors are kept, in days.
 */
report_days: number,
/**
 * A table with nobody connected closes after this many minutes.
 */
idle_minutes: number, };

/**
 * Everything a client may send on a table's connection.
 */
export type ClientMsg = { "type": "observe", name: string, token: string | null, } | { "type": "request_seat", requested: boolean, seat?: number | null, } | { "type": "offer_seat", requester_id: string | null, } | { "type": "accept_seat", seat: number, target_id: string, } | { "type": "reset_scores" } | { "type": "ready", ready: boolean, } | { "type": "end_session" } | { "type": "rematch" } | { "type": "join", name: string, token?: string | null, seat?: number | null,
/**
 * An id the browser keeps across tables, if it sends one; only its
 * salted hash is kept, to count returning players.
 */
device?: string | null,
/**
 * Only reclaim the token's seat: a reconnecting tab whose seat is
 * gone (its player was moved out) watches instead of sitting
 * somewhere new.
 */
reclaim?: boolean, } | { "type": "leave" } | { "type": "set_table", turn_secs?: number, shuffle?: boolean,
/**
 * Between hands: shuffle the seats when the next hand starts.
 */
shuffle_next?: boolean, } | { "type": "swap_seats", a: number, b: number, } | { "type": "clear_seat", seat: number, } | { "type": "add_bot", seat: number, level?: BotLevel, } | { "type": "remove_bot", seat: number, } | { "type": "set_settings", settings: MightySettings, } | { "type": "hint" } | { "type": "react", text: string, } | { "type": "start" } | { "type": "submit", operation_id: string, sequence: number, expected: CommandScope, action: Action, } | { "type": "submit_batch", operation_id: string, sequence: number, expected: CommandScope, actions: Array<Action>, } | { "type": "submit_room", operation_id: string, sequence: number, expected: CommandScope, action: RoomAction, } | { "type": "cancel_operation", operation_id: string, sequence: number, expected: CommandScope, } | { "type": "query_operation", operation_id: string, sequence: number, } | { "type": "act", action: Action, };

/**
 * The running turn timer, as of the message that carries it.
 */
export type ClockInfo = { seat: number,
/**
 * Time left, in milliseconds.
 */
ms: number,
/**
 * The whole turn, in milliseconds.
 */
total_ms: number, };

export type Color = "Black" | "Red";

export type CommandDomain = "game" | "room";

export type CommandOutcome = { "status": "accepted", version: number, } | { "status": "rejected", reason: CommandRejection, error: ErrorCode | null, } | { "status": "unavailable", reason: ReceiptUnavailable, };

export type CommandReceipt = { operation_id: string, sequence: number, scope: CommandScope | null, outcome: CommandOutcome, durability: ReceiptDurability, };

export type CommandRejection = "actor_mismatch" | "cancelled" | "stale_scope" | "sequence_conflict" | "sequence_gap" | "capacity" | "rule";

export type CommandScope = { domain: CommandDomain, room_id: string, room_epoch: string, session_id: number, hand: number, version: number, seat: number | null, actor_id: string, };

export type CommandWindow = { scope: CommandScope, next_sequence: number, };

export type Contract = {
/**
 * `None` is no-trump.
 */
trump: Suit | null, count: number, };

export type ContractChange = { action: Action, contract: Contract, };

/**
 * `POST /api/rooms`: a new table, on a preset (기본 by default) or on
 * rules of its own, which must hold together.
 */
export type CreateRoom = { preset?: Preset,
/**
 * The table's own rules, changed from the preset's.
 */
rules?: Rules, };

/**
 * The answer to [`CreateRoom`]: the table's id, which is its link.
 */
export type CreatedRoom = { id: string, };

export type DeckKind = "OneJoker" | "TwoJokers";

/**
 * Why a score doubles.
 */
export type Double = "NoTrump" | "Alone" | "Run" | "FullContract";

export type Doubling = "Never" | "Win" | "Always";

/**
 * Why the server refused something, as a code: the client words each in
 * Korean, and the compiler makes it word every one.
 */
export type ErrorCode = "not_seated" | "already_seated" | "name_required" | "table_full" | "seat_taken" | "no_such_seat" | "no_player_in_seat" | "no_bot_in_seat" | "nobody_to_move" | "leave_own_seat" | "seats_between_hands" | "rules_between_hands" | "bots_stay_in_hand" | "hand_in_progress" | "empty_seats" | "players_not_ready" | "session_ended" | "session_not_ended" | "no_hand" | "not_your_turn" | "illegal_action" | "wait_after_deal" | "no_such_turn_limit" | "invalid_rules" | "player_count_fixed" | "unknown_reaction" | "hints_busy" | "storage_unavailable" | "resource_capacity" | "hints_too_often" | "bad_message" | "rate_limited" | "too_many_tables" | "unknown_preset" | "empty_report" | "too_many_reports" | "table_gone";

/**
 * A hand scored for the rulebook: its count, and what each seat gets.
 */
export type Example = { value: HandValue,
/**
 * Seat 0 declared; with a friend, seat 1 is the friend.
 */
payoffs: Array<number>, };

/**
 * The rulebook's worked examples under `rules`: a contract one over the
 * minimum, in spades, made by two points and missed by two. The declarer
 * plays with a friend where the rules have a way to call one.
 */
export type Examples = { contract: Contract,
/**
 * Played alone (no way to call a friend).
 */
alone: boolean, made: Example, failed: Example, };

export type FriendCall = { "Card": Card } | { "Seat": number } | "FirstTrick" | "LastTrick" | "Alone";

/**
 * How the declarer may choose a friend. Each flag enables one way.
 */
export type FriendRules = {
/**
 * Whoever holds a named card.
 */
by_card: boolean,
/**
 * A named seat.
 */
by_seat: boolean,
/**
 * Whoever wins the first trick.
 */
first_trick: boolean,
/**
 * Whoever wins the last trick.
 */
last_trick: boolean,
/**
 * The declarer may name a card they hold themselves, playing alone in secret.
 */
fake: boolean,
/**
 * The declarer may openly play alone, doubling the stakes.
 */
alone: boolean, };

/**
 * A game the server offers.
 */
export type GameListing = {
/**
 * Its id, in routes and in the room message's `game`.
 */
id: string,
/**
 * For people: `마이티`.
 */
name: string, };

/**
 * A finished hand in brief, for the session's story.
 */
export type HandSummary = { contract: Contract, declarer: number, friend: number | null, made: boolean, team_points: number,
/**
 * The point cards each trick took, oldest first: positive when the
 * declarer's side won the trick, negative for the defence, 0 for none.
 * Points in the discards count in `team_points` only.
 */
rounds: Array<number>,
/**
 * The trick during which the friend became known; 0 for a friend
 * called by seat, who is known from the start.
 */
friend_revealed: number | null, };

/**
 * A hand's score worked out: what one opponent pays the declarer's side,
 * and how.
 */
export type HandValue = { contract: Contract,
/**
 * Points the declarer's side counts, discards included.
 */
team_points: number, made: boolean,
/**
 * Each step in order. A made contract starts from its worth, a failed
 * one from its shortfall; doublings follow.
 */
steps: Array<ScoreStep>,
/**
 * What one opponent pays the declarer's side; negative when the side
 * pays instead.
 */
value: number, };

/**
 * What kind of card the rules hold back.
 */
export type Held = "Mighty" | "Joker" | "Trump" | "Card";

/**
 * Why [`Rules::validate`] refuses a set of rules. The web client words
 * each one for players, by its snake_case name.
 */
export type InvalidRules = "point_cards_missing" | "bad_extra_cards" | "table_size" | "too_few_cards" | "joker_call_not_in_deck" | "empty_bid_range" | "no_trump_bonus_too_high" | "joker_call_per_joker" | "pays_back_too_much" | "no_friend_rule" | "fake_without_card" | "always_misdeal";

export type JokerCall = {
/**
 * One pair per joker, in [`DeckKind::jokers`] order: the card that calls
 * it, and the card used instead when the first card's suit is trump.
 */
calls: Array<[Card, Card]>,
/**
 * A called joker's holder may play the mighty instead.
 */
mighty_defense: boolean,
/**
 * A called joker keeps its power.
 */
called_joker_has_power: boolean, };

/**
 * How a led joker sets the trick.
 */
export type JokerLead = {
/**
 * The joker may name its colour instead of a suit; either suit of that
 * colour then follows.
 */
by_color: boolean,
/**
 * A joker led without power counts as played last, so the next card
 * sets the suit that wins.
 */
powerless_passes: boolean,
/**
 * A joker may not lead the first trick unless nothing else may.
 */
not_first_trick: boolean, };

/**
 * What a trick's other cards must follow: a suit, or, when a joker leads
 * and the rules allow it, a whole colour.
 */
export type Lead = { "Suit": Suit } | { "Color": Color };

/**
 * What a failed contract costs before doubling; the shortfall is the
 * contract − points taken.
 */
export type LoseScore = "Shortfall" | { "PaysBack": number };

/**
 * What the web client knows of Mighty before any table opens.
 */
export type MightyCatalog = {
/**
 * In the order players pick them.
 */
presets: Array<PresetInfo>, default_preset: Preset,
/**
 * What the server assumes for a rule that saved rules leave out (rules
 * saved before it existed): a set kept on a device fills its gaps
 * from these, as the server would.
 */
rule_defaults: Rules,
/**
 * Where 딜미스 comes first, how long the first bid waits after the
 * deal, in milliseconds.
 */
first_bid_grace_ms: number, };

/**
 * What a Mighty table says beyond the view, on the seat's turn.
 */
export type MightyNotes = {
/**
 * In play: each card in hand that may not be played, with why.
 */
unplayable: Array<Unplayable>,
/**
 * In the exchange: the contract each trump change or raise sets.
 */
contracts: Array<ContractChange>, };

/**
 * What a Mighty table is set to play.
 */
export type MightySettings = { preset: Preset,
/**
 * The table's own rules, when its players changed the preset's.
 */
rules?: Rules,
/**
 * The preset's rules as they were when the table chose it; see
 * [`Table::freeze`]. Without it, the preset's rules today.
 */
preset_rules?: Rules, };

/**
 * A player may ask for a redeal when their hand is weak.
 * Each card is worth `point_value` if it is a point card, `joker_value` if it
 * is a joker, or its entry in `card_values` if listed. A hand totalling at
 * most `threshold` qualifies.
 */
export type Misdeal = { point_value: number, joker_value: number, card_values: Array<[Card, number]>, threshold: number,
/**
 * A hand of nothing but point cards qualifies too (서울과고, 신촌).
 */
all_points: boolean,
/**
 * When a player whose hand qualifies may ask, during the bidding.
 */
window: MisdealWindow,
/**
 * The declarer may ask after taking the kitty and before discarding,
 * judged on every card they then hold.
 */
declarer: boolean,
/**
 * Whoever calls a misdeal opens the bidding of the new deal.
 */
caller_deals: boolean, };

/**
 * When, during the bidding, a player whose hand qualifies may call a
 * misdeal: always from the moment the cards land, on their turn or not,
 * and never once they have passed.
 */
export type MisdealWindow = "OwnTurnUntilBid" | "AllBidding" | "BeforeFirstBid";

/**
 * Resource eligibility, separate from room/game legality and authorization.
 */
export type NativeCapacityReason = { "code": "capacity", resource: NativeResource, limit: number, } | { "code": "unsupported_profile" } | { "code": "unreservable_legacy" } | { "code": "serialization" } | { "code": "invariant" };

export type NativeCapacityStatus = { can_start: boolean, can_archive: boolean, can_play: boolean, reason: NativeCapacityReason | null, };

/**
 * Infrastructure admission, separate from the game's genuine legal action set.
 */
export type NativePolicyActions<A> = { legal: Array<A>, out_of_turn: Array<A>, };

export type NativeResource = "rooms" | "rules" | "settings" | "session" | "snapshot" | "hand_log" | "record" | "summary" | "chance_batch" | "archives" | "period_records" | "total_records" | "hand_number" | "session_number" | "game_version" | "room_version" | "score";

/**
 * Bounded HTTP 507 response for a preserved room that cannot safely reopen.
 * It is not a normal room snapshot and carries no invented empty history.
 */
export type NativeRoomUnavailable = { "code": "resource_capacity", reason: NativeCapacityReason, };

/**
 * Who opens the bidding of the next hand. The first bidder doubles as the
 * dealer where the dealer bids first.
 */
export type NextDealer = "Rotate" | "FriendOrDeclarer";

/**
 * A named observer. IDs identify people, never a seat credential.
 */
export type ObserverInfo = { id: string, name: string, requested: boolean, };

/**
 * Immutable participant identity and cumulative score at a session boundary.
 */
export type ParticipantResult = { id: string, name: string, bot: boolean, score: number, };

/**
 * Ordered next-hand admission. Public identities are never credentials.
 */
export type ParticipationRequest = { id: string, name: string, order: number, seat: number | null, target_id: string | null, offered_by: string | null, };

export type PhaseView = "Dealing" | { "Bidding": { to_act: number, best: [number, Contract] | null, passed: Array<boolean>,
/**
 * Who has bid at least once; unless the rules say otherwise, they
 * may no longer call a misdeal.
 */
has_bid: Array<boolean>, } } | { "Exchange": { declarer: number, contract: Contract, trump_changed: boolean,
/**
 * Only the declarer sees these.
 */
discards: Array<Card> | null, } } | { "Play": { declarer: number, contract: Contract, call: FriendCall,
/**
 * Set once the friend is publicly known.
 */
friend: number | null,
/**
 * The viewer knows there is no friend: called alone, the 주공 took
 * the first trick that named the friend, or played the called card,
 * or (for the 주공) the called card is in their hand or discards.
 */
no_friend: boolean, trick_no: number, leader: number, lead: Lead | null, plays: Array<Played>,
/**
 * Who is winning the trick so far, worked out here so the table
 * never has to know the rules. None before the first card.
 */
leading: number | null, called_joker: Card | null,
/**
 * Completed tricks, oldest first. All of it was played face up.
 */
tricks: Array<Trick>,
/**
 * Only the declarer sees these.
 */
discards: Array<Card> | null, } } | { "Done": { declarer: number, contract: Contract, call: FriendCall, friend: number | null, team_points: number, payoffs: Array<number>,
/**
 * How the hand was scored, step by step: what one opponent pays.
 */
value: HandValue, tricks: Array<Trick>,
/**
 * Shown to everyone once the hand is over.
 */
discards: Array<Card>, } };

/**
 * A card on the table. `powered` is false when a rule stripped its special
 * power: a powerless mighty or trump counts as a plain card of its suit,
 * and a powerless joker cannot win.
 */
export type Played = { seat: number, card: Card, powered: boolean, };

export type PokerAction = { "type": "fold" } | { "type": "check" } | { "type": "call" } | { "type": "raise_to", amount: number, } | { "type": "all_in" } | { "type": "deal", deck: Array<number>, } | { "type": "reveal" };

export type PokerCard = { rank: number, suit: PokerSuit, };

export type PokerCatalog = { id: string, name: string, presets: Array<PokerPreset>, };

export type PokerNotes = { to_call: number, min_raise_to: number | null, independent_hand: boolean, };

export type PokerPlayerView = { seat: number, stack: number, contributed: number, street_bet: number, folded: boolean, all_in: boolean, hole_count: number, hole: Array<PokerCard> | null, shown: boolean, };

export type PokerPot = { amount: number, winners: Array<number>, };

export type PokerPreset = { id: string, name: string, rules: PokerRules, };

export type PokerRules = { players: number, starting_stack: number, };

export type PokerSettings = { rules: PokerRules, };

export type PokerStreet = "preflop" | "flop" | "turn" | "river";

export type PokerSuit = "clubs" | "diamonds" | "hearts" | "spades";

export type PokerSummary = { dealer: number, board: Array<PokerCard>, payoffs: Array<number>, pots: Array<PokerPot>, };

export type PokerView = { viewer: number | null, dealer: number, street: PokerStreet, actor: number | null, board: Array<PokerCard>, players: Array<PokerPlayerView>, pot: number, current_bet: number, min_raise_to: number | null, showdown: boolean, over: boolean, pots: Array<PokerPot>, refunds: Array<number>, payoffs: Array<number> | null, };

/**
 * 기본, the owner's written base rules, and the school rules collected in
 * web-mighty, named after the groups that play them. The school presets
 * are written as changes to [`Rules::web_mighty`] (web-mighty's base), which
 * therefore stays as it was, and all score a failed contract by
 * [`LoseScore::PaysBack`]; `tests/presets.json` pins every preset.
 */
export type Preset = "default" | "ddshs" | "dshs" | "kmla" | "gsa" | "gshs" | "skku" | "sshs" | "yonsei";

/**
 * A preset as the web client lists it.
 */
export type PresetInfo = { id: Preset,
/**
 * The short name players know it by.
 */
title: string,
/**
 * What sets it apart, where the title does not say.
 */
note?: string, rules: Rules, };

export type ReceiptDurability = "memory" | "persisted";

export type ReceiptUnavailable = "unknown" | "pruned" | "persistence_failed";

/**
 * A completed hand's public view and names, frozen before seats change.
 * Game adapters decode `view` and `rules` using their own generated types.
 */
export type RecordedHand = {
/**
 * The score period in which this record was booked. Missing legacy origins
 * remain unknown; a preserved current_hand must never inherit a new period.
 */
session_id?: number, number: number, names: Array<string>, participant_ids: Array<string>, payoffs: Array<number>, rules: unknown, view: unknown, };

/**
 * Why the last deal was thrown in and the cards dealt again.
 */
export type Redeal = { "Misdeal": { seat: number, hand: Array<Card>, } } | "AllPassed";

/**
 * The last redeal of this hand, and how many there have been, so two in a
 * row are told apart.
 */
export type Redealt = { why: Redeal, count: number, };

/**
 * Why a card in hand may not be played now.
 */
export type Refusal = "CalledJoker" | { "MustFollow": Lead } | "JokerFirstLead" | { "HeldBack": { card: Held, trick: TrickWhen, leading: boolean, } };

/**
 * Closed semantic room operations; credentials and ephemeral requests stay native.
 */
export type RoomAction = { "type": "rename", name: string, } | { "type": "join", name: string, seat: number | null, device: string | null, } | { "type": "leave" } | { "type": "request_seat", requested: boolean, seat: number | null, } | { "type": "offer_seat", requester_id: string | null, } | { "type": "accept_seat", seat: number, target_id: string, } | { "type": "reset_scores" } | { "type": "ready", ready: boolean, } | { "type": "end_session" } | { "type": "rematch" } | { "type": "set_table", turn_secs: number | null, shuffle: boolean | null, shuffle_next: boolean | null, } | { "type": "swap_seats", a: number, b: number, } | { "type": "clear_seat", seat: number, } | { "type": "add_bot", seat: number, level: BotLevel, } | { "type": "remove_bot", seat: number, } | { "type": "set_settings", settings: MightySettings, } | { "type": "start" };

/**
 * The table: who sits where, the turn timer and the table's settings.
 * Sent to everyone after every change, and after a [`SessionMsg`] that
 * changed with it.
 */
export type RoomMsg = {
/**
 * Shared committed snapshot marker for room, state and room command window.
 */
room_version?: number,
/**
 * The server's [`version`] of the protocol.
 */
protocol: string, id: string, game: string,
/**
 * The preset, the table's own rules if its players changed them, and
 * the preset's rules as pinned when the table chose it.
 */
settings: MightySettings,
/**
 * The rules the table plays by.
 */
rules: Rules,
/**
 * Whether its players changed the preset's rules.
 */
customized: boolean, seats: Array<SeatInfo>, in_hand: boolean, table: TableSettings,
/**
 * The turn timer, when one runs.
 */
clock: ClockInfo | null,
/**
 * Connections without a seat: people watching.
 */
watching: number, observers: Array<ObserverInfo>, ready: Array<boolean>, participant_ids: Array<string>, participation: Array<ParticipationRequest>,
/**
 * Whether a hand, running or just finished, is on the table.
 */
showing: boolean, capacity?: NativeCapacityStatus, };

export type Rules = { players: number, hand_size: number, deck: DeckKind,
/**
 * The lowest rank dealt: 3마 plays from 7 and 4마 from 5 (see
 * [`Rules::for_players`]). Point cards (10 to A) are always dealt.
 */
lowest_rank: number,
/**
 * Cards below `lowest_rank` dealt anyway: 4마 keeps ♣3 and ♠3 for the
 * joker call.
 */
extra_cards: Array<Card>, misdeal: Misdeal, bidding: Bidding, friend: FriendRules, policy: CardPolicies, joker_call: JokerCall, joker_lead: JokerLead, scoring: Scoring,
/**
 * Everyone sees the discards once the hand is over.
 */
reveal_discards: boolean,
/**
 * Who opens the bidding next hand.
 */
next_dealer: NextDealer, };

/**
 * One step of a hand's score. `total` is the amount so far: what the
 * declarer's side wins when made, what it owes (as a positive number)
 * when failed.
 */
export type ScoreStep = { "OverTen": { points: number, total: number, } } | { "OverMin": { points: number, min: number, total: number, } } | { "OverBid": { points: number, contract: number, total: number, } } | { "BidBonus": { points: number, contract: number, bonus: number, total: number, } } | { "BothOver": { points: number, contract: number, n: number, total: number, } } | { "Short": { contract: number, short: number, total: number, } } | { "PaysBack": { contract: number, n: number, short: number, total: number, } } | { "BackRun": { rule: BackRun, total: number, } } | { "Doubled": { why: Double, total: number, } };

/**
 * How a finished hand is scored. Groups differ more here than anywhere
 * else; the default is web-mighty's formula.
 */
export type Scoring = {
/**
 * What a made contract is worth before doubling.
 */
win: WinScore,
/**
 * What a failed contract costs before doubling.
 */
lose: LoseScore,
/**
 * When a no-trump contract doubles the score.
 */
no_trump: Doubling,
/**
 * When playing openly alone (노프렌드) doubles the score. Without
 * it, the declarer still collects from every opponent.
 */
alone: Doubling,
/**
 * Taking all 20 points (런) doubles a win.
 */
run: boolean,
/**
 * When a failed contract doubles the loss (백런).
 */
back_run: BackRun,
/**
 * When a contract of 20 doubles the score.
 */
full_contract: Doubling,
/**
 * Point cards in the declarer's discards count for the declarer's
 * side; otherwise they count for the defence.
 */
discards_to_declarer: boolean, };

/**
 * Who sits in a seat, as everyone at the table sees it.
 */
export type SeatInfo = { "kind": "empty" } | { "kind": "human", name: string, connected: boolean,
/**
 * Its turn ran out and was played for it (자리 비움), or its
 * connection is gone under a turn limit.
 */
away: boolean, } | { "kind": "bot", name: string, level: BotLevel, };

/**
 * How the seats moved between hands. Sent before the seats change, so a
 * table on screen can slide each seat to its new place.
 */
export type SeatsMoved = { "how": "shuffle", order: Array<number>, } | { "how": "swap", seats: [number, number], };

/**
 * A refusal: on a table's connection as `{type: "error", ...}`, over
 * HTTP as the body of an error status.
 */
export type ServerError = { code: ErrorCode,
/**
 * Which rule check failed, for [`ErrorCode::InvalidRules`], as the
 * game names it.
 */
rule?: InvalidRules,
/**
 * More, in English, for the logs and for whoever debugs the client.
 */
detail?: string, };

/**
 * Everything the server sends on a table's connection.
 */
export type ServerMsg = { "type": "room" } & RoomMsg | { "type": "session" } & SessionMsg | { "type": "state" } & StateMsg | { "type": "operation_receipt" } & CommandReceipt | { "type": "room_command_window", command: CommandWindow, } | { "type": "welcome", seat: number, token: string, } | { "type": "visitor_welcome", seat: number | null, id: string, token: string, name: string, } | { "type": "observer_reaction", id: string, text: string, } | { "type": "unseated" } | { "type": "seats_moved" } & SeatsMoved | { "type": "reaction", seat: number, text: string, } | { "type": "hint", version: number, action: Action, } | { "type": "error" } & ServerError;

export type SessionArchive = { id: number, standings: Array<ParticipantResult>, records: Array<RecordedHand>,
/**
 * Preserves summaries from older snapshots which have no full replay.
 */
summary: unknown, };

/**
 * The session so far: the scores and every finished hand, by seat. Sent
 * when a connection opens and whenever it changes (a hand ends, someone
 * new sits down, the seats move), just before the [`RoomMsg`] that goes
 * with it.
 */
export type SessionMsg = {
/**
 * Publication marker; an unchanged session may accompany newer room versions.
 */
room_version?: number, scores: Array<number>, hands_played: number,
/**
 * Each finished hand's payoffs, in order.
 */
history: Array<Array<number>>,
/**
 * Each finished hand in brief, in order.
 */
hands: Array<HandSummary>, session_id: number, ended: boolean, records: Array<RecordedHand>, current_hand: RecordedHand | null, standings: Array<ParticipantResult>, archives: Array<SessionArchive>, };

/**
 * The hand as one seat (or a spectator) may see it.
 */
export type StateMsg = { room_version?: number,
/**
 * Private scoped-command capability; absent for observers and old peers.
 */
command?: CommandWindow, view: View,
/**
 * What the seat may do, on its turn.
 */
legal: Array<Action>,
/**
 * Present in native bounded rooms; missing only for older peers/fixtures.
 */
policy_actions?: NativePolicyActions<Action>, turn: Turn,
/**
 * What the seat may do although it is not its turn: a 딜미스 from the
 * moment the cards land, for a hand that qualifies.
 */
out_of_turn: Array<Action>,
/**
 * How long, in ms, the slowest legal action must still wait after the
 * deal (the first bid where 딜미스 comes first).
 */
grace_ms: number,
/**
 * Which state of the hand this is; a hint carries the version it was
 * asked for, so one for an older state is dropped.
 */
version: number,
/**
 * What the table needs told on the seat's turn: why a card can't be
 * played, what each contract change sets.
 */
notes: MightyNotes, };

export type Suit = "Spade" | "Diamond" | "Heart" | "Club";

/**
 * The table's own settings, apart from the game's rules: they change how
 * the room runs, never how a hand is played or encoded.
 */
export type TableSettings = {
/**
 * Seconds per decision, or 0 for no limit. The weightier decisions
 * (see [`engine::Table::long_decision`]) get twice as long.
 */
turn_secs: number,
/**
 * Deal the players into new seats before every hand.
 */
shuffle: boolean,
/**
 * Deal the players into new seats when the next hand starts, once
 * (섞기 between hands); cleared when it has.
 */
shuffle_next: boolean, };

/**
 * A completed trick. Every card in it was played face up.
 */
export type Trick = { plays: Array<Played>, lead: Lead, winner: number, };

/**
 * Policy on the first trick and on the last trick. Tricks between are always valid.
 */
export type TrickPolicy = { first: CardPolicy, last: CardPolicy, };

/**
 * The tricks the rules single out.
 */
export type TrickWhen = "First" | "Last";

/**
 * Whom the hand waits on. Legality is by seat ([`Game::legal_actions`]):
 * this says only whose move paces the hand (a clock, a bot that should
 * think now) and when chance must be drawn.
 */
export type Turn = "Chance" | { "Seat": number } | "Over";

export type Unplayable = { card: Card, why: Refusal, };

/**
 * Everything one viewer may know. Other hands, the kitty and (for anyone
 * but the declarer) the discards are never included.
 */
export type View = { viewer: Viewer, rules: Rules, first_bidder: number,
/**
 * Empty for spectators.
 */
hand: Array<Card>, hand_sizes: Array<number>,
/**
 * Point cards each seat has won; they lie face up.
 */
points_taken: Array<Array<Card>>, phase: PhaseView,
/**
 * Every bid and pass of this deal so far, in order; everyone hears
 * them. Empty while dealing.
 */
bids: Array<Bid>,
/**
 * Why the cards were last dealt again, while the new deal is bid on.
 */
redealt: Redealt | null, };

/**
 * Who is looking at the game.
 */
export type Viewer = { "Seat": number } | "Spectator";

export type WinScore = "OverTen" | "OverMin" | "OverBid" | "BidBonus" | { "BothOver": number };
