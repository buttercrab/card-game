import {afterEach,expect,test,vi} from 'vitest';
import {createEssentialSurface} from './essentialSurface';
import type {PlannedNode,PresentationFrame} from './contracts';
class ElementFake{
 dataset:Record<string,string>={};style={opacity:''};inert=false;tabIndex=0;parent:ElementFake|null=null;attributes=new Map<string,string>();ownerDocument:{activeElement:ElementFake|null}={activeElement:null};
 getAttribute(name:string){return this.attributes.get(name)??null;}setAttribute(name:string,value:string){this.attributes.set(name,value);}removeAttribute(name:string){this.attributes.delete(name);}contains(element:ElementFake|null):boolean{for(let node=element;node;node=node.parent)if(node===this)return true;return false;}
}
class ButtonFake extends ElementFake{disabled=false;}
class SelectFake extends ElementFake{disabled=false;}
const node=(id:string,parent:string|null,extra:Partial<PlannedNode>={}):PlannedNode=>({id,parent,kind:'group',label:id,box:{x:0,y:0,width:100,height:100},...extra});
const frame=(id=1):PresentationFrame=>({id,context:{session:'table',audience:'alice',generation:'hand:1',revision:String(id)},decisionLaneId:'decisions',nodes:[node('table',null),node('table-underlay','table'),node('decisions','table-underlay',{scroll:true}),node('label','decisions',{kind:'text'}),node('command','decisions',{kind:'command',actionId:'pass',enabled:true}),node('disabled','decisions',{kind:'command',actionId:'disabled',enabled:false}),node('select','decisions',{kind:'select',fieldId:'suit',enabled:true}),node('hand','table-underlay'),node('card','hand',{kind:'card',cardId:'ace',entityId:'ace',zoneId:'hand',enabled:true}),node('header','table-underlay',{kind:'command',shellActionId:'settings',enabled:true})]} as unknown as PresentationFrame);
function fixture(){
 vi.stubGlobal('getComputedStyle',(element:ElementFake)=>({opacity:element.style.opacity||'1'}));vi.stubGlobal('HTMLElement',ElementFake);vi.stubGlobal('HTMLButtonElement',ButtonFake);vi.stubGlobal('HTMLSelectElement',SelectFake);
 let current:PresentationFrame|null=frame(),ready=true;const document={activeElement:null as ElementFake|null},elements=new Map<string,HTMLElement>();
 const patch=(next:PresentationFrame)=>{for(const node of next.nodes){let element=elements.get(node.id) as unknown as ElementFake|undefined;if(!element){element=node.kind==='select'?new SelectFake():node.kind==='command'||node.kind==='choice'||node.kind==='card'?new ButtonFake():new ElementFake();elements.set(node.id,element as unknown as HTMLElement);}element.ownerDocument=document;element.dataset.foundationNode=node.id;element.dataset.foundationFrame=String(next.id);element.parent=node.parent?elements.get(node.parent) as unknown as ElementFake:null;if(element instanceof ButtonFake||element instanceof SelectFake)element.disabled=!node.enabled;}};patch(current);
 const admit=vi.fn<(frameId:number,owner:string,active:boolean)=>boolean>(()=>true),cancelGestures=vi.fn(),blur=vi.fn((element:HTMLElement)=>{if(document.activeElement===element as unknown as ElementFake)document.activeElement=null;}),helper=createEssentialSurface({elements,current:()=>current,ready:()=>ready,admit,cancelGestures,blur});
 return{helper,elements,admit,cancelGestures,blur,document,patch,get current(){return current;},set current(value){current=value;},set ready(value:boolean){ready=value;},element(id:string){return elements.get(id)! as unknown as ButtonFake;}};
}
afterEach(()=>vi.unstubAllGlobals());
test('commits actual hidden/inert lane and every typed game input, then restores only canonical enabled targets',()=>{
 const f=fixture(),frame=f.current!;f.document.activeElement=f.element('card');expect(f.helper.begin(frame,'owner')).toBe(true);expect(f.cancelGestures).toHaveBeenCalledTimes(1);expect(f.helper.hidden(frame).size).toBe(0);expect(f.helper.blocked('card')).toBe(true);expect(f.helper.commit(frame,'owner')).toBe(true);
 expect([...f.helper.hidden(frame)]).toEqual(['decisions','label','command','disabled','select']);expect(f.element('decisions')).toMatchObject({inert:true,style:{opacity:'0'},tabIndex:-1});for(const id of ['command','disabled','select','card'])expect(f.element(id).disabled).toBe(true);expect(f.element('header').disabled).toBe(false);expect(f.blur).toHaveBeenCalledTimes(1);
 f.helper.release(frame.id,'wrong');expect(f.helper.blocked('card')).toBe(true);f.helper.release(frame.id,'owner');expect(f.element('decisions')).toMatchObject({inert:false,style:{opacity:''},tabIndex:0});expect(f.element('decisions').getAttribute('aria-hidden')).toBeNull();expect(f.element('command').disabled).toBe(false);expect(f.element('disabled').disabled).toBe(true);expect(f.element('card').disabled).toBe(false);expect(f.admit).toHaveBeenLastCalledWith(1,'owner',false);
});
test('actual element visibility, disabled state and exact frame stamps remain mandatory after runtime admission',()=>{
 for(const corrupt of ['opacity','inert','aria','enabled','stamp','identity'] as const){const f=fixture(),frame=f.current!;expect(f.helper.begin(frame,'owner')).toBe(true);expect(f.helper.commit(frame,'owner')).toBe(true);
  if(corrupt==='opacity')f.element('decisions').style.opacity='1';if(corrupt==='inert')f.element('decisions').inert=false;if(corrupt==='aria')f.element('decisions').removeAttribute('aria-hidden');if(corrupt==='enabled')f.element('card').disabled=false;if(corrupt==='stamp')f.element('card').dataset.foundationFrame='99';if(corrupt==='identity')f.elements.set('card',new ButtonFake() as unknown as HTMLElement);
  expect(f.helper.hidden(frame).size).toBe(0);f.helper.clear();}
});
test('same owner renews across patch with exact native identities even while current still references the prior frame',()=>{
 const f=fixture(),first=f.current!;expect(f.helper.begin(first,'owner')).toBe(true);expect(f.helper.commit(first,'owner')).toBe(true);expect(f.helper.begin(first,'different')).toBe(false);
 const next=frame(2);expect(f.helper.begin(next,'owner')).toBe(true);f.patch(next);expect(f.helper.commit(next,'owner')).toBe(true);expect(f.current!.id).toBe(1);expect(f.helper.hidden(next).size).toBe(5);expect(f.helper.hidden(first).size).toBe(0);f.current=next;f.helper.release(1,'owner');expect(f.helper.blocked('card')).toBe(true);f.helper.release(2,'owner');expect(f.element('card').disabled).toBe(false);
});
test('a missing or replaced native input fails closed instead of granting hidden paths',()=>{
 for(const missing of [true,false]){const f=fixture(),first=f.current!;f.helper.begin(first,'owner');if(missing)f.elements.delete('card');else f.element('card').dataset.foundationFrame='stale';expect(f.helper.commit(first,'owner')).toBe(false);expect(f.helper.hidden(first).size).toBe(0);expect(f.helper.blocked('card')).toBe(false);expect(f.admit).toHaveBeenLastCalledWith(1,'owner',false);}
});
test('release never re-enables a disarmed pending publication',()=>{
 const f=fixture(),first=f.current!;f.helper.begin(first,'owner');f.helper.commit(first,'owner');f.ready=false;f.helper.release(1,'owner');expect(f.element('card').disabled).toBe(true);expect(f.element('command').disabled).toBe(true);expect(f.element('decisions').style.opacity).toBe('0');expect(f.helper.hidden(first).size).toBe(0);
});
test('admission refusal, throws and capture cancellation failure release provisional ownership',()=>{
 for(const stage of ['refuse','admit-throw','cancel-throw'] as const){const f=fixture();if(stage==='refuse')f.admit.mockReturnValueOnce(false);if(stage==='admit-throw')f.admit.mockImplementationOnce(()=>{throw Error('optional');});if(stage==='cancel-throw')f.cancelGestures.mockImplementationOnce(()=>{throw Error('optional');});expect(f.helper.begin(f.current!,'owner')).toBe(false);expect(f.helper.blocked('card')).toBe(false);expect(f.admit).toHaveBeenLastCalledWith(1,'owner',false);}
});
test('reentrant admission cleanup cannot resurrect an old lease or release the newer owner',()=>{
 const f=fixture();f.admit.mockImplementationOnce(()=>{f.helper.clear();expect(f.helper.begin(f.current!,'new-owner')).toBe(true);return true;});expect(f.helper.begin(f.current!,'old-owner')).toBe(false);expect(f.helper.commit(f.current!,'old-owner')).toBe(false);expect(f.helper.commit(f.current!,'new-owner')).toBe(true);expect(f.helper.hidden(f.current!).size).toBe(5);expect(f.admit.mock.calls.some(call=>call[1]==='new-owner'&&call[2]===false)).toBe(false);f.helper.clear();
});
test('release retires before callbacks so reentrant new masks remain hidden and disabled',()=>{
 const f=fixture(),first=f.current!;f.helper.begin(first,'old-owner');f.helper.commit(first,'old-owner');f.admit.mockImplementationOnce(()=>{expect(f.helper.begin(first,'new-owner')).toBe(true);expect(f.helper.commit(first,'new-owner')).toBe(true);return true;});f.helper.release(1,'old-owner');expect(f.helper.hidden(first).size).toBe(5);expect(f.element('card').disabled).toBe(true);f.helper.clear();
});

