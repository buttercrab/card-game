<script lang="ts">
  // Offers to put the game on the home screen. Chrome and Edge hand us an
  // install prompt; iOS Safari has none, so it gets the Share-menu steps.
  // Hidden once installed or dismissed.

  import Icon from './Icon.svelte';
  import Button from './ui/Button.svelte';

  interface InstallPrompt extends Event {
    prompt(): Promise<void>;
  }

  const KEY = 'mighty.installHint';
  const standalone =
    matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

  let dismissed = $state(read());
  let prompt = $state<InstallPrompt | null>(null);

  function read() {
    try {
      return localStorage.getItem(KEY) === 'off';
    } catch {
      return false;
    }
  }

  function dismiss() {
    dismissed = true;
    try {
      localStorage.setItem(KEY, 'off');
    } catch {
      // Private mode: it stays hidden for this visit.
    }
  }

  $effect(() => {
    const save = (e: Event) => {
      e.preventDefault();
      prompt = e as InstallPrompt;
    };
    window.addEventListener('beforeinstallprompt', save);
    return () => window.removeEventListener('beforeinstallprompt', save);
  });

  async function install() {
    await prompt?.prompt();
    prompt = null;
    dismiss();
  }
</script>

{#if !standalone && !dismissed && (prompt || ios)}
  <aside class="hint">
    <img src="/icon-192.png" alt="" width="40" height="40" />
    <p>
      <strong>홈 화면에 추가</strong>
      {#if prompt}
        <span class="muted">앱처럼 전체 화면으로 열려요</span>
      {:else}
        <span class="muted">공유 버튼 → ‘홈 화면에 추가’를 누르면 앱처럼 열려요</span>
      {/if}
    </p>
    {#if prompt}<Button variant="primary" onclick={install}>추가</Button>{/if}
    <button class="btn icon close" onclick={dismiss} aria-label="닫기"><Icon name="close" size="20px" /></button>
  </aside>
{/if}

<style>
  .hint {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 12px 12px 16px;
    border-radius: var(--r-panel);
    background: var(--panel);
    animation: fade-up 300ms var(--ease-standard) both;
  }
  :global(:root[data-motion='reduced']) .hint {
    animation-name: fade;
  }
  img {
    border-radius: 10px;
    flex: none;
  }
  p {
    display: grid;
    flex: 1;
    margin: 0;
    font-size: var(--text-body);
  }
  .muted {
    font-size: var(--text-label);
  }
  /* The close sits in the panel's corner, its target past the edge. */
  .close {
    margin: -8px -4px -8px 0;
    color: var(--ink-muted);
  }
</style>
