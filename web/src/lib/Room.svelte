<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { RoomClient, savedName } from './client.svelte';
  import { PRESET_NAME } from './presets';
  import ReportSheet from './ReportSheet.svelte';
  import PlayerFigure from './PlayerFigure.svelte';
  import RuleEditor from './RuleEditor.svelte';
  import RulebookSheet from './RulebookSheet.svelte';
  import SettingsSheet from './SettingsSheet.svelte';
  import { sound } from './sound';
  import Table from './Table.svelte';
  import { keepAwake } from './wakeLock';
  import type { BotLevel } from './types';

  const LEVEL: Record<BotLevel, string> = { easy: '초보', normal: '보통', hard: '고수' };

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
  const full = $derived(room?.seats.every((s) => s.kind !== 'empty') ?? false);
  const showTable = $derived(client.game !== null && (inHand || (room?.hands_played ?? 0) > 0));
  const showLobby = $derived(!showTable || (!inHand && (showSeats || !seated)));
  const offline = $derived(
    room?.seats.flatMap((s, i) => (s.kind === 'human' && !s.connected ? [{ seat: i, name: s.name }] : [])) ?? [],
  );

  function take(event: SubmitEvent) {
    event.preventDefault();
    if (name.trim()) client.join(name.trim());
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
      <span class="status" data-status={client.status} title={client.status === 'open' ? '연결됨' : '연결 중'}></span>
    </div>
    {#if showTable && !inHand && seated}
      <button class="ghost small" aria-pressed={showSeats} onclick={() => (showSeats = !showSeats)}>자리</button>
    {/if}
    <button class="ghost small" onclick={() => (showRules = true)} disabled={!room}>규칙</button>
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
    {#if inHand && seated && offline.length > 0}
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
      <section class="panel lobby">
        <div class="lobby-head">
          <h2>{room.hands_played === 0 ? '자리' : `${room.hands_played}판 끝`}</h2>
          {#if seated && room.hands_played === 0}
            <button class="primary" disabled={!full} onclick={() => client.start()}>시작</button>
          {/if}
        </div>
        {#if seated && !full}
          <p class="muted hint">빈 자리를 친구나 봇으로 채우면 시작할 수 있어요.</p>
        {/if}
        <div class="rules-line">
          <span>
            {PRESET_NAME[room.settings.preset] ?? room.settings.preset} 규칙
            {#if room.settings.rules}<span class="tag">바꾼 규칙</span>{/if}
          </span>
          <button class="ghost small" onclick={() => (showRules = true)}>보기</button>
          {#if seated}<button class="ghost small" onclick={() => (editRules = true)}>바꾸기</button>{/if}
        </div>

        <ol class="seats">
          {#each room.seats as s, i (i)}
            <li class:me={client.seat === i}>
              <span class="seat-no">{i + 1}</span>
              <span class="seat-figure">
                {#if s.kind !== 'empty'}<PlayerFigure still isBot={s.kind === 'bot'} offline={s.kind === 'human' && !s.connected} />{:else}<span class="empty-figure" aria-hidden="true"></span>{/if}
              </span>
              {#key s.kind + ('name' in s ? s.name : '')}<span class="seat-name fade-up">
                {#if s.kind === 'empty'}
                  <span class="muted">빈 자리</span>
                {:else}
                  {s.kind === 'bot' ? `봇 ${i + 1}` : s.name}
                  {#if s.kind === 'bot' && !seated}<span class="tag">{LEVEL[s.level ?? 'hard']}</span>{/if}
                  {#if client.seat === i}<span class="tag">나</span>{/if}
                  {#if s.kind === 'human' && !s.connected}<span class="tag warn">연결 끊김</span>{/if}
                {/if}
              </span>{/key}
              {#if room.hands_played > 0}
                <span class="score" class:neg={room.scores[i] < 0} title="누적 점수">{room.scores[i] > 0 ? '+' : ''}{room.scores[i]}</span>
              {/if}
              <span class="seat-actions">
                {#if s.kind === 'empty' && !seated && name.trim()}
                  <button onclick={() => client.join(name.trim(), i)}>앉기</button>
                {:else if s.kind === 'empty' && seated}
                  <button onclick={() => client.addBot(i)}>봇 넣기</button>
                {:else if s.kind === 'bot' && seated}
                  <select
                    class="level"
                    aria-label="봇 {i + 1} 실력"
                    value={s.level ?? 'hard'}
                    onchange={(e) => client.addBot(i, e.currentTarget.value as BotLevel)}
                  >
                    <option value="easy">초보 · 빨리 둬요</option>
                    <option value="normal">보통</option>
                    <option value="hard">고수 · 오래 생각해요</option>
                  </select>
                  {#if !inHand}<button class="ghost" onclick={() => client.removeBot(i)}>빼기</button>{/if}
                {:else if s.kind === 'human' && !s.connected && seated}
                  <button class="ghost" onclick={() => client.addBot(i)}>봇으로 바꾸기</button>
                {/if}
              </span>
            </li>
          {/each}
        </ol>

        {#if !seated}
          <form onsubmit={take}>
            <input bind:value={name} placeholder="이름" aria-label="이름" maxlength="24" />
            <button class="primary" type="submit" disabled={!name.trim() || full}>자리에 앉기</button>
          </form>
          {#if full}<p class="muted hint">자리가 다 찼어요. 구경하는 중이에요.</p>{/if}
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
    onsave={(rules) => client.setRules(room.settings.preset, rules)}
    onclose={() => (editRules = false)}
  />
{/if}
{#if showRules && room}
  <RulebookSheet preset={room.settings.preset} rules={room.settings.rules ?? null} onclose={() => (showRules = false)} />
{/if}

<style>
  .page {
    max-width: 1100px;
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
  .title strong {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .code {
    font-size: 13px;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .status {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ink-muted);
  }
  .status[data-status='open'] {
    background: var(--suit-club);
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
  .lobby {
    display: grid;
    gap: 12px;
    max-width: 560px;
    width: 100%;
    justify-self: center;
  }
  .lobby-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .lobby-head .primary {
    min-width: 120px;
  }
  .hint {
    margin: 0;
    font-size: 14px;
  }
  .seats {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .seats li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 56px;
    padding: 6px 8px 6px 12px;
    border-radius: 12px;
    background: var(--table);
  }
  .seats li.me {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }
  .seat-no {
    width: 18px;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  /* An empty seat: the outline of a figure waiting to be filled. */
  .empty-figure {
    display: block;
    width: 22px;
    height: 22px;
    margin: 2px auto 0;
    border: 2px dashed var(--line);
    border-radius: 50%;
  }
  .seat-figure {
    flex: none;
    width: 36px;
  }
  .seat-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
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
  .tag.warn {
    border-color: var(--danger);
    color: var(--danger);
  }
  .score {
    font-family: var(--font-display);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .score.neg {
    color: var(--danger);
  }
  form {
    display: flex;
    gap: 8px;
  }
  form input {
    flex: 1;
    min-width: 0;
  }
  .level {
    min-height: 40px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg);
    color: var(--ink);
    font-weight: 600;
  }
  .rules-line {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 14px;
  }
  .rules-line > span {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .leave {
    justify-self: start;
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
