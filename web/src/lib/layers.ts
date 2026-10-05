// What the back gesture closes at the table, before it opens the menu:
// the topmost sheet (a modal <dialog>), else the last popover that asked.

const closers: (() => void)[] = [];

/** Registers a popover's close; returns the unregister. */
export function layer(close: () => void): () => void {
  closers.push(close);
  return () => {
    const i = closers.lastIndexOf(close);
    if (i >= 0) closers.splice(i, 1);
  };
}

/** Closes the topmost open sheet or popover; false if none was open. */
export function closeTop(): boolean {
  const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  const top = dialogs[dialogs.length - 1];
  if (top) {
    top.close();
    return true;
  }
  const close = closers.pop();
  if (close) {
    close();
    return true;
  }
  return false;
}
