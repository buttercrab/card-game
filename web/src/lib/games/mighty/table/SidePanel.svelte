<script lang="ts">
  // Wide desktops: the hand at a glance, on stacked paper beside the felt.
  // 상황판 (the contract large, the facts beside it, the tally under) over
  // 점수판 (one row a player, in seat order from you).
  import Card from '../Card.svelte';
  import HudFlow from '../../../table/HudFlow.svelte';
  import EngineFlow from '../../../table/EngineFlow.svelte';
  import EngineRow from '../../../table/EngineRow.svelte';
  import HudRows from '../../../table/HudRows.svelte';
  import HudHeader from '../../../table/HudHeader.svelte';
  import { SCOREBOARD_COLUMNS, SCOREBOARD_FIGURE } from '../../../table/hudLayout';
  import type { Seal } from '../cards';
  import PlayerFigure from '../../../ui/PlayerFigure.svelte';
  import SuitIcon, { SUIT_NAME } from '../../../SuitIcon.svelte';
  import SuitText from '../../../SuitText.svelte';
  import type { Card as CardT, RoomView, Rules } from '../types';
  import Bubble from '../../../ui/Bubble.svelte';
  import Badge from '../../../ui/Badge.svelte';
  import type { Ring } from '../../../room/seats';
  import RulesChip from '../../../ui/RulesChip.svelte';
  import TurnCue from './TurnCue.svelte';
  import Tally from './Tally.svelte';
  import type { HandView, Tag } from './view';

  let {
    hand,
    rules,
    trickNo,
    tags,
    callLabel,
    seatName,
    myName,
    seal,
    room,
    me,
    turn,
    turnAction,
    observerReactions = {},
    onpeople,
    collecting = false,
    ring,
    idle,
    rulesName,
    shuffleNote,
    onrules,
  }: {
    hand: HandView;
    rules: Rules;
    trickNo: number;
    tags: Tag[];
    callLabel: string | null;
    seatName: (seat: number) => string;
    /** Your name as the room knows it. */
    myName: string;
    seal: (card: CardT) => Seal | null;
    room: RoomView | null;
    me: number | null;
    turn: number | null;
    turnAction: string | null;
    observerReactions?: Record<string, {text: string; id: number}>;
    onpeople?: () => void;
    collecting?: boolean;
    ring: Ring;
    idle: boolean;
    rulesName: string;
    shuffleNote: string | null;
    onrules?: () => void;
  } = $props();

  const { bidding, contract, play, done, declarer, friend, call } = $derived(hand);
  const panels = $derived([{ id: 'board' }, { id: 'scores' }, ...(room && (room.observers?.length ?? 0) > 0 ? [{ id: 'observers' }] : [])]);
  const scoreRows = $derived(Array.from({ length: ring.n }, (_, k) => { const seat = ring.seatAt(k); return { id: room?.participant_ids?.[seat] ?? `seat:${seat}`, seat, mine: seat === me, active: seat === turn }; }));
</script>

