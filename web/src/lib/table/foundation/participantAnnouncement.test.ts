import {CATALOG} from '../../catalog';
import {presetRules} from '../../games/mighty/catalog';
import {mightyDocument} from '../../games/mighty/foundation';
import type {CurrentRoomView,StateMsg} from '../../games/mighty/types';
/** Public native Bidding packet: one announced Heart14 and one passed seat. */
function mightyAnnouncementDocument(){
 const rules=presetRules('default'),ids=['p0','p1','p2','p3','p4'];
 const room:CurrentRoomView={id:'announcements',game:'mighty',protocol:CATALOG.protocol,settings:{preset:'default'},rules,customized:false,seats:ids.map((_,index)=>({kind:'human',name:`참가자 ${index+1}`,connected:true,away:false})),in_hand:true,showing:true,table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:0,observers:[],ready:ids.map(()=>true),participant_ids:ids,participation:[],scores:ids.map(()=>0),hands_played:0};
 const state:StateMsg={version:7,grace_ms:0,turn:{Seat:0},legal:['Pass'],out_of_turn:[],policy_actions:{legal:['Pass'],out_of_turn:[]},notes:{unplayable:[],contracts:[]},view:{viewer:{Seat:0},rules,first_bidder:0,hand:Array.from({length:10},(_,index)=>({Normal:['Spade',index+2]})),hand_sizes:ids.map(()=>10),points_taken:ids.map(()=>[]),bids:[],redealt:null,phase:{Bidding:{to_act:0,best:[1,{trump:'Heart',count:14}],passed:[false,false,true,false,false],has_bid:[false,true,false,false,false]}}}};
 const document=mightyDocument({room,game:state,seat:0,viewerId:'p0',viewerName:'참가자 1'},1);if(!document)throw Error('Mighty announcement projection unavailable');return document;
}

import {expect,it} from 'vitest';
import {measureParticipantCaption} from './participantCaption';
import type {InlineCaptionAtom} from './inlineCaption';
it.each([1,2])('actual Mighty public Heart14 uses a complete compact typed caption at scale%s',scale=>{const doc=mightyAnnouncementDocument(),status=doc.opponents!.find(person=>person.id==='p1')!.status!;expect(status.value).toMatchObject({kind:'inline',values:[{kind:'suit',suit:'Heart'},{kind:'number',value:14}]});if(status.value.kind!=='inline')throw Error('inline');const plan=measureParticipantCaption(status.value.values as readonly InlineCaptionAtom[],144,scale,(text,width)=>{const natural=[...text].length*6*scale,allocation=width??natural;return {width:Math.min(natural,allocation),height:14.4*scale*Math.max(1,Math.ceil(natural/Math.max(1,allocation)))};});expect(plan.height).toBe(20*scale);expect(plan.content.parts[0].atom).toMatchObject({kind:'suit',suit:'Heart'});expect(plan.content.parts[1].atom).toEqual({kind:'number',value:14});expect(plan.insetY+plan.content.height).toBeLessThanOrEqual(plan.height);});


import {planTable,typography,validateLayout} from './planner';
import {textFontFamily} from './informationTypography';
import type {CandidateLayout,Environment,MeasureRequest,Size} from './contracts';
function actualAnnouncementLayout(textScale:number){
 const document=mightyAnnouncementDocument(),environment:Environment={width:390,height:844,textScale,revision:`typed-announcement-${textScale}`,fontRevision:'caption',fontFamily:'Body Face',artFontFamily:'Card Face',scrollbarWidth:0,scrollbarHeight:0,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}},values=new Map<string,Size>(),requests:MeasureRequest[]=[];
 for(let pass=0;pass<20;pass++){
  const result=planTable(document,environment,{selected:null,values:{},fields:[],commands:[],feedback:{cues:[]}},values);
  if(result.kind==='ready')return {document,environment,layout:result.layout,requests};
  if(result.kind!=='needs')throw Error(JSON.stringify(result));
  requests.push(...result.requests);
  for(const request of result.requests){const font=typography(request.role,environment),natural=[...request.text].reduce((sum,char)=>sum+(char===' '?font.fontSize*.28:/[가-힣]/.test(char)?font.fontSize:font.fontSize*.55),0),width=request.width??natural;values.set(request.key,{width:Math.min(width,natural),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*font.lineHeight});}
 }
 throw Error('Actual announcement planner did not converge');
}
function under(layout:CandidateLayout,id:string,ancestor:string){let node=layout.nodes.find(node=>node.id===id);while(node){if(node.id===ancestor)return true;node=node.parent?layout.nodes.find(parent=>parent.id===node!.parent):undefined;}return false;}
it.each([1,2])('production planned public Heart14 uses measured SuitText geometry and announcement text at scale%s',scale=>{
 const {document,environment,layout,requests}=actualAnnouncementLayout(scale);expect(validateLayout(layout)).toEqual([]);
 const valueId=JSON.stringify(['participant-status-value','p1']),paint=layout.nodes.find(node=>node.participantStatusFor==='p1')!,content=layout.nodes.find(node=>node.id===valueId)!,suit=layout.nodes.find(node=>node.parent===valueId&&node.kind==='suit')!,number=layout.nodes.find(node=>node.parent===valueId&&node.kind==='text')!;
 expect(suit).toMatchObject({kind:'suit',suit:'Heart',label:'♥',role:'announcement'});expect(suit.box.width).toBeCloseTo(12*.92*scale,12);expect(suit.box.height).toBeCloseTo(12*.92*scale,12);
 expect(number).toMatchObject({label:'14',role:'announcement'});expect(typography(number.role!,environment)).toEqual({fontSize:12*scale,fontWeight:700,lineHeight:12*1.2*scale});expect(number.box.height).toBe(12*1.2*scale);expect(number.box.width).toBeCloseTo(2*12*.55*scale,12);expect(textFontFamily(number.role!,environment)).toBe('Body Face');
 expect(number.box.x).toBeGreaterThan(suit.box.x+suit.box.width);expect(content.box.x+content.box.width).toBeLessThanOrEqual(paint.box.width);expect(content.box.y+content.box.height).toBeLessThanOrEqual(paint.box.height);
 expect(requests.some(request=>request.text==='14'&&request.role==='announcement'&&request.width===null)).toBe(true);expect(requests.some(request=>request.text===' '&&request.role==='announcement'&&request.width===null)).toBe(true);
 expect(requests.some(request=>request.text==='♥'&&request.role==='announcement')).toBe(false); // Typed artwork is never measured as a Unicode glyph.
 const feedback=layout.nodes.find(node=>node.participantFeedbackFor==='p1')!;expect(under(layout,paint.id,feedback.id)).toBe(true);
 const passive=layout.nodes.filter(node=>under(layout,node.id,paint.id));expect(passive.every(node=>!node.actionId&&!node.fieldId&&!node.cardId&&!node.entityId&&!node.inspectCardId)).toBe(true);
 expect(document.opponents!.find(person=>person.id==='p1')!.status!.purpose).toBe('announcement');
 const passValue=JSON.stringify(['participant-status-value','p2']);expect(layout.nodes.find(node=>node.parent===passValue&&node.kind==='text')).toMatchObject({label:'패스',role:'announcement'});
});
