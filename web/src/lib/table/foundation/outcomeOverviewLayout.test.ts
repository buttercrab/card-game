import {expect,test} from 'vitest';
import {typography} from './planner';
import {outcomeOverviewMinimumWidth,createOutcomeOverviewLayout,type OutcomeOverviewLayoutKit} from './outcomeOverviewLayout';
import type {DisclosureFragment} from './disclosureLayout';
import type {DisclosureDocument} from './disclosureTypes';
import type {Environment,PlannedNode,TextRole} from './contracts';
const environment=(scale:number):Environment=>({width:390,height:844,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:scale,scrollbarHeight:12,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:44,pulse:1}}});
const document=(rows=5,columns=10):DisclosureDocument=>{
 const count=Math.min(104,rows*columns),cards=Array.from({length:count},(_,index)=>({id:`card:${index}`,label:`공개 카드 ${index}`,visual:{kind:'standard' as const,suit:'Spade' as const,rank:index%13+2}}));
 return{entryId:'finished-hand',title:'이번 판 전체 라운드',roster:Array.from({length:rows},(_,index)=>({id:`frozen:${index}`,name:`기록 이름 ${index}`,badges:[{text:index===0?'주공':'수비',tone:'plain' as const}]})),cards,sections:[{id:'matrix',title:'전체 라운드',kind:'matrix',columns:Array.from({length:columns},(_,index)=>({id:`column:${index}`,label:String(index+1)})),rows:Array.from({length:rows},(_,row)=>({personId:`frozen:${row}`,cells:Array.from({length:columns},(_,column)=>({cardId:cards[(row*columns+column)%count].id,...(row===0&&column===0?{leader:true,winner:true,annotations:[{text:'효력 없음',tone:'muted' as const}]}:{} )}))}))}]};
};
function kit(scale:number,glyphWidth=7){
 const textCalls:{value:string;role:TextRole;width:number}[]=[],cardCalls:{width:number;height:number;id:string}[]=[];
 const leaf=(id:string,width:number,height:number,extra:Partial<PlannedNode>):DisclosureFragment=>({width,height,nodes:[{id,parent:null,kind:'group',label:'',box:{x:0,y:0,width,height},...extra}]});
 const group:OutcomeOverviewLayoutKit['group']=(id,width,height,placements,extra={})=>({width,height,nodes:[...leaf(id,width,height,extra).nodes,...placements.flatMap(({fragment,x,y})=>fragment.nodes.map((node,index)=>index===0?{...node,parent:id,box:{...node.box,x,y}}:node))]});
 const column:OutcomeOverviewLayoutKit['column']=(id,width,children,gap=0)=>{let y=0;return group(id,width,children.reduce((sum,child)=>sum+child.height,0)+Math.max(0,children.length-1)*gap,children.map(fragment=>{const placement={fragment,x:0,y};y+=fragment.height+gap;return placement;}));};
 const layout:OutcomeOverviewLayoutKit={group,column,rows:(id,width,children,extra)=>group(id,width,Math.max(0,...children.map(child=>child.height)),children.map((fragment,index)=>({fragment,x:index*40,y:0})),extra),measureText:value=>({width:Array.from(value).length*glyphWidth*scale,height:20*scale}),text:(id,value,role,width)=>{textCalls.push({value,role,width});const line=(role==='small'?20:24)*scale,natural=Array.from(value).length*glyphWidth*scale;return leaf(id,width,Math.max(1,Math.ceil(natural/Math.max(1,width)))*line,{kind:'text',label:value,role});},card:(id,card,width,height)=>{cardCalls.push({id:card.id,width,height});return leaf(id,width,height,{kind:'card',label:card.label,visual:card.visual,...(card.emphasis?{emphasis:card.emphasis}:{})});}};
 return{layout,textCalls,cardCalls};
}
const own=(result:DisclosureFragment,id:string)=>result.nodes.find(node=>node.id===id)!;
const parent=(result:DisclosureFragment,node:PlannedNode)=>own(result,node.parent!);

