<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { RoomClient, savedName } from './client.svelte';
  import { PRESET_NAME } from './presets';
  import ReportSheet from './ReportSheet.svelte';
  import LobbyTable from './LobbyTable.svelte';
  import RuleEditor from './RuleEditor.svelte';
  import RulebookSheet from './RulebookSheet.svelte';
  import { differences, traits } from './ruleFields';
  import { presetRules, takePending } from './rulesets';
  import type { Rules } from './types';
  import SettingsSheet from './SettingsSheet.svelte';
  import { sound } from './sound';
  import Table from './Table.svelte';
  import { keepAwake } from './wakeLock';

  let { id, onleave }: { id: string; onleave: () => void } = $props();

  const client = new RoomClient(untrack(() => id));
  $effect(() => {
    if (client.error) sound.error();
  });
  onDestroy(() => client.close());

  let name = $state(savedName());
  let copied = $state(false);
  let showSettings = $state(false);
  let showRules = $state(false);
  let editRules = $state(false);
  let reporting = $state(false);
  let showSeats = $state(false);

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
      client.join(name.trim() || '나');
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
  // What this table changed from its preset, for the rules line.
  let presetBase = $state<Rules | null>(null);
  $effect(() => {
    const preset = room?.settings.preset;
    if (!preset) return;
    presetRules(preset)
      .then((r) => (presetBase = r))
      .catch(() => (presetBase = null));
  });
  const custom = $derived(room?.settings.rules && presetBase ? room.settings.rules : null);
  const changedCount = $derived(custom && presetBase ? differences(custom, presetBase).length : 0);
  const changedTraits = $derived(custom && presetBase ? traits(custom, presetBase) : []);

  const full = $derived(room?.seats.every((s) => s.kind !== 'empty') ?? false);
  const showTable = $derived(client.game !== null && (inHand || (room?.hands_played ?? 0) > 0));
  const showLobby = $derived(!showTable || (!inHand && (showSeats || !seated)));
  const offline = $derived(
    room?.seats.flatMap((s, i) => (s.kind === 'human' && !s.connected ? [{ seat: i, name: s.name }] : [])) ?? [],
  );

  // Your name is asked for once, then remembered (client.join saves it), so
  // later tables seat you with a single tap on an empty seat.
  let editingName = $state(!untrack(() => name).trim());
  let pending = $state<number | null>(null);
  let nameInput = $state<HTMLInputElement>();
  const filled = $derived(room?.seats.filter((s) => s.kind !== 'empty').length ?? 0);

  function sitAt(seat: number) {
    if (name.trim()) {
      client.join(name.trim(), seat);
      editingName = false;
      return;
    }
    pending = seat;
    editingName = true;
    queueMicrotask(() => nameInput?.focus());
  }

  function take(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const seat = pending !== null && room?.seats[pending]?.kind === 'empty' ? pending : undefined;
    client.join(name.trim(), seat);
    pending = null;
    editingName = false;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      prompt('이 링크를 복사하세요', location.href);
    }
  }
</script>

