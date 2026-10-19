import { expect, test } from 'vitest';
import { BoundsRegistry, calculateArenaCoordinates, calculateHandCoordinates, calculateSceneCoordinates, calculateTableRowCoordinates, calculateAdjacentHandCoordinates, coordinateId, type SceneCoordinatesInput } from './sceneCoordinates';
import { planMovement } from './movement';

const frame:SceneCoordinatesInput={viewport:{width:1440,height:900},regions:{
  arena:{x:0,y:0,width:900,height:540},dock:{x:0,y:540,width:900,height:200},hand:{x:200,y:600,width:500,height:180}},
  seatCount:5,perspectiveSeat:0,watching:false,dockPlayerId:'a',centeredDock:true,
  players:Array.from({length:5},(_,seat)=>({id:String.fromCharCode(97+seat),seat,height:64})),handCardIds:['private-token-1','private-token-2'],tableCards:[]};

test('production fan and dock geometry share one explicit frame origin',()=>{
  const scene=calculateSceneCoordinates(frame);
  expect(scene.dock?.node.bounds).toEqual({x:365,y:608,width:170,height:64});
  expect(scene.hand.cards.map(card=>card.bounds)).toEqual([
    {x:339,y:614,width:108,height:151.2},{x:453,y:614,width:108,height:151.2}]);
  expect(scene.arena.players.find(player=>player.id==='player:b')?.bounds).toEqual({x:641.7,y:258,width:172.8,height:64});
});
test('centering and perspective changes preserve identities, and only the dock responds to phase',()=>{
  const waiting=calculateSceneCoordinates(frame),play=calculateSceneCoordinates({...frame,centeredDock:false});
  expect(play.dock?.node.bounds).toEqual({x:10,y:611,width:170,height:64});
  expect(play.arena.nodes).toEqual(waiting.arena.nodes);
  const shifted=calculateSceneCoordinates({...frame,perspectiveSeat:1,dockPlayerId:'b'});
  expect(shifted.arena.players.find(player=>player.id==='player:a')).toBeDefined();
  expect(shifted.dock?.node.id).toBe('player:b');
});
test('a card changes zones without changing its registry/movement identity',()=>{
  const hand=calculateSceneCoordinates(frame),table=calculateSceneCoordinates({...frame,handCardIds:['private-token-2'],tableCards:[{id:'private-token-1',seat:0,rotation:-2}]});
  const id=coordinateId('card','private-token-1');
  expect(hand.nodes.find(node=>node.id===id)?.zone).toBe('hand');
  expect(table.nodes.find(node=>node.id===id)?.zone).toBe('arena');
  expect(planMovement(hand.nodes,table.nodes,{enabled:true,duration:300}).some(move=>move.id===id)).toBe(true);
  expect(table.nodes.find(node=>node.id===id)?.rotation).toBe(-2);
});
test('two-row exchange fans rise upward without enlarging the reserved hand region',()=>{
  const result=calculateHandCoordinates({viewport:{width:320,height:568},region:{x:5,y:400,width:150,height:100},cardIds:Array.from({length:14},(_,i)=>`opaque-${i}`)});
  expect(result.layout.rows).toHaveLength(2);
  expect(result.cards[0].bounds.y).toBe(328);
  expect(result.cards[7].bounds.y).toBe(414);
  expect(result.cards.every(card=>card.bounds.width===56)).toBe(true);
});
test('landscape retains the original played-order row in the controls region',()=>{
  const result=calculateArenaCoordinates({viewport:{width:800,height:360},region:{x:10,y:50,width:360,height:180},seatCount:5,perspectiveSeat:0,watching:false,players:[],tableCards:[{id:'first',seat:4},{id:'second',seat:2}]});
  expect(result.layout.mode).toBe('landscape');
  expect(result.cards[1].bounds.x-result.cards[0].bounds.x).toBe(36);
  expect(result.cards.map(card=>card.bounds.y)).toEqual([50,50]);
  expect(result.cards[0].bounds.x).toBeGreaterThan(370);
});
test('generic rows and adjacent hidden stacks preserve their reserved public footprints',()=>{
  const rows=calculateTableRowCoordinates({region:{x:10,y:20,width:300,height:200},cardIds:['x','y','z'],cardWidth:32,centerY:100,zoneIndex:0,zoneCount:2});
  expect(rows.map(node=>node.bounds.x)).toEqual([108,144,180]);
  expect(rows.every(node=>Math.abs(node.bounds.y-71.2)<1e-10)).toBe(true);
  const backs=calculateAdjacentHandCoordinates({size:{width:320,height:400},owner:{x:200,y:50,width:92,height:56},cardIds:['opaque-a','opaque-b'],cardWidth:40});
  expect(backs.map(node=>node.bounds)).toEqual([{x:212,y:110,width:32,height:44.8},{x:248,y:110,width:32,height:44.8}]);
  expect(backs.every(node=>node.bounds.y>=106)).toBe(true);
});
test('preview row pitch does not change the production default two-row hand',()=>{
  const input={viewport:{width:320,height:568},region:{x:5,y:400,width:150,height:100},cardIds:Array.from({length:14},(_,i)=>`opaque-${i}`)};
  const production=calculateHandCoordinates(input),preview=calculateHandCoordinates({...input,paddingTop:68,rowPitch:58.5});
  expect(production.cards[0].bounds.y).toBe(328);
  expect(preview.cards[0].bounds.y).toBe(409.5);
  expect(preview.cards[7].bounds.y).toBe(468);
});
test.each([3,5,6] as const)('supported %s-seat geometry is finite after viewport resize',seatCount=>{
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:800,height:360}]){
    const result=calculateArenaCoordinates({viewport,region:{x:11,y:19,width:Math.min(600,viewport.width),height:280},seatCount,perspectiveSeat:seatCount-1,watching:true,
      players:Array.from({length:seatCount},(_,seat)=>({id:`p${seat}`,seat})),tableCards:Array.from({length:seatCount},(_,seat)=>({id:`opaque-${seat}`,seat}))});
    expect(result.nodes.every(node=>Object.values(node.bounds).every(Number.isFinite))).toBe(true);
    expect(result.nodes).toHaveLength(seatCount*2);
  }
});
test('opaque geometry inputs never inspect labels or hidden face metadata',()=>{
  const hidden={id:'opaque-unrelated-token',seat:2,
    get face():never{throw new Error('Hidden face read');},get rank():never{throw new Error('Hidden rank read');},
    get visual():never{throw new Error('Hidden artwork read');},get label():never{throw new Error('Hidden label read');}};
  const result=calculateArenaCoordinates({viewport:frame.viewport,region:frame.regions.arena,seatCount:5,perspectiveSeat:0,watching:true,players:[],tableCards:[hidden]});
  expect(result.cards[0].id).toBe('card:opaque-unrelated-token');
  expect(Object.keys(result.cards[0]).sort()).toEqual(['bounds','id','kind','rotation','z','zone']);
});
test('scoped handoff survives retiring old owners and idempotent publication',()=>{
  const registry=new BoundsRegistry(),id='card:opaque',hand={id,bounds:{x:5,y:50,width:60,height:84}},trick={id,bounds:{x:200,y:80,width:72,height:100.8}};
  const receipts:unknown[]=[];const stop=registry.subscribe(snapshot=>receipts.push(snapshot));
  registry.replace('hand',[hand]);const version=registry.revision;
  registry.replace('hand',[hand]);expect(registry.revision).toBe(version);
  registry.replace('trick',[trick]);registry.clear('hand');
  expect(registry.get(id)).toEqual(trick.bounds);expect(registry.snapshot()).toHaveLength(1);
  registry.clear('trick');expect(registry.snapshot()).toEqual([]);expect(receipts).toHaveLength(4);
  stop();registry.replace('hand',[hand]);expect(receipts).toHaveLength(4);
});
test('invalid commits are atomic, and geometry snapshots cannot be mutated externally',()=>{
  const registry=new BoundsRegistry(),bounds={x:1,y:2,width:3,height:4};registry.replace('hand',[{id:'opaque',bounds}]);
  bounds.x=999;expect(registry.get('opaque')?.x).toBe(1);
  expect(()=>registry.replace('hand',[{id:'new',bounds},{id:'bad',bounds:{...bounds,width:NaN}}])).toThrow();
  expect(registry.snapshot().map(node=>node.id)).toEqual(['opaque']);
  expect(Object.isFrozen(registry.get('opaque'))).toBe(true);
  expect(()=>calculateSceneCoordinates({...frame,handCardIds:['private-token-1'],tableCards:[{id:'private-token-1',seat:0}]})).toThrow(/unique/);
});
