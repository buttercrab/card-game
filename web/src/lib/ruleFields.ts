// Every rule a table can change, as data. The rule editor, the preset
// picker's trait lines, the compare view and the rulebook's "바뀐 규칙" box
// are all built from RULE_FIELDS, so a new rule option is one entry here:
//
//   {
//     path: 'bidding.some_flag',        // where it lives in Rules
//     group: 'bidding',                 // which section of the editor
//     label: '짧은 이름',
//     help: '한 줄 설명',
//     control: { kind: 'toggle', on: '있어요', off: '없어요' },
//     trait: (v) => (v ? '특징' : null), // how a preset that differs says it
//   },
//
// Values are compared as JSON, so a field can be a number, a flag, a card
// pair or a whole sub-object.
import { RULE_TEXT } from './errorText';
import { cardLabel, deckSize, jokers } from './cards';
import type {
  BackRun,
  Card,
  CardPolicy,
  Doubling,
  LoseScore,
  MisdealWindow,
  Rules,
  TrickPolicy,
  WinScore,
} from './types';

export type GroupId = 'deal' | 'bidding' | 'friend' | 'power' | 'score';

export const GROUPS: { id: GroupId; label: string; note?: string }[] = [
  { id: 'deal', label: '덱과 딜미스' },
  { id: 'bidding', label: '공약' },
  { id: 'friend', label: '키티와 프렌드' },
  { id: 'power', label: '카드의 힘' },
  // Older servers send no scoring; the note says what all of them score by.
  {
    id: 'score',
    label: '점수',
    note: '여당이 이기면 가져온 점수 − 10, 노기루다·노프렌드·20점 모두는 두 배씩이에요.',
  },
];

export interface Option<V = unknown> {
  value: V;
  label: string;
}

export type Control =
  /** A switch; `on` and `off` say the value in the compare view. */
  | { kind: 'toggle'; on: string; off: string }
  /** One of a few values, side by side; `stack` puts long ones one per line. */
  | { kind: 'segment'; options: Option[]; stack?: boolean }
  | { kind: 'stepper'; min: number; max: number; signed?: boolean; unit?: string }
  /** A number or null: a switch, and a stepper while it is on. `off` says
   * null, `on` a number; switching on starts at `start`. */
  | { kind: 'maybe'; min: number; max: number; start: number; off: string; on: (v: number) => string }
  /** An object of flags, each a chip that can be on or off. */
  | { kind: 'flags'; options: { key: string; label: string }[] }
  /** A TrickPolicy: one segment for the first round, one for the last. */
  | { kind: 'rounds'; options: Option<CardPolicy>[] }
  /** A list of [card, value] pairs from a fixed set of cards. */
  | { kind: 'cardValues'; cards: Card[]; min: number; max: number };

export interface Field {
  /** Dot path into Rules; numeric parts index arrays. Also the field's id. */
  path: string;
  group: GroupId;
  label: string;
  /** One line under the label in the editor. */
  help: string;
  control: Control;
  /** Hidden in the editor (and implied elsewhere) when this says false. */
  show?: (r: Rules) => boolean;
  /** Plain-Korean value, for compare rows. Defaults from the control. */
  say?: (v: any, r: Rules) => string;
  /** A short trait for a preset whose value differs from `base` (기본's),
   * or null to leave it out. Defaults to "label say(v)". */
  trait?: (v: any, base: any, r: Rules) => string | null;
  /** Higher comes first in a trait line; a function where how telling a
   * difference is depends on the values. */
  weight?: number | ((v: any, base: any) => number);
  /** Runs after the value is set, to keep dependent values whole. */
  apply?: (r: Rules) => void;
}

const n = (suit: 'Spade' | 'Diamond' | 'Heart' | 'Club', rank: number): Card => ({ Normal: [suit, rank] });
const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

const POLICY: Option<CardPolicy>[] = [
  { value: 'Valid', label: '보통' },
  { value: 'NoEffect', label: '힘 없음' },
  { value: 'NoLead', label: '선 못 냄' },
  { value: 'Invalid', label: '못 냄' },
];
const CALL_POLICY: Option<CardPolicy>[] = [
  { value: 'Valid', label: '됨' },
  { value: 'NoEffect', label: '안 됨' },
];

