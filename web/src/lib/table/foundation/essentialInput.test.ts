import {expect,test} from 'vitest';
import {essentialInputMask} from './essentialInput';
import type {PlannedNode,PresentationFrame} from './contracts';
const node=(id:string,parent:string|null,extra:Partial<PlannedNode>={}):PlannedNode=>({id,parent,kind:'group',label:id,box:{x:0,y:0,width:100,height:100},...extra});
const fixture=():PresentationFrame=>({decisionLaneId:'decisions',id:1,width:500,height:700,recipe:'stacked',context:{session:'table',audience:'alice',generation:'hand',revision:'1'},offerId:'offer',focusId:null,environment:{width:500,height:700,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:14,paddingY:8,minHeight:44,pulse:1}}},nodes:[
 node('table',null),node('table-underlay','table'),node('room-header','table-underlay'),node('settings','room-header',{kind:'command',shellActionId:'settings',shellIntent:{kind:'open-page',page:'settings'},enabled:true}),
 node('table-body','table-underlay'),node('decisions','table-body'),node('label','decisions',{kind:'text',role:'small'}),node('command','decisions',{kind:'command',actionId:'pass',enabled:false}),
 node('fields','decisions'),node('choice','fields',{kind:'choice',fieldId:'suit',optionId:'spade',enabled:true}),node('select','fields',{kind:'select',fieldId:'count',enabled:false}),
 node('hand','table-underlay'),node('own-card','hand',{kind:'card',entityId:'ace',zoneId:'hand',cardId:'ace',enabled:true}),node('blocked-card','hand',{kind:'card',entityId:'two',zoneId:'hand',inspectCardId:'two',enabled:false}),node('readonly','hand',{kind:'card',entityId:'three',zoneId:'hand'}),
]});
const replace=(frame:PresentationFrame,id:string,changes:Partial<PlannedNode>):PresentationFrame=>({...frame,nodes:frame.nodes.map(node=>node.id===id?{...node,...changes}:node)});

