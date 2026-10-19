import {expect,test,vi} from 'vitest';
import {REPORT_POLICY,REPORT_TEXT_FIELD,reportFormOffer} from './reportForms';
import {createCardSession} from './session';
import type {TableDocument} from './contracts';
import type {DisclosureCatalogOffer,DisclosureContext,DisclosureReadPolicy,DisclosureScope} from './disclosures';
import type {DisclosureDocument} from './disclosureTypes';
const identity={roomId:'room',roomEpoch:'epoch',actorId:'alice',connectionEpoch:'connection',audience:'alice:0'};
function document({revision='1',catalogRevision='r1',visibility='public' as 'public'|'audience',session='game-session',generation='hand1',actorId='alice',audience='alice:0'}={}):TableDocument<string>{
 const context={...identity,actorId,audience},scope={roomId:context.roomId,roomEpoch:context.roomEpoch,actorId,connectionEpoch:context.connectionEpoch,visibility,...(visibility==='audience'?{audience}:{})};
 return{context:{session,audience,generation,revision},participant:{id:actorId,name:actorId,markers:[]},hand:[],facts:[],decision:{id:'decision',kind:'commands',commands:['next']},offer:{id:`game:${revision}`,actions:[{id:'next',label:'다음 판',intent:'primary',kind:'command',enabled:true,action:'next'}]},disclosureContext:context,disclosures:[{id:'history',policyId:'history:v1',revision:catalogRevision,title:'지난 판',total:13,pageSize:12,scope}]};
}
const selected=(entryId:string):DisclosureDocument=>({entryId,title:'private-result',roster:[],cards:[],sections:[{id:'summary',kind:'content',title:'안내',information:[]}]});
function fixture(options:{current?:(context:DisclosureContext)=>boolean;retained?:(scope:DisclosureScope)=>boolean;visibility?:'public'|'audience';forms?:boolean}={}){
 const send=vi.fn(),page=vi.fn<DisclosureReadPolicy['page']>((offer,index)=>({catalogId:offer.id,revision:offer.revision,page:index,total:offer.total,pageSize:12,entries:Array.from({length:Math.min(12,offer.total-index*12)},(_,offset)=>({id:`row${index*12+offset}`,title:'같은 의미의 판'}))})),select=vi.fn<DisclosureReadPolicy['select']>((_offer,id)=>selected(id));
 const formSend=vi.fn();const session=createCardSession<string>({transport:send,...(options.forms?{formPolicies:[REPORT_POLICY],formTransport:formSend}:{}),disclosurePolicies:[{id:'history:v1',page,select}],disclosureCurrent:options.current,disclosureRetainedCurrent:options.retained});session.receive(document({visibility:options.visibility??'public'}));return{session,send,page,select,formSend};
}
function open(f:ReturnType<typeof fixture>){expect(f.session.disclosures.page('history',0)).toBe(true);expect(f.session.disclosures.select('history','row0')).toBe(true);}
test('canonical session owns frozen grants/context and disclosure reads never enter the command journal or notify loop',()=>{
 const f=fixture(),notify=vi.fn(),admit=vi.spyOn(f.session,'admit');f.session.subscribe(notify);open(f);expect(f.page.mock.calls[0][0]).toBeDefined();expect(Object.isFrozen(f.page.mock.calls[0][0].scope)).toBe(true);expect(Object.isFrozen(f.session.snapshot().document!.disclosureContext)).toBe(true);expect(f.session.disclosures.snapshot().selected?.entryId).toBe('row0');expect(JSON.stringify(f.session.snapshot())).not.toContain('private-result');expect(f.session.snapshot().operations).toEqual([]);expect(f.session.snapshot().formOperations).toEqual([]);expect(admit).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(notify).not.toHaveBeenCalled();f.session.disclosures.close();expect(f.session.disclosures.snapshot()).toEqual({});expect(notify).not.toHaveBeenCalled();expect(f.session.disclosures.page('history',0)).toBe(true);f.session.dispose();
});
test('readonly connected:false checkpoints may read independently of game command connectivity',()=>{
 const f=fixture();f.session.receive(document({revision:'2'}),{connected:false});expect(f.session.snapshot().connected).toBe(false);open(f);expect(f.session.disclosures.snapshot().selected).toBeDefined();expect(f.session.admit(f.session.snapshot().document!.context,'game:2','next','next')).toBe(false);expect(f.send).not.toHaveBeenCalled();
 const prior=f.session.disclosures.snapshot().selected;f.session.awaitState();expect(f.session.disclosures.page('history',0)).toBe(false);expect(f.session.disclosures.snapshot().selected).toBe(prior);f.session.receive(document({revision:'3'}),{connected:false});expect(f.session.disclosures.page('history',0)).toBe(true);f.session.dispose();
});
test('invalid disclosure ingress is atomic and rejects partial fields, policies, duplicates and foreign scope/audience',()=>{
 const f=fixture(),before=f.session.snapshot().document!,base=document({revision:'2'});const {disclosureContext:ignoredContext,...withoutContext}=base,{disclosures:ignoredOffers,...withoutOffers}=base;
 const invalid:TableDocument<string>[]=[withoutContext,withoutOffers,{...base,disclosures:[{...base.disclosures![0],policyId:'unregistered'}]},{...base,disclosures:[...base.disclosures!,...base.disclosures!]},{...base,disclosureContext:{...base.disclosureContext!,audience:'foreign'}},...(['roomId','roomEpoch','actorId','connectionEpoch'] as const).map(field=>({...base,disclosures:[{...base.disclosures![0],scope:{...base.disclosures![0].scope,[field]:'foreign'}}]}))];
 for(const value of invalid){expect(()=>f.session.receive(value)).toThrow();expect(f.session.snapshot().document).toBe(before);}
 const privateDoc=document({visibility:'audience'});expect(()=>f.session.receive({...privateDoc,disclosures:[{...privateDoc.disclosures![0],scope:{...privateDoc.disclosures![0].scope,audience:'foreign'}}]})).toThrow();expect(f.session.snapshot().document).toBe(before);f.session.dispose();
});
test('catalog/context accessors are refused before invoking them and owned data cannot alias caller mutations',()=>{
 const f=fixture(),before=f.session.snapshot().document!;let reads=0;for(const property of ['disclosures','disclosureContext']){const getter=Object.defineProperty({...document()},property,{get(){reads++;return property==='disclosures'?document().disclosures:identity;},enumerable:true});expect(()=>f.session.receive(getter)).toThrow();expect(f.session.snapshot().document).toBe(before);}expect(reads).toBe(0);
 const base=document(),context={...base.disclosureContext!},scope={...base.disclosures![0].scope},catalogs=[{...base.disclosures![0],scope}];f.session.receive({...base,disclosureContext:context,disclosures:catalogs});const owned=f.session.snapshot().document!;context.actorId='mutated';scope.actorId='mutated';catalogs.push({...catalogs[0],id:'new'});expect(owned.disclosureContext!.actorId).toBe('alice');expect(owned.disclosures![0].scope.actorId).toBe('alice');expect(owned.disclosures).toHaveLength(1);f.session.dispose();
});
test('public selection survives benign new hand/session and ResetScores catalog replacement, private audience does not',()=>{
 const f=fixture();open(f);const owned=f.session.disclosures.snapshot().selected;f.session.receive(document({revision:'2',catalogRevision:'r2',session:'new-session-after-reset',generation:'hand2',audience:'alice:watch'}),{connected:false});expect(f.session.disclosures.snapshot().selected).toBe(owned);expect(f.session.disclosures.snapshot().page).toBeUndefined();expect(f.session.disclosures.select('history','row0')).toBe(false);expect(f.select).toHaveBeenCalledTimes(1);expect(f.session.disclosures.page('history',0)).toBe(true);expect(f.page.mock.calls.at(-1)![0].revision).toBe('r2');f.session.dispose();
 const privateSession=fixture({visibility:'audience'});open(privateSession);privateSession.session.receive(document({visibility:'audience',revision:'2',audience:'alice:watch'}));expect(privateSession.session.disclosures.snapshot()).toEqual({});privateSession.session.dispose();
});
test('actual session ports fence native source loss and immediately scrub native actor retention loss',()=>{
 let sourceCurrent=true,nativeActor='alice';const f=fixture({current:()=>sourceCurrent,retained:scope=>scope.actorId===nativeActor});open(f);const owned=f.session.disclosures.snapshot().selected;sourceCurrent=false;expect(f.session.disclosures.page('history',0)).toBe(false);expect(f.session.disclosures.snapshot().selected).toBe(owned);nativeActor='bob';expect(f.session.disclosures.snapshot()).toEqual({});f.session.dispose();
});
test('every committed receive changes the private source epoch, even if catalog revision and count stay unchanged',()=>{
 const f=fixture(),original=f.page.getMockImplementation()!;f.page.mockImplementation((offer,index)=>{f.session.receive(document({revision:'2'}));return original(offer,index);});expect(f.session.disclosures.page('history',0)).toBe(false);expect(f.session.disclosures.snapshot().page).toBeUndefined();expect(f.session.snapshot().document!.context.revision).toBe('2');f.session.dispose();
});
test('policy callback receive/removal, revoke and disposal cannot commit selected data or create commands',()=>{
 for(const mutation of ['remove','revoke','dispose']){const f=fixture();f.session.disclosures.page('history',0);f.select.mockImplementation((_offer,id)=>{if(mutation==='remove'){const {disclosures:ignoredOffers,disclosureContext:ignoredContext,...plain}=document({revision:'2'});f.session.receive(plain);}else if(mutation==='revoke')f.session.revoke();else f.session.dispose();return selected(id);});expect(f.session.disclosures.select('history','row0')).toBe(false);expect(f.session.disclosures.snapshot()).toEqual({});expect(f.session.snapshot().operations).toEqual([]);expect(f.send).not.toHaveBeenCalled();f.session.dispose();}
});
test('retention guard reentrant canonical removal or foreign scope scrubs old payload within the same snapshot',()=>{
 for(const mutation of ['remove','foreign']){let armed=false,checks=0,f:ReturnType<typeof fixture>;f=fixture({retained:()=>{if(armed&&++checks===2){if(mutation==='remove'){const {disclosures:ignoredOffers,disclosureContext:ignoredContext,...plain}=document({revision:'2'});f.session.receive(plain);}else f.session.receive(document({revision:'2',actorId:'bob',audience:'bob:0'}));}return true;}});open(f);armed=true;expect(f.session.disclosures.snapshot()).toEqual({});expect(checks).toBe(2);f.session.dispose();}
});
test('retention guard may publish a benign public source while preserving its owned selected snapshot',()=>{
 let armed=false,checks=0,f:ReturnType<typeof fixture>;f=fixture({retained:()=>{if(armed&&++checks===2)f.session.receive(document({revision:'2',catalogRevision:'r2',session:'new-session',generation:'hand2'}));return true;}});open(f);const prior=f.session.disclosures.snapshot().selected;armed=true;const result=f.session.disclosures.snapshot();expect(result.selected).toBe(prior);expect(result.page).toBeUndefined();expect(checks).toBe(2);f.session.dispose();
});
test('missing grants, explicit revoke/dispose and notification overflow release retained disclosure payloads',()=>{
 const f=fixture();open(f);f.session.revoke();expect(f.session.disclosures.snapshot()).toEqual({});f.session.receive(document());open(f);f.session.disclosures.close();expect(f.session.disclosures.snapshot()).toEqual({});open(f);f.session.dispose();expect(f.session.disclosures.snapshot()).toEqual({});expect(f.session.disclosures.page('history',0)).toBe(false);
 const overflow=fixture();open(overflow);let revision=1;overflow.session.subscribe(snapshot=>{if(snapshot.document)overflow.session.receive(document({revision:String(++revision)}));});overflow.session.receive(document({revision:String(++revision)}));expect(overflow.session.snapshot().document).toBeNull();expect(overflow.session.disclosures.snapshot()).toEqual({});expect(overflow.send).not.toHaveBeenCalled();overflow.session.dispose();
});

