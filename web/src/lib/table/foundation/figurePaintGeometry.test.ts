import {afterEach,expect,test,vi} from 'vitest';
import {createDomTransfers} from './domTransfers';
import {figurePaintBounds} from './figureArtworkMetrics';
import type {PlannedNode,PresentationFrame,Rect} from './contracts';
class ElementFake {
 dataset:Record<string,string>={};parentElement:ElementFake|null=null;textContent='';glyphs:ElementFake[]=[];overflow='visible';bounds:Rect={x:0,y:0,width:400,height:400};
 get clientLeft(){return 0;}get clientTop(){return 0;}get clientWidth(){return this.bounds.width;}get clientHeight(){return this.bounds.height;}
 getBoundingClientRect(){return {...this.bounds,left:this.bounds.x,top:this.bounds.y,right:this.bounds.x+this.bounds.width,bottom:this.bounds.y+this.bounds.height};}
 querySelectorAll(){return this.glyphs;}
}
afterEach(()=>vi.unstubAllGlobals());
function fixture(clipped=false){
 const host=new ElementFake(),element=new ElementFake(),glyph=new ElementFake(),parent=new ElementFake();parent.parentElement=host;parent.overflow=clipped?'hidden':'visible';parent.bounds={x:0,y:100,width:300,height:300};element.parentElement=parent;element.dataset.foundationFrame='1';element.bounds={x:100,y:100,width:56,height:56*110/120};glyph.textContent='5';glyph.bounds={x:160,y:170,width:20,height:30};element.glyphs=[glyph];
 vi.stubGlobal('innerWidth',400);vi.stubGlobal('innerHeight',400);vi.stubGlobal('getComputedStyle',(value:ElementFake)=>({zoom:'1',transform:'none',perspective:'none',scale:'none',rotate:'none',translate:'none',overflowX:value.overflow,overflowY:value.overflow}));
 const node:PlannedNode={id:'figure',parent:null,kind:'figure',ownerId:'me',label:'현재 이름',box:{...element.bounds},clockPaint:{id:'clock',participantId:'me',deadline:1000,total:10000,local:true}},frame:PresentationFrame={id:1,nodes:[node],context:{session:'geometry',audience:'me',generation:'hand',revision:'1'},offerId:'offer',width:400,height:400,recipe:'stacked',environment:{width:400,height:400,textScale:1,revision:'geometry',fontRevision:'geometry',fontFamily:'sans-serif',controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1}}}};
 return {host:host as unknown as HTMLElement,elements:new Map([['figure',element as unknown as HTMLElement]]),frame,node,glyph};
}
test('native protected figure includes original clock stroke and actual current countdown glyph',()=>{const f=fixture(),owner=createDomTransfers(f.host),geometry=owner.geometry(f.frame,f.elements)!;expect(geometry).not.toBeNull();expect(geometry.protectedRects).toHaveLength(1);const expected=figurePaintBounds(f.node.box,true,[f.glyph.bounds]);expect(geometry.protectedRects[0]).toMatchObject({x:expected.x-6,y:expected.y-6,width:expected.width+12,height:expected.height+12});});
test('native current clock or numeral clipping refuses geometry instead of discarding painted outsets',()=>{const f=fixture(true),owner=createDomTransfers(f.host);expect(owner.geometry(f.frame,f.elements)).toBeNull();});