/** "첫 라운드 마이티 힘 없음" for the rounds where a policy differs from base. */
function roundsTrait(who: string, options: Option<CardPolicy>[]) {
  const word = (p: CardPolicy) => (p === 'Valid' ? '제한 없음' : (options.find((o) => o.value === p)?.label ?? p));
  return (v: TrickPolicy, base: TrickPolicy | undefined) => {
    const first = !base || v.first !== base.first;
    const last = !base || v.last !== base.last;
    if (first && last && v.first === v.last) return `첫·마지막 라운드 ${who} ${word(v.first)}`;
    return [first && `첫 라운드 ${who} ${word(v.first)}`, last && `마지막 라운드 ${who} ${word(v.last)}`]
      .filter(Boolean)
      .join(' · ');
  };
}

function callOptions(call: Card, fallback: Card): Option[] {
  const suit = cardLabel(call).slice(0, 1);
  return [
    { value: [call, fallback], label: `${cardLabel(call)}, ${suit} 기루다면 ${cardLabel(fallback)}` },
    { value: [call, call], label: `언제나 ${cardLabel(call)}` },
  ];
}

const FRIEND_WAYS = [
  { key: 'by_card', label: '카드' },
  { key: 'by_seat', label: '자리' },
  { key: 'first_trick', label: '첫 라운드' },
  { key: 'last_trick', label: '마지막 라운드' },
  { key: 'alone', label: '노프렌드' },
  { key: 'fake', label: '가짜 프렌드' },
];

const DOUBLING: Option<Doubling>[] = [
  { value: 'Never', label: '없음' },
  { value: 'Win', label: '이기면' },
  { value: 'Always', label: '언제나' },
];

/** "노기루다는 이겨야 두 배" for a doubling that differs from base. */
function doublingTrait(who: string, topic: string) {
  return (v: Doubling) => (v === 'Never' ? `${who} 두 배 없음` : v === 'Win' ? `${topic} 이겨야 두 배` : `${topic} 져도 두 배`);
}

const WIN: Option<WinScore>[] = [
  { value: 'OverTen', label: '가져온 점수 − 10, 적어도 1' },
  { value: { BothOver: 13 }, label: '(가져온 점수 − 13) + (공약 − 13), 적어도 1' },
  { value: 'OverBid', label: '가져온 점수 − 공약' },
  { value: 'OverMin', label: '가져온 점수 − 최소 공약' },
  { value: 'BidBonus', label: '가져온 점수 − 공약 + (공약 − 최소 공약) × 2' },
];

function winTrait(v: WinScore): string {
  if (typeof v === 'object') return `이기면 (점수 − ${v.BothOver}) + (공약 − ${v.BothOver})`;
  const words: Record<string, string> = {
    OverTen: '이기면 점수 − 10',
    OverMin: '이기면 점수 − 최소 공약',
    OverBid: '이기면 점수 − 공약',
    BidBonus: '높은 공약에 보너스',
  };
  return words[v];
}

const LOSE: Option<LoseScore>[] = [
  { value: 'Shortfall', label: '모자란 만큼' },
  { value: { PaysBack: 10 }, label: '부른 만큼 갚고 모자란 만큼 더' },
];

function loseSay(v: LoseScore): string {
  return v === 'Shortfall' ? '모자란 만큼' : `(공약 − ${v.PaysBack}) + 모자란 만큼`;
}

/** The lowest number a contract can have; mirrors Rules::lowest_contract. */
export function lowestContract(r: Rules): number {
  const b = r.bidding;
  const min = Math.min(b.min, b.last_chance_min ?? b.min);
  return Math.max(min - (b.allow_no_trump ? b.no_trump_bonus : 0), 0);
}

const BACK_RUN: Option<BackRun>[] = [
  { value: { TeamAtMost: 10 }, label: '여당 10점 이하' },
  { value: { ShortBy: 5 }, label: '5점 이상 모자람' },
  { value: 'DefenceReachesBid', label: '야당이 공약만큼' },
  { value: 'Never', label: '없음' },
];

function backRunSay(v: BackRun): string {
  if (v === 'Never') return '없음';
  if (v === 'DefenceReachesBid') return '야당이 공약만큼';
  if ('TeamAtMost' in v) return `여당 ${v.TeamAtMost}점 이하`;
  return `${v.ShortBy}점 이상 모자람`;
}

