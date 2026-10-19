<script lang="ts">
  import {FIGURE_BODY,FIGURE_CLOCK,figureClockText} from './figureArtworkMetrics';
  import type {ArtworkPaint} from './artworkPaint';
  import PlayerFigure from '../../ui/PlayerFigure.svelte';
  import CardBack from '../../ui/cards/CardBack.svelte';
  import CourtArt from '../../ui/cards/CourtArt.svelte';
  import CueIcon,{type Cue} from '../../ui/cards/CueIcon.svelte';
  import SuitIcon,{PATHS} from '../../SuitIcon.svelte';
  import type {InformationTone} from './contracts';
  import Icon from '../../Icon.svelte';
  import SwitchTrack from '../../ui/SwitchTrack.svelte';
  import {PIPS} from '../../ui/cards/pips';
  import {rankText} from '../../ui/cards/types';
  import {settings} from '../../settings.svelte';
  let {node}:{node:ArtworkPaint|null}=$props();
  const uid=$props.id();
  const visual=$derived(node?.visual);
  const countdown=$derived(node?.clock?figureClockText(node.clock.textScale):undefined);
  const suit=$derived(visual?.kind==='standard'?visual.suit:'Spade');
  const rank=$derived(visual?.kind==='standard'?visual.rank:0);
  const joker=$derived(visual?.kind==='joker');
  const full=$derived(node?.full??false);
  const ink=$derived(joker?(visual?.kind==='joker'&&visual.color==='Red'?'heart':'spade'):suit==='Heart'?'heart':suit==='Diamond'?(settings.fourColor?'diamond':'heart'):suit==='Club'?(settings.fourColor?'club':'spade'):'spade');
  const cue=$derived<Cue|null>(joker?'joker':node?.emphasis==='special'?'special':node?.emphasis==='call'?'call':rank===13?'K':rank===12?'Q':rank===11?'J':null);
  const tonePaint=(tone:InformationTone)=>`var(${tone==='accent'?'--accent':tone==='gold'?'--gold':tone==='danger'?'--danger':tone==='muted'?'--line':'--ink'})`;
</script>

