<script lang="ts">
  import Card from './Card.svelte';
  import BackArt from './CardBack.svelte';
  import { ACHIEVEMENTS, BACK_NAMES, TABLE_NAMES, isUnlocked, loadUnlocked, type CardBack, type TableTone } from './achievements';
  import { settings, type Speed } from './settings.svelte';

  const unlocked = loadUnlocked();
  const BACKS = Object.keys(BACK_NAMES) as CardBack[];
  const TONES = Object.keys(TABLE_NAMES) as TableTone[];
  /** What earns a look, for a locked one. */
  const howTo = (kind: 'back' | 'table', id: string) =>
    ACHIEVEMENTS.find((a) => a.reward?.kind === kind && a.reward.id === id)?.how ?? '';

  let { onclose, onreport }: { onclose: () => void; onreport?: () => void } = $props();

  const SPEEDS: { id: Speed; label: string }[] = [
    { id: 'normal', label: '보통' },
    { id: 'fast', label: '빠르게' },
    { id: 'off', label: '끄기' },
  ];

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });
</script>

<dialog bind:this={dialog} onclose={onclose} aria-labelledby="settings-title">
  <h2 id="settings-title">설정</h2>

  <label class="row">
    <span>
      <strong>4색 덱</strong>
      <span class="muted">♦ 주황, ♣ 파랑</span>
    </span>
    <input type="checkbox" bind:checked={settings.fourColor} />
  </label>
  <div class="preview" aria-hidden="true">
    <Card card={{ Normal: ['Spade', 14] }} size="mini" />
    <Card card={{ Normal: ['Heart', 14] }} size="mini" />
    <Card card={{ Normal: ['Diamond', 14] }} size="mini" />
    <Card card={{ Normal: ['Club', 14] }} size="mini" />
  </div>

  <label class="row">
    <span>
      <strong>한 번 눌러 내기</strong>
      <span class="muted">끄면 두 번 눌러야 카드를 내요</span>
    </span>
    <input type="checkbox" bind:checked={settings.singleTap} />
  </label>

  <label class="row">
    <span>
      <strong>초보 도움말</strong>
      <span class="muted">내 차례마다 뭘 하면 되는지 알려 줘요</span>
    </span>
    <input type="checkbox" bind:checked={settings.tips} />
  </label>

  <label class="row">
    <span>
      <strong>힌트 버튼</strong>
      <span class="muted">내 차례에 💡를 누르면 봇이라면 뭘 할지 알려 줘요</span>
    </span>
    <input type="checkbox" bind:checked={settings.hints} />
  </label>

  <label class="row">
    <span>
      <strong>진동</strong>
      <span class="muted">내 차례가 되면 짧게 (안드로이드)</span>
    </span>
    <input type="checkbox" bind:checked={settings.haptics} />
  </label>

  <div class="row">
    <span><strong>효과음</strong></span>
    <span class="pair">
      <input type="range" min="0" max="1" step="0.1" bind:value={settings.volume} disabled={!settings.sound} aria-label="효과음 음량" />
      <input type="checkbox" bind:checked={settings.sound} aria-label="효과음 켜기" />
    </span>
  </div>
  <div class="row">
    <span>
      <strong>배경 음악</strong>
      <span class="muted">잔잔한 재즈</span>
    </span>
    <span class="pair">
      <input type="range" min="0" max="1" step="0.1" bind:value={settings.musicVolume} disabled={!settings.music} aria-label="배경 음악 음량" />
      <input type="checkbox" bind:checked={settings.music} aria-label="배경 음악 켜기" />
    </span>
  </div>

  <div class="row looks">
    <span>
      <strong>카드 뒷면</strong>
      <span class="muted">업적으로 더 얻을 수 있어요</span>
    </span>
    <div class="swatches" role="radiogroup" aria-label="카드 뒷면">
      {#each BACKS as id (id)}
        {@const open = isUnlocked({ kind: 'back', id }, unlocked)}
        <button
          class="swatch back-{id}"
          role="radio"
          aria-checked={settings.cardBack === id}
          aria-disabled={!open}
          title={open ? BACK_NAMES[id] : `잠김 · ${howTo('back', id)}`}
          aria-label={open ? BACK_NAMES[id] : `${BACK_NAMES[id]}, 잠김: ${howTo('back', id)}`}
          onclick={() => open && (settings.cardBack = id)}
        ><BackArt {id} />{#if !open}<span class="lock">🔒</span>{/if}</button>
      {/each}
    </div>
  </div>
  <div class="row looks">
    <strong>테이블 색</strong>
    <div class="swatches" role="radiogroup" aria-label="테이블 색">
      {#each TONES as id (id)}
        {@const open = isUnlocked({ kind: 'table', id }, unlocked)}
        <button
          class="swatch table-{id}"
          role="radio"
          aria-checked={settings.tableTone === id}
          aria-disabled={!open}
          title={open ? TABLE_NAMES[id] : `잠김 · ${howTo('table', id)}`}
          aria-label={open ? TABLE_NAMES[id] : `${TABLE_NAMES[id]}, 잠김: ${howTo('table', id)}`}
          onclick={() => open && (settings.tableTone = id)}
        >{#if !open}🔒{/if}</button>
      {/each}
    </div>
  </div>

  <div class="row">
    <strong>애니메이션</strong>
    <div class="chips" role="radiogroup" aria-label="애니메이션">
      {#each SPEEDS as s (s.id)}
        <button class="chip" role="radio" aria-checked={settings.speed === s.id} onclick={() => (settings.speed = s.id)}>
          {s.label}
        </button>
      {/each}
    </div>
  </div>

  <form method="dialog">
    {#if onreport}<button type="button" class="ghost report" onclick={() => (dialog.close(), onreport())}>문제 신고</button>{/if}
    <button class="primary">닫기</button>
  </form>
</dialog>

<style>
  dialog {
    width: min(100% - 32px, 400px);
    padding: 20px;
    border: none;
    border-radius: 16px;
    background: var(--panel);
    color: var(--ink);
  }
  dialog::backdrop {
    background: rgb(23 25 28 / 0.4);
  }
  h2 {
    margin: 0 0 12px;
    font-size: 22px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 52px;
    border-top: 1px solid var(--line);
  }
  .row > span {
    display: grid;
  }
  .row .muted {
    font-size: 13px;
  }
  input[type='checkbox'] {
    width: 22px;
    height: 22px;
    min-height: 0;
    accent-color: var(--accent);
  }
  input[type='range'] {
    min-height: 0;
    padding: 0;
    border: none;
    background: none;
    accent-color: var(--accent);
  }
  .row > .pair {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .pair input[type='range'] {
    width: 110px;
  }
  .preview {
    display: flex;
    gap: 6px;
    padding-bottom: 12px;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
  }
  .swatch {
    width: 30px;
    min-width: 0;
    height: 30px;
    min-height: 0;
    padding: 0;
    border-radius: 8px;
    box-shadow: none;
    border: 2px solid var(--line);
    font-size: 11px;
  }
  .swatch[aria-checked='true'] {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .swatch[aria-disabled='true'] {
    opacity: 0.45;
    cursor: not-allowed;
  }
  /* Back swatches are little cards showing the back itself. */
  .swatch[class*='back-'] {
    position: relative;
    width: 30px;
    height: 42px;
    overflow: hidden;
    border-radius: 5px;
  }
  .lock {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .table-hanji { background: #efebe3; }
  .table-celadon { background: #e2eae2; }
  .table-indigo { background: #e3e7ef; }
  .table-blush { background: #f1e8e4; }
  .chips {
    display: flex;
    gap: 6px;
  }
  form {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
  }
  .report {
    margin-right: auto;
    color: var(--ink-muted);
  }
  form .primary {
    min-width: 120px;
  }
</style>