export const RULE_FIELDS: Field[] = [
  // 덱과 딜미스
  {
    path: 'deck',
    group: 'deal',
    label: '조커',
    help: '두 장이면 흑조커와 홍조커, 키티는 4장이 돼요',
    control: {
      kind: 'segment',
      options: [
        { value: 'OneJoker', label: '한 장' },
        { value: 'TwoJokers', label: '두 장' },
      ],
    },
    trait: (v) => (v === 'TwoJokers' ? '조커 두 장' : '조커 한 장'),
    weight: 10,
    // Each joker needs its own joker-call card.
    apply: (r) => {
      const calls = r.joker_call.calls;
      if (r.deck === 'TwoJokers' && calls.length < 2) calls.push([n('Heart', 3), n('Diamond', 3)]);
      if (r.deck === 'OneJoker' && calls.length > 1) calls.splice(1);
    },
  },
  {
    path: 'misdeal.threshold',
    group: 'deal',
    label: '딜미스 기준',
    help: '아래 값으로 센 패가 이 점수 이하면 다시 나눠요',
    control: { kind: 'stepper', min: -3, max: 6, unit: '점 이하' },
    say: (v) => `${v}점 이하`,
    trait: (v) => `딜미스 ${v}점 이하`,
    weight: 2,
  },
  {
    path: 'misdeal.point_value',
    group: 'deal',
    label: '점수 카드 값',
    help: '딜미스를 셀 때 10·J·Q·K·A 한 장의 값',
    control: { kind: 'stepper', min: -2, max: 3, signed: true },
    trait: () => '딜미스 셈 다름',
    weight: 1,
  },
  {
    path: 'misdeal.joker_value',
    group: 'deal',
    label: '조커 값',
    help: '딜미스를 셀 때 조커 한 장의 값',
    control: { kind: 'stepper', min: -3, max: 3, signed: true },
    trait: () => '딜미스 셈 다름',
    weight: 1,
  },
  {
    path: 'misdeal.card_values',
    group: 'deal',
    label: '따로 세는 카드',
    help: '고른 카드는 위 값 대신 여기 정한 값으로 세어요',
    control: {
      kind: 'cardValues',
      cards: [n('Spade', 14), n('Spade', 10), n('Diamond', 10), n('Heart', 10), n('Club', 10)],
      min: -3,
      max: 3,
    },
    say: (v: [Card, number][]) => (v.length ? v.map(([c, x]) => `${cardLabel(c)} ${signed(x)}`).join(', ') : '없음'),
    trait: () => '딜미스 셈 다름',
    weight: 1,
  },
  {
    path: 'misdeal.all_points',
    group: 'deal',
    label: '점수 카드만 받아도 딜미스',
    help: '10·J·Q·K·A만 받은 패도 다시 나눌 수 있어요',
    control: { kind: 'toggle', on: '돼요', off: '안 돼요' },
    trait: (v) => (v ? '점수 카드만 받아도 딜미스' : '점수 카드만으론 딜미스 안 됨'),
    weight: 2,
  },
  {
    path: 'misdeal.window',
    group: 'deal',
    label: '딜미스는 언제까지',
    help: '패를 받자마자 할 수 있고, 패스한 뒤에는 못 해요. 첫 공약 전까지라면 첫 공약은 패를 받고 잠깐 기다렸다가 해요',
    control: {
      kind: 'segment',
      options: [
        { value: 'OwnTurnUntilBid', label: '자기 공약 전까지' },
        { value: 'AllBidding', label: '공약이 끝나기 전까지' },
        { value: 'BeforeFirstBid', label: '첫 공약 전까지' },
      ],
      stack: true,
    },
    trait: (v: MisdealWindow) =>
      v === 'BeforeFirstBid' ? '딜미스는 첫 공약 전까지' : v === 'AllBidding' ? '공약 뒤에도 딜미스' : '공약 전에만 딜미스',
    weight: (v: MisdealWindow, base: MisdealWindow) => (v === 'AllBidding' || base === 'AllBidding' ? 2 : 1.6),
  },
  {
    path: 'misdeal.declarer',
    group: 'deal',
    label: '주공 딜미스',
    help: '주공이 키티까지 받은 패로 버리기 전에 딜미스할 수 있어요',
    control: { kind: 'toggle', on: '돼요', off: '안 돼요' },
    trait: (v) => (v ? '주공 딜미스' : '주공 딜미스 없음'),
    weight: 2,
  },
  {
    path: 'misdeal.caller_deals',
    group: 'deal',
    label: '딜미스한 사람이 딜러',
    help: '딜미스를 부른 사람이 다시 나누고 먼저 공약해요',
    control: { kind: 'toggle', on: '돼요', off: '안 돼요' },
    trait: (v) => (v ? '딜미스한 사람이 딜러' : null),
    weight: 1,
  },
  {
    path: 'next_dealer',
    group: 'deal',
    label: '다음 딜러',
    help: '다음 판에 먼저 공약하는 사람이에요',
    control: {
      kind: 'segment',
      options: [
        { value: 'Rotate', label: '한 자리씩' },
        { value: 'FriendOrDeclarer', label: '프렌드, 없으면 주공' },
      ],
    },
    trait: (v) => (v === 'Rotate' ? '딜러는 한 자리씩' : '프렌드가 다음 딜러'),
    weight: 1,
  },

  // 공약
  {
    path: 'bidding.min',
    group: 'bidding',
    label: '최소 공약',
    help: '이보다 낮게는 부를 수 없어요',
    control: { kind: 'stepper', min: 1, max: 20 },
    trait: (v) => `최소 공약 ${v}`,
    // One off from 기본 is common; two or more tells a table apart.
    weight: (v: number, base: number | undefined) => (base !== undefined && Math.abs(v - base) < 2 ? 4.5 : 9),
  },
  {
    path: 'bidding.max',
    group: 'bidding',
    label: '최대 공약',
    help: '점수 카드는 모두 20점이라 20을 넘는 공약은 이룰 수 없어요',
    control: { kind: 'stepper', min: 13, max: 26 },
    trait: (v) => `최대 공약 ${v}`,
    weight: 3,
  },
  {
    path: 'bidding.allow_no_trump',
    group: 'bidding',
    label: '노기루다',
    help: '기루다 없이 공약할 수 있어요',
    control: { kind: 'toggle', on: '있어요', off: '없어요' },
    trait: (v) => (v ? '노기루다 있음' : '노기루다 없음'),
    weight: 8,
  },
  {
    path: 'bidding.no_trump_bonus',
    group: 'bidding',
    label: '노기루다 보너스',
    help: '노기루다 n은 기루다 n+보너스와 같은 높이예요',
    control: { kind: 'stepper', min: 0, max: 5, signed: true },
    show: (r) => r.bidding.allow_no_trump,
    trait: (v) => (v ? `노기루다 ${signed(v)}` : '노기루다도 같은 높이'),
    weight: 2,
  },
  {
    path: 'bidding.no_trump_wins_ties',
    group: 'bidding',
    label: '같은 높이면 노기루다',
    help: '켜면 같은 높이의 노기루다가 기루다 공약을 덮어요',
    control: { kind: 'toggle', on: '덮어요', off: '못 덮어요' },
    show: (r) => r.bidding.allow_no_trump,
    trait: (v) => (v ? '같은 높이 노기루다가 덮음' : '같은 높이 노기루다 못 덮음'),
    weight: 1.5,
  },
  {
    path: 'bidding.first_bidder_may_pass',
    group: 'bidding',
    label: '첫 사람 패스',
    help: '끄면 처음 부르는 사람은 꼭 공약해야 해요',
    control: { kind: 'toggle', on: '돼요', off: '안 돼요' },
    trait: (v) => (v ? '첫 사람 패스 가능' : '첫 사람 패스 불가'),
    weight: 5,
  },
  {
    path: 'bidding.pass_is_final',
    group: 'bidding',
    label: '패스하면 끝',
    help: '끄면 패스한 사람도 누가 더 높이 부르면 다시 부를 수 있어요',
    control: { kind: 'toggle', on: '끝이에요', off: '다시 불러요' },
    trait: (v) => (v ? '패스하면 끝' : '패스해도 다시 공약'),
    weight: 5,
  },
  {
    path: 'bidding.last_chance_min',
    group: 'bidding',
    label: '모두 패스하면 딜러 한 번 더',
    help: '다섯 명 모두 패스하면 딜러가 이 수부터 한 번 더 불러요. 또 패스하면 다시 나눠요',
    control: { kind: 'maybe', min: 1, max: 20, start: 13, off: '다시 나눠요', on: (v) => `${v}부터` },
    trait: (v) => (v === null ? '모두 패스하면 다시 나눔' : `모두 패스하면 딜러가 ${v}부터 한 번 더`),
    weight: 1.4,
  },

  // 키티와 프렌드
  {
    path: 'bidding.change_trump_cost',
    group: 'friend',
    label: '기루다 바꾸기',
    help: '키티를 본 뒤 기루다를 바꾸면 공약에 이만큼 더해요',
    control: { kind: 'stepper', min: 0, max: 5, signed: true },
    say: (v) => (v ? `공약 +${v}` : '그냥 바꿔요'),
    trait: (v) => (v ? `기루다 바꾸기 +${v}` : '기루다 바꾸기 공짜'),
    weight: 5,
  },
  {
    path: 'bidding.change_to_no_trump_cost',
    group: 'friend',
    label: '노기루다로 바꿀 때',
    help: '켜면 노기루다로 바꿀 때만 공약 수에 이만큼 더해요',
    control: { kind: 'maybe', min: 0, max: 5, start: 1, off: '다른 무늬와 같아요', on: (v) => `공약 +${v}` },
    show: (r) => r.bidding.allow_no_trump,
    trait: (v) => (v === null ? null : `노기루다로 바꾸기 +${v}`),
    weight: 2,
  },
  {
    path: 'bidding.raise_on_exchange',
    group: 'friend',
    label: '키티 뒤 공약 올리기',
    help: '주공이 키티를 본 뒤, 버리기 전에 공약 수를 올릴 수 있어요',
    control: { kind: 'toggle', on: '돼요', off: '안 돼요' },
    trait: (v) => (v ? '키티 뒤 공약 올리기' : '키티 뒤 공약 못 올림'),
    weight: 1.4,
  },
  {
    path: 'reveal_discards',
    group: 'friend',
    label: '버린 카드 공개',
    help: '끄면 판이 끝나도 주공이 버린 카드는 주공만 알아요',
    control: { kind: 'toggle', on: '판 끝에 보여요', off: '주공만 알아요' },
    trait: (v) => (v ? '버린 카드 공개' : '버린 카드 비공개'),
    weight: 1,
  },
  {
    path: 'friend',
    group: 'friend',
    label: '프렌드 정하기',
    help: '주공이 프렌드를 정할 수 있는 방법이에요. 여러 개를 켤 수 있어요',
    control: { kind: 'flags', options: FRIEND_WAYS },
    trait: (v: Record<string, boolean>, base: Record<string, boolean> | undefined) => {
      const ways = FRIEND_WAYS.slice(0, 4);
      if (ways.every((w) => v[w.key] === (w.key === 'by_card'))) return '프렌드는 카드로만';
      const off = FRIEND_WAYS.filter((w) => !v[w.key] && (!base || base[w.key])).map((w) => w.label);
      const on = FRIEND_WAYS.filter((w) => v[w.key] && base && !base[w.key]).map((w) => w.label);
      return [off.length && `${off.join('·')} 프렌드 없음`, on.length && `${on.join('·')} 프렌드 있음`].filter(Boolean).join(' · ') || null;
    },
    // Only the last-trick friend differing is what every school has against 기본.
    weight: (v: Record<string, boolean>, base: Record<string, boolean> | undefined) =>
      FRIEND_WAYS.every((w) => w.key === 'last_trick' || v[w.key] === base?.[w.key]) ? 1.5 : 6,
  },

  // 카드의 힘
  {
    path: 'policy.mighty',
    group: 'power',
    label: '마이티',
    help: '첫 라운드와 마지막 라운드에 마이티를 어떻게 다루나요',
    control: { kind: 'rounds', options: POLICY },
    trait: roundsTrait('마이티', POLICY),
    weight: 6,
  },
  {
    path: 'policy.joker',
    group: 'power',
    label: '조커',
    help: '첫 라운드와 마지막 라운드에 조커를 어떻게 다루나요',
    control: { kind: 'rounds', options: POLICY },
    trait: roundsTrait('조커', POLICY),
    weight: 6,
  },
  {
    path: 'policy.trump',
    group: 'power',
    label: '기루다',
    help: '첫 라운드와 마지막 라운드에 기루다를 어떻게 다루나요',
    control: { kind: 'rounds', options: POLICY },
    trait: roundsTrait('기루다', POLICY),
    weight: 6,
  },
  {
    path: 'policy.release_with_mighty',
    group: 'power',
    label: '첫 라운드 기루다 예외에 마이티 포함',
    help: '첫 라운드에 막힌 기루다도 조커·마이티 말고 낼 게 없으면 낼 수 있어요. 끄면 마이티는 빼고 세서, 기루다 9장과 마이티면 마이티로 선을 내요',
    control: { kind: 'toggle', on: '포함해요', off: '빼요' },
    trait: (v) => (v ? '첫 선 예외에 마이티 포함' : '첫 선 예외에 마이티 빼요'),
    weight: 1,
  },
  {
    path: 'policy.joker_call',
    group: 'power',
    label: '조커콜',
    help: '첫 라운드와 마지막 라운드에 조커콜을 할 수 있나요',
    control: { kind: 'rounds', options: CALL_POLICY },
    trait: roundsTrait('조커콜', CALL_POLICY),
    weight: 2.5,
  },
  {
    path: 'joker_call.calls.0',
    group: 'power',
    label: '조커콜 카드',
    help: '이 카드로 라운드를 시작하며 콜하면 (흑)조커를 내야 해요',
    control: { kind: 'segment', options: callOptions(n('Club', 3), n('Spade', 3)) },
    trait: (v: [Card, Card]) => `조커콜 ${callOptions(v[0], v[1])[JSON.stringify(v[0]) === JSON.stringify(v[1]) ? 1 : 0].label}`,
    weight: 5,
  },
  {
    path: 'joker_call.calls.1',
    group: 'power',
    label: '홍조커콜 카드',
    help: '이 카드로 라운드를 시작하며 콜하면 홍조커를 내야 해요',
    control: { kind: 'segment', options: callOptions(n('Heart', 3), n('Diamond', 3)) },
    show: (r) => jokers(r).length > 1,
    trait: (v: [Card, Card], base: [Card, Card] | undefined) =>
      base ? `홍조커콜 ${cardLabel(v[0])}` : `조커콜 ${cardLabel(v[0])} 추가`,
    weight: 9,
  },
  {
    path: 'joker_call.mighty_defense',
    group: 'power',
    label: '마이티로 조커콜 막기',
    help: '조커콜을 받으면 조커 대신 마이티를 낼 수 있어요',
    control: { kind: 'toggle', on: '돼요', off: '안 돼요' },
    trait: (v) => (v ? '마이티로 조커콜 막기' : '마이티로 조커콜 못 막음'),
    weight: 5,
  },
  {
    path: 'joker_call.called_joker_has_power',
    group: 'power',
    label: '불려 나온 조커의 힘',
    help: '켜면 조커콜로 나온 조커도 라운드를 이길 수 있어요',
    control: { kind: 'toggle', on: '있어요', off: '없어요' },
    trait: (v) => (v ? '불려 나온 조커도 힘 있음' : '불려 나온 조커 힘 없음'),
    weight: 5,
  },
  {
    path: 'joker_lead.by_color',
    group: 'power',
    label: '조커로 색 부르기',
    help: '조커로 시작할 때 무늬 대신 빨강·검정을 정할 수 있어요',
    control: { kind: 'toggle', on: '돼요', off: '안 돼요' },
    trait: (v) => (v ? '조커로 색 부르기' : '조커는 무늬만 부름'),
    weight: 4,
  },
  {
    path: 'joker_lead.powerless_passes',
    group: 'power',
    label: '힘 없는 조커 선',
    help: '켜면 힘 없는 조커로 시작했을 때 다음 카드가 무늬를 정해요',
    control: { kind: 'toggle', on: '다음 카드가 정해요', off: '조커가 정해요' },
    trait: (v) => (v ? '힘 없는 조커 선은 넘김' : '힘 없는 조커도 무늬 정함'),
    weight: 4,
  },
  {
    path: 'joker_lead.not_first_trick',
    group: 'power',
    label: '첫 라운드 조커 선 금지',
    help: '주공은 첫 라운드를 조커로 시작할 수 없어요',
    control: { kind: 'toggle', on: '금지', off: '돼요' },
    trait: (v) => (v ? '첫 라운드 조커 선 금지' : '첫 라운드 조커 선 가능'),
    weight: 1.2,
  },

  // 점수
  {
    path: 'scoring.win',
    group: 'score',
    label: '이긴 점수',
    help: '여당이 공약을 이루면 야당 한 사람이 내는 점수예요. 두 배는 아래에서 따로 붙어요',
    control: { kind: 'segment', options: WIN, stack: true },
    say: (v: WinScore) => WIN.find((o) => same(o.value, v))?.label ?? winTrait(v),
    trait: winTrait,
    weight: 3,
  },
  {
    path: 'scoring.lose',
    group: 'score',
    label: '실패하면',
    help: '공약을 못 이루면 야당 한 사람에게 주는 점수예요. 갚으면 이겼을 때 받았을 점수를 내고 모자란 만큼 더 내요',
    control: { kind: 'segment', options: LOSE, stack: true },
    say: (v: LoseScore) => LOSE.find((o) => same(o.value, v))?.label ?? loseSay(v),
    trait: (v: LoseScore) => (v === 'Shortfall' ? '지면 모자란 만큼' : '지면 부른 만큼 갚고 모자란 만큼 더'),
    weight: 2.5,
  },
  {
    path: 'scoring.no_trump',
    group: 'score',
    label: '노기루다 두 배',
    help: '노기루다 공약이면 점수가 두 배예요',
    control: { kind: 'segment', options: DOUBLING },
    trait: doublingTrait('노기루다', '노기루다는'),
    weight: 1,
  },
  {
    path: 'scoring.alone',
    group: 'score',
    label: '노프렌드 두 배',
    help: '드러내고 혼자 하면 점수가 두 배예요. 가짜 프렌드는 해당 없어요',
    control: { kind: 'segment', options: DOUBLING },
    trait: doublingTrait('노프렌드', '노프렌드는'),
    weight: 1,
  },
  {
    path: 'scoring.full_contract',
    group: 'score',
    label: '공약 20 두 배',
    help: '공약이 20이면 점수가 두 배예요',
    control: { kind: 'segment', options: DOUBLING },
    trait: doublingTrait('공약 20', '공약 20은'),
    weight: 1,
  },
  {
    path: 'scoring.run',
    group: 'score',
    label: '런 두 배',
    help: '여당이 점수 카드 20장을 모두 가져가 이기면 두 배예요',
    control: { kind: 'toggle', on: '두 배', off: '그대로' },
    trait: (v) => (v ? '런 두 배' : '런 두 배 없음'),
    weight: 1,
  },
  {
    path: 'scoring.back_run',
    group: 'score',
    label: '백런',
    help: '여당이 지고 이렇게 되면 잃는 점수가 두 배예요',
    control: { kind: 'segment', options: BACK_RUN, stack: true },
    say: backRunSay,
    trait: (v: BackRun) => (v === 'Never' ? '백런 없음' : `백런: ${backRunSay(v)}`),
    weight: 1,
  },
  {
    path: 'scoring.discards_to_declarer',
    group: 'score',
    label: '버린 점수 카드는 여당 것',
    help: '끄면 주공이 버린 점수 카드는 야당 점수로 세요',
    control: { kind: 'toggle', on: '여당 것', off: '야당 것' },
    trait: (v) => (v ? '버린 점수 카드는 여당 것' : '버린 점수 카드는 야당 것'),
    weight: 2,
  },
];

