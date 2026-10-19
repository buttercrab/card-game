import {expect,test,vi} from 'vitest';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import {validateLayout} from './planner';
import type {Environment,PresentationFrame,SurfaceCallbacks,TableDocument} from './contracts';
function document(active=true):TableDocument<{play:string}>{
 const actions=[{id:'j-s',label:'Joker spade'},{id:'j-h',label:'Joker heart'},{id:'ace',label:'Ace'}].map(item=>({...item,kind:'command' as const,intent:'primary' as const,enabled:true,action:{play:item.id}}));
 return {context:{session:'s',audience:'alice',generation:'hand',revision:active?'1':'2'},participant:{id:'alice',name:'Alice',markers:[]},opponents:Array.from({length:4},(_,i)=>({id:`p${i}`,name:`Peer ${i}`,handCount:10})),hand:[{id:'joker',label:'Joker',visual:{kind:'joker',color:'Black'}},{id:'ace',label:'Ace',visual:{kind:'standard',suit:'Spade',rank:14}}],facts:[],presentation:{id:'play',schemaVersion:1,selection:{kind:'card-selection',mode:'one',submit:{prefix:'Play'},statusLabels:['카드 선택 · 0장','카드 선택 · 1장'],submitLabels:actions.map(item=>`Play ${item.label}`),actionVariantLabelGroups:[['Joker spade','Joker heart']]}},decision:active?{kind:'card-selection',id:'play',mode:'one',disambiguation:'choose-action',commands:[],variants:actions.map(item=>({cardIds:[item.id==='ace'?'ace':'joker'],actionId:item.id})),submit:{prefix:'Play'}}:{kind:'commands',id:'waiting',commands:[]},offer:{id:active?'active':'passive',actions:active?actions:[]}};
}
function fixture(doc=document(),width=390,height=844,textScale=1){
 const send=vi.fn(),session=createCardSession<{play:string}>({transport:send});session.receive(doc);let callbacks!:SurfaceCallbacks;
 let environment:Environment={width,height,textScale,fontFamily:'sans-serif',fontRevision:'1',revision:'1',scrollbarWidth:0,scrollbarHeight:0,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
 const preserveModal=vi.fn(),requests:number[]=[],table=createCardTable({session});table.attach({identity:{},environment:()=>environment,listen(next){callbacks=next;return()=>{};},measure(batch,reply){requests.push(batch.length);reply(batch.map(request=>{const natural=request.text.length*8*request.environment.textScale,width=request.width??natural;return{key:request.key,size:{width:Math.min(width,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*20*request.environment.textScale}};}));return()=>{};},publish(){},preserveModal,disarm(){},invalidate(){},fallback(reason){throw Error(reason);},clear(){}});
 return {table,session,send,requests,preserveModal,dismiss(){callbacks.intent({kind:'dismiss',frameId:table.inspect().frame!.id});},activate(id:string,frameId=table.inspect().frame!.id){callbacks.intent({kind:'activate',frameId,nodeId:id});},resize(width:number,height:number,textScale:number){environment={...environment,width,height,textScale,revision:'2'};callbacks.environment(environment);},dispose(){table.dispose();session.dispose();}};
}
function box(frame:PresentationFrame,id:string){let node=frame.nodes.find(node=>node.id===id)!;expect(node,id).toBeDefined();const rect={...node.box};while(node.parent){node=frame.nodes.find(parent=>parent.id===node.parent)!;rect.x+=node.box.x;rect.y+=node.box.y;}return rect;}
test.each([[390,844,1],[390,844,2],[844,390,1],[1280,720,1]])('fresh passive and active frames share cohort geometry at%sx%s text%s',(width,height,scale)=>{
 const active=fixture(document(),width,height,scale),passive=fixture(document(false),width,height,scale);
 const ids=['arena','dock','hand','identity-figure','own-hand-count-anchor','decisions',JSON.stringify(['hand','card','ace'])];
 for(const id of ids)expect(box(passive.table.inspect().frame!,id),id).toEqual(box(active.table.inspect().frame!,id));
 expect(passive.table.inspect().frame!.nodes.some(node=>node.cardId||node.cardActionOptionId||node.actionId||node.fieldId)).toBe(false);
 const initial=active.table.inspect().frame!;active.session.receive(document(false));for(const id of ids)expect(box(active.table.inspect().frame!,id),id).toEqual(box(initial,id));
 if(scale===1){active.session.receive(document());active.activate(JSON.stringify(['hand','card','joker']));const selected=active.table.inspect().frame!;for(const id of ids)expect(box(selected,id),`selected ${id}`).toEqual(box(initial,id));expect(selected.nodes.some(node=>node.id==='card-action-open')).toBe(true);expect(selected.nodes.some(node=>node.id==='card-action-options')).toBe(false);}
 expect(active.requests.every(count=>count<=512)).toBe(true);expect(passive.requests.every(count=>count<=512)).toBe(true);active.dispose();passive.dispose();
});
test('card action picker isolates drafts and confirms exactly one native command',async()=>{
 const f=fixture();f.activate(JSON.stringify(['hand','card','joker']));expect(f.table.inspect().frame!.nodes.some(node=>node.cardActionOptionId)).toBe(false);
 const before=f.table.inspect().frame!;f.activate('card-action-open');let frame=f.table.inspect().frame!;
 expect(frame.modalId).toBe('card-action-dialog');expect(frame.nodes.find(node=>node.id==='table-underlay')?.inert).toBe(true);
 const options=frame.nodes.filter(node=>node.cardActionOptionId);expect(options).toHaveLength(2);expect(options.every(node=>node.kind==='choice'&&!node.actionId&&!node.fieldId)).toBe(true);expect(f.send).not.toHaveBeenCalled();
 expect(frame.nodes.find(node=>node.id==='card-action-confirm')).toMatchObject({enabled:false});
 const chosen=options.find(node=>node.cardActionOptionId==='j-h')!;f.activate(chosen.id);expect(f.send).not.toHaveBeenCalled();frame=f.table.inspect().frame!;expect(frame.nodes.find(node=>node.id==='card-action-confirm')).toMatchObject({enabled:true,label:'Play Joker heart'});
 for(const poison of [{actionId:'j-s'},{formActionId:'foreign'},{recipientCount:10}])expect(validateLayout({...frame,nodes:frame.nodes.map(node=>node.id===chosen.id?{...node,...poison}:node)}).some(error=>error.includes('Mixed card-action'))).toBe(true);
 f.activate('card-selection-submit',before.id);expect(f.send).not.toHaveBeenCalled();
 const command=f.session.snapshot().document!.offer.actions.find(action=>action.id==='j-h')!;
 f.activate('card-action-confirm');await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0].action).toBe(command.kind==='command'?command.action:null);expect(f.table.inspect().frame!.modalId).toBeUndefined();f.dispose();
});
test('cancel and Escape restore the main draft, return focus and retire old picker frames',()=>{
 const f=fixture();f.activate(JSON.stringify(['hand','card','joker']));const main=f.table.inspect().frame!;expect(main.nodes.find(node=>node.id==='card-selection-submit')?.enabled).toBe(false);
 for(const escape of [false,true]){
  f.activate('card-action-open');let frame=f.table.inspect().frame!;const lease=frame.nodes.find(node=>node.id===frame.modalId)!.choiceLeaseId;
  f.activate(frame.nodes.find(node=>node.cardActionOptionId==='j-h')!.id);const stale=f.table.inspect().frame!;
  if(escape)f.dismiss();else f.activate('card-action-cancel');
  frame=f.table.inspect().frame!;expect(frame.modalId).toBeUndefined();expect(frame.focusId).toBe('card-action-open');expect(frame.nodes.find(node=>node.id==='card-selection-submit')?.enabled).toBe(false);expect(frame.nodes.find(node=>node.cardId==='joker')?.checked).toBe(true);
  f.activate('card-action-confirm',stale.id);expect(f.send).not.toHaveBeenCalled();
  f.activate('card-action-open');expect(f.table.inspect().frame!.nodes.find(node=>node.id==='card-action-dialog')?.choiceLeaseId).not.toBe(lease);f.dismiss();
 }
 f.dispose();
});
test('picker leases survive resize and display revisions but retire on authority, disconnect and detach',()=>{
 const f=fixture();f.activate(JSON.stringify(['hand','card','joker']));f.activate('card-action-open');f.activate(f.table.inspect().frame!.nodes.find(node=>node.cardActionOptionId==='j-h')!.id);
 let frame=f.table.inspect().frame!,lease=frame.nodes.find(node=>node.id==='card-action-dialog')!.choiceLeaseId;
 f.resize(844,390,1);frame=f.table.inspect().frame!;expect(frame.nodes.find(node=>node.id==='card-action-dialog')?.choiceLeaseId).toBe(lease);expect(frame.nodes.find(node=>node.id==='card-action-confirm')).toMatchObject({enabled:true});expect(f.preserveModal).toHaveBeenCalledWith(lease);
 const changed=document();f.session.receive({...changed,context:{...changed.context,revision:'3'},participant:{...changed.participant,name:'Renamed Alice'}});
 frame=f.table.inspect().frame!;expect(frame.nodes.find(node=>node.id==='card-action-dialog')?.choiceLeaseId).toBe(lease);expect(frame.nodes.find(node=>node.id==='card-action-confirm')?.label).toBe('Play Joker heart');
 const stale=frame;f.session.receive(document(false));expect(f.table.inspect().frame!.modalId).toBeUndefined();f.activate('card-action-confirm',stale.id);expect(f.send).not.toHaveBeenCalled();
 f.session.receive(document());f.activate(JSON.stringify(['hand','card','joker']));f.activate('card-action-open');f.session.setConnected(false);expect(f.table.inspect().frame?.modalId).toBeUndefined();expect(f.send).not.toHaveBeenCalled();
 f.dispose();
 const detached=fixture();detached.activate(JSON.stringify(['hand','card','joker']));detached.activate('card-action-open');detached.table.detach();expect(detached.table.inspect().frame).toBeNull();expect(detached.send).not.toHaveBeenCalled();detached.dispose();
});
test('compatible picker repaint retains inert preview but confirms only a fresh canonical capture',async()=>{
 const f=fixture();try{
  f.activate(JSON.stringify(['hand','card','joker']));f.activate('card-action-open');f.activate(f.table.inspect().frame!.nodes.find(node=>node.cardActionOptionId==='j-h')!.id);
  const stale=f.table.inspect().frame!,old=f.session.snapshot().document!,lease=stale.nodes.find(node=>node.id==='card-action-dialog')!.choiceLeaseId;
  const next=document(),rename=(label:string)=>label.replace('Joker heart','Renamed heart');f.session.receive({...next,presentation:{...next.presentation!,selection:{...next.presentation!.selection!,submitLabels:next.presentation!.selection!.submitLabels.map(rename),actionVariantLabelGroups:next.presentation!.selection!.actionVariantLabelGroups!.map(group=>group.map(rename))}},context:{...old.context,revision:'new-display'},offer:{...next.offer,actions:next.offer.actions.map(action=>({...action,label:action.id==='j-h'?'Renamed heart':action.label}))}});
  const current=f.session.snapshot().document!,frame=f.table.inspect().frame!;
  expect(frame.nodes.find(node=>node.id==='card-action-dialog')?.choiceLeaseId).toBe(lease);
  expect(frame.nodes.find(node=>node.id==='card-action-confirm')?.label).toBe('Play Renamed heart');
  expect(f.send).not.toHaveBeenCalled();expect(f.session.snapshot().operations).toHaveLength(0);
  f.activate('card-action-confirm',stale.id);expect(f.send).not.toHaveBeenCalled();
  f.dismiss();expect(f.table.inspect().frame!.nodes.find(node=>node.id==='card-selection-submit')?.enabled).toBe(false);
  f.activate('card-action-open');f.activate(f.table.inspect().frame!.nodes.find(node=>node.cardActionOptionId==='j-h')!.id);f.activate('card-action-confirm');await Promise.resolve();
  const action=current.offer.actions.find(action=>action.id==='j-h')!,oldAction=old.offer.actions.find(action=>action.id==='j-h')!;
  expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0].action).toBe(action.kind==='command'?action.action:null);expect(f.send.mock.calls[0][0].action).not.toBe(oldAction.kind==='command'?oldAction.action:null);
 }finally{f.dispose();}
});
test('card changes retire picker options while repeat activation waits for a second click',()=>{
 const source=document();const f=fixture({...source,interaction:{cardActivation:'repeat'}});f.activate(JSON.stringify(['hand','card','joker']));f.activate(JSON.stringify(['hand','card','joker']));const old=f.table.inspect().frame!;
 // Underlay input stays fenced while the modal is open.
 f.activate(JSON.stringify(['hand','card','ace']));expect(f.table.inspect().frame!.modalId).toBe('card-action-dialog');
 f.dismiss();f.activate(JSON.stringify(['hand','card','ace']));expect(f.send).not.toHaveBeenCalled();expect(f.table.inspect().frame!.nodes.some(node=>node.cardActionPickerIntent?.kind==='open')).toBe(false);
 f.activate(old.nodes.find(node=>node.cardActionOptionId==='j-h')!.id,old.id);expect(f.send).not.toHaveBeenCalled();f.dispose();
});

