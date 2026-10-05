/** Marks a sideways-scrolling row with `.more` while some of it is hidden
 * past its right edge, so its CSS can fade that edge (as BidPanel does). */
export function scrollFade(node: HTMLElement) {
  const measure = () => node.classList.toggle('more', node.scrollLeft + node.clientWidth < node.scrollWidth - 2);
  const resize = new ResizeObserver(measure);
  resize.observe(node);
  // Chips come and go with the choice above them.
  const mutate = new MutationObserver(measure);
  mutate.observe(node, { childList: true, subtree: true, characterData: true });
  node.addEventListener('scroll', measure, { passive: true });
  measure();
  return {
    destroy() {
      resize.disconnect();
      mutate.disconnect();
      node.removeEventListener('scroll', measure);
    },
  };
}
