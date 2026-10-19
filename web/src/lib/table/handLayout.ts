/** Numeric fan geometry; callers supply cards and measure their available region. */
export interface HandLayoutInput {
  regionWidth: number;
  viewportWidth: number;
  viewportHeight: number;
  count: number;
}
export interface HandRow {
  /** Half-open indices in the caller's hand. */
  start: number;
  end: number;
  step: number;
}

const minimumHandStep=(cardWidth:number)=>cardWidth===56?cardWidth*.31:Math.max(20,Math.ceil(cardWidth*.31));

export function calculateHandLayout({ regionWidth: width, viewportWidth, viewportHeight, count }: HandLayoutInput) {
  const wide = viewportWidth >= 1024;
  const short = viewportWidth > viewportHeight && viewportHeight <= 520;
  const stepFor = (length: number, cardWidth: number) => length <= 1 || width === 0
    ? cardWidth + 6 : Math.min(cardWidth + 6, (width - cardWidth) / (length - 1));
  let cardWidth: number;
  if (short) cardWidth = 46;
  else if (viewportHeight <= 620 && width < 360) cardWidth = 56;
  else if (wide) cardWidth = Math.round(Math.min(124, Math.max(88, viewportHeight * .12)));
  else {
    const big = Math.round(Math.min(76, Math.max(60, width / 5.2)));
    cardWidth = (width - big) / 9 >= 26 ? big : 60;
  }
  const minStep = minimumHandStep(cardWidth);
  let drawWidth = cardWidth;
  // Fit the actual reserved region, including desktop sidebars and tools.
  // Keep readable cards before considering a second row on any tall profile.
  if (!short && stepFor(count, cardWidth) < minStep) {
    const fit = Math.floor(width / (1 + (count - 1) * .31));
    if (fit >= 56 && fit < cardWidth && stepFor(count, fit) >= fit * .31) drawWidth = fit;
  }
  const need = drawWidth === cardWidth ? minStep : drawWidth * .31;
  const ranges = stepFor(count, drawWidth) >= need
    ? [[0, count]] : [[0, Math.ceil(count / 2)], [Math.ceil(count / 2), count]];
  const rows: HandRow[] = ranges.map(([start, end]) => ({ start, end, step: stepFor(end - start, drawWidth) }));
  return { cardWidth, drawWidth, rowHeight: Math.round(cardWidth * 1.4), rows };
}

/** Existing own-hand interaction/row padding, shared by its measured owners. */
export const HAND_SELECTION_PADDING = 6;
export const HAND_ROW_GAP = 8;
export interface HandRowMetricsInput extends Omit<HandLayoutInput,'count'> {
  selectionLift:number;
  padding:number;
  scrollbarHeight:number;
}
function handMetricsInput(input:HandRowMetricsInput):void {
  if(![input.regionWidth,input.selectionLift,input.padding,input.scrollbarHeight].every(value=>Number.isFinite(value)&&value>=0)||![input.viewportWidth,input.viewportHeight].every(value=>Number.isFinite(value)&&value>0))throw new RangeError('Invalid hand region');
}
/** A real zero-card calculation reserves one row; no pretend hand size enters
 * phase/empty/outcome allocation. Actual fan draw width remains count-dependent. */
export function calculateHandRowMetrics(input:HandRowMetricsInput) {
  handMetricsInput(input);
  const innerWidth=Math.max(0,input.regionWidth-input.padding*2);
  const base=calculateHandLayout({...input,regionWidth:innerWidth,count:0});
  const rowExtent=Math.ceil(Math.max(base.rowHeight,base.cardWidth*1.4)+input.selectionLift);
  return {cardWidth:base.cardWidth,rowHeight:base.rowHeight,minimumStep:minimumHandStep(base.cardWidth),innerWidth,selectionLift:input.selectionLift,padding:input.padding,scrollbarHeight:input.scrollbarHeight,rowExtent,rowGap:HAND_ROW_GAP,oneRowHeight:Math.ceil(rowExtent+input.padding*2+input.scrollbarHeight)};
}
/** Materialization adapter for the same numeric fan. Two canonical readable
 * rows stay two rows. If even those rows cannot expose the original corner
 * index, use an explicit horizontal viewport at the canonical readable stride. */
export function calculateReadableHandLayout(input:HandRowMetricsInput&{count:number}) {
  if(!Number.isSafeInteger(input.count)||input.count<0)throw new RangeError('Invalid hand count');
  const metrics=calculateHandRowMetrics(input),layout=calculateHandLayout({...input,regionWidth:metrics.innerWidth});
  const minimumStep=layout.drawWidth===layout.cardWidth?minimumHandStep(layout.cardWidth):layout.drawWidth*.31;
  const rowWidth=(row:HandRow)=>row.end===row.start?0:layout.drawWidth+Math.max(0,row.end-row.start-1)*row.step;
  const fallback=input.count>0&&layout.rows.some(row=>rowWidth(row)>metrics.innerWidth+1e-9||row.end-row.start>1&&row.step<minimumStep);
  const rows:HandRow[]=fallback?[{start:0,end:input.count,step:input.count<=1?layout.drawWidth+6:minimumStep}]:layout.rows;
  const contentWidth=Math.max(input.regionWidth,...rows.map(row=>rowWidth(row)+input.padding*2));
  const rowPlans=rows.map((row,index)=>({...row,x:input.padding,y:input.padding+index*(metrics.rowExtent+HAND_ROW_GAP),width:contentWidth-input.padding*2,height:metrics.rowExtent,contentWidth:rowWidth(row)}));
  const cards=rowPlans.flatMap((row,rowIndex)=>Array.from({length:row.end-row.start},(_,offset)=>({index:row.start+offset,row:rowIndex,x:row.x+(row.width-row.contentWidth)/2+offset*row.step,y:row.y+input.selectionLift,width:layout.drawWidth,height:layout.drawWidth*1.4})));
  const bodyHeight=input.padding*2+metrics.rowExtent*rows.length+HAND_ROW_GAP*Math.max(0,rows.length-1);
  return {...layout,rows:rowPlans,metrics,minimumStep,cards,contentWidth,bodyHeight,height:Math.ceil(bodyHeight+input.scrollbarHeight),scroll:fallback,kind:fallback?'horizontal-scroll' as const:'canonical' as const};
}
