import {expect,it,vi} from 'vitest';
import {copyPublicGameplayPresentation,PUBLIC_GAMEPLAY_LIMITS} from './publicGameplayPresentation';
import {validateInformation} from './information';
import {mightyJokerDocument} from './mightyJokerFixture';
import {createCardSession} from './session';
import type {InformationPanel,TableDocument} from './contracts';
function fixture():TableDocument<unknown>{return {context:{session:'s',audience:'me',generation:'g',revision:'1'},participant:{id:'me',name:'CURRENT_NAME_NOT_SNAPSHOTTED',markers:['주공'],status:{purpose:'standing',tone:'gold',value:{kind:'text',text:'주공'},badges:[{text:'4점',tone:'plain'}]}},opponents:[{id:'peer',name:'CURRENT_PEER',handCount:1,status:{purpose:'announcement',tone:'plain',value:{kind:'text',text:'PASS_TRANSIENT'}}}],hand:[],offer:{id:'authority',actions:[]},decision:{id:'authority',kind:'commands',commands:[]},facts:[{id:'phase',label:'단계',value:'카드 내기',subject:'table',essential:true}],information:[{id:'hud',title:'상황판',summary:{text:'현재 차례',tone:'accent'},primary:{value:{kind:'suit',suit:'Heart',label:'하트'}},fields:[{id:'friend',label:'공개 호출',value:{kind:'card',visual:{kind:'standard',suit:'Spade',rank:14},label:'공개 호출 스페이드 A',emphasis:'special'}},{id:'declarer',label:'주공',value:{kind:'participant',participantId:'me'}}],progress:{label:'점수',total:20,target:17,series:[{id:'team',label:'여당',value:4,tone:'gold',from:'start'}]}}],scoreboard:{id:'score',title:'누적',columns:[{id:'total',label:'누적'}],rows:[{participantId:'me',values:[-144]},{participantId:'peer',values:[91]}],disclosure:{openLabel:'CONTROL_OPEN',closeLabel:'CONTROL_CLOSE'}},statusPresentation:{informationId:'hud',fieldIds:['friend'],summary:true,progress:true}};}
it('owns only immutable public semantic values, preserving unplayed symbolic cards without paper authority',()=>{
 const doc=fixture(),snapshot=copyPublicGameplayPresentation(doc)!;expect(snapshot).not.toBeNull();
 expect(snapshot.information[0].fields[0].value).toEqual(doc.information![0].fields[0].value);expect(doc.collections).toBeUndefined();
 expect(snapshot.standing).toEqual([{participantId:'me',markers:['주공'],status:doc.participant.status},{participantId:'peer',markers:[]}]);expect(snapshot.scoreboard).not.toHaveProperty('disclosure');
 expect(snapshot.information).not.toBe(doc.information);expect(Object.isFrozen(snapshot.information[0].fields[0].value)).toBe(true);expect(Object.isFrozen(snapshot.scoreboard!.rows[0].values)).toBe(true);expect(Object.isFrozen(snapshot.standing)).toBe(true);
 expect(JSON.stringify(snapshot)).not.toMatch(/CURRENT_NAME|CURRENT_PEER|PASS_TRANSIENT|CONTROL_OPEN|authority|entityId|cardId|ownerId|zoneId|handCount|appearance/);
 const text={kind:'text' as const,text:'before'},panel={id:'hud',title:'HUD',fields:[{id:'field',label:'Field',value:text}]},markers=['first'];
 const mutable={...doc,information:[panel],statusPresentation:undefined,participant:{...doc.participant,markers}},owned=copyPublicGameplayPresentation(mutable)!;text.text='after';markers[0]='changed';panel.fields.push({id:'later',label:'Later',value:text});expect(owned.information[0].fields).toHaveLength(1);expect(owned.information[0].fields[0].value).toEqual({kind:'text',text:'before'});expect(owned.standing[0].markers).toEqual(['first']);
});
it('does not inspect private cards, names, shell or actions and excludes implicit/announcement status',()=>{
 const doc=fixture(),getter=vi.fn(()=>{throw Error('private read');});for(const name of ['hand','shell','offer','decision','forms'])Object.defineProperty(doc,name,{get:getter});Object.defineProperty(doc.participant,'name',{get:getter});for(const key of ['name','handCount','appearance'])Object.defineProperty(doc.opponents![0],key,{get:getter});
 expect(copyPublicGameplayPresentation(doc)).not.toBeNull();expect(getter).not.toHaveBeenCalled();
 const implicit={...fixture(),participant:{id:'me',name:'Name',markers:[],status:{value:{kind:'text' as const,text:'IMPLICIT_ANNOUNCEMENT'},tone:'plain' as const}}};expect(copyPublicGameplayPresentation(implicit)!.standing[0]).not.toHaveProperty('status');
});
it.each(['accessor','action','entity','symbol','cycle','prototype'] as const)('refuses unsafe selected data without executing it: %s',kind=>{
 const doc=fixture(),panel=doc.information![0],getter=vi.fn(()=> 'executed');
 if(kind==='accessor')Object.defineProperty(panel,'title',{enumerable:true,get:getter});
 if(kind==='action')Object.assign(panel.fields[0].value,{actionId:'play'});
 if(kind==='entity')Object.assign(panel.fields[0].value,{entityId:'private'});
 if(kind==='symbol')Object.assign(panel,{[Symbol('authority')]:'forged'});
 if(kind==='cycle')Object.assign(panel,{extra:panel});
 if(kind==='prototype')Object.setPrototypeOf(panel,{toJSON:getter});
 expect(copyPublicGameplayPresentation(doc)).toBeNull();expect(getter).not.toHaveBeenCalled();
});
it('retains actual two-joker Mighty public HUD through canonical ingress within explicit limits',()=>{
 const session=createCardSession({transport:()=>{}});try{session.receive(mightyJokerDocument({longName:true}));const canonical=session.snapshot().document!;const snapshot=copyPublicGameplayPresentation(canonical);expect(snapshot).not.toBeNull();expect(snapshot!.information).toEqual(canonical.information);expect(snapshot!.standing.every(person=>!person.status||person.status.purpose==='standing')).toBe(true);expect(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength).toBeLessThan(PUBLIC_GAMEPLAY_LIMITS.bytes);}finally{session.dispose();}
});
it('explicitly refuses a valid maximum public information domain exceeding64KiB without rejecting its canonical semantics',()=>{
 const panels:InformationPanel[]=Array.from({length:4},(_,p)=>({id:`panel${p}`,title:'Panel',fields:Array.from({length:12},(_,f)=>({id:`field${f}`,label:'Field',value:{kind:'inline',values:Array.from({length:4},()=>({kind:'text',text:'한'.repeat(500)}))}}))}));
 const doc={...fixture(),information:panels,statusPresentation:undefined};expect(()=>validateInformation(doc)).not.toThrow();expect(copyPublicGameplayPresentation(doc)).toBeNull();expect(doc.information).toBe(panels);expect(PUBLIC_GAMEPLAY_LIMITS).toEqual({bytes:65536,values:4096,depth:12,array:128});
});

