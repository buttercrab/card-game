import {expect,test} from 'vitest';
import {minimumHandViewport,compactIdentityWidths} from './compactDockAllocation';
test('native viewport accounts for a full face, selection envelope and another44px target',()=>{
 expect(minimumHandViewport({cardWidth:88,feedbackPadding:6,stride:44,count:10})).toBe(144);
 expect(minimumHandViewport({cardWidth:88,feedbackPadding:6,stride:44,count:1})).toBe(144);
 expect(minimumHandViewport({cardWidth:88,feedbackPadding:0,stride:44,count:4})).toBe(132);
});
test('measured label minima reject an impossible side composition without truncating captions',()=>{
 const base={available:342,gap:12,handMinimum:144,figure:72,artGap:12,outerPadding:12,countArtwork:18,captionGap:8,nameGlyph:36,countGlyph:28};
 const widths=compactIdentityWidths(base);expect(widths).toEqual([186]);
 for(const width of widths){expect(width+base.gap+base.handMinimum).toBeLessThanOrEqual(base.available);expect(width-base.figure-base.artGap-base.outerPadding).toBeGreaterThanOrEqual(54);}
 expect(compactIdentityWidths({...base,available:280})).toEqual([]);
});
