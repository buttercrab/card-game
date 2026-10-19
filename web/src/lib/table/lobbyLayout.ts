import { calculateTableLayout, type SeatCount, type Size } from './layout';
/** Between-hand controls share the arena's numeric anchors and leaf budgets. */
export function lobbyLayout(viewport: Size, region: Size, seatCount: SeatCount, contentHeight: number, seatWidth?: number, seated=true) {
  const arena=calculateTableLayout({viewport,region,seatCount,watching:false});
  const short=viewport.width>viewport.height&&viewport.height<=520;
  const centerWidth=Math.max(150,region.width-2*(seatWidth??arena.seatWidth)-8);
  const goWidth=short?96:Math.min(136,Math.max(96,centerWidth));
  const toolsWidth=short?104:goWidth;
  const width=short&&seated?goWidth+8+toolsWidth:Math.min(280,centerWidth);
  const centerX=short&&seated?arena.rowCenterX:region.width/2;
  const centerY=short&&seated?region.height/2:arena.centerY;
  return { x:centerX-width/2,y:centerY-contentHeight/2,width,
    short,direction:short&&seated?'row' as const:'column' as const,gap:short?8:10,
    goWidth,goHeight:short?44:52,goFont:short?16:18,toolsWidth,toolWidth:(toolsWidth-8)/2,toolHeight:short?44:region.width<=360?52:56,
    noteWidth:Math.max(0,Math.min(220,region.width-2*(seatWidth??arena.seatWidth)-8)),noteY:contentHeight+8 };
}
