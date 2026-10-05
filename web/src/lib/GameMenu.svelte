<script lang="ts">
  // The table's one menu, in place of a page header: invite, the rules, the
  // table's own settings, this device's settings, and the way out.
  import Icon from './Icon.svelte';
  import type { RoomMsg } from './types';

  let {
    room,
    seated,
    rulesName,
    invited,
    onclose,
    oninvite,
    onrules,
    oneditrules,
    onsettings,
    onreport,
    onturn,
    onshuffle,
    onleave,
  }: {
    room: RoomMsg;
    seated: boolean;
    /** The rules' name, with how many this table changed. */
    rulesName: string;
    /** Just shared or copied: the invite row says so. */
    invited: 'shared' | 'copied' | null;
    onclose: () => void;
    oninvite: () => void;
    onrules: () => void;
    oneditrules: () => void;
    onsettings: () => void;
    onreport: () => void;
    onturn: (secs: number) => void;
    onshuffle: (on: boolean) => void;
    /** Leave the table for the home page. */
    onleave: () => void;
  } = $props();

  const TURN_CHOICES = [0, 20, 40, 60];
  const inHand = $derived(room.in_hand);
  /** The table's settings change between hands, by whoever sits there. */
  const editable = $derived(seated && !inHand);
  const turnSecs = $derived(room.table.turn_secs);
  const shuffle = $derived(room.table.shuffle);
  /** Leaving mid-hand asks first: a bot plays your seat from then on. */
  let leaving = $state(false);

  let dialog: HTMLDialogElement;
  let heading: HTMLElement;
  $effect(() => {
    dialog.showModal();
    // Opened on the title, not on 초대하기, so no ring is drawn round it.
    heading.focus();
  });

  function leave() {
    if (seated && inHand && !leaving) leaving = true;
    else onleave();
  }
</script>

<dialog class="sheet menu" bind:this={dialog} onclose={onclose} aria-labelledby="menu-title">
  <div class="sheet-body">
    <h2 id="menu-title" tabindex="-1" bind:this={heading}>
      테이블 <span class="code">{room.id}</span>
      {#if room.watching}<span class="watching">구경 <span class="num">{room.watching}</span>명</span>{/if}
    </h2>

    <div class="items">
      <button class="item" onclick={oninvite}>
        <Icon name="invite" />
        <span class="label">초대하기</span>
        {#if invited}<span class="done" role="status">{invited === 'shared' ? '보냈어요' : '복사했어요'}</span>{/if}
      </button>
      <button class="item" onclick={onrules}>
        <Icon name="book" />
        <span class="label">규칙 보기</span>
        <span class="aside">{rulesName}</span>
      </button>
    </div>

    <section class="table-set" aria-labelledby="table-set-title">
      <h3 id="table-set-title">테이블 설정</h3>
      {#if editable}
        <div class="set-row">
          <span class="set-label">턴 시간</span>
          <span class="seg" role="radiogroup" aria-label="턴 시간">
            {#each TURN_CHOICES as secs (secs)}
              <button role="radio" aria-checked={turnSecs === secs} onclick={() => turnSecs !== secs && onturn(secs)}>
                {secs === 0 ? '끔' : `${secs}초`}
              </button>
            {/each}
          </span>
        </div>
        <p class="note">{turnSecs > 0 ? '시간이 지나면 봇이 대신 둬요.' : '시간 제한 없이 둬요.'}</p>
        <button class="check" role="switch" aria-checked={shuffle} onclick={() => onshuffle(!shuffle)}>
          <span class="box" aria-hidden="true"></span>매 판 자리 섞기
        </button>
        <button class="item" onclick={oneditrules}>
          <Icon name="sliders" />
          <span class="label">규칙 바꾸기</span>
        </button>
      {:else}
        <p class="read">
          턴 시간 <strong>{turnSecs === 0 ? '끔' : `${turnSecs}초`}</strong>{#if shuffle}{' · '}매 판 자리 섞기{/if}
        </p>
        <p class="note">{seated ? '판이 끝나면 바꿀 수 있어요.' : '앉은 사람이 판과 판 사이에 바꿀 수 있어요.'}</p>
      {/if}
    </section>

    <div class="items">
      <button class="item" onclick={onsettings}>
        <Icon name="sound" />
        <span class="label">소리와 화면</span>
        <span class="aside">효과음 · 음악 · 카드</span>
      </button>
      <button class="item" onclick={onreport}>
        <Icon name="flag" />
        <span class="label">문제 신고</span>
      </button>
    </div>
  </div>

  {#if leaving}
    <div class="sheet-foot confirm" role="alertdialog" aria-labelledby="leave-ask">
      <p id="leave-ask">지금 나가면 봇이 대신 둬요.</p>
      <button onclick={() => (leaving = false)}>취소</button>
      <button class="danger" onclick={onleave}>나가기</button>
    </div>
  {:else}
    <form method="dialog" class="sheet-foot">
      <button type="button" class="ghost leave" onclick={leave}><Icon name="leave" />나가기</button>
      <button>닫기</button>
    </form>
  {/if}
</dialog>

<style>
  .menu {
    width: min(100% - 32px, 400px);
  }
  h2:focus {
    outline: none;
  }
  h2 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 12px;
    font-size: 17px;
  }
  .code {
    font-variant-numeric: tabular-nums;
  }
  .watching {
    margin-left: auto;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .items {
    display: grid;
    gap: 8px;
  }
  /* A row per thing to do: a drawn icon, the words, a quiet note at the end. */
  .item {
    justify-content: flex-start;
    gap: 12px;
    width: 100%;
    min-height: 48px;
    padding: 10px 14px;
    text-align: left;
  }
  .item :global(.icon) {
    width: 22px;
    height: 22px;
  }
  .label {
    flex: none;
  }
  .aside,
  .done {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .done {
    color: var(--ink);
  }
  .table-set {
    display: grid;
    gap: 10px;
    margin: 16px 0;
    padding: 12px 14px 14px;
    border-radius: 12px;
    background: var(--table);
  }
  h3 {
    margin: 0;
    font-size: 14px;
    color: var(--ink-muted);
  }
  .set-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .set-label {
    flex: none;
    font-size: 15px;
    font-weight: 600;
  }
  .note,
  .read {
    margin: 0;
    font-size: 13px;
    color: var(--ink-muted);
    word-break: keep-all;
  }
  .read {
    font-size: 15px;
    color: var(--ink);
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    flex: 1;
    gap: 2px;
    padding: 2px;
    border-radius: 999px;
    background: var(--raised);
  }
  .seg button {
    min-height: 40px;
    padding: 2px 0;
    border-radius: 999px;
    background: none;
    box-shadow: none;
    color: var(--ink-muted);
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .seg button[aria-checked='true'] {
    background: var(--ink);
    color: var(--table);
  }
  /* A switch drawn as a box that fills with ink when on. */
  .check {
    justify-content: flex-start;
    gap: 10px;
    padding: 8px 2px;
    background: none;
    box-shadow: none;
    font-size: 15px;
  }
  .check .box {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    box-shadow: inset 0 0 0 2px var(--ink-muted);
  }
  .check[aria-checked='true'] .box {
    background: var(--ink);
    box-shadow:
      inset 0 0 0 2px var(--ink),
      inset 0 0 0 4px var(--table);
  }
  .leave {
    gap: 8px;
  }
  .danger {
    color: var(--danger);
  }
  .confirm {
    flex-wrap: wrap;
  }
  .confirm p {
    flex: 1 1 100%;
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 600;
  }
  .confirm button {
    flex: 1;
  }
</style>
