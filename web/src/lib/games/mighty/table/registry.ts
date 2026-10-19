// Elements on screen by key, for the motion that needs to know where things
// are: a card in your hand, a card on the trick, a seat. Each element
// registers itself as it is drawn ({@attach registry.at(key)}) and leaves
// as it goes, so nothing searches the page by class name.

import type { Attachment } from 'svelte/attachments';

export class Registry<K> {
  #els = new Map<K, HTMLElement>();

  /** Registers the element it is attached to under `key`. */
  at(key: K): Attachment<HTMLElement> {
    return (el) => {
      this.#els.set(key, el);
      return () => {
        if (this.#els.get(key) === el) this.#els.delete(key);
      };
    };
  }

  get(key: K): HTMLElement | null {
    const el = this.#els.get(key);
    return el?.isConnected ? el : null;
  }

  entries(): [K, HTMLElement][] {
    return [...this.#els].filter(([, el]) => el.isConnected);
  }
}

/** The key a card goes by in a registry. */
export { cardKey } from '../cards';
