import { expect, test } from 'vitest';
import { buildScene, hitTest, sceneMovement, type SceneCard, type SceneInput } from './scene';
import type { GamePresentation } from './presentation';
import { calculateTableLayout, cardRowAnchor } from './layout';
import { calculateHandLayout } from './handLayout';

type Action = {play:string};
function fixture(): GamePresentation<Action> {
  return {id:'fixture',zones:[{id:'hand',kind:'hand',label:'내 카드',ownerId:'p0'},{id:'table',kind:'table',label:'테이블'}],
    players:Array.from({length:5},(_,seat)=>({id:`p${seat}`,seat,name:`사람${seat}`,kind:'human'})),
    cards:[{id:'ace',zoneId:'hand',face:'up',label:'스페이드 A',visual:{kind:'standard',suit:'Spade',rank:14}},{id:'king',zoneId:'hand',face:'up',label:'하트 K',visual:{kind:'standard',suit:'Heart',rank:13}}],
    offer:{id:'v7',actions:[{id:'play-ace',kind:'command',label:'에이스 내기',intent:'primary',enabled:true,action:{play:'ace'}},{id:'play-king',kind:'command',label:'킹 내기',intent:'primary',enabled:true,action:{play:'king'}}]}};
}
function input(presentation=fixture()): SceneInput<Action> {
  return {presentation,size:{width:900,height:540},viewport:{width:1440,height:900},viewerId:'p0',seatCount:5,phase:'play',cardActions:{ace:'play-ace',king:'play-king'}};
}
const cards = (scene: ReturnType<typeof buildScene>) => scene.nodes.filter((node):node is SceneCard=>node.kind==='card');

