import {describe,it,expect,vi} from 'vitest';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import {shellDocument,type ShellProofAction} from './shellFixture';
import type {Environment,SurfaceCallbacks,SurfacePort} from './contracts';
const environment:Environment={width:390,height:844,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
function fixture(initial=environment,longName=false){
 const send=vi.fn(),invoke=vi.fn(),session=createCardSession<ShellProofAction>({transport:send});session.receive(shellDocument({longName}));let callbacks:SurfaceCallbacks;
 const surface:SurfacePort={identity:{},environment:()=>initial,listen(value){callbacks=value;return()=>{};},measure(requests,reply){reply(requests.map(request=>{const natural=[...request.text].length*8,width=request.width??natural;return {key:request.key,size:{width:Math.min(width,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*24}};}));return()=>{};},publish:()=>{},invalidate:()=>{},disarm:()=>{},fallback:vi.fn(),clear:()=>{}};
 const table=createCardTable({session,effects:{invoke}});table.attach(surface);
 const activate=(purpose:string)=>{const node=table.inspect().frame!.nodes.find(node=>node.shellActionId===`room-shell:${purpose}`&&(!table.inspect().frame!.modalId||node.parent!==null))!;if(!node)throw new Error(purpose+' '+table.inspect().status);callbacks.intent({kind:'activate',frameId:table.inspect().frame!.id,nodeId:node.id});};
 return{send,invoke,session,table,surface,get callbacks(){return callbacks;},activate,dispose(){table.dispose();session.dispose();}};
}
describe('engine-owned room shell',()=>{
 it('owns measured header, canonical menu navigation, history and focus return without commands',()=>{
  const f=fixture();expect(f.table.inspect().status).toBe('ready');
  const opener=f.table.inspect().frame!.nodes.find(node=>node.shellActionId==='room-shell:menu')!.id;
  f.activate('menu');expect(f.table.inspect().shellPage).toBe('menu');expect(f.table.inspect().frame!.modalId).toBe('room-dialog');
  const people=f.table.inspect().frame!.nodes.find(node=>node.shellActionId==='room-shell:people'&&node.id.includes('page:menu'))!;
  f.callbacks.intent({kind:'activate',frameId:f.table.inspect().frame!.id,nodeId:people.id});expect(f.table.inspect().shellPage).toBe('people');
  expect(f.table.back()).toBe(true);expect(f.table.inspect().shellPage).toBe('menu');expect(f.table.inspect().focusId).toBe(people.id);
  expect(f.table.back()).toBe(true);expect(f.table.inspect().shellPage).toBeUndefined();expect(f.table.inspect().focusId).toBe(opener);
  expect(f.session.snapshot().operations).toHaveLength(0);expect(f.send).not.toHaveBeenCalled();f.dispose();
 });
 it('rejects synthetic underlay activation and stale dialog callbacks',()=>{
  const f=fixture(),before=f.table.inspect().frame!,pass=before.nodes.find(node=>node.actionId==='pass')!;
  f.activate('menu');const current=f.table.inspect().frame!;
  f.callbacks.intent({kind:'activate',frameId:current.id,nodeId:pass.id});expect(f.session.snapshot().operations).toHaveLength(0);
  f.callbacks.intent({kind:'dismiss',frameId:before.id});expect(f.table.inspect().shellPage).toBe('menu');
  f.callbacks.intent({kind:'dismiss',frameId:current.id});expect(f.table.inspect().shellPage).toBeUndefined();f.dispose();
 });
 it('requires confirmation and sends the exact leave through the ordinary journal',async()=>{
  const f=fixture();f.activate('menu');
  const leave=f.table.inspect().frame!.nodes.find(node=>node.shellActionId==='room-shell:leave')!;
  f.callbacks.intent({kind:'activate',frameId:f.table.inspect().frame!.id,nodeId:leave.id});expect(f.table.inspect().shellConfirmation).toBe(true);expect(f.send).not.toHaveBeenCalled();
  expect(f.table.back()).toBe(true);expect(f.table.inspect().shellConfirmation).toBe(false);expect(f.table.inspect().focusId).toBe(leave.id);
  f.callbacks.intent({kind:'activate',frameId:f.table.inspect().frame!.id,nodeId:leave.id});
  const confirm=f.table.inspect().frame!.nodes.find(node=>node.shellActionId==='room-shell:confirm-leave')!;
  f.callbacks.intent({kind:'activate',frameId:f.table.inspect().frame!.id,nodeId:confirm.id});await Promise.resolve();
  expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0].action).toBe('leave');expect(f.invoke).not.toHaveBeenCalled();f.dispose();
 });
 it('invokes narrow effects synchronously with exact canonical context',()=>{
  const f=fixture(),doc=f.session.snapshot().document!;f.activate('share');expect(f.invoke).toHaveBeenCalledExactlyOnceWith('share-room',doc.context);expect(f.send).not.toHaveBeenCalled();f.dispose();
 });
 it('preserves public pages across hand generations but resets on audience revocation',()=>{
  const f=fixture();f.activate('menu');const doc=shellDocument({revision:2});f.session.receive({...doc,context:{...doc.context,generation:'next'}});expect(f.table.inspect().shellPage).toBe('menu');
  f.session.revoke();expect(f.table.inspect().frame).toBeNull();expect(f.table.inspect().shellPage).toBeUndefined();f.dispose();
 });
});

