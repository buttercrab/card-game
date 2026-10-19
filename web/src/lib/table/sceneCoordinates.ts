import { calculateTableLayout, calculateOwnDock, cardRowAnchor, type Anchor, type SeatCount, type Size } from './layout';
import { calculateHandLayout } from './handLayout';
import type { Bounds, IdentityPosition } from './movement';

/** All regions and returned bounds use the same TableFrame-local origin. */
export interface CoordinateRegions { arena: Bounds; dock: Bounds; hand: Bounds }
export interface CoordinatePlayer { id: string; seat: number; width?: number; height?: number }
export interface CoordinateCard { id: string; seat: number; rotation?: number }
export interface SceneCoordinate extends IdentityPosition {
  kind: 'player' | 'card'; zone: 'arena' | 'dock' | 'hand'; z: number; rotation: number;
}
export const coordinateId = (kind: SceneCoordinate['kind'], opaqueId: string) => `${kind}:${opaqueId}`;
const rectangle = (anchor: Anchor, width: number, height: number): Bounds => ({
  x: anchor.x-anchor.originX*width, y: anchor.y-anchor.originY*height, width, height,
});
const world = (bounds: Bounds, region: Bounds): Bounds => ({...bounds,x:bounds.x+region.x,y:bounds.y+region.y});
function dimension(value: number) { if (!Number.isFinite(value)||value<0) throw new RangeError('Geometry dimensions must be finite and nonnegative'); }
function regionValid(region: Bounds) {
  if (!Number.isFinite(region.x)||!Number.isFinite(region.y)) throw new RangeError('Geometry origins must be finite');
  dimension(region.width); dimension(region.height);
}
function idsValid(ids: readonly string[]) {
  if(ids.some(id=>typeof id!=='string'||!id.length)||new Set(ids).size!==ids.length) throw new Error('Geometry identities must be unique nonempty strings');
}
function seatValid(seat:number,count:SeatCount) {if(!Number.isInteger(seat)||seat<0||seat>=count)throw new RangeError('Seat is outside the table');}

/** A game's public seat association selects an anchor, not its placement math. */
export function tableCardBounds(layout:ReturnType<typeof calculateTableLayout>,ring:Bounds,relativeSeat:number,index:number,count:number):Bounds {
  if(!Number.isInteger(relativeSeat)||relativeSeat<0||relativeSeat>=layout.cards.length||!Number.isInteger(index)||index<0||!Number.isInteger(count)||count<=index)throw new RangeError('Invalid table card slot');
  const anchor=layout.mode==='landscape'?cardRowAnchor(layout.rowCenterX,index,count):layout.cards[relativeSeat];
  return world(rectangle(anchor,layout.cardWidth,layout.cardHeight),ring);
}

export interface ArenaCoordinatesInput {
  viewport: Size; region: Bounds; seatCount: SeatCount; perspectiveSeat: number; watching: boolean;
  players: readonly CoordinatePlayer[]; tableCards: readonly CoordinateCard[];
}
/** Fixed opponent bands and trick positions. Turn and game phase never enter this calculation. */
export function calculateArenaCoordinates(input: ArenaCoordinatesInput) {
  const {viewport,region,seatCount,perspectiveSeat,watching,players,tableCards}=input;
  regionValid(region); dimension(viewport.width); dimension(viewport.height);
  if(![3,5,6].includes(seatCount))throw new RangeError('Unsupported seat count');
  seatValid(perspectiveSeat,seatCount); idsValid(players.map(player=>player.id)); idsValid(tableCards.map(card=>card.id));
  const relative=(seat:number)=>((seat-perspectiveSeat)%seatCount+seatCount)%seatCount;
  const layout=calculateTableLayout({viewport,region,seatCount,watching});
  const ring={x:region.x+layout.ring.x,y:region.y+layout.ring.y,width:layout.ring.width,height:layout.ring.height};
  const playerNodes: SceneCoordinate[]=players.map(player=>{
    seatValid(player.seat,seatCount);
    const width=player.width??layout.seatWidth,height=player.height??layout.seatHeight;
    dimension(width);dimension(height);
    return {id:coordinateId('player',player.id),kind:'player',zone:'arena',bounds:world(rectangle(layout.seats[relative(player.seat)],width,height),ring),z:50,rotation:0};
  });
  const cardNodes: SceneCoordinate[]=tableCards.map((card,index)=>{
    seatValid(card.seat,seatCount);
    if(card.rotation!==undefined&&!Number.isFinite(card.rotation))throw new RangeError('Card rotation must be finite');
    return {id:coordinateId('card',card.id),kind:'card',zone:'arena',bounds:tableCardBounds(layout,ring,relative(card.seat),index,tableCards.length),z:100+index,rotation:card.rotation??0};
  });
  return {layout,ring,players:playerNodes,cards:cardNodes,nodes:[...playerNodes,...cardNodes],
    note:{...layout.note,x:layout.note.x+ring.x,y:layout.note.y+ring.y},leadNote:{...layout.leadNote,x:layout.leadNote.x+ring.x,y:layout.leadNote.y+ring.y}};
}

