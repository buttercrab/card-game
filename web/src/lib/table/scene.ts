import type { Size, SeatCount } from './layout';
import { calculateArenaCoordinates, calculateDockCoordinates, calculateHandCoordinates, calculateTableRowCoordinates, calculateAdjacentHandCoordinates, tableCardBounds, coordinateId } from './sceneCoordinates';
import { planMovement, type Bounds, type MovementOptions } from './movement';
import { toStandardCard } from './cardVisual';
import { validateAction, type GamePresentation, type CardSpec, type PlayerSpec } from './presentation';
import type { Suit } from '../cardTypes';

export interface ScenePlayer {
  kind: 'player'; id: string; bounds: Bounds; label: string; z: number;
  seat: number; role: PlayerSpec['kind']; counters: PlayerSpec['counters'];
  figureBounds?: Bounds;
  art?: {team:'declarer'|'friend'|'defense'|null;trumpSuit?:Suit|null;isBot?:boolean};
  halo?: {bounds:Bounds;color:string;opacity:number};
}
export interface SceneCard {
  kind: 'card'; id: string; bounds: Bounds; label: string; z: number;
  card: CardSpec; actionId: string | null; eligible: boolean; selected: boolean;
  rotation: number;
}
export interface TableScene {
  width: number; height: number; offerId: string;
  nodes: readonly (ScenePlayer | SceneCard)[];
}
export type ScenePhase = 'waiting' | 'play' | 'result';
export interface SceneInput<A> {
  presentation: GamePresentation<A>;
  size: Size;
  viewport?: Size;
  viewerId: string | null;
  /** Visible dock identity can belong to another player while observing. */
  dockPlayerId?: string;
  seatCount: SeatCount;
  phase: ScenePhase;
  /** Explicit semantic associations supplied by the game projection adapter. */
  cardActions?: Readonly<Record<string,string>>;
  cardSeats?: Readonly<Record<string,number>>;
  /** Measured production frame regions, all in the scene's coordinate space. */
  regions?: {arena:Bounds;dock:Bounds;hand:Bounds};
  /** Optional measured Seat footprints; geometry never guesses dynamic label heights. */
  identities?: {own?:{height:number;figureWidth:number};opponents?:{height:number;figureWidth:number}};
  playerArt?: Readonly<Record<string,ScenePlayer['art']>>;
  /** Optional measured identity boxes from the reference renderer, never DOM nodes. */
  playerBounds?: Readonly<Record<string,Bounds>>;
  figureBounds?: Readonly<Record<string,Bounds>>;
  playerHalos?: Readonly<Record<string,{bounds:Bounds;color:string;opacity:number}>>;
}
export const MAX_CARD_ROTATION = 45;

/** Hidden descriptors are reduced before labels, artwork or state are inspected. */
function safeCard(card: CardSpec): CardSpec {
  if (card.face === 'down') return {id:card.id,zoneId:card.zoneId,face:'down',label:'비공개 카드'};
  const normalized = toStandardCard(card);
  return {
    id:card.id,zoneId:card.zoneId,face:'up',label:card.label,
    ...(normalized ? {visual:'Normal' in normalized ? {kind:'standard' as const,suit:normalized.Normal[0],rank:normalized.Normal[1]} : {kind:'joker' as const,color:normalized.Joker}} : {}),
    ...(card.enabled !== undefined ? {enabled:card.enabled} : {}),
    ...(card.reason !== undefined ? {reason:card.reason} : {}),
    ...(card.selected !== undefined ? {selected:card.selected} : {}),
    ...(card.emphasis !== undefined ? {emphasis:card.emphasis} : {}),
    ...(card.twoJokers !== undefined ? {twoJokers:card.twoJokers} : {}),
    ...(card.rotation !== undefined && Number.isFinite(card.rotation) ? {rotation:Math.max(-MAX_CARD_ROTATION,Math.min(MAX_CARD_ROTATION,card.rotation))} : {}),
  };
}

