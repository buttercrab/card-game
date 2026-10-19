/** A primary public collection reserves the complete participant cohort before
 * the first card arrives. A hidden auxiliary source keeps its own small column. */
export function allocateCompactPublicPair(input:{width:number;capacity:number;cardWidth:number;exposed:number;auxiliaryCaptionWidth:number;auxiliaryArtWidth:number;gap:number}){
    const {width,capacity,cardWidth,exposed,auxiliaryCaptionWidth,auxiliaryArtWidth,gap}=input;
    if(![width,capacity,cardWidth,exposed,auxiliaryCaptionWidth,auxiliaryArtWidth,gap].every(value=>Number.isFinite(value)&&value>=0)||!Number.isInteger(capacity))throw new RangeError('Invalid compact public collection dimensions');
    const primaryMinimum=cardWidth+Math.max(0,capacity-1)*exposed;
    const auxiliaryWidth=Math.max(auxiliaryArtWidth,auxiliaryCaptionWidth);
    const minimumWidth=primaryMinimum+gap+auxiliaryWidth;
    return {primaryMinimum,auxiliaryWidth,minimumWidth,...(width>=minimumWidth?{primaryWidth:width-gap-auxiliaryWidth}: {})};
}
