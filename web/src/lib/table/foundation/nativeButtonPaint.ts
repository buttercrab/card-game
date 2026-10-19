import type {PlannedNode} from './contracts';

type ButtonPaintNode=Pick<PlannedNode,'kind'|'enabled'|'choiceCard'|'semanticRole'>;
type AvailabilityPaint=Pick<CSSStyleDeclaration,'opacity'|'boxShadow'>;

/** Choices use Chip's checked ink paint, with Button's existing secondary
 * disabled treatment (app.css: .btn:disabled). Command CSS retains its primary
 * neutral state. Always clear owned inline paint on re-enable/reuse. Cards have
 * separate availability/inspection and motion paint and are never dimmed here. */
export function paintNativeButtonAvailability(style:AvailabilityPaint,node:ButtonPaintNode):void {
    if(node.kind==='card'||node.choiceCard)return;
    const disabled=node.enabled!==true;
    style.opacity=node.kind==='toggle'?(disabled?'.4':'1'):node.kind==='choice'&&disabled?'.4':'';
    style.boxShadow=node.semanticRole==='tab'||node.kind==='choice'&&disabled?'none':'';
}
