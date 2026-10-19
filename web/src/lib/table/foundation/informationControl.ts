import type {PlannedNode} from './contracts';
/** Exact readonly descendants for the existing local information opener.
 * No scene identity, scroll focus island or capability is admitted here. */
export function readonlyInformationContent(nodes:readonly PlannedNode[],rootId:string):boolean{
 const byId=new Map(nodes.map(node=>[node.id,node])),children=new Map<string,PlannedNode[]>();for(const node of nodes)if(node.parent){const row=children.get(node.parent)??[];row.push(node);children.set(node.parent,row);}
 const root=byId.get(rootId);if(!root)return false;const queue=[root],seen=new Set<string>(),keys=new Set(['id','parent','kind','label','box','role','suit','semanticRole','arrangement','textAlign','progressPaint','tone','decoration']);
 for(let i=0;i<queue.length;i++){const node=queue[i];if(seen.has(node.id)||!['group','text','suit','progress'].includes(node.kind)||Object.keys(node).some(key=>!keys.has(key)&&node[key as keyof PlannedNode]!==undefined))return false;seen.add(node.id);queue.push(...children.get(node.id)??[]);}
 return true;
}
