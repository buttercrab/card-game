<script lang="ts">
  // A room, for any game: the bar (the table's code, its menu), the
  // banners, the toast, the menu's sheets and, in the middle, the table
  // of the game the room plays, as `games` finds it by the room's `game`.
  import { onDestroy, onMount, untrack } from 'svelte';
  import { CATALOG } from '../catalog';
  import Icon from '../Icon.svelte';
  import { closeTop } from '../layers';
  import ReportSheet from '../ReportSheet.svelte';
  import SettingsSheet from '../SettingsSheet.svelte';
  import SuitText from '../SuitText.svelte';
  import Button from '../ui/Button.svelte';
  import { RoomClient, savedName } from './client.svelte';
  import type { GameResolver } from './game';
  import GameMenu from './GameMenu.svelte';
  import { invite } from './invite';
  import type { TableClient } from './tableClient';
  import { TableUi } from './ui.svelte';
  import { keepAwake } from './wakeLock';

  let {
    id,
    onleave,
    games,
    client: given,
    ui: givenUi,
  }: {
    id: string;
    /** Off the table, to the home page; the table's own history entry is gone by then. */
    onleave: () => void;
    /** The game for the room's `game` id (games/registry.ts). */
    games: GameResolver;
    /** The connection to the room; a live one to `id` by default. */
    client?: TableClient;
    /** What is open at the table. */
    ui?: TableUi;
  } = $props();

  const client: TableClient = untrack(() => given) ?? new RoomClient(untrack(() => id));
  const ui = untrack(() => givenUi) ?? new TableUi();

  // Off the page, nothing of the table keeps running: no socket, no
  // reconnect, no timer.
  onDestroy(() => {
    client.close();
    clearTimeout(invitedTimer);
  });
  /** The client plays the error sound; notices are quiet. */
  const toast = $derived(client.toasts.current);

  let showSettings = $state(false);
  let showRules = $state(false);
  let editRules = $state(false);
  let reporting = $state(false);
  /** Just shared or copied, for a moment. */
  let invited = $state<'shared' | 'copied' | null>(null);
  let invitedTimer: ReturnType<typeof setTimeout> | undefined;

  const room = $derived(client.room);
  /** The game the room plays, once it says which. */
  const game = $derived(room ? games(room.game) : null);
  // The game's own words for the refusals only it makes.
  $effect(() => {
    client.refusal = game?.refusal ?? null;
  });
  /** The server speaks another protocol than this page was built for, or
   * plays a game this page does not have. */
  const outdated = $derived(room !== null && (room.protocol !== CATALOG.protocol || game === null));
  const seated = $derived(client.seat !== null);
  const inHand = $derived(room?.in_hand ?? false);
  $effect(() => keepAwake(inHand));
  onDestroy(() => keepAwake(false));
  // A practice table from the tutorial seats you, fills up with easy bots
  // and deals, so a newcomer lands straight in a hand.
  let practice = $state(
    (() => {
      try {
        return sessionStorage.getItem('mighty.practice') === untrack(() => id);
      } catch {
        return false;
      }
    })(),
  );
  $effect(() => {
    if (!practice || !room || client.status !== 'open') return;
    if (client.seat === null) {
      client.join(savedName().trim() || '나');
      return;
    }
    if (room.in_hand || room.hands_played > 0) {
      practice = false;
      try {
        sessionStorage.removeItem('mighty.practice');
      } catch {
        // Nothing to forget.
      }
      return;
    }
    const empty = room.seats.findIndex((s) => s.kind === 'empty');
    if (empty >= 0) client.addBot(empty, 'easy');
    else client.start();
  });
  /** The rules' name, with what the table changed, as its game says it. */
  const rulesName = $derived(room && game ? game.rulesName(room) : '');
  const offline = $derived(
    room?.seats.flatMap((s, i) => (s.kind === 'human' && !s.connected ? [{ seat: i, name: s.name }] : [])) ?? [],
  );

  async function doInvite() {
    const how = await invite(id);
    if (how === 'failed') return;
    invited = how;
    clearTimeout(invitedTimer);
    invitedTimer = setTimeout(() => (invited = null), 1800);
  }

  // ---- The way out ---------------------------------------------------------
  // The table holds one history entry of its own, so the back gesture (or
  // the browser's back button) opens the menu, or closes the sheet on top,
  // instead of quietly leaving mid-game. Only 나가기 leaves.
  let leaving = false;
  const mark = () => ({ ...(history.state ?? {}), table: id });
  /** On the table's own address (not a page that draws one). */
  const routed = () => location.pathname.replace(/\/$/, '') === `/r/${id}`;
  onMount(() => {
    if (!routed()) return;
    // A reload lands on the entry already marked: no second one.
    if (history.state?.table !== id) history.pushState(mark(), '');
    const onpop = () => {
      if (leaving) return;
      if (!routed()) return;
      history.pushState(mark(), '');
      if (!closeTop()) ui.menu = true;
    };
    addEventListener('popstate', onpop);
    return () => removeEventListener('popstate', onpop);
  });

  /** Steps back off the table's own entry, then hands over to the app. */
  async function leave() {
    leaving = true;
    // Even while reconnecting (not seated just now): the seat's token is
    // forgotten, so the table never takes the seat back.
    client.leave();
    ui.closeMenu();
    if (routed() && history.state?.table === id) {
      await new Promise<void>((done) => {
        addEventListener('popstate', () => done(), { once: true });
        history.back();
      });
    }
    onleave();
  }
</script>

