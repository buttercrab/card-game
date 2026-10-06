<script lang="ts">
  // Between hands the middle of the table holds what comes next: 시작 (or
  // 다음 판) once every seat is filled, 섞기 and 설정; for a watcher, how to
  // sit down; while swapping, which seat to pick.
  import Icon from '../Icon.svelte';
  import type { RoomView } from '../games/mighty/types';
  import Button from '../ui/Button.svelte';

  let {
    room,
    seated,
    swapping,
    sitName,
    shuffleNote,
    onstart,
    onshuffle,
    onmenu,
    oncancelswap,
  }: {
    room: RoomView;
    seated: boolean;
    /** Picking the seat to swap with. */
    swapping: boolean;
    /** The name a watcher sits down with, if known. */
    sitName: string;
    /** What everyone is told about the next shuffle. */
    shuffleNote: string | null;
    onstart: () => void;
    onshuffle: (on: boolean) => void;
    onmenu?: () => void;
    oncancelswap: () => void;
  } = $props();

  const emptySeats = $derived(room.seats.filter((s) => s.kind === 'empty').length);
  const full = $derived(emptySeats === 0);
  const bots = $derived(room.seats.some((s) => s.kind === 'bot'));
  const shuffleNext = $derived(room.table.shuffle_next);
</script>

<div class="centre">
  {#if swapping}
    <p class="note">바꿀 자리를 누르세요</p>
    <Button onclick={oncancelswap}>취소</Button>
  {:else if seated}
    {#if full}
      <button class="btn primary go" onclick={onstart}>{room.hands_played === 0 ? '시작' : '다음 판'}</button>
    {:else}
      <p class="note">빈 자리 <strong>{emptySeats}</strong>개 · 봇이나 친구로 채우면 시작해요</p>
    {/if}
    {#if shuffleNote}<p class="sub shuffle-note" role="status">{shuffleNote}</p>{/if}
    <div class="tools">
      {#if room.table.shuffle}
        <!-- 매 판 자리 섞기 is on: 섞기 is already as on as it gets; the
             setting itself is under 설정. -->
        <button class="btn tool on" aria-pressed="true" aria-label="섞기: 매 판 자리 섞기 켜짐 (설정에서 바꿔요)" onclick={onmenu}>
          <Icon name="shuffle" size="22px" /><span>섞기</span>
        </button>
      {:else}
        <button
          class="btn tool"
          class:on={shuffleNext}
          aria-pressed={shuffleNext}
          aria-label={shuffleNext ? '섞기 취소: 자리 그대로 시작해요' : '섞기: 다음 판 시작할 때 자리를 섞어요'}
          onclick={() => onshuffle(!shuffleNext)}
        >
          <Icon name="shuffle" size="22px" /><span>섞기</span>
        </button>
      {/if}
      <button class="btn tool" onclick={onmenu}><Icon name="sliders" size="22px" /><span>설정</span></button>
    </div>
  {:else}
    <p class="note">
      {#if emptySeats > 0}빈 자리를 눌러 앉으세요
      {:else if bots}봇 자리를 눌러 대신 앉을 수 있어요
      {:else}자리가 다 찼어요 · 구경하는 중{/if}
    </p>
    {#if sitName.trim() && (emptySeats > 0 || bots)}
      <p class="sub"><strong class="who">{sitName.trim()}</strong> 이름으로 앉아요</p>
    {/if}
    {#if shuffleNote}<p class="sub shuffle-note" role="status">{shuffleNote}</p>{/if}
  {/if}
</div>

<style>
  .centre {
    position: absolute;
    left: 50%;
    top: var(--cy);
    transform: translate(-50%, -50%);
    z-index: 4;
    display: grid;
    justify-items: center;
    gap: 10px;
    width: max-content;
    max-width: max(150px, calc(100cqw - 2 * var(--seat-w) - 8px));
    text-align: center;
    animation: fade-up 240ms var(--ease-standard) both;
  }
  :global(:root[data-motion='reduced']) .centre {
    animation-name: fade;
  }
  .go {
    min-width: 136px;
    min-height: 52px;
    font-size: 18px;
  }
  .note,
  .sub {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--ink-muted);
    text-wrap: balance;
  }
  .sub {
    font-size: var(--text-label);
    font-weight: 400;
  }
  .note strong,
  .sub strong {
    color: var(--ink);
  }
  /* A long name gives way, never the words after it. */
  .who {
    display: inline-block;
    max-width: 7em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }
  .tools {
    display: flex;
    justify-content: center;
    gap: 8px;
  }
  /* Small drawn tools: an icon over a word, on card paper with its lip. */
  .tool {
    flex-direction: column;
    gap: 2px;
    min-width: 56px;
    min-height: 56px;
    padding: 6px 8px 5px;
    font-size: var(--text-caption);
  }
  /* 섞기 is on: the tool is pressed into the table, in ink, until the
     next hand uses it (or it is pressed again). */
  .tool.on {
    background: var(--ink);
    color: var(--table);
    box-shadow: 0 1px 0 var(--btn-lip);
    translate: 0 2px;
  }
  /* Hung under the middle's buttons, so it takes no height from them: the
     middle stays clear of the top seats on a short phone. */
  .shuffle-note {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    width: max-content;
    max-width: min(220px, calc(100cqw - 2 * var(--seat-w) - 8px));
    transform: translateX(-50%);
    color: var(--ink);
    font-weight: 600;
  }
</style>