// Paths

function parts(path: string): string[] {
  return path.split('.');
}

export function getPath(r: unknown, path: string): any {
  let v: any = r;
  for (const p of parts(path)) {
    if (v == null) return undefined;
    v = v[p];
  }
  return v;
}

export function setPath(r: Rules, path: string, value: unknown) {
  const ps = parts(path);
  let v: any = r;
  for (const p of ps.slice(0, -1)) v = v[p] ??= {};
  v[ps[ps.length - 1]] = structuredClone(value);
}

/** Sets a field and fixes up whatever depends on it. */
export function setField(r: Rules, field: Field, value: unknown) {
  setPath(r, field.path, value);
  field.apply?.(r);
}

/** JSON with object keys sorted, so key order never makes a difference. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1))) : x,
  );
}

export const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

export function shown(field: Field, r: Rules): boolean {
  return getPath(r, field.path) !== undefined && (field.show?.(r) ?? true);
}

/** The value in plain Korean. */
export function say(field: Field, r: Rules): string {
  const v = getPath(r, field.path);
  if (v === undefined || !(field.show?.(r) ?? true)) return '없음';
  if (field.say) return field.say(v, r);
  const c = field.control;
  switch (c.kind) {
    case 'toggle':
      return v ? c.on : c.off;
    case 'segment':
      return c.options.find((o) => same(o.value, v))?.label ?? '다른 값';
    case 'stepper':
      return c.signed ? signed(v) : String(v);
    case 'maybe':
      return v === null ? c.off : c.on(v);
    case 'flags': {
      const on = c.options.filter((o) => v[o.key]).map((o) => o.label);
      return on.length ? on.join(' · ') : '없음';
    }
    case 'rounds': {
      const word = (p: CardPolicy) => c.options.find((o) => o.value === p)?.label ?? p;
      return v.first === v.last ? `둘 다 ${word(v.first)}` : `첫 ${word(v.first)} · 마지막 ${word(v.last)}`;
    }
    case 'cardValues':
      return v.length ? v.map(([card, x]: [Card, number]) => `${cardLabel(card)} ${signed(x)}`).join(', ') : '없음';
  }
}

