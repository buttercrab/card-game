import type { PresentationFrame } from './contracts';
import { motion } from '../../settings.svelte';
import { selectionTracks, SELECTION_DURATION, SELECTION_EASING } from './selectionMotion';

/** Paint-only refusal. Every position stays within the engine's existing 6px
 * target/focus envelope; applications cannot provide displacement or timing. */
export function refusalMotionRecipe(level:'full'|'reduced'|'off',speed=1):{frames:Keyframe[];timing:KeyframeAnimationOptions}|null {
    if(level!=='full'||!Number.isFinite(speed)||speed<=0)return null;
    return {frames:[0,-3,3,-2,2,0].map(x=>({transform:`translateX(${x}px)`})),timing:{duration:150*Math.min(1,speed),easing:'ease-out'}};
}
/** Consumes visual cues even when motion is suppressed or another modal is
 * visible. Reallocation and modal dismissal never replay an old seat cue. */
export function createFigureCueGate(){
    let scope='';const seen=new Set<string>();
    return (frame:PresentationFrame):readonly string[]=>{
        const next=JSON.stringify([frame.context.session,frame.context.audience,frame.context.generation,frame.feedbackScope?.roomEpoch,frame.feedbackScope?.connectionEpoch]);
        if(next!==scope){scope=next;seen.clear();}
        const ids:string[]=[];
        for(const node of frame.nodes){if(node.kind!=='figure'||!node.ownerId||!node.figureCue)continue;
            const key=JSON.stringify([node.ownerId,node.figureCue.id]);if(seen.has(key))continue;seen.add(key);
            while(seen.size>256)seen.delete(seen.values().next().value!);
            if(!frame.modalId)ids.push(node.id);
        }
        return ids;
    };
}
export function figureCueMotionRecipe(level:'full'|'reduced'|'off',speed=1):{frames:Keyframe[];timing:KeyframeAnimationOptions}|null {
    if(level!=='full'||!Number.isFinite(speed)||speed<=0)return null;
    return {frames:[{transform:'translateY(0px) scale(1)',transformOrigin:'50% 50%'},{transform:'translateY(-3px) scale(1.03)',transformOrigin:'50% 50%'},{transform:'translateY(0px) scale(1)',transformOrigin:'50% 50%'}],timing:{duration:180*Math.min(1,speed),easing:'ease-out'}};
}
/** One surface-scoped owner for motion handles. Never delays publication or input. */
export function createDomMotion() {
    const active = new Map<string, { animation: Animation; element: SVGSVGElement }>();
    const stop = (id: string) => { const item = active.get(id); if (item) { active.delete(id); item.animation.cancel(); } };
    const clear = () => { for (const id of active.keys()) stop(id); };
    function enabled() { return motion.level === 'full'; }
    return {
        clear,
        listen() {
            const preference = matchMedia('(prefers-reduced-motion: reduce)');
            const changed = () => { if (!enabled() || preference.matches) clear(); };
            const observer = new MutationObserver(changed);
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
            preference.addEventListener('change', changed);
            return () => { observer.disconnect(); preference.removeEventListener('change', changed); clear(); };
        },
        /** Read all current poses before publication writes, then retarget from those poses. */
        prepare(previous: PresentationFrame | null, next: PresentationFrame) {
            if (!enabled()) { clear(); return []; }
            const tracks = selectionTracks(previous, next);
            const valid = previous && previous.environment.revision === next.environment.revision && previous.offerId === next.offerId && JSON.stringify(previous.context) === JSON.stringify(next.context);
            if (!valid) clear();
            const poses = tracks.map(track => {
                const item = active.get(track.id);
                const transform = item ? getComputedStyle(item.element).transform : 'none';
                const offset = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
                return { ...track, fromY: track.fromY + offset };
            });
            for (const track of tracks) stop(track.id);
            for (const id of active.keys()) {
                const before = previous?.nodes.find(node => node.id === id), after = next.nodes.find(node => node.id === id);
                let stable = !!before && !!after && (before.cardId === after.cardId && !!after.cardId || before.kind==='figure'&&after.kind==='figure'&&!!after.figureCue&&before.figureCue?.id===after.figureCue.id) && before.parent === after.parent &&
                    JSON.stringify(before.box) === JSON.stringify(after.box) && JSON.stringify(before.visual) === JSON.stringify(after.visual);
                let parent = after?.parent ?? null;
                while (stable && parent !== null) {
                    const oldParent = previous?.nodes.find(node => node.id === parent), newParent = next.nodes.find(node => node.id === parent);
                    stable = !!oldParent && !!newParent && oldParent.parent === newParent.parent && JSON.stringify(oldParent.box) === JSON.stringify(newParent.box);
                    parent = newParent?.parent ?? null;
                }
                if (!stable) stop(id);
            }
            return poses;
        },
        play(tracks: readonly { id: string; fromY: number }[], elements: ReadonlyMap<string, HTMLElement>) {
            if (!enabled()) return;
            for (const track of tracks) {
                const element = elements.get(track.id)?.firstElementChild;
                if (!(element instanceof SVGSVGElement) || typeof element.animate !== 'function' || Math.abs(track.fromY) < .01) continue;
                const animation = element.animate([{ transform: `translateY(${track.fromY}px)` }, { transform: 'translateY(0px)' }],
                    { duration: SELECTION_DURATION * motion.speed, easing: SELECTION_EASING });
                active.set(track.id, { animation, element });
                const release = () => { if (active.get(track.id)?.animation === animation) active.delete(track.id); };
                // cancel() rejects finished; both outcomes release only their own handle.
                void animation.finished.then(release, release);
            }
        },
        cue(id:string,elements:ReadonlyMap<string,HTMLElement>){
            const recipe=figureCueMotionRecipe(motion.level,motion.speed),element=elements.get(id)?.firstElementChild;
            if(!recipe||!(element instanceof SVGSVGElement)||typeof element.animate!=='function')return;
            stop(id);
            try{const animation=element.animate(recipe.frames,recipe.timing);active.set(id,{animation,element});const release=()=>{if(active.get(id)?.animation===animation)active.delete(id);};void animation.finished.then(release,release);}catch{/* Optional cue paint never changes authority. */}
        },
        refuse(id:string,elements:ReadonlyMap<string,HTMLElement>){
            const recipe=refusalMotionRecipe(motion.level,motion.speed);
            const element=elements.get(id)?.firstElementChild;
            if(!recipe||!(element instanceof SVGSVGElement)||typeof element.animate!=='function')return;
            stop(id);
            try {
                const animation=element.animate(recipe.frames,recipe.timing);
                active.set(id,{animation,element});
                const release=()=>{if(active.get(id)?.animation===animation)active.delete(id);};
                void animation.finished.then(release,release);
            }catch{/* Optional refusal paint cannot affect input or inspection. */}
        },
        count: () => active.size,
    };
}