export interface DockCoordinatesInput {
  viewport: Size; region: Bounds; centered: boolean; player: Pick<CoordinatePlayer,'id'|'width'|'height'>;
}
export function calculateDockCoordinates({viewport,region,centered,player}: DockCoordinatesInput) {
  regionValid(region);dimension(viewport.width);dimension(viewport.height);idsValid([player.id]);
  const layout=calculateOwnDock({viewport,region,centered});
  const width=player.width??layout.width,height=player.height??64;
  dimension(width);dimension(height);
  const node: SceneCoordinate={id:coordinateId('player',player.id),kind:'player',zone:'dock',bounds:world(rectangle(layout,width,height),region),z:50,rotation:0};
  return {layout,node};
}

export interface HandCoordinatesInput {
  viewport: Size; region: Bounds;
  /** Opaque identities only: this layer never accepts cards or private face metadata. */
  cardIds: readonly string[]; paddingTop?: number; rowGap?: number; rowPitch?: number; lift?: number;
}
/** The original hand's centered fan and upward second row, without child measurement. */
export function calculateHandCoordinates({viewport,region,cardIds,paddingTop=14,rowGap=8,rowPitch,lift=0}: HandCoordinatesInput) {
  regionValid(region);dimension(viewport.width);dimension(viewport.height);idsValid(cardIds);dimension(paddingTop);dimension(rowGap);
  if(!Number.isFinite(lift))throw new RangeError('Hand lift must be finite');
  if(rowPitch!==undefined)dimension(rowPitch);
  const layout=calculateHandLayout({regionWidth:region.width,viewportWidth:viewport.width,viewportHeight:viewport.height,count:cardIds.length});
  const cards: SceneCoordinate[]=cardIds.map((id,index)=>{
    const rowIndex=layout.rows.findIndex(row=>index>=row.start&&index<row.end),row=layout.rows[rowIndex];
    const rowWidth=layout.drawWidth+Math.max(0,row.end-row.start-1)*row.step;
    return {id:coordinateId('card',id),kind:'card',zone:'hand',bounds:{
      x:region.x+(region.width-rowWidth)/2+(index-row.start)*row.step,
      y:region.y+paddingTop-(layout.rows.length-1-rowIndex)*(rowPitch??layout.rowHeight+rowGap)+lift,
      width:layout.drawWidth,height:layout.drawWidth*1.4},z:100+index,rotation:0};
  });
  return {layout,cards,nodes:cards,containerHeight:paddingTop+layout.rowHeight,paddingTop};
}

/** Generic public community/pile rows share the arena's coordinate owner. */
export function calculateTableRowCoordinates({region,cardIds,cardWidth,centerY,zoneIndex=0,zoneCount=1}: {
  region:Bounds;cardIds:readonly string[];cardWidth:number;centerY:number;zoneIndex?:number;zoneCount?:number;
}) {
  regionValid(region);idsValid(cardIds);dimension(cardWidth);
  if(!Number.isFinite(centerY)||!Number.isInteger(zoneIndex)||zoneIndex<0||!Number.isInteger(zoneCount)||zoneCount<0)throw new RangeError('Invalid table row slot');
  const width=Math.max(0,Math.min(cardWidth,(region.width-16-Math.max(0,cardIds.length-1)*4)/Math.max(1,cardIds.length)));
  const rowWidth=cardIds.length*width+Math.max(0,cardIds.length-1)*4;
  const y=region.y+centerY+(zoneIndex-(zoneCount-1)/2)*(width*1.4+8)-width*.7;
  return cardIds.map((id,index)=>({id:coordinateId('card',id),bounds:{x:region.x+(region.width-rowWidth)/2+index*(width+4),y,width,height:width*1.4}}));
}

