import {expect,test} from 'vitest';
import {planTable,typography,validateLayout} from './planner';
import {mightyJokerDocument} from './mightyJokerFixture';
import {shellDocument} from './shellFixture';
import type {CandidateLayout,ChoiceView,Environment,TableDocument} from './contracts';
const choices:ChoiceView={selected:null,values:{},fields:[],commands:[]};
function solve<A>(document:TableDocument<A>,height:number):CandidateLayout {
 const environment:Environment={width:1280,height,textScale:1,revision:'rail-budget',fontRevision:'rail-budget',fontFamily:'sans-serif',scrollbarWidth:15,scrollbarHeight:15,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}},values=new Map();
 for(let pass=0;pass<20;pass++){
  const result=planTable(document,environment,choices,values);if(result.kind==='ready')return result.layout;if(result.kind!=='needs')throw Error(JSON.stringify(result));
  for(const request of result.requests){const natural=[...request.text].reduce((sum,char)=>sum+(/[가-힣]/.test(char)?request.role==='name'?18:16:8),0),width=request.width??natural;values.set(request.key,{width:Math.min(natural,width),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*typography(request.role,environment).lineHeight});}
 }
 throw Error('Rail metrics did not settle');
}
function global(layout:CandidateLayout,id:string){let node=layout.nodes.find(node=>node.id===id)!;const box={...node.box};while(node.parent){node=layout.nodes.find(parent=>parent.id===node.parent)!;box.x+=node.box.x;box.y+=node.box.y;}return box;}
test.each([720,800,900])('admitted desktop rail budgets complete public facts and every score row at height%s',height=>{
 const source=mightyJokerDocument(),document={...source,shell:shellDocument().shell},layout=solve(document,height);expect(validateLayout(layout)).toEqual([]);
 const rail=global(layout,'table-sidebar');
 for(const row of document.scoreboard!.rows){const id=JSON.stringify([JSON.stringify(['scoreboard',document.scoreboard!.id]),'row',row.participantId]),box=global(layout,id);expect(box.y).toBeGreaterThanOrEqual(rail.y);expect(box.y+box.height,`Complete score row ${row.participantId}`).toBeLessThanOrEqual(rail.y+rail.height);}
 for(const field of document.information![0].fields)expect(layout.nodes.some(node=>node.id===JSON.stringify([JSON.stringify(['information',document.information![0].id]),'field',field.id]))).toBe(true);
 expect(layout.nodes.some(node=>node.kind==='progress')).toBe(true);expect(layout.nodes.some(node=>node.id==='scoreboard-disclosure')).toBe(false);
});
