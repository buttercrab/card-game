/** One cancellable native task for a full measurement batch. No scene or
 * authority is retained here; runtime owns the single outstanding measurement.
 * Both native ports retire before work/failure callbacks can reenter. */
export function queueMeasurementTurn(work:()=>void,failed:()=>void):()=>void{
 let live=true,reported=false,channel:MessageChannel|undefined;
 const close=()=>{
  let clean=true;
  try{if(channel)channel.port1.onmessage=null;}catch{clean=false;}
  try{channel?.port1.close();}catch{clean=false;}
  try{channel?.port2.close();}catch{clean=false;}
  return clean;
 };
 const failure=()=>{if(reported)return;reported=true;try{failed();}catch{/* The retired task cannot be revived by a consumer failure. */}};
 const cancel=()=>{if(!live)return;live=false;if(!close())failure();};
 try{
  channel=new MessageChannel();
  channel.port1.onmessage=()=>{
   if(!live)return;live=false;
   if(!close()){failure();return;}
   try{work();}catch{failure();}
  };
  channel.port2.postMessage(null);
 }catch{if(live){live=false;close();failure();}}
 return cancel;
}