for(const scale of [1,2])for(const width of [170,320])test(`dense readonly5×10 overview retains association at width${width} and textscale${scale}`,()=>{
 const input=document(),before=JSON.stringify(input),paint=kit(scale),result=createOutcomeOverviewLayout(input,width,environment(scale),paint.layout);
 expect(result.width).toBe(width);expect(JSON.stringify(input)).toBe(before);expect(paint.cardCalls).toHaveLength(50);expect(paint.cardCalls.every(card=>card.width===(width<240?16:24)&&card.height>=22&&card.height<=34)).toBe(true);
 const table=result.nodes.find(node=>node.semanticRole==='table')!,viewport=parent(result,table),head=result.nodes.find(node=>node.semanticRole==='row'&&node.label==='라운드')!,headers=result.nodes.filter(node=>node.semanticRole==='columnheader');
 expect(headers.map(node=>node.label)).toEqual(Array.from({length:10},(_,index)=>String(index+1)));expect(result.nodes.filter(node=>node.semanticRole==='cell')).toHaveLength(50);expect(result.nodes.filter(node=>node.semanticRole==='rowheader')).toHaveLength(5);
 const first=result.nodes.find(node=>node.semanticRole==='cell')!;expect(first.label).toContain('기록 이름 0 · 주공 · 1 · 공개 카드 0 · 선공 · 승리 · 효력 없음');
 for(const row of result.nodes.filter(node=>node.semanticRole==='rowgroup')){
  const rows=result.nodes.filter(node=>node.parent===row.id&&node.semanticRole==='row');expect(rows).toHaveLength(2);
  const name=result.nodes.find(node=>node.parent===rows[0].id&&node.semanticRole==='rowheader')!;expect(name.columnSpan).toBe(10);expect(name.box.width).toBe(table.box.width);
  const cells=result.nodes.filter(node=>node.parent===rows[1].id&&node.semanticRole==='cell');expect(cells).toHaveLength(headers.length);expect(cells.map(node=>node.box.x)).toEqual(headers.map(node=>node.box.x));expect(cells.every(node=>node.box.x+node.box.width<=table.box.width+.01)).toBe(true);expect(rows[1].box.y).toBe(rows[0].box.height);
 }
 const scroll=table.box.width>width+.1;expect(viewport.scroll??false).toBe(scroll);expect(viewport.box.height).toBe(table.box.height+(scroll?12:0));if(scroll)expect(viewport.label).toContain('가로 스크롤');
 expect(paint.textCalls.every(call=>call.role==='small'||call.role==='body')).toBe(true);expect(result.nodes.filter(node=>node.kind==='text').every(node=>node.box.height>=20*scale)).toBe(true);
 const forbidden=['entityId','ownerId','zoneId','actionId','cardId','inspectCardId','fieldId','shellActionId','formIntent','disclosureIntent','assistanceIntent'];expect(result.nodes.every(node=>node.enabled===undefined&&forbidden.every(key=>(node as unknown as Record<string,unknown>)[key]===undefined))).toBe(true);
});
test('explicit blank cells preserve their exact column and row association',()=>{
 const input=document(2,3),matrix=input.sections[0];if(matrix.kind!=='matrix')throw Error();const changed={...input,cards:input.cards.filter(card=>card.id!=='card:1'),sections:[{...matrix,rows:matrix.rows.map((row,index)=>index===0?{...row,cells:row.cells.map((cell,column)=>column===1?null:cell)}:row)}]},paint=kit(2),result=createOutcomeOverviewLayout(changed,170,environment(2),paint.layout);
 expect(paint.cardCalls).toHaveLength(5);const blank=result.nodes.find(node=>node.semanticRole==='cell'&&node.label.includes('카드 없음'))!;expect(blank.label).toBe('기록 이름 0 · 주공 · 2 · 카드 없음');expect(result.nodes.some(node=>node.parent===blank.id&&node.label==='—')).toBe(true);
});
test('materializes the complete bounded8×54 matrix and exposes every final column through one scroll viewport',()=>{
 const paint=kit(2),result=createOutcomeOverviewLayout(document(8,54),170,environment(2),paint.layout),table=result.nodes.find(node=>node.semanticRole==='table')!,viewport=parent(result,table);
 expect(paint.cardCalls).toHaveLength(432);expect(result.nodes.filter(node=>node.semanticRole==='columnheader')).toHaveLength(54);expect(result.nodes.filter(node=>node.semanticRole==='cell')).toHaveLength(432);expect(result.nodes.length).toBeLessThanOrEqual(4096);expect(viewport.scroll).toBe(true);expect(result.nodes.filter(node=>node.semanticRole==='cell'&&node.label.includes(' · 54 · '))).toHaveLength(8);expect(result.nodes.filter(node=>node.semanticRole==='rowheader')).toHaveLength(8);
});
test('public frozen names and roles survive caller mutation without consulting any live roster',()=>{
 const input=document(),paint=kit(1),result=createOutcomeOverviewLayout(input,320,environment(1),paint.layout);(input.roster[0] as {name:string}).name='Live renamed user';expect(result.nodes.some(node=>node.label.includes('Live renamed user'))).toBe(false);expect(result.nodes.some(node=>node.semanticRole==='rowheader'&&node.label==='기록 이름 0 · 주공')).toBe(true);
});
test('rejects executable artwork from a kit and malformed schema without publishing authority',()=>{
 const input=document(),paint=kit(1),card=paint.layout.card;paint.layout.card=(...args)=>{const fragment=card(...args);return{...fragment,nodes:fragment.nodes.map(node=>({...node,entityId:'forged-live-card'}))};};expect(()=>createOutcomeOverviewLayout(input,170,environment(1),paint.layout)).toThrow('live authority');expect(()=>createOutcomeOverviewLayout(input,0,environment(1),kit(1).layout)).toThrow();expect(()=>createOutcomeOverviewLayout({...input,sections:[]},170,environment(1),kit(1).layout)).toThrow();
});

