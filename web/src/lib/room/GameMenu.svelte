<script lang="ts">
  // The table's one menu, in place of a page header: invite, the rules, the
  // table's own settings, this device's settings, and the way out.
  import { CATALOG } from '../catalog';
  import Icon from '../Icon.svelte';
  import type { GameTypes, RoomViewOf } from './types';
  import Button from '../ui/Button.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Sheet from '../ui/Sheet.svelte';
  import Switch from '../ui/Switch.svelte';

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
    oneditrules: () => void;
    onsettings: () => void;
    onreport: () => void;
    onturn: (secs: number) => void;
    onshuffle: (on: boolean) => void;
    /** Leave the table for the home page. */
    onleave: () => void;
    /** Leaving mid-hand asks first (a bot plays your seat from then on): asking. */
    leaving?: boolean;
  } = $props();

  const inHand = $derived(room.in_hand);
  /** The table's settings change between hands, by whoever sits there. */
  const editable = $derived(seated && !inHand);
  const turnSecs = $derived(room.table.turn_secs);
  const shuffle = $derived(room.table.shuffle);
  const TURNS = CATALOG.turn_limits.map((secs) => ({ value: secs, label: secs === 0 ? '끔' : `${secs}초` }));

  function leave() {
    if (seated && inHand && !leaving) leaving = true;
    else onleave();
  }
</script>

<!-- Opened on the title, not on 초대하기, so no ring is drawn round it. -->
<Sheet size="small" focus="title" {onclose}>
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
  </div>

  <section class="table-set" aria-labelledby="table-set-title">
    <h3 id="table-set-title">테이블 설정</h3>
    {#if editable}
      <div class="set-row">
        <span class="set-label">턴 시간</span>
        <Segmented options={TURNS} value={turnSecs} onchange={onturn} label="턴 시간" />
      </div>
      <p class="note">{turnSecs > 0 ? '시간이 지나면 봇이 대신 둬요.' : '시간 제한 없이 둬요.'}</p>
      <Switch checked={shuffle} onchange={onshuffle}>매 판 자리 섞기</Switch>
      <Button wide onclick={oneditrules}>
        <Icon name="sliders" size="22px" />
        <span class="label">규칙 바꾸기</span>
      </Button>
    {:else}
      <p class="read">
        턴 시간 <strong>{turnSecs === 0 ? '끔' : `${turnSecs}초`}</strong>{#if shuffle}{' · '}매 판 자리 섞기{/if}
      </p>
      <p class="note">{seated ? '판이 끝나면 바꿀 수 있어요.' : '앉은 사람이 판과 판 사이에 바꿀 수 있어요.'}</p>
    {/if}
  </section>

  <div class="items">
    <Button wide onclick={onsettings}>
      <Icon name="sound" size="22px" />
      <span class="label">소리와 화면</span>
      <span class="aside">효과음 · 음악 · 카드</span>
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
      <Button variant="ghost" class="leave" onclick={leave}><Icon name="leave" />나가기</Button>
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
  .items {
    display: grid;
    gap: 8px;
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
  .table-set {
    display: grid;
    gap: 10px;
    margin: 16px 0;
    padding: 12px 14px 14px;
    border-radius: var(--r-control);
    background: var(--table);
  }
  h3 {
    margin: 0;
    font-size: 14px;
    color: var(--ink-muted);
  }
  .set-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 12px;
  }
  .set-label {
    font-size: var(--text-body);
    font-weight: 600;
  }
  .note,
  .read {
    margin: 0;
    font-size: var(--text-label);
    color: var(--ink-muted);
    word-break: keep-all;
  }
  .read {
    font-size: var(--text-body);
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
