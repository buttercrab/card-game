import {expect,test,vi} from 'vitest';
import type {PlannedNode} from './contracts';
import {createArtworkPaintOwner,projectArtworkPaint,sameArtworkPaint} from './artworkPaint';
const node=(patch:Partial<PlannedNode>={}):PlannedNode=>({id:'n',parent:null,kind:'card',label:'카드',box:{x:0,y:0,width:80,height:112},visual:{kind:'standard',suit:'Spade',rank:14},...patch});
const unequal=(before:PlannedNode,after:PlannedNode)=>expect(sameArtworkPaint(projectArtworkPaint(before),projectArtworkPaint(after))).toBe(false);
test('fresh equivalent frame nodes and geometry/input metadata changes never reassign a paint leaf',()=>{
 const changed=vi.fn(),owner=createArtworkPaintOwner(node(),changed),prior=owner.current;
 for(let i=0;i<30;i++)expect(owner.update(node({id:`new-${i}`,label:'new private label',parent:'other',box:{x:i,y:i,width:80+i,height:120+i},shellActionId:'command',formField:{leaseId:'private',fieldId:'secret',value:'hidden'}}))).toBe(false);
 expect(owner.current).toBe(prior);expect(changed).not.toHaveBeenCalled();expect(Object.keys(prior!)).toEqual(['kind','visual','full','emphasis','checked','hinted','unavailable']);expect(JSON.stringify(prior)).not.toContain('private');
 expect(owner.update(node({box:{x:0,y:0,width:79.99,height:112}}))).toBe(true);expect(changed).toHaveBeenCalledTimes(1);expect(owner.current?.full).toBe(false);
});
test('every consumed card paint property participates, with width compared at the actual full-art threshold',()=>{
 for(const patch of [{kind:'figure'},{visual:undefined},{visual:{kind:'back'}},{visual:{kind:'standard',suit:'Heart',rank:14}},{visual:{kind:'standard',suit:'Spade',rank:13}},{emphasis:'special'},{emphasis:'call'},{emphasis:'joker'},{checked:true},{hinted:true},{unavailable:true}] satisfies Partial<PlannedNode>[])unequal(node(),node(patch));
 unequal(node({visual:{kind:'joker',color:'Black'}}),node({visual:{kind:'joker',color:'Red'}}));
 expect(sameArtworkPaint(projectArtworkPaint(node()),projectArtworkPaint(node({box:{x:10,y:20,width:160,height:200},checked:false,hinted:false})))).toBe(true);
 expect(sameArtworkPaint(projectArtworkPaint(node({visual:{kind:'back'}})),projectArtworkPaint(node({visual:{kind:'back'}})))).toBe(true);
});
test('every consumed figure appearance and clock identifier or typography change participates',()=>{
 const base=node({kind:'figure',visual:undefined});
 for(const appearance of [{vacant:true},{team:'declarer'},{team:'friend'},{team:'defense'},{trumpSuit:'Diamond'},{bot:true},{offline:true},{thinking:true}] satisfies NonNullable<PlannedNode['appearance']>[])unequal(base,node({...base,appearance}));
 expect(sameArtworkPaint(projectArtworkPaint(base),projectArtworkPaint(node({...base,appearance:{vacant:false,team:null,trumpSuit:null,bot:false,offline:false,thinking:false}})))).toBe(true);
 const clock={id:'clock1',kind:'decision' as const,remaining:5} as unknown as NonNullable<PlannedNode['clockPaint']>;
 const timed=node({...base,clockPaint:clock});unequal(base,timed);unequal(timed,node({...timed,clockPaint:{...clock,id:'clock2'}}));unequal(timed,node({...timed,clockTextScale:2}));
 expect(sameArtworkPaint(projectArtworkPaint(timed),projectArtworkPaint(node({...timed,clockTextScale:1,clockPaint:{...clock,remaining:4} as typeof clock})))).toBe(true);
});
test('icon, suit, progress segment order and all geometry/tone/target values participate',()=>{
 unequal(node({kind:'icon',shellIcon:'menu'}),node({kind:'icon',shellIcon:'smile'}));unequal(node({kind:'suit',suit:'Spade'}),node({kind:'suit',suit:'Heart'}));
 const progress=node({kind:'progress',visual:undefined,progressPaint:{segments:[{x:0,width:20,tone:'accent'},{x:22,width:20,tone:'gold'}],target:50}});
 for(const progressPaint of [{segments:[{x:1,width:20,tone:'accent'},{x:22,width:20,tone:'gold'}],target:50},{segments:[{x:0,width:21,tone:'accent'},{x:22,width:20,tone:'gold'}],target:50},{segments:[{x:0,width:20,tone:'danger'},{x:22,width:20,tone:'gold'}],target:50},{segments:[...progress.progressPaint!.segments].reverse(),target:50},{segments:progress.progressPaint!.segments,target:51},{segments:progress.progressPaint!.segments},{segments:[],target:50}] satisfies NonNullable<PlannedNode['progressPaint']>[])unequal(progress,node({...progress,progressPaint}));
 expect(sameArtworkPaint(projectArtworkPaint(node({kind:'progress',visual:undefined})),projectArtworkPaint(node({kind:'progress',visual:undefined,progressPaint:{segments:[]}})))).toBe(true);
});
test('toggle projection retains only its effective boolean and preserves form-field precedence',()=>{
 const off=node({kind:'toggle',formField:{leaseId:'lease',fieldId:'field',value:false}}),on=node({...off,formField:{leaseId:'lease',fieldId:'field',value:true}});unequal(off,on);
 expect(projectArtworkPaint(off)).toEqual({kind:'toggle',toggle:false});expect(projectArtworkPaint(on)).toEqual({kind:'toggle',toggle:true});
 const preference={id:'motion',label:'움직임',enabled:true,kind:'toggle',value:true} satisfies Extract<NonNullable<PlannedNode['preference']>,{kind:'toggle'}>;
 expect(projectArtworkPaint(node({kind:'toggle',preference})).toggle).toBe(true);expect(projectArtworkPaint(node({...off,preference})).toggle).toBe(false);
 expect(sameArtworkPaint(projectArtworkPaint(off),projectArtworkPaint(node({kind:'toggle',preference:{...preference,value:false}})))).toBe(true);
});
test('mutating a reused source tree between invocations cannot corrupt the retained paint or evade updates',()=>{
 const raw={...node(),visual:{kind:'standard' as const,suit:'Spade' as const,rank:14}},changed=vi.fn(),owner=createArtworkPaintOwner(raw,changed),prior=owner.current!;raw.visual.rank=13;
 expect(prior.visual).toEqual({kind:'standard',suit:'Spade',rank:14});expect(owner.update(raw)).toBe(true);expect(owner.current?.visual).toEqual({kind:'standard',suit:'Spade',rank:13});
 const segments=[{x:0,width:10,tone:'accent' as const}],progress=node({kind:'progress',progressPaint:{segments}}),progressOwner=createArtworkPaintOwner(progress,changed);segments[0].width=30;expect(progressOwner.current?.progress?.segments[0].width).toBe(10);expect(progressOwner.update(progress)).toBe(true);expect(progressOwner.current?.progress?.segments[0].width).toBe(30);
});
test('destroy retires retained paint before observer reentry, is idempotent, and denies every later update',()=>{
 let owner:ReturnType<typeof createArtworkPaintOwner>;const changed=vi.fn(value=>{if(value===null){expect(owner.current).toBeNull();expect(owner.update(node({hinted:true}))).toBe(false);}});owner=createArtworkPaintOwner(node(),changed);
 expect(owner.destroy()).toBe(true);expect(owner.current).toBeNull();expect(owner.destroy()).toBe(false);expect(owner.update(node())).toBe(false);expect(changed).toHaveBeenCalledExactlyOnceWith(null);
});

test('getter-triggered destruction during projection cannot resurrect retired artwork',()=>{
 const changed=vi.fn(),owner=createArtworkPaintOwner(node(),changed),incoming=node({hinted:true});
 Object.defineProperty(incoming,'visual',{enumerable:true,get(){owner.destroy();return {kind:'joker',color:'Red'};}});
 expect(owner.update(incoming)).toBe(false);expect(owner.current).toBeNull();expect(changed).toHaveBeenCalledExactlyOnceWith(null);expect(owner.update(node())).toBe(false);
});
test('nested update during projection wins even when the newer update has unchanged paint',()=>{
 for(const nestedChanged of [false,true]){
  const changed=vi.fn(),owner=createArtworkPaintOwner(node(),changed),newest=node({hinted:nestedChanged}),incoming=node({checked:true});
  Object.defineProperty(incoming,'visual',{enumerable:true,get(){expect(owner.update(newest)).toBe(nestedChanged);return {kind:'joker',color:'Red'};}});
  expect(owner.update(incoming)).toBe(false);expect(owner.current).toEqual(projectArtworkPaint(newest));expect(changed).toHaveBeenCalledTimes(nestedChanged?1:0);
 }
});