<aside class="side" aria-label="게임 정보">
  <HudFlow items={panels} direction="column" gapY={8}>
  {#snippet children(panel)}
  {#if panel === 'board'}
  <section class="pane board" aria-label="상황판">
    <EngineFlow fill direction="column" inset={{left:12,right:12,top:10,bottom:12}} items={[{id:'title',width:'fill',gapAfter:8},...((turn!==null||collecting)?[{id:'turn',width:'fill' as const,gapAfter:10}]:[]),{id:'main',width:'fill',gapAfter:contract&&(play||done)?10:0},...(contract&&(play||done)?[{id:'meter',width:'fill' as const}]:[])]}>
      {#snippet children(part)}{#if part==='title'}
    <h3 class="pane-title"><EngineRow fill justify="between" gap={8} items={[{id:'title'},...(play?[{id:'round'}]:[])]}>
      {#snippet children(id)}{#if id==='title'}<span>상황판</span>{:else}<span class="round-no">라운드 <strong>{trickNo}</strong>/{rules.hand_size}</span>{/if}{/snippet}
    </EngineRow></h3>
      {:else if part==='turn'}<TurnCue name={turn!==null?seatName(turn):null} mine={turn===me} action={turnAction} {collecting}/>
      {:else if part==='meter'&&contract}

        <div class="side-meter"><EngineFlow fill direction="column" gap={6} items={[{id:'counts',width:'fill'},{id:'tally',width:'fill'},...(tags.length?[{id:'tags',width:'fill' as const}]:[])]}>
          {#snippet children(id)}{#if id==='counts'}<div class="meter-row"><EngineRow fill justify="between" items={[{id:'declarer',width:'fill'},{id:'defense'}]}>{#snippet children(side)}{#if side==='declarer'}<span>여당 {#key hand.teamPoints}<strong class="bump">{hand.teamPoints}</strong>{/key}<span class="of">/{contract.count}</span></span>{:else}<span>야당 <strong>{hand.tally.def}</strong></span>{/if}{/snippet}</EngineRow></div>
          {:else if id==='tally'}<Tally tally={hand.tally} goal={contract.count} wide />
          {:else}<EngineRow fill nowrap={false} gap={4} items={tags.map(tag=>({id:tag.text}))}>{#snippet children(tagId)}{@const tag=tags.find(tag=>tag.text===tagId)}{#if tag}<Badge kind="tag" tone={tag.tone} class="pop">{tag.text}</Badge>{/if}{/snippet}</EngineRow>{/if}{/snippet}
        </EngineFlow></div>
      {:else if bidding}

      <div class="big-contract"><EngineRow fill gap={6} items={bidding.best?[{id:'glyph',width:34},{id:'count'},{id:'details',width:'fill'}]:[{id:'details',width:'fill'}]}>
        {#snippet children(id)}{#if bidding.best}{@const best=bidding.best[1]}
          {#if id==='glyph'}<span class="glyph-box"><EngineRow fill justify="center" minHeight={34} items={[{id:'glyph'}]}>{#snippet children()}{#if best.trump}<SuitIcon suit={best.trump} size="30px" label={SUIT_NAME[best.trump]} />{:else}<span class="nt">노</span>{/if}{/snippet}</EngineRow></span>
          {:else if id==='count'}<span class="big-num">{best.count}</span>
          {:else}<div class="big-sub">최고 공약<br /><strong>{seatName(bidding.best[0])}</strong></div>{/if}
        {:else}<div class="big-sub">공약 없음<br /><strong>최소 {hand.lastChance ?? rules.bidding.min}</strong></div>{/if}{/snippet}
      </EngineRow></div>
      {:else if contract}

      <div class="big-contract"><EngineRow fill gap={6} items={[{id:'glyph',width:34},{id:'count'},{id:'facts',width:'fill'}]}>
        {#snippet children(id)}{#if id==='glyph'}<span class="glyph-box"><EngineRow fill justify="center" minHeight={34} items={[{id:'glyph'}]}>{#snippet children()}{#if contract.trump}<SuitIcon suit={contract.trump} size="30px" label={SUIT_NAME[contract.trump]} />{:else}<span class="nt">노</span>{/if}{/snippet}</EngineRow></span>
        {:else if id==='count'}<span class="big-num">{contract.count}</span>
        {:else}<dl class="facts"><EngineFlow fill direction="column" gap={3} inset={{left:18}} items={[...(declarer!==null?[{id:'declarer',width:'fill' as const}]:[]),...(callLabel?[{id:'friend',width:'fill' as const}]:[])]}>
          {#snippet children(fact)}<EngineRow fill gap={6} items={[{id:'label',width:42},{id:'value',width:'fill'}]}>
            {#snippet children(part)}{#if part==='label'}<dt>{fact==='declarer'?'주공':'프렌드'}</dt>
            {:else}<dd>{#if fact==='declarer'}<span class="clip">{seatName(declarer!)}</span>{:else}<EngineRow fill gap={5} items={[...(friend===null&&!hand.noFriend&&call&&typeof call==='object'&&'Card'in call?[{id:'card'}]:[]),{id:'label',width:'fill'}]}>
              {#snippet children(piece)}{#if piece==='card'&&call&&typeof call==='object'&&'Card'in call}<Card card={call.Card} size="mini" width={22} seal={seal(call.Card)} twoJokers={hand.twoJokers} />{:else}<span class="clip"><SuitText text={callLabel??''}/></span>{/if}{/snippet}
            </EngineRow>{/if}</dd>{/if}{/snippet}
          </EngineRow>{/snippet}
        </EngineFlow></dl>{/if}{/snippet}
      </EngineRow></div>
      {:else if idle&&room}<EngineFlow fill direction="column" gap={0} items={[{id:'empty',width:'fill'},...(shuffleNote?[{id:'shuffle',width:'fill' as const}]:[]),{id:'rules',width:'fill'}]}>
        {#snippet children(id)}{#if id==='empty'}<p class="pane-empty">{room.hands_played===0?'첫 판을 기다려요':`${room.hands_played}판 끝 · 다음 판을 기다려요`}</p>{:else if id==='shuffle'}<p class="pane-empty"><strong>{shuffleNote}</strong></p>{:else}<EngineFlow fill direction="column" inset={{top:8}} items={[{id:'rules',width:'fill'}]}>{#snippet children()}<RulesChip name={rulesName} onclick={onrules}/>{/snippet}</EngineFlow>{/if}{/snippet}
      </EngineFlow>{:else}<p class="pane-empty">패를 나누는 중</p>{/if}{/snippet}
    </EngineFlow>
  </section>

  {:else if panel === 'scores'}
  <section class="pane scores" aria-label="점수판">
    <EngineFlow fill direction="column" gap={8} inset={{left:12,right:12,top:10,bottom:12}} items={[{id:'heading',width:'fill'},{id:'rows',width:'fill'}]}>{#snippet children(part)}{#if part==='heading'}
    <h3 class="pane-title"><HudHeader columns={SCOREBOARD_COLUMNS}>
      {#snippet leading()}<span>점수판</span>{/snippet}
      {#snippet cell(column)}<span class="score-caption">{column==='hand'?'점수':'누적'}</span>{/snippet}
    </HudHeader></h3>
    {:else}
    <HudRows rows={scoreRows} columns={SCOREBOARD_COLUMNS}>
      {#snippet cell(row, column)}
        {@const s = row.seat}
        {@const info = room?.seats[s]}
        {@const matched = !done || !room?.current_hand || room.current_hand.participant_ids[s] === room.participant_ids?.[s]}
        {@const t = matched ? hand.team(s) : null}
        {@const vacant = info?.kind === 'empty' && s !== me}
        {#if column === 'figure'}
          <span class="head" class:on={turn === s} style:width={`${SCOREBOARD_FIGURE.artWidth}px`} style:left={`${SCOREBOARD_FIGURE.offsetX}px`}>
            {#if vacant}
              <svg class="vacant-figure" viewBox="0 0 120 110" aria-hidden="true"><path d="M20 108 Q22 76 60 72 Q98 76 100 108" /><circle cx="60" cy="48" r="20" /></svg>
            {:else}
              <PlayerFigure still team={t} trumpSuit={contract?.trump ?? null} isBot={info?.kind === 'bot'} offline={info?.kind === 'human' && !info.connected} />
            {/if}
          </span>
        {:else if column === 'identity'}
          <div class="who-cell"><EngineRow fill gap={6} items={[{id:'name',width:'fill'},...(t?[{id:'badge'}]:[])]}>{#snippet children(id)}{#if id==='name'}<span class="row-name">{s === me ? myName : vacant && idle ? '빈 자리' : seatName(s)}</span>{:else}<Badge team={t} size="sm" />{/if}{/snippet}</EngineRow></div>
        {:else if column === 'hand'}
          <span class="num">{matched && (play || done) ? hand.points(s) : '–'}</span>
        {:else if column === 'total'}
          <span class="num total" class:neg={(room?.scores[s] ?? 0) < 0}>{vacant && idle ? '–' : (room?.scores[s] ?? 0)}</span>
        {/if}
      {/snippet}
    </HudRows>{/if}{/snippet}</EngineFlow>
  </section>
  {:else if panel === 'observers' && room}
    <section class="pane observer-pane" aria-label="관전자"><EngineFlow fill direction="column" gap={8} inset={{left:12,right:12,top:10,bottom:12}} items={[{id:'heading',width:'fill'},{id:'list',width:'fill'}]}>
      {#snippet children(part)}{#if part==='heading'}<h3 class="pane-title"><EngineRow fill justify="between" items={[{id:'title'},{id:'action'}]}>{#snippet children(id)}{#if id==='title'}<span>관전 중 · {room.watching}명</span>{:else}<button class="btn ghost" onclick={onpeople}>모두 보기</button>{/if}{/snippet}</EngineRow></h3>
      {:else}<div class="observer-list" style:max-height={'136px'} role="list"><EngineFlow fill direction="column" gap={0} items={(room.observers??[]).map(o=>({id:o.id,width:'fill' as const}))}>
        {#snippet children(id)}{@const observer=room.observers?.find(o=>o.id===id)}{#if observer}<div class="observer-row" role="listitem"><EngineFlow fill direction="column" gap={8} inset={{top:7,bottom:7}} items={[{id:'identity',width:'fill'},{id:'reaction',width:'fill'}]}>
          {#snippet children(row)}{#if row==='identity'}<EngineRow fill justify="between" nowrap={false} gap={8} items={[{id:'name'},{id:'status'}]}>{#snippet children(cell)}{#if cell==='name'}<span>{observer.name}</span>{:else}<small>{observer.requested?'다음 판 참여 요청':'관전 중'}</small>{/if}{/snippet}</EngineRow>
          {:else}<EngineRow fill minHeight={48} items={observerReactions[id]?[{id:'bubble'}]:[]}>{#snippet children()}{#if observerReactions[id]}{#key observerReactions[id].id}<Bubble text={observerReactions[id].text}/>{/key}{/if}{/snippet}</EngineRow>{/if}{/snippet}
        </EngineFlow></div>{/if}{/snippet}
      </EngineFlow></div>{/if}{/snippet}
    </EngineFlow></section>
  {/if}
  {/snippet}
  </HudFlow>
</aside>

<style>
  .observer-list { overflow:auto; }
  .observer-row { font-size:13px; }
  .observer-pane small { color:var(--ink-muted);font-size:11px; }
  .observer-pane button { min-height:32px;font-size:11px;padding:3px 0; }
  .side {
    min-height: 0;
    overflow: hidden;
  }
  .pane {
    border-radius: var(--r-panel);
    background: var(--panel);
    font-size: var(--text-label);
  }
  .pane-empty {
    margin: 0;
    color: var(--ink-muted);
  }
  .pane-title {
    margin:0;
    font-size: var(--text-caption);
    font-weight: 700;
    color: var(--ink-muted);
  }
  .round-no {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .round-no strong {
    color: var(--ink);
    font-family: var(--font-display);
    font-weight: 800;
  }
  .score-caption { display:block;text-align:right;font-weight:600;font-variant-numeric:tabular-nums; }
  .big-contract { min-width:0; }
  .glyph-box { display:block;color:var(--ink); }
  .nt {
    font-size: 18px;
    font-weight: 800;
  }
  .big-num {
    display:block;
    font-family: var(--font-display);
    font-size: 38px;
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }
  .big-sub {
    color: var(--ink-muted);
    line-height: 1.35;
  }
  .big-sub strong {
    color: var(--ink);
  }
  .facts { min-width:0;margin:0;border-left:1px solid var(--line); }
  .facts dt { color:var(--ink-muted); }
  .facts dd { min-width:0;margin:0;overflow:hidden;font-weight:700;color:var(--ink);white-space:nowrap;text-overflow:ellipsis; }
  .clip {
    display:block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .side-meter {
    min-width:0;
  }
  .meter-row {
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .meter-row strong {
    color: var(--ink);
    font-family: var(--font-display);
    font-size: var(--text-body);
    font-weight: 800;
  }
  .head {
    display:block;
    position: relative;
  }
  .vacant-figure {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
    fill: none;
    stroke: var(--ink-muted);
    stroke-width: 6;
    stroke-dasharray: 10 9;
    stroke-linecap: round;
  }
  /* The turn: the same plum ring the seat wears, in small. */
  .head::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 28px;
    height: 28px;
    border: 1.5px solid var(--accent);
    border-radius: 50%;
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.85);
    transition:
      opacity var(--dur-quick) var(--ease-standard),
      transform var(--dur-move) var(--ease-settle);
  }
  .head.on::after {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
  /* Name, then the badge in a column of its own so badges line up. */
  .who-cell { min-width:0; }
  .row-name {
    display:block;
    min-width: 0;
    max-width: 9em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .num {
    display:block;
    text-align: right;
    font-family: var(--font-display);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .total {
    color: var(--ink);
  }
  .total.neg {
    color: var(--danger);
  }
</style>