test('a style override cannot certify hidden paint and returned empty sets cannot poison later proof',()=>{
 const f=fixture(),first=f.current!;const empty=f.helper.hidden(first) as Set<string>;empty.add('forged');expect(f.helper.hidden(first).size).toBe(0);f.helper.begin(first,'owner');f.helper.commit(first,'owner');vi.stubGlobal('getComputedStyle',()=>({opacity:'1'}));expect(f.helper.hidden(first).size).toBe(0);f.helper.clear();
});

test('same-owner renewal adopts fresh game controls before proving the current hidden lane',()=>{
 const f=fixture(),initial={...frame(),nodes:frame().nodes.filter(node=>!['command','disabled','select'].includes(node.id)).concat(node('misdeal','decisions',{kind:'command',actionId:'misdeal',enabled:true}))};f.current=initial;f.patch(initial);expect(f.helper.begin(initial,'owner')).toBe(true);expect(f.helper.commit(initial,'owner')).toBe(true);const old=f.element('misdeal');
 const next={...frame(2),nodes:frame(2).nodes.filter(node=>!['command','disabled','select'].includes(node.id)).concat(node('new-fields','decisions'),node('count-select','new-fields',{kind:'select',fieldId:'count',enabled:true}),node('spade-choice','new-fields',{kind:'choice',fieldId:'suit',optionId:'spade',enabled:true}),node('bid','decisions',{kind:'command',actionId:'bid',enabled:true}))};
 expect(f.helper.begin(next,'owner')).toBe(true);expect(f.admit).toHaveBeenLastCalledWith(2,'owner',true);expect(f.cancelGestures).toHaveBeenCalledTimes(2);expect(f.helper.hidden(next).size).toBe(0);f.patch(next);f.elements.delete('misdeal');expect(f.element('bid').disabled).toBe(false);expect(f.helper.commit(next,'owner')).toBe(true);expect(f.helper.hidden(next).has('new-fields')).toBe(true);for(const id of ['bid','count-select','spade-choice','card'])expect(f.element(id).disabled).toBe(true);expect(f.helper.blocked('misdeal')).toBe(false);expect(f.helper.blocked('bid')).toBe(true);
 f.current=next;f.helper.release(2,'owner');expect(old.disabled).toBe(true);for(const id of ['bid','count-select','spade-choice','card'])expect(f.element(id).disabled).toBe(false);
});
test('a replacement native element with the same ID gets fresh ownership without re-enabling the retired reference',()=>{
 const f=fixture(),initial=f.current!;f.helper.begin(initial,'owner');f.helper.commit(initial,'owner');const old=f.element('card'),next=frame(2);expect(f.helper.begin(next,'owner')).toBe(true);f.elements.delete('card');f.patch(next);const replacement=f.element('card');expect(replacement).not.toBe(old);expect(f.helper.commit(next,'owner')).toBe(true);expect(f.helper.hidden(next).size).toBe(5);f.current=next;f.helper.release(2,'owner');expect(old.disabled).toBe(true);expect(replacement.disabled).toBe(false);
});
test('renewal cannot cross actor, generation, session or decreasing frame identity',()=>{
 const f=fixture(),initial=frame(5);f.current=initial;f.patch(initial);f.helper.begin(initial,'owner');f.helper.commit(initial,'owner');
 for(const key of ['session','audience','generation'] as const){const next={...frame(6),context:{...initial.context,[key]:'foreign'}};expect(f.helper.begin(next,'owner')).toBe(false);expect(f.helper.hidden(initial).size).toBe(5);}
 expect(f.helper.begin(frame(4),'owner')).toBe(false);expect(f.admit).toHaveBeenCalledTimes(1);expect(f.helper.hidden(initial).size).toBe(5);f.helper.clear();
});
test('reentrant renewal keeps the newest independently admitted control recipe',()=>{
 const f=fixture(),initial=f.current!;f.helper.begin(initial,'owner');f.helper.commit(initial,'owner');const second=frame(2),third={...frame(3),nodes:frame(3).nodes.map(node=>node.id==='command'?{...node,id:'new-command'}:node)};
 f.admit.mockImplementationOnce(()=>{expect(f.helper.begin(third,'owner')).toBe(true);f.patch(third);expect(f.helper.commit(third,'owner')).toBe(true);return true;});expect(f.helper.begin(second,'owner')).toBe(false);expect(f.helper.blocked('new-command')).toBe(true);expect(f.helper.hidden(third).size).toBe(5);expect(f.helper.commit(second,'owner')).toBe(false);f.current=third;f.helper.clear();
});

