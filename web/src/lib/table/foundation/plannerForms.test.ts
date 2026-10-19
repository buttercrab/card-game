import {describe,expect,it} from 'vitest';
import type {CandidateLayout,ChoiceView,Environment,MeasureRequest,PresentationFrame,Size} from './contracts';
import type {FormView} from './forms';
import {shellDocument} from './shellFixture';
import {pendingFormAllocation,planTable,typography,validateLayout,formSummaryItems} from './planner';
const environment:Environment={width:390,height:844,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,scrollbarWidth:15,scrollbarHeight:15,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
const form:FormView={offer:{id:'report',instanceId:'instance',schemaVersion:'1',policyId:'report',baseVersion:'1',editBinding:'actor',title:'문제 신고',help:'긴 내용을 작성해도 입력을 유지하면서 테이블 창을 바꿀 수 있어요.',submitLabel:'보내기',binding:{room:'proof'},enabled:true,fields:[
 {id:'name',label:'제목',help:'무슨 일이 있었나요?',kind:'text',maxCodePoints:100,maxCodeUnits:200,required:true,initial:''},
 {id:'body',label:'자세한 내용',help:'카드와 순서를 적어 주세요.',kind:'multiline',maxCodePoints:2000,maxCodeUnits:4000,required:true,initial:''},
 {id:'amount',label:'숫자',kind:'number',maxCodePoints:20,maxCodeUnits:20,required:false,initial:'',min:0,max:100,step:1},
]},leaseId:'lease',values:{name:'secret-native-title',body:'secret-native-body\n둘째 줄',amount:'-'},issues:{body:'아주 긴 검증 설명입니다. 무엇을 더 적어야 하는지 안내합니다.'},status:'editing',draftRevision:1,compositionEpoch:0,canSubmit:false};
const choices:ChoiceView={values:{},fields:[],commands:[],selected:null,shellPage:'menu',form};
function metric(request:MeasureRequest):Size{
 const natural=[...request.text].length*9*request.environment.textScale,width=request.width??natural;
 return {width:Math.min(width,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*typography(request.role,request.environment).lineHeight};
}
function solve(env=environment,view=choices):CandidateLayout{
 const metrics=new Map<string,Size>();
 for(let attempt=0;attempt<6;attempt++){
  const result=planTable(shellDocument(),env,view,metrics);
  if(result.kind==='ready')return result.layout;
  if(result.kind!=='needs')throw Error(JSON.stringify(result));
  for(const request of result.requests)metrics.set(request.key,metric(request));
 }
 throw Error('Form did not converge');
}
const node=(layout:CandidateLayout,id:string)=>layout.nodes.find(node=>node.id===id)!;
describe('engine-owned native editor composition',()=>{
 it.each([[320,568,1],[390,844,1],[568,320,1],[320,568,2],[390,844,2],[1440,900,1]])('measures all labels, issues and native editor envelopes at %sx%s ×%s',(width,height,textScale)=>{
  const layout=solve({...environment,width,height,textScale});expect(validateLayout(layout)).toEqual([]);
  const dialogs=layout.nodes.filter(node=>node.semanticRole==='dialog');expect(dialogs).toHaveLength(1);expect(dialogs[0].formLeaseId).toBe('lease');expect(dialogs[0].label).toBe('문제 신고');
  expect(dialogs[0].box.width).toBeLessThanOrEqual(width-32);expect(dialogs[0].box.height).toBeLessThanOrEqual(height-32);
  const editors=layout.nodes.filter(node=>node.editor);expect(editors).toHaveLength(3);
  expect(editors.map(node=>node.editor?.kind)).toEqual(['text','multiline','number']);
  expect(editors[2].editor?.value).toBe('-');
  for(const editor of editors){expect(editor.box.width).toBeGreaterThanOrEqual(44);expect(editor.box.height).toBeGreaterThanOrEqual(44);expect(editor.enabled).toBe(true);expect(editor.actionId).toBeUndefined();expect(editor.preference).toBeUndefined();}
  expect(editors[1].box.height).toBeGreaterThanOrEqual(4*typography('select',{...environment,textScale}).lineHeight+20);
  expect(layout.nodes.some(node=>node.label===form.issues.body&&node.tone==='danger')).toBe(true);
  expect(layout.nodes.filter(node=>node.formIntent).map(node=>[node.formIntent,node.enabled])).toEqual([['submit',false],['reset',true],['close',true]]);
 });
  it('keeps form-wide policy issues visible outside field pagination',()=>{const layout=solve(environment,{...choices,form:{...form,issues:{$form:'다른 입력을 먼저 마쳐 주세요.'}}});expect(layout.nodes.some(node=>node.label==='다른 입력을 먼저 마쳐 주세요.'&&node.tone==='danger')).toBe(true);});
  it('groups changed fields in a declared row into one link to its editable value',()=>{
    const fields=[{id:'on',label:'사용',kind:'toggle' as const,required:false,initial:false},{id:'value',label:'값',kind:'number' as const,required:true,initial:'0',maxCodePoints:4,maxCodeUnits:4,min:-128,max:127,step:1}];
    const view:FormView={...form,offer:{...form.offer,fields,sections:[{id:'details',title:'세부 설정'}],clusters:[{id:'group',sectionId:'details',label:'항목',fieldIds:['on','value']}],rows:[{id:'row',clusterId:'group',label:'반복 항목',fieldIds:['on','value']}]},values:{on:true,value:'3'},issues:{},activeSection:'details',reduction:{values:{on:true,value:'3'},visibility:{on:true,value:true},enabled:{on:true,value:true},issues:{},changedFields:['on','value']}};
    expect(formSummaryItems(view)).toEqual([{id:'changed-row:row',text:'변경 · 반복 항목',fieldId:'value',sectionId:'details'}]);
    expect(solve(environment,{...choices,form:view}).nodes.filter(node=>node.formNavigation?.fieldId)).toHaveLength(1);
    expect(formSummaryItems({...view,reduction:{...view.reduction!,enabled:{on:true,value:false}}})[0].fieldId).toBe('on');
    const withIssues={...view,issues:{on:'사용 상태 확인',value:'값 확인'},reduction:{...view.reduction!,summary:[{text:'구조 변경',fieldIds:['on','value']},{text:'구조 변경',fieldIds:['on','value']}]}};
    expect(formSummaryItems(withIssues).filter(item=>item.id.startsWith('issue:'))).toHaveLength(2);
    expect(formSummaryItems(withIssues).filter(item=>item.text==='구조 변경')).toHaveLength(1);
  });
 it('never feeds native draft text into text measurement or facts',()=>{
  const result=planTable(shellDocument(),environment,choices,new Map());if(result.kind!=='needs')throw Error('Expected reads');
  expect(result.requests.some(request=>request.text.includes('secret-native'))).toBe(false);
  const layout=solve();expect(layout.nodes.some(node=>node.kind==='text'&&node.label.includes('secret-native'))).toBe(false);
 });
 it.each(['queued','sending','processed','uncertain','conflict'] as const)('makes %s explicit and disables editors and sending/reset controls',status=>{
  const layout=solve(environment,{...choices,form:{...form,status,canSubmit:true}});
  expect(layout.nodes.filter(node=>node.editor).every(node=>!node.enabled)).toBe(true);
  expect(layout.nodes.find(node=>node.formIntent==='submit')?.enabled).toBe(false);
  expect(layout.nodes.find(node=>node.formIntent==='reset')?.enabled).toBe(status==='conflict');
  expect(layout.nodes.find(node=>node.formIntent==='close')?.enabled).toBe(true);
 });
 it.each(['rejected','cancelled'] as const)('permits explicit fresh editing after %s',status=>{
  const layout=solve(environment,{...choices,form:{...form,status,canSubmit:true}});
  expect(layout.nodes.filter(node=>node.editor).every(node=>node.enabled)).toBe(true);
  expect(layout.nodes.find(node=>node.formIntent==='submit')?.enabled).toBe(true);
 });
 it('keeps native editing enabled during composition and prevents action activation',()=>{
  const layout=solve(environment,{...choices,form:{...form,composingFieldId:'body',canSubmit:true}});
  expect(layout.nodes.filter(node=>node.editor).every(node=>node.enabled)).toBe(true);
  expect(layout.nodes.filter(node=>node.formIntent).every(node=>!node.enabled)).toBe(true);
 });
 it('preserves editor identity across draft changes and guards mixed authority',()=>{
  const original=solve(),updated=solve(environment,{...choices,form:{...form,values:{...form.values,body:'더 적었어요'},issues:{},draftRevision:2,canSubmit:true}});
  expect(updated.nodes.filter(node=>node.editor).map(node=>node.id)).toEqual(original.nodes.filter(node=>node.editor).map(node=>node.id));
  const editor=original.nodes.find(node=>node.editor)!;
  expect(validateLayout({...original,nodes:original.nodes.map(node=>node===editor?{...node,actionId:'game-action'}:node)})).toContain(`Invalid native editor binding: ${editor.id}`);
  expect(validateLayout({...original,nodes:original.nodes.map(node=>node===editor?{...node,editor:{...node.editor!,leaseId:'other-lease'}}:node)})).toContain(`Native form escapes its lease: ${editor.id}`);
 });
 it.each([[320,568],[200,200],[1,1],[1440,900]])('planner bounds a retained exact-width edit viewport at %sx%s without mutating its contents',(width,height)=>{
  const layout=solve(),frame:PresentationFrame={...layout,id:1,environment,context:shellDocument().context,offerId:'offer'};
  const before=JSON.stringify(frame),pending=pendingFormAllocation(frame,{...environment,width,height,revision:'2'})!;
  expect(pending.leaseId).toBe('lease');expect(pending.placements).toHaveLength(2);expect(JSON.stringify(frame)).toBe(before);
  const dialog=pending.placements[0].box,viewport=pending.placements[1].box;
  expect(dialog.x).toBeGreaterThanOrEqual(0);expect(dialog.y).toBeGreaterThanOrEqual(0);expect(dialog.x+dialog.width).toBeLessThanOrEqual(width);expect(dialog.y+dialog.height).toBeLessThanOrEqual(height);
  expect(viewport.x+viewport.width).toBeLessThanOrEqual(dialog.width);expect(viewport.y+viewport.height).toBeLessThanOrEqual(dialog.height);expect(pending.placements[1].scrollBoth).toBe(true);
  const originalContent=node(layout,JSON.stringify(['form-content','lease']));expect(pending.placements.some(placement=>placement.id===originalContent.id)).toBe(false);
 });
});