/** The fields whose values differ between two rule sets. */
export function differences(a: Rules, b: Rules): Field[] {
  return RULE_FIELDS.filter((f) => (shown(f, a) || shown(f, b)) && !same(getPath(a, f.path), getPath(b, f.path)));
}

/** Leaves that differ but that no field describes, such as a rule the
 * engine gained before this file did. Counted, never named in English. */
export function otherDifferences(a: Rules, b: Rules): number {
  const leaves = new Set<string>();
  const walk = (x: any, y: any, path: string) => {
    if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? `${path}.${k}` : k);
    } else if (!same(x, y)) leaves.add(path);
  };
  walk(a, b, '');
  const covered = (leaf: string) =>
    RULE_FIELDS.some((f) => leaf === f.path || leaf.startsWith(`${f.path}.`) || f.path.startsWith(`${leaf}.`));
  return [...leaves].filter((l) => !covered(l)).length;
}

/** Short traits of `r` against `base` (usually 기본), most telling first. */
export function traits(r: Rules, base: Rules): string[] {
  const out: { text: string; weight: number }[] = [];
  for (const f of differences(r, base)) {
    // A field the base hides, like the no-trump bonus without no-trump, is
    // implied by the trait that revealed it; one the base has no value for
    // at all, like a second joker's call card, is news of its own.
    const b = getPath(base, f.path);
    if ((!shown(f, base) && b !== undefined) || !shown(f, r)) continue;
    const v = getPath(r, f.path);
    const text = f.trait ? f.trait(v, b, r) : `${f.label} ${say(f, r)}`;
    const weight = typeof f.weight === 'function' ? f.weight(v, b) : (f.weight ?? 1);
    if (text && !out.some((o) => o.text === text)) out.push({ text, weight });
  }
  out.sort((x, y) => y.weight - x.weight);
  const other = otherDifferences(r, base);
  const list = out.map((o) => o.text);
  if (other) list.push(`그 밖의 규칙 ${other}개`);
  return list;
}

