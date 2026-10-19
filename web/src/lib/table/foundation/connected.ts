import type {DisclosureRefresh} from './disclosures';
import type {ConnectedDisclosureOwner} from './connectedDisclosures';
import type {CurrentRoomViewOf} from '../../room/currentRoom';
import type {OutcomeDescriptor} from './outcome';
import type {NativeAdvice,NativeReaction} from '../../room/ephemeral';
import type {AssistanceSnapshot} from './assistance';
import type {FeedbackProjection} from './feedback';
import type {CommandScope} from '../../generated/protocol';
import type {FormOffer,FormPolicy,FormSubmission,FormStatus} from './forms';
import type {HostCommand} from './connectedDocument';
import type {RoomShellAction,RoomShellNotice} from './roomShell';
import type { TableClient } from '../../room/tableClient';
import type { GameTypes, RoomActionOf, StateMsgOf } from '../../room/types';
import type { InformationPanel, TableDocument } from './contracts';

/** Authorized plain input: projection has no connection or transport methods. */
export type ConnectedProjectionClient<G extends GameTypes> = Pick<TableClient<G>, 'game' | 'seat' | 'viewerId' | 'viewerName'>&{readonly room:CurrentRoomViewOf<G>|null;readonly roomScope?:CommandScope};
/** Prior authorized publication captured by the host, never a second state owner.
 * Baselines deliberately omit prior data after connection, audience or session changes.
 */
