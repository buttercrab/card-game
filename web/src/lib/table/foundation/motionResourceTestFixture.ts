/** Test-fixture construction only. Production never authorizes resources from
 * painted nodes; hand-built unit scenes explicitly provide their parallel facts. */
import type {PlannedNode,PresentationFrame,CardCollection} from './contracts';
import {publicPaintResources} from './paintResources';
export function motionFixtureResources(nodes:readonly PlannedNode[],roster:readonly string[]=[]):PresentationFrame['paintResources']{
 const ids=[...new Set([...roster,...nodes.flatMap(node=>[node.ownerId,node.recipientId,node.ownHandAnchor?.participantId,node.collectedBy]).filter((id):id is string=>typeof id==='string'&&id.length>0)])];if(!ids.length)ids.push('me');
 const collections=new Map<string,CardCollection>();
 for(const node of nodes){if(!node.zoneId||node.zoneId==='hand'||node.publicDisclosureEventId)continue;
  let collection=collections.get(node.zoneId);if(!collection){collection={id:node.zoneId,label:node.zoneId,purpose:node.stockCount!==undefined?'stock':node.trickSlot?'play':node.collectionPurpose,cards:[],...(nodes.some(candidate=>candidate.trickSlot&&candidate.zoneId===node.zoneId)?{kind:'trick' as const}:{})};collections.set(node.zoneId,collection);}
  if(node.stockCount!==undefined)collections.set(node.zoneId,{...collection,purpose:'stock',hiddenCount:node.stockCount});
  else if(node.collectedBy)collections.set(node.zoneId,{...collection,collectedBy:node.collectedBy});
  else if(node.kind==='card'&&node.entityId&&node.visual&&node.visual.kind!=='back')collections.set(node.zoneId,{...collection,cards:[...collection.cards,{id:node.entityId,label:node.label,visual:node.visual,ownerId:node.ownerId,emphasis:node.emphasis}]});
 }
 return publicPaintResources({participant:{id:ids[0],name:ids[0],markers:[]},opponents:ids.slice(1).map(id=>({id,name:id,handCount:0})),collections:[...collections.values()]});
}
