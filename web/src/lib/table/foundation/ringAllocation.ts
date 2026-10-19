/** A preferred ring is only a candidate until both wings and the real public
 * center have owned widths. Full labels may wrap; artwork minima never shrink. */
export function allocateRing(input:{width:number;gap:number;preferredWing:number;minimumWing:number;minimumCenter:number}):{readonly wing:number;readonly centerWidth:number}|null{
 const {width,gap,preferredWing,minimumWing,minimumCenter}=input;
 if(Object.values(input).some(value=>!Number.isFinite(value)||value<0)||width===0||minimumWing===0||minimumCenter===0)throw Error('Invalid ring requirements');
 const maximumWing=(width-minimumCenter-gap*2)/2;
 if(maximumWing<minimumWing)return null;
 const wing=Math.min(Math.max(preferredWing,minimumWing),maximumWing);
 return Object.freeze({wing,centerWidth:width-wing*2-gap*2});
}
