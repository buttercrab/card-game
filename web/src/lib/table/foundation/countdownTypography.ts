/** Single last-five-second digit in the shared120-unit participant figure.
 * Grow its font and bottom clearance together; card artwork remains unscaled. */
export function countdownTypography(scale:number){
 if(!Number.isFinite(scale)||scale<.75||scale>3)throw Error('Unsupported countdown text scale');
 return Object.freeze({fontSize:20*scale,x:105,y:120-7*scale});
}