test('only winner cells use callout paint; explicit annotations preserve meaning without inventing emphasis',()=>{
 const source=document(1,2),matrix=source.sections[0];if(matrix.kind!=='matrix')throw Error();const input={...source,cards:source.cards.map((card,index)=>index===0?{...card,emphasis:'special' as const}:card),sections:[{...matrix,rows:[{...matrix.rows[0],cells:[matrix.rows[0].cells[0],{cardId:'card:1',annotations:[{text:'효력 없음',tone:'muted' as const}]}]}]}]},result=createOutcomeOverviewLayout(input,170,environment(1),kit(1).layout);
 const cells=result.nodes.filter(node=>node.semanticRole==='cell');expect(cells[0]).toMatchObject({decoration:'callout',tone:'gold'});expect(cells[1].decoration).toBeUndefined();expect(cells[0].label).toContain('승리 · 효력 없음');expect(cells[1].label).toContain('효력 없음');expect(result.nodes.find(node=>node.kind==='card'&&node.label==='공개 카드 0')?.emphasis).toBe('special');
});

for(const width of [170,190,206])for(const scale of [1,2])test(`real round labels use measured numeric short headers at${width}px and${scale}x`,()=>{
 const source=document(),section=source.sections[0];if(section.kind!=='matrix')throw Error();const input={...source,sections:[{...section,columns:section.columns.map((column,index)=>({...column,label:`${index+1}라운드`,shortLabel:String(index+1)}))}]},env=environment(scale),recipe=typography('small',env),paint=kit(scale,recipe.fontSize/scale*.6),result=createOutcomeOverviewLayout(input,width,env,paint.layout);
 const headers=result.nodes.filter(node=>node.semanticRole==='columnheader'),visible=result.nodes.filter(node=>node.kind==='text'&&headers.some(header=>node.parent===header.id));expect(visible.map(node=>node.label)).toEqual(Array.from({length:10},(_,index)=>String(index+1)));expect(headers.map(node=>node.label)).toEqual(Array.from({length:10},(_,index)=>`${index+1}라운드`));
 const table=result.nodes.find(node=>node.semanticRole==='table')!,viewport=parent(result,table),last=headers.at(-1)!;
 if(scale===1){expect(viewport.scroll??false).toBe(false);expect(table.box.width).toBe(width);expect(last.box.x+last.box.width).toBeLessThanOrEqual(width+.001);}else{
  const expectedWidths=input.sections[0].columns.map(column=>Math.max(16,column.shortLabel.length*recipe.fontSize*.6)),minimum=expectedWidths.reduce((sum,value)=>sum+value,0)+9;
  expect(viewport.scroll??false).toBe(minimum>width+.1);expect(viewport.box.height).toBe(table.box.height+(minimum>width+.1?12:0));if(width===170)expect(viewport.scroll).toBe(true);
 }
 expect(result.nodes.filter(node=>node.semanticRole==='cell')).toHaveLength(50);expect(result.nodes.find(node=>node.semanticRole==='cell')!.label).toContain(' · 1라운드 · ');expect(visible.every(node=>node.box.height>=recipe.lineHeight)).toBe(true);expect(paint.textCalls.filter(call=>call.role==='small'&&/^\d+$/.test(call.value))).toHaveLength(10);
 const cardRows=result.nodes.filter(node=>node.semanticRole==='row'&&node.label.endsWith('라운드 카드'));for(const row of cardRows)expect(result.nodes.filter(node=>node.parent===row.id&&node.semanticRole==='cell').map(node=>node.box.x)).toEqual(headers.map(node=>node.box.x));
});

