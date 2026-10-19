import {layoutHudFlow,type HudItem} from './hudPolicy';
import type {Size as CoreSize,Rect} from './contracts';
// Preserve the existing numeric API's mutable shapes without a legacy edge.
type Size={-readonly [K in keyof CoreSize]:CoreSize[K]};
type Bounds={-readonly [K in keyof Rect]:Rect[K]};

export interface FeedbackGeometry {
  height?: number;
  /** Local to the feedback row: x is the chosen horizontal anchor; y is
   * the bubble's bottom edge unless below places its top there instead. */
  reaction?: { x: number; y: number; width: number; align?: 'start' | 'center' | 'end'; below?: boolean };
  compact?: boolean;
}

/** Local identity leaf geometry. The name measurement limit is independent of
 * its current pill, so a longer label can grow instead of feeding back a cap. */
export function calculateLocalIdentityLayout({viewport,width,waiting=false,hasMeta=true,nameWidth=0}:{viewport:Size;width:number;waiting?:boolean;hasMeta?:boolean;nameWidth?:number}) {
  for(const dimension of [viewport.width,viewport.height,width,nameWidth])if(!Number.isFinite(dimension)||dimension<0)throw new RangeError('Identity dimensions must be finite and non-negative');
  const desktop=viewport.width>=1024&&viewport.height>=640;
  const landscape=!waiting&&viewport.width>viewport.height&&viewport.height<=520;
  const available=Math.max(0,width-8);
  const vertical=waiting||desktop||landscape;
  const figureSize=waiting?(desktop?72:64):landscape?40:desktop?72:viewport.width>=600?64:56;
  const nameSize=landscape?14:16;
  const figureHeight=figureSize*110/120;
  if(vertical){
    const maxWidth=landscape?Math.min(84,available):available;
    const nameTextMax=Math.max(0,maxWidth-16);
    const pillWidth=Math.min(maxWidth,Math.min(nameWidth,nameTextMax)+16);
    const identityWidth=Math.min(maxWidth,Math.max(figureSize,pillWidth));
    const metaHeight=waiting&&!hasMeta?0:landscape?16:20;
    const metaY=landscape?20:Math.max(0,figureHeight-figureSize*.14);
    const nameY=landscape?36:metaHeight?metaY+metaHeight+2:figureHeight+2;
    const nameHeight=landscape?18:22;
    return {mode:'vertical' as const,width:identityWidth,height:nameY+nameHeight,figureSize,nameSize,nameTextMax,
      figure:{x:(identityWidth-figureSize)/2,y:0,width:Math.min(figureSize,maxWidth),height:figureHeight},
      meta:{x:0,y:metaY,width:identityWidth,height:metaHeight},
      name:{x:(identityWidth-pillWidth)/2,y:nameY,width:pillWidth,height:nameHeight},
      reaction:{x:width/2,y:-6,width,side:false}};
  }
  const maxWidth=Math.min(viewport.width>=600?240:208,available);
  const textX=Math.max(0,figureSize-4);
  const textAvailable=Math.max(0,maxWidth-textX);
  const nameTextMax=Math.max(0,textAvailable-16);
  const pillWidth=Math.min(textAvailable,Math.min(nameWidth,nameTextMax)+16);
  const textWidth=Math.min(textAvailable,Math.max(72,pillWidth));
  const identityWidth=Math.min(maxWidth,textX+textWidth);
  const textY=Math.max(0,(figureHeight-44)/2);
  return {mode:'horizontal' as const,width:identityWidth,height:Math.max(figureHeight,textY+44),figureSize,nameSize,nameTextMax,
    figure:{x:0,y:0,width:Math.min(figureSize,maxWidth),height:figureHeight},
    meta:{x:textX,y:textY,width:textWidth,height:20},
    name:{x:textX+(textWidth-pillWidth)/2,y:textY+22,width:pillWidth,height:22},
    reaction:{x:(width-identityWidth)/2,y:4,width:Math.max(0,Math.min(104,(viewport.width-identityWidth)/2-8)),side:true}};
}

