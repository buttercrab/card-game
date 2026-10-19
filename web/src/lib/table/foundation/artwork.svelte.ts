import {mount,unmount} from 'svelte';
import SharedArtwork from './SharedArtwork.svelte';
import type {PlannedNode} from './contracts';
import {createArtworkPaintOwner,type ArtworkPaint} from './artworkPaint';
/** Paint-only leaf: no input, measurement, layout or dispatch authority. */
export function mountArtwork(target:HTMLElement,node:PlannedNode){
    let current=$state.raw<ArtworkPaint|null>(null);
    const paint=createArtworkPaintOwner(node,value=>{current=value;});current=paint.current;
    const instance=mount(SharedArtwork,{target,props:{get node(){return current;}}});
    return {
        update(node:PlannedNode){paint.update(node);},
        destroy(){if(paint.destroy())void unmount(instance,{outro:false});},
    };
}

/** A transient resource paints the same shared leaf without inventing scene nodes. */
export function mountPaintArtwork(target:HTMLElement,paint:ArtworkPaint){
 const instance=mount(SharedArtwork,{target,props:{node:paint}});let disposed=false;
 return {destroy(){if(disposed)return;disposed=true;void unmount(instance,{outro:false});}};
}
