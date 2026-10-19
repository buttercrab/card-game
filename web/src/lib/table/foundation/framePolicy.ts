import { calculateSeatIdentity } from './participantPolicy';
import { dockIdentityRow } from './dockPolicy';

/** Shared playing-screen policy. All coordinates are relative to the frame's
 * padding box; native content measurement is an input, never a layout owner. */
export interface FrameBox { x: number; y: number; width: number; height: number; visible: boolean }
export type FrameRegion = 'status' | 'event' | 'felt' | 'strip' | 'tray' | 'side' | 'tools' | 'result' | 'social' | 'feedback';
export interface FrameInput {
  viewport: { width: number; height: number };
  region: { width: number; height: number };
  controlsHeight?: number;
  controls?: boolean;
  between?: boolean;
  completed?: boolean;
  tools?: { width: number; height: number };
  resultHeight?: number;
  social?: { width: number; height: number };
}
export interface FrameLayout {
  mode: 'stacked' | 'sidebar' | 'short';
  regions: Record<FrameRegion, FrameBox>;
  dockHeight: number;
  statusHeight: number;
  eventHeight: number;
  stripHeight: number;
  decisionCap: number | null;
  statusPaddingEnd: number;
  stripPaddingTop: number;
  socialCap: number;
  toolsRoom: number;
  seatTop: number;
  resultDock: boolean;
  toolsLayer: 'ordinary' | 'status' | 'result' | 'dock';
}
const box = (x: number, y: number, width: number, height: number, visible = true): FrameBox => ({x,y,width:Math.max(0,width),height:Math.max(0,height),visible});
export function resultUsesDock({width, height}: {width: number; height: number}): boolean {
  return width <= 360 || (width < 600 && height >= width && height <= 700);
}
/** Shared sideways-screen column policy, independent of phase or height. */
export function shortDecisionColumn(frameWidth:number) {
  const width=Math.max(240,Math.max(0,frameWidth)*.36);
  const feltWidth=Math.max(0,frameWidth-width-8);
  const x=feltWidth+8;
  return {x,width,feltWidth,centerX:x+width/2};
}
/** Native measurements supplied by an engine compositor, never a game DTO.
 * Absent inputs preserve the retained original frame policy exactly. */