it.each([[320,120,1],[320,568,1],[390,844,1],[568,320,1],[768,1024,1.5],[1440,900,1],[320,568,3]])('contains each room page at %sx%s scale%s',(width,height,textScale)=>{
 const f=fixture({...environment,width,height,textScale},true);expect(f.table.inspect().status).toBe('ready');
 for(const page of ['menu','people','rules','scores']){
  if(f.table.inspect().shellPage)while(f.table.inspect().shellPage)f.table.back();
  if(page==='menu')f.activate('menu');else{f.activate('menu');const node=f.table.inspect().frame!.nodes.find(node=>node.shellActionId===`room-shell:${page}`&&node.id.includes('page:menu'))!;f.callbacks.intent({kind:'activate',frameId:f.table.inspect().frame!.id,nodeId:node.id});}
  expect(f.table.inspect().status).toBe('ready');const layout=f.table.inspect().frame!;expect(layout.modalId).toBe('room-dialog');const dialog=layout.nodes.find(node=>node.id===layout.modalId)!;expect(dialog.box.y).toBeGreaterThanOrEqual(0);expect(dialog.box.y+dialog.box.height).toBeLessThanOrEqual(height);expect(Object.isFrozen(layout.nodes.find(node=>node.shellIntent)?.shellIntent)).toBe(true);
 }
 f.dispose();
});

it('handles browser Back while public notice/font measurements are pending',()=>{
 const f=fixture();f.surface.measure=()=>()=>{};f.callbacks.environment({...environment,revision:'next',fontRevision:'next'});expect(f.table.inspect().status).toBe('measuring');expect(f.table.back()).toBe(true);expect(f.table.inspect().shellPage).toBe('menu');expect(f.table.back()).toBe(true);expect(f.table.inspect().shellPage).toBeUndefined();f.dispose();
});

it('bounds cyclic page navigation and returns through the original focus path',()=>{
 const f=fixture(),doc=shellDocument({revision:2});
 const link=(page:'people'|'rules')=>({id:`cycle:${page}`,purpose:'people' as const,label:page,enabled:true,intent:{kind:'open-page' as const,page}});
 f.session.receive({...doc,shell:{...doc.shell!,pages:doc.shell!.pages.map(page=>({...page,actions:[...page.actions,...(page.id==='people'?[link('rules')]:page.id==='rules'?[link('people')]:[])]}))}});
 f.activate('menu');
 const go=(id:string)=>{const frame=f.table.inspect().frame!,node=frame.nodes.find(node=>node.shellActionId===id&&node.id.includes(`page:${f.table.inspect().shellPage}`))!;f.callbacks.intent({kind:'activate',frameId:frame.id,nodeId:node.id});};
 go('room-shell:people');
 for(let i=0;i<100;i++){go('cycle:rules');go('cycle:people');expect(f.table.inspect().shellHistoryDepth).toBeLessThanOrEqual(4);}
 expect(f.table.back()).toBe(true);expect(f.table.inspect().shellPage).toBe('menu');
 expect(f.table.back()).toBe(true);expect(f.table.inspect().shellPage).toBeUndefined();expect(f.send).not.toHaveBeenCalled();f.dispose();
});

it('drops removed pages from Back history while retaining the active page',()=>{
 const f=fixture();f.activate('menu');
 const frame=f.table.inspect().frame!,node=frame.nodes.find(node=>node.shellActionId==='room-shell:people'&&node.id.includes('page:menu'))!;
 f.callbacks.intent({kind:'activate',frameId:frame.id,nodeId:node.id});
 const doc=shellDocument({revision:2});
 f.session.receive({...doc,shell:{...doc.shell!,header:{...doc.shell!.header,actions:doc.shell!.header.actions.filter(action=>action.intent.kind!=='open-page'||action.intent.page!=='menu')},pages:doc.shell!.pages.filter(page=>page.id!=='menu').map(page=>({...page,actions:page.actions.filter(action=>action.intent.kind!=='open-page'||action.intent.page!=='menu')}))}});
 expect(f.table.inspect().shellPage).toBe('people');expect(f.table.back()).toBe(true);expect(f.table.inspect().shellPage).toBeUndefined();expect(f.table.inspect().status).toBe('ready');f.dispose();
});
