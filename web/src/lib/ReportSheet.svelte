<script lang="ts">
  // Sends a problem report. The server attaches this table's state and move
  // log, so a bug in the rules can be replayed exactly.
  import { CATALOG } from './catalog';
  import Button from './ui/Button.svelte';
  import Sheet from './ui/Sheet.svelte';
  let { room = null, seat = null, onclose }: { room?: string | null; seat?: number | null; onclose: () => void } = $props();

  let text = $state('');
  let status = $state<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  async function send() {
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

<Sheet title="문제 신고" {onclose}>
  {#if status === 'sent'}
    <p>보냈어요. 고마워요! 확인하고 고칠게요.</p>
  {:else}
    <p class="muted">
      무엇이 이상했는지 적어 주세요.{#if room} 이 테이블의 지금 판 기록이 함께 가요.{/if}
    </p>
    <textarea
      bind:value={text}
      rows="5"
      maxlength={CATALOG.report_max}
      placeholder="예: 조커콜을 했는데 조커가 안 나왔어요"
      aria-label="문제 설명"
    ></textarea>
    {#if status === 'failed'}<p class="error" role="alert">보내지 못했어요. 잠시 뒤에 다시 해 보세요.</p>{/if}
  {/if}
  {#snippet footer(close)}
    {#if status === 'sent'}
      <Button onclick={close}>닫기</Button>
    {:else}
      <Button onclick={close}>취소</Button>
      <Button variant="primary" disabled={!text.trim() || status === 'sending'} onclick={send}>
        {status === 'sending' ? '보내는 중…' : '보내기'}
      </Button>
    {/if}
  {/snippet}
</Sheet>

<style>
  p {
    margin: 0 0 12px;
  }
  textarea {
    display: block;
    width: 100%;
    resize: vertical;
  }
  .error {
    margin: 8px 0 0;
    color: var(--danger);
    font-size: 14px;
  }
</style>
