import {expect,test} from 'vitest';
import {shellDocument} from './shellFixture';
import {createCardSession} from './session';
import {planTable,typography,validateLayout} from './planner';
import type {ChoiceView,Environment,Size} from './contracts';

test.each([500,700])('a canonical tall shell with%i px line height keeps full header/root-flow fallback',lineHeight=>{
 const source=shellDocument(),document={...source,statusPresentation:{informationId:'status',fieldIds:['declarer','friend','round'],primary:true,summary:true,progress:true},collections:[{id:'trick',kind:'trick' as const,purpose:'play' as const,label:'공개 트릭',cards:[]}],presentation:{id:'tall-header',schemaVersion:1,tableCollectionIds:['trick']}},session=createCardSession({transport:()=>{}});
 session.receive(document);const canonical=session.snapshot().document!;
 const recipe={fontSize:15,lineHeight,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},environment:Environment={width:1280,height:640,textScale:1,fontFamily:'sans-serif',fontRevision:'tall-header',revision:'tall-header',controls:{command:recipe,choice:{...recipe,lineHeight:18}}};
 const choices:ChoiceView={selected:null,values:{},fields:[],commands:[]},metrics=new Map<string,Size>();
 try{for(let pass=0;pass<20;pass++){
  const result=planTable(canonical,environment,choices,metrics);
  if(result.kind==='needs'){for(const request of result.requests){const natural=[...request.text].length*8,width=request.width??natural;metrics.set(request.key,{width:Math.min(width,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*typography(request.role,environment).lineHeight});}continue;}
  expect(result.kind,JSON.stringify(result)).toBe('ready');if(result.kind!=='ready')return;
  expect(validateLayout(result.layout,environment)).toEqual([]);const header=result.layout.nodes.find(node=>node.id==='room-shell')!;expect(header.box.height+32).toBeGreaterThan(environment.height);expect(result.layout.height).toBeGreaterThan(environment.height);expect(result.layout.nodes.find(node=>node.id==='table')?.scroll).toBe(true);expect(result.layout.nodes.some(node=>node.id==='table-active-status')).toBe(true);const identities=[{id:'identity-figure',ownerId:canonical.participant.id},...(canonical.opponents??[]).map(person=>({id:JSON.stringify([JSON.stringify(['opponent',person.id]),'figure']),ownerId:person.id}))];expect(identities).toHaveLength(5);for(const identity of identities)expect(result.layout.nodes.find(node=>node.id===identity.id)).toMatchObject({kind:'figure',ownerId:identity.ownerId});for(const id of ['active-status-primary','active-status-summary','active-status-progress',...canonical.statusPresentation!.fieldIds.map(id=>JSON.stringify(['active-status-field',id]))])expect(result.layout.nodes.some(node=>node.id===id),id).toBe(true);expect(session.snapshot().document).toBe(canonical);expect(session.snapshot().operations).toHaveLength(0);return;
 }throw Error('Tall header measurement did not converge');}finally{session.dispose();}
});
