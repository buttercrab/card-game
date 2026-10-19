<script lang="ts">
  import { rendering } from '../table/renderMode.svelte';
  import { calculateFrameLayout, availableFrameHeight, frameStyle, type FrameLayout } from '../table/frameLayout';
  import { tableCoordinates } from '../table/coordinateContext';
  import { createFrameMeasurements } from '../table/frameMeasurements';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  let { children, element = $bindable(), class: className = '', style = '', controls = false,
    controlsHeight = 0, between = false, completed = false, ...attributes }:
    Omit<HTMLAttributes<HTMLElement>, 'children'> & { children: Snippet<[FrameLayout]>; element?: HTMLElement;
      controls?: boolean; controlsHeight?: number; between?: boolean; completed?: boolean } = $props();
  const shared = tableCoordinates()?.measurements;
  const measurements = shared ?? createFrameMeasurements(() => element);
  // Intrinsic fonts and nested allocations must settle before the first paint.
  // Once shown, game updates and resizes retain the same visible scene.
  let firstLayoutReady = $state(false);
  $effect(() => measurements.observeReady(ready => { if (ready) firstLayoutReady = true; }));
  let viewport = $state({width:390,height:844});
  let region = $state({width:0,height:0});
  let tools = $state({width:0,height:0});
  let social = $state({width:0,height:0});
  let resultHeight = $state(0);
  let chromeHeight=$state(80);
  let safeInsets=$state(0);
  let insetProbe:HTMLSpanElement;
  let chromeProbe:HTMLSpanElement;
  $effect(()=>chromeProbe&&measurements.observeSize(chromeProbe,({height})=>{chromeHeight=height;}));
  $effect(()=>insetProbe&&measurements.observeSize(insetProbe,({height})=>{safeInsets=height;}));
  const layout = $derived(calculateFrameLayout({viewport,region,tools,social,resultHeight,controls,controlsHeight,between,completed}));
  $effect(() => {
    if (!element) return;
    const stop = measurements.observeRegion(element, metrics => { viewport = metrics.viewport; region = metrics.region; });
    // Only intrinsic content sizes cross the renderer boundary. Region positions
    // remain outputs, so an interrupted animation cannot become layout authority.
    let contentStops: (() => void)[] = [];
    let observedContent: (HTMLElement | null | undefined)[] = [];
    const observeContent = () => {
      const toolContent = element?.querySelector<HTMLElement>('.tools-area > *');
      const resultContent = element?.querySelector<HTMLElement>('.result-layer > section');
      const socialContent = element?.querySelector<HTMLElement>('.social-area > *');
      const content = [toolContent,resultContent,socialContent];
      if (content.every((node,index) => node === observedContent[index]) && observedContent.length) return;
      observedContent = content;
      contentStops.forEach(stop => stop()); contentStops = [];
      if (toolContent) contentStops.push(measurements.observeSize(toolContent, size => tools = size));
      if (resultContent) contentStops.push(measurements.observeSize(resultContent, size => resultHeight = size.height));
      if (socialContent) contentStops.push(measurements.observeSize(socialContent, size => social = {width:size.width,height:size.height+8}));
    };
    observeContent();
    // Snippet content can appear after a deal/result without remounting the frame.
    const mutations = new MutationObserver(records => {
      if (records.some(record => record.type === 'childList')) observeContent();
    });
    mutations.observe(element,{childList:true,subtree:true});
    return () => { stop(); contentStops.forEach(stop => stop()); mutations.disconnect(); };
  });
  $effect(() => { layout; measurements.invalidate(); });
  $effect(() => () => { if (!shared) measurements.dispose(); });
</script>

<section {...attributes} data-renderer={rendering.mode} data-frame-mode={layout.mode} data-frame-tools-layer={layout.toolsLayer}
  data-frame-result-dock={layout.resultDock} data-frame-controls-scroll={layout.decisionCap!==null&&controlsHeight>layout.decisionCap} class="table-frame {className}" style={`${style};${frameStyle(layout)}`} style:visibility={firstLayoutReady?undefined:'hidden'} style:height={`${availableFrameHeight(viewport.height,chromeHeight,safeInsets)}px`} bind:this={element}>
  <span class="chrome-input" bind:this={chromeProbe} aria-hidden="true"></span>
  <span class="safe-insets" bind:this={insetProbe} aria-hidden="true"></span>
  {@render children(layout)}
</section>

