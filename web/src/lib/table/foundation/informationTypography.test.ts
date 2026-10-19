import {expect,test} from 'vitest';
import type {ChoiceView,Environment,InformationValue,MeasureRequest,Size,TableDocument} from './contracts';
import {informationDocument} from './informationFixture';
import {mightyJokerDocument} from './mightyJokerFixture';
import {informationAtomRole,textFontFamily} from './informationTypography';
import {measurementFontLoads} from './measurementFontLoads';
import {planTable,typography} from './planner';

const base:Environment={width:1280,height:900,textScale:1,revision:'type',fontRevision:'font',fontFamily:'Body',artFontFamily:'Display',scrollbarWidth:0,scrollbarHeight:0,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
const choices:ChoiceView={selected:null,values:{},fields:[],commands:[]};
function solve(value:InformationValue,textScale:number,source:TableDocument<unknown>=informationDocument(),viewport:{width:number;height:number}={width:1280,height:900}){
 const document={...source,information:source.information!.map((panel,index)=>index?panel:{...panel,primary:{value}})},environment={...base,...viewport,textScale},metrics=new Map<string,Size>(),requests:MeasureRequest[]=[];
 for(let pass=0;pass<20;pass++){
  const result=planTable(document,environment,choices,metrics);
  if(result.kind==='ready')return {layout:result.layout,requests,environment};
  if(result.kind!=='needs')throw Error(JSON.stringify(result));
  for(const request of result.requests){requests.push(request);const recipe=typography(request.role,environment),natural=[...request.text].length*recipe.fontSize*.55,width=request.width??natural;metrics.set(request.key,{width:Math.min(width,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*recipe.lineHeight});}
 }
 throw Error('Typography measurement did not settle');
}
test.each([1,2])('typed primary prose and numbers use their original distinct metric and font owners at %sx',scale=>{
 const env={...base,textScale:scale};
 expect(typography('information-number',env)).toEqual({fontSize:38*scale,lineHeight:38*scale,fontWeight:800});
 expect(typography('information-prose',env)).toEqual({fontSize:13*scale,lineHeight:17.55*scale,fontWeight:400});
 const loads=measurementFontLoads(['information-number','information-prose'].map(role=>({key:role,text:'123',role:role as 'information-number'|'information-prose',width:null,environment:env})));
 expect(loads.map(load=>load.font)).toEqual([`800 ${38*scale}px Display`,`400 ${13*scale}px Body`]);
 expect(textFontFamily('information-number',{...env,artFontFamily:undefined})).toBe('Body');
 expect(typography('display',env).fontSize).toBe(44*scale);
 expect(typography('compact-display',env).fontSize).toBe(20*scale);
});
test.each([{kind:'text',text:'공약 없음'} as const,{kind:'text',text:'123 ♠'} as const,{kind:'number',value:123} as const])('actual full HUD paints the same semantic role it preregisters: %j',value=>{
 const {layout,requests}=solve(value,1),label=value.kind==='text'?value.text:String(value.value),role=value.kind==='text'?'information-prose':'information-number';
 const primary=JSON.stringify([JSON.stringify(['information','status']),'primary']);
 const node=layout.nodes.find(node=>node.parent===primary&&node.label===label)!;
 expect(node).toBeDefined();expect(node.role).toBe(role);
 expect(requests.some(request=>request.text===label&&request.role===role&&request.width===null)).toBe(true);
 expect(node.box.height).toBe(typography(role,base).lineHeight);
 if(value.kind==='text')expect(node.tone).toBe('muted');
});
test('inline values retain typed order while participant and explicit compact roles stay independent',()=>{
 const {layout,requests}=solve({kind:'inline',values:[{kind:'suit',suit:'Spade',label:'스페이드'},{kind:'number',value:17},{kind:'text',text:'점'}]},1);
 const primary=JSON.stringify([JSON.stringify(['information','status']),'primary']);
 expect(layout.nodes.filter(node=>node.parent===primary).map(node=>[node.kind,node.label,node.role])).toEqual([['suit','스페이드',undefined],['text','17','information-number'],['text','점','information-token']]);
 expect(requests.some(request=>request.text==='17'&&request.role==='information-number')).toBe(true);
 expect(informationAtomRole({kind:'participant',participantId:'p'},'primary')).toBe('name');
 expect(informationAtomRole({kind:'text',text:'123'},'primary','compact-display')).toBe('compact-display');
 expect(informationAtomRole({kind:'number',value:17},'value')).toBe('body');
});

test.each([1,2])('actual Mighty no-trump producer uses the original token and matching load/paint at %sx',scale=>{
 const document=mightyJokerDocument({trump:null}),value=document.information![0].primary!.value;
 expect(value).toEqual({kind:'inline',values:[{kind:'token',token:'노',label:'노기루다'},{kind:'number',value:17}]});
 const {layout,requests,environment}=solve(value,scale,document,{width:1280*scale,height:900*scale}),primary=JSON.stringify([JSON.stringify(['information','mighty-status']),'primary']);
 const tokenOwner=layout.nodes.find(node=>node.parent===primary&&node.kind==='group'&&node.label==='노기루다')!,token=layout.nodes.find(node=>node.parent===tokenOwner.id&&node.label==='노')!,number=layout.nodes.find(node=>node.parent===primary&&node.label==='17')!;
 expect(token.role).toBe('information-token');expect(token.tone).not.toBe('muted');
 expect(token.box.height).toBe(18*1.45*scale);expect(number.role).toBe('information-number');
 expect(number.box.height).toBe(38*scale);
 for(const [label,role] of [['노','information-token'],['17','information-number']] as const)expect(requests.some(request=>request.text===label&&request.role===role&&request.width===null)).toBe(true);
 const fonts=measurementFontLoads(requests).map(load=>load.font);
 expect(fonts).toContain(`800 ${18*scale}px Body`);expect(fonts).toContain(`800 ${38*scale}px Display`);
 expect(informationAtomRole({kind:'token',token:'노',label:'노기루다'},'value')).toBe('body');
 expect(tokenOwner.semanticRole).toBe('group');expect(token.inert).toBe(true);
 expect(textFontFamily('information-token',environment)).toBe('Body');
});

test('an admitted compact 2x HUD keeps body paint and matching body metrics instead of forcing the full primary recipe',()=>{
 const document=mightyJokerDocument({trump:null}),value=document.information![0].primary!.value,{layout,requests}=solve(value,2,document);
 const primary=JSON.stringify([JSON.stringify(['information','mighty-status']),'primary']);
 for(const label of ['노기루다','17']){const node=layout.nodes.find(node=>node.parent===primary&&node.label===label)!;expect(node.role).toBe('body');expect(node.box.height).toBe(48);expect(requests.some(request=>request.text===label&&request.role==='body')).toBe(true);}
});

test.each([[390,844],[768,1024]])('same Mighty token keeps its full compact meaning at %s×%s', (width,height)=>{
 const document=mightyJokerDocument({trump:null}),value=document.information![0].primary!.value,{layout,requests}=solve(value,1,document,{width,height});
 const names=layout.nodes.filter(node=>node.kind==='text'&&node.label==='노기루다');
 expect(names.length).toBeGreaterThan(0);expect(names.every(node=>node.role==='body')).toBe(true);
 expect(layout.nodes.some(node=>node.kind==='text'&&node.label==='노')).toBe(false);
 expect(requests.some(request=>request.text==='노기루다'&&request.role==='body')).toBe(true);
});