/** Why the server would refuse these rules, mirroring Rules::validate in
 * crates/mighty/src/rules.rs; each problem names the fields to fix. */
export function problems(r: Rules): { paths: string[]; message: string }[] {
  const out: { paths: string[]; message: string }[] = [];
  const lowest = r.lowest_rank;
  const extra = r.extra_cards;
  if (lowest < 2 || lowest > 10) out.push({ paths: [], message: RULE_TEXT.point_cards_missing });
  const rank = (c: Card) => ('Normal' in c ? c.Normal[1] : null);
  const distinct = new Set(extra.map((c) => JSON.stringify(c))).size === extra.length;
  if (!distinct || !extra.every((c) => (rank(c) ?? 99) < lowest))
    out.push({ paths: [], message: RULE_TEXT.bad_extra_cards });
  if (r.players < 2 || r.players > 8 || r.hand_size === 0) out.push({ paths: [], message: RULE_TEXT.table_size });
  if (r.players * r.hand_size > deckSize(r)) out.push({ paths: ['deck'], message: RULE_TEXT.too_few_cards });
  const inDeck = (c: Card) => (rank(c) ?? 99) >= lowest || extra.some((x) => same(x, c));
  if (!r.joker_call.calls.flat().every(inDeck))
    out.push({ paths: ['joker_call.calls.0', 'joker_call.calls.1'], message: RULE_TEXT.joker_call_not_in_deck });
  if (r.bidding.min === 0 || r.bidding.min > r.bidding.max)
    out.push({ paths: ['bidding.min', 'bidding.max'], message: RULE_TEXT.empty_bid_range });
  if (r.bidding.no_trump_bonus >= r.bidding.min)
    out.push({ paths: ['bidding.no_trump_bonus'], message: RULE_TEXT.no_trump_bonus_too_high });
  const lose = r.scoring.lose;
  if (lose !== 'Shortfall' && lose.PaysBack > lowestContract(r))
    out.push({ paths: ['scoring.lose'], message: RULE_TEXT.pays_back_too_much });
  if (r.joker_call.calls.length !== jokers(r).length)
    out.push({ paths: ['deck'], message: RULE_TEXT.joker_call_per_joker });
  const f = r.friend;
  if (f && !(f.by_card || f.by_seat || f.first_trick || f.last_trick || f.alone))
    out.push({ paths: ['friend'], message: RULE_TEXT.no_friend_rule });
  return out;
}
