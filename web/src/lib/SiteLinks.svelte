<script lang="ts">
  // The site's own pages, in a quiet line at the foot of the home page and
  // the reading pages.
  const LINKS = [
    { href: '/about', label: '소개' },
    { href: '/privacy', label: '개인정보 처리방침' },
  ];
  let { here = '' }: { here?: string } = $props();
</script>

<nav class="links" aria-label="사이트 정보">
  {#each LINKS as l (l.href)}
    <a href={l.href} aria-current={here === l.href ? 'page' : undefined}>{l.label}</a>
  {/each}
</nav>

<style>
  .links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0 4px;
  }
  a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 10px;
    border-radius: var(--r-control);
    color: var(--ink-muted);
    font-size: var(--text-label);
    font-weight: 600;
    text-decoration: none;
  }
  @media (hover: hover) {
    a:hover {
      color: var(--ink);
      text-decoration: underline;
      text-underline-offset: 3px;
    }
  }
  a[aria-current='page'] {
    color: var(--ink);
  }
</style>
