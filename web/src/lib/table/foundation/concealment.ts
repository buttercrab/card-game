export interface ConcealmentRequest {
    readonly frameId:number;
    readonly nodeIds:readonly string[];
    readonly owner:string;
}
/** Own bounded callback data before the caller captures current authority.
 * Proxy traps can reenter, but no raw array value, getter or iterator is read. */
export function ownConcealment(frameId:unknown,nodeIds:unknown,owner:unknown):ConcealmentRequest|null {
    try {
        if(typeof frameId!=='number'||!Number.isSafeInteger(frameId)||frameId<=0||typeof owner!=='string'||owner.length<1||owner.length>128||owner!==owner.trim()||!Array.isArray(nodeIds))return null;
        // Inspect length before enumerating any caller-controlled keys. In
        // particular a sparse billion-entry array never reaches ownKeys.
        const lengthDescriptor=Object.getOwnPropertyDescriptor(nodeIds,'length');
        if(!lengthDescriptor||!('value' in lengthDescriptor))return null;
        const length:unknown=lengthDescriptor.value;
        if(typeof length!=='number'||!Number.isSafeInteger(length)||length<0||length>64)return null;
        const keys=Reflect.ownKeys(nodeIds);
        if(keys.length!==length+1)return null;
        let hasLength=false;
        const indexes=new Set<number>();
        // Validate the entire exact key set before inspecting member values.
        for(let at=0;at<keys.length;at++){
            const key=keys[at];
            if(typeof key!=='string')return null;
            if(key==='length'){if(hasLength)return null;hasLength=true;continue;}
            if(key.length>2)return null;
            const index=Number(key);
            if(!Number.isSafeInteger(index)||index<0||index>=length||String(index)!==key||indexes.has(index))return null;
            indexes.add(index);
        }
        if(!hasLength||indexes.size!==length)return null;
        const result:string[]=[],seen=new Set<string>();
        for(let index=0;index<length;index++){
            const descriptor=Object.getOwnPropertyDescriptor(nodeIds,String(index));
            if(!descriptor||!('value' in descriptor))return null;
            const value:unknown=descriptor.value;
            if(typeof value!=='string'||value.length<1||value.length>2048||seen.has(value))return null;
            seen.add(value);result.push(value);
        }
        return Object.freeze({frameId,nodeIds:Object.freeze(result),owner});
    }catch{return null;}
}
