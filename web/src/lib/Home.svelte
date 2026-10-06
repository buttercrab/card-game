<script lang="ts">
  import Card from './games/mighty/Card.svelte';
  import InstallHint from './InstallHint.svelte';
  import ReportSheet from './ReportSheet.svelte';
  import SettingsSheet from './SettingsSheet.svelte';
  import SiteLinks from './SiteLinks.svelte';
  import StatsSheet from './games/mighty/StatsSheet.svelte';
  import Tutorial from './games/mighty/Tutorial.svelte';
  import { settings } from './settings.svelte';
  import CompareSheet from './games/mighty/CompareSheet.svelte';
  import PresetPicker from './games/mighty/PresetPicker.svelte';
  import RuleEditor from './games/mighty/RuleEditor.svelte';
  import RulebookSheet from './games/mighty/RulebookSheet.svelte';
  import { CATALOG, isPreset, presetTitle } from './catalog';
  import { customName, loadCustom, type CustomSet } from './games/mighty/rulesets';
  import { responseError } from './errorText';
  import Button from './ui/Button.svelte';

  let { onopen }: { onopen: (id: string) => void } = $props();

  /** The preset last used here, if it still exists, or the default one. */
  function remembered(saved: CustomSet[]): string {
    let id: string = CATALOG.default_preset;
    try {
      id = localStorage.getItem('mighty.preset') ?? id;
    } catch {
      // Private mode: start from the default.
    }
    const known = id.startsWith('custom:') ? saved.some((c) => `custom:${c.id}` === id) : isPreset(id);
    return known ? id : CATALOG.default_preset;
  }
  const saved = loadCustom();
  let customs = $state(saved);
  /** A preset id, or `custom:<id>` for rules saved on this device. */
  let choice = $state(remembered(saved));
  const chosen = $derived(choice.startsWith('custom:') ? (customs.find((c) => `custom:${c.id}` === choice) ?? null) : null);
  const preset = $derived(chosen?.base ?? choice);
  const chosenName = $derived(chosen ? customName(chosen) : presetTitle(preset));
  let comparing = $state(false);
  let editing = $state(false);
  let code = $state('');
  let busy = $state(false);
  let showRules = $state(false);
  let reporting = $state(false);
  let showStats = $state(false);
  let learning = $state(false);
  let showSettings = $state(false);
  let error = $state<string | null>(null);

  // Other pages link here with #learn (the guide) or #report (문제 신고).
  if (location.hash === '#learn' || location.hash === '#report') {
    if (location.hash === '#learn') learning = true;
    else reporting = true;
    history.replaceState(null, '', '/');
  }

  /** With `practice`, the room seats you with easy bots and starts at once. */
  async function create(practice = false) {
    busy = true;
    error = null;
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Rules of its own start with the table, checked by the server.
        body: JSON.stringify({ preset: practice ? 'default' : preset, rules: practice ? undefined : chosen?.rules }),
      });
      if (!res.ok) {
        error = await responseError(res);
        return;
      }
      const id: string = (await res.json()).id;
      if (!practice) {
        try {
          localStorage.setItem('mighty.preset', choice);
        } catch {
          // Next time starts from 기본 again.
        }
      }
      if (practice) {
        settings.tips = true;
        settings.hints = true;
        try {
          sessionStorage.setItem('mighty.practice', id);
        } catch {
          // Without storage the practice table just opens as a normal one.
        }
      }
      onopen(id);
    } catch {
      error = '테이블을 만들지 못했어요. 잠시 뒤에 다시 해 보세요.';
    } finally {
      busy = false;
    }
  }

  function join(event: SubmitEvent) {
    event.preventDefault();
    const id = code.trim().toLowerCase().split('/').pop();
    if (id) onopen(id);
  }
</script>

