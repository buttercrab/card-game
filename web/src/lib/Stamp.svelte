<script lang="ts">
  // An ink seal (도장) stamped where something big happened: who became
  // 주공, who turned out to be the friend, who played the 마이티. Tier 2 is
  // the red seal; tier 3, the hand's one huge moment, is gold.
  let { text, gold = false }: { text: string; gold?: boolean } = $props();
</script>

<span class="stamp" class:gold aria-hidden="true">{text}</span>

<style>
  .stamp {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 6;
    padding: 1px 10px 2px;
    border: 2.5px solid var(--seal, #c23b22);
    border-radius: 7px;
    background: color-mix(in srgb, var(--card) 82%, transparent);
    color: var(--seal, #c23b22);
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 800;
    line-height: 1.3;
    white-space: nowrap;
    pointer-events: none;
    transform: translate(-50%, -50%) rotate(-7deg);
    animation: stamp 1500ms cubic-bezier(0.2, 1.5, 0.4, 1) both;
  }
  .gold {
    border-color: var(--gold, #a77a12);
    color: var(--gold, #a77a12);
    font-size: 26px;
  }
  @keyframes stamp {
    0% {
      opacity: 0;
      transform: translate(-50%, -50%) rotate(-7deg) scale(1.9);
    }
    14% {
      opacity: 1;
      transform: translate(-50%, -50%) rotate(-7deg) scale(0.96);
    }
    20%,
    80% {
      opacity: 1;
      transform: translate(-50%, -50%) rotate(-7deg) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -50%) rotate(-7deg) scale(1);
    }
  }
  /* Without motion the seal simply appears; the table removes it. */
  @media (prefers-reduced-motion: reduce) {
    .stamp {
      animation: none !important;
    }
  }
  :global(:root[data-motion='off']) .stamp {
    animation: none !important;
  }
</style>
