import {expect,type Page} from '@playwright/test';
import type {CommandWindow} from '../src/lib/generated/protocol';
import type {RoomMsgOf,SessionMsgOf} from '../src/lib/room/types';
import type {Mighty,RoomView} from '../src/lib/games/mighty/types';
import {mightyCompletionCandidate} from '../src/lib/games/mighty/completion';
import {createMightyCompletionHost} from '../src/lib/games/mighty/completionHost';
import {COMPLETION_STORAGE_KEY} from '../src/lib/games/mighty/completionStore';
/** Audit pure completion ownership with actual server-public record packets.
 * This is not a claim that connected host persistence is already wired. */
export function watchMightyCompletion(page:Page) {
 let room:RoomMsgOf<Mighty>|null=null,session:SessionMsgOf<Mighty>|null=null,window:CommandWindow|null=null;
 page.on('websocket',socket=>socket.on('framereceived',frame=>{
  let value:Record<string,unknown>;try{value=JSON.parse(String(frame.payload));}catch{return;}
  if(value.type==='room')room=value as unknown as RoomMsgOf<Mighty>;
  if(value.type==='session')session=value as unknown as SessionMsgOf<Mighty>;
  if(value.type==='room_command_window')window=value.command as CommandWindow;
 }));
 const audit=()=>{
  expect(!!room&&!!session&&!!window).toBe(true);if(!room||!session||!window)throw Error('Missing actual completed record authority');
  const snapshot={...room,...session} as RoomView,input={room:snapshot,scope:window.scope,actorId:window.scope.actor_id,seat:window.scope.seat,keepsRecord:true};
  const candidate=mightyCompletionCandidate(input,123);expect(candidate.status).toBe('eligible');if(candidate.status!=='eligible')throw Error('Actual public result was not completion-eligible');
  const data=new Map<string,string>();let writes=0;const owner=createMightyCompletionHost({getItem:key=>data.get(key)??null,setItem:(key,value)=>{writes++;data.set(key,value);}});
  const stored=owner.observe(input,123)!;expect(stored.status).toBe('stored');expect(owner.observe(input,124)).toBe(stored);expect(writes).toBe(1);
  const raw=data.get(COMPLETION_STORAGE_KEY)!;expect(raw).not.toContain('Normal');expect(raw).not.toContain('discards');expect(raw).not.toContain('tricks');
  expect(owner.observe({...input,seat:null},125)).toBeNull();expect(owner.observe({...input,actorId:'replacement'},125)).toBeNull();owner.dispose();
  const {at:unusedAt,...summary}=candidate.hand;
  return {key:candidate.hand.key,status:stored.status,summary,unlockedIds:Object.keys(JSON.parse(raw).unlocked).sort(),earnedTitles:stored.earnedTitles};
 };
 return Object.assign(audit,{checkpoint:()=>({roomVersion:room?.room_version??null,sessionVersion:session?.room_version??null,scopeVersion:window?.scope.version??null,sessionId:session?.session_id??null,scopeSessionId:window?.scope.session_id??null,currentHand:session?.current_hand?.number??null,handsPlayed:session?.hands_played??null,inHand:room?.in_hand??null,showing:room?.showing??null})});
}
