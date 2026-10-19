import {expect,test} from 'vitest';
import {sameBackMotionSpace,neutralDealOrigin,transferTiming,transferReadableTarget} from './transferPolicy';
import type {Environment,PlannedNode,PresentationFrame,TableDocument} from './contracts';
import {publicPaintResources} from './paintResources';
const metric={fontSize:16,lineHeight:20,fontWeight:700,paddingX:8,paddingY:8,minHeight:44,pulse:1};
const env:Environment={width:1440,height:900,fontFamily:'Body',artFontFamily:'Display',textScale:1,controls:{command:metric,choice:metric},fontRevision:'1',revision:'1'};
test('only font-resource completion may retain a neutral back origin in an unchanged measured space',()=>{
    const next={...env,fontRevision:'2',revision:'2'};expect(sameBackMotionSpace(env,next)).toBe(true);
    for(const changed of [{...next,width:1439},{...next,height:899},{...next,textScale:1.5},{...next,fontFamily:'Other'},{...next,artFontFamily:'Other'},{...next,scrollbarWidth:24},{...next,scrollbarHeight:24},{...next,controls:{...next.controls,command:{...metric,paddingX:12}}},{...next,fontRevision:'1'}])expect(sameBackMotionSpace(env,changed)).toBe(false);
    expect(transferTiming(50)).toEqual({duration:360,stagger:20});expect(transferTiming(8)).toEqual({duration:360,stagger:70});
});
function freshOrigin(settled=true){
 const context={session:'s',audience:'me',generation:'old',revision:'1'},participant={id:'me',name:'Me',markers:[]},opponents=Array.from({length:4},(_,i)=>({id:`p${i}`,name:`Peer ${i}`,handCount:0}));
 const document:TableDocument<unknown>={context,participant,opponents,hand:[],facts:[],collections:[{id:'stock',label:'Deck',purpose:'stock',kind:'deck',...(settled?{availability:'next-deal' as const}:{}),hiddenCount:53,cards:[]}],decision:{id:'empty',kind:'commands',commands:[]},offer:{id:'empty',actions:[]}};
 const box={x:0,y:0,width:48,height:48},nodes:PlannedNode[]=[{id:'own',kind:'group',parent:null,label:'',inert:true,ownHandAnchor:{participantId:'me',count:0},box},...opponents.map(peer=>({id:peer.id,kind:'group' as const,parent:null,label:'',inert:true,recipientId:peer.id,recipientCount:0,box}))];
 const previous:PresentationFrame={id:1,context,environment:env,offerId:'empty',nodes,width:1440,height:900,recipe:'stacked',settled,rosterIds:['me',...opponents.map(peer=>peer.id)],paintResources:publicPaintResources(document)};
 const next:TableDocument<unknown>={...document,context:{...context,generation:'new',revision:'2'},opponents:opponents.map(peer=>({...peer,handCount:10})),hand:Array.from({length:10},(_,i)=>({id:`c${i}`,ownerId:'me',label:`Card ${i}`,visual:{kind:'standard' as const,suit:'Spade' as const,rank:i+2}})),collections:[{id:'stock',label:'Kitty',purpose:'stock',hiddenCount:3,cards:[]}],deals:[{id:'initial',source:'stock',cardIds:[],handCount:10,recipients:opponents.map(peer=>({participantId:peer.id,count:10}))}]};return {previous,next,document};
}
test.each([false,true])('fresh distribution retains a resource-only %s settled origin with exact full ownership/count proof',settled=>{
 const {previous,next}=freshOrigin(settled);expect(previous.nodes.some(node=>node.stockCount!==undefined)).toBe(false);expect(neutralDealOrigin(previous,next)).toBe(true);expect(neutralDealOrigin(null,next)).toBe(false);
 for(const key of ['session','audience','generation'] as const)expect(neutralDealOrigin(previous,{...next,context:{...next.context,[key]:key==='generation'?'old':'other'}})).toBe(false);
 for(const invalid of [{...next,deals:undefined},{...next,deals:[]},{...next,deals:[next.deals![0],next.deals![0]]},{...next,hand:next.hand.slice(1)},{...next,opponents:next.opponents!.map((peer,i)=>i?peer:{...peer,handCount:9})},{...next,opponents:[...next.opponents!].reverse()},{...next,participant:{...next.participant,role:'observer' as const}},{...next,collections:undefined},{...next,collections:[{...next.collections![0],hiddenCount:4}]}])expect(neutralDealOrigin(previous,invalid)).toBe(false);
 for(const invalid of [{...previous,paintResources:undefined},{...previous,paintResources:{status:'unavailable' as const,reason:'budget' as const}},{...previous,rosterIds:[...previous.rosterIds!].reverse()},{...previous,modalId:'modal'},{...previous,nodes:previous.nodes.map(node=>node.recipientId==='p0'?{...node,recipientCount:1}:node)},{...previous,nodes:[...previous.nodes,{id:'private',parent:null,kind:'card' as const,label:'Private',zoneId:'hand',entityId:'secret',ownerId:'me',visual:{kind:'standard' as const,suit:'Heart' as const,rank:2},box:{x:0,y:0,width:88,height:124}}]}])expect(neutralDealOrigin(invalid,next)).toBe(false);
});
test.each(['new-public','own-alias'])('initial deal retention rejects uncounted destination public faces: %s',entityId=>{
 const {previous,next}=freshOrigin(),card={id:entityId==='own-alias'?next.hand[0].id:'new-public',ownerId:'me',label:'Public',visual:next.hand[0].visual};
 for(const purpose of ['play','captured'] as const)expect(neutralDealOrigin(previous,{...next,collections:[...next.collections!,{id:'new-board',label:'Board',purpose,cards:[card]}]})).toBe(false);
});
test('completed resources may retain public history but Next metadata and changed temporal roles cannot promote it',()=>{
 const {previous,next,document}=freshOrigin(),history={id:'history',label:'Captured',purpose:'captured' as const,collectedBy:'p0',cards:[{id:'old-public',ownerId:'p0',label:'Public',visual:{kind:'standard' as const,rank:2,suit:'Club' as const}}]};
 expect(neutralDealOrigin({...previous,paintResources:publicPaintResources({...document,collections:[...document.collections!,history]})},next)).toBe(true);
 expect(neutralDealOrigin(previous,{...next,hand:[],opponents:document.opponents,deals:undefined})).toBe(false);
 expect(neutralDealOrigin({...previous,settled:false},next)).toBe(false);
 expect(neutralDealOrigin({...previous,paintResources:publicPaintResources({...document,collections:[{...document.collections![0],availability:'current'}]})},next)).toBe(false);
 expect(neutralDealOrigin(previous,{...next,deals:[{...next.deals![0],recipients:[{participantId:'p0',count:40}]}]})).toBe(false);
});

