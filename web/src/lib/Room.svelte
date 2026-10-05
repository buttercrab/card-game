<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { RoomClient, savedName } from './client.svelte';
  import GameMenu from './GameMenu.svelte';
  import Icon from './Icon.svelte';
  import { invite } from './invite';
  import { closeTop } from './layers';
  import { PRESET_NAME } from './presets';
  import ReportSheet from './ReportSheet.svelte';
  import RuleEditor from './RuleEditor.svelte';
  import RulebookSheet from './RulebookSheet.svelte';
  import { differences } from './ruleFields';
  import { presetRules, takePending } from './rulesets';
  import type { Rules } from './types';
  import SettingsSheet from './SettingsSheet.svelte';
  import Table from './Table.svelte';
  import { keepAwake } from './wakeLock';

  let {
    id,
    onleave,
    preview = null,
    menu: menuAtStart = false,
  }: {
    id: string;
    /** Off the table, to the home page; the table's own history entry is gone by then. */
    onleave: () => void;
    /** A made-up connection, for /preview. */
    preview?: RoomClient | null;
    /** Open with the menu showing (the preview). */
    menu?: boolean;
  } = $props();

  const client = untrack(() => preview) ?? new RoomClient(untrack(() => id));
  // Off the page, nothing of the table keeps running: no socket, no
  // reconnect, no timer.
  onDestroy(() => {
    client.close();
    clearTimeout(invitedTimer);
  });
  /** The client plays the error sound; notices are quiet. */
  const toast = $derived(client.toasts.current);

  let showMenu = $state(untrack(() => menuAtStart));
  let showSettings = $state(false);
  let showRules = $state(false);
  let editRules = $state(false);
  let reporting = $state(false);
  /** Just shared or copied, for a moment. */
  let invited = $state<'shared' | 'copied' | null>(null);
  let invitedTimer: ReturnType<typeof setTimeout> | undefined;

  const room = $derived(client.room);
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
  // Rules picked on the home page start once their maker sits down.
  $effect(() => {
    if (!room || client.seat === null || room.in_hand || client.status !== 'open') return;
    const pending = untrack(() => takePending(id));
    if (pending) client.setRules(pending.base, pending.rules);
  });
  // What this table changed from its preset, for the rules' name: against
  // the preset as the table pinned it, not as the preset reads today.
  let fetchedBase = $state<Rules | null>(null);
  const presetBase = $derived(room?.settings.preset_rules ?? fetchedBase);
  $effect(() => {
    const preset = room?.settings.preset;
    // A server too old to say: the preset as it is today.
    if (!preset || room?.settings.preset_rules) return;
    presetRules(preset)
      .then((r) => (fetchedBase = r))
      .catch(() => (fetchedBase = null));
  });
  const changedCount = $derived(
    room?.settings.rules && presetBase ? differences(room.settings.rules, presetBase).length : 0,
  );
  const rulesName = $derived(
    room
      ? `${PRESET_NAME[room.settings.preset] ?? room.settings.preset} 규칙${changedCount ? ` · 바꾼 것 ${changedCount}개` : room.settings.rules ? ' · 바꾼 규칙' : ''}`
      : '',
  );
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
  onMount(() => {
    if (preview) return;
    // A reload lands on the entry already marked: no second one.
    if (history.state?.table !== id) history.pushState(mark(), '');
    const onpop = () => {
      if (leaving) return;
      if (location.pathname.replace(/\/$/, '') !== `/r/${id}`) return;
      history.pushState(mark(), '');
      if (!closeTop()) showMenu = true;
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
    showMenu = false;
    if (!preview && history.state?.table === id) {
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
    <button class="code-chip" onclick={doInvite} aria-label="친구 초대: 테이블 {id} 링크 {invited ? '복사됨' : '보내기'}">
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
    <button class="menu-btn" onclick={() => (showMenu = true)} aria-label="메뉴" aria-haspopup="dialog"><Icon name="menu" size="24px" /></button>
  </header>

  {#if client.status === 'missing'}
    <section class="panel center">
      <h2>{id} 테이블이 없어요</h2>
      <p class="muted">아무도 없이 30분이 지나면 테이블이 닫혀요.</p>
      <button class="primary" onclick={leave}>새 테이블 만들기</button>
    </section>
  {:else if !room}
    <p class="muted center">연결하는 중…</p>
  {:else}
    {#if client.status !== 'open'}
      <!-- The link dropped (a deploy restarts the server): the client
           reconnects on its own and reclaims the seat with its token. -->
      <div class="banner" role="status">
        <span>잠깐 다시 연결하는 중…</span>
      </div>
    {:else if inHand && seated && offline.length > 0}
      <div class="banner">
        {#each offline as o (o.seat)}
          <span>{o.name} 연결이 끊겼어요.</span>
          <button onclick={() => client.addBot(o.seat)}>봇에게 맡기기</button>
        {/each}
      </div>
    {/if}

    <Table
      {client}
      {rulesName}
      onmenu={() => (showMenu = true)}
      onrules={() => (showRules = true)}
      oninvite={doInvite}
    />
  {/if}

  {#if toast}
    {#key toast.id}
      <div class="toast" data-kind={toast.kind} role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.text}</div>
    {/key}
  {/if}
</div>

{#if showMenu && room}
  <GameMenu
    {room}
    {seated}
    {rulesName}
    {invited}
    onclose={() => (showMenu = false)}
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
{#if editRules && room}
  <RuleEditor
    preset={room.settings.preset}
    rules={room.settings.rules ?? null}
    base={room.settings.preset_rules ?? null}
    onsave={(base, rules) =>
      // On the same preset, the table keeps the preset's rules it pinned.
      client.setRules(base, rules, base === room.settings.preset ? room.settings.preset_rules : undefined)}
    onclose={() => (editRules = false)}
  />
{/if}
{#if showRules && room}
  <RulebookSheet
    preset={room.settings.preset}
    rules={room.settings.rules ?? null}
    base={room.settings.preset_rules ?? null}
    onclose={() => (showRules = false)}
  />
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
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
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
    min-height: 40px;
    padding: 6px 12px;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 700;
    color: var(--ink);
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
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .watching .num {
    font-variant-numeric: tabular-nums;
  }
  .menu-btn {
    width: 48px;
    min-width: 48px;
    height: 44px;
    margin-left: auto;
    margin-right: -10px;
    padding: 0;
    background: transparent;
    box-shadow: none;
    color: var(--ink);
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
    border-radius: 16px;
    background: var(--panel);
  }
  .center {
    text-align: center;
  }
  h2 {
    margin: 0;
    font-size: 17px;
  }
  .banner {
    position: fixed;
    top: calc(56px + env(safe-area-inset-top));
    left: 16px;
    right: 16px;
    z-index: 15;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 8px 12px;
    border-radius: 12px;
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
    border-radius: 12px;
    background: var(--ink);
    color: var(--table);
    font-weight: 600;
    z-index: 50;
  }
</style>
