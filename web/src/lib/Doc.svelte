<script lang="ts">
  // A reading page (소개, 개인정보 처리방침): a way home, a title, the
  // text, and the site's links at the foot. Set like the rulebook.
  import type { Snippet } from 'svelte';
  import SiteLinks from './SiteLinks.svelte';

  let { title, here, lead, children }: { title: string; here: string; lead?: Snippet; children: Snippet } = $props();
</script>

<article class="doc">
  <a class="back" href="/">← 처음으로</a>
  <header>
    <h1>{title}</h1>
    {@render lead?.()}
  </header>
  {@render children()}
  <footer>
    <SiteLinks {here} />
  </footer>
</article>

<style>
  .doc {
    --tint: color-mix(in srgb, var(--ink) 7%, transparent);
    display: grid;
    gap: 24px;
    line-height: 1.6;
  }
  /* The arrow lines up with the text, not 10px inside it. */
  .back {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    margin: -12px 0 -16px -10px;
    padding: 0 10px;
    border-radius: 12px;
    color: var(--ink-muted);
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
  }
  @media (hover: hover) {
    .back:hover {
      color: var(--ink);
    }
  }
  header {
    display: grid;
    gap: 8px;
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 800;
  }
  :global(:where(.doc) section) {
    display: grid;
    gap: 8px;
  }
  :global(:where(.doc) h2) {
    margin: 0;
    font-size: 18px;
  }
  :global(:where(.doc) :is(p, ul, ol)) {
    margin: 0;
  }
  :global(:where(.doc) ul) {
    display: grid;
    gap: 4px;
    padding-left: 20px;
  }
  /* Links in the text are ink and underlined: plum is for acting now.
     These text styles stay at the lowest weight so a page's own win. */
  :global(:where(.doc) :is(p, li) a) {
    color: var(--ink);
    font-weight: 600;
    text-decoration: underline;
    text-decoration-color: var(--ink-muted);
    text-underline-offset: 3px;
    overflow-wrap: anywhere;
  }
  footer {
    padding-top: 8px;
    border-top: 1px solid var(--line);
  }
</style>
