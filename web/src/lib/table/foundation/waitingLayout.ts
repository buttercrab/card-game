import {PEER_FIGURE_SIZE,PEER_NAME_ROLE} from './participantPresentation';
import type {CardCollection,FigureAppearance,PlannedNode,TableDocument,TextRole} from './contracts';
import type {RoomShellAction,RoomShellSeat} from './roomShell';
import {roomShellActions} from './roomShell';
export interface WaitingFragment {readonly width:number;readonly height:number;readonly nodes:readonly PlannedNode[];}
export interface WaitingLayoutKit {
 group(id:string,width:number,height:number,children:readonly {fragment:WaitingFragment;x:number;y:number}[],extra?:Partial<PlannedNode>):WaitingFragment;
 column(id:string,width:number,children:readonly WaitingFragment[],gap?:number):WaitingFragment;
 text(id:string,label:string,role:TextRole,width:number):WaitingFragment;
 figure(id:string,label:string,width:number,appearance?:FigureAppearance,ownerId?:string):WaitingFragment;
 action(id:string,action:RoomShellAction,width:number):WaitingFragment;
 stock(id:string,collection:CardCollection,width:32,height:45):WaitingFragment;
 local(width:number):WaitingFragment;
}
const key=(...parts:string[])=>JSON.stringify(parts),GAP=12;
interface WaitingSeat {readonly seat?:number;readonly participantId?:string;readonly name:string;readonly empty:boolean;readonly appearance?:FigureAppearance;readonly setupActionId?:string;readonly setupLabel?:string;}
/** Public seat order is authoritative. Rotate around the local occupied seat;
 * an observer without a seat sees the canonical ascending seat order. */
export function waitingSeats<A>(document:TableDocument<A>):readonly WaitingSeat[]{
 const registry=document.shell?.seats;
 if(registry?.length){const ordered=[...registry].sort((a,b)=>a.seat-b.seat),own=document.participant.role==='observer'?-1:ordered.findIndex(seat=>seat.participantId===document.participant.id),rotated=own>=0?[...ordered.slice(own+1),...ordered.slice(0,own)]:ordered;
  return rotated.map((seat:RoomShellSeat)=>({seat:seat.seat,participantId:seat.participantId,name:seat.kind==='empty'?'빈 자리':seat.name,empty:seat.kind==='empty',appearance:seat.kind==='empty'?{vacant:true}:document.opponents?.find(person=>person.id===seat.participantId)?.appearance??{bot:seat.kind==='bot'},setupActionId:seat.setupActionId,setupLabel:seat.setupLabel}));}
 return (document.opponents??[]).map(person=>({participantId:person.id,name:person.appearance?.vacant?'빈 자리':person.name,empty:!!person.appearance?.vacant,appearance:person.appearance}));
}
/** One measured waiting-stage recipe. No card fan, anonymous hand counts or
 * application-owned coordinates are introduced. Minimum footprints grow the
 * root honestly; only spare available height is distributed between rows. */
export function createWaitingLayout<A>(document:TableDocument<A>,width:number,availableHeight:number,controls:WaitingFragment,tools:WaitingFragment|null,kit:WaitingLayoutKit):WaitingFragment {
 const seats=waitingSeats(document),actions=new Map((document.shell?roomShellActions(document.shell):[]).map(action=>[action.id,action]));
 const tile=(seat:WaitingSeat,allocation:number):WaitingFragment=>{
  const id=seat.participantId?key('opponent',seat.participantId):key('waiting-seat',String(seat.seat)),art=kit.figure(key(id,'figure'),seat.name,PEER_FIGURE_SIZE,seat.appearance,seat.participantId),name=kit.text(key(id,'name'),seat.name,PEER_NAME_ROLE,allocation);
  const label={...name,nodes:name.nodes.map(node=>node.kind==='text'?{...node,textAlign:'center' as const}:node)},portrait=kit.group(key(id,'portrait'),allocation,PEER_FIGURE_SIZE,[{fragment:art,x:(allocation-PEER_FIGURE_SIZE)/2,y:0}]);
  const action=seat.setupActionId?actions.get(seat.setupActionId):undefined,children=[portrait,label,...(action?[kit.action(key('waiting-seat-action',seat.setupActionId!),seat.setupLabel?{...action,label:seat.setupLabel}:action,allocation)]:[])];
  const result=kit.column(id,allocation,children,8);return {...result,nodes:[{...result.nodes[0],semanticRole:'group',label:seat.seat===undefined?seat.name:`${seat.seat+1}번 자리 · ${seat.name}`},...result.nodes.slice(1)]};
 };
 const seatRow=(id:string,items:readonly WaitingSeat[]):WaitingFragment=>{
  if(!items.length)return kit.group(id,width,0,[]);
  const perRow=Math.max(1,Math.floor((width+GAP)/(96+GAP))),lines:WaitingFragment[]=[];
  for(let start=0;start<items.length;start+=perRow){const batch=items.slice(start,start+perRow),cellWidth=(width-GAP*(batch.length-1))/batch.length,tileWidth=Math.min(208,cellWidth),tiles=batch.map(item=>tile(item,tileWidth));lines.push(kit.group(key(id,String(start)),width,Math.max(...tiles.map(tile=>tile.height)),tiles.map((fragment,index)=>({fragment,x:index*(cellWidth+GAP)+(cellWidth-tileWidth)/2,y:0}))));}
  return kit.column(id,width,lines,GAP);
 };
 // Clockwise peers 0/right, 1/upper-right, 2/upper-left, 3/left.
 const observerFive=document.participant.role==='observer'&&seats.length===5;
 const upper=seatRow('waiting-seats-upper',observerFive?[seats[2],seats[1]]:seats.length>2?seats.slice(1,-1).reverse():seats),lower=seatRow('waiting-seats-lower',seats.length>2?[seats[observerFive?3:seats.length-1],seats[0]]:[]),bottom=observerFive?seatRow('waiting-seats-bottom',[seats[4]]):null;
 const stock=document.collections?.find(collection=>collection.purpose==='stock'&&(collection.hiddenCount??0)+collection.cards.length>0),quietStock=stock?kit.group('waiting-stock',width,45,[{fragment:kit.stock(key(key('collection',stock.id),'stock'),stock,32,45),x:(width-32)/2,y:0}]):null;
 const decisions=kit.group('waiting-controls',width,controls.height,[{fragment:controls,x:(width-controls.width)/2,y:0}],{semanticRole:'group',label:'게임 준비'});
 const middle=kit.column('waiting-middle',width,[...(quietStock?[quietStock]:[]),...(controls.height?[decisions]:[])],GAP),local=kit.local(width);
 const toolRow=tools&&tools.height?kit.group('waiting-tools',width,tools.height,[{fragment:tools,x:Math.max(0,width-tools.width),y:0}]):null;
 const blocks=[...(toolRow?[toolRow]:[]),...(upper.height?[upper]:[]),...(middle.height?[middle]:[]),...(lower.height?[lower]:[]),...(bottom?.height?[bottom]:[]),...(local.height?[local]:[])];
 const minimum=blocks.reduce((sum,block)=>sum+block.height,0)+GAP*Math.max(0,blocks.length-1),height=Math.max(minimum,Math.max(0,availableHeight)),spare=Math.max(0,height-minimum),distributed=blocks.length>1?spare/(blocks.length-1):0;
 let y=0;return kit.group('waiting-table',width,height,blocks.map(fragment=>{const placement={fragment,x:0,y};y+=fragment.height+GAP+distributed;return placement;}),{semanticRole:'group',label:'게임 대기 테이블'});
}