test('one numeric scene owns drawing, accessible labels and explicit command identities', () => {
  const scene = buildScene(input());
  expect(scene.offerId).toBe('v7');
  const ace = cards(scene).find(node=>node.id==='ace')!;
  expect(ace.label).toBe('스페이드 A');
  expect(ace.actionId).toBe('play-ace');
  expect(ace.eligible).toBe(true);
  expect(hitTest(scene,{x:ace.bounds.x+2,y:ace.bounds.y+2})?.id).toBe('ace');
  expect(hitTest(scene,{x:-1,y:0})).toBeNull();
});
test('hand/table transitions retain card identity and yield renderer-independent movement', () => {
  const previous = buildScene(input());
  const first = fixture();
  const presentation = {...first,cards:first.cards.map(card=>card.id==='ace'?{...card,zoneId:'table'}:card)};
  const next = buildScene({...input(presentation),cardSeats:{ace:0}});
  expect(cards(next).find(node=>node.id==='ace')).toBeDefined();
  expect(sceneMovement(previous,next,{enabled:true,duration:200}).some(move=>move.id==='ace')).toBe(true);
  expect(sceneMovement(previous,next,{enabled:false,duration:200})).toEqual([]);
});
test('phase changes move only the local identity while keeping opponents anchored', () => {
  const waiting = buildScene({...input(),phase:'waiting'});
  const playing = buildScene(input());
  const result = buildScene({...input(),phase:'result'});
  for (const node of waiting.nodes.filter(node=>node.kind==='player'&&node.id!=='p0')) {
    expect(playing.nodes.find(current=>current.id===node.id)?.bounds).toEqual(node.bounds);
    expect(result.nodes.find(current=>current.id===node.id)?.bounds).toEqual(node.bounds);
  }
  expect(waiting.nodes.find(node=>node.id==='p0')?.bounds).toEqual(result.nodes.find(node=>node.id==='p0')?.bounds);
  expect(waiting.nodes.find(node=>node.id==='p0')?.bounds).not.toEqual(playing.nodes.find(node=>node.id==='p0')?.bounds);
});
test('backs discard metadata without reading it and cannot become commands', () => {
  const first = fixture();
  const hidden = {id:'ace',zoneId:'hand',face:'down' as const,get label():string {throw new Error('private label read');},get visual():never {throw new Error('private visual read');},get selected():boolean {throw new Error('private state read');},get emphasis():never {throw new Error('private emphasis read');},get twoJokers():boolean {throw new Error('private joker mode read');},get rotation():number {throw new Error('private rotation read');}};
  const presentation = {...first,cards:[hidden]};
  const node = cards(buildScene(input(presentation)))[0];
  expect(node.card).toEqual({id:'ace',zoneId:'hand',face:'down',label:'비공개 카드'});
  expect(node.actionId).toBeNull();
  expect(node.eligible).toBe(false);
  expect(node.selected).toBe(false);
  expect(node.rotation).toBe(0);
});
test('no mapping, unknown/numeric/disabled commands and observers cannot infer an action from a label', () => {
  const presentation = fixture();
  expect(cards(buildScene({...input(presentation),cardActions:{}})).every(node=>!node.eligible)).toBe(true);
  expect(cards(buildScene({...input(presentation),viewerId:null})).every(node=>!node.eligible)).toBe(true);
  expect(cards(buildScene({...input(presentation),cardActions:{ace:'missing'}}))[0].eligible).toBe(false);
  const revised: GamePresentation<Action> = {...presentation,offer:{...presentation.offer,actions:[{id:'raise',kind:'number',label:'스페이드 A',intent:'primary',enabled:true,min:1,max:5,step:1,initial:1,createAction:value=>({play:String(value)})},{...presentation.offer.actions[0],enabled:false}]}};
  expect(cards(buildScene({...input(revised),cardActions:{ace:'raise'}}))[0].eligible).toBe(false);
  expect(cards(buildScene(input(revised)))[0].eligible).toBe(false);
});
test('the topmost disabled/back card blocks hits on an eligible underlying card', () => {
  const scene = buildScene(input());
  const [ace,king] = cards(scene);
  const overlay = {...king,bounds:{...ace.bounds},eligible:false,z:ace.z+1};
  expect(hitTest({...scene,nodes:[ace,overlay]},{x:ace.bounds.x+5,y:ace.bounds.y+5})).toBeNull();
  expect(hitTest({...scene,nodes:[ace,{...overlay,eligible:true}]},{x:ace.bounds.x+5,y:ace.bounds.y+5})?.id).toBe('king');
});
test('opponent card backs stay below identity footprints and inside the preview', () => {
  const first = fixture();
  const presentation = {...first,zones:[...first.zones,{id:'other-hand',kind:'hand' as const,label:'상대 카드',ownerId:'p1'}],cards:[...first.cards,
    {id:'back1',zoneId:'other-hand',face:'down' as const,label:'숨김'},
    {id:'back2',zoneId:'other-hand',face:'down' as const,label:'숨김'}]};
  for (const size of [{width:288,height:420},{width:900,height:540}]) {
    const scene = buildScene({...input(presentation),size,viewport:size});
    const owner = scene.nodes.find(node=>node.id==='p1')!;
    const identities = scene.nodes.filter(node=>node.kind==='player');
    for (const back of cards(scene).filter(node=>node.card.face==='down')) {
      expect(back.bounds.y).toBeGreaterThanOrEqual(owner.bounds.y+owner.bounds.height);
      expect(back.bounds.x).toBeGreaterThanOrEqual(0);
      expect(back.bounds.x+back.bounds.width).toBeLessThanOrEqual(size.width);
      expect(back.bounds.y+back.bounds.height).toBeLessThanOrEqual(size.height);
      expect(identities.some(node=>back.bounds.x<node.bounds.x+node.bounds.width&&back.bounds.x+back.bounds.width>node.bounds.x&&back.bounds.y<node.bounds.y+node.bounds.height&&back.bounds.y+back.bounds.height>node.bounds.y)).toBe(false);
    }
  }
});
test('unassigned table-zone cards share a bounded row while explicit seats preserve radial tricks', () => {
  const first = fixture();
  const presentation = {...first,cards:Array.from({length:3},(_,index)=>({id:`public${index}`,zoneId:'table',face:'up' as const,label:`카드${index}`,visual:{kind:'standard' as const,suit:'Spade' as const,rank:2+index}}))};
  const row = cards(buildScene(input(presentation)));
  expect(new Set(row.map(card=>card.bounds.y)).size).toBe(1);
  for (let i=1;i<row.length;i++) expect(row[i].bounds.x).toBeGreaterThanOrEqual(row[i-1].bounds.x+row[i-1].bounds.width);
  for (const size of [{width:288,height:420},{width:900,height:540}]) {
    const scene = buildScene({...input(presentation),size,viewport:size});
    for (const card of cards(scene)) {
      expect(card.bounds.x).toBeGreaterThanOrEqual(0);
      expect(card.bounds.y).toBeGreaterThanOrEqual(0);
      expect(card.bounds.x+card.bounds.width).toBeLessThanOrEqual(size.width);
      expect(card.bounds.y+card.bounds.height).toBeLessThanOrEqual(size.height);
    }
  }
  const radial = cards(buildScene({...input(presentation),cardSeats:{public0:0,public1:1,public2:2}}));
  expect(new Set(radial.map(card=>card.bounds.y)).size).toBeGreaterThan(1);
});
test('the same builder supports a three-seat presentation and resized numeric regions', () => {
  const first = fixture();
  const presentation = {...first,players:first.players.slice(0,3)};
  for (const size of [{width:900,height:540},{width:358,height:420}]) {
    const scene = buildScene({...input(presentation),seatCount:3,size,viewport:size});
    expect(scene.nodes.filter(node=>node.kind==='player')).toHaveLength(3);
    expect(scene.nodes.every(node=>Object.values(node.bounds).every(Number.isFinite))).toBe(true);
    expect(scene.width).toBe(size.width);
  }
});
test('provided production regions preserve existing felt and hand geometry without a second split', () => {
  const first = fixture();
  const presentation = {...first,cards:first.cards.map(card=>card.id==='ace'?{...card,zoneId:'table'}:card)};
  const regions = {arena:{x:12,y:66,width:900,height:430},dock:{x:12,y:550,width:900,height:180},hand:{x:204,y:568,width:516,height:164}};
  const scene = buildScene({...input(presentation),size:{width:1200,height:900},regions,cardSeats:{ace:1}});
  const layout = calculateTableLayout({viewport:input().viewport!,region:regions.arena,seatCount:5,watching:false});
  const ace = cards(scene).find(card=>card.id==='ace')!;
  expect(ace.bounds).toEqual({x:regions.arena.x+layout.ring.x+layout.cards[1].x-layout.cardWidth/2,
    y:regions.arena.y+layout.cards[1].y-layout.cardHeight/2,width:layout.cardWidth,height:layout.cardHeight});
  const hand = calculateHandLayout({regionWidth:regions.hand.width,viewportWidth:1440,viewportHeight:900,count:1});
  expect(cards(scene).find(card=>card.id==='king')!.bounds).toEqual({x:regions.hand.x+(regions.hand.width-hand.drawWidth)/2,y:regions.hand.y+14,width:hand.drawWidth,height:hand.drawWidth*1.4});
  const changedOuterSize = buildScene({...input(presentation),size:{width:1500,height:1200},regions,cardSeats:{ace:1}});
  expect(changedOuterSize.nodes.map(node=>node.bounds)).toEqual(scene.nodes.map(node=>node.bounds));
});
test('numeric reference identity and figure footprints are retained without importing a renderer', () => {
  const bounds = {x:100,y:500,width:170,height:142};
  const figure = {x:155,y:502,width:60,height:55};
  const scene = buildScene({...input(),playerBounds:{p0:bounds},figureBounds:{p0:figure},playerArt:{p0:{team:'declarer',trumpSuit:'Heart',isBot:false}}});
  const own = scene.nodes.find(node=>node.kind==='player'&&node.id==='p0');
  expect(own?.bounds).toEqual(bounds);
  expect(own?.kind==='player'&&own.figureBounds).toEqual(figure);
  expect(own?.kind==='player'&&own.art).toEqual({team:'declarer',trumpSuit:'Heart',isBot:false});
  expect(own?.bounds).not.toBe(bounds);
});
test('observer dock perspective never grants private hand ownership or card commands', () => {
  const first = fixture();
  const presentation = {...first,cards:first.cards.map(card=>({...card,face:'down' as const}))};
  const player = buildScene({...input(presentation),phase:'waiting'});
  const observer = buildScene({...input(presentation),phase:'waiting',viewerId:null,dockPlayerId:'p0'});
  for (const node of player.nodes.filter(node=>node.kind==='player')) expect(observer.nodes.find(other=>other.id===node.id)?.bounds).toEqual(node.bounds);
  expect(cards(observer).every(node=>!node.eligible&&node.actionId===null&&node.card.face==='down')).toBe(true);
  expect(observer.nodes.filter(node=>node.kind==='player')).toHaveLength(5);
});
test('rotated card hit testing follows the visible shape rather than its unrotated bounds', () => {
  const scene = buildScene(input());
  const node = {...cards(scene)[0],bounds:{x:100,y:100,width:40,height:80},rotation:45};
  const rotated = {...scene,nodes:[node]};
  expect(hitTest(rotated,{x:110,y:105})).toBeNull();
  expect(hitTest(rotated,{x:142,y:119})?.id).toBe(node.id);
  expect(hitTest({...scene,nodes:[{...node,eligible:false}]},{x:142,y:119})).toBeNull();
});
test('public rotation is finite and bounded, while generic counter footprints reserve label space', () => {
  const first = fixture();
  const source = {...first,cards:[{...first.cards[0],rotation:999},{...first.cards[1],rotation:NaN}],players:first.players.map(player=>({...player,counters:[{label:'칩',value:800}]}))};
  const scene = buildScene({...input(source),size:{width:358,height:480},viewport:{width:390,height:844}});
  expect(cards(scene).map(card=>card.rotation)).toEqual([45,0]);
  for (const player of scene.nodes.filter(node=>node.kind==='player')) {
    expect(player.bounds.height).toBeGreaterThanOrEqual(player.figureBounds!.height+36);
  }
});
test('a measured public halo is passed through without inventing game-specific decoration', () => {
  const halo = {bounds:{x:152,y:500,width:44,height:44},color:'rgb(80, 40, 90)',opacity:.14};
  const scene = buildScene({...input(),playerHalos:{p0:halo}});
  const player = scene.nodes.find(node=>node.kind==='player'&&node.id==='p0');
  expect(player?.kind==='player'&&player.halo).toEqual(halo);
  expect(player?.kind==='player'&&player.halo?.bounds).not.toBe(halo.bounds);
  expect(scene.nodes.filter(node=>node.kind==='player'&&node.id!=='p0').every(node=>node.kind==='player'&&node.halo===undefined)).toBe(true);
});
test('short landscape explicit tricks use the original played-order decision-column row', () => {
  const first = fixture();
  const presentation = {...first,cards:first.cards.map(card=>({...card,zoneId:'table'}))};
  const viewport = {width:800,height:360};
  const regions = {arena:{x:8,y:40,width:452,height:152},dock:{x:8,y:196,width:784,height:84},hand:{x:108,y:200,width:584,height:80}};
  const scene = buildScene({...input(presentation),size:{width:800,height:280},viewport,regions,cardSeats:{ace:4,king:1}});
  const layout = calculateTableLayout({viewport,region:regions.arena,seatCount:5,watching:false});
  expect(layout.mode).toBe('landscape');
  for (const [index,node] of cards(scene).entries()) {
    const position = cardRowAnchor(layout.rowCenterX,index,2);
    expect(node.bounds).toEqual({x:regions.arena.x+layout.ring.x+position.x,y:regions.arena.y+position.y,width:32,height:44.8});
  }
  expect(cards(scene)[0].bounds.y).toBe(cards(scene)[1].bounds.y);
  expect(cards(scene)[1].bounds.x-cards(scene)[0].bounds.x).toBe(36);
});