/** A separate preview scene, not a new game engine or production layout owner. */
export function buildScene<A>({presentation,size,viewport=size,viewerId,dockPlayerId,seatCount,phase,cardActions={},cardSeats={},regions,identities,playerArt={},playerBounds={},figureBounds={},playerHalos={}}: SceneInput<A>): TableScene {
  const viewer = presentation.players.find(player=>player.id===viewerId && player.kind!=='observer');
  const dockPlayer = dockPlayerId === undefined ? viewer : presentation.players.find(player=>player.id===dockPlayerId&&player.kind!=='observer');
  const bottom = dockPlayer?.seat ?? 0;
  const relative = (seat: number) => ((seat-bottom)%seatCount+seatCount)%seatCount;
  const ownHandZones = viewer ? presentation.zones.filter(zone=>zone.kind==='hand'&&zone.ownerId===viewer.id) : [];
  const ownCards = presentation.cards.filter(card=>ownHandZones.some(zone=>zone.id===card.zoneId));
  const desktop = viewport.width>=1024&&viewport.height>=640;
  const short = viewport.width>viewport.height&&viewport.height<=520;
  const handInset = desktop ? 192 : short ? 100 : 8;
  const handWidth = Math.max(0,regions?.hand.width ?? size.width-handInset*2);
  const hand = calculateHandCoordinates({viewport,region:{x:0,y:0,width:handWidth,height:0},cardIds:ownCards.map(card=>card.id)}).layout;
  const dockHeight = Math.min(size.height,hand.rowHeight+(desktop||short ? 28 : 72));
  const boardHeight = Math.max(0,size.height-dockHeight);
  const arena = regions?.arena ?? {x:0,y:0,width:size.width,height:boardHeight};
  const dockRegion = regions?.dock ?? {x:0,y:boardHeight,width:size.width,height:dockHeight};
  const arenaInput={viewport,region:arena,seatCount,perspectiveSeat:bottom,watching:!dockPlayer,tableCards:[]};
  const arenaGeometry=calculateArenaCoordinates({...arenaInput,players:[]});
  const layout=arenaGeometry.layout;
  const handGeometry=calculateHandCoordinates({viewport,
    region:regions?.hand??{x:handInset,y:boardHeight,width:handWidth,height:dockHeight},cardIds:ownCards.map(card=>card.id),
    paddingTop:regions?14:desktop||short?14:68,rowPitch:regions?undefined:hand.rowHeight*.75});
  const handBounds=new Map(handGeometry.cards.map(card=>[card.id,card.bounds]));
  const identityHeight = desktop ? Math.min(100,layout.seatHeight) : Math.min(56,layout.seatHeight);
  const clamp = (low:number,value:number,high:number) => Math.max(low,Math.min(high,value));
  const opponentFigure = layout.mode!=='regular' ? 16 : desktop ? clamp(56,arena.height*.14,80)
    : viewport.width>=600 ? clamp(40,arena.height*.09,84)
    : viewport.height>=700 ? clamp(44,arena.height*.1,68) : clamp(36,arena.height*.1,64);
  const validPlayers=presentation.players.filter(player=>player.kind!=='observer'&&Number.isInteger(player.seat)&&player.seat>=0&&player.seat<seatCount);
  const profiles=validPlayers.map(player=>{
    const own = player.id===dockPlayer?.id;
    const metrics = own ? identities?.own : identities?.opponents;
    const figureWidth = metrics?.figureWidth ?? (own ? desktop ? 60 : short ? 16 : 32 : opponentFigure);
    const genericHeight = Math.max(identityHeight,figureWidth*110/120+(player.counters?.length ? 36 : 20));
    const height = metrics?.height ?? (regions ? identityHeight : genericHeight);
    return {player,own,height,figureWidth};
  });
  const opponentGeometry=calculateArenaCoordinates({...arenaInput,players:profiles.filter(profile=>!profile.own).map(({player,height})=>({id:player.id,seat:player.seat,height}))});
  const playerPositions=new Map(opponentGeometry.players.map(node=>[node.id,node.bounds]));
  const ownProfile=profiles.find(profile=>profile.own);
  if(ownProfile){const own=calculateDockCoordinates({viewport,region:dockRegion,centered:phase!=='play',player:{id:ownProfile.player.id,height:ownProfile.height}}).node;playerPositions.set(own.id,own.bounds);}
  const players: ScenePlayer[]=profiles.map(({player,own,height,figureWidth})=>{
    const calculated=playerPositions.get(coordinateId('player',player.id))!;
    const bounds = playerBounds[player.id] ? {...playerBounds[player.id]} : calculated;
    const horizontalOwn = own&&!desktop&&!short;
    const figure = figureBounds[player.id] ? {...figureBounds[player.id]} : {x:bounds.x+(horizontalOwn ? bounds.width/2-78 : (bounds.width-figureWidth)/2),
      y:bounds.y+2+(horizontalOwn ? (32-figureWidth*110/120)/2 : 0),width:figureWidth,height:figureWidth*110/120};
    const requestedArt = playerArt[player.id];
    const art = {team:requestedArt?.team ?? null,isBot:requestedArt?.isBot ?? player.kind==='bot',
      ...(requestedArt?.trumpSuit !== undefined ? {trumpSuit:requestedArt.trumpSuit} : {})};
    const requestedHalo = playerHalos[player.id];
    const halo = requestedHalo ? {bounds:{...requestedHalo.bounds},color:requestedHalo.color,
      opacity:Number.isFinite(requestedHalo.opacity) ? clamp(0,requestedHalo.opacity,1) : 0} : undefined;
    return {kind:'player',id:player.id,label:player.name,z:50,seat:player.seat,role:player.kind,counters:player.counters,bounds,figureBounds:figure,art,...(halo ? {halo} : {})};
  });
  const cards: SceneCard[] = presentation.cards.map((source,index)=>{
    const card = safeCard(source);
    const zone = presentation.zones.find(zone=>zone.id===card.zoneId);
    const handIndex = ownCards.findIndex(item=>item.id===card.id);
    let bounds: Bounds;
    if (handIndex>=0) {
      bounds=handBounds.get(coordinateId('card',card.id))!;
    } else if (zone?.kind==='hand') {
      const owner=players.find(player=>player.id===zone.ownerId);
      const siblings=presentation.cards.filter(item=>item.zoneId===zone.id);
      const positions=calculateAdjacentHandCoordinates({size,cardWidth:layout.cardWidth,cardIds:siblings.map(item=>item.id),
        owner:owner?.bounds??{x:layout.ring.x,y:0,width:layout.seatWidth,height:identityHeight}});
      bounds=positions.find(node=>node.id===coordinateId('card',card.id))!.bounds;
    } else {
      const seat=cardSeats[card.id];
      const siblings=presentation.cards.filter(item=>item.zoneId===card.zoneId);
      if(seat!==undefined&&Number.isInteger(seat)&&seat>=0&&seat<seatCount){
        bounds=tableCardBounds(layout,arenaGeometry.ring,relative(seat),Math.max(0,siblings.findIndex(item=>item.id===card.id)),siblings.length);
      } else {
        const tableZones=presentation.zones.filter(item=>item.kind==='table');
        const positions=calculateTableRowCoordinates({region:arenaGeometry.ring,cardIds:siblings.map(item=>item.id),cardWidth:layout.cardWidth,
          centerY:layout.leadNote.y,zoneIndex:Math.max(0,tableZones.findIndex(item=>item.id===zone?.id)),zoneCount:tableZones.length});
        bounds=positions.find(node=>node.id===coordinateId('card',card.id))!.bounds;
      }
    }
    const actionId = card.face==='up' ? cardActions[card.id] ?? null : null;
    const validation = actionId ? validateAction(presentation.offer,presentation.offer.id,actionId) : null;
    return {kind:'card',id:card.id,bounds,label:card.label,z:100+index,card,
      actionId,eligible:!!viewer&&card.face==='up'&&card.enabled!==false&&validation?.ok===true&&validation.kind==='command',selected:card.face==='up'&&card.selected===true,rotation:card.rotation ?? 0};
  });
  return {width:size.width,height:size.height,offerId:presentation.offer.id,nodes:[...players,...cards]};
}

/** Hit testing uses the same bounded scene as visual and keyboard adapters. */
export function hitTest(scene: TableScene, point: {x:number;y:number}): SceneCard | null {
  if (!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0||point.x>=scene.width||point.y>=scene.height) return null;
  const top = [...scene.nodes].sort((a,b)=>b.z-a.z).find((node):node is SceneCard=>{
    if (node.kind!=='card') return false;
    const centerX = node.bounds.x+node.bounds.width/2, centerY = node.bounds.y+node.bounds.height/2;
    const radians = -node.rotation*Math.PI/180;
    const dx = point.x-centerX, dy = point.y-centerY;
    const x = centerX+dx*Math.cos(radians)-dy*Math.sin(radians);
    const y = centerY+dx*Math.sin(radians)+dy*Math.cos(radians);
    return x>=node.bounds.x&&x<node.bounds.x+node.bounds.width&&y>=node.bounds.y&&y<node.bounds.y+node.bounds.height;
  });
  return top?.eligible ? top : null;
}
export function sceneMovement(before: TableScene, after: TableScene, options: MovementOptions) {
  return planMovement(before.nodes.map(node=>({id:node.id,bounds:node.bounds})),after.nodes.map(node=>({id:node.id,bounds:node.bounds})),options);
}
