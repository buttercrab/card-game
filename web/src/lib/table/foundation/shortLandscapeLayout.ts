import type {Size} from './contracts';
/** Sideways-table artwork policy restores the original hand/public-card scale.
 * Text and native targets remain measured; participant artwork stays legible. */
export function shortLandscapePresentation(viewport:Size){
    return viewport.width>viewport.height&&viewport.height<=520?{localFigure:40,peerFigure:40,hand:{width:46,height:65},publicCard:{width:32,height:45},feedbackHeight:28}:null;
}
/** The side lane is measured in full. A candidate is admitted only when the
 * complete participant ring, dock and controls fit their initial rectangles. */
export function composeShortLandscape(input:{width:number;height:number;laneWidth:number;arena:Size;dock:Size;decisions:Size;tools:Size;context?:Size;history?:Size;gap?:number}){
    const gap=input.gap??8,mainWidth=input.width-input.laneWidth-gap;
    const side=[input.context,input.history,input.decisions,input.tools].filter((size):size is Size=>!!size);
    if(![input.width,input.height,input.laneWidth,gap,...[input.arena,input.dock,...side].flatMap(size=>[size.width,size.height])].every(value=>Number.isFinite(value)&&value>=0))throw new RangeError('Invalid landscape measurements');
    const sections=side.filter(size=>size.height>0);
    const mainHeight=input.arena.height+gap+input.dock.height,laneHeight=sections.reduce((sum,size)=>sum+size.height,0)+gap*Math.max(0,sections.length-1);
    if(mainWidth<232||input.arena.width>mainWidth||input.dock.width>mainWidth||side.some(size=>size.width>input.laneWidth)||Math.max(mainHeight,laneHeight)>input.height)return null;
    return {width:input.width,height:input.height,mainWidth,arena:{x:0,y:0},dock:{x:0,y:input.height-input.dock.height},lane:{x:mainWidth+gap,y:0},laneHeight};
}
