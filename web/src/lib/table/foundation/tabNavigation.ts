import type {PlannedNode} from './contracts';
/** Native controls may have measured envelope groups between tab and tablist. */
export function tabNavigationTarget(nodes:readonly PlannedNode[],nodeId:string,key:string):string|null {
 if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(key))return null;
 const registry=new Map(nodes.map(node=>[node.id,node])),current=registry.get(nodeId);
 if(current?.semanticRole!=='tab'||!current.enabled)return null;
 const tablist=(node:PlannedNode):string|null=>{
  let cursor:PlannedNode|undefined=node,remaining=nodes.length;
  while(cursor?.parent&&remaining--){cursor=registry.get(cursor.parent);if(cursor?.semanticRole==='tablist')return cursor.id;}
  return null;
 };
 const owner=tablist(current);if(!owner)return null;
 const peers=nodes.filter(node=>node.semanticRole==='tab'&&node.enabled&&tablist(node)===owner),index=peers.findIndex(node=>node.id===nodeId);
 if(index<0)return null;
 return peers[key==='Home'?0:key==='End'?peers.length-1:(index+(key==='ArrowLeft'||key==='ArrowUp'?-1:1)+peers.length)%peers.length].id;
}
