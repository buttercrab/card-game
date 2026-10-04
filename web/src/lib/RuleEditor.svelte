<script lang="ts">
  // 우리 규칙 만들기: start from a preset (or a set saved on this device),
  // change rules grouped by phase, see what differs from the start, and
  // save. Every row comes from RULE_FIELDS in ruleFields.ts. The server
  // checks the result too; problems() mirrors its checks so a set it would
  // refuse cannot be applied.
  import { untrack } from 'svelte';
  import { cardLabel } from './cards';
  import PresetPicker from './PresetPicker.svelte';
  import { PRESET_NAME } from './presets';
  import { GROUPS, RULE_FIELDS, differences, getPath, problems, same, say, setField, shown, traits, type Field } from './ruleFields';
  import { customName, loadCustom, presetRules, saveCustom, type CustomSet } from './rulesets';
  import type { Card, Rules } from './types';

  let {
    preset,
    rules = null,
    name: givenName = '',
    applyLabel = '적용',
    note = '다음 판부터 적용돼요.',
    onsave,
    onclose,
  }: {
    /** The preset to start from. */
    preset: string;
    /** Changed rules to start from, or null for the preset as it is. */
    rules?: Rules | null;
    name?: string;
    applyLabel?: string;
    note?: string;
    /** `rules` is null when nothing differs from `base`; `saved` is the set
     * kept on this device for it. */
    onsave: (base: string, rules: Rules | null, saved: CustomSet | null) => void;
    onclose: () => void;
  } = $props();

  const customs = loadCustom();
  let baseId = $state(untrack(() => preset));
  let from = $state<string>(untrack(() => customs.find((c) => c.base === preset && same(c.rules, rules))?.id ?? ''));
  let name = $state(untrack(() => givenName || customs.find((c) => c.id === from)?.name || ''));
  let base = $state<Rules | null>(null);
  let defaults = $state<Rules | null>(null);
  let draft = $state<Rules | null>(null);
  let picking = $state(false);


  /** Loads `id`'s rules as the base; the draft becomes `start` or the preset. */
  function startFrom(id: string, start: Rules | null) {
    baseId = id;
    base = null;
    presetRules(id)
      .then((r) => {
        if (baseId !== id) return;
        base = r;
        draft = structuredClone(start ?? r);
      })
      .catch((e) => console.error('rule editor', e));
  }
  startFrom(
    untrack(() => preset),
    untrack(() => $state.snapshot(rules) as Rules | null),
  );
  presetRules('default')
    .then((r) => (defaults = r))
    .catch(() => {});

  const changed = $derived(base && draft ? differences(draft, base) : []);
  const changedPaths = $derived(new Set(changed.map((f) => f.path)));
  const issues = $derived(draft ? problems(draft) : []);
  const issueAt = (path: string) => issues.filter((p) => p.paths.includes(path));
  const loose = $derived(
    draft ? issues.filter((p) => !p.paths.some((path) => RULE_FIELDS.some((f) => f.path === path && shown(f, draft!)))) : [],
  );
  const startName = $derived(
    from ? customName(customs.find((c) => c.id === from)!) : (PRESET_NAME[baseId] ?? baseId),
  );
  const baseName = $derived(PRESET_NAME[baseId] ?? baseId);
  const startTraits = $derived(base && defaults ? traits(base, defaults) : []);

  function choose(choice: string) {
    picking = false;
    if (choice.startsWith('custom:')) {
      const c = customs.find((s) => `custom:${s.id}` === choice);
      if (!c) return;
      from = c.id;
      name = c.name;
      startFrom(c.base, structuredClone(c.rules));
    } else {
      from = '';
      name = '';
      startFrom(choice, null);
    }
  }

  function set(field: Field, value: unknown) {
    if (draft) setField(draft, field, value);
  }

  function reset(field: Field) {
    if (draft && base) set(field, getPath(base, field.path));
  }

  function resetAll() {
    if (base) draft = structuredClone($state.snapshot(base) as Rules);
  }

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });

  function save() {
    if (!draft || issues.length) return;
    const out = changed.length ? ($state.snapshot(draft) as Rules) : null;
    const saved = out ? saveCustom({ id: from || undefined, name, base: baseId, rules: out }) : null;
    onsave(baseId, out, saved);
    dialog.close();
  }

  function jump(path: string) {
    dialog.querySelector(`[data-path="${path}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  const INLINE = new Set(['toggle', 'stepper', 'maybe']);
</script>

{#snippet stepper(value: number, min: number, max: number, onset: (v: number) => void, label: string, signed = false)}
  <span class="stepper" role="group" aria-label={label}>
    <button type="button" onclick={() => onset(value - 1)} disabled={value <= min} aria-label="{label} 줄이기">−</button>
    <output>{signed && value > 0 ? `+${value}` : value < 0 ? `−${-value}` : value}</output>
    <button type="button" onclick={() => onset(value + 1)} disabled={value >= max} aria-label="{label} 늘리기">+</button>
  </span>
{/snippet}

{#snippet segment(options: { value: unknown; label: string }[], value: unknown, onset: (v: unknown) => void, label: string, stack = false)}
  <span class="segment" class:stack role="radiogroup" aria-label={label}>
    {#each options as o (o.label)}
      <button type="button" role="radio" aria-checked={same(o.value, value)} onclick={() => onset(o.value)}>{o.label}</button>
    {/each}
  </span>
{/snippet}

{#snippet control(f: Field, r: Rules)}
  {@const v = getPath(r, f.path)}
  {@const c = f.control}
  {#if c.kind === 'toggle'}
    <button type="button" class="switch" role="switch" aria-checked={!!v} aria-label={f.label} onclick={() => set(f, !v)}>
      <span class="word">{v ? c.on : c.off}</span><span class="track" aria-hidden="true"><span class="knob"></span></span>
    </button>
  {:else if c.kind === 'stepper'}
    {@render stepper(v, c.min, c.max, (x) => set(f, x), f.label, c.signed)}
  {:else if c.kind === 'segment'}
    {@render segment(c.options, v, (x) => set(f, x), f.label, c.stack)}
  {:else if c.kind === 'maybe'}
    <!-- The switch; its number's stepper goes under the label (see below). -->
    <button type="button" class="switch" role="switch" aria-checked={v !== null} aria-label={f.label} onclick={() => set(f, v === null ? c.start : null)}>
      <span class="word">{v === null ? c.off : c.on(v)}</span><span class="track" aria-hidden="true"><span class="knob"></span></span>
    </button>
  {:else if c.kind === 'rounds'}
    <div class="rounds">
      {#each [['first', '첫 라운드'], ['last', '마지막 라운드']] as [which, word] (which)}
        <span class="round-label">{word}</span>
        {@render segment(c.options, v[which], (x) => set(f, { ...v, [which]: x }), `${f.label} ${word}`)}
      {/each}
    </div>
  {:else if c.kind === 'flags'}
    <div class="ways">
      {#each c.options as o (o.key)}
        <button type="button" class="way" aria-pressed={!!v[o.key]} onclick={() => set(f, { ...v, [o.key]: !v[o.key] })}>
          <svg class="check" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5 L5 9 L9.5 3.5" /></svg>{o.label}
        </button>
      {/each}
    </div>
  {:else if c.kind === 'cardValues'}
    {@const list = v as [Card, number][]}
    <div class="ways">
      {#each c.cards as card (cardLabel(card))}
        {@const i = list.findIndex(([x]) => same(x, card))}
        <button
          type="button"
          class="way"
          aria-pressed={i >= 0}
          onclick={() => set(f, i >= 0 ? list.filter((_, j) => j !== i) : [...list, [card, 0]])}
        >
          <svg class="check" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5 L5 9 L9.5 3.5" /></svg>{cardLabel(card)}
        </button>
      {/each}
    </div>
    {#if list.length}
      <div class="cardvalues">
        {#each list as [card, value], i (cardLabel(card))}
          <div class="cv">
            <span>{cardLabel(card)} 한 장의 값</span>
            {@render stepper(
              value,
              c.min,
              c.max,
              (x) => set(f, list.map((e, j) => (j === i ? [e[0], x] : e))),
              `${cardLabel(card)} 값`,
              true,
            )}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
{/snippet}

<dialog class="sheet editor" bind:this={dialog} onclose={onclose} aria-labelledby="editor-title">
  <div class="sheet-body">
    <h2 id="editor-title">우리 규칙 만들기</h2>
    <p class="lead muted">아는 규칙에서 시작해 다른 것만 바꾸세요. {note}</p>

    <div class="start">
      <div class="start-line">
        <span class="start-text">
          <span class="muted">시작</span>
          <strong>{startName}</strong>
          {#if from}<span class="muted small-note">{baseName} 바탕</span>{/if}
        </span>
        <button type="button" class="ghost small" aria-expanded={picking} onclick={() => (picking = !picking)}>
          {picking ? '접기' : '다른 규칙에서 시작'}
        </button>
      </div>
      {#if picking}
        <PresetPicker selected={from ? `custom:${from}` : baseId} {customs} onselect={choose} label="시작할 규칙" />
      {:else if startTraits.length && !from}
        <p class="start-traits">{startTraits.join(' · ')}</p>
      {/if}
    </div>

    <div class="summary" class:has={changed.length} aria-live="polite">
      <p>
        {#if !base}
          불러오는 중…
        {:else if changed.length}
          {baseName}에서 바뀐 것 <strong class="num">{changed.length}</strong>개
        {:else}
          {baseName} 그대로예요
        {/if}
      </p>
      {#if changed.length}
        <div class="changed-list">
          {#each changed as f (f.path)}
            <button type="button" class="tag" onclick={() => jump(f.path)}>{f.label}</button>
          {/each}
        </div>
      {/if}
      {#each loose as p (p.message)}
        <p class="problem" role="alert">{p.message}</p>
      {/each}
    </div>

    {#if draft && base}
      {@const d = draft}
      {@const b = base}
      {#each GROUPS as g (g.id)}
        {@const fields = RULE_FIELDS.filter((f) => f.group === g.id && shown(f, d))}
        {#if fields.length || g.note}
          <section class="group" aria-labelledby="group-{g.id}">
            <h3 id="group-{g.id}">{g.label}</h3>
            {#if !fields.length}<p class="group-note muted">{g.note}</p>{/if}
            {#each fields as f (f.path)}
              {@const isChanged = changedPaths.has(f.path)}
              {@const bad = issueAt(f.path)}
              <div class="field" class:changed={isChanged} class:bad={bad.length > 0} data-path={f.path}>
                <div class="top">
                  <div class="text">
                    <span class="label">{f.label}</span>
                    <span class="help">{f.help}</span>
                  </div>
                  {#if INLINE.has(f.control.kind)}{@render control(f, d)}{/if}
                </div>
                {#if !INLINE.has(f.control.kind)}{@render control(f, d)}{/if}
                {#if f.control.kind === 'maybe' && getPath(d, f.path) !== null}
                  {@const c = f.control}
                  <div class="maybe">
                    {@render stepper(getPath(d, f.path), c.min, c.max, (x) => set(f, x), f.label)}
                  </div>
                {/if}
                {#if isChanged}
                  <div class="was">
                    <span>{baseName}: {say(f, b)}</span>
                    <button type="button" class="ghost reset" onclick={() => reset(f)} aria-label="{f.label} 되돌리기">되돌리기</button>
                  </div>
                {/if}
                {#each bad as p (p.message)}
                  <p class="problem" role="alert">{p.message}</p>
                {/each}
              </div>
            {/each}
          </section>
        {/if}
      {/each}

      <section class="group">
        <h3>이름</h3>
        <label class="name-row">
          <span class="help">이 기기에 저장해 두고 다음 테이블에서 다시 골라요</span>
          <input bind:value={name} placeholder="우리 규칙" maxlength="20" aria-label="규칙 이름" />
        </label>
      </section>
    {/if}
  </div>
  <div class="sheet-foot">
    <button type="button" class="ghost" disabled={!changed.length} onclick={resetAll}>모두 되돌리기</button>
    <button type="button" onclick={() => dialog.close()}>취소</button>
    <button type="button" class="primary" disabled={!draft || issues.length > 0} onclick={save}>{applyLabel}</button>
  </div>
</dialog>

<style>
  .editor {
    width: min(100% - 32px, 560px);
    max-height: min(100dvh - 32px, 900px);
  }
  h2 {
    margin: 0;
    font-size: 22px;
  }
  .lead {
    margin: 4px 0 0;
    font-size: 14px;
  }
  .small {
    min-height: 36px;
    padding: 4px 10px;
    font-size: 14px;
    color: var(--ink-muted);
  }
  .start {
    display: grid;
    gap: 8px;
    margin-top: 12px;
  }
  .start-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .start-line .small {
    margin-right: -10px;
  }
  .start-text {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 2px 8px;
    min-width: 0;
    font-size: 15px;
  }
  .small-note {
    font-size: 12px;
  }
  .start-traits {
    margin: -6px 0 0;
    font-size: 13px;
    color: var(--ink-muted);
  }
  /* What differs from the start, always in view above the rows. */
  .summary {
    position: sticky;
    top: calc(-1 * var(--pad));
    z-index: 2;
    display: grid;
    gap: 6px;
    margin: 12px calc(-1 * var(--pad)) 0;
    padding: 10px var(--pad);
    border-block: 1px solid var(--line);
    background: var(--raised);
  }
  .summary p {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .summary .num {
    font-family: var(--font-display);
    font-variant-numeric: tabular-nums;
  }
  .changed-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .tag {
    min-height: 28px;
    padding: 2px 10px;
    border-radius: 999px;
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--ink);
    font-size: 12px;
    font-weight: 600;
  }
  .tag:active:not(:disabled) {
    transform: none;
  }
  .group {
    display: grid;
    margin-top: 20px;
  }
  h3 {
    margin: 0 0 4px;
    font-size: 15px;
  }
  .group-note {
    margin: 0;
    font-size: 13px;
  }
  .field {
    display: grid;
    gap: 8px;
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }
  /* A changed row carries an ink bar in the gutter and what it was. */
  .field {
    position: relative;
  }
  .field.changed::before,
  .field.bad::before {
    content: '';
    position: absolute;
    top: 10px;
    bottom: 10px;
    left: calc(-1 * var(--pad) + 6px);
    width: 3px;
    border-radius: 2px;
    background: var(--ink);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .text {
    display: grid;
    gap: 1px;
    min-width: 0;
  }
  .label {
    font-size: 15px;
    font-weight: 600;
  }
  .help {
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  .was {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: -4px;
    font-size: 12.5px;
    color: var(--ink-muted);
  }
  .reset {
    min-height: 32px;
    margin-right: -10px;
    padding: 2px 10px;
    font-size: 13px;
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .problem {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--danger);
  }
  .field.bad::before {
    background: var(--danger);
  }

  /* Switch: ink when on, a word beside it so the state reads without colour. */
  .switch {
    flex: none;
    gap: 8px;
    min-height: 40px;
    padding: 0 0 0 6px;
    background: transparent;
    box-shadow: none;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .switch:active:not(:disabled) {
    transform: none;
  }
  .switch[aria-checked='true'] {
    color: var(--ink);
  }
  .track {
    position: relative;
    width: 42px;
    height: 26px;
    border-radius: 999px;
    background: var(--off);
    box-shadow: inset 0 0 0 1.5px var(--ink-muted);
    transition: background-color var(--dur-quick) var(--ease-standard);
  }
  .knob {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--ink-muted);
    transition: transform var(--dur-quick) var(--ease-standard);
  }
  .switch[aria-checked='true'] .track {
    background: var(--ink);
    box-shadow: none;
  }
  .switch[aria-checked='true'] .knob {
    background: var(--table);
    transform: translateX(16px);
  }

  .stepper {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .stepper button {
    min-width: 40px;
    min-height: 36px;
    padding: 0;
    font-size: 18px;
  }
  .stepper output {
    min-width: 30px;
    text-align: center;
    font-family: var(--font-display);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  /* Segments: one strip of choices; the chosen one is ink. */
  .segment {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: 2px;
    padding: 2px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--ink) 8%, transparent);
  }
  /* Long choices, such as a scoring formula, one per line. */
  .segment.stack {
    grid-auto-flow: row;
  }
  .segment.stack button {
    padding: 6px 10px;
  }
  .maybe {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
  }
  .segment button {
    min-height: 36px;
    padding: 4px 6px;
    border-radius: 10px;
    background: transparent;
    box-shadow: none;
    color: var(--ink-muted);
    font-size: 13px;
    line-height: 1.25;
    word-break: keep-all;
  }
  .segment button[aria-checked='true'] {
    background: var(--ink);
    color: var(--table);
  }
  .segment button:active:not(:disabled) {
    transform: none;
  }
  .rounds {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 4px 10px;
  }
  .round-label {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-muted);
  }

  /* Several ways can be on at once, so an "on" chip is outlined with a
     check, not filled. */
  .ways {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .way {
    min-height: 36px;
    padding: 6px 12px;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-muted);
    box-shadow: inset 0 0 0 1px var(--line);
    font-size: 14px;
    animation: none;
  }
  .way[aria-pressed='true'] {
    background: var(--btn);
    color: var(--on-btn);
    box-shadow:
      inset 0 0 0 1.5px var(--ink),
      0 2px 0 var(--btn-lip);
  }
  .check {
    display: none;
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .way[aria-pressed='true'] .check {
    display: block;
  }
  .cardvalues {
    display: grid;
    gap: 4px;
  }
  .cv {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 40px;
  }
  .cv > span:first-child {
    font-size: 14px;
    font-weight: 600;
  }
  .name-row {
    display: grid;
    gap: 6px;
  }
  .name-row input {
    width: 100%;
  }
</style>
