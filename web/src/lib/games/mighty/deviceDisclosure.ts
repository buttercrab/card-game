import {cloneAssistanceData} from '../../table/foundation/assistance';
import type {DisclosureDocument} from '../../table/foundation/disclosureTypes';
import {ACHIEVEMENTS} from './achievementCatalog';
import {mightyDeviceRecordInformation} from './deviceRecordInformation';
import type {DeviceRead} from './completionStore';
import type {HandRecord} from './stats';
export interface MightyDeviceDisclosureInput {readonly entryId:string;readonly read:DeviceRead;}
function field(value:unknown,key:string):unknown {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid device read');const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!('value'in descriptor))throw Error('Device accessors refused');return descriptor.value;
}
function list(value:unknown):unknown[]{
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)throw Error('Device summary limit');
 const size=Object.getOwnPropertyDescriptor(value,'length');if(!size||!('value'in size)||!Number.isSafeInteger(size.value)||size.value<0||size.value>1000)throw Error('Device summary limit');
 // Array length does not bound arbitrary own keys. Visit only the admitted
 // indices, never enumerate unrelated properties or allocate their descriptors.
 return Array.from({length:size.value as number},(_,i)=>{const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!('value'in d))throw Error('Device accessors refused');return d.value;});
}
function ownRead(input:unknown):DeviceRead {
 const status=field(input,'status');if(status!=='ready'){const message=field(input,'message');if(!['failed','unsupported'].includes(status as string)||typeof message!=='string'||!message||message.length>500)throw Error('Invalid device read');return {status:status as 'failed'|'unsupported',message};}
 const records=field(input,'records');
 const hands=list(field(records,'hands')).map((hand,index)=>{const contract=field(hand,'contract');return cloneAssistanceData({key:`summary:${index}`,at:0,role:field(hand,'role'),won:field(hand,'won'),payoff:field(hand,'payoff'),contract:{trump:field(contract,'trump'),count:field(contract,'count')},teamPoints:field(hand,'teamPoints')});});
 const natural=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
 for(const hand of hands){if(!['declarer','friend','defense'].includes(hand.role as string)||typeof hand.won!=='boolean'||!natural(hand.payoff,-1e9,1e9)||!natural(hand.teamPoints,0,20)||!hand.contract||typeof hand.contract!=='object'||Array.isArray(hand.contract)||Object.keys(hand.contract).length!==2||!('trump'in hand.contract)||!('count'in hand.contract)||!(hand.contract.trump===null||['Spade','Diamond','Heart','Club'].includes(hand.contract.trump as string))||!natural(hand.contract.count,0,255))throw Error('Invalid device summary');}
 const sourceAwards=field(records,'unlocked');if(!sourceAwards||typeof sourceAwards!=='object'||Array.isArray(sourceAwards)||![Object.prototype,null].includes(Object.getPrototypeOf(sourceAwards)))throw Error('Invalid device awards');
 const unlocked:Record<string,number>={};
 // The validated device owner rejects unknown storage fields. Presentation
 // projects only its closed achievement catalog without scanning extra keys.
 for(const item of ACHIEVEMENTS){const descriptor=Object.getOwnPropertyDescriptor(sourceAwards,item.id);if(!descriptor)continue;if(!('value'in descriptor)||!natural(descriptor.value,0,Number.MAX_SAFE_INTEGER))throw Error('Invalid device awards');unlocked[item.id]=descriptor.value as number;}
 // Completion keys, timestamps, replay caches and retained dedup ledger are
 // deliberately not read. Only validated summary meaning enters presentation.
 return {status:'ready',records:{version:1,completed:[],hands:hands as HandRecord[],unlocked:unlocked as Record<string,number>}};
}
/** No storage port or mutation capability is accepted. Delete/retry remains a
 * separately confirmed host operation, never disclosure navigation. */
export function createMightyDeviceDisclosure(input:MightyDeviceDisclosureInput):DisclosureDocument {
 const entryId=field(input,'entryId');if(typeof entryId!=='string'||entryId.length>2048||!entryId.trim())throw Error('Invalid device disclosure identity');
 let read:DeviceRead;try{read=ownRead(field(input,'read'));}catch{read={status:'unsupported',message:'기기 기록을 안전하게 읽을 수 없어요. 원본은 그대로 두었어요.'};}
 const sections=mightyDeviceRecordInformation(read).map(section=>({kind:'content' as const,id:section.id,title:section.title,information:section.information}));
 return cloneAssistanceData({entryId,title:'내 기록',roster:[],cards:[],sections});
}