test('derives every enabled or disabled game input while hiding only the complete decision lane',()=>{
 const frame=fixture(),result=essentialInputMask(frame);expect(result).toEqual({kind:'lane',laneId:'decisions',inputIds:['command','choice','select','own-card','blocked-card'],laneNodeIds:['decisions','label','command','fields','choice','select']});expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result!.inputIds)).toBe(true);expect(Object.isFrozen(result!.laneNodeIds)).toBe(true);
 expect(result!.laneNodeIds).not.toContain('hand');expect(result!.inputIds).not.toContain('settings');expect(result!.inputIds).not.toContain('readonly');expect(frame.nodes.find(node=>node.id==='command')!.enabled).toBe(false);
});
test('rejects arbitrary header, hand, unknown, modal and detached lane nominations',()=>{
 const frame=fixture();for(const decisionLaneId of ['room-header','hand','settings','missing','table','table-underlay',''])expect(essentialInputMask({...frame,decisionLaneId})).toBeNull();
 expect(essentialInputMask({...frame,modalId:'dialog'})).toBeNull();expect(essentialInputMask(replace(frame,'decisions',{parent:'table'}))).toBeNull();expect(essentialInputMask(replace(frame,'decisions',{parent:'room-header'}))).toBeNull();expect(essentialInputMask(replace(frame,'decisions',{kind:'text'}))).toBeNull();
});
test('fails closed on every mixed host, form, preference, disclosure and assistance lane',()=>{
 const frame=fixture();const forbidden:Partial<PlannedNode>[]=[
 {shellActionId:'room:pass'},{shellSlot:'room-code'},{shellIcon:'menu'},{localIntent:'toggle-information'},
 {formIntent:'submit'},{formActionId:'submit'},{formLeaseId:'lease'},{formNavigation:{leaseId:'lease'}},{formField:{leaseId:'lease',fieldId:'field',value:true}},{editor:{leaseId:'lease',fieldId:'field',kind:'text',value:'',maxCodeUnits:10}},
 {preference:{id:'local',kind:'toggle',label:'Local',enabled:true,value:true}},{disclosureCatalogId:'history'},{disclosureFormActionId:'delete'},{modalLeaseId:'history:1'},{publicDisclosureEventId:'public'},
 {assistanceIntent:{kind:'toggle-reactions'}},{feedbackDismissId:'feedback'},
 ];
 for(const changes of forbidden)expect(essentialInputMask(replace(frame,'command',changes)),JSON.stringify(changes)).toBeNull();
});
test('rejects stock, hand, participant and private identity beneath the decision lane',()=>{
 const frame=fixture();for(const changes of [{entityId:'ace'},{zoneId:'hand'},{ownerId:'alice'},{recipientId:'bob'},{recipientCount:10},{stockCount:53},{ownHandAnchor:{participantId:'alice',count:10}},{collectionPurpose:'stock' as const},{visual:{kind:'back' as const}},{kind:'card' as const,cardId:'ace'}])expect(essentialInputMask(replace(frame,'label',changes))).toBeNull();
});
test('rejects malformed or unbound controls instead of quietly omitting a game target',()=>{
 const frame=fixture();for(const changes of [{kind:'group' as const},{fieldId:'field'},{actionId:''}])expect(essentialInputMask(replace(frame,'command',changes))).toBeNull();
 expect(essentialInputMask(replace(frame,'choice',{optionId:''}))).toBeNull();expect(essentialInputMask({...frame,nodes:[...frame.nodes,node('unbound','decisions',{kind:'command'})]})).toBeNull();expect(essentialInputMask(replace(frame,'own-card',{kind:'text'}))).toBeNull();
});
test('rejects duplicate, sparse, cyclic, disconnected and foreign-reference trees',()=>{
 const frame=fixture();for(const nodes of [[...frame.nodes,frame.nodes[0]],[...frame.nodes,node('foreign','absent')],[...frame.nodes,node('second-root',null)],[...frame.nodes,node('cycle-a','cycle-b'),node('cycle-b','cycle-a')],Array(4),frame.nodes.filter(node=>node.id!=='table')])expect(essentialInputMask({...frame,nodes})).toBeNull();expect(essentialInputMask(replace(frame,'decisions',{parent:'fields'}))).toBeNull();
});
test('bounds traversal at 4096 nodes and admits a deep rooted tree without recursion',()=>{
 const frame=fixture(),nodes=[...frame.nodes];while(nodes.length<4096)nodes.push(node(`deep:${nodes.length}`,nodes.length===frame.nodes.length?'decisions':nodes.at(-1)!.id));expect(essentialInputMask({...frame,nodes})!.laneNodeIds).toHaveLength(4096-frame.nodes.length+6);expect(essentialInputMask({...frame,nodes:[...nodes,node('excess','table-underlay')]})).toBeNull();
});