<div class="page">
  <!-- No page header: the table's code (a tap invites) and its one menu. -->
  <header class="bar">
    <button class="btn code-chip" onclick={doInvite} aria-label="친구 초대: 테이블 {id} 링크 {invited ? '복사됨' : '보내기'}">
      <span class="status" data-status={client.status} aria-hidden="true"></span>
      {#if invited}
        <span class="said" role="status">{invited === 'shared' ? '보냈어요' : '복사했어요'}</span>
      {:else}
        <span class="code">{id}</span>
        <Icon name="invite" size="18px" />
      {/if}
    </button>
    <span class="sr">{client.status === 'open' ? '연결됨' : client.status === 'closed' ? '연결 끊김' : '연결 중'}</span>
    {#if room?.watching}<span class="watching">구경 <span class="num">{room.watching}</span>명</span>{/if}
    <button class="btn icon menu-btn" onclick={() => (ui.menu = true)} aria-label="메뉴" aria-haspopup="dialog"><Icon name="menu" size="24px" /></button>
  </header>

  {#if client.status === 'missing'}
    <section class="panel center">
      <h2>{id} 테이블이 없어요</h2>
      <p class="muted">아무도 없이 {CATALOG.idle_minutes}분이 지나면 테이블이 닫혀요.</p>
      <Button variant="primary" onclick={leave}>새 테이블 만들기</Button>
    </section>
  {:else if !room}
    <p class="muted center">연결하는 중…</p>
  {:else}
    {#if outdated}
      <!-- A tab left open across a deploy: the server speaks a newer
           protocol than this page was built for. -->
      <div class="banner" role="status">
        <span>새 버전이 나왔어요.</span>
        <Button size="sm" onclick={() => location.reload()}>새로고침</Button>
      </div>
    {:else if client.status !== 'open'}
      <!-- The link dropped (a deploy restarts the server): the client
           reconnects on its own and reclaims the seat with its token. -->
      <div class="banner" role="status">
        <span>잠깐 다시 연결하는 중…</span>
      </div>
    {:else if inHand && seated && offline.length > 0}
      <div class="banner">
        {#each offline as o (o.seat)}
          <span>{o.name} 연결이 끊겼어요.</span>
          <Button size="sm" onclick={() => client.addBot(o.seat)}>봇에게 맡기기</Button>
        {/each}
      </div>
    {/if}

    {#if game}
      <game.Table
        {client}
        {ui}
        {rulesName}
        onmenu={() => (ui.menu = true)}
        onrules={() => (showRules = true)}
        oninvite={doInvite}
      />
    {/if}
  {/if}

  {#if toast}
    {#key toast.id}
      <div class="toast" data-kind={toast.kind} role={toast.kind === 'error' ? 'alert' : 'status'}><SuitText text={toast.text} /></div>
    {/key}
  {/if}
</div>

{#if ui.menu && room}
  <GameMenu
    {room}
    {seated}
    {rulesName}
    {invited}
    bind:leaving={ui.leaving}
    onclose={() => ui.closeMenu()}
    oninvite={doInvite}
    onrules={() => (showRules = true)}
    oneditrules={() => (editRules = true)}
    onsettings={() => (showSettings = true)}
    onreport={() => (reporting = true)}
    onturn={(secs) => client.setTable({ turn_secs: secs })}
    onshuffle={(on) => client.setTable({ shuffle: on })}
    onleave={leave}
  />
{/if}
{#if showSettings}
  <SettingsSheet onclose={() => (showSettings = false)} />
{/if}
{#if reporting}
  <ReportSheet room={id} seat={client.seat} onclose={() => (reporting = false)} />
{/if}
{#if editRules && room && game}
  <game.RulesSheet {room} {client} edit onclose={() => (editRules = false)} />
{/if}
{#if showRules && room && game}
  <game.RulesSheet {room} {client} edit={false} onclose={() => (showRules = false)} />
{/if}

<style>
  /* At the table, the width follows the window's height: a tall desktop
     window gets a wider table instead of a fixed column with empty felt. */
  .page {
    max-width: max(1100px, calc((100dvh - 64px) * 1.7));
    margin: 0 auto;
    padding: 8px 16px 16px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
  }
  /* The table's code on a small paper chip: a tap invites a friend. */
  .code-chip {
    gap: 8px;
    padding: 6px 12px;
    border-radius: var(--r-pill);
    font-size: 14px;
    font-weight: 700;
    box-shadow: 0 2px 0 var(--btn-lip);
  }
  .code {
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
  }
  .said {
    font-size: 14px;
  }
  .watching {
    flex: none;
    font-size: var(--text-label);
    font-weight: 600;
    color: var(--ink-muted);
  }
  .watching .num {
    font-variant-numeric: tabular-nums;
  }
  .menu-btn {
    width: 48px;
    margin-left: auto;
    margin-right: -10px;
  }
  /* Connected: a small ink dot. Connecting: an empty ring. Lost: red. */
  .status {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--ink-muted);
  }
  .status[data-status='open'] {
    background: var(--ink-muted);
    box-shadow: none;
  }
  .status[data-status='closed'] {
    background: var(--danger);
  }

  .panel {
    padding: 16px;
    border-radius: var(--r-panel);
    background: var(--panel);
  }
  .center {
    text-align: center;
  }
  h2 {
    margin: 0;
    font-size: var(--text-title);
  }
  .banner {
    position: fixed;
    top: calc(56px + env(safe-area-inset-top));
    left: 16px;
    right: 16px;
    z-index: var(--z-banner);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 8px 12px;
    border-radius: var(--r-control);
    background: var(--panel);
    font-size: 14px;
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(20px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    max-width: calc(100% - 32px);
    padding: 10px 16px;
    border-radius: var(--r-control);
    background: var(--ink);
    color: var(--table);
    font-weight: 600;
    /* Suits on the ink toast take its colour. */
    --suit-tone: currentColor;
    z-index: var(--z-toast);
  }
</style>