<style>
  .table-frame { position:relative; min-height:0;  }
  .chrome-input { position:absolute; width:0; height:var(--chrome,80px); visibility:hidden; pointer-events:none; }
  .safe-insets { position:absolute; width:0; height:0; padding-top:env(safe-area-inset-top); padding-bottom:env(safe-area-inset-bottom); visibility:hidden; pointer-events:none; }
  .table-frame :global(.status-area), .table-frame :global(.event), .table-frame :global(.felt-area),
  .table-frame :global(.strip-area), .table-frame :global(.tray-area), .table-frame :global(.side-area),
  .table-frame :global(.demo-side), .table-frame :global(.tools-area), .table-frame :global(.social-area),
  .table-frame :global(.observer-feedback), .table-frame :global(.result-layer:not(.inline)) {
    position:absolute; box-sizing:border-box; min-width:0; min-height:0; margin:0;
  }
  .table-frame :global(.status-area) { left:var(--frame-status-x); top:var(--frame-status-y); width:var(--frame-status-w); height:var(--frame-status-h); display:var(--frame-status-display); }
  .table-frame :global(.event) { left:var(--frame-event-x); top:var(--frame-event-y); width:var(--frame-event-w); height:var(--frame-event-h); display:var(--frame-event-display); }
  .table-frame :global(.felt-area) { left:var(--frame-felt-x); top:var(--frame-felt-y); width:var(--frame-felt-w); height:var(--frame-felt-h); display:var(--frame-felt-display); }
  .table-frame :global(.strip-area) { left:var(--frame-strip-x); top:var(--frame-strip-y); width:var(--frame-strip-w); height:var(--frame-strip-h); display:var(--frame-strip-display); }
  .table-frame :global(.tray-area) { left:var(--frame-tray-x); top:var(--frame-tray-y); width:var(--frame-tray-w); height:var(--frame-tray-h); display:var(--frame-tray-display); }
  .table-frame :global(.side-area), .table-frame :global(.demo-side) { left:var(--frame-side-x); top:var(--frame-side-y); width:var(--frame-side-w); height:var(--frame-side-h); display:var(--frame-side-display); }
  .table-frame :global(.tools-area) { left:var(--frame-tools-x); top:var(--frame-tools-y); width:var(--frame-tools-w); height:var(--frame-tools-h); display:var(--frame-tools-display); }
  .table-frame :global(.result-layer:not(.inline)) { left:var(--frame-result-x); top:var(--frame-result-y); width:var(--frame-result-w); height:var(--frame-result-h); display:var(--frame-result-display); }
  .table-frame :global(.social-area) { left:var(--frame-social-x); top:var(--frame-social-y); width:var(--frame-social-w); height:var(--frame-social-h); display:var(--frame-social-display); }
  .table-frame :global(.observer-feedback) { left:var(--frame-feedback-x); top:var(--frame-feedback-y); width:var(--frame-feedback-w); height:var(--frame-feedback-h); display:var(--frame-feedback-display); }
  .table-frame :global(.status-area) { padding-inline-end:var(--frame-status-padding); z-index:var(--z-status); }
  .table-frame :global(.strip-area) { padding-top:var(--frame-strip-padding); }
  .table-frame :global(.tray) { height:100%; box-sizing:border-box; }
  .table-frame :global(.social-area) { z-index:var(--z-controls); padding-top:8px; }
  .table-frame :global(.tools-area > .tools), .table-frame :global(.social-area > .participation) { width:max-content; }
  .table-frame :global(.social-area > .participation) { max-width:var(--frame-tray-w); }
  .table-frame :global(.social-area .participation) { max-height:var(--frame-social-cap); overflow:auto; box-sizing:border-box; }
  .table-frame[data-frame-controls-scroll='true'] :global(.strip-area .controls) { max-height:var(--decision-cap); overflow-y:auto; overscroll-behavior:contain; }
  .table-frame :global(.observer-feedback) { z-index:var(--z-feedback); }
  .table-frame :global(.tools-area) { z-index:6; }
  .table-frame[data-frame-tools-layer='status'] :global(.tools-area) { z-index:calc(var(--z-status) + 1); }
  .table-frame[data-frame-tools-layer='result'] :global(.tools-area) { z-index:calc(var(--z-result) + 1); }
  .table-frame[data-frame-tools-layer='dock'] :global(.tools-area) { z-index:1; }
  .table-frame[data-frame-mode='sidebar'] :global(.event .turn-line) { display:none; }
</style>
