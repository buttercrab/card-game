<script lang="ts">
  // The table's one menu, in place of a page header: invite, the rules, the
  // table's own settings, this device's settings, and the way out.
  import Icon from '../Icon.svelte';
  import type { GameTypes, RoomViewOf } from './types';
  import Button from '../ui/Button.svelte';
  import Sheet from '../ui/Sheet.svelte';

  let {
    room,
    seated,
    rulesName,
    invited,
    onclose,
    oninvite,
    onrules,
    onsettings,
    onreport,
    onleave,
    leaving = $bindable(false),
  }: {
    room: RoomViewOf<GameTypes>;
    seated: boolean;
    /** The rules' name, with how many this table changed. */
    rulesName: string;
    /** Just shared or copied: the invite row says so. */
    invited: 'shared' | 'copied' | null;
    onclose: () => void;
    oninvite: () => void;
    onrules: () => void;
    onsettings: () => void;
    onreport: () => void;
    /** Leave the table for the home page. */
    onleave: () => void;
    /** Leaving mid-hand asks first (a bot plays your seat from then on): asking. */
    leaving?: boolean;
  } = $props();

  const inHand = $derived(room.in_hand);

  function leave() {
    if (seated && inHand && !leaving) leaving = true;
    else onleave();
  }
</script>

<!-- Opened on the title, not on 초대하기, so no ring is drawn round it. -->
<Sheet size="small" class="game-menu" focus="title" {onclose}>
  {#snippet head(id)}
    <h2 class="sheet-title" {id} tabindex="-1">
      테이블 <span class="code">{room.id}</span>
      {#if room.watching}<span class="watching">구경 <span class="num">{room.watching}</span>명</span>{/if}
    </h2>
  {/snippet}

  <div class="items">
    <Button wide onclick={oninvite}>
      <Icon name="invite" size="22px" />
      <span class="label">초대하기</span>
      {#if invited}<span class="aside done" role="status">{invited === 'shared' ? '보냈어요' : '복사했어요'}</span>{/if}
    </Button>
    <Button wide onclick={onrules}>
      <Icon name="book" size="22px" />
      <span class="label">규칙 보기</span>
      <span class="aside">{rulesName}</span>
    </Button>
    <Button wide onclick={onsettings}>
      <Icon name="sound" size="22px" />
      <span class="label">설정</span>
      <span class="aside">테이블 · 화면 · 소리</span>
    </Button>
    <Button wide onclick={onreport}>
      <Icon name="flag" size="22px" />
      <span class="label">문제 신고</span>
    </Button>
  </div>

  {#snippet footer(close)}
    {#if leaving}
      <div class="confirm" role="alertdialog" aria-labelledby="leave-ask">
        <p id="leave-ask">지금 나가면 봇이 대신 둬요.</p>
        <button class="btn" onclick={() => (leaving = false)}>취소</button>
        <button class="btn danger" onclick={onleave}>나가기</button>
      </div>
    {:else}
      <Button variant="ghost" class="leave" onclick={leave}><Icon name="leave" size="22px" /><span class="label">나가기</span></Button>
      <Button onclick={close}>닫기</Button>
    {/if}
  {/snippet}
</Sheet>

<style>
  h2 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: var(--text-title);
  }
  .code {
    font-variant-numeric: tabular-nums;
  }
  .watching {
    margin-left: auto;
    font-size: var(--text-label);
    font-weight: 600;
    color: var(--ink-muted);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  :global(.game-menu .sheet-foot .leave) {
    margin-inline-start: 0;
    padding-inline: 14px;
    gap: 12px;
  }
  .items {
    display: grid;
    gap: 12px;
  }
  /* A row per thing to do: a drawn icon, the words, a quiet note at the end. */
  .label {
    flex: none;
  }
  .aside {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    font-size: var(--text-label);
    font-weight: 600;
    color: var(--ink-muted);
  }
  .done {
    color: var(--ink);
  }
  /* Asking before leaving mid-hand: the question over its two answers. */
  .confirm {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: 8px;
  }
  .confirm p {
    flex: 1 1 100%;
    margin: 0 0 4px;
    font-size: var(--text-body);
    font-weight: 600;
  }
  .confirm .btn {
    flex: 1;
  }
</style>
