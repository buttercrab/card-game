import {BACK_NAMES,TABLE_NAMES,type CardBack,type TableTone} from './looks';
export type Speed='normal'|'fast'|'off';
export type TextScale=1|1.25|1.5|2;
export interface Settings {
 fourColor:boolean;singleTap:boolean;sound:boolean;music:boolean;musicVolume:number;haptics:boolean;volume:number;
 speed:Speed;textScale:TextScale;hints:boolean;tips:boolean;cardBack:CardBack;tableTone:TableTone;
}
export const DEFAULT_SETTINGS:Readonly<Settings>=Object.freeze({fourColor:true,singleTap:false,sound:true,music:false,musicVolume:0.5,haptics:true,volume:0.7,speed:'normal',textScale:1,hints:true,tips:false,cardBack:'charcoal',tableTone:'hanji'});
/** Browser storage is untrusted. Retain valid known fields, align volumes to the shared 0.1 control step, and default invalid fields. */
export function normalizeSettings(value:unknown):Settings {
 const result={...DEFAULT_SETTINGS};
 if(!value||typeof value!=='object'||Array.isArray(value))return result;
 const descriptors=Object.getOwnPropertyDescriptors(value);
 const own=(key:string):unknown=>{const field=descriptors[key];return field&&'value' in field?field.value:undefined;};
 for(const key of ['fourColor','singleTap','sound','music','haptics','hints','tips'] as const){const candidate=own(key);if(typeof candidate==='boolean')result[key]=candidate;}
 for(const key of ['volume','musicVolume'] as const){const candidate=own(key);if(typeof candidate==='number'&&Number.isFinite(candidate)&&candidate>=0&&candidate<=1)result[key]=Math.round(candidate*10)/10;}
 const speed=own('speed');if(speed==='normal'||speed==='fast'||speed==='off')result.speed=speed;
 const textScale=own('textScale');if(textScale===1||textScale===1.25||textScale===1.5||textScale===2)result.textScale=textScale;
 const back=own('cardBack');if(typeof back==='string'&&Object.hasOwn(BACK_NAMES,back))result.cardBack=back as CardBack;
 const tone=own('tableTone');if(typeof tone==='string'&&Object.hasOwn(TABLE_NAMES,tone))result.tableTone=tone as TableTone;
 return result;
}