test('maximum admitted caption domains stay within the real runtime metric budget',()=>{
 const doc=document(),base=doc.presentation!.selection!,labels=['Joker spade','Joker heart',...Array.from({length:102},(_,i)=>`Option ${i}`)];
 const groups=Array.from({length:8},(_,i)=>labels.slice(i*13,(i+1)*13));
 const presentation={...doc.presentation!,selection:{...base,statusLabels:[...base.statusLabels,...Array.from({length:102},(_,i)=>`Status ${i}`)],submitLabels:[...base.submitLabels,...Array.from({length:101},(_,i)=>`Play ${i}`)],actionVariantLabelGroups:groups}};
 const f=fixture({...doc,presentation},320,568,2);expect(f.table.inspect().status).toBe('ready');expect(f.requests.every(count=>count<=512)).toBe(true);expect(f.requests.reduce((total,count)=>total+count,0)).toBeLessThanOrEqual(2048);expect(f.table.inspect().cacheSize).toBeLessThanOrEqual(2048);f.dispose();
});

test('single-click preference still submits a uniquely bound ordinary card but never an ambiguous one',async()=>{
 const unique=fixture({...document(),interaction:{cardActivation:'single'}});expect(unique.table.inspect().frame!.nodes.find(node=>node.cardId==='ace')).toMatchObject({checked:false,accessibleDescription:'누르면 이 카드를 내요'});unique.activate(JSON.stringify(['hand','card','ace']));await Promise.resolve();expect(unique.send).toHaveBeenCalledTimes(1);expect(unique.send.mock.calls[0][0].action).toEqual({play:'ace'});unique.dispose();
 const ambiguous=fixture({...document(),interaction:{cardActivation:'single'}});ambiguous.activate(JSON.stringify(['hand','card','joker']));ambiguous.activate(JSON.stringify(['hand','card','joker']));expect(ambiguous.send).not.toHaveBeenCalled();ambiguous.dispose();
});

