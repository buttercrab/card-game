<script lang="ts" module>
  /** Where a seat sits at five: you at the bottom, then round the table. */
  export type Place = 'bottom' | 'right' | 'top-right' | 'top-left' | 'left' | 'free';
  export interface Gain { n: number; id: number; }
  export const PLACES: Place[] = ['bottom', 'right', 'top-right', 'top-left', 'left'];
</script>

<script lang="ts">
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import PlayerFigure from '../../ui/PlayerFigure.svelte';
  import TurnRing from '../../room/TurnRing.svelte';
  import type { Suit } from './types';
  import Badge, { type Team } from '../../ui/Badge.svelte';
  import FeedbackDock from '../../ui/FeedbackDock.svelte';
  import EngineFlow from '../../table/EngineFlow.svelte';
  import { tableCoordinates } from '../../table/coordinateContext';
  import { createFrameMeasurements } from '../../table/frameMeasurements';
  import { calculateSeatIdentity, boundsStyle } from '../../table/seatIdentityLayout';
  import type { Size } from '../../table/layout';
  let {
    name,
    layoutViewport,
    layoutRegion,
    layoutWidth,
    local = false,
    waiting = false,
    compact = false,
    bot = false,
    offline = false,
    team = null,
    secretFriend = false,
    points = 0,
    turn = false,
    bubble = null,
    reaction = null,
    place = 'free',
    picked = false,
    attach,
    cue = null,
    dim = false,
    reveal = false,
    trumpSuit = null,
    lookAt = null,
    mood = null,
    clock = null,
    away = false,
    empty = false,
    score = null,
    collecting = false,
    target,
    actions,
    gained = $bindable<Gain | null>(null),
  }: {
    name: string;
    layoutViewport?: Size; layoutRegion?: Size; layoutWidth?: number; local?: boolean; waiting?:boolean; compact?: boolean;
    /** Occupied identity menu target, contained by the identity footprint. */
    target?: Snippet;
    /** Empty seat choices, in normal flow after the identity. */
    actions?: Snippet<[(height:number)=>void]>;
    ready?: boolean | null;
    reviewing?: boolean;
    bot?: boolean;
    offline?: boolean;
    team?: Team | null;
    /** You hold the called card: the 프렌드, known only to you so far. */
    secretFriend?: boolean;
    /** Point cards won this hand. */
    points?: number;
    turn?: boolean;
    /** A short note in the reserved feedback slot, such as a bid or 패스. */
    bubble?: string | null;
    /** A reaction the player just sent; `id` replays it when repeated. */
    reaction?: { text: string; id: number } | null;
    /** Where it sits round the table. Bid/status stay below the name; reactions float at a separate anchor. */
    place?: Place;
    /** Chosen first in a swap: it stands up a little. */
    picked?: boolean;
    /** Registers the seat's element (the table's motion finds it so). */
    attach?: Attachment<HTMLElement>;
    /** A big moment at this seat: it wiggles, with a short label under it
     * when `text` is set. A new `id` plays it again. */
    cue?: { text: string | null; id: number } | null;
    /** Out of the current round, such as after passing. */
    dim?: boolean;
    /** Just revealed as the friend. */
    reveal?: boolean;
    /** The trump, for the 주공's crown. */
    trumpSuit?: Suit | null;
    /** Where the figure's eyes glance, as a screen-direction vector. */
    lookAt?: { x: number; y: number } | null;
    mood?: 'happy' | 'down' | null;
    /** The turn timer while this seat is to act under a time limit. */
    clock?: { deadline: number; total: number } | null;
    /** Its turn ran out and a bot played it (자리 비움). */
    away?: boolean;
    /** Nobody sits here yet (between hands): a dashed outline waits. */
    empty?: boolean;
    /** The running total, shown between hands. */
    score?: number | null;
    /** Hold the collection cue until the cards reach their player. */
    collecting?: boolean;
    gained?: Gain | null;
  } = $props();


  let el: HTMLElement;
  const shared=tableCoordinates();
  const measurements=shared?.measurements??createFrameMeasurements(()=>el);
  let measuredViewport=$state({width:390,height:844});
  let measuredRegion=$state({width:92,height:106});
  let naturalNameWidth=$state(0);
  let actionsHeight=$state(0);
  let resolvedActionsHeight=$state(0);
  const reportActionsHeight=(height:number)=>{resolvedActionsHeight=height;};
  $effect(()=>el&&measurements.observeRegion(el,({viewport,region})=>{measuredViewport=viewport;measuredRegion={width:region.width,height:region.height};}));
  const nameMeasurement:Attachment<HTMLElement>=element=>measurements.observeSize(element,({width})=>{naturalNameWidth=width;});
  const actionMeasurement:Attachment<HTMLElement>=element=>measurements.observeSize(element,({height})=>{actionsHeight=height;});
  const geometry=$derived(calculateSeatIdentity({viewport:layoutViewport??measuredViewport,region:layoutRegion??measuredRegion,width:layoutWidth??measuredRegion.width,local,waiting,hasMeta:!!(team||secretFriend||points>0||score!==null&&!empty),compact,empty,nameWidth:naturalNameWidth,statusCount:Number(away)+Number(offline),thinking:turn&&bot,actionsHeight:actions?resolvedActionsHeight:0}));
  const metaItems=$derived([...(team||secretFriend?[{id:'role'}]:[]),...(points>0?[{id:'points'}]:[]),...(score!==null&&!empty?[{id:'score'}]:[])]);
  onDestroy(()=>{if(!shared)measurements.dispose();});

  // Credit appears below the name once collection finishes.
  let before = untrack(() => points);
  let gainId = 0;
  let pendingGain = 0;
  let gainTimer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(gainTimer));
  $effect(() => {
    const now = points;
    const waiting = collecting;
    if (now < before) pendingGain = 0;
    // A loaded score snapshot is not a new trick. Only collect credit
    // while the animator is resolving cards for this seat.
    if (now > before && waiting) pendingGain += now - before;
    before = now;
    if (pendingGain > 0 && !waiting) {
      const id = ++gainId;
      gained = { n: pendingGain, id };
      pendingGain = 0;
      clearTimeout(gainTimer);
      gainTimer = setTimeout(() => { if (gained?.id === id) gained = null; }, 1000);
    }
  });
