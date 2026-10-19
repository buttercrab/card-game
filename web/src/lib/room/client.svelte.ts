import {deliveryIssue,isNativeCapacityResponse,type DeliveryIssue} from './delivery';
import {readActionPolicy,policyAllowsAction} from './actionPolicy';
import {capacityAllows,capacityAllowsRoomAction} from './capacity';
import {captureNativeAdvice,captureNativeReaction,nativeAdviceCurrent,type NativeAdvice,type NativeAdviceAuthority,type NativeReaction} from './ephemeral';
import {createCommandTransport} from './commandTransport';
import type {CommandWindow} from '../generated/protocol';
import type {RecoverySnapshot,RecoveryRecord} from './commandTransport';
import { CATALOG } from '../catalog';
import { errorText } from '../errorText';
import { sound } from '../sound';
import type { TableClient } from './tableClient';
import { Toasts } from './toast.svelte';
import { participationNotice } from './participation';
import type { BotLevel, ClientMsgOf, GameTypes, RoomViewOf, ServerMsgOf, SessionMsgOf, StateMsgOf } from './types';

interface Saved {
  token: string;
  name: string;
}

const NAME_KEY = 'name';

/** A random id for this browser, so the anonymous stats can tell a player
 * who comes back to a new table. The server keeps only a salted hash. */
function device(): string | null {
  try {
    let id = localStorage.getItem('mighty.device');
    if (!id) localStorage.setItem('mighty.device', (id = crypto.randomUUID()));
    return id;
  } catch {
    return null;
  }
}

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Private windows may refuse storage; the seat just won't survive a reload.
    return false;
  }
}

export function savedName(): string {
  return load<string>(NAME_KEY) ?? '';
}

/** A live connection to one room, for any game `G`. Reconnects and
 * reclaims its seat on its own. */