const outcomeFixture=():PresentationFrame=>{const base=fixture();return {...base,settled:true,decisionLaneId:undefined,outcomeLaneId:'outcome',nodes:[...base.nodes.filter(node=>!['decisions','label','command','fields','choice','select'].includes(node.id)),node('outcome','table-body'),node('outcome-label','outcome',{kind:'text',role:'compact-display',label:'+3점'}),node('trump','outcome',{kind:'suit',suit:'Heart',label:'하트'}),node('public-face','outcome',{kind:'card',visual:{kind:'standard',suit:'Spade',rank:14},label:'마이티'}),node('next','outcome',{kind:'command',actionId:'next',enabled:true}),node('information','outcome',{kind:'command',localIntent:'toggle-information',enabled:true})]};};
test('settled result mask admits only readonly glyphs and cards, continuation and exact information opener',()=>{
 const frame=outcomeFixture(),mask=essentialInputMask(frame)!;expect(mask).not.toBeNull();expect(mask.laneId).toBe('outcome');expect(mask.inputIds).toEqual(['own-card','blocked-card','next','information']);expect(mask.laneNodeIds).toEqual(['outcome','outcome-label','trump','public-face','next','information']);expect(mask.inputIds).not.toContain('settings');expect(mask.inputIds).not.toContain('public-face');expect(Object.isFrozen(mask.inputIds)).toBe(true);
});
test('result nomination cannot widen active or arbitrary decision lanes',()=>{
 const frame=outcomeFixture();for(const settled of [undefined,false])expect(essentialInputMask({...frame,settled})).toBeNull();for(const outcomeLaneId of ['hand','table','decisions','room-header','missing'])expect(essentialInputMask({...frame,outcomeLaneId} as PresentationFrame)).toBeNull();expect(essentialInputMask({...frame,decisionLaneId:'decisions'})).toBeNull();expect(essentialInputMask({...frame,modalId:'dialog'})).toBeNull();
});
test('closed result lane refuses host capabilities, live artwork, anchors, leases and pseudo openers',()=>{
 const frame=outcomeFixture(),changes:Partial<PlannedNode>[]=[{entityId:'card'},{zoneId:'stock'},{ownerId:'me'},{recipientId:'peer'},{recipientCount:0},{stockCount:0},{recycleAnchor:{totalCount:53,captionId:'count'}},{recycleCaption:'count'},{ownHandAnchor:{participantId:'me',count:0}},{collectionPurpose:'play'},{publicDisclosureEventId:'reveal'},{inspectionPreviewFor:'card'},{participantStatusFor:'me'},{clockTextScale:1},{figureCue:{id:'cue'}},{appearance:{thinking:true}},{shellActionId:'leave'},{disclosureCatalogId:'history'},{modalLeaseId:'lease'},{formLeaseId:'lease'},{cardId:'card'},{inspectCardId:'card'},{fieldId:'field'},{optionId:'option'},{kind:'figure'},{kind:'progress'},{kind:'icon'},{localIntent:'toggle-scoreboard'},{localIntent:'toggle-information',actionId:'next'},{kind:'text',localIntent:'toggle-information'},{kind:'command',actionId:'next',visual:{kind:'back'}},{enabled:true}];for(const patch of changes)expect(essentialInputMask(replace(frame,'public-face',patch)),JSON.stringify(patch)).toBeNull();expect(essentialInputMask(replace(frame,'information',{localIntent:undefined}))).toBeNull();expect(essentialInputMask(replace(frame,'next',{actionId:undefined}))).toBeNull();
});

test('exact engine card-set submission is masked with game input and cannot carry host authority',()=>{
 const frame=fixture(),batch={...frame,nodes:frame.nodes.map(n=>n.id==='command'?{...n,id:'card-selection-submit',actionId:undefined,localIntent:'submit-card-set' as const}:n)};
 expect(essentialInputMask(batch)?.inputIds).toContain('card-selection-submit');
 for(const patch of [{actionId:'forged'},{shellActionId:'forged'},{id:'arbitrary-host'},{kind:'group' as const}])expect(essentialInputMask(replace(batch,'card-selection-submit',patch))).toBeNull();
});

test('card-action draft choices are masked as game inputs and cannot poison readonly or mixed targets',()=>{
 const frame=fixture(),choice=replace(frame,'choice',{fieldId:undefined,optionId:undefined,cardActionOptionId:'native:call'});
 expect(essentialInputMask(choice)?.inputIds).toContain('choice');
 for(const changes of [{actionId:'also-command'},{fieldId:'also-field'},{optionId:'also-option'},{cardId:'also-card'},{kind:'text' as const},{shellActionId:'also-host'}])expect(essentialInputMask(replace(choice,'choice',changes))).toBeNull();
 expect(essentialInputMask(replace(frame,'readonly',{cardActionOptionId:'poison'}))).toBeNull();
 expect(essentialInputMask(replace(outcomeFixture(),'public-face',{cardActionOptionId:'poison'}))).toBeNull();
});

