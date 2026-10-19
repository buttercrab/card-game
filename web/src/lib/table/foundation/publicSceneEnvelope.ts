import {calculateMeasuredFrameLayout} from './framePolicy';
import {regularParticipantRegion} from './participantPresentation';
import type {Rect,Size} from './contracts';

/** A valid numeric region cannot contain the current frame policy's dock/felt.
 * The caller may use its established whole-table root-flow composition. */
export class PublicSceneUnavailable extends RangeError {}

/** The public table's parent regions are responsive allocations. A current
 * offer, hand membership, result body and feedback paint are not inputs. */
export function publicSceneEnvelope(input:{viewport:Size;region:Size;mainWidth:number;dockHeight:number;instructionHeight:number;minimumArenaHeight?:number}) {
 const {viewport,region,mainWidth,dockHeight,instructionHeight}=input;
 if([viewport.width,viewport.height,region.width,region.height,mainWidth].some(value=>!Number.isFinite(value)||value<=0)||mainWidth>region.width||[dockHeight,instructionHeight].some(value=>!Number.isFinite(value)||value<0)||!Number.isFinite(dockHeight+instructionHeight))throw Error('Invalid public scene allocation');
 if(input.minimumArenaHeight!==undefined&&(!Number.isFinite(input.minimumArenaHeight)||input.minimumArenaHeight<0))throw Error('Invalid public scene minimum');
 const measurements={mainWidth,statusHeight:0,eventHeight:0,dockHeight:dockHeight+instructionHeight};
 const requested=calculateMeasuredFrameLayout({viewport,region},measurements);
 if(requested.regions.tray.y<0||requested.regions.felt.height<=0)throw new PublicSceneUnavailable('Public scene region cannot contain its dock and felt allocations');
 // A public scene owns physical viewport allocations. A larger requested
 // ring is an admission failure, never permission to move its dock offscreen.
 if((input.minimumArenaHeight??0)>requested.regions.felt.height)throw new PublicSceneUnavailable('Public scene minimum exceeds its physical felt allocation');
 const participants=regularParticipantRegion({viewportWidth:viewport.width,viewportHeight:viewport.height,width:requested.regions.felt.width,height:requested.regions.felt.height});
 const frame=requested;
 const felt=frame.regions.felt;
 const arena:Rect={x:felt.x+participants.x,y:felt.y,width:participants.width,height:felt.height};
 // The instruction occupies its own ink corridor above the actual tray. It
 // never shares a full-capacity trick slot or changes the felt when passive.
 const instruction:Rect={x:0,y:frame.regions.tray.y,width:mainWidth,height:instructionHeight};
 const dock:Rect={x:0,y:instruction.y+instruction.height,width:mainWidth,height:frame.regions.tray.height-instructionHeight};
 // The same physical region owns the primary flow and sidebar viewport.
 return {frame,arena,instruction,dock,peerFigure:participants.peerFigure,contentHeight:frame.regions.side.height,railHeight:region.height};
}