it.each(['index-getter','iterator','subclass'] as const)('rejects unsafe opponent registries before any traversal: %s',kind=>{
 const doc=fixture(),peer=doc.opponents![0],read=vi.fn(()=>peer);let opponents=doc.opponents!;
 if(kind==='index-getter'){const values=[peer];Object.defineProperty(values,'0',{enumerable:true,get:read});opponents=values;}
 if(kind==='iterator'){const values=[peer];Object.defineProperty(values,Symbol.iterator,{value:read});opponents=values;}
 if(kind==='subclass'){class Registry extends Array<typeof peer>{};opponents=new Registry(peer);Object.defineProperty(opponents,Symbol.iterator,{value:read});}
 expect.soft(copyPublicGameplayPresentation({...doc,opponents})).toBeNull();expect(read).not.toHaveBeenCalled();
});

it('rejects sparse/extra/symbol opponent registries and plain subclass without invoking inherited iterator',()=>{
 const doc=fixture(),peer=doc.opponents![0],read=vi.fn(()=>undefined);
 const sparse=[peer];delete sparse[0];const extra=Object.assign([peer],{extra:'not-registry'}),symbol=Object.assign([peer],{[Symbol('not-registry')]:'value'});
 class Registry extends Array<typeof peer>{};const subclass=new Registry(peer);Object.defineProperty(Registry.prototype,Symbol.iterator,{get:read});
 for(const opponents of [sparse,extra,symbol,subclass])expect(copyPublicGameplayPresentation({...doc,opponents})).toBeNull();expect(read).not.toHaveBeenCalled();
});
