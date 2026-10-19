import type {PlannedNode,FigureAppearance} from './contracts';
/** Closed paint data only. No node identity, command, form lease, or private input is retained. */
export interface ArtworkPaint {
 readonly kind:PlannedNode['kind'];
 readonly visual?:PlannedNode['visual'];
 readonly full?:boolean;
 readonly emphasis?:PlannedNode['emphasis'];
 readonly checked?:boolean;
 readonly hinted?:boolean;
 readonly unavailable?:boolean;
 readonly appearance?:Readonly<Required<FigureAppearance>>;
 readonly clock?:Readonly<{id:string;textScale:number}>;
 readonly shellIcon?:PlannedNode['shellIcon'];
 readonly suit?:PlannedNode['suit'];
 readonly progress?:PlannedNode['progressPaint'];
 readonly toggle?:boolean;
}
export function projectArtworkPaint(node:PlannedNode):ArtworkPaint {
 if(node.kind==='toggle')return Object.freeze({kind:node.kind,toggle:node.formField?node.formField.value===true:node.preference?.kind==='toggle'&&node.preference.value===true});
 const raw=node.visual,visual=raw?Object.freeze(raw.kind==='standard'?{kind:raw.kind,suit:raw.suit,rank:raw.rank}:raw.kind==='joker'?{kind:raw.kind,color:raw.color}:{kind:raw.kind}):undefined;
 const base={kind:node.kind,...(visual?{visual}:{})};
 switch(node.kind){
  case 'card':return Object.freeze({...base,full:node.box.width>=80,emphasis:node.emphasis,checked:node.checked===true,hinted:node.hinted===true,unavailable:node.unavailable===true});
  case 'figure':return Object.freeze({...base,appearance:Object.freeze({vacant:node.appearance?.vacant??false,team:node.appearance?.team??null,trumpSuit:node.appearance?.trumpSuit??null,bot:node.appearance?.bot??false,offline:node.appearance?.offline??false,thinking:node.appearance?.thinking??false}),...(node.clockPaint?{clock:Object.freeze({id:node.clockPaint.id,textScale:node.clockTextScale??1})}:{})});
  case 'icon':return Object.freeze({...base,shellIcon:node.shellIcon});
  case 'suit':return Object.freeze({...base,suit:node.suit});
  case 'progress':return Object.freeze({...base,progress:Object.freeze({segments:Object.freeze((node.progressPaint?.segments??[]).map(segment=>Object.freeze({x:segment.x,width:segment.width,tone:segment.tone}))),...(node.progressPaint?.target!==undefined?{target:node.progressPaint.target}:{})})});
  default:return Object.freeze(base);
 }
}
export function sameArtworkPaint(a:ArtworkPaint,b:ArtworkPaint):boolean {
 if(a.kind!==b.kind||a.visual?.kind!==b.visual?.kind)return false;
 if(a.visual?.kind==='standard'&&(b.visual?.kind!=='standard'||a.visual.rank!==b.visual.rank||a.visual.suit!==b.visual.suit))return false;
 if(a.visual?.kind==='joker'&&(b.visual?.kind!=='joker'||a.visual.color!==b.visual.color))return false;
 if(a.full!==b.full||a.emphasis!==b.emphasis||a.checked!==b.checked||a.hinted!==b.hinted||a.unavailable!==b.unavailable||a.shellIcon!==b.shellIcon||a.suit!==b.suit||a.toggle!==b.toggle)return false;
 const af=a.appearance,bf=b.appearance;
 if(!!af!==!!bf||af?.vacant!==bf?.vacant||af?.team!==bf?.team||af?.trumpSuit!==bf?.trumpSuit||af?.bot!==bf?.bot||af?.offline!==bf?.offline||af?.thinking!==bf?.thinking)return false;
 if(a.clock?.id!==b.clock?.id||a.clock?.textScale!==b.clock?.textScale)return false;
 const ap=a.progress,bp=b.progress;if(!!ap!==!!bp||ap?.target!==bp?.target||ap?.segments.length!==bp?.segments.length)return false;
 if(ap&&bp)for(let index=0;index<ap.segments.length;index++){const as=ap.segments[index],bs=bp.segments[index];if(as.x!==bs.x||as.width!==bs.width||as.tone!==bs.tone)return false;}
 return true;
}
/** A leaf owns one immutable paint snapshot; retirement clears it before callbacks. */
export function createArtworkPaintOwner(node:PlannedNode,changed:(paint:ArtworkPaint|null)=>void){
 let current:ArtworkPaint|null=projectArtworkPaint(node),disposed=false,revision=0;
 return {
  get current(){return current;},
  update(node:PlannedNode):boolean{if(disposed)return false;const token=++revision,next=projectArtworkPaint(node);if(disposed||revision!==token)return false;if(current&&sameArtworkPaint(current,next))return false;current=next;changed(current);return true;},
  destroy():boolean{if(disposed)return false;disposed=true;revision++;current=null;changed(null);return true;},
 };
}
