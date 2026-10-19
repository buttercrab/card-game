import {textFontFamily} from './informationTypography';
import {captureCompletionReceiveSource,completionReceiveNativeProof} from './completionReceive';
import {nativeCompletionInputReady} from './domCompletionInput';
import {createDomPaintResources} from './domPaintResources';
import {createDomTrickResolution} from './domTrickResolution';
import {planTrickResolution} from './trickResolution';
import {MEASUREMENT_BATCH_LIMIT} from './measurementLimits';
import {queueMeasurementTurn} from './measurementTurn';
import {requiresEssentialTransfer} from './transferMotion';
import {paintObserverReactions} from './domObserverReactions';
import {motion as motionPreference} from '../../settings.svelte';
import {createDomRecycle} from './domRecycle';
import {essentialInputMask} from './essentialInput';
import {paintNativeCardAccessibility} from './nativeCardAccessibility';
import {paintNativeGroupSurface} from './nativeGroupPaint';
import {createEssentialSurface} from './essentialSurface';
import {nativeTextControlStyle} from './nativeTextControl';
import {paintNativeTextContent} from './nativeTextPaint';
import {createJointPointerPaint,jointPointerNodeIds} from './jointPointerPaint';
import {paintNativeButtonAvailability} from './nativeButtonPaint';
import {tabNavigationTarget} from './tabNavigation';
import {ownConcealment} from './concealment';
import {implicitFormSubmit} from './formActivation';
import {createActivationCapture,type ActivationBinding} from './activationCapture';
import {sameBackMotionSpace} from './transferPolicy';
import {flushSync} from 'svelte';
import {mountArtwork} from './artwork.svelte';
import type { Environment, MeasureRequest, PlannedNode, PresentationFrame, SurfaceCallbacks, SurfacePort } from './contracts';
import { typography,pendingFormAllocation } from './planner';
import { createFontResources } from './fontResources';
import {measurementFontLoads} from './measurementFontLoads';
import { createDomMotion,createFigureCueGate } from './domMotion';
import { createDomTransfers } from './domTransfers';
/** Engine host adapter: one listener scope and one publisher, no game callbacks. */
export function createDomSurface(host: HTMLElement): SurfacePort & {
    timings(): Readonly<{ measurementCpuMs: number; measurementWaitMs: number; rounds: number; requests: number; publishCpuMs: number; publishes: number; environmentCpuMs: number; lastMetricsAt: number }>;
    setTextScale(scale: number): void;
    resources(): Readonly<{
        listeners: number;
        probes: number;
        animations: number;
        artworks: number;
    }>;
} {
    let callbacks: SurfaceCallbacks | null = null, frame: PresentationFrame | null = null, nativePublication:PresentationFrame|null=null, revision = 0, textScale = 1, lastPublished = 0, patching = false, restoringFocus = false;
    const fontResources = createFontResources();
    const paintJointPointer=createJointPointerPaint();
    const motion = createDomMotion();
    const figureCues=createFigureCueGate();
    let essentialOwnerToken:string|null=null,essentialFrameId=0,essentialSequence=0;
    const paintResources=createDomPaintResources({current:()=>nativePublication??frame});
    const transfers = createDomTransfers(host,report=>callbacks?.settlement?.(report),concealPresentation,()=>{if(transfers.count()===0)recycle.finish();finishEssentialIfIdle();revealPublicDisclosures();},{hidden:current=>essential.hidden(current),owner:()=>essentialOwnerToken,concealed:id=>currentlyConcealed(id),recycleCurrent:(origin,current)=>recycle.current(origin,current),current:()=>nativePublication??frame,paint:paintResources,content:()=>content});
    const recycle=createDomRecycle({host,paint:paintResources,conceal:concealPresentation,current:()=>nativePublication??frame,ready:()=>host.dataset.foundationStatus==='ready',onReady(origin){const current=frame;if(!current||current.id!==origin.frameId){recycle.clear();return;}const pending=transfers.recycled(origin,current);transfers.play(pending,current,elements);if(transfers.count()===0)recycle.finish();finishEssentialIfIdle();revealPublicDisclosures();},onCancel(evidence){transfers.cancelRecycle(evidence.owner);},onIdle(){finishEssentialIfIdle();revealPublicDisclosures();}});
    const trick=createDomTrickResolution({host,geometry:transfers,paint:paintResources,completionEnd(current,event,outcome){callbacks?.publicCompletionEnd?.(current.id,event,outcome);},current:()=>nativePublication??frame,ready:()=>host.dataset.foundationStatus==='ready'&&!patching,admitted(current){const recipe=essentialInputMask(current);return recipe?essential.acknowledged(current):!current.nodes.some(node=>node.enabled&&(node.actionId||node.fieldId||node.cardId||node.inspectCardId||node.cardActionOptionId||node.cardActionPickerIntent||node.catalogueIntent||node.localIntent==='submit-card-set'));},settle:(current,ids,outcome)=>transfers.settleEntities(current,ids,outcome),onIdle(){finishEssentialIfIdle();revealPublicDisclosures();}});
    function finishEssentialIfIdle(){
        if(!essentialOwnerToken||transfers.count()!==0||recycle.count()!==0||trick.count()!==0||host.dataset.foundationStatus!=='ready')return;
        const owner=essentialOwnerToken,frameId=essentialFrameId;essentialOwnerToken=null;essentialFrameId=0;
        // Restored native controls may differ from the masked scroll content.
        // Remove passive paint before restoration, then recheck current geometry
        // synchronously before the browser can paint either resource.
        if(frame)paintObserverReactions(host,frame,elements,false);
        essential.release(frameId,owner);
        if(frame)paintObserverReactions(host,frame,elements,host.dataset.foundationStatus==='ready');
    }
    function revealPublicDisclosures(){
        const current=frame;if(!current||host.dataset.foundationStatus!=='ready')return;
        const roots=current.nodes.filter(node=>node.parent==='table'&&node.publicDisclosureEventId);
        for(const root of roots){const element=elements.get(root.id);if(!element)continue;
            const shown=!current.modalId&&transfers.count()===0&&recycle.count()===0&&trick.count()===0;
            element.style.opacity=shown?'1':'0';element.setAttribute('aria-hidden',String(!shown));
            for(const scroll of element.querySelectorAll<HTMLElement>('[data-foundation-kind=group]')){const node=current.nodes.find(node=>node.id===scroll.dataset.foundationNode);if(node?.scroll)scroll.tabIndex=shown?0:-1;}
            if(!shown&&document.activeElement instanceof HTMLElement&&element.contains(document.activeElement)){restoringFocus=true;try{document.activeElement.blur();}finally{restoringFocus=false;}}
            if(!shown)continue;
            const card=current.nodes.find(node=>node.kind==='card'&&node.publicDisclosureEventId===root.publicDisclosureEventId),paint=card&&elements.get(card.id);if(!paint)continue;
            const bounds=paint.getBoundingClientRect(),hostBounds=host.getBoundingClientRect();
            let left=Math.max(0,hostBounds.left),top=Math.max(0,hostBounds.top),right=Math.min(innerWidth,hostBounds.right),bottom=Math.min(innerHeight,hostBounds.bottom);
            for(let parent=paint.parentElement;parent;parent=parent.parentElement){const css=getComputedStyle(parent);if(/(auto|scroll|hidden|clip)/.test(`${css.overflowX} ${css.overflowY}`)){const clip=parent.getBoundingClientRect();left=Math.max(left,clip.left+parent.clientLeft);top=Math.max(top,clip.top+parent.clientTop);right=Math.min(right,clip.left+parent.clientLeft+parent.clientWidth);bottom=Math.min(bottom,clip.top+parent.clientTop+parent.clientHeight);}}
            if(bounds.width>0&&bounds.height>0&&bounds.left>=left-.5&&bounds.top>=top-.5&&bounds.right<=right+.5&&bounds.bottom<=bottom+.5)callbacks?.feedbackPresented?.(current.id,[root.publicDisclosureEventId!]);
        }
    }
    let reportedRevision: string | null = null;
    let previousSignature = '', currentEnvironment: Environment | null = null, listeners = 0, probes = 0;
    const timing = { measurementCpuMs: 0, measurementWaitMs: 0, rounds: 0, requests: 0, publishCpuMs: 0, publishes: 0, environmentCpuMs: 0, lastMetricsAt: 0 };
    const elements = new Map<string, HTMLElement>();
    let nativeConcealed:{frameId:number;owner:string;targets:ReadonlyMap<string,{element:HTMLElement;art:Element|null;opacity:string}>}|null=null;
    let concealRevision=0;
    const currentlyConcealed=(id:string)=>nativeConcealed?.targets.has(id)??false;
    type EditorElement=HTMLInputElement|HTMLTextAreaElement;
    let preservedLease:string|null=null, preservedModalLease:string|null=null;
    let preservedFieldLeases:Readonly<Record<string,string>>|undefined;
    const composing=new Set<EditorElement>();
    const settlingComposition=new WeakSet<EditorElement>();
    let composingEscape=false;
    const isEditor=(element:HTMLElement):element is EditorElement=>(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement)&&element.dataset.foundationKind==='editor';
    const preservedDialog=()=>{const current=frame;return current?.nodes.find(node=>node.id===current.modalId&&(node.formLeaseId===preservedLease&&!!preservedLease||(node.modalLeaseId===preservedModalLease||node.choiceLeaseId===preservedModalLease)&&!!preservedModalLease));};
    const preservesEditor=(element:EditorElement)=>element.dataset.foundationLease===preservedLease&&(!preservedFieldLeases||preservedFieldLeases[element.dataset.foundationField??'']===element.dataset.foundationFieldLease&&!!element.dataset.foundationFieldLease);
    const nodeDomId=(id:string)=>`foundation-${encodeURIComponent(id)}`;
    function applyPendingForm(next:Environment){
        if(!frame||!preservedDialog()||frame.environment.revision===next.revision)return;
        const plan=pendingFormAllocation(frame,next);if(!plan||plan.leaseId!==(preservedDialog()?.formLeaseId??preservedDialog()?.modalLeaseId??preservedDialog()?.choiceLeaseId))return;
        const hostRect=host.getBoundingClientRect();
        for(const placement of plan.placements){
            const element=elements.get(placement.id);if(!element)continue;
            const box=placement.box,isDialog=placement.id===plan.dialogId;
            Object.assign(element.style,{left:`${box.x+(isDialog?hostRect.left:0)}px`,top:`${box.y+(isDialog?hostRect.top:0)}px`,width:`${box.width}px`,height:`${box.height}px`});
            if(placement.scrollBoth){element.style.overflowX='auto';element.style.overflowY='auto';}
        }
    }
    type NativeControl = HTMLSelectElement | HTMLInputElement;
    const isNative = (element:HTMLElement): element is NativeControl => element instanceof HTMLSelectElement || element instanceof HTMLInputElement&&element.type==='range';
    let nativeCaptures = new WeakMap<NativeControl,{frameId:number;nodeId:string;cancelled?:boolean}>();
    const physical=createActivationCapture();
    const releaseTimers=new Set<ReturnType<typeof setTimeout>>();
    const bindingOf=(element:HTMLElement):ActivationBinding=>({frameId:Number(element.dataset.foundationFrame),nodeId:element.dataset.foundationNode!});
    const artworks=new Map<string,ReturnType<typeof mountArtwork>>();
    const removeArt=(id:string)=>{artworks.get(id)?.destroy();artworks.delete(id);};
    let content: HTMLDivElement | null = null;
    function environment(): Environment {
        const started = performance.now();
        const fontRevision = fontResources.revision(document.fonts ?? []);
        const hostStyle=getComputedStyle(host);
        const width=host.clientWidth,height=host.clientHeight,fontFamily=hostStyle.fontFamily;
        const artFontFamily=hostStyle.getPropertyValue('--font-display').trim()||fontFamily;
        // Read the actual shared primitives, batching writes before style/layout
        // reads so one environment sample does not force a flush per probe.
        const controlProbes=(['command','choice'] as const).map(kind=>{
            const probe=document.createElement('button');
            probe.className=kind==='choice'?'chip':'btn';
            probe.setAttribute('aria-hidden','true');probe.inert=true;
            if(kind==='choice')probe.setAttribute('aria-checked','true');
            Object.assign(probe.style,{position:'fixed',visibility:'hidden',pointerEvents:'none'});
            return {kind,probe};
        });
        const scrollbarProbe=document.createElement('div');
        scrollbarProbe.inert=true;scrollbarProbe.setAttribute('aria-hidden','true');
        Object.assign(scrollbarProbe.style,{position:'fixed',visibility:'hidden',pointerEvents:'none',width:'100px',height:'100px',left:'0',top:'0',overflow:'scroll',contain:'strict',border:'0',padding:'0'});
        host.append(...controlProbes.map(item=>item.probe),scrollbarProbe);
        let controls:Environment['controls'],scrollbarWidth:number,scrollbarHeight:number;
        try {
            controls=Object.freeze(Object.fromEntries(controlProbes.map(({kind,probe})=>{
                const css=getComputedStyle(probe);
                return [kind,Object.freeze({fontSize:parseFloat(css.fontSize),lineHeight:parseFloat(css.lineHeight),
                    fontWeight:Number(css.fontWeight),paddingX:parseFloat(css.paddingLeft),paddingY:parseFloat(css.paddingTop),
                    minHeight:parseFloat(css.minHeight),pulse:kind==='choice'?parseFloat(css.getPropertyValue('--pulse'))||1:1})];
            }))) as unknown as Environment['controls'];
            scrollbarWidth=scrollbarProbe.offsetWidth-scrollbarProbe.clientWidth;
            scrollbarHeight=scrollbarProbe.offsetHeight-scrollbarProbe.clientHeight;
        }finally{for(const {probe} of controlProbes)probe.remove();scrollbarProbe.remove();}
        const signature = JSON.stringify([width, height, scrollbarWidth, scrollbarHeight, fontFamily, artFontFamily, fontRevision, textScale, controls]);
        if (signature !== previousSignature || !currentEnvironment) {
            previousSignature = signature;
            currentEnvironment = Object.freeze({ width, height, scrollbarWidth, scrollbarHeight, fontFamily, artFontFamily, fontRevision: String(fontRevision), textScale, controls, revision: String(++revision) });
        }
        timing.environmentCpuMs += performance.now() - started;
        return currentEnvironment;
    }
    function reportEnvironment(next = environment()) {
        if (callbacks && next.revision !== reportedRevision) {
            reportedRevision = next.revision;
            callbacks.environment(next);
            applyPendingForm(next);
        }
    }
    function textStyle(element: HTMLElement, role: PlannedNode['role'], env: Environment) {
        const style = typography(role ?? 'body', env);
        Object.assign(element.style, { fontFamily: textFontFamily(role??'body',env), fontSize: `${style.fontSize}px`, lineHeight: `${style.lineHeight}px`, fontWeight: String(style.fontWeight), fontVariantNumeric:role==='information-number'?'tabular-nums':'', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', letterSpacing: 'normal' });
    }
    const target = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-foundation-node]') : null;
    const selectTarget = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLSelectElement>('select[data-foundation-node]') : null;
    const rangeTarget = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLInputElement>('input[type=range][data-foundation-node]') : null;
    const nativeTarget = (event:Event) => selectTarget(event) ?? rangeTarget(event);
    const editorTarget = (event:Event)=>event.target instanceof Element?event.target.closest<EditorElement>('input[data-foundation-kind=editor],textarea[data-foundation-kind=editor]'):null;
    const controlTarget = (event: Event) => target(event) ?? nativeTarget(event) ?? editorTarget(event);
    const interactive = (element:HTMLElement) => !essential.blocked(element.dataset.foundationNode??'')&&!element.closest('[inert],[aria-hidden="true"]')&&(!frame?.modalId||!!elements.get(frame.modalId)?.contains(element));
    const restoreNative = (element:NativeControl) => {
        const committed=frame?.nodes.find(node=>node.id===element.dataset.foundationNode&&(node.kind==='select'||node.kind==='range'));
        if(element instanceof HTMLInputElement){if(committed?.preference?.kind==='number')element.value=String(committed.preference.value);return;}
        if(committed?.selectedOptionId===undefined)element.selectedIndex=-1;else element.value=committed.selectedOptionId;
    };
    const captureNative = (element:NativeControl|null) => {
        if(element&&host.contains(element)&&interactive(element)&&!element.disabled&&(!nativeCaptures.has(element)||nativeCaptures.get(element)?.cancelled)){const capture={frameId:Number(element.dataset.foundationFrame),nodeId:element.dataset.foundationNode!};nativeCaptures.set(element,capture);callbacks?.intent({kind:'begin',...capture});}
    };
    const cancelNative = (element:NativeControl) => {
        const capture=nativeCaptures.get(element);
        if(capture)capture.cancelled=true;
        else nativeCaptures.set(element,{frameId:Number(element.dataset.foundationFrame),nodeId:element.dataset.foundationNode!,cancelled:true});
        restoreNative(element);
    };
    const cancelNativeCaptures = () => {
        for(const element of elements.values())if(isNative(element)&&nativeCaptures.has(element))cancelNative(element);
    };
    const essential=createEssentialSurface({
        elements,current:()=>frame,ready:()=>host.dataset.foundationStatus==='ready',
        admit:(frameId,owner,active)=>callbacks?.essential?.(frameId,owner,active)===true,
        cancelGestures(){physical.cancel();cancelNativeCaptures();},
        blur(element){restoringFocus=true;try{element.blur();}finally{restoringFocus=false;}},
    });
    function concealPresentation(frameId:number,nodeIds:readonly string[],owner:string):boolean {
        const owned=ownConcealment(frameId,nodeIds,owner);if(!owned)return false;
        ({frameId,nodeIds,owner}=owned);
        const currentCallbacks=callbacks;if(!currentCallbacks)return false;
        const prior=nativeConcealed;
        if(prior&&prior.owner!==owner)return false;
        physical.cancel();cancelNativeCaptures();
        if(!nodeIds.length){
            if(!prior||prior.frameId!==frameId)return false;
            nativeConcealed=null;concealRevision++;
            let accepted=false;try{accepted=currentCallbacks.conceal?.(frameId,[],owner)===true;}catch{/* Local cleanup must still finish. */}
            for(const [id,owned] of prior.targets){
                const element=elements.get(id);
                if(element!==owned.element||element.firstElementChild!==owned.art||currentlyConcealed(id))continue;
                element.removeAttribute('aria-hidden');delete element.dataset.foundationConcealed;
                if(owned.art instanceof SVGSVGElement)owned.art.style.opacity=owned.opacity;
                if(element instanceof HTMLButtonElement&&frame?.id===Number(element.dataset.foundationFrame)&&host.dataset.foundationStatus==='ready')element.disabled=essential.blocked(id)||!frame.nodes.find(node=>node.id===id)?.enabled;
            }
            return accepted;
        }
        const targets=new Map<string,{element:HTMLElement;art:Element|null;opacity:string}>();
        for(const id of nodeIds){const element=elements.get(id);if(typeof id!=='string'||id.length>2048||!element||element.dataset.foundationFrame!==String(frameId)||element.dataset.foundationKind!=='card'||element.dataset.foundationZone!=='hand')return false;const art=element.firstElementChild,existing=prior?.targets.get(id);targets.set(id,{element,art,opacity:existing?.element===element&&existing.art===art?existing.opacity:art instanceof SVGSVGElement?art.style.opacity:''});}
        const candidate={frameId,owner,targets},token=++concealRevision;nativeConcealed=candidate;
        let accepted=false;try{accepted=currentCallbacks.conceal?.(frameId,nodeIds,owner)===true;}catch{/* Failed admission cannot conceal authorized controls. */}
        if(!accepted||callbacks!==currentCallbacks||concealRevision!==token||nativeConcealed!==candidate){if(nativeConcealed===candidate){nativeConcealed=prior;concealRevision++;}return false;}
        for(const {element,art} of targets.values()){
            if(art instanceof SVGSVGElement)art.style.opacity='0';
            if(element instanceof HTMLButtonElement)element.disabled=true;
            if(document.activeElement===element){restoringFocus=true;try{element.blur();}finally{restoringFocus=false;}}
            element.setAttribute('aria-hidden','true');element.dataset.foundationConcealed='true';
        }
        return true;
    }
    function forward(kind: 'begin' | 'activate', element: HTMLButtonElement | null, captured?:ActivationBinding, direct=false) {
        if (element && !element.disabled && host.contains(element) && interactive(element)) {
            // compositionend can precede its final input in the same task.
            // Never turn that boundary into an automatic or stale-text submit.
            if(kind==='activate'&&frame?.nodes.some(node=>node.editor&&elements.get(node.id)&&settlingComposition.has(elements.get(node.id) as EditorElement)))return;
            // ResizeObserver delivery can lag a native keyup/click. Fence input
            // against the current allocation before trusting a committed binding.
            const current = environment();
            if (current.revision !== reportedRevision || (frame && current.revision !== frame.environment.revision)) {
                reportEnvironment(current);
                callbacks?.intent({ kind: 'cancel' });
                return;
            }
            if(captured&&captured.nodeId!==element.dataset.foundationNode)return;
            const binding=captured??bindingOf(element);
            callbacks?.intent(kind==='activate'&&direct?{kind,...binding,provenance:'direct'}:{kind,...binding});
        }
    }
    const tagFor = (node: PlannedNode) => node.kind==='editor'?(node.editor?.kind==='multiline'?'textarea':'input'):node.kind==='group'&&(node.semanticRole==='dialog'||node.semanticRole==='alertdialog')?'dialog':node.kind==='range'?'input':node.kind === 'select' ? 'select' : node.kind === 'command' || node.kind === 'choice' || node.kind==='toggle' || node.cardId || node.inspectCardId ? 'button' : node.kind === 'text' ? 'span' : 'div';
    const hasArtwork = (node: PlannedNode) => node.kind === 'figure' || node.kind === 'card' || node.kind === 'suit' || node.kind === 'progress' || node.kind==='icon'||node.kind==='toggle';
    const closeDialog=(element:HTMLElement)=>{if(element instanceof HTMLDialogElement&&element.open)element.close();};
    function retireEditor(element:EditorElement){
        composing.delete(element);
        settlingComposition.delete(element);
        element.disabled=true;
        // Revocation also erases stale detached references held by a native
        // composition or an external event queue. This never runs for a
        // compatible publication of the same editor island.
        element.value='';
        element.defaultValue='';
        element.removeAttribute('data-foundation-lease');
        element.removeAttribute('data-foundation-field');
        element.removeAttribute('data-foundation-field-lease');
    }
    function retireElement(id:string,element:HTMLElement,retainedIds?:ReadonlySet<string>){
        if(isEditor(element))retireEditor(element);
        for(const child of element.querySelectorAll<HTMLElement>('[data-foundation-kind=editor]')){
            if(isEditor(child)&&!retainedIds?.has(child.dataset.foundationNode!))retireEditor(child);
        }
        closeDialog(element);removeArt(id);element.remove();
    }

    function make(node: PlannedNode): HTMLElement {
        const element = document.createElement(tagFor(node));
        element.dataset.foundationNode = node.id;
        element.dataset.foundationKind = node.kind;
        Object.assign(element.style, { position: 'absolute', boxSizing: 'border-box', margin: '0', minWidth: '0', minHeight: '0', border: '0' });
        if(element instanceof HTMLSelectElement)Object.assign(element.style,nativeTextControlStyle);
        if(element instanceof HTMLInputElement&&node.kind==='range'){element.type='range';Object.assign(element.style,{padding:'0',background:'none'});}
        if(isEditor(element)){
            if(element instanceof HTMLInputElement){element.type='text';element.inputMode=node.editor?.kind==='number'?'decimal':'text';}
            Object.assign(element.style,{...nativeTextControlStyle,resize:'none'});
        }
        if(element instanceof HTMLDialogElement){element.className='foundation-modal';element.tabIndex=-1;Object.assign(element.style,{position:'fixed',padding:'0',maxWidth:'none',maxHeight:'none',background:'var(--panel)',color:'var(--ink)',borderRadius:'var(--r-panel)'});}
        if (element instanceof HTMLButtonElement) {
            element.type = 'button';
            
        }
        if (hasArtwork(node)) {
            if(node.kind==='icon')element.setAttribute('aria-hidden','true');
            else {if (!(element instanceof HTMLButtonElement)) element.setAttribute('role', 'img');element.setAttribute('aria-label', node.label);
                    if(node.accessibleDescription)element.setAttribute('aria-description',node.accessibleDescription);else if(!node.preference)element.removeAttribute('aria-description');}

        }
        return element;
    }
    function clear(preserveLease?:string) {
        const current=frame,dialog=preserveLease&&(preserveLease===preservedLease||preserveLease===preservedModalLease)?preservedDialog():undefined;
        const keep=dialog&&elements.get(dialog.id) instanceof HTMLDialogElement?dialog:undefined;
        nativeCaptures=new WeakMap();trick.clear();paintResources.clear();transfers.clear();recycle.clear();essential.clear();essentialOwnerToken=null;essentialFrameId=0;nativeConcealed=null;concealRevision++;motion.clear();
        if(current&&keep){
            const retainedIds=new Set([keep.id]);
            // Planned parent-before-child order gives the exact leased island,
            // independent of its actual top-layer DOM parent.
            for(const node of current.nodes)if(node.parent&&retainedIds.has(node.parent))retainedIds.add(node.id);
            const retainedNodes=current.nodes.filter(node=>retainedIds.has(node.id));
            const rootId=keep.parent??'table',width=current.environment.width,height=current.environment.height;
            const root:PlannedNode={id:rootId,parent:null,kind:'group',label:'',arrangement:'overlay',box:{x:0,y:0,width,height}};
            // Drop every old game node and transition payload. Retaining the
            // generic viewport metadata permits pending edit allocation without
            // retaining the previous private hand in this adapter's frame.
            frame=Object.freeze({id:current.id,environment:current.environment,context:current.context,offerId:current.offerId,
                width,height,recipe:current.recipe,modalId:keep.id,
                ...(current.focusId&&retainedIds.has(current.focusId)?{focusId:current.focusId}:{}),
                nodes:Object.freeze([root,...retainedNodes.map(node=>node.id===keep.id?{...node,parent:rootId}:node)])});
            for(const [id,element] of elements)if(!retainedIds.has(id)){retireElement(id,element,retainedIds);elements.delete(id);}
            for(const id of artworks.keys())if(!retainedIds.has(id))removeArt(id);
            for(const element of composing)if(!retainedIds.has(element.dataset.foundationNode??''))composing.delete(element);
            content?.remove();content=null;
            host.dataset.foundationStatus='pending';
            return;
        }
        preservedLease=null;preservedModalLease=null;preservedFieldLeases=undefined;composingEscape=false;composing.clear();
        for(const id of artworks.keys())removeArt(id);
        frame=null;
        for(const [id,element] of elements)retireElement(id,element);
        content?.remove();content=null;elements.clear();host.dataset.foundationStatus='empty';
    }
    const port = {
        identity: host,
        captureCompletionReceiveSource(frameId,participantId){return !patching&&frame?.id===frameId&&content&&host.dataset.foundationStatus==='ready'?captureCompletionReceiveSource(frame,participantId,host,elements,content):null;},
        environment,
        listen(next: SurfaceCallbacks) {
            if (callbacks)
                throw new Error('DOM surface already attached');
            let rollback=()=>{};
            try{
            callbacks = next;
            let active=true;
            reportedRevision=currentEnvironment?.revision??environment().revision;
            listeners = 1;
            const stopMotion = motion.listen();
            rollback=()=>{stopMotion();};
            const stopTransfers = transfers.listen();
            rollback=()=>{stopTransfers();stopMotion();};
            const stopTrick=trick.listen();rollback=()=>{stopTrick();stopTransfers();stopMotion();};
            const motionPreferenceChanged=()=>{if(motionPreference.level!=='full'){recycle.clear();finishEssentialIfIdle();}};
            const recyclePreference=matchMedia('(prefers-reduced-motion: reduce)'),recycleObserver=new MutationObserver(motionPreferenceChanged);rollback=()=>{recycleObserver.disconnect();recyclePreference.removeEventListener('change',motionPreferenceChanged);stopTrick();stopTransfers();stopMotion();};recycleObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});recyclePreference.addEventListener('change',motionPreferenceChanged);
            const changed=()=>{if(!active||callbacks!==next)return;const value=environment();if(!active||callbacks!==next)return;reportEnvironment(value);};
            const resize=changed,fonts=changed;
            const release=(source:string)=>{let capture=physical.release(source);
                // A held Space can outlive detach/remount (or originate outside
                // the host). Its keyup default click must not become a fresh AT
                // activation on the newly focused replacement control.
                if(!capture&&source==='key: '){capture=physical.begin(source,{frameId:-1,nodeId:''})??undefined;if(capture){capture.cancelled=true;capture.released=true;}}
                if(!capture)return;
                // Enter activates on keydown, so no keyup default click remains.
                if(source==='key:Enter'){physical.retire(capture);return;}
                // Native Space click occurs after keyup; pointer click after up.
                // Keep the original capture until that default action completes.
                const released=capture;const timer=setTimeout(()=>{releaseTimers.delete(timer);physical.retire(released);},0);releaseTimers.add(timer);
            };
            const begin = (event: PointerEvent) => {captureNative(nativeTarget(event));const button=target(event);
                if(!button||button.disabled||!interactive(button))return;
                const capture=physical.begin(`pointer:${event.pointerId}`,bindingOf(button));
                if(capture)forward('begin',button,capture);
            };
            const pointerUp=(event:PointerEvent)=>release(`pointer:${event.pointerId}`);
            const pointerCancel=(event:PointerEvent)=>{cancel();release(`pointer:${event.pointerId}`);};
            const keyUp=(event:KeyboardEvent)=>{if(event.key==='Enter'||event.key===' ')release(`key:${event.key}`);};
            const dismiss = (event:Event) => {
                const dialog=event.target;
                if(!(dialog instanceof HTMLDialogElement)||!host.contains(dialog))return;
                if(event.type==='cancel')event.preventDefault();
                else if(event instanceof MouseEvent){const box=dialog.getBoundingClientRect();if(event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom)return;}
                if(frame&&frame.modalId===dialog.dataset.foundationNode&&!dialog.inert&&host.dataset.foundationStatus==='ready'){
                    const modal=frame.nodes.find(node=>node.id===frame!.modalId);
                    if(modal?.formLeaseId){
                        if(composingEscape||[...composing].some(element=>dialog.contains(element)))return;
                        callbacks?.intent({kind:'form',frameId:frame.id,leaseId:modal.formLeaseId,action:'close'});
                    }else if(frame.modalId?.startsWith('assistance-'))callbacks?.intent({kind:'assistance-dismiss',frameId:frame.id});
                    else callbacks?.intent({kind:'dismiss',frameId:frame.id});
                }
            };
            const click = (event: MouseEvent) => {const button=target(event);
                if(button){const activation=physical.activation(event.detail>0,event instanceof PointerEvent&&event.pointerId>=0?event.pointerId:undefined);
                    if(activation.kind==='direct')forward('activate',button,undefined,true);
                    else if(activation.kind==='physical')forward('activate',button,activation.binding);
                }dismiss(event);};
            const cancel = () => {
                if(frame)paintObserverReactions(host,frame,elements,host.dataset.foundationStatus==='ready');
                physical.cancel();
                cancelNativeCaptures();
                callbacks?.intent({ kind: 'cancel' });
            };
            const abandon=()=>{physical.abandon();cancelNativeCaptures();callbacks?.intent({kind:'cancel'});};
            const change = (event:Event) => {
                const element=nativeTarget(event);
                if(!element||!host.contains(element))return;
                if(!interactive(element)){cancelNative(element);restoreNative(element);return;}
                const uncaptured=!nativeCaptures.has(element);
                const capture={...(nativeCaptures.get(element)??{frameId:Number(element.dataset.foundationFrame),nodeId:element.dataset.foundationNode!,cancelled:false})};
                const current=environment(),node=frame?.nodes.find(node=>node.id===capture.nodeId);
                if(current.revision!==reportedRevision||current.revision!==frame?.environment.revision){cancelNative(element);reportEnvironment(current);callbacks?.intent({kind:'cancel'});restoreNative(element);return;}
                const validSelect=element instanceof HTMLSelectElement&&node?.kind==='select'&&node.options?.some(option=>option.id===element.value&&option.enabled);
                const field=node?.preference;
                const numeric=Number(element.value);
                const validRange=element instanceof HTMLInputElement&&node?.kind==='range'&&field?.kind==='number'&&Number.isFinite(numeric)&&numeric>=field.min&&numeric<=field.max&&Math.abs((numeric-field.min)/field.step-Math.round((numeric-field.min)/field.step))<1e-7;
                if(capture.cancelled||element.disabled||capture.frameId!==frame?.id||!node?.enabled||!(validSelect||validRange)){cancelNative(element);restoreNative(element);return;}
                // A completed native/AT change retires its capture. Only a
                // cancelled popup leaves a tombstone requiring a fresh gesture.
                nativeCaptures.delete(element);
                if(node.formField)callbacks?.intent({kind:'form-field',frameId:capture.frameId,nodeId:capture.nodeId,value:element.value});
                else if(node.preference)callbacks?.intent({kind:'preference',frameId:capture.frameId,nodeId:capture.nodeId,value:element instanceof HTMLInputElement?numeric:element.value});
                else callbacks?.intent({kind:'choose',frameId:capture.frameId,nodeId:capture.nodeId,optionId:element.value,...(uncaptured?{provenance:'direct' as const}:{})});
                // Native value changes are drafts; the committed frame remains
                // authoritative even when a stale/guarded choice is ignored.
                restoreNative(element);
            };
            const edit=(event:Event)=>{
                const element=editorTarget(event);if(!element||!host.contains(element)||element.disabled||!interactive(element))return;
                const node=frame?.nodes.find(node=>node.id===element.dataset.foundationNode&&node.kind==='editor');
                const editor=node?.editor;if(!editor||editor.leaseId!==element.dataset.foundationLease||editor.fieldLeaseId!==element.dataset.foundationFieldLease||!node.enabled)return;
                if(host.dataset.foundationStatus!=='ready'&&preservedLease!==editor.leaseId)return;
                let composition:'start'|'update'|'end'|'input'='input';
                if(event.type==='compositionstart'){composing.add(element);composition='start';}
                else if(event.type==='compositionend'){
                    composing.delete(element);composition='end';settlingComposition.add(element);
                    const timer=setTimeout(()=>{settlingComposition.delete(element);releaseTimers.delete(timer);},0);releaseTimers.add(timer);
                }
                else if(event.type==='compositionupdate'||composing.has(element)||event instanceof InputEvent&&event.isComposing)composition='update';
                callbacks?.intent({kind:'edit',leaseId:editor.leaseId,fieldId:editor.fieldId,...(editor.fieldLeaseId?{fieldLeaseId:editor.fieldLeaseId}:{}),value:element.value,composition});
            };
            const blur = (event: FocusEvent) => { const button = controlTarget(event); if (!patching && !restoringFocus && button){
                physical.cancel(button.dataset.foundationNode);
                if(isNative(button)){if(nativeCaptures.has(button))cancelNative(button);restoreNative(button);}
                callbacks?.intent({ kind: 'cancel', nodeId: button.dataset.foundationNode! });} };
            const focus = (event: FocusEvent) => {
                // Opacity suppresses paint without changing inherited styles.
                // Explicitly reject programmatic focus into a suspended tree too.
                if(event.target instanceof HTMLElement&&!!content?.contains(event.target)&&!!event.target.closest('[aria-hidden="true"]')){
                    restoringFocus=true;try{event.target.blur();}finally{restoringFocus=false;}return;
                }
                if(patching||restoringFocus)return;
                const button = controlTarget(event); if (button && host.contains(button)){
                if(isNative(button)&&!button.disabled&&interactive(button)&&!patching&&!restoringFocus&&host.dataset.foundationStatus==='ready'&&nativeCaptures.get(button)?.cancelled)nativeCaptures.delete(button);
                callbacks?.intent({ kind: 'focus', frameId: Number(button.dataset.foundationFrame), nodeId: button.dataset.foundationNode! });}
            else if(event.target instanceof HTMLElement&&host.contains(event.target)&&frame&&host.dataset.foundationStatus==='ready'&&interactive(event.target)){
                const nodeId=event.target.dataset.foundationNode;
                if(frame.nodes.some(node=>node.id===nodeId&&node.kind==='group'&&node.scroll))callbacks?.intent({kind:'focus',frameId:frame.id,nodeId:nodeId!});
            }
            else if (event.target instanceof Node && !host.contains(event.target))
                callbacks?.intent({ kind: 'focus', frameId: frame?.id ?? lastPublished, nodeId: null }); };
            const keyboard = (event: KeyboardEvent) => {
                const control=controlTarget(event);if(control&&!interactive(control))return;
                const editor=editorTarget(event);
                if(editor){
                    if(event.key==='Enter'&&editor instanceof HTMLInputElement){
                        if(event.isComposing||event.keyCode===229||composing.has(editor)||settlingComposition.has(editor))return;
                        event.preventDefault();
                        if(editor.disabled||event.repeat||host.dataset.foundationStatus!=='ready')return;
                        const submit=implicitFormSubmit(frame?.nodes??[],editor.dataset.foundationLease??'');
                        const button=submit?elements.get(submit.id):null;
                        if(button instanceof HTMLButtonElement){
                            const capture=physical.begin('key:Enter',bindingOf(button));
                            if(capture){forward('begin',button,capture);if(!capture.cancelled)forward('activate',button,capture);capture.consumed=true;}
                        }
                        return;
                    }
                    if(event.key==='Escape'&&(event.isComposing||composing.has(editor))){
                        // The IME owns Escape. Suppress only the ensuing dialog
                        // cancel, including browsers that end composition first.
                        composingEscape=true;
                        const timer=setTimeout(()=>{composingEscape=false;releaseTimers.delete(timer);},0);releaseTimers.add(timer);
                    }
                    return;
                }
                const select=nativeTarget(event);
                if(select){
                    if(event.key==='Escape'){cancelNative(select);restoreNative(select);}
                    else if(['Enter',' ','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)||event.key.length===1)captureNative(select);
                    return;
                }
                const button = target(event);
                if (!button)
                    return;
                if (event.key === 'Enter' || event.key === ' ') {
                    if(event.repeat||physical.get(`key:${event.key}`)&&!physical.get(`key:${event.key}`)?.abandoned&&!physical.get(`key:${event.key}`)?.released){
                        event.preventDefault();physical.cancel(button.dataset.foundationNode);callbacks?.intent({kind:'cancel',nodeId:button.dataset.foundationNode});
                    }else{
                        const capture=physical.begin(`key:${event.key}`,bindingOf(button));
                        if(capture)forward('begin',button,capture);
                    }
                    return;
                }
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || !frame)
                    return;
                const node = frame.nodes.find(node => node.id === button.dataset.foundationNode);
                if(node?.semanticRole==='tab'){
                    const next=tabNavigationTarget(frame.nodes,node.id,event.key);if(!next)return;
                    event.preventDefault();const targetTab=elements.get(next);if(targetTab instanceof HTMLButtonElement){targetTab.focus();forward('activate',targetTab,undefined,true);}return;
                }
                if (node?.kind === 'card' && (node.cardId||node.inspectCardId)) {
                    const cards = frame.nodes.filter(candidate => candidate.kind === 'card' && (candidate.cardId||candidate.inspectCardId) && candidate.enabled&&!nativeConcealed?.targets.has(candidate.id));
                    const index = cards.findIndex(candidate=>candidate.id===node.id);
                    if (index<0) return;
                    event.preventDefault();
                    const nextIndex = event.key==='Home'?0:event.key==='End'?cards.length-1:(index+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+cards.length)%cards.length;
                    elements.get(cards[nextIndex].id)?.focus();
                    return;
                }
                if(node?.assistanceIntent?.kind==='tool'&&node.assistanceIntent.optionId){
                    const options=frame.nodes.filter(candidate=>candidate.enabled&&candidate.assistanceIntent?.kind==='tool'&&candidate.assistanceIntent.optionId);
                    const index=options.findIndex(candidate=>candidate.id===node.id);if(index<0)return;
                    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+options.length)%options.length;
                    elements.get(options[next].id)?.focus();return;
                }
                if (node?.kind !== 'choice') return;
                const choices = frame.nodes.filter(candidate => candidate.kind === 'choice' && (node.cardActionOptionId!==undefined?candidate.cardActionOptionId!==undefined:candidate.cardActionOptionId===undefined&&candidate.fieldId === node.fieldId) && candidate.enabled && (!frame!.modalId||!!elements.get(frame!.modalId)?.contains(elements.get(candidate.id)??null)));
                const index = choices.findIndex(candidate => candidate.id === node.id);
                if (index < 0)
                    return;
                event.preventDefault();
                const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
                const selected = elements.get(choices[nextIndex].id) as HTMLButtonElement | undefined;
                if (selected) {
                    selected.focus();
                    forward('begin', selected);
                    forward('activate', selected);
                }
            };
            const shortcut=(event:KeyboardEvent)=>{
                const key=event.key.toUpperCase();
                if(!['H','R'].includes(key)||event.defaultPrevented||event.repeat||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey||composing.size||!frame||host.dataset.foundationStatus!=='ready')return;
                const target=event.target;
                if(target instanceof Element&&(target.closest('input,textarea,select,[contenteditable]:not([contenteditable=false])')||!host.contains(target)&&target!==document.body&&target!==document.documentElement))return;
                if(frame.modalId&&(frame.modalId!=='assistance-reactions'||key!=='R'))return;
                const current=environment();if(current.revision!==frame.environment.revision){reportEnvironment(current);return;}
                event.preventDefault();callbacks?.intent({kind:'shortcut',frameId:frame.id,key:key as 'H'|'R'});
            };
            const wheel = (event:WheelEvent) => captureNative(nativeTarget(event));
            const observer = new ResizeObserver(resize);
            const cleanup=() => { if (!active)
                return; active = false;  trick.clear();paintResources.clear();recycle.clear();essential.clear();essentialOwnerToken=null;essentialFrameId=0;physical.clear();for(const timer of releaseTimers)clearTimeout(timer);releaseTimers.clear(); nativeCaptures=new WeakMap(); stopMotion(); stopTrick();stopTransfers();recycleObserver.disconnect();recyclePreference.removeEventListener('change',motionPreferenceChanged); listeners = 0; callbacks = null; reportedRevision = null; observer.disconnect(); host.removeEventListener('pointerdown', begin); host.removeEventListener('click', click); host.removeEventListener('keydown', keyboard); document.removeEventListener('keyup',keyUp,true);document.removeEventListener('keydown',shortcut);document.removeEventListener('pointerup',pointerUp,true);document.removeEventListener('pointercancel',pointerCancel,true);window.removeEventListener('blur',abandon); host.removeEventListener('change',change);host.removeEventListener('input',edit);host.removeEventListener('compositionstart',edit);host.removeEventListener('compositionupdate',edit);host.removeEventListener('compositionend',edit); host.removeEventListener('wheel',wheel); host.removeEventListener('cancel',dismiss,true); host.removeEventListener('pointercancel', cancel); host.removeEventListener('scroll', cancel, true); host.removeEventListener('focusout', blur); document.fonts?.removeEventListener('loadingdone', fonts); document.removeEventListener('focusin', focus); };
            rollback=cleanup;
            observer.observe(host);
            host.addEventListener('pointerdown', begin);
            host.addEventListener('click', click);
            host.addEventListener('keydown', keyboard);
            document.addEventListener('keyup',keyUp,true);document.addEventListener('keydown',shortcut);
            document.addEventListener('pointerup',pointerUp,true);
            document.addEventListener('pointercancel',pointerCancel,true);
            window.addEventListener('blur',abandon);
            host.addEventListener('change',change);
            host.addEventListener('input',edit);host.addEventListener('compositionstart',edit);host.addEventListener('compositionupdate',edit);host.addEventListener('compositionend',edit);
            host.addEventListener('wheel',wheel,{passive:true});
            host.addEventListener('cancel',dismiss,true);
            host.addEventListener('pointercancel', cancel);
            host.addEventListener('scroll', cancel, true);
            host.addEventListener('focusout', blur);
            document.fonts?.addEventListener('loadingdone', fonts);
            document.addEventListener('focusin', focus);
            return cleanup;
            }catch(error){try{rollback();}finally{callbacks=null;listeners=0;reportedRevision=null;}throw error;}

        },
        measure(requests: readonly MeasureRequest[], reply: (values: readonly {
            key: string;
            size: {
                width: number;
                height: number;
            };
        }[]) => void) {
            const started = performance.now();
            timing.rounds++; timing.requests += requests.length;
            let active=true,cleanupProbe:(()=>void)|undefined,releaseTurn:(()=>void)|undefined;
            const cleanup=()=>{if(!active)return;active=false;releaseTurn?.();releaseTurn=undefined;cleanupProbe?.();cleanupProbe=undefined;};
            const reject=()=>{if(active){cleanup();reply([]);}};
            try{
                const work=()=>{
                    if(!active)return;
                    const workStarted=performance.now();
                    try{
                        const probe = document.createElement('div');
                        probe.setAttribute('aria-hidden', 'true');
                        probe.inert = true;
                        probe.dataset.foundationProbe = '';
                        Object.assign(probe.style, { position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden', pointerEvents: 'none', contain: 'layout style paint' });
                        // Clone explicit inline paint within this batch only. No
                        // inheritance, text, width, or template survives the round.
                        const templates=new Map<Environment,Map<MeasureRequest['role'],HTMLSpanElement>>();
                        const leaves=requests.map(request=>{let roles=templates.get(request.environment);if(!roles){roles=new Map();templates.set(request.environment,roles);}let template=roles.get(request.role);if(!template){template=document.createElement('span');textStyle(template,request.role,request.environment);Object.assign(template.style,{position:'absolute',display:'block',padding:'0',border:'0',margin:'0',boxSizing:'border-box'});roles.set(request.role,template);}const element=template.cloneNode(false) as HTMLSpanElement;element.style.width=request.width===null?'max-content':`${request.width}px`;element.textContent=request.text;probe.append(element);return {request,element};});
                        host.append(probe);
                        probes++;
                        cleanupProbe=()=>{probe.remove();probes--;};
                        // Ask for each measured font explicitly before trusting fonts.ready;
                        // newly appended invisible probes may not have triggered font layout yet.
                        const fonts = measurementFontLoads(requests);
                        try {
                            const loaded = document.fonts ? Promise.all(fonts.map(({font,text})=>document.fonts.load(font,text))) : Promise.resolve();
                            timing.measurementCpuMs += performance.now() - workStarted;
                            // Font readiness is the prerequisite; the batched geometry read
                            // flushes probe layout itself. An additional animation frame
                            // would paint the suspended scene before publishing its update.
                            void loaded.then(() => document.fonts?.ready ?? Promise.resolve()).then(() => {
                                if(!active)return;
                                try {
                                    const readStarted=performance.now();
                                    const values=leaves.map(({request,element})=>{const rect=element.getBoundingClientRect();return {key:request.key,size:{width:rect.width,height:rect.height}};});
                                    cleanup();timing.measurementCpuMs+=performance.now()-readStarted;timing.measurementWaitMs+=performance.now()-started;timing.lastMetricsAt=performance.now();reply(values);
                                }catch{reject();}
                            },reject);
                        }catch{reject();}
                    }catch{reject();}
                };
                // Full batches are separate native work quanta. Small rounds
                // keep the existing immediate path; no task is inserted between
                // the final metric reply and its atomic canonical publication.
                if(requests.length<MEASUREMENT_BATCH_LIMIT)work();
                else releaseTurn=queueMeasurementTurn(()=>{releaseTurn=undefined;work();},reject);
            }catch{reject();}
            return cleanup;
        },
        publish(next: PresentationFrame) {
            try {
            const started = performance.now();
            const suppressMotion=!!(frame?.modalId||next.modalId);
            if(suppressMotion){trick.clear();paintResources.clear();transfers.clear();recycle.clear();essential.clear();essentialOwnerToken=null;essentialFrameId=0;motion.clear();}
            let motionAdmission=true;
            if(next.publicCompletion&&callbacks?.completionFence?.(next.id,next.publicCompletion.event,true)!==true){motionAdmission=false;trick.clear();callbacks?.publicCompletionEnd?.(next.id,next.publicCompletion.event,'unfulfilled');}
            const staged=!suppressMotion?trick.prepare(frame,next,elements):null;
            const resolution=staged?.plan??(!suppressMotion?planTrickResolution(frame,next):null);
            const essentialTransfer=!suppressMotion&&requiresEssentialTransfer(frame,next);
            const needsEssential=!suppressMotion&&!!(essentialOwnerToken||next.deals?.length||next.recycleAdmission||essentialTransfer||resolution)&&!!essentialInputMask(next);
            if(needsEssential){
                const owner=essentialOwnerToken??`essential-${++essentialSequence}`;essentialOwnerToken=owner;essentialFrameId=next.id;
                if(!essential.begin(next,owner)){motionAdmission=false;trick.abortPublication(staged,next,elements);transfers.clear();essential.clear();essentialOwnerToken=null;essentialFrameId=0;}
            }else if(essentialOwnerToken){trick.abortPublication(staged,next,elements);transfers.clear();essential.clear();essentialOwnerToken=null;essentialFrameId=0;}
            if(resolution)transfers.clear();
            const transfer = suppressMotion||resolution?[]:transfers.prepare(frame, next, elements);
            const tracks = suppressMotion?[]:motion.prepare(frame, next);
            host.dataset.foundationStatus = 'publishing';
            if (content && content.className !== 'foundation-content') {
                content.remove(); content = null;
            }
            if (!content) {
                content = document.createElement('div');
                content.className = 'foundation-content';
                Object.assign(content.style, { position: 'relative', width: '100%', height: `${next.height}px` });
                host.prepend(content);
            }
            content.style.width = `${next.width}px`;
            content.style.height = `${next.height}px`;
            const ids = new Set(next.nodes.map(node => node.id));
            const jointPointerIds=jointPointerNodeIds(next.nodes);
            const hostRect=next.modalId?host.getBoundingClientRect():null;
            for (const [id, element] of elements)
                if (!ids.has(id)) {
                    retireElement(id,element,ids);
                    elements.delete(id);
                }
            const siblingIndices = new Map<string | null, number>();
            for (const node of next.nodes) {
                let element = elements.get(node.id);
                if (element && (element.dataset.foundationKind !== node.kind || element.tagName.toLowerCase() !== tagFor(node))) {
                    retireElement(node.id,element,ids);
                    elements.delete(node.id);
                    element = undefined;
                }
                if (!element) {
                    element = make(node);
                    elements.set(node.id, element);
                }
                const detachedFormRoot=element instanceof HTMLDialogElement&&!!(node.formLeaseId||node.modalLeaseId||node.choiceLeaseId);
                const parent = detachedFormRoot?host:node.parent === null ? content : elements.get(node.parent);
                if (!parent)
                    throw new Error('Frame child precedes its parent');
                const index = siblingIndices.get(node.parent) ?? 0;
                siblingIndices.set(node.parent, index + 1);
                if(detachedFormRoot){if(element.parentNode!==host)host.append(element);}
                else if(parent.children[index]!==element)parent.insertBefore(element,parent.children[index]??null);
                const geometryStyle=element.style;
                const left=`${node.box.x}px`,top=`${node.box.y}px`,width=`${node.box.width}px`,height=`${node.box.height}px`,overflowX=node.scrollAxis==='y'?'hidden':node.scroll?'auto':'visible',overflowY=node.scrollAxis==='x'?'hidden':node.scroll?'auto':'visible';
                if(geometryStyle.left!==left||geometryStyle.getPropertyPriority('left'))geometryStyle.left=left;
                if(geometryStyle.top!==top||geometryStyle.getPropertyPriority('top'))geometryStyle.top=top;
                if(geometryStyle.width!==width||geometryStyle.getPropertyPriority('width'))geometryStyle.width=width;
                if(geometryStyle.height!==height||geometryStyle.getPropertyPriority('height'))geometryStyle.height=height;
                if(geometryStyle.overflowX!==overflowX||geometryStyle.getPropertyPriority('overflow-x'))geometryStyle.overflowX=overflowX;
                if(geometryStyle.overflowY!==overflowY||geometryStyle.getPropertyPriority('overflow-y'))geometryStyle.overflowY=overflowY;
                if(node.kind==='group'&&!(element instanceof HTMLDialogElement)){if(node.readonlyMatrixViewport&&node.scroll)element.tabIndex=0;else element.removeAttribute('tabindex');}
                element.inert=!!node.inert;
                paintJointPointer(element,node,jointPointerIds.has(node.id));
                if(node.kind==='card'||node.kind==='text')element.style.opacity='1';
                if(node.kind==='card'&&element.firstElementChild instanceof SVGSVGElement)element.firstElementChild.style.opacity='';
                if(node.observerReactionLayer){element.style.pointerEvents='none';element.style.opacity='0';element.setAttribute('aria-hidden','true');}
                if(node.kind==='group'&&!node.observerReactionLayer){element.style.opacity=node.deemphasized?'.55':'1';if(node.inert)element.setAttribute('aria-hidden','true');else element.removeAttribute('aria-hidden');}
                if(element instanceof HTMLDialogElement){element.style.opacity='1';element.style.left=`${(hostRect?.left??0)+node.box.x}px`;element.style.top=`${(hostRect?.top??0)+node.box.y}px`;element.setAttribute('aria-modal','true');}
                element.id=nodeDomId(node.id);
                if(node.scrollResetKey!==undefined){if(element.dataset.foundationScrollKey!==node.scrollResetKey){element.scrollTop=0;element.scrollLeft=0;}element.dataset.foundationScrollKey=node.scrollResetKey;}else delete element.dataset.foundationScrollKey;
                if(node.participantStatusFor)element.dataset.foundationParticipantStatus=node.participantStatusFor;else delete element.dataset.foundationParticipantStatus;
                element.dataset.foundationFrame = String(next.id);
                if(node.kind==='card'){element.removeAttribute('aria-hidden');delete element.dataset.foundationConcealed;}
                element.dataset.foundationParent = node.parent ?? '';
                element.dataset.foundationBox = JSON.stringify(node.box);
                element.dataset.foundationArrangement = node.arrangement ?? '';
                element.dataset.foundationEntity = node.entityId ?? '';
                element.dataset.foundationOwner = node.ownerId ?? '';
                element.dataset.foundationZone = node.zoneId ?? '';
                element.dataset.foundationRecipient = node.recipientId ?? '';
                element.dataset.foundationRecipientCount = node.recipientCount===undefined?'':String(node.recipientCount);
                if(node.shellSlot==='room-code')element.setAttribute('data-live-room','');else element.removeAttribute('data-live-room');
                if(node.connectionState!==undefined)element.setAttribute('data-live-status',node.connectionState);else element.removeAttribute('data-live-status');
                if (node.kind === 'text' || node.kind === 'command' || node.kind === 'choice') {
                    textStyle(element, node.role, next.environment);
                    element.style.color=node.kind==='text'&&node.tone?`var(${node.tone==='accent'?'--accent':node.tone==='gold'?'--gold-text':node.tone==='danger'?'--danger':node.tone==='muted'?'--ink-muted':'--ink'})`:'';
                    element.style.textAlign = node.kind === 'text' ? node.textAlign ?? 'start' : 'center';
                    paintNativeTextContent(element,node.label,node.paintChildren);
                }
                if (hasArtwork(node)) {
                    if(node.kind==='icon')element.removeAttribute('aria-label');else element.setAttribute('aria-label', node.label);
                    if(node.accessibleDescription)element.setAttribute('aria-description',node.accessibleDescription);else if(!node.preference)element.removeAttribute('aria-description');
                    const art=artworks.get(node.id);
                    if(art)art.update(node);else artworks.set(node.id,mountArtwork(element,node));
                }
                paintNativeGroupSurface(element.style,node);
                if(node.kind==='figure'){
                    element.style.backgroundImage=node.appearance?.thinking?'radial-gradient(circle, color-mix(in srgb, var(--accent) 14%, transparent) 70%, transparent 71%)':'';
                    element.style.backgroundSize=node.appearance?.thinking?'72% 72%':'';element.style.backgroundPosition=node.appearance?.thinking?'center 3.7%':'';element.style.backgroundRepeat='no-repeat';
                    if(node.appearance?.thinking)element.setAttribute('aria-current','true');else element.removeAttribute('aria-current');
                }
                if ((node.kind === 'group'||node.semanticRole==='tab') && node.semanticRole) {
                    element.setAttribute('role', node.semanticRole);
                    element.setAttribute('aria-label', node.label);
                    if(node.accessibleDescription)element.setAttribute('aria-description',node.accessibleDescription);else if(!node.preference)element.removeAttribute('aria-description');
                }
                else if (node.kind === 'group') {
                    element.removeAttribute('role');
                    element.removeAttribute('aria-label');
                }
                if(node.semanticRole==='tab'){element.setAttribute('aria-selected',String(node.checked===true));element.removeAttribute('aria-pressed');}
                else element.removeAttribute('aria-selected');
                if(node.columnSpan!==undefined)element.setAttribute('aria-colspan',String(node.columnSpan));else element.removeAttribute('aria-colspan');
                if(node.controlsId)element.setAttribute('aria-controls',nodeDomId(node.controlsId));else element.removeAttribute('aria-controls');
                if (element instanceof HTMLButtonElement) {
                    element.className = node.kind==='toggle'?'':node.kind === 'card'||node.choiceCard ? 'foundation-card' : node.kind === 'choice' ? 'chip' : ['btn', node.intent === 'quiet' ? 'ghost' : node.intent === 'secondary' ? '' : node.intent ?? ''].filter(Boolean).join(' ');
                    const tab=node.semanticRole==='tab';
                    element.style.borderRadius=tab||node.decoration==='pill'?'var(--r-pill)':'';
                    // Match the shared Segmented ink/table selection paint.
                    // The planner retains the measured native button envelope.
                    element.style.background=tab?(node.checked?'var(--ink)':'transparent'):'';
                    element.style.color=tab?(node.checked?'var(--table)':'var(--ink-muted)'):'';
                    element.style.boxShadow=tab?'none':'';
                    element.disabled = !node.enabled;
                    if(node.kind==='toggle'){element.style.padding='9px 1px';element.style.background='none';element.setAttribute('role','switch');element.setAttribute('aria-checked',String(node.formField?node.formField.value===true:node.preference?.kind==='toggle'&&node.preference.value));}
                    paintNativeButtonAvailability(element.style,node);
                    element.dataset.intent = node.intent ?? 'secondary';
                    element.setAttribute('aria-label', node.label);
                    if(node.accessibleDescription)element.setAttribute('aria-description',node.accessibleDescription);else if(!node.preference)element.removeAttribute('aria-description');
                    if(node.cardActionPickerIntent?.kind==='open'||node.catalogueIntent?.kind==='open')element.setAttribute('aria-haspopup','dialog');else element.removeAttribute('aria-haspopup');
                    if(node.assistanceIntent?.kind==='toggle-reactions')element.setAttribute('aria-keyshortcuts','R');else if(node.assistanceIntent?.kind==='tool'&&!node.assistanceIntent.optionId)element.setAttribute('aria-keyshortcuts','H');else element.removeAttribute('aria-keyshortcuts');
                    if(node.cardActionPickerIntent?.kind==='open'||node.catalogueIntent?.kind==='open'||node.localIntent&&node.localIntent!=='submit-card-set'||node.assistanceIntent?.kind==='toggle-reactions'||node.assistanceIntent?.kind==='tool'&&!node.assistanceIntent.optionId)element.setAttribute('aria-expanded',String(!!node.checked));else element.removeAttribute('aria-expanded');
                    if(node.formNavigation?.sectionId&&!node.formNavigation.fieldId&&node.checked)element.setAttribute('aria-current','page');else element.removeAttribute('aria-current');
                    if (node.kind === 'choice') {
                        element.setAttribute('role', 'radio');
                        element.setAttribute('aria-checked', String(!!node.checked));
                        const variants=node.cardActionOptionId===undefined?[]:next.nodes.filter(candidate=>candidate.kind==='choice'&&candidate.cardActionOptionId!==undefined&&candidate.enabled);
                        element.tabIndex = node.checked || variants.length>0&&!variants.some(candidate=>candidate.checked)&&variants[0].id===node.id ? 0 : -1;
                    }
                    else {
                        paintNativeCardAccessibility(element,node,next.modalId,next.modalId?nodeDomId(next.modalId):undefined);
                        if(node.kind==='card'&&(node.cardId||node.inspectCardId))element.dataset.foundationActivation=node.cardId?'select':'inspect';else delete element.dataset.foundationActivation;
                        element.tabIndex = node.semanticRole==='tab'&&!node.checked?-1:0;
                    }
                }
                if(isEditor(element)&&node.editor){
                    const editor=node.editor;
                    textStyle(element,node.role,next.environment);
                    element.style.overflowX='auto';element.style.overflowY='auto';
                    element.dataset.foundationLease=editor.leaseId;element.dataset.foundationField=editor.fieldId;
                    if(editor.fieldLeaseId)element.dataset.foundationFieldLease=editor.fieldLeaseId;else delete element.dataset.foundationFieldLease;
                    element.maxLength=editor.maxCodeUnits;element.disabled=!node.enabled;element.required=!!editor.required;
                    element.setAttribute('aria-label',node.label);
                    element.setAttribute('aria-labelledby',nodeDomId(JSON.stringify(['form-label',editor.leaseId,editor.fieldId])));
                    const descriptionIds=[JSON.stringify(['form-field-help',editor.leaseId,editor.fieldId]),JSON.stringify(['form-issue',editor.leaseId,editor.fieldId])].filter(id=>ids.has(id));
                    if(descriptionIds.length)element.setAttribute('aria-describedby',descriptionIds.map(nodeDomId).join(' '));else element.removeAttribute('aria-describedby');
                    element.setAttribute('aria-invalid',String(ids.has(JSON.stringify(['form-issue',editor.leaseId,editor.fieldId]))));
                    if(element.value!==editor.value&&!composing.has(element))element.value=editor.value;
                }
                if(node.formField){
                    const field=node.formField;
                    element.dataset.foundationLease=field.leaseId;element.dataset.foundationField=field.fieldId;
                    if(field.fieldLeaseId)element.dataset.foundationFieldLease=field.fieldLeaseId;else delete element.dataset.foundationFieldLease;
                    const descriptions=['form-field-help','form-option-help','form-issue'].map(kind=>JSON.stringify([kind,field.leaseId,field.fieldId])).filter(id=>ids.has(id));
                    if(descriptions.length)element.setAttribute('aria-describedby',descriptions.map(nodeDomId).join(' '));else element.removeAttribute('aria-describedby');
                    if(node.kind==='select'||node.kind==='toggle')element.setAttribute('aria-invalid',String(ids.has(JSON.stringify(['form-issue',field.leaseId,field.fieldId]))));
                }
                if(node.preference){
                    if(node.preference.help)element.setAttribute('aria-description',node.preference.help);else element.removeAttribute('aria-description');
                }
                if(element instanceof HTMLInputElement&&node.preference?.kind==='number'){
                    const field=node.preference;
                    element.min=String(field.min);element.max=String(field.max);element.step=String(field.step);element.value=String(field.value);element.disabled=!node.enabled;
                    element.setAttribute('aria-label',node.label);element.style.opacity=node.enabled?'1':'.4';
                }
                if(element instanceof HTMLSelectElement){
                    textStyle(element,node.role,next.environment);
                    element.style.whiteSpace='nowrap';
                    element.setAttribute('aria-label',node.label);
                    element.disabled=!node.enabled;
                    const options=node.options??[];
                    for(let index=0;index<options.length;index++){
                        const option=options[index];
                        let child=element.options[index];
                        if(!child){child=document.createElement('option');element.add(child);}
                        child.value=option.id;if(child.textContent!==option.label)child.textContent=option.label;child.disabled=!option.enabled;
                    }
                    while(element.options.length>options.length)element.remove(element.options.length-1);
                    if(node.selectedOptionId===undefined)element.selectedIndex=-1;else element.value=node.selectedOptionId;
                }
            }
            flushSync();
            // The complete native patch now owns this exact publishing frame,
            // including rollback when its input-mask commit is refused.
            nativePublication=next;
            if(essentialOwnerToken&&!essential.commit(next,essentialOwnerToken)){motionAdmission=false;trick.abortPublication(staged,next,elements);transfers.clear();essential.clear();essentialOwnerToken=null;essentialFrameId=0;}
            if (content) {
                content.style.opacity = '1';
                content.removeAttribute('aria-hidden');
            }
            if(!suppressMotion&&motionAdmission){motion.play(tracks, elements);if(recycle.count())recycle.retain(next,elements);else if(next.recycleAdmission){if(motionPreference.level==='full')recycle.start(next,elements);else recycle.skip(next);}if(!recycle.count()||transfers.count())transfers.play(transfer, next, elements);}
            if(!motionAdmission&&next.recycleAdmission)recycle.skip(next);
            frame = next;nativePublication=null;
            lastPublished = next.id;
            delete host.dataset.foundationFailure;host.dataset.foundationStatus = 'ready';
            host.dataset.foundationFrame = String(next.id);
            host.dataset.foundationRecipe = next.recipe;
            if(next.publicCompletion&&motionAdmission&&(!nativeCompletionInputReady(host,next,elements)||callbacks?.completionReady?.(next.id,next.publicCompletion.event,next.completionReceiveReservation?completionReceiveNativeProof(next,host,elements,content)??undefined:undefined)!==true)){motionAdmission=false;trick.clear();paintResources.clear();callbacks?.publicCompletionEnd?.(next.id,next.publicCompletion.event,'unfulfilled');}
            if(!suppressMotion&&motionAdmission&&resolution){if(!trick.start(staged,next,elements)&&next.publicCompletion)callbacks?.publicCompletionEnd?.(next.id,next.publicCompletion.event,'unfulfilled');}else if(next.publicCompletion)callbacks?.publicCompletionEnd?.(next.id,next.publicCompletion.event,'unfulfilled');
            finishEssentialIfIdle();
            if(!essentialOwnerToken){for(const node of next.nodes){const element=elements.get(node.id);if(!element||currentlyConcealed(node.id))continue;if((node.id===next.decisionLaneId||node.id===next.outcomeLaneId)){element.style.opacity=node.deemphasized?'.55':'1';element.inert=!!node.inert;if(node.inert)element.setAttribute('aria-hidden','true');else element.removeAttribute('aria-hidden');}if(node.cardActionPickerIntent?.kind==='open'||node.catalogueIntent?.kind==='open'||node.actionId||node.fieldId||node.cardId||node.cardActionOptionId||node.cardActionPickerIntent||node.inspectCardId||node.localIntent==='submit-card-set'||node.localIntent==='toggle-information'&&node.id==='outcome-information'){if(element instanceof HTMLButtonElement||element instanceof HTMLSelectElement)element.disabled=node.enabled!==true||!!node.inert;}}}
            for(const [id,element] of elements)if(element instanceof HTMLDialogElement&&id!==next.modalId)closeDialog(element);
            const activeDialog=next.modalId?elements.get(next.modalId):null;
            if(activeDialog instanceof HTMLDialogElement&&!activeDialog.open){restoringFocus=true;try{activeDialog.showModal();}finally{restoringFocus=false;}}
            if (next.focusId && document.activeElement !== elements.get(next.focusId)){
                restoringFocus=true;
                try{elements.get(next.focusId)?.focus({ preventScroll: true });}finally{restoringFocus=false;}
            }
            if(next.revealFocusId&&next.revealFocusId===next.focusId)elements.get(next.revealFocusId)?.scrollIntoView({block:'nearest',inline:'nearest'});
            for(const id of figureCues(next))motion.cue(id,elements);
            if(!recycle.count())transfers.settleVisible(next,elements,trick.entities());
            queueMicrotask(()=>{if(frame===next){revealPublicDisclosures();paintObserverReactions(host,next,elements,host.dataset.foundationStatus==='ready');}});
            timing.publishCpuMs += performance.now() - started; timing.publishes++;
            } finally { nativePublication=null; }
        },
        refuse(nodeId:string){
            if(host.dataset.foundationStatus!=='ready'||!frame)return;
            const current=frame,node=current.nodes.find(node=>node.id===nodeId),element=elements.get(nodeId);
            if(node?.kind!=='card'||!node.inspectCardId||node.cardId||!node.enabled||!element||!host.contains(element))return;
            if(current.modalId){
                if(current.modalId!=='assistance-inspection')return;
                const previews=current.nodes.filter(candidate=>candidate.kind==='card'&&candidate.inspectionPreviewFor===node.inspectCardId&&!candidate.cardId&&!candidate.inspectCardId&&!candidate.actionId&&!candidate.cardActionOptionId&&!candidate.enabled);
                if(previews.length!==1)return;
                const preview=previews[0],paint=elements.get(preview.id);
                let parent=preview.parent;const seen=new Set<string>();
                while(parent&&parent!==current.modalId&&!seen.has(parent)){seen.add(parent);parent=current.nodes.find(candidate=>candidate.id===parent)?.parent??null;}
                if(parent!==current.modalId||!paint||!host.contains(paint)||!interactive(paint))return;
                motion.refuse(preview.id,elements);
            }else if(interactive(element))motion.refuse(nodeId,elements);
        },
        updateClock(id:string,fraction:number,secondsLeft:number|null){
            if(!Number.isFinite(fraction)||secondsLeft!==null&&!Number.isFinite(secondsLeft))return;
            for(const node of frame?.nodes??[])if(node.clockPaint?.id===id){
                const element=elements.get(node.id);if(!element)continue;
                const ring=element.querySelector('[data-clock-ring]'),seconds=element.querySelector('[data-clock-seconds]');
                ring?.setAttribute('stroke-dashoffset',String(1-Math.max(0,Math.min(1,fraction))));
                if(seconds)seconds.textContent=secondsLeft===null||secondsLeft<0||secondsLeft>5?'':String(Math.ceil(secondsLeft));
            }
        },
        preserveModal(leaseId:string|null){preservedModalLease=leaseId;},
        preserveEditing(leaseId:string|null,fieldLeases?:Readonly<Record<string,string>>){
            preservedLease=leaseId;preservedFieldLeases=fieldLeases;
            // A retired field token cannot keep editing merely because the
            // containing modal lease survives a section/dependency transition.
            for(const element of elements.values())if(isEditor(element)&&!preservesEditor(element))retireEditor(element);
        },
        disarm() { if(frame)paintObserverReactions(host,frame,elements,false); cancelNativeCaptures(); trick.suspend();transfers.suspend(); patching = true; try {
            const keep=preservedDialog(),keepElement=keep?elements.get(keep.id):null;
            const priorActive=document.activeElement;
            for(const element of elements.values())if(element instanceof HTMLDialogElement)element.inert=element!==keepElement;
            // Chromium can add automatic Tab stops for overflowing divs once
            // their buttons are disabled. Suppress those stops while pending.
            for(const node of frame?.nodes??[])if(node.scroll&&!(keepElement&&elements.get(node.id)&&keepElement.contains(elements.get(node.id)!)))elements.get(node.id)?.setAttribute('tabindex','-1');
            for (const element of elements.values())
                if(element instanceof HTMLButtonElement||isNative(element)||isEditor(element)&&!(keepElement?.contains(element)&&preservesEditor(element)))element.disabled=true;
            if((keep?.modalLeaseId||keep?.choiceLeaseId)&&keepElement){
                // A preserved readonly modal has no enabled controls while
                // preparing. Keep one native Tab stop on its visible viewport.
                const viewport=(frame?.nodes??[]).filter(node=>node.kind==='group'&&node.scroll).map(node=>elements.get(node.id)).find(element=>element&&keepElement.contains(element));
                if(viewport){viewport.tabIndex=0;if(priorActive&&keepElement.contains(priorActive)){restoringFocus=true;try{viewport.focus({preventScroll:true});}finally{restoringFocus=false;}}}
            }
            host.dataset.foundationStatus = 'pending';
        }
        finally {
            patching = false;
        } },
        invalidate() {
            port.disarm();trick.clear();paintResources.clear();transfers.clear();recycle.clear();essential.clear();essentialOwnerToken=null;essentialFrameId=0;
            const keep=preservedDialog();
            for(const [id,element] of elements)if(element instanceof HTMLDialogElement&&id!==keep?.id)element.style.opacity='0';
            motion.clear();
            if(!keep&&(!frame||!currentEnvironment||!sameBackMotionSpace(frame.environment,currentEnvironment)))frame = null;
            if (content) {
                const active=document.activeElement;
                if(active instanceof HTMLElement&&content.contains(active)){
                    restoringFocus=true;try{active.blur();}finally{restoringFocus=false;}
                }
                // All focusable leaves are typed native controls and disarm()
                // disables them before preparation. Keep the AT fence, but avoid
                // inherited visibility/inert changes restyling every static SVG.
                // Native top-layer dialogs need their own paint suppression.
                content.style.opacity = '0';
                content.setAttribute('aria-hidden', 'true');
            }
            host.dataset.foundationStatus = 'pending';
        },
        fallback(reason: string) { clear();host.dataset.foundationFailure=reason; const fallback = document.createElement('p'); fallback.setAttribute('role', 'status'); fallback.textContent = '이 크기에서는 테이블을 표시할 수 없어요. 창을 넓혀주세요.'; fallback.style.padding = '12px'; content = document.createElement('div'); content.append(fallback); host.append(content); host.dataset.foundationStatus = 'fallback'; },
        clear,
        setTextScale(value: number) { if (!Number.isFinite(value) || value < .75 || value > 3)
            throw new RangeError('Unsupported text scale'); if(textScale===value)return; textScale = value; if(callbacks)reportEnvironment(); },
        timings() { return Object.freeze({ ...timing }); },
        resources() { return Object.freeze({ listeners, probes, animations: motion.count() + transfers.count() + recycle.count() + trick.count(), artworks:artworks.size+paintResources.resources().cohorts+paintResources.resources().neutrals }); },
    } satisfies SurfacePort & {
        timings(): Readonly<typeof timing>;
        setTextScale(value: number): void;
        resources(): Readonly<{
            listeners: number;
            probes: number;
        animations: number;
        artworks: number;
        }>;
    };
    return port;
}
