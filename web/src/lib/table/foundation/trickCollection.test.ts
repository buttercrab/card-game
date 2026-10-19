import {expect,test} from 'vitest';
import {createCardSession} from './session';
import {flowDocument,initialFlow} from './flowFixture';
import type {TableCard} from './contracts';
const card:TableCard={id:'public-card',label:'Public',visual:{kind:'standard',suit:'Spade',rank:2},ownerId:'peer'};
test('session validates public provenance and owns immutable trick semantics',()=>{
 const session=createCardSession({transport:()=>{}}),base=flowDocument(initialFlow(),1,true);
 const doc={...base,opponents:[{id:'peer',name:'Peer',handCount:9}],collections:[{id:'trick',label:'Trick',purpose:'play' as const,kind:'trick' as const,cards:[{...card}]}]};
 session.receive(doc);doc.collections[0].cards[0].ownerId='mutated';expect(session.snapshot().document!.collections![0].cards[0].ownerId).toBe('peer');
 for(const cards of [[{...card,ownerId:'unknown'}],[{...card,ownerId:undefined}],[card,{...card,id:'duplicate-owner'}]])expect(()=>session.receive({...doc,collections:[{...doc.collections[0],cards}]})).toThrow();
 expect(()=>session.receive({...base,opponents:doc.opponents,hand:[card]})).toThrow('Invalid private card owner');
 expect(()=>session.receive({...base,participant:{...base.participant,role:'observer'},opponents:doc.opponents,collections:[{...doc.collections[0],cards:[{...card,ownerId:base.participant.id}]}]})).toThrow('Unknown public card owner');session.dispose();
});

test('reveal source and public owner must agree; deck kind requires count-only stock',()=>{
 const session=createCardSession({transport:()=>{}}),base=flowDocument(initialFlow(),1,true);
 const doc={...base,opponents:[{id:'peer',name:'Peer',handCount:9},{id:'other',name:'Other',handCount:10}],collections:[{id:'trick',label:'Trick',purpose:'play' as const,kind:'trick' as const,cards:[card]}]};
 expect(()=>session.receive({...doc,reveals:[{participantId:'other',cardId:card.id}]})).toThrow('Reveal owner mismatch');
 session.receive({...doc,reveals:[{participantId:'peer',cardId:card.id}]});
 expect(()=>session.receive({...doc,collections:[{...doc.collections[0],kind:'deck'}]})).toThrow('Invalid collection kind');session.dispose();
});
