import type {FrameLayout,FrameBox} from './framePolicy';
import type {Rect} from './contracts';
/** The retained frame places controls upward from its strip into an otherwise
 * empty public arena corridor. Full measured identities/slots remain obstacles. */
export function jointDecisionCorridor(frame:FrameLayout,input:{contentHeight:number;minimumHeight:number;frameHeight:number;protected:readonly Rect[]}):FrameBox|null {
 const {contentHeight,minimumHeight,frameHeight}=input;if(![contentHeight,minimumHeight,frameHeight].every(value=>Number.isFinite(value)&&value>=0)||minimumHeight>contentHeight)throw Error('Invalid joint decision measurement');
 const strip=frame.regions.strip,short=frame.mode==='short',height=short?strip.height:Math.min(contentHeight,Math.max(minimumHeight,frame.decisionCap??contentHeight)),box={x:strip.x,y:short?strip.y:strip.y+strip.height-height,width:strip.width,height,visible:true};
 if(box.width<=0||height<minimumHeight||box.y<0||box.y+height>frameHeight)return null;
 const overlap=(other:Rect)=>box.x<other.x+other.width&&box.x+box.width>other.x&&box.y<other.y+other.height&&box.y+box.height>other.y;
 return input.protected.some(overlap)?null:box;
}