for(const [width,cardHeight] of [[170,23],[320,34]])test(`dense primary overview at${width}px budgets every full name and all5rows without a duplicate visual heading`,()=>{
 const input=document(),paint=kit(1),result=createOutcomeOverviewLayout(input,width,environment(1),paint.layout);expect(result.nodes[0]).toMatchObject({semanticRole:'group',label:input.title});expect(result.nodes.some(node=>node.kind==='text'&&node.label===input.title)).toBe(false);
 const table=result.nodes.find(node=>node.semanticRole==='table')!,rowgroups=result.nodes.filter(node=>node.semanticRole==='rowgroup');expect(rowgroups).toHaveLength(5);expect(table.box.height).toBe(20+5*(20+cardHeight)+5*2);expect(result.height).toBe(table.box.height+(table.box.width>width+.1?12:0));
 for(const group of rowgroups){const rows=result.nodes.filter(node=>node.parent===group.id&&node.semanticRole==='row');expect(rows[1].box.y).toBe(rows[0].box.height);expect(rows[0].box.height).toBe(20);expect(group.box.height).toBe(20+cardHeight);}
 expect(paint.textCalls.filter(call=>call.value.includes('기록 이름')).every(call=>call.role==='small'&&call.width===width)).toBe(true);expect(paint.cardCalls).toHaveLength(50);
});
test('dense gaps never shrink, truncate or overlap a full long name at2x',()=>{
 const source=document(),longName='기록에 고정된 아주 긴 참가자 이름 전체',input={...source,roster:source.roster.map((person,index)=>index===0?{...person,name:longName}:person)},paint=kit(2),result=createOutcomeOverviewLayout(input,170,environment(2),paint.layout),header=result.nodes.find(node=>node.semanticRole==='rowheader'&&node.label.startsWith(longName))!,nameText=result.nodes.find(node=>node.parent===header.id&&node.kind==='text')!;
 expect(nameText.label).toBe(`${longName} · 주공`);expect(nameText.box.height).toBeGreaterThan(40);expect(nameText.box.height%40).toBe(0);const nameRow=parent(result,header),group=parent(result,nameRow),cardRow=result.nodes.find(node=>node.parent===group.id&&node.semanticRole==='row'&&node!==nameRow)!;expect(cardRow.box.y).toBeGreaterThanOrEqual(nameText.box.height);expect(group.box.height).toBeGreaterThanOrEqual(nameText.box.height+cardRow.box.height);expect(result.nodes.filter(node=>node.semanticRole==='cell')).toHaveLength(50);
});

test('arena allocation shares the exact chosen density minimum without assuming ten columns',()=>{
 for(const count of [3,10,54])for(const allocation of [170,320])for(const scale of [1,2]){
  const input=document(5,count),env=environment(scale),paint=kit(scale,8.4),expected=input.sections[0];if(expected.kind!=='matrix')throw Error();const minimum=expected.columns.reduce((sum,column)=>sum+Math.max(allocation<240?16:24,column.label.length*8.4*scale),0)+Math.max(0,count-1);
  expect(outcomeOverviewMinimumWidth(input,allocation,env,paint.layout.measureText)).toBeCloseTo(minimum);const result=createOutcomeOverviewLayout(input,allocation,env,paint.layout),table=result.nodes.find(node=>node.semanticRole==='table')!;expect(table.box.width).toBeGreaterThanOrEqual(minimum-.001);
 }
});