const resultFrame=(id=1):PresentationFrame=>{const base=frame(id);return {...base,settled:true,decisionLaneId:undefined,outcomeLaneId:'outcome',nodes:[...base.nodes.filter(node=>!['decisions','label','command','disabled','select'].includes(node.id)),node('outcome','table-underlay'),node('result-label','outcome',{kind:'text',role:'compact-display',label:'+3점'}),node('trump','outcome',{kind:'suit',suit:'Heart'}),node('next','outcome',{kind:'command',actionId:'next',enabled:true}),node('information','outcome',{kind:'command',localIntent:'toggle-information',enabled:true})]};};
test('settled result lane hides glyphs and disables its continuation, exact information opener and held game target',()=>{
 const f=fixture(),settled=resultFrame();f.current=settled;f.patch(settled);f.document.activeElement=f.element('information');expect(f.helper.begin(settled,'result-owner')).toBe(true);expect(f.cancelGestures).toHaveBeenCalledTimes(1);expect(f.helper.blocked('card')).toBe(true);expect(f.helper.blocked('information')).toBe(true);expect(f.helper.commit(settled,'result-owner')).toBe(true);expect([...f.helper.hidden(settled)]).toEqual(['outcome','result-label','trump','next','information']);expect(f.element('outcome')).toMatchObject({inert:true,style:{opacity:'0'}});expect(f.element('outcome').getAttribute('aria-hidden')).toBe('true');for(const id of ['card','next','information'])expect(f.element(id).disabled).toBe(true);expect(f.element('header').disabled).toBe(false);expect(f.blur).toHaveBeenCalledTimes(1);f.helper.release(settled.id,'foreign');expect(f.element('information').disabled).toBe(true);f.helper.release(settled.id,'result-owner');expect(f.element('information').disabled).toBe(false);expect(f.element('next').disabled).toBe(false);expect(f.element('outcome').style.opacity).toBe('');
});
test('failed future result publication never restores stale current controls or releases a newer owner',()=>{
 const f=fixture(),initial=resultFrame();f.current=initial;f.patch(initial);f.helper.begin(initial,'owner');f.helper.commit(initial,'owner');const next=resultFrame(2);expect(f.helper.begin(next,'owner')).toBe(true);f.patch(next);for(const id of ['card','next','information'])f.element(id).disabled=true;f.elements.delete('trump');expect(f.helper.commit(next,'owner')).toBe(false);expect(f.element('next').disabled).toBe(true);expect(f.element('information').disabled).toBe(true);expect(f.element('outcome').style.opacity).toBe('0');expect(f.helper.hidden(next).size).toBe(0);expect(f.element('card').dataset.foundationFrame).toBe('2');
 // Publication remains disarmed until the host installs and marks the new frame
 // ready. The old record cannot rewrite the newer stamped native state.
 f.current=next;f.patch(next);expect(f.helper.begin(next,'new-owner')).toBe(true);expect(f.helper.commit(next,'new-owner')).toBe(true);f.helper.release(next.id,'owner');expect(f.element('information').disabled).toBe(true);expect(f.helper.hidden(next).size).toBe(5);f.helper.clear();
});
test('unexpected native controls beneath a readonly result node fail closed',()=>{
 const f=fixture(),settled=resultFrame();f.current=settled;f.patch(settled);const previous=f.element('trump'),unexpected=new ButtonFake();unexpected.dataset={...previous.dataset};unexpected.ownerDocument=previous.ownerDocument;unexpected.parent=previous.parent;f.elements.set('trump',unexpected as unknown as HTMLElement);expect(f.helper.begin(settled,'owner')).toBe(true);expect(f.helper.commit(settled,'owner')).toBe(false);expect(f.helper.hidden(settled).size).toBe(0);expect(f.admit).toHaveBeenLastCalledWith(settled.id,'owner',false);
});
test('return suspension hides only decisions, preserves retained hand paint and retires safely on hard view loss',()=>{
 const f=fixture(),current={...f.current!,stockReturn:{destination:'stock',source:{kind:'hand' as const}}};f.current=current;
 f.element('card').style.opacity='1';
 expect(f.helper.begin(current,'stock-return')).toBe(true);expect(f.helper.commit(current,'stock-return')).toBe(true);
 expect(f.helper.hidden(current).has('decisions')).toBe(true);expect(f.helper.hidden(current).has('hand')).toBe(false);
 expect(f.element('card').style.opacity).toBe('1');expect(f.element('hand').inert).toBe(false);expect(f.element('card').disabled).toBe(true);expect(f.element('header').disabled).toBe(false);
 f.current=null;f.ready=false;f.helper.clear();expect(f.helper.hidden(current).size).toBe(0);expect(f.element('card').disabled).toBe(true);expect(f.admit).toHaveBeenLastCalledWith(current.id,'stock-return',false);
});

