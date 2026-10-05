<script lang="ts">
  import Card from './Card.svelte';
  import BackArt from './CardBack.svelte';
  import Icon from './Icon.svelte';
  import SuitText from './SuitText.svelte';
  import { ACHIEVEMENTS, BACK_NAMES, TABLE_NAMES, isUnlocked, loadUnlocked, type CardBack, type TableTone } from './achievements';
  import { settings, type Speed } from './settings.svelte';
  import { TABLE_TONE } from './tokens';
  import Button from './ui/Button.svelte';
  import Segmented from './ui/Segmented.svelte';
  import Sheet from './ui/Sheet.svelte';
  import Switch from './ui/Switch.svelte';

  const unlocked = loadUnlocked();
  const BACKS = Object.keys(BACK_NAMES) as CardBack[];
  const TONES = Object.keys(TABLE_NAMES) as TableTone[];
  /** What earns a look, for a locked one. */
  const howTo = (kind: 'back' | 'table', id: string) =>
    ACHIEVEMENTS.find((a) => a.reward?.kind === kind && a.reward.id === id)?.how ?? '';

  let { onclose, onreport }: { onclose: () => void; onreport?: () => void } = $props();

  const SPEEDS: { value: Speed; label: string }[] = [
    { value: 'normal', label: '보통' },
    { value: 'fast', label: '빠르게' },
    { value: 'off', label: '끄기' },
  ];
</script>

{#snippet toggle(title: string, note: string | null, get: () => boolean, set: (on: boolean) => void)}
  <Switch checked={get()} onchange={set}>
    <strong>{title}</strong>
    {#if note}<span class="muted"><SuitText text={note} /></span>{/if}
  </Switch>
{/snippet}

<Sheet title="설정" {onclose}>
  <div class="row">
    {@render toggle('4색 덱', '♦ 주황, ♣ 파랑', () => settings.fourColor, (on) => (settings.fourColor = on))}
  </div>
  <div class="preview" aria-hidden="true">
    <Card card={{ Normal: ['Spade', 14] }} size="mini" />
    <Card card={{ Normal: ['Heart', 14] }} size="mini" />
    <Card card={{ Normal: ['Diamond', 14] }} size="mini" />
    <Card card={{ Normal: ['Club', 14] }} size="mini" />
  </div>
  <div class="row">
    {@render toggle('한 번 눌러 내기', '끄면 두 번 눌러야 카드를 내요', () => settings.singleTap, (on) => (settings.singleTap = on))}
  </div>
  <div class="row">
    {@render toggle('초보 도움말', '내 차례마다 뭘 하면 되는지 알려 줘요', () => settings.tips, (on) => (settings.tips = on))}
  </div>
  <div class="row">
    {@render toggle('힌트 버튼', '내 차례에 전구를 누르면 봇이라면 뭘 할지 알려 줘요', () => settings.hints, (on) => (settings.hints = on))}
  </div>
  <div class="row">
    {@render toggle('진동', '내 차례가 되면 짧게 (안드로이드)', () => settings.haptics, (on) => (settings.haptics = on))}
  </div>

  <!-- The switch comes first; the slider only works while it is on. -->
  <div class="row">
    {@render toggle('효과음', null, () => settings.sound, (on) => (settings.sound = on))}
  </div>
  <input class="volume" type="range" min="0" max="1" step="0.1" bind:value={settings.volume} disabled={!settings.sound} aria-label="효과음 음량" />
  <div class="row">
    {@render toggle('배경 음악', '잔잔한 재즈', () => settings.music, (on) => (settings.music = on))}
  </div>
  <input class="volume" type="range" min="0" max="1" step="0.1" bind:value={settings.musicVolume} disabled={!settings.music} aria-label="배경 음악 음량" />

  <div class="row looks">
    <span class="text">
      <strong>카드 뒷면</strong>
      <span class="muted">업적으로 더 얻을 수 있어요</span>
    </span>
    <div class="swatches backs" role="radiogroup" aria-label="카드 뒷면">
      {#each BACKS as id (id)}
        {@const open = isUnlocked({ kind: 'back', id }, unlocked)}
        <button
          class="swatch back"
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
    <strong class="text">테이블 색</strong>
    <div class="swatches tones" role="radiogroup" aria-label="테이블 색">
      {#each TONES as id (id)}
        {@const open = isUnlocked({ kind: 'table', id }, unlocked)}
        <button
          class="swatch tone"
          style:background={TABLE_TONE[id].table.light}
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
    <strong class="text">애니메이션</strong>
    <Segmented options={SPEEDS} value={settings.speed} onchange={(s) => (settings.speed = s)} label="애니메이션" />
  </div>

  {#snippet footer(close)}
    {#if onreport}<Button variant="ghost" onclick={() => (close(), onreport())}>문제 신고</Button>{/if}
    <Button onclick={close}>닫기</Button>
  {/snippet}
</Sheet>

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 52px;
    border-top: 1px solid var(--line);
  }
  /* A switch's words: the name over a quiet note. */
  .row strong {
    display: block;
  }
  .row .muted {
    display: block;
    font-size: var(--text-label);
  }
  .text {
    display: grid;
    min-width: 0;
  }
  /* A volume slider under its switch, while that is on. */
  .volume {
    display: block;
    width: 100%;
    min-height: 0;
    margin: 0 0 12px;
    padding: 0;
    border: none;
    background: none;
  }
  .volume:disabled {
    opacity: 0.4;
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
    .looks > .text {
      flex: 1 0 100%;
    }
    .swatches {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      justify-items: start;
      width: 100%;
    }
    .swatch {
      width: 100%;
      max-width: 44px;
    }
    .swatch.back {
      height: auto;
      aspect-ratio: 30 / 42;
    }
  }
  .swatch {
    position: relative;
    width: 30px;
    height: 30px;
    border-radius: var(--r-card);
    border: 2px solid var(--line);
    color: var(--card-ink);
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
  .swatch.tone[aria-disabled='true'] {
    opacity: 0.7;
  }
  .art {
    position: absolute;
    inset: 0;
    display: block;
  }
  /* Back swatches are little cards showing the back itself. */
  .swatch.back {
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
  .tone .lock {
    color: var(--card-ink);
  }
</style>
