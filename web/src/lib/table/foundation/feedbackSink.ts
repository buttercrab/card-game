/** Fixed optional browser effects. Semantic event admission and deduplication belong to the engine. */
import { cancellableSound } from '../../sound';
import { setMood } from '../../music.svelte';
import { settings } from '../../settings.svelte';

import type { FeedbackEvent, FeedbackSink } from './feedback';
export type BrowserFeedbackEvent = FeedbackEvent;
export type BrowserFeedbackSink = FeedbackSink;
let moodOwner:object|null=null,hapticOwner:object|null=null;
const count=(value:number|undefined,fallback=1)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(104,Math.floor(value))):fallback;

export function createBrowserFeedbackSink():BrowserFeedbackSink {
 return {
  emit(event){
   const owner={};let vibrated=false;
   if((event.kind==='turn'||event.kind==='refusal')&&settings.haptics===true&&typeof navigator!=='undefined'&&typeof navigator.vibrate==='function'){
    try{vibrated=navigator.vibrate(event.kind==='refusal'?30:18);if(vibrated)hapticOwner=owner;}catch{/* Haptics are optional. */}
   }
   let stop=()=>{};
   try{stop=cancellableSound(sound=>{
    switch(event.kind){
     case 'shuffle':sound.shuffle();break;
     case 'bid':sound.bid(count(event.amount,0));break;
     case 'card':sound.card(0,count(event.amount,0)>0);break;
     case 'heavy':sound.heavy();break;
     case 'sweep':sound.sweep(0,0);break;
     case 'score':sound.score(count(event.amount));break;
     case 'turn':sound.turn();break;
     case 'clock':sound.clock(event.amount===1);break;
     case 'result':if(typeof event.positive==='boolean')sound.result(event.positive);else sound.resolve();break;
     case 'cue':if(event.cue)sound.cue(event.cue);break;
     case 'call':sound.call();break;
     case 'contract':sound.contract();break;
     case 'run':sound.run();break;
     case 'resolve':sound.resolve();break;
     case 'tag':sound.tag();break;
     case 'friend':sound.friend();break;
     case 'answer':sound.cue('answer');break;
     case 'reaction':sound.react();break;
     case 'error':case 'refusal':sound.error();break;
    }
   });}catch{/* Optional browser audio must not interrupt engine publication. */}
   let cancelled=false;
   return ()=>{if(cancelled)return;cancelled=true;stop();if(vibrated&&hapticOwner===owner){hapticOwner=null;try{navigator.vibrate(0);}catch{/* Optional browser effect. */}}};
  },
  mood(next){
   const owner={};moodOwner=owner;setMood(next);let cancelled=false;
   return ()=>{if(cancelled)return;cancelled=true;if(moodOwner===owner){moodOwner=null;setMood('lobby');}};
  },
 };
}
