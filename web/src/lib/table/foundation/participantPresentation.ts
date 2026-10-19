import type {TextRole} from './contracts';
import {allocateRing} from './ringAllocation';
import {participantFigureMinimumWidth} from './participantIdentityLayout';
/** Shared table hierarchy: peers remain quieter than the local player. Artwork
 * sizes are stable across phases; semantic labels still honor text scale. */
export const PEER_FIGURE_SIZE=48;
export const LOCAL_FIGURE_SIZE=64;
export const PEER_NAME_ROLE:TextRole='participant-name';

/** Numeric desktop hierarchy from the preserved seat/ring policy. This is
 * independent of current card counts, role paint and transient feedback. */
export function regularParticipantRegion(input:{viewportWidth:number;viewportHeight:number;width:number;height:number}):{readonly width:number;readonly x:number;readonly peerFigure:number;readonly minimumHeight:number} {
 const {viewportWidth,viewportHeight,width,height}=input;
 if([viewportWidth,viewportHeight,width,height].some(value=>!Number.isFinite(value)||value<0))throw Error('Invalid participant region');
 const desktop=viewportWidth>=1024&&viewportHeight>=640;
 const bounded=desktop&&height>320?Math.min(width,height*1.35):width;
 return {width:bounded,x:(width-bounded)/2,minimumHeight:desktop?height:0,peerFigure:desktop?Math.max(56,Math.min(height*.14,80)):PEER_FIGURE_SIZE};
}

/** The original bounded peer wings surround a full-capacity public centre.
 * Current card membership and a result panel do not choose these columns. */
export function regularParticipantColumns(input:{width:number;figure:number;gap:number;minimumCenter:number;minimumWing?:number}) {
 const {width,figure,gap,minimumCenter}=input;
 return allocateRing({width,gap,preferredWing:Math.min(144,(width-minimumCenter-gap*2)/2),minimumWing:Math.max(participantFigureMinimumWidth(figure),input.minimumWing??0),minimumCenter});
}

/** Original active self hierarchy; the peer policy remains independently readable. */
export function localParticipantPresentation(viewport:{width:number;height:number},waiting=false){
 const desktop=viewport.width>=1024&&viewport.height>=640,short=!waiting&&viewport.width>viewport.height&&viewport.height<=520;
 return {figure:waiting?(desktop?72:64):short?40:desktop?72:viewport.width>=600?64:56,arrangement:waiting||desktop||short?'portrait' as const:'adjacent' as const,short};
}
