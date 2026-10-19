import type {Size} from './contracts';
export type InlineCaptionAtom=import('../decisionModel').DecisionCaptionAtom;
export interface InlineCaptionPart {readonly atom:InlineCaptionAtom;readonly x:number;readonly y:number;readonly width:number;readonly height:number;}
export interface InlineCaptionPlan extends Size {readonly parts:readonly InlineCaptionPart[];}
/** Same two artwork recipes as preserved BidPanel's18px option icon and
 * SuitText's0.92em inline icon with0.04em margins; never Unicode matching. */
export function measureInlineCaption(atoms:readonly InlineCaptionAtom[],input:{mode:'choice'|'inline';fontSize:number;textScale:number;text:(value:string)=>Size}):InlineCaptionPlan {
 if(!atoms.length||atoms.length>16||![input.fontSize,input.textScale].every(value=>Number.isFinite(value)&&value>0))throw Error('Invalid inline caption');
 const space=input.text(' ');if(!Number.isFinite(space.width)||space.width<0)throw Error('Invalid inline caption metric');
 const measured=atoms.map((atom,index)=>{
  if(atom.join!==undefined&&(atom.join!=='previous'||index===0))throw Error('Invalid inline caption join');
  if(atom.kind==='suit'){
   if(!['Spade','Heart','Diamond','Club'].includes(atom.suit)||!atom.label)throw Error('Invalid inline caption suit');
   const size=input.mode==='choice'?18*input.textScale:input.fontSize*.92,margin=input.mode==='choice'?0:input.fontSize*.04;
   return {atom:Object.freeze({...atom}),width:size+margin*2,height:size,margin};
  }
  const text=atom.kind==='text'?atom.text:String(atom.value);if(atom.kind==='number'&&!Number.isFinite(atom.value)||!text.length||text.length>1000)throw Error('Invalid inline caption text');const size=input.text(text);
  if(![size.width,size.height].every(Number.isFinite)||size.width<0||size.height<=0)throw Error('Invalid inline caption metric');return {atom:Object.freeze({...atom}),...size,margin:0};
 });
 const height=Math.max(...measured.map(part=>part.height));let x=0;
 const parts=measured.map((part,index)=>{const result=Object.freeze({atom:part.atom,x:x+part.margin,y:(height-part.height)/2,width:part.width-part.margin*2,height:part.height});const next=measured[index+1]?.atom;x+=part.width+(next&&!(next.join==='previous')?space.width:0);return result;});
 return Object.freeze({width:x,height,parts:Object.freeze(parts)});
}
export function paintInlineCaption<F>(id:string,plan:InlineCaptionPlan,builders:{text:(id:string,text:string,width:number,height:number)=>F;suit:(id:string,suit:Extract<InlineCaptionAtom,{kind:'suit'}>['suit'],label:string,width:number,height:number)=>F;group:(id:string,width:number,height:number,parts:readonly {fragment:F;x:number;y:number}[])=>F}):F{
 return builders.group(id,plan.width,plan.height,plan.parts.map((part,index)=>({fragment:part.atom.kind==='suit'?builders.suit(`${id}:${index}`,part.atom.suit,part.atom.label,part.width,part.height):builders.text(`${id}:${index}`,part.atom.kind==='text'?part.atom.text:String(part.atom.value),part.width,part.height),x:part.x,y:part.y})));
}

/** Compose a conservative maximum per fixed position; never enumerate caption
 * combinations or retain a metric outside the current candidate. */
export function measureCaptionDomain(domain:import('../decisionModel').CaptionDomain,input:Parameters<typeof measureInlineCaption>[1]):Size{
 const space=input.text(' '),parts=domain.parts.map(atoms=>{const sizes=atoms.map(atom=>measureInlineCaption([{...atom,join:undefined}],input));return {width:Math.max(...sizes.map(size=>size.width)),height:Math.max(...sizes.map(size=>size.height))};});
 return {width:parts.reduce((sum,part)=>sum+part.width,0)+domain.parts.slice(1).reduce((sum,atoms)=>sum+(atoms.some(atom=>atom.join!=='previous')?space.width:0),0),height:Math.max(...parts.map(part=>part.height))};
}
