import {expect,it} from 'vitest';
import {paintNativeCardAccessibility} from './nativeCardAccessibility';
import type {PlannedNode} from './contracts';
const card:PlannedNode={id:'card',parent:'hand',kind:'card',label:'Joker',cardId:'joker',entityId:'joker',zoneId:'hand',enabled:true,hasPopup:'dialog',popupExpanded:false,checked:false,box:{x:0,y:0,width:88,height:124}};
const dialog={id:'foundation-card-action-dialog'};
const paint=(element:Parameters<typeof paintNativeCardAccessibility>[0],node:PlannedNode,modalId:string|undefined)=>paintNativeCardAccessibility(element,node,modalId,modalId==='card-action-dialog'?dialog.id:undefined);
function element(){const values=new Map<string,string>();return {values,setAttribute(key:string,value:string){values.set(key,value);},removeAttribute(key:string){values.delete(key);}};}
it('paints native pressed state and only the current actual card-action picker as expanded',()=>{
 const native=element();paint(native,card,undefined);expect(Object.fromEntries(native.values)).toEqual({'aria-pressed':'false','aria-haspopup':'dialog','aria-expanded':'false'});
 paint(native,{...card,checked:true},'settings');expect(native.values.get('aria-expanded')).toBe('false');
 paint(native,{...card,checked:true},'card-action-dialog');expect(native.values.get('aria-expanded')).toBe('false');
 paint(native,{...card,checked:true,popupExpanded:true},'card-action-dialog');expect(native.values.get('aria-expanded')).toBe('true');expect(native.values.get('aria-controls')).toBe(dialog.id);
 paint(native,{...card,checked:true,popupExpanded:true},'settings');expect(native.values.get('aria-expanded')).toBe('false');expect(native.values.has('aria-controls')).toBe(false);
});
it('clears stale popup and pressed metadata when a card becomes ordinary or inspection-only',()=>{
 const native=element();paint(native,{...card,checked:true,popupExpanded:true},'card-action-dialog');
 paint(native,{...card,hasPopup:undefined,popupExpanded:undefined},undefined);expect(Object.fromEntries(native.values)).toEqual({'aria-pressed':'false'});
 paint(native,{...card,checked:true,popupExpanded:true},'card-action-dialog');paint(native,{...card,cardId:undefined,inspectCardId:'joker'},undefined);expect(Object.fromEntries(native.values)).toEqual({'aria-description':'낼 수 없는 이유 보기'});
});

it('paints the current activation description and preserves separate illegal-card inspection meaning',()=>{
 const native=element();paint(native,{...card,accessibleDescription:'한 번 누르면 선택하고, 한 번 더 누르면 카드 내기 선택을 열어요'},undefined);expect(native.values.get('aria-description')).toBe('한 번 누르면 선택하고, 한 번 더 누르면 카드 내기 선택을 열어요');
 paint(native,{...card,checked:true,accessibleDescription:'한 번 더 누르면 카드 내기 선택을 열어요'},undefined);expect(native.values.get('aria-description')).toBe('한 번 더 누르면 카드 내기 선택을 열어요');
 paint(native,{...card,cardId:undefined,inspectCardId:'joker',accessibleDescription:'must not promise play'},undefined);expect(native.values.get('aria-description')).toBe('낼 수 없는 이유 보기');expect(native.values.has('aria-haspopup')).toBe(false);expect(native.values.has('aria-pressed')).toBe(false);
 paint(native,{...card,hasPopup:undefined,popupExpanded:undefined,accessibleDescription:undefined},undefined);expect(native.values.has('aria-description')).toBe(false);
});

it('requires the actual resolved dialog IDREF and clears a prior reference when it is unavailable',()=>{
 const native=element(),open={...card,checked:true,popupExpanded:true};
 paintNativeCardAccessibility(native,open,'card-action-dialog',dialog.id);expect(native.values.get('aria-controls')).toBe(dialog.id);expect(native.values.get('aria-controls')).not.toBe('card-action-dialog');
 paintNativeCardAccessibility(native,open,'card-action-dialog',undefined);expect(native.values.get('aria-expanded')).toBe('false');expect(native.values.has('aria-controls')).toBe(false);
});