test('explicit detail deselection keeps only its bounded page while whole-view close clears it',()=>{
 const f=fixture();open(f);const page=f.session.disclosures.snapshot().page;f.session.disclosures.deselect();expect(f.session.disclosures.snapshot().page).toBe(page);expect(f.session.disclosures.snapshot().selected).toBeUndefined();expect(f.session.disclosures.select('history','row1')).toBe(true);f.session.disclosures.close();expect(f.session.disclosures.snapshot()).toEqual({});f.session.dispose();
});

test('revokeGameView redacts private game/form/journal authority but explicitly retains one guarded public snapshot',async()=>{
 let armed=false;const f=fixture({forms:true,retained:()=>{if(armed)expect(f.session.snapshot().document).toBeNull();return true;}}),form=reportFormOffer({roomId:'room',actorId:'alice',seat:0,reportMax:100});
 f.session.receive({...document(),hand:[{id:'private-card',label:'private-face',visual:{kind:'standard',suit:'Heart',rank:14}}],forms:[form]});open(f);const selected=f.session.disclosures.snapshot().selected,canonical=f.session.snapshot().document!;
 const draft={values:{[REPORT_TEXT_FIELD]:'private-draft'},revision:1,compositionEpoch:0,composing:false},port=f.session.bindForm(form.instanceId,()=>draft);expect(f.session.admit(canonical.context,canonical.offer.id,'next','next')).toBe(true);armed=true;f.session.revokeGameView();await Promise.resolve();
 expect(f.session.snapshot()).toMatchObject({document:null,connected:false,operations:[],formOperations:[]});expect(JSON.stringify(f.session.snapshot())).not.toContain('private-face');expect(port.commit(canonical.context,form.id)).toBe(false);expect(f.send).not.toHaveBeenCalled();expect(f.formSend).not.toHaveBeenCalled();
 expect(f.session.disclosures.snapshot()).toEqual({catalogId:'history',selected});expect(f.session.disclosures.page('history',0)).toBe(false);expect(f.session.disclosures.select('history','row1')).toBe(false);expect(f.page).toHaveBeenCalledTimes(1);expect(f.select).toHaveBeenCalledTimes(1);f.session.dispose();
});
test('detached public snapshot reattaches only to a fresh compatible public offer after a reseat',()=>{
 const f=fixture({retained:()=>true});open(f);const selected=f.session.disclosures.snapshot().selected;f.session.revokeGameView();expect(f.session.disclosures.snapshot().selected).toBe(selected);
 f.session.receive(document({revision:'2',catalogRevision:'r2',session:'new-session',generation:'hand2',audience:'alice:1'}));expect(f.session.disclosures.snapshot().selected).toBe(selected);expect(f.session.disclosures.snapshot().page).toBeUndefined();expect(f.session.disclosures.page('history',0)).toBe(true);expect(f.page.mock.calls.at(-1)![0].revision).toBe('r2');expect(f.session.disclosures.select('history','row1')).toBe(true);f.session.dispose();
});
test('game-view redaction never retains audience-private, unselected or unguarded disclosure data',()=>{
 const privateSession=fixture({visibility:'audience',retained:()=>true});open(privateSession);privateSession.session.revokeGameView();expect(privateSession.session.disclosures.snapshot()).toEqual({});privateSession.session.dispose();
 const unguarded=fixture();open(unguarded);unguarded.session.revokeGameView();expect(unguarded.session.disclosures.snapshot()).toEqual({});unguarded.session.dispose();
 const unselected=fixture({retained:()=>true});unselected.session.disclosures.page('history',0);unselected.session.revokeGameView();expect(unselected.session.disclosures.snapshot()).toEqual({});unselected.session.dispose();
});
test('detached lease checks original native actor, epoch and connection before every exposed snapshot',()=>{
 for(const field of ['actorId','roomEpoch','connectionEpoch'] as const){const native={...identity};const f=fixture({retained:scope=>scope.actorId===native.actorId&&scope.roomEpoch===native.roomEpoch&&scope.connectionEpoch===native.connectionEpoch});open(f);const selected=f.session.disclosures.snapshot().selected;f.session.revokeGameView();expect(f.session.disclosures.snapshot().selected).toBe(selected);native[field]='changed';expect(f.session.disclosures.snapshot()).toEqual({});f.session.dispose();}
});
test('default revoke, viewer close and disposal still clear explicitly detached public leases',()=>{
 for(const mutation of ['revoke','close','dispose'] as const){const f=fixture({retained:()=>true});open(f);f.session.revokeGameView();expect(f.session.disclosures.snapshot().selected).toBeDefined();if(mutation==='close')f.session.disclosures.close();else f.session[mutation]();expect(f.session.disclosures.snapshot()).toEqual({});f.session.dispose();}
});
test('actual revoke or disposal reentered by detached native guard wins and notifies private redaction',()=>{
 for(const terminal of ['revoke','dispose'] as const){let armed=false,f:ReturnType<typeof fixture>;f=fixture({retained:()=>{if(armed)f.session[terminal]();return true;}});open(f);const views:unknown[]=[];f.session.subscribe(snapshot=>views.push(snapshot.document));armed=true;f.session.revokeGameView();expect(f.session.snapshot().document).toBeNull();expect(f.session.disclosures.snapshot()).toEqual({});expect(views.length).toBeGreaterThan(0);expect(views.every(value=>value===null)).toBe(true);f.session.dispose();}
});
test('receive reentered by detached guard keeps its newer canonical publication without resurrecting the old selection',()=>{
 let armed=false,f:ReturnType<typeof fixture>;f=fixture({retained:()=>{if(armed){armed=false;f.session.receive(document({revision:'new',actorId:'bob',audience:'bob:0'}));}return true;}});open(f);armed=true;f.session.revokeGameView();expect(f.session.snapshot().document?.context.revision).toBe('new');expect(f.session.snapshot().document?.participant.id).toBe('bob');expect(f.session.disclosures.snapshot().selected).toBeUndefined();f.session.dispose();
});
function publicShellDocument():TableDocument<string>{
 const {disclosures:ignoredCatalogs,disclosureContext:ignoredContext,...base}=document({revision:'shell',session:'room-shell:room',generation:'public',audience:'public:alice'});
 return{...base,participant:{role:'observer',id:'public-shell',name:'관전자',markers:[]},decision:{id:'public-room-shell',kind:'commands',commands:[]},offer:{id:'public-room-shell:room',actions:[]}};
}
test('explicit public lease survives neutral shell publication while waiting for reseated private State',()=>{
 const f=fixture({retained:()=>true});open(f);const selected=f.session.disclosures.snapshot().selected;expect(Object.isFrozen(selected)).toBe(true);f.session.revokeGameView();
 f.session.receive(publicShellDocument(),{connected:false});expect(f.session.snapshot().document!.disclosures).toBeUndefined();expect(f.session.snapshot().document!.disclosureContext).toBeUndefined();expect(f.session.disclosures.snapshot()).toEqual({catalogId:'history',selected});expect(f.session.disclosures.snapshot().page).toBeUndefined();expect(f.session.disclosures.page('history',0)).toBe(false);expect(f.session.disclosures.select('history','row1')).toBe(false);expect(f.page).toHaveBeenCalledTimes(1);expect(f.select).toHaveBeenCalledTimes(1);
 f.session.receive(document({revision:'reseated',catalogRevision:'r2',audience:'alice:1',generation:'hand2'}));expect(f.session.disclosures.snapshot().selected).toBe(selected);expect(f.session.disclosures.snapshot().page).toBeUndefined();expect(f.session.disclosures.page('history',0)).toBe(true);expect(f.page.mock.calls.at(-1)![0].revision).toBe('r2');f.session.dispose();
});
test('native grant loss scrubs an explicitly retained public record during neutral public-shell publication',()=>{
 let nativeActor='alice';const f=fixture({retained:scope=>scope.actorId===nativeActor});open(f);f.session.revokeGameView();f.session.receive(publicShellDocument(),{connected:false});expect(f.session.disclosures.snapshot().selected).toBeDefined();nativeActor='bob';expect(f.session.snapshot().document!.context.audience).toBe('public:alice');expect(f.session.disclosures.snapshot()).toEqual({});f.session.dispose();
});
test('ordinary neutral publication without explicit detach cannot retain a removed catalog grant',()=>{
 const f=fixture({retained:()=>true});open(f);expect(f.session.disclosures.snapshot().selected).toBeDefined();f.session.receive(publicShellDocument(),{connected:false});expect(f.session.disclosures.snapshot()).toEqual({});expect(f.session.disclosures.page('history',0)).toBe(false);f.session.dispose();
});