/** Small hidden stacks reserve a band below an identity, never its figure or label. */
export function calculateAdjacentHandCoordinates({size,owner,cardIds,cardWidth}: {
  size:Size;owner:Bounds;cardIds:readonly string[];cardWidth:number;
}) {
  dimension(size.width);dimension(size.height);regionValid(owner);idsValid(cardIds);dimension(cardWidth);
  const width=Math.min(32,Math.max(16,cardWidth)),rowWidth=cardIds.length*width+Math.max(0,cardIds.length-1)*4;
  const left=Math.max(0,Math.min(size.width-rowWidth,owner.x+(owner.width-rowWidth)/2));
  return cardIds.map((id,index)=>({id:coordinateId('card',id),bounds:{x:left+index*(width+4),y:Math.min(size.height-width*1.4,owner.y+owner.height+4),width,height:width*1.4}}));
}

export interface SceneCoordinatesInput extends Omit<ArenaCoordinatesInput,'region'> {
  regions: CoordinateRegions; dockPlayerId: string|null; centeredDock: boolean; handCardIds: readonly string[];
  handLift?: number;
}
/** One production composition of the existing numeric layout owners. */
export function calculateSceneCoordinates(input: SceneCoordinatesInput) {
  idsValid(input.players.map(player=>player.id));
  for(const player of input.players)seatValid(player.seat,input.seatCount);
  const dockPlayer=input.dockPlayerId===null?null:input.players.find(player=>player.id===input.dockPlayerId);
  if(input.dockPlayerId!==null&&!dockPlayer)throw new Error('Dock identity is absent from the table');
  const arena=calculateArenaCoordinates({...input,region:input.regions.arena,players:input.players.filter(player=>player.id!==dockPlayer?.id)});
  const dock=dockPlayer?calculateDockCoordinates({viewport:input.viewport,region:input.regions.dock,centered:input.centeredDock,player:dockPlayer}):null;
  const hand=calculateHandCoordinates({viewport:input.viewport,region:input.regions.hand,cardIds:input.handCardIds,lift:input.handLift});
  const nodes=[...arena.nodes,...(dock?[dock.node]:[]),...hand.nodes];
  idsValid(nodes.map(node=>node.id));
  return {arena,dock,hand,nodes};
}

/** Scoped publication: a retiring hand cannot erase an identity already moved onto the trick. */
export class BoundsRegistry {
  #positions=new Map<string,{scope:string;position:IdentityPosition}>();
  #scopes=new Map<string,Set<string>>();
  #listeners=new Set<(positions:readonly IdentityPosition[])=>void>();
  #snapshot: readonly IdentityPosition[]=Object.freeze([]);
  #revision=0;
  get revision(){return this.#revision;}
  get(id:string):Bounds|null {return this.#positions.get(id)?.position.bounds??null;}
  snapshot():readonly IdentityPosition[]{return this.#snapshot;}
  subscribe(listener:(positions:readonly IdentityPosition[])=>void){this.#listeners.add(listener);listener(this.#snapshot);return()=>{this.#listeners.delete(listener);};}
  replace(scope:string,entries:readonly IdentityPosition[]) {
    if(!scope)throw new Error('Geometry scope must be nonempty');idsValid(entries.map(entry=>entry.id));
    const prepared=entries.map(entry=>{regionValid(entry.bounds);return Object.freeze({id:entry.id,bounds:Object.freeze({...entry.bounds})});});
    const next=new Set(prepared.map(entry=>entry.id));
    let changed=false;
    for(const id of this.#scopes.get(scope)??[])if(!next.has(id)&&this.#positions.get(id)?.scope===scope){this.#positions.delete(id);changed=true;}
    for(const position of prepared){
      const previous=this.#positions.get(position.id);
      if(!previous||previous.scope!==scope||Object.keys(position.bounds).some(key=>position.bounds[key as keyof Bounds]!==previous.position.bounds[key as keyof Bounds])){
        this.#positions.set(position.id,{scope,position});changed=true;
      }
    }
    this.#scopes.set(scope,next);if(changed)this.#publish();return this.#snapshot;
  }
  clear(scope:string){
    const previous=this.#scopes.get(scope);if(!previous)return;
    let changed=false;
    for(const id of previous)if(this.#positions.get(id)?.scope===scope){this.#positions.delete(id);changed=true;}
    this.#scopes.delete(scope);if(changed)this.#publish();
  }
  #publish(){this.#revision++;this.#snapshot=Object.freeze([...this.#positions.values()].map(entry=>entry.position));for(const listener of [...this.#listeners])listener(this.#snapshot);}
}
export { BoundsRegistry as CoordinateRegistry };
