/** Structural session contracts: no renderer, framework, or game payload dependencies. */
export type SessionBotLevel = 'easy' | 'normal' | 'hard';
export type SessionSeat = { kind: 'empty' } | { kind: 'bot'; name: string; level: SessionBotLevel } | { kind: 'human'; name: string; connected: boolean; away: boolean };
export interface SessionRoom {
  seats: SessionSeat[];
  in_hand: boolean;
  ready?: boolean[];
  participant_ids?: string[];
  participation?: { id: string; seat: number | null; target_id: string | null }[];
  table: { shuffle: boolean; shuffle_next: boolean };
}
export interface SessionClient {
  readonly seat: number | null;
  readonly viewerId: string | null;
  readonly viewerName: string;
  readonly status: 'connecting' | 'open' | 'closed' | 'missing';
  observe(name: string): void;
  join(name: string, seat?: number): void;
  requestSeat(requested: boolean, seat?: number): void;
  acceptSeat(seat: number, targetId: string): void;
  notice(text: string): void;
  swapSeats(a: number, b: number): void;
  addBot(seat: number, level?: SessionBotLevel): void;
  removeBot(seat: number): void;
  clearSeat(seat: number): void;
  leave(): void;
  start(): void;
  ready(ready: boolean): void;
  setTable(table: { shuffle?: boolean; shuffle_next?: boolean }): void;
}
export interface SessionUi {
  participationSeat: number | null;
  swapFrom: number | null;
  seatMenu: number | null;
  closeSeat(): void;
}
export interface SessionState {
  visitorBottom: number | null;
  choosing: boolean;
  previewSeat: number | null;
  sitName: string;
  settling: boolean;
}
export interface SessionOptions { initialBottom?: number; getSettling?: () => boolean }
export function createSessionState(name: string, initialBottom?: number): SessionState {
  return { visitorBottom: initialBottom ?? null, choosing: false, previewSeat: null, sitName: name, settling: false };
}

/** Bots do not add preparation steps; pending admissions must settle first. */
export function sessionPreparation(room: SessionRoom | null, me: number | null) {
  const humans = room?.seats.flatMap((s, i) => s.kind === 'human' ? [{ name: s.name, seat: i, ready: !!room.ready?.[i] }] : []) ?? [];
  const full = room?.seats.every(s => s.kind !== 'empty') ?? false;
  const pending = !!room?.participation?.some(p => p.seat !== null);
  const solo = humans.length === 1;
  const mineReady = me !== null && (room?.ready?.[me] ?? true);
  const allReady = full && (room?.ready?.every(Boolean) ?? true);
  const awaited = humans.filter(h => !h.ready && h.seat !== me).map(h => h.name);
  return { full, pending, solo, mineReady, allReady, humans, awaited,
    waiting: pending ? '참여할 자리를 확인하는 중' : mineReady && awaited.length ? `${awaited.join(', ')}님 준비 기다리는 중` : humans.length > 1 ? `플레이어 준비 ${humans.filter(h => h.ready).length}/${humans.length}` : '' };
}

/** Room admission and seat commands, independent of a game's hand renderer. */
export class SessionCore {
  get visitorBottom() { return this.state.visitorBottom; }
  set visitorBottom(value: number | null) { this.state.visitorBottom = value; }
  get choosing() { return this.state.choosing; }
  set choosing(value: boolean) { this.state.choosing = value; }
  get previewSeat() { return this.state.previewSeat; }
  set previewSeat(value: number | null) { this.state.previewSeat = value; }
  get sitName() { return this.state.sitName; }
  set sitName(value: string) { this.state.sitName = value; }
  get settling() { return this.state.settling; }
  set settling(value: boolean) { this.state.settling = value; }
  #pendingNameAction: { name: string; action: () => void } | null = null;
  #previewTarget: string | null = null;
  #previousBottom: number | null = null;
  #lastViewerName: string;

