import type {Rect} from './foundation/contracts';
type Bounds={-readonly [K in keyof Rect]:Rect[K]};
/** Retained style/import adapter; participant numeric policy is core-owned. */
export {calculateSeatIdentity} from './foundation/participantPolicy';
export type {SeatIdentityInput} from './foundation/participantPolicy';
export function boundsStyle(b:Bounds):string {return `left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px`;}
