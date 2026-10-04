<script lang="ts">
  import Card from './Card.svelte';
  import BackArt from './CardBack.svelte';
  import Icon from './Icon.svelte';
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

<dialog class="sheet" bind:this={dialog} onclose={onclose} aria-labelledby="settings-title">
  <div class="sheet-body">
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
        <span class="muted">내 차례에 전구를 누르면 봇이라면 뭘 할지 알려 줘요</span>
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

    <!-- The switch comes first; the slider only works while it is on. -->
    <div class="row">
      <span><strong>효과음</strong></span>
      <span class="pair">
        <input type="checkbox" bind:checked={settings.sound} aria-label="효과음 켜기" />
        <input type="range" min="0" max="1" step="0.1" bind:value={settings.volume} disabled={!settings.sound} aria-label="효과음 음량" />
      </span>
    </div>
    <div class="row">
      <span>
        <strong>배경 음악</strong>
        <span class="muted">잔잔한 재즈</span>
      </span>
      <span class="pair">
        <input type="checkbox" bind:checked={settings.music} aria-label="배경 음악 켜기" />
        <input type="range" min="0" max="1" step="0.1" bind:value={settings.musicVolume} disabled={!settings.music} aria-label="배경 음악 음량" />
      </span>
    </div>

    <div class="row looks">
      <span>
        <strong>카드 뒷면</strong>
        <span class="muted">업적으로 더 얻을 수 있어요</span>
      </span>
      <div class="swatches backs" role="radiogroup" aria-label="카드 뒷면">
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
          ><span class="art"><BackArt {id} /></span>{#if !open}<span class="lock"><Icon name="lock" size="14px" /></span>{/if}</button>
        {/each}
      </div>
    </div>
    <div class="row looks">
      <strong>테이블 색</strong>
      <div class="swatches tones" role="radiogroup" aria-label="테이블 색">
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
          >{#if !open}<span class="lock"><Icon name="lock" size="14px" /></span>{/if}</button>
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
  </div>

  <form method="dialog" class="sheet-foot">
    {#if onreport}<button type="button" class="ghost" onclick={() => (dialog.close(), onreport())}>문제 신고</button>{/if}
    <button>닫기</button>
  </form>
</dialog>

<style>
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
    flex: none;
    width: 22px;
    height: 22px;
    min-height: 0;
  }
  input[type='range'] {
    min-height: 0;
    padding: 0;
    border: none;
    background: none;
  }
  input[type='range']:disabled {
    opacity: 0.4;
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
  .looks {
    padding: 8px 0;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
  }
  /* On a phone the swatches take a line of their own, in an even grid. */
  @media (max-width: 599px) {
    .looks {
      flex-wrap: wrap;
    }
    .looks > span,
    .looks > strong {
      flex: 1 0 100%;
    }
    .swatches {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      justify-items: start;
      width: 100%;
    }
    .swatches .swatch {
      width: 100%;
      max-width: 44px;
    }
    .swatches .swatch[class*='back-'] {
      height: auto;
      aspect-ratio: 30 / 42;
    }
  }
  .swatch {
    position: relative;
    width: 30px;
    min-width: 0;
    height: 30px;
    min-height: 0;
    padding: 0;
    border-radius: 8px;
    box-shadow: none;
    border: 2px solid var(--line);
    color: #1c1915;
    font-size: 11px;
  }
  /* Chosen: an ink ring set off by a gap, so it shows on a pale swatch in
     dark mode too. */
  .swatch[aria-checked='true'] {
    border-color: var(--raised);
    box-shadow: 0 0 0 2px var(--ink);
  }
  /* A locked look stays visible: its art faded, a dashed edge, and a lock
     on a chip of the sheet's own surface. */
  .swatch[aria-disabled='true'] {
    cursor: not-allowed;
    border-style: dashed;
    border-color: var(--ink-muted);
  }
  .swatch[aria-disabled='true'] .art {
    opacity: 0.35;
  }
  .swatch[aria-disabled='true'][class*='table-'] {
    opacity: 0.7;
  }
  .art {
    position: absolute;
    inset: 0;
    display: block;
  }
  .art :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  /* Back swatches are little cards showing the back itself. */
  .swatch[class*='back-'] {
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
    color: var(--ink);
  }
  .swatch[class*='table-'] .lock {
    color: #1c1915;
  }
  .table-hanji { background: #efebe3; }
  .table-celadon { background: #e2eae2; }
  .table-indigo { background: #e3e7ef; }
  .table-blush { background: #f1e8e4; }
  .chips {
    display: flex;
    gap: 6px;
  }
</style>
