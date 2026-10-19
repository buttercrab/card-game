import {expect,test} from 'vitest';
import {completionFixture} from '../../games/mighty/testSupport/completionFixture';
import {mightyDocument,type MightyCommand} from '../../games/mighty/foundation';
import {projectMightyOutcome} from '../../games/mighty/settled';
import type {Mighty,Rules,StateMsg,View} from '../../games/mighty/types';
import {CATALOG} from '../../catalog';
import type {ConnectedProjectionClient} from './connected';
import type {CandidateLayout,ChoiceView,Environment,MeasureRequest,PlannedNode,Size,TableDocument} from './contracts';
import {planTable,typography,validateLayout} from './planner';
const base:Environment={width:1280,height:800,revision:'viewport',fontRevision:'font',fontFamily:'sans-serif',textScale:1,scrollbarWidth:0,controls:{command:{fontSize:16,lineHeight:22,fontWeight:700,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:16,lineHeight:22,fontWeight:700,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
/** Real Mighty semantic producers with default rules and a public Done record;
 * this metric oracle proves allocation, not native browser glyph dimensions. */
function fixture():TableDocument<MightyCommand>{
 const source=completionFixture(),record=source.room!.current_hand!,rules=record.rules as Rules;
 const room={...source.room!,protocol:CATALOG.protocol,settings:{preset:'default'},rules,customized:false,seats:record.names.map((name,index)=>index===0?{kind:'human',name,connected:true,away:false}:{kind:'bot',name,level:'easy'}),participant_ids:[...record.participant_ids],table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:0,observers:[],ready:Array(5).fill(true),participation:[],scores:[-2,3,3,-2,-2],history:[],hands:[]} as NonNullable<ConnectedProjectionClient<Mighty>['room']>;
 const scope={...source.scope!,actor_id:record.participant_ids[0],seat:0},game:StateMsg={version:15,grace_ms:0,turn:'Over',legal:[],out_of_turn:[],notes:{unplayable:[],contracts:[]},view:record.view as View};
 const client:ConnectedProjectionClient<Mighty>={room,game,roomScope:scope,seat:0,viewerId:scope.actor_id,viewerName:record.names[0]};
 const document=mightyDocument(client,1,true,undefined,true)!;expect(document).not.toBeNull();const result=projectMightyOutcome({client,document,roomScope:scope})!;expect(result).not.toBeNull();
 return {...document,information:[...(document.information??[]),result.information],outcome:result.outcome,...(result.collections?{collections:result.collections}:{}),...(result.reveals?{reveals:result.reveals}:{})};
}
function metric(request:MeasureRequest):Size{const width=[...request.text].length*8*request.environment.textScale,allocation=request.width??width;return{width:Math.min(width,allocation),height:Math.max(1,Math.ceil(width/Math.max(1,allocation)))*typography(request.role,request.environment).lineHeight};}
function solve(environment=base,document=fixture(),overrides:Partial<ChoiceView>={}):CandidateLayout{const metrics=new Map<string,Size>(),choices:ChoiceView={selected:null,values:{},fields:[],commands:[],outcomeCommands:document.outcome!.continuationActionIds.map(id=>{const action=document.offer.actions.find(action=>action.id===id)!;return{id,label:action.label,enabled:action.enabled,intent:action.intent};}),...overrides};for(let pass=0;pass<18;pass++){const result=planTable(document,environment,choices,metrics);if(result.kind==='ready')return result.layout;if(result.kind!=='needs')throw Error(JSON.stringify(result));for(const request of result.requests)metrics.set(request.key,metric(request));}throw Error('Mighty settled sidebar did not converge');}
function box(layout:CandidateLayout,node:PlannedNode){const value={...node.box};let parent=node.parent;while(parent){const owner=layout.nodes.find(node=>node.id===parent)!;value.x+=owner.box.x;value.y+=owner.box.y;parent=owner.parent;}return value;}
function ancestors(layout:CandidateLayout,node:PlannedNode){const parents:PlannedNode[]=[];let parent=node.parent;while(parent){const owner=layout.nodes.find(node=>node.id===parent)!;parents.push(owner);parent=owner.parent;}return parents;}
test('default five-player Mighty result gives the sidebar its complete desktop body height',()=>{
 const layout=solve();expect(validateLayout(layout)).toEqual([]);const rail=layout.nodes.find(node=>node.id==='table-sidebar')!,railBox=box(layout,rail),left=layout.nodes.find(node=>node.id==='settled-primary-column')!,dock=layout.nodes.find(node=>node.id==='settled-dock')!;
 expect(rail.parent).toBe('settled-table-columns');expect(left.parent).toBe(rail.parent);expect(ancestors(layout,rail).some(node=>node.id==='settled-table-viewport')).toBe(false);expect(railBox.y+railBox.height).toBe(784);expect(box(layout,dock).height).toBeGreaterThan(0);
 const rows=layout.nodes.filter(node=>node.semanticRole==='group'&&node.id.includes('scoreboard')&&node.id.includes('row')&&!node.id.includes('identity'));expect(rows).toHaveLength(5);
 for(const row of rows){const value=box(layout,row);expect(value.y).toBeGreaterThanOrEqual(railBox.y);expect(value.y+value.height).toBeLessThanOrEqual(railBox.y+railBox.height);}
 expect(layout.nodes.find(node=>node.id==='identity-figure')?.box.width).toBe(72);const figure=box(layout,layout.nodes.find(node=>node.id==='identity-figure')!),local=box(layout,layout.nodes.find(node=>node.id==='dock')!);expect(figure.x+figure.width/2).toBe(local.x+local.width/2);
});
test.each([[1280,800,2,0],[1280,640,1,15],[1280,640,2,15],[390,844,1,0],[390,844,2,0],[390,844,1,15],[390,844,2,15],[844,390,1,0]])('result rows remain complete and reachable at %sx%s scale%s gutter%s',(width,height,textScale,scrollbarWidth)=>{
 const environment={...base,width,height,textScale,scrollbarWidth};let layout=solve(environment);expect(validateLayout(layout)).toEqual([]);const primaryViewport=layout.nodes.find(node=>node.id==='settled-table-viewport');if(primaryViewport){const child=layout.nodes.find(node=>node.parent===primaryViewport.id)!;expect(child.box.width).toBeLessThanOrEqual(primaryViewport.box.width-scrollbarWidth+.001);}if(!layout.nodes.some(node=>node.id==='table-sidebar')){layout=solve(environment,fixture(),{informationOpen:true});expect(layout.modalId).toBe('table-information-dialog');expect(validateLayout(layout)).toEqual([]);}const rows=layout.nodes.filter(node=>node.semanticRole==='group'&&node.id.includes('scoreboard')&&node.id.includes('row')&&!node.id.includes('identity'));expect(rows).toHaveLength(5);
 for(const row of rows){const value=box(layout,row);expect(value.width).toBeGreaterThan(0);for(const parent of ancestors(layout,row).filter(node=>node.scroll)){const clip=box(layout,parent);expect(value.x).toBeGreaterThanOrEqual(clip.x-.001);expect(value.x+value.width).toBeLessThanOrEqual(clip.x+clip.width+.001);if(value.y+value.height>clip.y+clip.height)expect(parent.scrollAxis).not.toBe('x');}}
 const rail=layout.nodes.find(node=>node.id==='table-sidebar');if(rail){expect(rail.parent).toBe('settled-table-columns');expect(ancestors(layout,rail).some(node=>node.id==='settled-table-viewport')).toBe(false);expect(box(layout,rail).y+rail.box.height).toBe(height-16);}
});
test('sidebar content growth cannot move or resize the left peers, local identity or result',()=>{
 const document=fixture(),before=solve(base,document),expanded={...document,scoreboard:{...document.scoreboard!,columns:document.scoreboard!.columns.map(column=>({...column,label:`${column.label} · 길고 완전한 점수 설명`})),rows:document.scoreboard!.rows.map(row=>({...row,values:row.values.map(()=>123456789)}))}},after=solve(base,expanded);expect(validateLayout(after)).toEqual([]);
 for(const id of ['opponents-upper','opponents-left','opponents-right','identity-figure','dock','outcome']){const a=before.nodes.find(node=>node.id===id)!,b=after.nodes.find(node=>node.id===id)!;expect(a,`Missing baseline ${id}`).toBeDefined();expect(b,`Missing expanded ${id}`).toBeDefined();expect(box(after,b)).toEqual(box(before,a));}
});