const clamp=(low:number,value:number,high:number)=>Math.max(low,Math.min(high,value));
export interface SeatIdentityInput {
  viewport: Size; region: Size; width: number; local?: boolean; compact?: boolean;
  waiting?: boolean; hasMeta?: boolean; empty?: boolean; nameWidth?: number; statusCount?: number; thinking?: boolean; actionsHeight?: number;
}
/** All seat children share this numeric owner; rendered text/art is an input/leaf. */
export function calculateSeatIdentity(input:SeatIdentityInput) {
  const {viewport,region,width,local=false,compact=false,empty=false,waiting=false,hasMeta=true,nameWidth=0,statusCount=0,thinking=false,actionsHeight=0}=input;
  const inner=Math.max(0,width-8);
  const desktop=viewport.width>=1024&&viewport.height>=640;
  const tablet=viewport.width>=600;
  const localPolicy=local?calculateLocalIdentityLayout({viewport,width,waiting,hasMeta,nameWidth}):null;
  const figureSize=localPolicy?.figureSize??(compact?16:desktop?clamp(56,region.height*.14,80):tablet?clamp(40,region.height*.09,84):clamp(viewport.height>=700?44:36,region.height*.1,viewport.height>=700?68:64));
  const nameSize=localPolicy?.nameSize??(compact?12:desktop?16:tablet?clamp(15,region.width*.023,19):14);
  const figureHeight=figureSize*110/120;
  const metaHeight=compact?14:20;
  const identityWidth=localPolicy?.width??inner;
  const identityX=(width-identityWidth)/2;
  const figure:Bounds=localPolicy?localPolicy.figure:{x:(inner-figureSize)/2,y:0,width:figureSize,height:figureHeight};
  const meta:Bounds=localPolicy?localPolicy.meta:{x:0,y:Math.max(0,figureHeight-figureSize*.14),width:inner,height:metaHeight};
  const nameHeight=localPolicy?.name.height??Math.ceil(nameSize*1.27)+2;
  const nameY=localPolicy?.name.y??(empty?figureHeight+2:meta.y+meta.height+2);
  const nameAvailable=localPolicy?.name.width??Math.max(0,inner-6);
  const namePillWidth=localPolicy?localPolicy.name.width:Math.min(nameAvailable,Math.max(0,nameWidth)+16);
  const name:Bounds={x:localPolicy?.name.x??(inner-namePillWidth)/2,y:nameY,width:namePillWidth,height:nameHeight};
  const identityHeight=localPolicy?.height??nameY+nameHeight;
  const feedbackHeight=local?24:compact?24:28;
  const feedbackY=2+identityHeight+2;
  const statusWidth=statusCount?statusCount*7+Math.max(0,statusCount-1)*3:0;
  const status:Bounds={x:name.x-statusWidth-4,y:name.y+(name.height-7)/2,width:statusWidth,height:7};
  const dots:Bounds={x:name.x+name.width+4,y:name.y+(name.height-4)/2,width:16,height:4};
  const feedback:FeedbackGeometry={height:feedbackHeight,compact,
    reaction:localPolicy?{x:localPolicy.reaction.x,y:localPolicy.reaction.y-feedbackY,width:localPolicy.reaction.width,align:localPolicy.reaction.side?'end':'center',below:localPolicy.reaction.side}:
    {x:width/2,y:(compact&&viewport.height>=viewport.width&&viewport.width<600?0:-6)-feedbackY,width,below:compact&&viewport.height>=viewport.width&&viewport.width<600}};
  return {width,height:feedbackY+(empty?0:feedbackHeight)+2+(actionsHeight?actionsHeight+8:0),identity:{x:identityX,y:2,width:identityWidth,height:identityHeight},figure,meta,name,status,dots,
    badgeSize:compact?9:11,badgeLineHeight:compact?14:undefined,badgePadding:compact?2:4,
    pickedOffset:-4, statusOffsets:Array.from({length:statusCount},(_,index)=>index*10), thinkingOffsets:[0,6,12],
    nameAvailable,nameTextMax:localPolicy?.nameTextMax??Math.max(0,nameAvailable-16),nameSize,metaSize:compact?9:tablet?clamp(13,region.width*.018,15):14,showThinking:thinking&&!compact,
    feedbackBox:{x:0,y:feedbackY,width,height:empty?0:feedbackHeight},feedback,
    actions:{x:4,y:feedbackY+(empty?0:feedbackHeight)+8,width:inner,height:actionsHeight}};
}

export function layoutFeedback(width: number, items: readonly HudItem[], reaction: { width: number; height: number }, geometry: FeedbackGeometry = {}) {
  const anchor = geometry.reaction ?? { x: width / 2, y: -6, width };
  const reactionWidth = Math.max(0, Math.min(anchor.width, reaction.width));
  const origin = anchor.align === 'start' ? 0 : anchor.align === 'end' ? 1 : 0.5;
  const bubble: Bounds = { x: anchor.x - reactionWidth * origin, y: anchor.y - (anchor.below ? 0 : reaction.height), width: reactionWidth, height: reaction.height };
  const available = Math.max(0, width - Math.max(0, items.length - 1) * 4);
  const caps = Object.fromEntries(items.map(item => [item.id, items.length === 2 && items.some(item => item.id === 'bid') ? available * (item.id === 'bid' ? 0.6 : 0.4) : available / Math.max(1, items.length)]));
  const row = layoutHudFlow(items.map(item => ({ ...item, width: Math.min(item.width, caps[item.id]) })), width, { gapX: 4, gapY: 2, justify: 'center' });
  // Feedback rows keep a stable reserved height; live bubbles never displace identity.
  return { caps, nodes: row.nodes.map(node => ({ ...node, bounds: { ...node.bounds, y: 0 } })), reaction: bubble, reactionCap: Math.max(0, anchor.width), height: geometry.height ?? 28 };
}

export function bubbleTypography(kind: 'reaction' | 'event' | 'bid', emoji: boolean, compact: boolean, mobile: boolean) {
  if (kind !== 'reaction') return { fontSize: 12, fontWeight: kind === 'bid' ? 600 : 700, minHeight: kind === 'bid' ? 20 : 24, lineHeight: 1.2, padding: kind === 'bid' ? '1px 6px' : '2px 7px', enterY: 6 };
  if (compact) return { fontSize: emoji ? 28 : 13, fontWeight:800, minHeight: 32, lineHeight: 1, padding: emoji ? '1px 4px' : '2px 4px', enterY: 0 };
  return { fontSize: emoji ? (mobile ? 28 : 32) : (mobile ? 15 : 16), fontWeight:800, minHeight: emoji ? (mobile ? 38 : 42) : 34, lineHeight: emoji ? 1 : 1.2, padding: emoji ? '4px 6px' : '4px 5px', enterY: 6 };
}