const nativeFrame=(id=1):PresentationFrame=>({...frame(id),essentialInputKind:'native-cards',decisionLaneId:undefined,nodes:frame(id).nodes.filter(n=>!['decisions','label','command','disabled','select'].includes(n.id)).concat(node('blocked-card','hand',{kind:'card',cardId:'two',entityId:'two',zoneId:'hand',enabled:false}))});
test('input-only acknowledgment requires actual native disables and never conceals the hand',()=>{
 const f=fixture(),current=nativeFrame();f.current=current;f.patch(current);f.document.activeElement=f.element('card');
 const hand=f.element('hand'),card=f.element('card');
 expect(f.helper.acknowledged(current)).toBe(false);expect(f.helper.hidden(current).size).toBe(0);
 expect(f.helper.begin(current,'native-owner')).toBe(true);expect(f.helper.acknowledged(current)).toBe(false);
 expect(f.helper.commit(current,'native-owner')).toBe(true);expect(f.helper.acknowledged(current)).toBe(true);
 expect(f.helper.hidden(current).size).toBe(0);expect(hand).toMatchObject({inert:false,style:{opacity:''},tabIndex:0});expect(hand.getAttribute('aria-hidden')).toBeNull();
 expect(card).toMatchObject({disabled:true,inert:false,style:{opacity:''}});expect(card.getAttribute('aria-hidden')).toBeNull();expect(f.element('blocked-card').disabled).toBe(true);expect(f.element('header').disabled).toBe(false);expect(f.blur).toHaveBeenCalledTimes(1);
 f.helper.release(current.id,'foreign');expect(f.helper.acknowledged(current)).toBe(true);
 f.helper.release(current.id,'native-owner');expect(f.helper.acknowledged(current)).toBe(false);expect(card.disabled).toBe(false);expect(f.element('blocked-card').disabled).toBe(true);
});
test('native acknowledgment fails on missing, replaced, wrongly stamped or re-enabled controls',()=>{
 for(const corrupt of ['missing','identity','stamp','enabled'] as const){
  const f=fixture(),current=nativeFrame();f.current=current;f.patch(current);f.helper.begin(current,'owner');f.helper.commit(current,'owner');
  if(corrupt==='missing')f.elements.delete('card');if(corrupt==='identity')f.elements.set('card',new ButtonFake() as unknown as HTMLElement);if(corrupt==='stamp')f.element('card').dataset.foundationFrame='stale';if(corrupt==='enabled')f.element('card').disabled=false;
  expect(f.helper.acknowledged(current)).toBe(false);expect(f.helper.hidden(current).size).toBe(0);f.helper.clear();
 }
});
test('input-only renewal invalidates prior acknowledgment and never restores an old native reference',()=>{
 const f=fixture(),first=nativeFrame();f.current=first;f.patch(first);f.helper.begin(first,'owner');f.helper.commit(first,'owner');const old=f.element('card'),next=nativeFrame(2);
 expect(f.helper.begin(next,'owner')).toBe(true);expect(f.helper.acknowledged(first)).toBe(false);expect(f.helper.acknowledged(next)).toBe(false);
 f.elements.delete('card');f.patch(next);expect(f.helper.commit(next,'owner')).toBe(true);expect(f.helper.acknowledged(next)).toBe(true);f.current=next;f.helper.release(first.id,'owner');expect(f.element('card').disabled).toBe(true);f.helper.release(next.id,'owner');expect(old.disabled).toBe(true);expect(f.element('card').disabled).toBe(false);
});
test('native mask release preserves disarmed and modal replacement fences',()=>{
 const f=fixture(),current=nativeFrame();f.current=current;f.patch(current);f.helper.begin(current,'owner');f.helper.commit(current,'owner');f.ready=false;f.helper.release(current.id,'owner');expect(f.element('card').disabled).toBe(true);expect(f.helper.acknowledged(current)).toBe(false);
 f.ready=true;f.patch(current);f.helper.begin(current,'next');f.helper.commit(current,'next');f.current={...nativeFrame(2),modalId:'picker'};f.helper.clear();expect(f.element('card').disabled).toBe(true);
});

test('native acknowledgment binds the current offer and release retires before reentrant adoption',()=>{
 const f=fixture(),first={...nativeFrame(),offerId:'first'};f.current=first;f.patch(first);f.helper.begin(first,'owner');f.helper.commit(first,'owner');
 expect(f.helper.acknowledged({...first,offerId:'replacement'})).toBe(false);
 f.admit.mockImplementationOnce(()=>{expect(f.helper.begin(first,'new-owner')).toBe(true);expect(f.helper.commit(first,'new-owner')).toBe(true);return true;});
 f.helper.release(first.id,'owner');expect(f.helper.acknowledged(first)).toBe(true);expect(f.element('card').disabled).toBe(true);f.helper.clear();
});
