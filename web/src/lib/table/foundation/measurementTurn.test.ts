import {afterEach,expect,test,vi} from 'vitest';
import {queueMeasurementTurn} from './measurementTurn';
function fixture(fault?:'construct'|'post'|'close1'|'close2'){
 const channels:FakeChannel[]=[];
 class FakeChannel{
  saved:(()=>void)|null=null;
  port1={onmessage:null as (()=>void)|null,close:vi.fn(()=>{if(fault==='close1')throw Error('close1');})};
  port2={close:vi.fn(()=>{if(fault==='close2')throw Error('close2');}),postMessage:vi.fn(()=>{this.saved=this.port1.onmessage;if(fault==='post')throw Error('post');})};
  constructor(){if(fault==='construct')throw Error('construct');channels.push(this);}
 }
 vi.stubGlobal('MessageChannel',FakeChannel);
 return {channels};
}
afterEach(()=>vi.unstubAllGlobals());
test('one full round runs in its native task and closes both ports before work',()=>{
 const f=fixture(),failed=vi.fn(),work=vi.fn(()=>{expect(f.channels[0].port1.onmessage).toBeNull();expect(f.channels[0].port1.close).toHaveBeenCalledOnce();expect(f.channels[0].port2.close).toHaveBeenCalledOnce();});
 const cancel=queueMeasurementTurn(work,failed);expect(work).not.toHaveBeenCalled();expect(f.channels).toHaveLength(1);f.channels[0].saved!();f.channels[0].saved!();cancel();expect(work).toHaveBeenCalledOnce();expect(failed).not.toHaveBeenCalled();
});
test('cancellation before delivery prevents even a captured stale task from creating probes or replying',()=>{
 const f=fixture(),createProbe=vi.fn(),reply=vi.fn(),failed=vi.fn(),cancel=queueMeasurementTurn(()=>{createProbe();reply();},failed);
 cancel();cancel();f.channels[0].saved!();expect(createProbe).not.toHaveBeenCalled();expect(reply).not.toHaveBeenCalled();expect(failed).not.toHaveBeenCalled();for(const port of [f.channels[0].port1,f.channels[0].port2])expect(port.close).toHaveBeenCalledOnce();
});
test.each(['construct','post','close1','close2'] as const)('%s failure retires task and fails without running a round',fault=>{
 const f=fixture(fault),work=vi.fn(),failed=vi.fn(),cancel=queueMeasurementTurn(work,failed);f.channels[0]?.saved?.();cancel();expect(work).not.toHaveBeenCalled();expect(failed).toHaveBeenCalledOnce();if(f.channels.length)expect(f.channels[0].port2.close).toHaveBeenCalledOnce();
});
test('cancel with a throwing close still closes the other port and rejects once',()=>{
 const f=fixture('close1'),failed=vi.fn(),work=vi.fn(),cancel=queueMeasurementTurn(work,failed);cancel();cancel();f.channels[0].saved!();expect(work).not.toHaveBeenCalled();expect(failed).toHaveBeenCalledOnce();expect(f.channels[0].port2.close).toHaveBeenCalledOnce();
});
test('reentrant work can queue a replacement and old release cannot retire it',()=>{
 const f=fixture(),later=vi.fn(),failed=vi.fn();let releaseLater=()=>{};const releaseFirst=queueMeasurementTurn(()=>{releaseLater=queueMeasurementTurn(later,failed);},failed);
 f.channels[0].saved!();releaseFirst();expect(later).not.toHaveBeenCalled();f.channels[1].saved!();releaseLater();expect(later).toHaveBeenCalledOnce();expect(failed).not.toHaveBeenCalled();
});
test('a thrown round or failure callback cannot restore a retired task or escape',()=>{
 const f=fixture(),failed=vi.fn(()=>{throw Error('failure consumer');});queueMeasurementTurn(()=>{throw Error('round');},failed);expect(()=>f.channels[0].saved!()).not.toThrow();f.channels[0].saved!();expect(failed).toHaveBeenCalledOnce();
});
