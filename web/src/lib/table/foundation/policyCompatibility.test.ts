import {expect,test} from 'vitest';
import * as frame from './framePolicy';
import * as dock from './dockPolicy';
import * as participant from './participantPolicy';
import * as hud from './hudPolicy';
import * as retainedHud from '../hudLayout';
import * as retainedFeedback from '../feedbackLayout';
import * as retainedFrame from '../frameLayout';
import * as retainedDock from '../dockLayout';
import * as retainedSeat from '../seatIdentityLayout';
import type {FeedbackGeometry as RetainedFeedbackGeometry} from '../feedbackLayout';

test('retained imports are the exact canonical numeric functions, not parallel calculations',()=>{
 for(const name of ['calculateFrameLayout','calculateMeasuredFrameLayout','resultUsesDock','shortDecisionColumn','availableFrameHeight','observerFeedbackPolicy'] as const)expect(retainedFrame[name],name).toBe(frame[name]);
 for(const name of ['dockIdentityRow','calculateDockLayout','calculateDockRegions'] as const)expect(retainedDock[name],name).toBe(dock[name]);
 expect(retainedDock.calculateLocalIdentityLayout).toBe(participant.calculateLocalIdentityLayout);
 expect(retainedSeat.calculateSeatIdentity).toBe(participant.calculateSeatIdentity);
 for(const name of ['layoutFeedback','bubbleTypography'] as const)expect(retainedFeedback[name],name).toBe(participant[name]);
 for(const name of ['statusHudPolicy','resultHudPolicy','layoutHudStack','layoutHudFlow','layoutHudColumns','layoutHudResult','SCOREBOARD_FIGURE','SCOREBOARD_COLUMNS'] as const)expect(retainedHud[name],name).toBe(hud[name]);
});
test('retained style adapters preserve independently specified frame and bounds serialization',()=>{
 const result=frame.calculateFrameLayout({viewport:{width:390,height:844},region:{width:358,height:764}});
 expect(result.regions.felt).toEqual({x:0,y:74,width:358,height:474,visible:true});
 expect(result.regions.tray).toEqual({x:0,y:572,width:358,height:192,visible:true});
 expect(retainedFrame.frameStyle(result)).toContain('--frame-felt-x:0px;--frame-felt-y:74px;--frame-felt-w:358px;--frame-felt-h:474px;--frame-felt-display:grid');
 expect(retainedSeat.boundsStyle({x:2.5,y:-3,width:48,height:44})).toBe('left:2.5px;top:-3px;width:48px;height:44px');
 const geometry:RetainedFeedbackGeometry={height:28,reaction:{x:50,y:-6,width:100,align:'center'},compact:false};
 const identity=participant.calculateSeatIdentity({viewport:{width:390,height:844},region:{width:358,height:400},width:92});
 expect(identity.feedback.height).toBe(geometry.height);
});
