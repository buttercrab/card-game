/** A native hand viewport shows one complete face and one additional exposed
 * hit target. The complete strip remains owned by the hand's native scroller. */
export function minimumHandViewport(input:{cardWidth:number;feedbackPadding:number;stride:number;count:number}):number {
 const {cardWidth,feedbackPadding,stride,count}=input;
 if(!Number.isSafeInteger(count)||count<1||[cardWidth,feedbackPadding,stride].some(value=>!Number.isFinite(value)||value<0)||cardWidth<=0||stride<=0)throw Error('Invalid native hand viewport requirements');
 return cardWidth+feedbackPadding*2+stride;
}
/** Admit the widest identity column that preserves the native hand minimum.
 * Measured glyph/counter minima reject unreadable columns before composition. */
export function compactIdentityWidths(input:{available:number;gap:number;handMinimum:number;figure:number;artGap:number;outerPadding:number;countArtwork:number;captionGap:number;nameGlyph:number;countGlyph:number}):readonly number[]{
 const values=Object.values(input);if(values.some(value=>!Number.isFinite(value)||value<0))throw Error('Invalid compact identity requirements');
 const {available,gap,handMinimum,figure,artGap,outerPadding,countArtwork,captionGap,nameGlyph,countGlyph}=input;
 const minimum=figure+artGap+Math.max(nameGlyph,countArtwork+captionGap+countGlyph)+outerPadding,maximum=available-gap-handMinimum;
 if(maximum<minimum)return Object.freeze([]);
 // Hand height is independent of horizontal strip length. The widest valid
 // identity therefore gives the smallest complete side-dock height; narrower
 // identities cannot improve fit and would multiply caption measurements.
 return Object.freeze([maximum]);
}
