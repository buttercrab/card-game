<script lang="ts">
  // 우리 규칙 만들기: start from a preset (or a set saved on this device),
  // change rules grouped by phase, see what differs from the start, and
  // save. Every row comes from RULE_FIELDS in ruleFields.ts. The server
  // checks the result too; problems() mirrors its checks so a set it would
  // refuse cannot be applied.
  import { untrack } from 'svelte';
  import { cardLabel } from './cards';
  import PresetPicker from './PresetPicker.svelte';
  import { isPreset, presetRules, presetTitle } from '../../catalog';
  import { GROUPS, RULE_FIELDS, differences, getPath, problems, same, say, setField, shown, traits, type Field } from './ruleFields';
  import { customName, loadCustom, saveCustom, type CustomSet } from './rulesets';
  import SuitText from '../../SuitText.svelte';
  import type { Card, Rules } from './types';
  import Button from '../../ui/Button.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import Sheet from '../../ui/Sheet.svelte';
  import Switch from '../../ui/Switch.svelte';

  let {
    preset,
    rules = null,
    base: pinned = null,
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
    /** `preset`'s rules as a table pinned them, which may differ from the
     * preset's today; null for today's. */
    base?: Rules | null;
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
  /** What sets the starting rules apart is said against 기본. */
  const defaults = presetRules('default');
  let draft = $state<Rules | null>(null);
  let picking = $state(false);


  /** Loads `id`'s rules as the base; the draft becomes `start` or the preset. */
  function startFrom(id: string, start: Rules | null) {
    baseId = id;
    // The table's own preset: as the table pinned it.
    const kept = id === untrack(() => preset) ? untrack(() => $state.snapshot(pinned) as Rules | null) : null;
    const found = kept ?? (isPreset(id) ? presetRules(id) : null);
    base = found;
    draft = found && structuredClone(start ?? found);
  }
  startFrom(
    untrack(() => preset),
    untrack(() => $state.snapshot(rules) as Rules | null),
  );

  const changed = $derived(base && draft ? differences(draft, base) : []);
  const changedPaths = $derived(new Set(changed.map((f) => f.path)));
  const issues = $derived(draft ? problems(draft) : []);
  const issueAt = (path: string) => issues.filter((p) => p.paths.includes(path));
  const loose = $derived(
    draft ? issues.filter((p) => !p.paths.some((path) => RULE_FIELDS.some((f) => f.path === path && shown(f, draft!)))) : [],
  );
  const startName = $derived(
    from ? customName(customs.find((c) => c.id === from)!) : presetTitle(baseId),
  );
  const baseName = $derived(presetTitle(baseId));
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

  let dialog = $state<HTMLDialogElement>();

  function save() {
    if (!draft || issues.length) return;
    const out = changed.length ? ($state.snapshot(draft) as Rules) : null;
    const saved = out ? saveCustom({ id: from || undefined, name, base: baseId, rules: out }) : null;
    onsave(baseId, out, saved);
    dialog?.close();
  }

  function jump(path: string) {
    dialog?.querySelector(`[data-path="${path}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  const INLINE = new Set(['toggle', 'stepper', 'maybe']);
</script>

{#snippet stepper(value: number, min: number, max: number, onset: (v: number) => void, label: string, signed = false)}
  <span class="stepper" role="group" aria-label={label}>
    <button class="btn" type="button" onclick={() => onset(value - 1)} disabled={value <= min} aria-label="{label} 줄이기">−</button>
    <output>{signed && value > 0 ? `+${value}` : value < 0 ? `−${-value}` : value}</output>
    <button class="btn" type="button" onclick={() => onset(value + 1)} disabled={value >= max} aria-label="{label} 늘리기">+</button>
  </span>
{/snippet}

{#snippet segment(options: { value: unknown; label: string }[], value: unknown, onset: (v: unknown) => void, label: string, stack = false)}
  <Segmented {options} {value} onchange={onset} {label} {stack} {same} />
{/snippet}

{#snippet control(f: Field, r: Rules)}
  {@const v = getPath(r, f.path)}
  {@const c = f.control}
  {#if c.kind === 'toggle'}
    <Switch checked={!!v} label={f.label} word={v ? c.on : c.off} onchange={(on) => set(f, on)} />
  {:else if c.kind === 'stepper'}
    {@render stepper(v, c.min, c.max, (x) => set(f, x), f.label, c.signed)}
  {:else if c.kind === 'segment'}
    {@render segment(c.options, v, (x) => set(f, x), f.label, c.stack)}
  {:else if c.kind === 'maybe'}
    <!-- The switch; its number's stepper goes under the label (see below). -->
    <Switch checked={v !== null} label={f.label} word={v === null ? c.off : c.on(v)} onchange={(on) => set(f, on ? c.start : null)} />
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
          <svg class="check" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5 L5 9 L9.5 3.5" /></svg><SuitText text={cardLabel(card)} />
        </button>
      {/each}
    </div>
    {#if list.length}
      <div class="cardvalues">
        {#each list as [card, value], i (cardLabel(card))}
          <div class="cv">
            <span><SuitText text={cardLabel(card)} /> 한 장의 값</span>
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

<Sheet title="우리 규칙 만들기" size="large" bind:dialog {onclose}>
    <p class="lead muted">아는 규칙에서 시작해 다른 것만 바꾸세요. {note}</p>

    <div class="start">
      <div class="start-line">
        <span class="start-text">
          <span class="muted">시작</span>
          <strong>{startName}</strong>
          {#if from}<span class="muted small-note">{baseName} 바탕</span>{/if}
        </span>
        <button type="button" class="btn ghost sm" aria-expanded={picking} onclick={() => (picking = !picking)}>
          {picking ? '접기' : '다른 규칙에서 시작'}
        </button>
      </div>
      {#if picking}
        <PresetPicker selected={from ? `custom:${from}` : baseId} {customs} onselect={choose} label="시작할 규칙" />
      {:else if startTraits.length && !from}
        <p class="start-traits"><SuitText text={startTraits.join(' · ')} /></p>
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
                    <span>{baseName}: <SuitText text={say(f, b)} /></span>
                    <button type="button" class="btn ghost sm reset" onclick={() => reset(f)} aria-label="{f.label} 되돌리기">되돌리기</button>
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
  
  {#snippet footer(close)}
    <Button variant="ghost" disabled={!changed.length} onclick={resetAll}>모두 되돌리기</Button>
    <Button onclick={close}>취소</Button>
    <Button variant="primary" disabled={!draft || issues.length > 0} onclick={save}>{applyLabel}</Button>
  {/snippet}
</Sheet>

<style>
  .lead {
    margin: -8px 0 0;
    font-size: 14px;
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
  .start-line .btn {
    margin-right: -10px;
    color: var(--ink-muted);
  }
  .start-text {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 2px 8px;
    min-width: 0;
    font-size: var(--text-body);
  }
  .small-note {
    font-size: var(--text-caption);
  }
  .start-traits {
    margin: -6px 0 0;
    font-size: var(--text-label);
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
    position: relative;
    min-height: 28px;
    padding: 2px 10px;
    border-radius: var(--r-pill);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--ink);
    font-size: var(--text-caption);
    font-weight: 600;
  }
  /* A 44px target round the small tag. */
  .tag::before {
    content: '';
    position: absolute;
    inset: -8px -2px;
  }
  .group {
    display: grid;
    margin-top: 20px;
  }
  h3 {
    margin: 0 0 4px;
    font-size: var(--text-body);
  }
  .group-note {
    margin: 0;
    font-size: var(--text-label);
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
    font-size: var(--text-body);
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
    margin-right: -10px;
    font-size: var(--text-label);
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .problem {
    margin: 0;
    font-size: var(--text-label);
    font-weight: 600;
    color: var(--danger);
  }
  .field.bad::before {
    background: var(--danger);
  }

  .stepper {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .stepper .btn {
    min-width: 44px;
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

  .maybe {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
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
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: var(--r-pill);
    background: transparent;
    color: var(--ink-muted);
    box-shadow: inset 0 0 0 1px var(--line);
    font-size: 14px;
  }
  .way::before {
    content: '';
    position: absolute;
    inset: -4px -2px;
  }
  .way[aria-pressed='true'] {
    background: var(--btn);
    color: var(--ink);
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
