import {expect,test} from 'vitest';
import {regularParticipantRegion} from './participantPresentation';
test('regular desktop restores the height-bound centered ring and56–80 artwork hierarchy',()=>{
 expect(regularParticipantRegion({viewportWidth:1280,viewportHeight:800,width:928,height:480})).toEqual({width:648,x:140,peerFigure:67.2,minimumHeight:480});
 expect(regularParticipantRegion({viewportWidth:1440,viewportHeight:1200,width:928,height:800}).peerFigure).toBe(80);
 expect(regularParticipantRegion({viewportWidth:1280,viewportHeight:720,width:928,height:320})).toEqual({width:928,x:0,peerFigure:56,minimumHeight:320});
});
test('regular policy keeps existing non-desktop artwork and rejects invalid measurements',()=>{
 expect(regularParticipantRegion({viewportWidth:390,viewportHeight:844,width:358,height:400})).toEqual({width:358,x:0,peerFigure:48,minimumHeight:0});
 for(const height of [-1,NaN,Infinity])expect(()=>regularParticipantRegion({viewportWidth:1280,viewportHeight:800,width:928,height})).toThrow('Invalid participant region');
});