  constructor(
    readonly client: SessionClient,
    readonly ui: SessionUi,
    private readonly getRoom: () => SessionRoom | null,
    private readonly options: SessionOptions = {},
    readonly state: SessionState = createSessionState(client.viewerName, options.initialBottom),
  ) {
    this.#lastViewerName = client.viewerName;
    this.initializeBottom();
  }

  get room() { return this.getRoom(); }
  get bottom() { return this.client.seat ?? this.visitorBottom ?? 0; }
  get arranging() { return !(this.room?.in_hand ?? false) && !(this.options.getSettling?.() ?? this.settling); }
  get centered() { return this.arranging; }
  get prep() { return sessionPreparation(this.room, this.client.seat); }
  advance() { this.prep.solo || this.prep.allReady ? this.client.start() : this.client.ready(!this.prep.mineReady); }
  setShuffle(on: boolean) { this.client.setTable({ shuffle: on, shuffle_next: false }); }
  get shuffleNote() {
    return this.room?.table.shuffle ? '매 판 시작할 때 자리를 섞어요'
      : this.room?.table.shuffle_next ? '다음 판 시작할 때 자리를 섞어요' : null;
  }

  private initializeBottom() {
    if (this.visitorBottom !== null || !this.room) return;
    const open = this.room.seats.findIndex(s => s.kind === 'empty' || s.kind === 'bot');
    this.visitorBottom = open < 0 ? 0 : open;
  }