export interface MeasuredFrameInput {
  readonly statusHeight?:number;
  readonly eventHeight?:number;
  readonly mainWidth?:number;
  readonly dockHeight?:number;
}
export function calculateFrameLayout(input: FrameInput): FrameLayout {return calculateMeasuredFrameLayout(input);}
export function calculateMeasuredFrameLayout(input:FrameInput,measured:MeasuredFrameInput={}):FrameLayout {
  if(Object.values(measured).some(value=>!Number.isFinite(value)||value!<0)||measured.mainWidth!==undefined&&measured.mainWidth>input.region.width)throw Error('Invalid measured frame inputs');
  const {width:vw,height:vh} = input.viewport;
  const {width:w,height:h} = input.region;
  const short = vw > vh && vh <= 520;
  const sidebar = vw >= 1100 && vw > vh && vh >= 600;
  const desktop = vw >= 1024 && vh >= 640;
  const smallPortrait = vw < 600 && vh <= 620 && vh >= vw;
  const statusHeight = measured.statusHeight??(short || smallPortrait ? 36 : vw >= 600 ? 34 : 48);
  const eventHeight = measured.eventHeight??(sidebar ? 0 : smallPortrait ? 12 : 18);
  const identityHeight = calculateSeatIdentity({viewport:input.viewport,region:input.region,width:Math.max(0,w-16),local:true}).height;
  const identityExtra = dockIdentityRow(input.viewport,identityHeight)-dockIdentityRow(input.viewport);
  const originalDockHeight = (short ? 84 : desktop ? Math.min(124,Math.max(88,vh*.12))*1.4+36 : vw >= 600 ? 196 : smallPortrait ? 162 : 174) + identityExtra;
  const dockHeight=Math.max(originalDockHeight,measured.dockHeight??0);
  const stripHeight = 16;
  const sideWidth = sidebar ? Math.min(300,Math.max(260,vw*.21)) : 0;
  const mainWidth = measured.mainWidth??(sidebar ? Math.max(0,w-sideWidth-16) : w);
  const shortColumn=shortDecisionColumn(w);
  const landscapeStripWidth = short ? shortColumn.width : 0;
  const feltTop = short ? statusHeight+4 : sidebar ? eventHeight+4 : statusHeight+eventHeight+8;
  const feltHeight = Math.max(0,short ? h-statusHeight-dockHeight-8 : sidebar ? h-eventHeight-stripHeight-dockHeight-12 : h-statusHeight-eventHeight-stripHeight-dockHeight-16);
  const felt = box(0,feltTop,short ? shortColumn.feltWidth : mainWidth,feltHeight);
  const strip = short ? box(shortColumn.x,feltTop,landscapeStripWidth,feltHeight) : box(0,feltTop+feltHeight+4,mainWidth,stripHeight);
  const tray = box(0,h-dockHeight,short?w:mainWidth,dockHeight);
  // Keep command shadows separate from the tray rim.
  if(input.controls&&!short)strip.y-=8;
  const resultDock = resultUsesDock(input.viewport);
  const tools = input.tools ?? {width:0,height:0};
  const controlsHeight = input.controls ? input.controlsHeight ?? 0 : 0;
  const crowded = controlsHeight > 130;
  let toolsX = felt.width-tools.width-4;
  let toolsY = felt.y+felt.height-tools.height-4-Math.max(0,controlsHeight-stripHeight-4);
  let toolsVisible = !crowded;
  let toolsLayer: FrameLayout['toolsLayer'] = 'ordinary';
  let statusPaddingEnd = 0;
  if (vw < 600 && (input.controls || input.between)) {
    toolsX = w-tools.width; toolsY=(statusHeight-tools.height)/2;toolsVisible=true;toolsLayer='status';statusPaddingEnd=tools.width+4;
  }
  if (input.completed) {
    toolsX=vw>=600?16:12;toolsY=tray.y+tray.height-tools.height-(vw>=600?14:10);toolsLayer='result';
  }
  if (desktop) {
    toolsX=tray.width-tools.width-10;toolsY=tray.y+(tray.height-tools.height)/2+2;toolsVisible=true;toolsLayer='dock';
  }
  if (short) {
    toolsX=w-tools.width;toolsY=(statusHeight-tools.height)/2;toolsVisible=true;toolsLayer='status';statusPaddingEnd=tools.width+4;
  }
  if (vw>=600 && vh>=521 && input.between) {
    toolsX=felt.width-tools.width;toolsY=felt.y;
  }
  if (input.completed && vw<600 && vh>=vw) {
    toolsX=w-tools.width;toolsY=(statusHeight-tools.height)/2;toolsLayer='status';statusPaddingEnd=tools.width+4;
  }
  const resultHeight=input.resultHeight??0;
  const resultBase=short?strip:resultDock?tray:felt;
  const resultWidth=short?resultBase.width:vw<600?Math.max(0,resultBase.width-24):Math.min(400,Math.max(0,resultBase.width-16));
  const resultX=resultBase.x+(resultBase.width-resultWidth)/2;
  const resultY=short?resultBase.y+resultBase.height-resultHeight:resultDock?tray.y+44:felt.y+felt.height-resultHeight-(vw>=361&&vw<600&&vh>=vw?-6:12);
  const social=input.social??{width:0,height:0};
  return {
    mode:short?'short':sidebar?'sidebar':'stacked',dockHeight,statusHeight,eventHeight,stripHeight,
    decisionCap:short?null:desktop||vh>=700?160:128,statusPaddingEnd,stripPaddingTop:short&&!input.between&&!input.controls?56:0,
    socialCap:Math.max(0,dockHeight-32),toolsRoom:desktop||short?0:52,seatTop:desktop?112:vw>=600?116:0,resultDock,toolsLayer,
    regions:{status:box(0,0,w,statusHeight,!sidebar),event:box(0,sidebar?0:statusHeight+4,mainWidth,eventHeight,!short),felt,strip,tray,
      side:box(mainWidth+16,0,sideWidth,h,sidebar),tools:box(toolsX,toolsY,tools.width,tools.height,toolsVisible),
      result:box(resultX,resultY,resultWidth,resultHeight),social:box(tray.x+(tray.width-social.width)/2,tray.y+(tray.height-social.height)/2,social.width,social.height),
      feedback:short?box(w-88,h-dockHeight-44,84,40,!desktop):box(w/2+86,h-dockHeight+4,w/2-78,68,!desktop)},
  };
}
/** The app shell and safe-area measurements are inputs to playing-frame height. */
export function availableFrameHeight(viewportHeight:number,chromeHeight:number,safeInsets:number):number {
  return Math.max(0,viewportHeight-chromeHeight-safeInsets);
}
export function observerFeedbackPolicy(viewport:{width:number;height:number}) {
  const short=viewport.width>viewport.height&&viewport.height<=520;
  return {showName:!short,compact:short,mobile:viewport.width<600,gap:2};
}
