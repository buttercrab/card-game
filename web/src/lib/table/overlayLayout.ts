import { calculateTableLayout, type SeatCount, type Size } from './layout';
export function leadTagLayout(card: Size, content: Size, compact: boolean, short=false) {
  const height=compact?20:24;
  const width=compact?Math.min(card.width,content.width+11):Math.max(28,content.width+20);
  return {x:(card.width-width)/2,y:short?card.height-height-14:card.height-height+10,width,height,
    contentX:(width-content.width)/2,contentY:(height-content.height)/2,border:compact?1.5:2,iconSize:compact?12:14,gap:compact?1:3};
}
/** A displayed misdeal shares the ring's seats/card scale; cards remain in deal order. */
export function thrownInLayout(viewport:Size,region:Size,count:number,seatCount:SeatCount=5) {
  const arena=calculateTableLayout({viewport,region,seatCount,watching:false});
  const columns=Math.max(1,Math.ceil(count/2));
  const nominal=Math.min(56,Math.max(40,arena.cardWidth*.85));
  const cardWidth=Math.max(0,Math.min(nominal,(Math.max(0,region.width-12))/(1+(columns-1)*.58)));
  const cardHeight=cardWidth*1.4,stride=cardWidth*.58;
  const rowWidth=cardWidth+(columns-1)*stride;
  const width=rowWidth+12,headerHeight=44,gap=4;
  const rows=count?count>columns?2:1:0;
  const height=12+headerHeight+(rows?gap+rows*cardHeight+(rows-1)*gap:0);
  const cards=Array.from({length:count},(_,index)=>{
    const row=Math.floor(index/columns),column=index%columns;
    const rowCount=Math.min(columns,count-row*columns);
    const actualRowWidth=cardWidth+Math.max(0,rowCount-1)*stride;
    return {index,row,column,x:6+(rowWidth-actualRowWidth)/2+column*stride,y:6+headerHeight+gap+row*(cardHeight+gap),width:cardWidth,height:cardHeight,overlapped:column<rowCount-1};
  });
  return {x:(region.width-width)/2,y:arena.seatHeight+2,width,height,cardWidth,cardHeight,
    header:{x:6,y:6,width:rowWidth,height:headerHeight},closeSize:44,nameMax:65,cards};
}
