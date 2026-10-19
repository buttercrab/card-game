import type {FrameLayout} from './foundation/framePolicy';
/** Retained CSS adapter; numeric authority lives in the shared core policy. */
export {resultUsesDock,shortDecisionColumn,calculateFrameLayout,calculateMeasuredFrameLayout,availableFrameHeight,observerFeedbackPolicy} from './foundation/framePolicy';
export type {FrameBox,FrameRegion,FrameInput,FrameLayout,MeasuredFrameInput} from './foundation/framePolicy';

/** Numeric geometry applied by a renderer; these variables carry no game data. */
export function frameStyle(layout: FrameLayout): string {
  const variables = Object.entries(layout.regions).flatMap(([name,b]) => [
    `--frame-${name}-x:${b.x}px`,`--frame-${name}-y:${b.y}px`,`--frame-${name}-w:${b.width}px`,`--frame-${name}-h:${b.height}px`,`--frame-${name}-display:${b.visible?(name==='side'||name==='felt'?'grid':name==='feedback'?'flex':'block'):'none'}`,
  ]);
  return [...variables,`--status-h:${layout.statusHeight}px`,`--event-h:${layout.eventHeight}px`,`--strip-h:${layout.stripHeight}px`,`--dock-h:${layout.dockHeight}px`,`--decision-cap:${layout.decisionCap === null ? 'none' : `${layout.decisionCap}px`}`,`--frame-status-padding:${layout.statusPaddingEnd}px`,`--frame-strip-padding:${layout.stripPaddingTop}px`,`--frame-social-cap:${layout.socialCap}px`,`--tools-room:${layout.toolsRoom}px`,...(layout.seatTop?[`--seat-top:${layout.seatTop}px`]:[])].join(';');
}