{#snippet symbol(kind:keyof typeof PATHS,x:number,y:number,size:number)}
  <svg {x} {y} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true"><path d={PATHS[kind]} fill="currentColor"/></svg>
{/snippet}
{#snippet index()}
  {#if joker}
    {@render symbol('Star',full?4:5,full?5:4,full?17:24)}
    <text x={full?13:18} y={full?35:49} text-anchor="middle" font-size={full?15:22}>{visual?.kind==='joker'&&visual.color==='Red'?'홍':'흑'}</text>
  {:else}
    <text x={full?13:18} y={full?23:31} text-anchor="middle" font-size={full?22:32} textLength={rank===10?(full?19:27):undefined} lengthAdjust="spacingAndGlyphs">{rankText(rank)}</text>
    {@render symbol(suit,full?6.5:8,full?28:36,full?13:20)}
  {/if}
{/snippet}

{#if node?.kind==='toggle'}
  <SwitchTrack checked={node.toggle}/>
{:else}
<svg class="shared-art ink-{ink}" style:color={node?.kind==='icon'?'var(--ink)':undefined} width="100%" height="100%" viewBox={node?.kind==='icon'?'0 0 24 24':node?.kind==='figure'?FIGURE_BODY.viewBox:node?.kind==='progress'?'0 0 100 16':node?.kind==='suit'?'0 0 100 100':'0 0 100 140'} preserveAspectRatio={node?.kind==='figure'?'xMidYMin meet':'none'} aria-hidden="true" data-foundation-art="shared" data-card-back={visual?.kind==='back'?'':undefined}>
  {#if node?.kind==='figure'}
    {#if node.appearance?.vacant}
      <g class="vacant"><path d="M20 108 Q22 76 60 72 Q98 76 100 108"/><circle cx="60" cy="48" r="20"/></g>
    {:else}
      <svg x="0" y="0" width={FIGURE_BODY.width} height={FIGURE_BODY.height} viewBox={FIGURE_BODY.viewBox} preserveAspectRatio="xMidYMin meet"><PlayerFigure team={node.appearance?.team??null} trumpSuit={node.appearance?.trumpSuit??null} isBot={node.appearance?.bot??false} offline={node.appearance?.offline??false} thinking={node.appearance?.thinking??false}/></svg>
    {/if}
    {#if node.clock}
      <g data-foundation-clock-id={node.clock.id}>
        <svg x={FIGURE_CLOCK.x} y={FIGURE_CLOCK.y} width={FIGURE_CLOCK.width} height={FIGURE_CLOCK.height} viewBox={FIGURE_CLOCK.viewBox} preserveAspectRatio="xMidYMid meet" overflow="visible">
          <circle cx={FIGURE_CLOCK.center} cy={FIGURE_CLOCK.center} r={FIGURE_CLOCK.radius} fill="none" stroke="var(--line)" stroke-width={FIGURE_CLOCK.stroke}/>
          <circle data-clock-ring cx={FIGURE_CLOCK.center} cy={FIGURE_CLOCK.center} r={FIGURE_CLOCK.radius} fill="none" stroke="var(--ink)" stroke-width={FIGURE_CLOCK.stroke} stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0" transform="rotate(-90 50 50)"/>
        </svg>
        <text data-clock-seconds x={countdown?.x} y={countdown?.y} text-anchor="end" font-size={countdown?.fontSize} fill="var(--ink)"></text>
      </g>
    {/if}
  {:else if node?.kind==='icon'&&node.shellIcon}
    <Icon name={node.shellIcon} size="100%"/>
  {:else if node?.kind==='suit'&&node.suit}
    <SuitIcon suit={node.suit} size="100%"/>
  {:else if node?.kind==='progress'}
    {#each node.progress?.segments??[] as segment}
      <rect data-progress-segment x={segment.x} y="2" width={segment.width} height="12" rx="2" fill={tonePaint(segment.tone)}/>
    {/each}
    {#if node.progress?.target!==undefined}
      <line data-progress-target x1={node.progress.target} x2={node.progress.target} y1="0" y2="16" stroke="var(--ink)" stroke-width="1" vector-effect="non-scaling-stroke"/>
    {/if}
  {:else if node?.kind==='card'}
    <rect data-card-paper x=".6" y=".6" width="98.8" height="138.8" rx="8" fill={node.emphasis==='special'?'var(--card-warm)':'var(--card)'} stroke={node.checked?'var(--accent)':'var(--card-edge)'} stroke-width={node.checked?2:1}/>
    {#if node.hinted}<rect data-card-hint x="3" y="3" width="94" height="134" rx="5.5" fill="none" stroke="var(--gold)" stroke-width="3"/>{/if}
    <g data-card-unavailable={node.unavailable?'true':undefined} opacity={node.unavailable?0.65:1} style:filter={node.unavailable?'grayscale(1)':undefined}>
    {#if visual?.kind==='back'}
      <defs><clipPath id="back-{uid}"><rect x="1.2" y="1.2" width="97.6" height="137.6" rx="7.4"/></clipPath></defs>
      <g clip-path="url(#back-{uid})"><svg x="1.2" y="1.2" width="97.6" height="137.6" viewBox="0 0 60 84" preserveAspectRatio="none"><CardBack/></svg></g>
    {:else}
      {#if joker||node.emphasis==='special'}<rect x="2.5" y="2.5" width="95" height="135" rx="5" fill="none" stroke={node.emphasis==='special'?'var(--card-gold)':'currentColor'} stroke-width="1.5" stroke-dasharray={visual?.kind==='joker'&&visual.color==='Red'?'3 2':undefined}/>{/if}
      {@render index()}
      {#if cue}<svg x={full?6:7} y={full?45:61} width={full?14:22} height={full?14:22} viewBox="0 0 100 100"><CueIcon {cue} {suit}/></svg>{/if}
      {#if full}
        <g transform="translate(100 140) rotate(180)">{@render index()}</g>
        {#if joker||rank>=11&&rank<=13||node.emphasis==='special'}
          <svg x="14" y="15" width="72" height="112" viewBox="0 0 120 160"><CourtArt figure={joker?'joker':node.emphasis==='special'?'special':rank===13?'K':rank===12?'Q':'J'} {suit}/></svg>
        {:else if rank===14}
          {@render symbol(suit,26,46,48)}
        {:else}
          {#each PIPS[rank]??[] as [x,y]}
            <g transform="translate({37+x*.26} {28+y*.84}) rotate({y>50?180:0})">{@render symbol(suit,-7,-7,14)}</g>
          {/each}
        {/if}
      {:else if cue}
        <svg x="49" y="89" width="44" height="44" viewBox="0 0 100 100"><CueIcon {cue} {suit}/></svg>
      {:else}
        {@render symbol(suit,49,89,44)}
      {/if}
    {/if}
    </g>
  {/if}
</svg>
{/if}
<style>
  .shared-art{display:block;overflow:visible;pointer-events:none;font-family:var(--font-display);font-weight:800;font-variant-numeric:tabular-nums;color:var(--suit-spade)}
  .ink-heart{color:var(--suit-heart)}.ink-diamond{color:var(--suit-diamond)}.ink-club{color:var(--suit-club)}
  .vacant{fill:none;stroke:var(--ink-muted);stroke-width:4;stroke-dasharray:8 7;stroke-linecap:round}
</style>