test('card-action opener is an essential game input while picker controls cannot enter readonly lanes',()=>{
 const frame=fixture(),opener=replace(frame,'command',{actionId:undefined,cardActionPickerIntent:{kind:'open'}});
 expect(essentialInputMask(opener)?.inputIds).toContain('command');
 for(const changes of [{actionId:'poison'},{localIntent:'submit-card-set' as const},{cardActionPickerIntent:{kind:'close' as const,leaseId:'lease'}}])expect(essentialInputMask(replace(opener,'command',changes))).toBeNull();
 expect(essentialInputMask(replace(outcomeFixture(),'public-face',{cardActionPickerIntent:{kind:'open'}}))).toBeNull();
});

const nativeFixture=():PresentationFrame=>{const base=fixture();return {...base,essentialInputKind:'native-cards',decisionLaneId:undefined,nodes:base.nodes.filter(n=>!['decisions','label','command','fields','choice','select','readonly'].includes(n.id))};};
test('native-card provenance nominates exact hand bindings without a concealed lane',()=>{
 const frame=nativeFixture(),mask=essentialInputMask(frame)!;
 expect(mask).toEqual({kind:'native-cards',inputIds:['own-card','blocked-card'],laneNodeIds:[]});
 expect(mask.laneId).toBeUndefined();expect(Object.isFrozen(mask.inputIds)).toBe(true);
 expect(essentialInputMask({...frame,essentialInputKind:undefined})).toBeNull();
});
test('native recipe rejects conflicting lanes, passive inputs, foreign roots and mixed authority',()=>{
 const frame=nativeFixture();
 for(const patch of [{decisionLaneId:'decisions'},{outcomeLaneId:'outcome' as const},{settled:true},{modalId:'picker'}])expect(essentialInputMask({...frame,...patch})).toBeNull();
 expect(essentialInputMask(replace(frame,'own-card',{enabled:false}))).toBeNull();
 for(const patch of [{actionId:'native'},{fieldId:'choice'},{cardActionOptionId:'variant'},{cardActionPickerIntent:{kind:'open' as const}},{shellActionId:'host'},{localIntent:'toggle-information' as const},{optionId:'choice'},{collectionPurpose:'play' as const},{entityId:'foreign'},{cardId:'other',inspectCardId:'ace'},{zoneId:'play'},{parent:'room-header'},{inert:true},{kind:'text' as const}])expect(essentialInputMask(replace(frame,'own-card',patch)),JSON.stringify(patch)).toBeNull();
 expect(essentialInputMask({...frame,nodes:[...frame.nodes,node('extra','table-underlay',{kind:'command',actionId:'pass',enabled:false})]})).toBeNull();
 expect(essentialInputMask({...frame,nodes:[...frame.nodes,node('duplicate','hand',{kind:'card',cardId:'ace',entityId:'ace',zoneId:'hand',enabled:true})]})).toBeNull();
 expect(essentialInputMask(replace(frame,'hand',{parent:'room-header'}))).toBeNull();
});
test('native masking retains the same rooted4096-node traversal limit',()=>{
 const frame=nativeFixture(),nodes=[...frame.nodes];
 while(nodes.length<4096)nodes.push(node(`native-depth:${nodes.length}`,nodes.at(-1)!.id));
 expect(essentialInputMask({...frame,nodes})?.kind).toBe('native-cards');
 expect(essentialInputMask({...frame,nodes:[...nodes,node('excess','hand')]})).toBeNull();
});

test('admits only the runtime-owned exact settled details read route and rejects mixed authority',()=>{
 const frame={...outcomeFixture(),outcomeReadCatalogId:'hand-details'},direct=replace(frame,'information',{localIntent:undefined,disclosureCatalogId:'hand-details'});
 expect(essentialInputMask(direct)?.inputIds).toContain('information');
 expect(essentialInputMask({...direct,outcomeReadCatalogId:undefined})).toBeNull();expect(essentialInputMask({...direct,outcomeReadCatalogId:'other'})).toBeNull();
 for(const patch of [{actionId:'next'},{localIntent:'toggle-information' as const},{formActionId:'next'},{shellActionId:'next'},{kind:'text' as const}])expect(essentialInputMask(replace(direct,'information',patch))).toBeNull();
});
