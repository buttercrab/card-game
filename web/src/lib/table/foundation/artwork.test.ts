import {describe,expect,test} from 'vitest';
import {render} from 'svelte/server';
import SharedArtwork from './SharedArtwork.svelte';
import Icon from '../../Icon.svelte';
import type {PlannedNode} from './contracts';
import {projectArtworkPaint,type ArtworkPaint} from './artworkPaint';

const node=(extra:Partial<PlannedNode>):ArtworkPaint=>projectArtworkPaint({id:'paint',parent:null,kind:'progress',label:'여당 4 / 17 · 야당 2',box:{x:0,y:0,width:200,height:16},...extra});
describe('shared artwork paint leaves',()=>{
    test('shell icon reuses the original decorative icon primitive',()=>{
        const {body}=render(SharedArtwork,{props:{node:node({kind:'icon',shellIcon:'menu'})}});
        expect(body).toContain('viewBox="0 0 24 24"');
        expect(body).toContain('class="icon');
        expect(body).toContain('aria-hidden="true"');
        expect(body).not.toContain('aria-label');
    });
    test('hint paint reaches the existing decorative bulb asset through the closed artwork boundary',()=>{
        const {body}=render(SharedArtwork,{props:{node:node({kind:'icon',shellIcon:'hint'})}});
        const original=render(Icon,{props:{name:'hint',size:'100%'}}).body.match(/<svg[\s\S]*?<\/svg>/)?.[0];
        expect(original).toBeDefined();expect(body).toContain(original);
        expect(body).toContain('aria-hidden="true"');expect(body).not.toContain('aria-label');
        expect(body).not.toContain('<button');expect(body).not.toContain('data-foundation-action');
    });
    test('progress consumes normalized engine geometry and existing theme paints',()=>{
        const {body}=render(SharedArtwork,{props:{node:node({progressPaint:{segments:[{x:0,width:4,tone:'gold'},{x:96,width:4,tone:'accent'},{x:10,width:4,tone:'muted'}],target:85}})}});
        expect(body).toContain('viewBox="0 0 100 16"');
        expect(body).toContain('x="96"');
        expect(body).toContain('width="4"');
        expect(body).toContain('x1="85"');
        expect(body).toContain('var(--gold)');
        expect(body).toContain('var(--accent)');
        expect(body).toContain('var(--line)');
        expect(body).toContain('aria-hidden="true"');
    });
    test('vacant figure reuses the original dashed silhouette and bounds',()=>{
        const {body}=render(SharedArtwork,{props:{node:node({kind:'figure',appearance:{vacant:true}})}});
        expect(body).toContain('viewBox="0 0 120 110"');
        expect(body).toContain('M20 108 Q22 76 60 72 Q98 76 100 108');
        expect(body).toContain('cx="60" cy="48" r="20"');
        expect(body).not.toContain('data-card-paper');
    });
    test('suit uses the shared suit icon with no independent text glyph',()=>{
        const {body}=render(SharedArtwork,{props:{node:node({kind:'suit',suit:'Club'})}});
        expect(body).toContain('viewBox="0 0 100 100"');
        expect(body).toContain('s-Club');
        expect(body).not.toContain('<text');
    });
});

test('unavailable cards keep opaque paper outside their muted artwork layer',()=>{
 const {body}=render(SharedArtwork,{props:{node:node({kind:'card',visual:{kind:'standard',suit:'Heart',rank:8},unavailable:true})}});
 const layer=body.indexOf('data-card-unavailable="true"'),paper=body.indexOf('data-card-paper');
 expect(paper).toBeGreaterThan(-1);expect(layer).toBeGreaterThan(paper);
 expect(body.slice(paper,layer)).not.toContain('opacity=');
 expect(body.slice(layer)).toContain('opacity="0.65"');expect(body.slice(layer)).toContain('grayscale(1)');
});
