/** Table shortcuts never intercept text entry, modifiers or modal UI. */
export function tableShortcut(event: KeyboardEvent, ownPopover = false): boolean {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
  const target = event.target as HTMLElement | null;
  if (target?.isContentEditable || target?.closest('input, textarea, select')) return false;
  if (document.querySelector('dialog[open]')) return false;
  return ownPopover || !document.querySelector('.pop-card');
}
