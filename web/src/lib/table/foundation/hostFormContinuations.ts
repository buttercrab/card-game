import {copyFormData,type FormSubmission} from './forms';
/** Opaque, mount-private continuation evidence; never stored in the journal. */
export function createHostFormContinuations(makeToken:()=>string=()=>crypto.randomUUID()){
 const records=new Map<string,{token:string;data:unknown}>();
 const key=(submission:FormSubmission)=>JSON.stringify([submission.context.session,submission.context.audience,Object.entries(submission.binding).sort(([a],[b])=>a<b?-1:a>b?1:0),submission.formId,submission.offerInstanceId,submission.policyId,submission.actionId,submission.operationId]);
 return {
  issue(submission:FormSubmission,data:unknown,metadata:Readonly<Record<string,string>>):Readonly<Record<string,string>>{
   if(!submission.formId||!submission.offerInstanceId||!submission.actionId||!submission.operationId)throw new Error('Missing host continuation owner');
   const owned=copyFormData(metadata);if(Object.keys(owned).length>8||Object.hasOwn(owned,'token')||Object.values(owned).some(value=>typeof value!=='string'||value.length>128))throw new Error('Invalid host continuation metadata');
   const slot=key(submission);if(!records.has(slot)&&records.size>=16)throw new Error('Host continuation capacity exceeded');
   const token=makeToken();if(typeof token!=='string'||!token||token.length>128||[...records.values()].some(record=>record.token===token))throw new Error('Invalid host continuation token');
   const privateData=copyFormData(data);records.set(slot,{token,data:privateData});return Object.freeze({...owned,token});
  },
  resolve(submission:FormSubmission,token:string):unknown|null{const record=records.get(key(submission));return record?.token===token?copyFormData(record.data):null;},
  clear(){records.clear();},
  get size(){return records.size;},
 };
}
