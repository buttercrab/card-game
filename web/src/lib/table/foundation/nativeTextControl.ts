/** Shared native text-control chrome, matching the original input/select style.
 * Both planned border-box allocation and browser painting consume this token. */
export const NATIVE_TEXT_CONTROL=Object.freeze({paddingX:12,paddingY:10,borderWidth:1,minHeight:44});
export const nativeTextControlStyle=Object.freeze({
 padding:`${NATIVE_TEXT_CONTROL.paddingY}px ${NATIVE_TEXT_CONTROL.paddingX}px`,
 border:`${NATIVE_TEXT_CONTROL.borderWidth}px solid var(--line)`,
});
export function nativeTextControlHeight(lineHeight:number,lines=1):number {
 if(!Number.isFinite(lineHeight)||lineHeight<=0||!Number.isSafeInteger(lines)||lines<1||lines>4)throw Error('Invalid native text-control metric');
 return Math.max(NATIVE_TEXT_CONTROL.minHeight,lineHeight*lines+2*(NATIVE_TEXT_CONTROL.paddingY+NATIVE_TEXT_CONTROL.borderWidth));
}
