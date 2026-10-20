import {expect,test} from 'vitest';
import savedRecord from './testSupport/liveCompletedReplay.json';
import secondRecord from './testSupport/liveSecondCompletedReplay.json';
import {ownDisclosureDocument} from './disclosures';
import {typography} from './planner';
import {createMightyHistoryDisclosure} from '../../games/mighty/historyDisclosure';
import {projectMightyHistory,type MightyHistoryInput} from '../../games/mighty/history';
import {createDisclosureDialog,type DisclosureFragment,type DisclosureLayoutKit} from './disclosureLayout';
import {numericComposition} from './composition';
import type {Environment,TextRole} from './contracts';
import type {DisclosureView} from './disclosureView';
const environment:Environment={width:1304,height:854,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,scrollbarWidth:0,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
// Isolated composition test: deterministic text metrics and native-size leaves, no fabricated game
// shell or scene authority. Browser font/pixel verification is a separate gate.
function kit():DisclosureLayoutKit{
 const group:DisclosureLayoutKit['group']=(id,width,height,placements,extra={})=>({width,height,nodes:[{id,parent:null,kind:'group',label:'',box:{x:0,y:0,width,height},...extra},...placements.flatMap(({fragment,x,y})=>fragment.nodes.map((node,index)=>index?node:{...node,parent:id,box:{...node.box,x,y}}))]});
 const text=(id:string,label:string,role:TextRole,width:number,intrinsic=false):DisclosureFragment=>{const natural=Array.from(label).reduce((sum,char)=>sum+(/[\x00-\x7f]/.test(char)?7:13),0),allocation=intrinsic?Math.min(width,natural):width,height=typography(role,environment).lineHeight*Math.max(1,Math.ceil(natural/width));return{width:allocation,height,nodes:[{id,parent:null,kind:'text',label,role,box:{x:0,y:0,width:allocation,height}}]};};
 const column:DisclosureLayoutKit['column']=(id,width,children,gap=12)=>{const plan=numericComposition.column(width,children,gap,0);return group(id,width,plan.height,children.map((fragment,index)=>({fragment,...plan.placements[index]})));};
 const rows:DisclosureLayoutKit['rows']=(id,width,children,extra)=>{const plan=numericComposition.rows(width,children,8,'start');return group(id,width,plan.height,children.map((fragment,index)=>({fragment,...plan.placements[index]})),extra);};
 return{group,text,column,rows,button:(id,label,width,disclosureIntent,extra)=>{const allocation=Math.min(width,Array.from(label).length*13+38);return group(`envelope:${id}`,allocation,56,[{fragment:group(id,allocation-6,44,[],{kind:'command',label,disclosureIntent,...extra}),x:3,y:6}]);},card:(id,card)=>({width:64,height:90,nodes:[{id,parent:null,kind:'card',label:card.label,visual:card.visual,box:{x:0,y:0,width:64,height:90}}]}),information:()=>{throw Error('Inactive information must not render');},value:(_doc,value,width,id)=>text(id,value.kind==='text'?value.text:'공개 기루다','small',width)};
}
function record():MightyHistoryInput{return savedRecord as unknown as MightyHistoryInput;}
test.each([['first',savedRecord],['second',secondRecord]])('admitted %s live ten-round replay fits at 1304×854 with original cards, text, tabs and controls',(_name,saved)=>{
 const source=saved as unknown as MightyHistoryInput,admitted=projectMightyHistory(source);expect(admitted.status).toBe('available');if(admitted.status!=='available')throw Error('Record refused');expect(admitted.rounds).toHaveLength(10);expect(admitted.rounds.every(round=>round.plays.length===5)).toBe(true);
 const selected=createMightyHistoryDisclosure({entryId:'live-completed',source}),view:DisclosureView={leaseId:'read',catalogId:'replay',title:selected.title,selected,sectionId:'matrix',roundIndex:0,matrixStart:0,page:{catalogId:'replay',revision:'1',page:0,total:1,pageSize:12,entries:[{id:selected.entryId,title:selected.title}]}};
 for(const matrixStart of [0,6]){const result=createDisclosureDialog({...view,matrixStart},environment,kit()),nodes=result.nodes,viewport=nodes.find(node=>node.scrollResetKey)!,content=nodes.find(node=>node.parent===viewport.id)!;
 expect(content.box.height).toBeLessThanOrEqual(viewport.box.height);expect(result.height).toBeLessThanOrEqual(822);expect(nodes.filter(node=>node.kind==='card')).toHaveLength(matrixStart?20:30);expect(nodes.filter(node=>node.kind==='card').every(node=>node.box.width===64&&node.box.height===90)).toBe(true);expect(nodes.filter(node=>node.semanticRole==='rowheader')).toHaveLength(5);expect(nodes.filter(node=>node.semanticRole==='tab')).toHaveLength(5);expect(nodes.filter(node=>node.disclosureIntent?.kind==='close')).toHaveLength(1);expect(nodes.filter(node=>node.disclosureIntent?.kind==='matrix-page')).toHaveLength(2);
 }
});

// Valid disclosure-domain stress variant, not a claim that these annotations
// occurred in the captured game. Frozen cards/roster remain the admitted record.
test('five annotated participant rows remain fully represented at native sizes',()=>{
 const base=createMightyHistoryDisclosure({entryId:'annotated-completed',source:record()}),selected=ownDisclosureDocument({...base,sections:base.sections.map(section=>section.kind!=='matrix'?section:{...section,rows:section.rows.map(row=>row.cells.slice(0,6).some(cell=>cell&&(cell.leader||cell.winner||cell.annotations?.length))?row:{...row,cells:row.cells.map((cell,index)=>index===0&&cell?{...cell,annotations:[{text:'효력 없음',tone:'muted' as const}]}:cell)})})});
 const view:DisclosureView={leaseId:'read',catalogId:'replay',title:selected.title,selected,sectionId:'matrix',roundIndex:0,matrixStart:0,page:{catalogId:'replay',revision:'1',page:0,total:1,pageSize:12,entries:[{id:selected.entryId,title:selected.title}]}};
 const result=createDisclosureDialog(view,environment,kit()),viewport=result.nodes.find(node=>node.scrollResetKey)!,content=result.nodes.find(node=>node.parent===viewport.id)!;
 expect(result.nodes.filter(node=>node.kind==='card')).toHaveLength(30);expect(result.nodes.filter(node=>node.kind==='card').every(node=>node.box.width===64&&node.box.height===90)).toBe(true);expect(content.box.height).toBeLessThanOrEqual(viewport.box.height);
 for(const group of [content,result.nodes.find(node=>node.semanticRole==='tabpanel')!,result.nodes.find(node=>node.semanticRole==='table')!]){const children=result.nodes.filter(node=>node.parent===group.id);for(let index=1;index<children.length;index++)expect(children[index].box.y-children[index-1].box.y-children[index-1].box.height).toBeGreaterThanOrEqual(4);}
});
test.each([['first',savedRecord],['second',secondRecord]])('%s completed hand point cards fit with one identity label and every original face',(_name,saved)=>{
 const source=saved as unknown as MightyHistoryInput;expect(projectMightyHistory(source).status).toBe('available');
 const selected=createMightyHistoryDisclosure({entryId:'second-points',source}),section=selected.sections.find(section=>section.id==='points')!;if(section.kind!=='content')throw Error('Points section missing');
 const view:DisclosureView={leaseId:'read',catalogId:'replay',title:selected.title,selected,sectionId:'points',roundIndex:0,matrixStart:0,page:{catalogId:'replay',revision:'1',page:0,total:1,pageSize:12,entries:[{id:selected.entryId,title:selected.title}]}};
 const result=createDisclosureDialog(view,{...environment,scrollbarWidth:15},kit()),nodes=result.nodes,viewport=nodes.find(node=>node.scrollResetKey)!,content=nodes.find(node=>node.parent===viewport.id)!;
 expect(content.box.height).toBeLessThanOrEqual(viewport.box.height);expect(nodes.filter(node=>node.kind==='card')).toHaveLength(section.cardGroups!.reduce((sum,group)=>sum+group.cardIds.length,0));expect(nodes.filter(node=>node.kind==='card').every(node=>node.box.width===64&&node.box.height===90)).toBe(true);
 for(const group of section.cardGroups!){expect(nodes.filter(node=>node.kind==='text'&&node.label===group.label)).toHaveLength(1);expect(nodes.some(node=>node.kind==='text'&&node.label===group.description&&node.role==='small')).toBe(true);}
 expect(nodes.filter(node=>node.semanticRole==='tab')).toHaveLength(5);expect(nodes.filter(node=>node.disclosureIntent?.kind==='close')).toHaveLength(1);
});