test('an active transfer may survive only equivalent card identities, ancestry and measured space',async()=>{
 const {sameTransferPresentation}=await import('./transferPolicy');const root:PlannedNode={id:'root',parent:null,kind:'group',label:'root',box:{x:0,y:0,width:1440,height:900}},card:PlannedNode={id:'card',parent:'root',kind:'card',label:'card',entityId:'entity',ownerId:'me',zoneId:'hand',visual:{kind:'standard',rank:2,suit:'Club'},box:{x:10,y:10,width:88,height:124}};
 const frame:import('./contracts').PresentationFrame={id:1,context:{session:'s',audience:'me',generation:'hand1',revision:'1'},environment:env,offerId:'offer1',width:1440,height:900,recipe:'stacked',nodes:[root,card]};
 const notice:PlannedNode={id:'notice',parent:'root',kind:'text',label:'late notice',role:'body',box:{x:0,y:0,width:100,height:20}};
 expect(sameTransferPresentation(frame,{...frame,id:2,context:{...frame.context,revision:'2'},offerId:'offer2',nodes:[root,notice,card]})).toBe(true);
 for(const changed of [{...frame,context:{...frame.context,audience:'other'}},{...frame,context:{...frame.context,generation:'hand2'}},{...frame,environment:{...env,revision:'2'}},{...frame,modalId:'modal'},{...frame,nodes:[{...root,box:{...root.box,y:1}},card]},{...frame,nodes:[root,{...card,box:{...card.box,x:11}}]},{...frame,nodes:[root,{...card,ownerId:'other'}]},{...frame,nodes:[root,{...card,visual:{kind:'standard' as const,rank:3,suit:'Club' as const}}]},{...frame,nodes:[root,{...card,checked:true}]}])expect(sameTransferPresentation(frame,changed)).toBe(false);
});
test('a newly enabled native select protects its path even when the card presentation is compatible',async()=>{const {transferHitTarget}=await import('./transferPolicy'),{flightPath}=await import('./transferMotion');const from={x:0,y:0,width:20,height:20},to={x:180,y:0,width:20,height:20},clip={x:0,y:0,width:220,height:100},control:PlannedNode={id:'native',parent:null,kind:'select',label:'Native choice',enabled:true,box:{x:90,y:0,width:30,height:44}};expect(flightPath(from,to,clip,[])).not.toBeNull();expect(flightPath(from,to,clip,transferHitTarget(control)?[control.box]:[])).toBeNull();for(const kind of ['command','choice','select','toggle','range','editor'] as const)expect(transferHitTarget({...control,kind})).toBe(true);expect(transferHitTarget({...control,kind:'text'})).toBe(false);});

