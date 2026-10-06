<script lang="ts">
  // A room, for any game: the bar (the table's code, its menu), the
  // banners, the toast, the menu's sheets and, in the middle, the table
  // of the game the room plays, as `games` finds it by the room's `game`.
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { CATALOG } from '../catalog';
  import Icon from '../Icon.svelte';
  import { closeTop } from '../layers';
  import ReportSheet from '../ReportSheet.svelte';
  import SettingsSheet from '../SettingsSheet.svelte';
  import SuitText from '../SuitText.svelte';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Switch from '../ui/Switch.svelte';
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
  let settingsButton = $state<HTMLButtonElement>();
  let settingsOpener: HTMLElement | null = null;
  const TURNS = CATALOG.turn_limits.map((secs) => ({ value: secs, label: secs === 0 ? '끔' : `${secs}초` }));
  function openSettings() {
    settingsOpener = ui.menu ? (settingsButton ?? null) : document.activeElement as HTMLElement;
    ui.closeMenu();
    showSettings = true;
  }
  function closeSettings() {
    showSettings = false;
    void tick().then(() => { if (settingsOpener?.isConnected) settingsOpener.focus(); });
  }
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
    <button class="btn icon settings-btn" bind:this={settingsButton} onclick={openSettings} aria-label="설정" aria-haspopup="dialog"><Icon name="sliders" size="24px" /></button>
    <button class="btn icon menu-btn" onclick={() => (ui.menu = true)} aria-label="메뉴" aria-haspopup="dialog"><Icon name="menu" size="24px" /></button>
  </header>

  <div class="feedback-rail">
    {#if toast}
      {#key toast.id}<div class="toast" data-kind={toast.kind} role={toast.kind === 'error' ? 'alert' : 'status'}><span>{toast.kind === 'error' ? '알림' : '안내'}</span><span class="message" title={toast.text}><SuitText text={toast.text} /></span></div>{/key}
    {/if}
  </div>
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
        onsettings={openSettings}
        onrules={() => (showRules = true)}
        oninvite={doInvite}
      />
    {/if}
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
    onsettings={openSettings}
    onreport={() => (reporting = true)}
    onleave={leave}
  />
{/if}
{#if showSettings}
  <SettingsSheet onclose={closeSettings}>
    {#snippet table()}
      {#if room}
        <h3>테이블 설정</h3>
        <p class="muted">모두에게 적용돼요. 앉은 사람이 판과 판 사이에 바꿀 수 있어요.</p>
        {#if seated && !inHand}
          <p>턴 시간</p>
          <Segmented options={TURNS} value={room.table.turn_secs} onchange={(secs) => client.setTable({ turn_secs: secs })} label="턴 시간" />
          <p class="muted">{room.table.turn_secs > 0 ? '시간이 지나면 봇이 대신 둬요.' : '시간 제한 없이 둬요.'}</p>
          <Switch checked={room.table.shuffle} onchange={(on) => client.setTable({ shuffle: on })}>매 판 자리 섞기</Switch>
          <Button wide onclick={() => { closeSettings(); editRules = true; }}>규칙 바꾸기</Button>
        {:else}
          <p>턴 시간 <strong>{room.table.turn_secs === 0 ? '끔' : `${room.table.turn_secs}초`}</strong>{room.table.shuffle ? ' · 매 판 자리 섞기' : ''}</p>
          {#if inHand}<p class="muted">판이 끝나면 바꿀 수 있어요.</p>{/if}
        {/if}
      {/if}
    {/snippet}
  </SettingsSheet>
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
    --chrome: 120px;
    max-width: max(1100px, calc((100dvh - 64px) * 1.7));
    margin: 0 auto;
    /* Edge seats and their chips can round a pixel past a narrow screen
     * (fonts differ by platform); the table never scrolls sideways. */
    overflow-x: clip;
    padding: 8px 16px 16px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .settings-btn { margin-left: auto; }
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
  .feedback-rail { height: 32px; position: relative; display: flex; justify-content: center; z-index: var(--z-toast); }
  .toast .message { min-width: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; line-height: 12px; }
  .toast > span:first-child { flex: none; font-weight: 800; }
  @media (orientation: landscape) and (max-height: 520px) {
    .page { --chrome: 112px; }
    .feedback-rail { height: 24px; }
  }
  .toast {
    display: flex; align-items: center; gap: 8px;
    width: min(420px, 100%); min-height: 28px; max-height: 32px; padding: 3px 10px;
    font-size: 12px; line-height: 1.4;
    border-radius: var(--r-control);
    background: var(--ink);
    color: var(--table);
    font-weight: 600;
    /* Suits on the ink toast take its colour. */
    --suit-tone: currentColor;
    z-index: var(--z-toast);
  }
</style>
