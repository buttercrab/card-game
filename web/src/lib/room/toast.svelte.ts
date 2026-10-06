// The table's one toast: an error (the server refused something) or a
// notice (the seats moved, why a card can't be played). Each toast has
// its own id, so the same error twice still shows, and sounds, twice.

export type ToastKind = 'error' | 'notice';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

/** How long each kind stays up. */
const SHOWN: Record<ToastKind, number> = { error: 4000, notice: 2500 };

export class Toasts {
  current = $state<Toast | null>(null);
  #next = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #onshow: (toast: Toast) => void;

  /** `onshow` hears every toast as it appears (the error sound). */
  constructor(onshow: (toast: Toast) => void = () => {}) {
    this.#onshow = onshow;
  }

  show(kind: ToastKind, text: string): Toast {
    const toast = { id: ++this.#next, kind, text };
    this.current = toast;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      if (this.current?.id === toast.id) this.current = null;
    }, SHOWN[kind]);
    this.#onshow(toast);
    return toast;
  }

  /** Takes the toast down now, and its timer with it. */
  clear() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.current = null;
  }
}