test('a passive timed public overlay does not replace an unchanged active transfer cohort',async()=>{
 const {sameTransferPresentation}=await import('./transferPolicy');
 const root:PlannedNode={id:'table',parent:null,kind:'group',label:'Table',arrangement:'overlay',box:{x:0,y:0,width:1440,height:900}};
 const shell:PlannedNode={id:'shell',parent:'table',kind:'group',label:'Shell',box:{x:0,y:0,width:1440,height:900}};
 const card:PlannedNode={id:'hand-card',parent:'shell',kind:'card',label:'Own card',entityId:'own:ace',ownerId:'me',zoneId:'hand',visual:{kind:'standard',rank:14,suit:'Spade'},box:{x:10,y:700,width:88,height:124}};
 const frame:import('./contracts').PresentationFrame={id:1,context:{session:'s',audience:'me',generation:'hand1',revision:'1'},environment:env,offerId:'offer1',width:1440,height:900,recipe:'stacked',nodes:[root,shell,card]};
 const overlay:PlannedNode={id:'public-overlay',parent:'table',kind:'group',label:'Public cards',publicDisclosureEventId:'public-hand',box:{x:16,y:100,width:1408,height:124}};
 const publicCard:PlannedNode={id:'public-card',parent:'public-overlay',kind:'card',label:'Public card',publicDisclosureEventId:'public-hand',visual:{kind:'standard',rank:2,suit:'Club'},box:{x:0,y:24,width:64,height:90}};
 const next={...frame,id:2,context:{...frame.context,revision:'2'},nodes:[root,shell,card,overlay,publicCard]};expect(sameTransferPresentation(frame,next)).toBe(true);expect(sameTransferPresentation(next,frame)).toBe(true);
 expect(sameTransferPresentation(frame,{...next,nodes:next.nodes.map(node=>node===card?{...node,entityId:'own:replacement'}:node)})).toBe(false);
 expect(sameTransferPresentation(frame,{...next,nodes:next.nodes.map(node=>node===card?{...node,box:{...node.box,x:11}}:node)})).toBe(false);
 const ordinaryPublic={...publicCard,publicDisclosureEventId:undefined};expect(sameTransferPresentation(frame,{...next,nodes:[root,shell,card,overlay,ordinaryPublic]})).toBe(false);
});

test('passive identity names, counts, roles and private faces retain flight protection without command authority',async()=>{
 const {transferProtectedTarget}=await import('./transferPolicy'),base:PlannedNode={id:'passive',parent:null,kind:'group',label:'',box:{x:90,y:40,width:32,height:24}};
 for(const node of [{...base,kind:'text' as const,role:'participant-name' as const},{...base,kind:'text' as const,role:'name' as const},{...base,kind:'text' as const,role:'small' as const},{...base,kind:'figure' as const,ownerId:'peer'},{...base,kind:'card' as const,recipientId:'peer',recipientCount:6},{...base,ownHandAnchor:{participantId:'self',count:6}},{...base,participantStatusFor:'peer'},{...base,kind:'card' as const,zoneId:'hand',entityId:'private'}]){expect(transferProtectedTarget(node)).toBe(true);expect(node.actionId).toBeUndefined();expect(node.enabled).toBeUndefined();}
 expect(transferProtectedTarget(base)).toBe(false);expect(transferProtectedTarget({...base,kind:'text',role:'art'})).toBe(false);expect(transferProtectedTarget({...base,kind:'card',zoneId:'captured',entityId:'public'})).toBe(false);
});

test('empty count evidence is omitted only with its unique paired figure, never instead of the figure or name',()=>{const box={x:0,y:0,width:48,height:44},anchor={id:'count',parent:null,kind:'group' as const,label:'',inert:true,recipientId:'peer',recipientCount:0,box},figure={id:'figure',parent:null,kind:'figure' as const,label:'Peer',ownerId:'peer',box},name={id:'name',parent:null,kind:'text' as const,label:'Peer',role:'participant-name' as const,box};expect(transferReadableTarget(anchor)).toBe(true);expect(transferReadableTarget(anchor,[anchor,figure])).toBe(false);expect(transferReadableTarget(figure,[anchor,figure])).toBe(true);expect(transferReadableTarget(name,[anchor,figure,name])).toBe(true);for(const change of [{actionId:'act'},{entityId:'card'},{label:'paint'},{visual:{kind:'back' as const}},{inert:false}])expect(transferReadableTarget({...anchor,...change},[figure])).toBe(true);expect(transferReadableTarget(anchor,[{...figure,ownerId:'foreign'}])).toBe(true);});


test('visible continuation binds the exact available semantic resource plane while ordinary revision metadata may change',async()=>{
 const {sameTransferPresentation}=await import('./transferPolicy');const frame={id:1,context:{session:'s',audience:'a',generation:'g',revision:'1'},environment:{revision:'e'},width:800,height:800,nodes:[],paintResources:{status:'available',collections:[{id:'stock',purpose:'stock',availability:'current',hiddenCount:3,cards:[]}]}} as unknown as import('./contracts').PresentationFrame;
 expect(sameTransferPresentation(frame,{...frame,id:2,offerId:'different',context:{...frame.context,revision:'2'}})).toBe(true);
 expect(sameTransferPresentation(frame,{...frame,paintResources:undefined})).toBe(false);expect(sameTransferPresentation(frame,{...frame,paintResources:{status:'unavailable',reason:'budget'}})).toBe(false);
 if(frame.paintResources?.status!=='available')throw Error('resources');for(const change of [{hiddenCount:2},{availability:'next-deal' as const},{cards:[{entityId:'public',ownerId:'me',visual:{kind:'standard' as const,suit:'Spade' as const,rank:2}}]}])expect(sameTransferPresentation(frame,{...frame,paintResources:{status:'available',collections:frame.paintResources.collections.map(stock=>({...stock,...change}))}})).toBe(false);
});
