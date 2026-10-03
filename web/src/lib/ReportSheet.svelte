<script lang="ts">
  // Sends a problem report. The server attaches this table's state and move
  // log, so a bug in the rules can be replayed exactly.
  let { room = null, seat = null, onclose }: { room?: string | null; seat?: number | null; onclose: () => void } = $props();

  let text = $state('');
  let status = $state<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });

  async function send(event: SubmitEvent) {
    event.preventDefault();
    status = 'sending';
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          room,
          seat,
          client: {
            ua: navigator.userAgent,
            screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
            path: location.pathname,
            standalone: matchMedia('(display-mode: standalone)').matches,
          },
        }),
      });
      status = res.ok ? 'sent' : 'failed';
    } catch {
      status = 'failed';
    }
  }
</script>

<dialog bind:this={dialog} onclose={onclose} aria-labelledby="report-title">
  <h2 id="report-title">문제 신고</h2>
  {#if status === 'sent'}
    <p>보냈어요. 고마워요! 확인하고 고칠게요.</p>
    <form method="dialog"><button class="primary">닫기</button></form>
  {:else}
    <p class="muted">
      무엇이 이상했는지 적어 주세요.{#if room} 이 테이블의 지금 판 기록이 함께 가요.{/if}
    </p>
    <form onsubmit={send}>
      <textarea
        bind:value={text}
        rows="5"
        maxlength="2000"
        placeholder="예: 조커 콜을 했는데 조커가 안 나왔어요"
        aria-label="문제 설명"
      ></textarea>
      {#if status === 'failed'}<p class="error" role="alert">보내지 못했어요. 잠시 뒤에 다시 해 보세요.</p>{/if}
      <div class="actions">
        <button type="button" onclick={() => dialog.close()}>취소</button>
        <button class="primary" type="submit" disabled={!text.trim() || status === 'sending'}>
          {status === 'sending' ? '보내는 중…' : '보내기'}
        </button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  dialog {
    width: min(100% - 32px, 440px);
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
    margin: 0 0 8px;
    font-size: 22px;
  }
  p {
    margin: 0 0 12px;
  }
  textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--card);
    color: var(--ink);
    font: inherit;
    resize: vertical;
  }
  .error {
    margin: 8px 0 0;
    color: var(--danger);
    font-size: 14px;
  }
  .actions,
  form[method='dialog'] {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