export class RoomClient<G extends GameTypes = GameTypes> implements TableClient<G> {
  /** The table: the latest room message with the latest session's scores
   * and hands (the server sends the session only when it changes). */
  room = $state<RoomViewOf<G> | null>(null);
  game = $state<StateMsgOf<G> | null>(null);
  seat = $state<number | null>(null);
  viewerId = $state<string | null>(null);
  viewerName = $state('');
  /** Terminal oversize requires explicit reload; backpressure remains recoverable. */
  deliveryIssue = $state<DeliveryIssue|null>(null);
  observerReactions = $state<Record<string, { text: string; id: number }>>({});
  /** The toast: the server's errors, which sound, and the table's notices, which don't. */
  toasts = new Toasts((t) => {
    if (t.kind === 'error' && this.#feedback === 'legacy') sound.error();
  });
  status = $state<'connecting' | 'open' | 'closed' | 'missing'>('connecting');
  /** The latest reaction per seat, cleared after a few seconds. `id` restarts its animation. */
  reactions = $state<Record<number, { text: string; id: number }>>({});
  /** What the bot would do in your place, until the hand moves on. */
  hint = $state<G['action'] | null>(null);
  /** Private response authority captured at receipt, never reconstructed from hint. */
  nativeHint = $state<NativeAdvice<G['action']> | null>(null);
  nativeReactions = $state<readonly NativeReaction[]>([]);
  get ephemeralConnectionEpoch():string { return String(this.#commandConnection); }
  /** The turn timer, with its deadline on this page's clock (performance.now()). */
  clock = $state<{ seat: number; deadline: number; total: number } | null>(null);
  /** Finished hands here go into this browser's record (내 기록). */
  readonly keepsRecord = true;

  /** Called as seats are about to move, while the table still shows them
   * where they were; `order[s]` is where seat `s` goes. */
  onmove: ((order: number[]) => void) | null = null;
  /** The game's own words for a refusal it alone makes; see TableClient. */
  refusal: TableClient<G>['refusal'] = null;

  readonly commands: ReturnType<typeof createCommandTransport<G['action'],G['settings']>>;
  commandRecovery = $state<RecoverySnapshot>({ready:false,pending:0,recovering:0,storageError:false,capacity:false});
  #commandConnection = 0;
  #stateConnection = -1;
  #sessionConnection = -1;
  #publicSessionSource = $state.raw<object|null>(null);
  /** Opaque publication identity, independent of Svelte's nested Room proxies.
   * Every Session packet replaces it, including same-count content changes. */
  get publicSessionSource():object|null { return this.#publicSessionSource; }
  roomCommandWindow = $state<CommandWindow | null>(null);
  sessionRoomVersion = $state<number | undefined>(undefined);
  /** Shared publication gate: adapters never pair packets from different commits. */
  publicationReady = $state(false);
  /** Strict current public checkpoint for read-only settled fallback, never game admission. */
  roomPublicationReady = $state(false);
  #authenticated = false;
  #pendingReclaim: Saved | null = null;
  #nameAdoption: RecoveryRecord | null = null;
  #feedback:'legacy'|'external';
  #id: string;
  #ws: WebSocket | null = null;
  #closed = false;
  /** The server said the table is gone: the client stays on "missing". */
  #gone = false;
  #retry = 500;
  /** The pending reconnect, cancelled by close(). */
  #reconnect: ReturnType<typeof setTimeout> | undefined;
  /** Each reaction's clearing timer, cancelled by close(). */
  #reactionTimers = new Set<ReturnType<typeof setTimeout>>();
  #reactionId = 0;
  /** Seats are moving: the server said where they went, and this tab's new
   * seat waits for the room that seats everyone there, so the table never
   * draws the new seat over the old seating for a moment. */
  #moving = false;
  #movedSeat: number | null = null;
  /** 시작 was pressed and the room has not answered yet. */
  #starting = false;
  /** The first snapshot on each connection is a baseline, not an arrival. */
  #receivedRoom = false;
  /** The latest session; the server sends it on connecting and when it changes. */
  #session: SessionMsgOf<G> = { scores: [], hands_played: 0, history: [], hands: [] };

  constructor(id: string,options:{feedback?:'legacy'|'external'}={}) {
    this.#feedback=options.feedback??'legacy';
    this.#id = id;
    const recoveryKey = `card.commands.v1:${id}`;
    this.commands = createCommandTransport<G['action'],G['settings']>({room:id,send:message=>this.#send(message),store:{
      read:()=>{const raw=sessionStorage.getItem(recoveryKey);return raw?JSON.parse(raw):[];},
      write:records=>sessionStorage.setItem(recoveryKey,JSON.stringify(records)),
    }});
    this.commands.subscribe(snapshot=>{this.commandRecovery=snapshot;});
    this.commands.onCompletion(({record,status})=>{
      if(status!=='accepted'||record.completion!=='adopt-name')return;
      this.#nameAdoption=record;
      this.#adoptAuthoritativeName();
    });
    this.#connect();
  }

  get #key() {
    return `room:${this.#id}`;
  }

  #connect() {
    this.#reconnect = undefined;
    // A closed client never opens another socket: a reconnect that was
    // already due, or one scheduled across an await, stops here.
    if (this.#closed) return;
    this.#receivedRoom = false;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/api/rooms/${this.#id}/ws`);
    this.#ws = ws;
    this.#commandConnection++;
    this.#clearNativeEphemeral();
    this.#authenticated = false;
    this.#pendingReclaim = null;
    this.roomCommandWindow = null;
    this.sessionRoomVersion = undefined;
    this.status = 'connecting';
    this.#refreshCommands();
    let opened = false;

    ws.onopen = () => {
      if (this.#closed || this.#ws !== ws) return;
      opened = true;
      this.status = 'open';
      this.#refreshCommands();
      this.#moving = false;
      this.#movedSeat = null;
      this.#starting = false;
      this.deliveryIssue = null;
      const visitor = load<{ token: string }>(`visitor:${this.#id}`);
      const saved = load<Saved>(this.#key);
      this.#pendingReclaim = saved?.token ? saved : null;
      // A remembered visitor authenticates an existing identity, rather than
      // overwriting an accepted server name with a stale local preference.
      this.#send({ type: 'observe', name: visitor?.token ? '' : savedName(), token: visitor?.token ?? null });
    };
    ws.onmessage = (event) => {
      if (!this.#closed && this.#ws === ws && ws.readyState === WebSocket.OPEN) {
        this.#receive(JSON.parse(event.data) as ServerMsgOf<G>);
      }
    };
    ws.onclose = async (event) => {
      if (this.#closed || this.#gone || this.#ws !== ws) return;
      const issue=deliveryIssue(event);
      if(issue==='oversize'){
        this.#stopUnavailable(issue);
        return;
      }
      this.deliveryIssue=issue;
      if (!opened) {
        const exists = await this.#availability();
        // Left (or unmounted) while asking: stay closed.
        if (this.#closed || this.#ws !== ws) return;
        if(exists==='capacity'){this.#stopUnavailable('capacity');return;}
        if (exists==='missing') {
          this.status = 'missing';
          return;
        }
      }
      this.status = 'closed';
      this.#clearNativeEphemeral();
      this.seat = null;
      this.#authenticated=false;
      this.#refreshCommands();
      clearTimeout(this.#reconnect);
      this.#reconnect = setTimeout(() => this.#connect(), this.#retry);
      this.#retry = Math.min(this.#retry * 2, 8000);
    };
  }

  /** Only the server's own "not found" means the table is gone. While the
   * server restarts (a deploy), the proxy answers 502 and the fetch may fail
   * outright: keep retrying, and the seat token reclaims the seat after. */
  async #availability(): Promise<'available'|'missing'|'capacity'> {
    try {
      const response=await fetch(`/api/rooms/${this.#id}`);
      return response.status===404?'missing':await isNativeCapacityResponse(response)?'capacity':'available';
    } catch {
      return 'available';
    }
  }

  #stopUnavailable(issue:'oversize'|'capacity'){
    this.#closed=true;this.status='closed';this.deliveryIssue=issue;this.#authenticated=false;
    this.#pendingReclaim=null;this.#nameAdoption=null;this.seat=null;this.game=null;this.roomCommandWindow=null;
    this.#clearNativeEphemeral();this.hint=null;this.reactions={};this.observerReactions={};
    for(const timer of this.#reactionTimers)clearTimeout(timer);this.#reactionTimers.clear();
    clearTimeout(this.#reconnect);this.#reconnect=undefined;this.#refreshCommands();
    // Keep payload-free persistent recovery evidence for a later manual reload.
  }

  #receive(msg: ServerMsgOf<G>) {
    switch (msg.type) {
      case 'session': {
        this.#publicSessionSource=Object.freeze({});
        this.#sessionConnection=this.#commandConnection;
        this.sessionRoomVersion=msg.room_version;
        this.#session = { scores: msg.scores, hands_played: msg.hands_played, history: msg.history, hands: msg.hands, session_id: msg.session_id, ended: msg.ended, records: msg.records, standings: msg.standings, archives: msg.archives, current_hand: msg.current_hand };
        // While seats move, the room that moves them brings the scores along.
        if (this.room && !this.#moving) this.room = { ...this.room, ...this.#session };
        break;
      }
      case 'room': {
        if (this.#receivedRoom && this.room && this.viewerId) {
          const notice = participationNotice(this.room, msg, this.viewerId);
          if (notice) this.notice(notice);
        }
        this.#receivedRoom = true;
        this.room = { ...msg, ...this.#session };
        this.#starting = false;
        if (this.#moving) {
          this.#moving = false;
          if (this.#movedSeat !== null) this.seat = this.#movedSeat;
          this.#movedSeat = null;
        }
        const c = msg.clock;
        // Kept while it is the same turn, so the ring does not jump with
        // each message's few milliseconds of travel.
        const deadline = c ? performance.now() + c.ms : 0;
        const was = this.clock;
        if (!c) this.clock = null;
        else if (!was || was.seat !== c.seat || was.total !== c.total_ms || Math.abs(was.deadline - deadline) > 400)
          this.clock = { seat: c.seat, deadline, total: c.total_ms };
        // The seats were moved and the last hand put away.
        if (msg.showing === false && !msg.in_hand) this.game = null;
        break;
      }
      case 'state':
        this.#stateConnection=this.#commandConnection;
        this.game = msg;
        this.hint = null;
        this.nativeHint = null;
        break;
      case 'hint':
        // Asked for a state the hand has since moved on from: no longer true.
        if (this.game && msg.version === this.game.version) this.hint = msg.action;
        this.nativeHint = captureNativeAdvice(this.#nativeAuthority(),msg.version,msg.action);
        break;
      case 'visitor_welcome': {
        if(this.viewerId!==msg.id||this.seat!==msg.seat)this.#clearNativeEphemeral();
        this.#authenticated=true;
        this.seat = msg.seat;
        this.viewerId = msg.id; this.viewerName = msg.name;
        store(`visitor:${this.#id}`, { token: msg.token, name: msg.name });
        if (msg.seat !== null) {
          const seated = load<Saved>(this.#key);
          if (seated?.token) store(this.#key, { ...seated, name: msg.name });
        }
        const reclaim=this.#pendingReclaim;this.#pendingReclaim=null;
        // Reclaim only after this socket's authoritative identity response.
        // A concurrent leave may have erased the saved credential meanwhile.
        if(reclaim?.token&&msg.seat===null&&load<Saved>(this.#key)?.token===reclaim.token)
          this.#send({type:'join',name:msg.name,token:reclaim.token,device:device(),reclaim:true});
        break;
      }
      case 'observer_reaction': {
        const id = ++this.#reactionId;
        this.observerReactions[msg.id] = { text: msg.text, id };
        this.#nativeReaction(id,msg.id,msg.text,true);
        const timer = setTimeout(() => { this.#reactionTimers.delete(timer); if (this.observerReactions[msg.id]?.id === id) delete this.observerReactions[msg.id]; this.#expireNativeReaction(id); }, 2800);
        this.#reactionTimers.add(timer);
        break;
      }
      case 'welcome': {
        const authoritativeName = this.#authenticated && this.viewerId && this.seat === msg.seat ? this.viewerName : null;
        if (this.#moving) this.#movedSeat = msg.seat;
        else this.seat = msg.seat;
        const name = authoritativeName ?? load<Saved>(this.#key)?.name ?? savedName();
        store(this.#key, { token: msg.token, name } satisfies Saved);
        break;
      }
      case 'unseated':
        this.#clearNativeEphemeral();
        this.seat = null;
        this.#movedSeat = null;
        this.#forget();
        break;
      case 'seats_moved': {
        // The table on screen notes where each seat is before it changes:
        // it slides them to their new places. `order[s]` is where seat `s` went.
        const n = this.room?.seats.length ?? 0;
        const order =
          msg.how === 'shuffle'
            ? msg.order
            : Array.from({ length: n }, (_, s) => (s === msg.seats[0] ? msg.seats[1] : s === msg.seats[1] ? msg.seats[0] : s));
        this.onmove?.(order);
        this.#moving = true;
        // A reaction still showing moves with its seat.
        const moved: typeof this.reactions = {};
        for (const [seat, r] of Object.entries(this.reactions)) moved[order[Number(seat)] ?? Number(seat)] = r;
        this.reactions = moved;
        // The table on screen was drawn for the old seats; the next hand
        // (or the room) draws afresh.
        this.game = null;
        this.hint = null;
        this.nativeHint = null;
        this.notice(msg.how === 'shuffle' ? '자리를 섞었어요' : '자리를 바꿨어요');
        break;
      }
      case 'reaction': {
        const id = ++this.#reactionId;
        this.reactions[msg.seat] = { text: msg.text, id };
        this.#nativeReaction(id,this.room?.participant_ids?.[msg.seat]??null,msg.text,false);
        if(this.#feedback==='legacy')sound.react();
        // By its id, wherever its seat has moved since.
        const timer = setTimeout(() => {
          this.#reactionTimers.delete(timer);
          for (const [seat, r] of Object.entries(this.reactions)) if (r.id === id) delete this.reactions[Number(seat)];
          this.#expireNativeReaction(id);
        }, 2800);
        this.#reactionTimers.add(timer);
        break;
      }
      case 'room_command_window':
        this.roomCommandWindow=msg.command;
        break;
      case 'operation_receipt':
        this.commands.receive(msg);
        break;
      case 'error':
        // The table closed as this tab came back: nothing to reconnect to.
        if (msg.code === 'table_gone') {
          this.#gone = true;
          this.status = 'missing';
          break;
        }
        this.#starting = false;
        this.toasts.show('error', errorText(msg, this.refusal ?? undefined));
        break;
    }
    this.#refreshCommands();
  }

  #refreshCommands() {
    const window=this.#stateConnection===this.#commandConnection?this.game?.command:null;
    const actor=this.#authenticated?this.viewerId:null;
    const roomWindow=this.roomCommandWindow;
    const revision=this.room?.room_version;
    const sessionMatches=revision===undefined||this.sessionRoomVersion===undefined||this.sessionRoomVersion<=revision;
    const stateMatches=sessionMatches&&(revision===undefined||this.game?.room_version===revision);
    const roomMatches=sessionMatches&&(revision===undefined||roomWindow?.scope.version===revision);
    const gameWindow=stateMatches&&window&&window.scope.actor_id===actor&&window.scope.room_id===this.#id&&window.scope.seat===this.seat?window:null;
    const currentRoomWindow=roomMatches&&roomWindow?.scope.actor_id===actor&&roomWindow.scope.room_id===this.#id&&roomWindow.scope.seat===this.seat?roomWindow:null;
    const publicReady=this.status==='open'&&!this.#closed&&this.#receivedRoom&&sessionMatches&&!!currentRoomWindow;
    // A stale session is harmless to ordinary game publication when current
    // State proves the commit. Without State, require this socket's exact
    // public checkpoint rather than guessing which completed record it names.
    this.roomPublicationReady=publicReady&&this.#sessionConnection===this.#commandConnection&&
      this.room?.session_id===currentRoomWindow?.scope.session_id&&(revision===undefined||this.sessionRoomVersion===revision);
    this.publicationReady=publicReady&&(!this.room?.showing||this.#stateConnection===this.#commandConnection&&stateMatches);
    if(this.publicationReady||this.roomPublicationReady)this.#retry=500;
    this.commands.update({connected:this.status==='open'&&!this.#closed,connection:this.#commandConnection,actor,
      window:gameWindow,roomWindow:currentRoomWindow});
    if(this.nativeHint&&!nativeAdviceCurrent(this.nativeHint,this.#nativeAuthority()))this.nativeHint=null;
    if(this.status!=='open'||!this.#authenticated)this.nativeReactions=[];
    const epoch=this.roomCommandWindow?.scope.room_epoch;
    if(epoch)this.nativeReactions=this.nativeReactions.filter(record=>record.roomEpoch===epoch&&record.connectionEpoch===this.ephemeralConnectionEpoch);
    this.#adoptAuthoritativeName();
  }

  #nativeAuthority():NativeAdviceAuthority<G['action']> {
    const view=this.game?.view as {viewer?:unknown}|undefined;
    const viewer=view?.viewer;
    return {connectionEpoch:this.ephemeralConnectionEpoch,publicationReady:this.publicationReady,connected:this.status==='open'&&this.#authenticated&&!this.#closed,actorId:this.viewerId,seat:this.seat,roomId:this.#id,participantId:this.seat===null?null:this.room?.participant_ids?.[this.seat]??null,
      command:this.#stateConnection===this.#commandConnection?this.game?.command?.scope??null:null,gameVersion:this.room?.in_hand&&this.room.showing?this.game?.version??null:null,viewerSeat:viewer&&typeof viewer==='object'&&'Seat' in viewer?Number(viewer.Seat):null,turnSeat:this.game?.turn&&typeof this.game.turn==='object'?'Seat' in this.game.turn?this.game.turn.Seat:null:null,legal:this.game?readActionPolicy(this.game).legal:[]};
  }

  #clearNativeEphemeral(){this.nativeHint=null;this.nativeReactions=[];}
  #reactionEventId(id:number){return `reaction:${this.ephemeralConnectionEpoch}:${id}`;}
  #expireNativeReaction(id:number){const eventId=this.#reactionEventId(id);this.nativeReactions=this.nativeReactions.filter(record=>record.eventId!==eventId);}
  #nativeReaction(id:number,participantId:string|null,text:string,observer:boolean){
    const scope=this.roomCommandWindow?.scope;
    if(!this.publicationReady||!scope||!participantId||!this.room||scope.actor_id!==this.viewerId||scope.room_id!==this.#id||
      (observer?!this.room.observers?.some(person=>person.id===participantId):!this.room.participant_ids?.includes(participantId)))return;
    const record=captureNativeReaction({eventId:this.#reactionEventId(id),participantId,text,roomId:this.#id,roomEpoch:scope.room_epoch,connectionEpoch:this.ephemeralConnectionEpoch},CATALOG.reactions);
    if(record)this.nativeReactions=[...this.nativeReactions.filter(prior=>prior.participantId!==participantId),record];
  }

  #adoptAuthoritativeName(){
    const record=this.#nameAdoption;if(!record)return;
    if(this.#closed){this.#nameAdoption=null;return;}
    if(!this.#authenticated)return;
    const scope=this.roomCommandWindow?.scope;
    if(this.viewerId!==record.expected.actor_id||scope&&scope.room_epoch!==record.expected.room_epoch){this.#nameAdoption=null;return;}
    if(!this.publicationReady||!scope||scope.room_id!==record.expected.room_id||scope.actor_id!==record.expected.actor_id||
      scope.version<=record.expected.version||this.roomCommandWindow!.next_sequence<=record.sequence)return;
    if(this.persistAcceptedName(this.viewerName))this.#nameAdoption=null;
  }

  #send(msg: ClientMsgOf<G>): boolean {
    if (this.#ws?.readyState !== WebSocket.OPEN) return false;
    if(!capacityAllowsRoomAction(this.room,msg.type==='submit_room'?msg.action:msg))return false;
    if((msg.type==='act'||msg.type==='submit'||msg.type==='hint')&&!capacityAllows(this.room,'can_play'))return false;
    // A current server policy applies to both legacy Act and scoped Submit.
    // Omitted legacy policy keeps its existing transport behavior. No refused
    // action is replaced with Pass or another game command.
    const policy=this.game?Object.getOwnPropertyDescriptor(this.game,'policy_actions'):undefined;
    if((msg.type==='act'||msg.type==='submit')&&this.game&&policy&&(!('value'in policy)||policy.value!==undefined)&&!policyAllowsAction(this.game,msg.action,this.seat!==null&&typeof this.game.turn==='object'&&this.game.turn.Seat===this.seat))return false;
    if(msg.type==='hint'&&this.game&&policy&&(!('value'in policy)||policy.value!==undefined)&&!readActionPolicy(this.game).legal.length)return false;
    this.#ws.send(JSON.stringify(msg));
    return true;
  }

  join(name: string, seat?: number) {
    store(NAME_KEY, name);
    const saved = load<Saved>(this.#key);
    store(this.#key, { token: saved?.token ?? '', name });
    this.#send({ type: 'join', name, token: saved?.token || null, seat: seat ?? null, device: device() });
  }

  /** Gives up this tab's seat, and forgets its token even when not seated
   * just now (the link dropped), so a reconnect can never reclaim it. */
  leave() {
    if (this.seat !== null) this.#send({ type: 'leave' });
    this.forgetSeatCredential();
  }

  /** Local cleanup after a correlated leave receipt; never sends another mutation. */
  forgetSeatCredential() {
    this.#pendingReclaim = null;
    this.#clearNativeEphemeral();
    this.seat = null;
    this.#movedSeat = null;
    this.#forget();
  }

  /** Drops this table's seat token, keeping the name for the next seat. */
  #forget() {
    const name = load<Saved>(this.#key)?.name;
    try {
      localStorage.removeItem(this.#key);
    } catch {
      // Nothing to forget.
    }
    if (name) store(NAME_KEY, name);
  }

  /** Local preference update after the caller has a scoped accepted rename.
   * VisitorWelcome remains the authority; no draft or mutation is sent here. */
  persistAcceptedName(name: string): boolean {
    if (this.#closed || !this.#authenticated || this.status !== 'open' || this.#ws?.readyState !== WebSocket.OPEN ||
      !this.#receivedRoom || this.room?.id !== this.#id || !this.viewerId || name !== this.viewerName ||
      !name.trim() || name !== name.trim() || Array.from(name).length > CATALOG.name_max) return false;
    return store(NAME_KEY, name);
  }

  observe(name: string) { store(NAME_KEY, name); const visitor = load<{token: string}>(`visitor:${this.#id}`); this.#send({type: 'observe', name, token: visitor?.token ?? null}); }
  requestSeat(requested: boolean, seat?: number) { this.#send({type: 'request_seat', requested, seat}); }
  offerSeat(requesterId: string | null) { this.#send({type: 'offer_seat', requester_id: requesterId}); }
  acceptSeat(seat: number, targetId: string) { this.#send({type: 'accept_seat', seat, target_id: targetId}); }
  resetScores() { this.#send({type: 'reset_scores'}); }
  ready(ready: boolean) { this.#send({type: 'ready', ready}); }

  setTable(table: { turn_secs?: number; shuffle?: boolean; shuffle_next?: boolean }) {
    this.#send({ type: 'set_table', ...table });
  }

  /** 섞기: shuffle the seats when the next hand starts, or not after all. */
  shuffleNext(on: boolean) {
    this.setTable({ shuffle_next: on });
  }

  swapSeats(a: number, b: number) {
    this.#send({ type: 'swap_seats', a, b });
  }

  /** Sends the player at `seat` back to watching, between hands. */
  clearSeat(seat: number) {
    this.#send({ type: 'clear_seat', seat });
  }

  /** Seats a bot, or changes the level of the one already there. */
  addBot(seat: number, level: BotLevel = CATALOG.default_bot_level) {
    this.#send({ type: 'add_bot', seat, level });
  }

  removeBot(seat: number) {
    this.#send({ type: 'remove_bot', seat });
  }

  /** The game's settings for the hands to come: its preset and rules. */
  setSettings(settings: G['settings']) {
    this.#send({ type: 'set_settings', settings });
  }

  /** Shows a short message in the toast, without the error sound. */
  notice(text: string) {
    this.toasts.show('notice', text);
  }

  askHint() {
    this.#send({ type: 'hint' });
  }

  react(text: string) {
    this.#send({ type: 'react', text });
  }

  start() {
    // A second tap before the room answers would only earn an error.
    if (this.#starting) return;
    this.#starting = true;
    if(!this.#send({ type: 'start' }))this.#starting=false;
  }

  act(action: G['action']) {
    this.#send({ type: 'act', action });
  }

  /** Stops for good: no socket, no reconnect, no timer left running. */
  close() {
    this.#closed = true;
    this.#clearNativeEphemeral();
    this.#pendingReclaim=null;
    this.#nameAdoption=null;
    this.commands.dispose();
    clearTimeout(this.#reconnect);
    this.#reconnect = undefined;
    for (const timer of this.#reactionTimers) clearTimeout(timer);
    this.#reactionTimers.clear();
    this.toasts.clear();
    this.#ws?.close();
    this.#ws = null;
  }
}
