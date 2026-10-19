/** The original short table keeps clockwise peers together above public cards.
 * Allocate actual readable names/counts/status before distributing spare width. */
export function allocateCompactPeerRow(width:number,minimumWidths:readonly number[],gap=4):readonly number[]|null {
    if(![width,gap,...minimumWidths].every(value=>Number.isFinite(value)&&value>=0))throw new RangeError('Invalid compact participant row');
    if(!minimumWidths.length)return [];
    const required=minimumWidths.reduce((sum,value)=>sum+value,0)+gap*(minimumWidths.length-1);
    if(required>width)return null;
    const extra=(width-required)/minimumWidths.length;
    return minimumWidths.map(value=>value+extra);
}
/** Align the destination artwork with the public source row, inside its real
 * native viewport. This creates a horizontal transit band, not a guessed offset. */
export function alignCollectionTransit(input:{sourceY:number;viewportY:number;destinationY:number;contentHeight:number;viewportHeight:number}):number|null {
    if(!Object.values(input).every(value=>Number.isFinite(value)&&value>=0))throw new RangeError('Invalid collection transit band');
    const offset=input.sourceY-input.viewportY-input.destinationY;
    return offset>=0&&offset+input.contentHeight<=input.viewportHeight?offset:null;
}
