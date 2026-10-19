export type RecordedOrigin = {readonly status:'known';readonly sessionId:number}|{readonly status:'legacy'|'invalid'};
/** A retained result can precede the live score period. Its origin must be a
 * producer-stamped own value. Missing legacy metadata never proves lineage. */
export function recordedOrigin(record:unknown,currentSessionId:number):RecordedOrigin {
 if(!Number.isSafeInteger(currentSessionId)||currentSessionId<0||!record||typeof record!=='object'||Array.isArray(record))return {status:'invalid'};
 const marker=Object.getOwnPropertyDescriptor(record,'session_id');
 if(!marker)return {status:'legacy'};
 if(!('value'in marker)||!Number.isSafeInteger(marker.value)||marker.value<0||marker.value>currentSessionId)return {status:'invalid'};
 return {status:'known',sessionId:marker.value};
}
