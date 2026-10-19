import type {GameTypes,RoomViewOf} from './types';

/** Current presentation and admission have no access to the session archive.
 * A separate bounded history provider resolves a selected historical record. */
export type CurrentRoomViewOf<G extends GameTypes> = Omit<RoomViewOf<G>,'records'|'archives'|'history'|'hands'>;
const fields={
 room_version:true,protocol:true,id:true,game:true,settings:true,rules:true,customized:true,seats:true,in_hand:true,table:true,clock:true,capacity:true,
 watching:true,observers:true,ready:true,participant_ids:true,participation:true,showing:true,
 scores:true,hands_played:true,session_id:true,ended:true,current_hand:true,standings:true,
} as const satisfies Record<keyof CurrentRoomViewOf<GameTypes>,true>;
const keys=Object.keys(fields) as (keyof typeof fields)[];

/** Select BEFORE the framework snapshots nested objects. Never enumerate the
 * source: unrelated archive accessors and their contents are not visited. */
export function selectCurrentRoom<G extends GameTypes>(room:CurrentRoomViewOf<G>|null):CurrentRoomViewOf<G>|null {
 if(!room)return null;
 const current:Record<string,unknown>={};
 for(const key of keys)if(Object.hasOwn(room,key))current[key]=room[key];
 return current as CurrentRoomViewOf<G>;
}
/** Only detached, already snapshotted native JSON may enter this helper.
 * Sharing one snapshot between pure hooks must not permit hook-to-hook edits. */
export function freezePublication<T>(value:T):T {
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  Object.freeze(value);for(const child of Object.values(value))freezePublication(child);
 }
 return value;
}