<div class="page" class:playing={showTable}>
  <header>
    <button class="ghost icon" onclick={onleave} aria-label="처음으로">←</button>
    <div class="title">
      <strong>{room ? (PRESET_NAME[room.settings.preset] ?? room.settings.preset) : '마이티'}</strong>
      <span class="code">{id}</span>
      <span class="status" data-status={client.status} title={client.status === 'open' ? '연결됨' : '연결 중'} aria-hidden="true"></span>
      <span class="sr">{client.status === 'open' ? '연결됨' : client.status === 'closed' ? '연결 끊김' : '연결 중'}</span>
    </div>
    {#if showTable && !inHand && seated}
      <button class="ghost small" aria-pressed={showSeats} onclick={() => (showSeats = !showSeats)}>자리</button>
    {/if}
    <!-- In the lobby the rules sit by the seats instead. -->
    {#if !showLobby || !room}
      <button class="ghost small" onclick={() => (showRules = true)} disabled={!room}>규칙</button>
    {/if}
    <button class="ghost small" onclick={copyLink}>{copied ? '복사됨' : '링크 복사'}</button>
    <button class="ghost icon" onclick={() => (showSettings = true)} aria-label="설정">⚙︎</button>
  </header>

  {#if client.status === 'missing'}
    <section class="panel center">
      <h2>{id} 테이블이 없어요</h2>
      <p class="muted">아무도 없이 30분이 지나면 테이블이 닫혀요.</p>
      <button class="primary" onclick={onleave}>새 테이블 만들기</button>
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

    {#if showTable}
      <Table {client} />
    {/if}

    {#if showLobby}
      <section class="lobby" aria-labelledby="lobby-title">
        <div class="lobby-head">
          <h2 id="lobby-title">{room.hands_played === 0 ? '자리' : `${room.hands_played}판 끝`}</h2>
          <div class="rules-line">
            <button class="ghost small" onclick={() => (showRules = true)} aria-label="{PRESET_NAME[room.settings.preset] ?? room.settings.preset} 규칙 보기{room.settings.rules ? ', 바꾼 규칙' : ''}">
              {PRESET_NAME[room.settings.preset] ?? room.settings.preset} 규칙
              {#if room.settings.rules}<span class="tag">바꾼 규칙</span>{/if}
            </button>
            {#if seated}<button class="ghost small" onclick={() => (editRules = true)}>바꾸기</button>{/if}
          </div>
          {#if changedTraits.length}
            <!-- Friends who join read what this table plays differently;
                 a tap opens the rulebook with the changes on top. -->
            <button class="changes-line" onclick={() => (showRules = true)}>
              <span class="muted">바꾼 것 {changedCount}개</span>
              {changedTraits.join(' · ')}
            </button>
          {/if}
        </div>

        <LobbyTable
          {room}
          me={client.seat}
          onsit={sitAt}
          onaddbot={(i, level) => client.addBot(i, level)}
          onremovebot={(i) => client.removeBot(i)}
        >
          {#snippet centre()}
            {#if seated && room.hands_played === 0}
              <button class="primary start" disabled={!full} onclick={() => client.start()}>시작</button>
              <span class="count">
                <span class="num">{filled}/{room.seats.length}</span>{#if !full}{' · '}빈 자리를 친구나 봇으로 채우면 시작할 수 있어요{/if}
              </span>
            {:else if seated}
              <span class="centre-note">{room.hands_played}판 끝</span>
            {:else if full}
              <span class="centre-note">자리가 다 찼어요</span>
            {:else if editingName && pending === null}
              <span class="centre-note">이름을 적고 빈 자리를 눌러 앉으세요</span>
            {:else if !editingName}
              <span class="centre-note">빈 자리를 눌러 앉으세요</span>
            {:else if pending !== null}
              <span class="centre-note">{pending + 1}번 자리에 앉으려면 이름을 적어 주세요</span>
            {/if}
          {/snippet}
        </LobbyTable>

        {#if !seated}
          {#if full}
            <p class="muted hint">구경하는 중이에요.</p>
          {:else if editingName}
            <form onsubmit={take}>
              <input
                bind:this={nameInput}
                bind:value={name}
                placeholder="이름"
                aria-label="이름"
                maxlength="24"
                autocomplete="nickname"
              />
              <!-- The seats are the way to sit; the button only appears once a
                   seat was tapped before a name was given. -->
              {#if pending !== null}
                <button class="primary" type="submit" disabled={!name.trim()}>{pending + 1}번 자리에 앉기</button>
              {/if}
            </form>
          {:else}
            <p class="as-name">
              <span><strong>{name.trim()}</strong> 이름으로 앉아요</span>
              <button class="ghost small" onclick={() => (editingName = true)}>이름 바꾸기</button>
            </p>
          {/if}
        {:else}
          <button class="ghost leave" onclick={() => client.leave()}>자리에서 일어나기</button>
        {/if}
      </section>
    {/if}
  {/if}

  {#if client.error}
    <div class="toast" role="alert">{client.error}</div>
  {/if}
</div>

{#if showSettings}
  <SettingsSheet onclose={() => (showSettings = false)} onreport={() => (reporting = true)} />
{/if}
{#if reporting}
  <ReportSheet room={id} seat={client.seat} onclose={() => (reporting = false)} />
{/if}
{#if editRules && room}
  <RuleEditor
    preset={room.settings.preset}
    rules={room.settings.rules ?? null}
    onsave={(base, rules) => client.setRules(base, rules)}
    onclose={() => (editRules = false)}
  />
{/if}
{#if showRules && room}
  <RulebookSheet preset={room.settings.preset} rules={room.settings.rules ?? null} onclose={() => (showRules = false)} />
{/if}

<style>
  /* Out of a hand the page is the lobby's column: the header lines up with
     the seat tiles, whose width grows with the window. */
  .page {
    --tile: clamp(136px, 12vw, 200px);
    max-width: calc(5 * var(--tile) + 40px + 32px);
    margin: 0 auto;
    padding: 8px 16px 16px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  /* At the table, the width follows the window's height: a tall desktop
     window gets a wider table instead of a fixed column with empty felt. */
  .page.playing {
    max-width: max(1100px, calc((100dvh - 64px) * 1.7));
  }
  /* The arrow and the gear sit on the content's edges, not 12px inside. */
  header > .icon:first-child {
    margin-left: -12px;
  }
  header > .icon:last-child {
    margin-right: -12px;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  header {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 48px;
  }
  .icon {
    min-width: 44px;
    padding: 0;
    font-size: 20px;
  }
  .small {
    padding: 8px 10px;
    font-size: 14px;
    color: var(--ink-muted);
  }
  .small[aria-pressed='true'] {
    color: var(--ink);
  }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
    overflow: hidden;
  }
  /* When the header is tight the room code gives way first, so the rule
     set's name stays whole. */
  .title strong {
    flex: 0 1 auto;
    min-width: 2.5em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .code {
    flex: 0 100 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 420px) {
    .code {
      display: none;
    }
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
  /* The lobby is the table itself, not a list: see LobbyTable. */
  .lobby {
    display: grid;
    gap: 12px;
    max-width: calc(5 * var(--tile) + 40px);
    width: 100%;
    justify-self: center;
    padding-top: 4px;
  }
  .lobby-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 12px;
  }
  .hint {
    margin: 0;
    font-size: 14px;
    text-align: center;
    word-break: keep-all;
  }
  .tag {
    margin-left: 6px;
    padding: 1px 7px;
    border: 1px solid var(--line);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .start {
    min-width: min(120px, 100%);
  }
  .count {
    max-width: 32em;
    font-size: 14px;
    font-weight: 600;
    color: var(--ink-muted);
    word-break: keep-all;
    text-wrap: balance;
  }
  .count .num {
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .centre-note {
    font-size: 14px;
    font-weight: 600;
    color: var(--ink-muted);
    word-break: keep-all;
  }
  form {
    display: flex;
    gap: 8px;
    width: 100%;
    max-width: 420px;
    justify-self: center;
  }
  form input {
    flex: 1;
    min-width: 0;
  }
  .as-name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 4px 8px;
    margin: 0;
    font-size: 14px;
    color: var(--ink-muted);
  }
  .as-name strong {
    color: var(--ink);
  }
  .rules-line {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 14px;
  }
  .rules-line > button:last-child {
    margin-right: -10px;
  }
  .changes-line {
    flex-basis: 100%;
    justify-content: flex-start;
    min-height: 32px;
    padding: 4px 0;
    background: transparent;
    box-shadow: none;
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    word-break: keep-all;
  }
  .changes-line {
    align-items: baseline;
  }
  .changes-line .muted {
    flex: none;
  }
  .changes-line:active:not(:disabled) {
    transform: none;
  }
  .leave {
    justify-self: center;
    font-size: 14px;
    color: var(--ink-muted);
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
    z-index: 20;
  }
</style>