  /** Also callable by deterministic drivers without a mounted renderer. */
  sync() {
    this.initializeBottom();
    const viewerName = this.client.viewerName;
    if (viewerName !== this.#lastViewerName) {
      if (this.sitName === this.#lastViewerName) this.sitName = viewerName;
      this.#lastViewerName = viewerName;
    }
    if (this.client.seat !== null) this.visitorBottom = this.client.seat;
    if (!this.arranging) {
      this.ui.closeSeat();
      this.ui.swapFrom = null;
    }
    if (this.ui.participationSeat !== null) {
      const seat = this.ui.participationSeat;
      this.ui.participationSeat = null;
      this.sitAt(seat);
    }
    const pending = this.#pendingNameAction;
    if (pending && this.client.viewerName === pending.name) {
      this.#pendingNameAction = null;
      pending.action();
    }
  }

  /** Every observer entry point waits for the server to acknowledge its name. */
  withName(action: () => void) {
    const name = this.sitName.trim();
    if (!name || this.client.status !== 'open') return;
    if (name === this.client.viewerName) {
      this.#pendingNameAction = null;
      action();
      return;
    }
    this.#pendingNameAction = { name, action };
    this.client.observe(name);
  }

  seatsMoved() {
    this.ui.closeSeat();
    this.ui.swapFrom = null;
    if (this.previewSeat !== null) this.cancelChoice();
  }
  choose() { this.choosing = true; }
  cancelChoice() {
    this.#pendingNameAction = null;
    if (this.#previousBottom !== null) this.visitorBottom = this.#previousBottom;
    this.#previousBottom = null;
    this.previewSeat = null;
    this.#previewTarget = null;
    this.choosing = false;
  }

  openSeat(seat: number) {
    if (this.client.seat === null) { this.sitAt(seat); return; }
    if (!this.arranging) return;
    if (this.ui.swapFrom !== null) {
      if (seat !== this.ui.swapFrom) this.client.swapSeats(this.ui.swapFrom, seat);
      this.ui.swapFrom = null;
      return;
    }
    if (this.room?.seats[seat]) this.ui.seatMenu = seat;
  }

  sitAt(seat: number) {
    if (this.client.seat !== null) return;
    const room = this.room;
    const info = room?.seats[seat];
    const own = room?.participation?.find(p => p.id === this.client.viewerId);
    if (!info || info.kind === 'human' && own?.seat !== seat) return;
    if (room?.participation?.some(p => p.seat === seat && p.id !== this.client.viewerId)) {
      this.client.notice('이 자리는 다른 분이 확인하는 중이에요');
      return;
    }
    this.choosing = false;
    if (seat === this.bottom) { this.commitChoice(seat); return; }
    this.#previousBottom = this.visitorBottom;
    this.visitorBottom = seat;
    this.previewSeat = seat;
    this.#previewTarget = room?.participant_ids?.[seat] ?? `empty:${seat}`;
  }

  commitChoice(seat: number) {
    const target = this.room?.participant_ids?.[seat] ?? `empty:${seat}`;
    this.withName(() => this.commitNamedChoice(seat, target));
  }

  private commitNamedChoice(seat: number, target: string) {
    const room = this.room;
    if (!room || this.client.seat !== null) return;
    if (target !== (room.participant_ids?.[seat] ?? `empty:${seat}`)) {
      this.cancelChoice();
      this.client.notice('자리가 바뀌었어요. 참여할 자리를 다시 골라주세요');
      return;
    }
    const own = room.participation?.find(p => p.id === this.client.viewerId);
    if (room.participation?.some(p => p.seat === seat && p.id !== this.client.viewerId)) {
      this.client.notice('이 자리는 다른 분이 확인하는 중이에요');
      return;
    }
    if (!room.seats[seat] || room.seats[seat].kind === 'human' && own?.seat !== seat) return;
    if (room.in_hand) this.client.requestSeat(true, seat);
    else if (own?.seat === seat && own.target_id) this.client.acceptSeat(seat, own.target_id);
    else this.client.join(this.client.viewerName, seat);
    this.previewSeat = null;
    this.#previewTarget = null;
    this.#previousBottom = null;
    this.choosing = false;
  }

  confirmChoice() {
    if (this.previewSeat === null) return;
    const current = this.room?.participant_ids?.[this.previewSeat] ?? `empty:${this.previewSeat}`;
    if (this.#previewTarget !== current) {
      this.cancelChoice();
      this.client.notice('자리가 바뀌었어요. 참여할 자리를 다시 골라주세요');
      return;
    }
    this.commitChoice(this.previewSeat);
  }

  private mayManageSeat(seat: number) {
    if (!this.arranging || this.client.seat === null || !this.room?.seats[seat]) return false;
    if (this.room.participation?.some(p => p.seat === seat)) {
      this.client.notice('이 자리는 다른 분이 확인하는 중이에요');
      return false;
    }
    return true;
  }
  private mayAddBot(seat: number) {
    if (!this.mayManageSeat(seat)) return false;
    const info = this.room!.seats[seat];
    return info.kind === 'empty' || info.kind === 'bot' || !info.connected;
  }
  addBot(seat: number, level?: SessionBotLevel) {
    if (!this.mayAddBot(seat)) return;
    const wasBot = this.room!.seats[seat].kind === 'bot';
    this.client.addBot(seat, level);
    if (!wasBot) this.ui.closeSeat();
  }
  swap(seat: number) {
    if (!this.arranging || this.client.seat === null) return;
    this.ui.swapFrom = seat;
    this.ui.closeSeat();
  }
  moveHere(seat: number) {
    if (!this.arranging || this.client.seat === null) return;
    this.client.swapSeats(this.client.seat, seat);
    this.ui.closeSeat();
  }
  removeBot(seat: number) {
    if (!this.mayManageSeat(seat) || this.room!.seats[seat].kind !== 'bot') return;
    this.client.removeBot(seat);
    this.ui.closeSeat();
  }
  kick(seat: number) {
    if (!this.arranging || this.client.seat === null) return;
    this.client.clearSeat(seat);
    this.ui.closeSeat();
  }
  relieve(seat: number) {
    if (!this.mayAddBot(seat)) return;
    this.client.addBot(seat);
    this.ui.closeSeat();
  }
  stand() {
    if (!this.arranging || this.client.seat === null) return;
    this.visitorBottom = this.client.seat;
    this.client.leave();
    this.ui.closeSeat();
  }
}