<main>
  <header>
    <div class="mark" aria-hidden="true">
      <!-- Wide enough (80px and up) that the jester and the 마이티's emblem show. -->
      <Card card={{ Joker: 'Black' }} width={84} seal="joker" />
      <Card card={{ Normal: ['Spade', 14] }} width={104} seal="mighty" />
      <Card width={84} />
    </div>
    <h1>마이티</h1>
    <p class="muted">우리 규칙으로 하는 마이티. 테이블을 만들고 링크를 보내세요. 빈 자리는 봇이 채워요.</p>
  </header>

  <section class="panel">
    <div class="panel-head">
      <h2>새 테이블</h2>
      <span class="muted head-note">어떤 규칙으로 할까요?</span>
    </div>
    <PresetPicker selected={choice} {customs} onselect={(c) => (choice = c)} />
    <div class="rule-tools">
      <button class="btn ghost sm" onclick={() => (showRules = true)}>규칙 보기</button>
      <button class="btn ghost sm" onclick={() => (comparing = true)}>비교</button>
      <button class="btn ghost sm" onclick={() => (editing = true)}>고쳐서 쓰기</button>
    </div>
    <Button variant="primary" onclick={() => create()} disabled={busy}>{busy ? '만드는 중…' : '테이블 만들기'}</Button>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>

  <button class="learn" onclick={() => (learning = true)}>
    <strong>마이티가 처음이에요</strong>
    <span class="muted">1분 설명 보고 봇이랑 연습하기 →</span>
  </button>

  <section class="panel">
    <h2>테이블 들어가기</h2>
    <form onsubmit={join}>
      <input bind:value={code} placeholder="테이블 코드나 링크" aria-label="테이블 코드나 링크" />
      <Button type="submit" disabled={!code.trim()}>들어가기</Button>
    </form>
  </section>

  <InstallHint />
  <footer>
    <div class="tools">
      <button class="btn ghost sm" onclick={() => (showStats = true)}>내 기록</button>
      <button class="btn ghost sm" onclick={() => (showSettings = true)}>설정</button>
      <button class="btn ghost sm" onclick={() => (reporting = true)}>문제 신고</button>
    </div>
    <SiteLinks />
  </footer>
</main>
{#if learning}
  <Tutorial onpractice={() => create(true)} onclose={() => (learning = false)} />
{/if}
{#if showStats}
  <StatsSheet onclose={() => (showStats = false)} />
{/if}
{#if showSettings}
  <SettingsSheet onclose={() => (showSettings = false)} />
{/if}
{#if reporting}
  <ReportSheet onclose={() => (reporting = false)} />
{/if}

{#if showRules}
  <RulebookSheet {preset} rules={chosen?.rules ?? null} title={chosen ? chosenName : undefined} onclose={() => (showRules = false)} />
{/if}
{#if comparing}
  <CompareSheet
    name={chosenName}
    rules={chosen?.rules ?? null}
    {preset}
    against={chosen ? chosen.base : preset === 'default' ? 'gshs' : 'default'}
    {customs}
    onclose={() => (comparing = false)}
  />
{/if}
{#if editing}
  <RuleEditor
    {preset}
    rules={chosen?.rules ?? null}
    name={chosen?.name ?? ''}
    applyLabel="이 규칙으로"
    note="테이블을 만들면 이 규칙으로 시작해요."
    onsave={(base, _rules, saved) => {
      customs = loadCustom();
      choice = saved ? `custom:${saved.id}` : base;
    }}
    onclose={() => (editing = false)}
  />
{/if}

<style>
  main {
    max-width: 460px;
    margin: 0 auto;
    padding: 40px 16px;
    display: grid;
    /* One column that never grows past the screen, even on a 320px phone. */
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  header {
    text-align: center;
  }
  .mark {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    margin-bottom: 16px;
  }
  .mark > :global(.card:first-child) {
    transform: rotate(-10deg) translate(18px, 6px);
  }
  .mark > :global(.card:last-child) {
    transform: rotate(10deg) translate(-18px, 6px);
  }
  .mark > :global(.card:nth-child(2)) {
    z-index: 1;
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 36px;
    font-weight: 800;
  }
  header p {
    margin: 8px auto 0;
    max-width: 30em;
    text-wrap: balance;
    word-break: keep-all;
  }
  .panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    padding: 20px;
    border-radius: var(--r-panel);
    background: var(--panel);
  }
  .sm {
    color: var(--ink-muted);
  }
  /* A quiet panel, not a cream slab: the page's one bright button is the
     plum one above. */
  .learn {
    display: grid;
    gap: 2px;
    justify-items: start;
    justify-content: start;
    padding: 14px 20px;
    border-radius: var(--r-panel);
    background: var(--panel);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--line);
    font-size: var(--text-body);
    line-height: 1.35;
    text-align: left;
  }
  @media (hover: hover) {
    .learn:hover {
      box-shadow: inset 0 0 0 1px var(--ink-muted);
    }
  }
  .learn .muted {
    font-size: 14px;
    font-weight: 500;
  }
  /* The table tools, then the site's own pages in a quieter line. */
  footer {
    display: grid;
    gap: 4px;
  }
  .tools {
    display: flex;
    justify-content: center;
    gap: 8px;
  }
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: var(--text-title);
  }
  .head-note {
    font-size: var(--text-label);
  }
  /* Quiet tools under the list; the panel's one loud button is below. */
  .rule-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0 4px;
    margin: -4px 0 0 -10px;
  }
  form {
    display: flex;
    gap: 8px;
  }
  form input {
    flex: 1;
    min-width: 0;
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-size: 14px;
  }
</style>