test.each(['single','repeat'] as const)('native%s ambiguity opens the existing picker without choosing even a sole enabled variant',async activation=>{
 const source=document();const doc={...source,interaction:{cardActivation:activation},offer:{...source.offer,actions:source.offer.actions.map(action=>action.id==='j-s'?{...action,enabled:false}:action)}};
 const f=fixture(doc),card=JSON.stringify(['hand','card','joker']);expect(f.table.inspect().frame!.nodes.find(node=>node.cardId==='joker')).toMatchObject({hasPopup:'dialog',popupExpanded:false,checked:false});f.activate(card);
 if(activation==='repeat'){expect(f.table.inspect().frame!.modalId).toBeUndefined();expect(f.table.inspect().frame!.nodes.find(node=>node.cardId==='joker')?.checked).toBe(true);f.activate(card);}
 let frame=f.table.inspect().frame!;expect(frame.modalId).toBe('card-action-dialog');expect(frame.nodes.find(node=>node.cardId==='joker')).toMatchObject({hasPopup:'dialog',popupExpanded:true,checked:true});expect(frame.nodes.find(node=>node.id==='card-action-confirm')?.enabled).toBe(false);expect(frame.nodes.find(node=>node.cardActionOptionId==='j-s')?.enabled).toBe(false);expect(f.send).not.toHaveBeenCalled();
 const stale=frame,chosen=frame.nodes.find(node=>node.cardActionOptionId==='j-h')!;f.activate(chosen.id);expect(f.send).not.toHaveBeenCalled();f.dismiss();frame=f.table.inspect().frame!;
 expect(frame.focusId).toBe(card);expect(frame.nodes.find(node=>node.cardId==='joker')).toMatchObject({checked:true,popupExpanded:false});f.activate('card-action-confirm',stale.id);expect(f.send).not.toHaveBeenCalled();
 f.activate(card);frame=f.table.inspect().frame!;expect(frame.modalId).toBe('card-action-dialog');expect(frame.nodes.find(node=>node.id==='card-action-confirm')?.enabled).toBe(false);
 f.activate(frame.nodes.find(node=>node.cardActionOptionId==='j-h')!.id);f.activate('card-action-confirm');await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);const command=f.session.snapshot().document!.offer.actions.find(action=>action.id==='j-h')!;expect(f.send.mock.calls[0][0].action).toBe(command.kind==='command'?command.action:null);f.dispose();
});
test('native picker cancellation returns to its card and policy replacement retires its draft and lease',()=>{
 const source=document(),native={...source,interaction:{cardActivation:'single' as const}},f=fixture(native),card=JSON.stringify(['hand','card','joker']);
 f.activate(card);const old=f.table.inspect().frame!;f.activate(old.nodes.find(node=>node.cardActionOptionId==='j-h')!.id);f.activate('card-action-cancel');expect(f.table.inspect().frame!.focusId).toBe(card);
 f.activate(card);expect(f.table.inspect().frame!.nodes.find(node=>node.id==='card-action-confirm')?.enabled).toBe(false);
 f.session.receive({...native,context:{...native.context,revision:'policy'},interaction:{cardActivation:'repeat'}});expect(f.table.inspect().frame!.modalId).toBeUndefined();expect(f.table.inspect().frame!.nodes.find(node=>node.cardId==='joker')?.checked).toBe(false);f.activate('card-action-confirm',old.id);expect(f.send).not.toHaveBeenCalled();f.dispose();
});