</script>

<div class="seat {place}" data-engine-layout="seat-identity" style:visibility={(name.length===0||naturalNameWidth>0)&&(!actions||resolvedActionsHeight>0&&Math.abs(actionsHeight-resolvedActionsHeight)<=1)?undefined:'hidden'} style:width={`${geometry.width}px`} style:height={`${geometry.height}px`} style:translate={picked?`0 ${geometry.pickedOffset}px`:undefined} style:--name-size={`${geometry.nameSize}px`} style:--meta-size={`${geometry.metaSize}px`} style:--badge-size={`${geometry.badgeSize}px`} style:--badge-line={geometry.badgeLineHeight===undefined?undefined:`${geometry.badgeLineHeight}px`} style:--badge-padding={`${geometry.badgePadding}px`} bind:this={el} class:turn class:dim class:reveal class:empty class:picked aria-current={turn ? 'true' : undefined} {@attach attach}>
  <div class="identity" style={boundsStyle(geometry.identity)}>
  <!-- On its turn the name tag lights up in plum. -->
  <div class="stand" style={boundsStyle(geometry.figure)}>
    {#if empty}
      <!-- The dashed outline of a figure waiting to be filled. -->
      <svg class="outline" viewBox="0 0 120 110" aria-hidden="true"><path d="M20 108 Q22 76 60 72 Q98 76 100 108" /><circle cx="60" cy="48" r="20" /></svg>
    {:else}
    <PlayerFigure
      {team}
      {trumpSuit}
      isBot={bot}
      thinking={turn && bot}
      {lookAt}
      {mood}
      {offline}
    />
    {/if}
    {#if clock}<TurnRing deadline={clock.deadline} total={clock.total} />{/if}
  </div>
  <!-- Production's shared role/points row overlaps the lower edge of the
       figure; the centered name follows it rather than splitting the row. -->
  <div class="meta" style={boundsStyle(geometry.meta)} style:display={empty||geometry.meta.height===0?'none':undefined}>
    <EngineFlow items={metaItems} fill justify="center" gap={compact?2:4} minHeight={geometry.meta.height}>
      {#snippet children(id)}
        {#if id==='role' && team}{#key team}<Badge {team} size="sm" ringed class="pop" />{/key}
        {:else if id==='role' && secretFriend}<Badge secret size="sm" ringed class="pop" title="나만 알아요: 부른카드를 내면 모두 알게 돼요" />
        {:else if id==='points'}{#key points}<Badge class={gained?'bump':''}>{points}점</Badge>{/key}
        {:else if id==='score' && score!==null}<Badge class="score" negative={score<0} title="누적 점수" label="누적 {score}점">{score>0?'+':''}{score}</Badge>{/if}
      {/snippet}
    </EngineFlow>
  </div>
  <div class="name-row" style={boundsStyle(geometry.name)}>
    {#if away || offline}
      <span class="status-icons" style={boundsStyle({...geometry.status,x:geometry.status.x-geometry.name.x,y:geometry.status.y-geometry.name.y})}>
        {#if away}<span class="away-dot" style:left={`${geometry.statusOffsets[0]}px`} title="자리 비움" aria-label="자리 비움"></span>{/if}
        {#if offline}<span class="dot" style:left={`${geometry.statusOffsets[away?1:0]}px`} title="연결 끊김" aria-label="연결 끊김"></span>{/if}
      </span>
    {/if}
    <span class="name" {@attach nameMeasurement} style:max-width={`${geometry.nameTextMax}px`} style:left="8px" style:top="0px" style:line-height={`${geometry.name.height}px`} title={name}>{name}</span>
    {#if geometry.showThinking}<span class="thinking" style={boundsStyle({...geometry.dots,x:geometry.dots.x-geometry.name.x,y:geometry.dots.y-geometry.name.y})} aria-label="생각하는 중">{#each geometry.thinkingOffsets as x}<i style:left={`${x}px`}></i>{/each}</span>{/if}
  </div>
  {@render target?.()}
  </div>
  {#if !empty}<div class="feedback-slot" style={boundsStyle(geometry.feedbackBox)}><FeedbackDock {reaction} {cue} credit={gained} bid={bubble} geometry={geometry.feedback} /></div>{/if}
  {#if actions}<div class="seat-actions" style={boundsStyle(geometry.actions)}><div {@attach actionMeasurement}>{@render actions(reportActionsHeight)}</div></div>{/if}
</div>

<style>
  .seat { position:relative; color:var(--ink-muted); text-align:center; transition:color var(--dur-quick) var(--ease-standard); }
  .seat.turn { color:var(--ink); }
  .identity,.stand,.meta,.name-row,.feedback-slot,.seat-actions,.name,.status-icons,.thinking { position:absolute; box-sizing:border-box; }
  .stand::before { content:''; position:absolute; left:14%; top:3.7%; width:72%; aspect-ratio:1; border-radius:50%; background:var(--accent); opacity:0; pointer-events:none; transition:opacity var(--dur-quick) var(--ease-standard); }
  .seat.turn .stand::before { opacity:.14; }
  .seat.dim { opacity:.6; }
  .seat.picked { color:var(--ink); }
  .outline { display:block; width:100%; height:auto; overflow:visible; fill:none; stroke:var(--ink-muted); stroke-width:4; stroke-dasharray:8 7; stroke-linecap:round; }
  .name-row { border-radius:var(--r-pill); transition:background-color var(--dur-quick) var(--ease-standard),color var(--dur-quick) var(--ease-standard); }
  .seat.turn .name-row { background:var(--accent); color:var(--on-accent); }
  .name { width:max-content; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--name-size); font-weight:600; }
  .seat.empty .name { font-weight:500; }
  .meta { font-size:var(--meta-size); font-weight:600; font-variant-numeric:tabular-nums; }
  .meta :global(.count) { font-size:var(--badge-size); line-height:var(--badge-line,18px); padding:0 var(--badge-padding); }
  .meta :global(.team) { font-size:var(--badge-size); line-height:var(--badge-line,16px); padding:0 var(--badge-padding); }
  .status-icons,.thinking { color:var(--ink-muted); }
  .status-icons > span { position:absolute; top:0; width:7px; height:7px; box-sizing:border-box; }
  .away-dot { border:1px solid currentColor; border-radius:50%; }
  .thinking i { position:absolute; top:0; width:4px; height:4px; border-radius:50%; background:currentColor; animation:think 1.2s ease-in-out infinite; }
  .thinking i:nth-child(2) { animation-delay:150ms; }
  .thinking i:nth-child(3) { animation-delay:300ms; }
  @keyframes think { 0%,100% {opacity:.25;} 40% {opacity:1;} }
  .identity :global(.seat-tap) { left:0; top:0; width:100%; height:100%; }
</style>