export interface ConnectedProjectionHistory<G extends GameTypes> {
    readonly previous:StateMsgOf<G>|null;
    readonly previousParticipantIds:readonly (string|null)[]|null;
    readonly previousRoomScope:CommandScope|null;
    readonly baseline:boolean;
    readonly roomEpoch:string;
    readonly connectionEpoch:string;
}
/** Semantic fence input only: no transport, mutation methods or live owner. */
export type ConnectedCommandClient<G extends GameTypes> = Readonly<Pick<TableClient<G>, 'status' | 'game' | 'seat' | 'viewerId' | 'viewerName'>>&{readonly room:CurrentRoomViewOf<G>|null};
/** The host snapshots room/game first; whitelist fields into a fresh inert object. */
export function createConnectedCommandClient<G extends GameTypes>(snapshot: ConnectedCommandClient<G>): ConnectedCommandClient<G> {
    return Object.freeze({ status: snapshot.status, room: snapshot.room, game: snapshot.game, seat: snapshot.seat, viewerId: snapshot.viewerId, viewerName: snapshot.viewerName });
}
export interface ConnectedFormProjection<G extends GameTypes,A> {readonly offers:readonly FormOffer<HostCommand<A,G['settings']>>[];readonly settingsActions:readonly RoomShellAction[];readonly diagnostics?:readonly RoomShellNotice[];}
export interface ConnectedFormContext<G extends GameTypes> {readonly room:CurrentRoomViewOf<G>;readonly scope:CommandScope;readonly viewerId:string;readonly seat:number|null;readonly localState:unknown;readonly localAuthorities?:Readonly<Record<string,Readonly<Record<string,unknown>>>>;}
export interface ConnectedHostFormResult {readonly refreshDisclosure?:DisclosureRefresh;readonly status:Extract<FormStatus,'stored'|'failed'|'conflict'|'unsupported'|'rejected'|'uncertain'>;readonly message?:string;readonly authority?:{readonly data:unknown;readonly metadata:Readonly<Record<string,string>>};}
export interface ConnectedAssistanceContext<G extends GameTypes,A> {readonly document:TableDocument<A>;readonly client:ConnectedCommandClient<G>;readonly roomEpoch:string;readonly connectionEpoch:string;readonly publicationReady:boolean;readonly graceReady:boolean;readonly preferences:{readonly hints:boolean;readonly tips:boolean};readonly nativeHint:NativeAdvice<G['action']>|null;readonly nativeReactions:readonly NativeReaction[];}
export interface ConnectedFeedbackContext<G extends GameTypes,A> {readonly document:TableDocument<A>;readonly client:ConnectedCommandClient<G>;readonly previous:StateMsgOf<G>|null;readonly previousParticipantIds:readonly (string|null)[]|null;readonly connectionEpoch:string;readonly roomEpoch:string;readonly clock:TableClient<G>['clock'];readonly baseline:boolean;}
export interface ConnectedOutcomeContext<G extends GameTypes,A> {readonly document:TableDocument<A>;readonly client:ConnectedProjectionClient<G>;readonly roomScope:CommandScope;readonly earnedTitles?:readonly string[];}
/** Fixed host bookkeeping is separate from pure projection and game transport. */
export interface ConnectedCompletionContext<G extends GameTypes> {readonly room:CurrentRoomViewOf<G>;readonly roomScope:CommandScope;readonly actorId:string;readonly seat:number|null;readonly keepsRecord:boolean;readonly at:number;}
export interface ConnectedCompletionView {readonly id:string;readonly status:'stored'|'duplicate'|'failed'|'unsupported'|'conflict'|'uncertain';readonly earnedTitles:readonly string[];readonly message?:string;}
export interface ConnectedCompletionOwner<G extends GameTypes> {observe(context:ConnectedCompletionContext<G>,isCurrent:()=>boolean):ConnectedCompletionView|null;revoke():void;dispose():void;}
/** Game meaning only. The shared connected host owns publication and lifetime. */
export interface ConnectedGameAdapter<G extends GameTypes, A> {
    readonly id: string;
    readonly title: string;
    readonly tableLabel: string;
    /** One host-owned instance per mounted room; never invoked by pure projection. */
    createCompletionOwner?():ConnectedCompletionOwner<G>;
    createDisclosureOwner?():ConnectedDisclosureOwner<G>;
    outcome?(context:ConnectedOutcomeContext<G,A>):{readonly outcome:OutcomeDescriptor;readonly information:InformationPanel;readonly collections?:TableDocument<A>['collections'];readonly reveals?:TableDocument<A>['reveals']}|null;
    assistance?(context:ConnectedAssistanceContext<G,A>):AssistanceSnapshot|null;
    feedback?(context:ConnectedFeedbackContext<G,A>):FeedbackProjection|null;
    readonly formPolicies?:readonly FormPolicy<HostCommand<A,G['settings']>>[];
    readLocalFormState?():unknown;
    projectForms?(context:ConnectedFormContext<G>):ConnectedFormProjection<G,A>;
    readonly hostFormOperations?:readonly {readonly id:string;submit(submission:FormSubmission,continuation?:{resolve(token:string):unknown|null;isCurrent():boolean}):ConnectedHostFormResult|Promise<ConnectedHostFormResult>}[];
    project(client: ConnectedProjectionClient<G>, revision: number, graceReady: boolean, priorGeneration?: string, history?:ConnectedProjectionHistory<G>): TableDocument<A> | null;
    ruleInformation?(room: CurrentRoomViewOf<G>): readonly InformationPanel[];
    viewerMatches(game: StateMsgOf<G>, seat: number | null): boolean;
    /** Pure translation of engine-compiled native command sets; the host sends once. */
    prepareBatch?(client:ConnectedCommandClient<G>,commands:readonly A[]):readonly G['action'][]|null;
    submit(client: ConnectedCommandClient<G>, command: A, submitGame: (action: G['action']) => boolean, submitRoom: (action: RoomActionOf<G['settings']>) => boolean): boolean;
}

/**
 * A submit hook receives one synchronous, single-use capability across both
 * domains. Only the transport callback can establish admission; adapter return
 * values cannot invent success or undo an admitted command's receipt ownership.
 */
export function submitConnectedOnce<GameAction, RoomAction>(
    invoke: (submitGame: (action: GameAction) => boolean, submitRoom: (action: RoomAction) => boolean) => unknown,
    submitGame: (action: GameAction) => boolean,
    submitRoom: (action: RoomAction) => boolean,
): boolean {
    let open = true, attempted = false, sent = false, uncertain = false;
    let transportError: unknown;
    const capability = <Action>(send: (action: Action) => boolean) => (action: Action): boolean => {
        if (!open || attempted) return false;
        attempted = true;
        try { sent = send(action); return sent; }
        catch (error) {
            // A transport exception cannot establish that transmission failed,
            // including when the adapter catches it and claims rejection.
            uncertain = true;
            transportError = error;
            throw error;
        }
    };
    try { invoke(capability(submitGame), capability(submitRoom)); }
    catch { /* Before a send: definitely unsent. After admission: receipt-owned. */ }
    finally { open = false; }
    if (uncertain) throw transportError;
    return sent;
}
