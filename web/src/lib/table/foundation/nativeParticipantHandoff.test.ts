import {afterEach,expect,test,vi} from 'vitest';
import {setup,issuer,Native} from './completionReceiveFixture';
import {nativeParticipantHandoff,currentNativeParticipantHandoff} from './nativeParticipantHandoff';
import {participantHandoff} from './participantHandoff';
import {completionReceiveNativeProof,readyCompletionReceiveReservation} from './completionReceive';
import {retirePublicCompletionGrant} from './publicCompletion';
import {flightPath} from './transferMotion';
import {paperRect} from './paperEndpoints';
import {createDomTransfers} from './domTransfers';
const ready=(f:ReturnType<typeof setup>)=>{const proof=completionReceiveNativeProof(f.current,f.dom.host,f.dom.elements,f.dom.content)!;expect(proof).not.toBeNull();expect(issuer.acknowledge(f.current,proof,f.next)).toBe(true);return proof;};
afterEach(()=>vi.unstubAllGlobals());
test.each([false,true])('real public capture→default planner→materialize needs exact native Ready before terminal papers quantized=%s',quantized=>{
 const f=setup({x:13,y:17},quantized);expect(participantHandoff(f.current,'identity-figure',f.dom.host,f.dom.elements,f.dom.content)).toBeNull();expect(nativeParticipantHandoff(f.current,'identity-figure',f.dom.host,f.dom.elements,f.dom.content)).toBeNull();
 ready(f);const handoff=nativeParticipantHandoff(f.current,'identity-figure',f.dom.host,f.dom.elements,f.dom.content)!;expect(handoff.kind).toBe('completion-own-hand');expect(handoff.participantId).toBe('me');expect(handoff.regionBounds).toEqual({...f.current.completionReceiveReservation!.bounds,x:f.current.completionReceiveReservation!.bounds.x+13,y:f.current.completionReceiveReservation!.bounds.y+17});expect(handoff.bounds).toEqual(f.dom.raw.get('identity-figure')!.bounds);expect(handoff.regionBounds).not.toEqual(handoff.bounds);expect(currentNativeParticipantHandoff(handoff,f.current,f.dom.host,f.dom.elements,f.dom.content)).toBe(true);expect(f.current.nodes.some(n=>n.id==='hand'||n.id==='hand-fan'||n.entityId)).toBe(false);
 expect(currentNativeParticipantHandoff({...handoff},f.current,f.dom.host,f.dom.elements,f.dom.content)).toBe(false);retirePublicCompletionGrant(f.view.event);expect(currentNativeParticipantHandoff(handoff,f.current,f.dom.host,f.dom.elements,f.dom.content)).toBe(false);
});
test('a compatible publication must acquire its own current Ready; an old native receipt cannot grant renewal',()=>{
 const f=setup();ready(f);const old=nativeParticipantHandoff(f.current,'own-hand-count-anchor',f.dom.host,f.dom.elements,f.dom.content)!;
 const next=issuer.materialize({...f.current,id:3,completionReceiveReservation:undefined});for(const element of f.dom.raw.values())element.dataset.foundationFrame='3';expect(readyCompletionReceiveReservation(next)).toBeNull();expect(currentNativeParticipantHandoff(old,next,f.dom.host,f.dom.elements,f.dom.content)).toBe(false);
 const proof=completionReceiveNativeProof(next,f.dom.host,f.dom.elements,f.dom.content)!;expect(issuer.acknowledge(next,proof,f.next)).toBe(true);expect(currentNativeParticipantHandoff(old,next,f.dom.host,f.dom.elements,f.dom.content)).toBe(true);
});
test.each(['figure','content','root-parent','stamp','viewport','wrong-owner'] as const)('current ready terminal handoff refuses %s changes',mode=>{
 const f=setup();ready(f);const p=nativeParticipantHandoff(f.current,'identity-figure',f.dom.host,f.dom.elements,f.dom.content)!;let content=f.dom.content;
 if(mode==='figure'){const figure=f.dom.raw.get('identity-figure')!;figure.bounds={...figure.bounds,x:figure.bounds.x+1};}
 if(mode==='content')content=new Native() as unknown as HTMLElement;
 if(mode==='root-parent')f.dom.raw.get('table')!.parentElement=f.dom.raw.get('table-underlay')!;
 if(mode==='stamp')f.dom.raw.get('identity-portrait')!.dataset.foundationFrame='old';
 if(mode==='viewport')vi.stubGlobal('innerHeight',799);
 if(mode==='wrong-owner'){const altered={...f.current,nodes:f.current.nodes.map(n=>n.ownHandAnchor?{...n,ownHandAnchor:{participantId:'other',count:0}}:n)};expect(nativeParticipantHandoff(altered,'identity-figure',f.dom.host,f.dom.elements,content)).toBeNull();return;}
 expect(currentNativeParticipantHandoff(p,f.current,f.dom.host,f.dom.elements,content)).toBe(false);
});

test('real current terminal frame admits all five sweep papers in its owned receive reservation with every figure guarded',()=>{const f=setup();ready(f);vi.stubGlobal('document',{});const port=createDomTransfers(f.dom.host,()=>{},undefined,()=>{},{content:()=>f.dom.content,current:()=>f.current}),sources=f.current.nodes.filter(n=>n.trickSlot).map(n=>paperRect(f.dom.raw.get(n.id)!.bounds)),papers=port.participantPapers(f.current,'identity-figure',f.dom.elements,{x:0,y:0,width:64,height:90},new Set(['identity-figure']),.4,.4,sources)!,geometry=port.geometry(f.current,f.dom.elements,new Set(['identity-figure']))!;expect(papers.handoff.kind).toBe('completion-own-hand');expect(papers.candidates.length).toBeGreaterThan(0);const figure=f.dom.raw.get('identity-figure')!.bounds;expect(geometry.protectedRects.some(r=>r.x===figure.x-6&&r.y===figure.y-6)).toBe(true);expect(papers.candidates.every(p=>p.width===25.6&&sources.every(from=>!!flightPath(from,p,geometry.clip,geometry.protectedRects)))).toBe(true);expect(f.current.nodes.some(n=>n.id==='hand'||n.id==='hand-fan')).toBe(false);});
