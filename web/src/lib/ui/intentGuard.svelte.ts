// A primary action changing meaning must not accept the previous click's tail.
// Motion settings do not disable input safety. Repeated presence updates do
// not restart the guard; only the false -> true eligibility boundary does.
export class IntentGuard {
  blocked = $state(false);
  #eligible = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  update(eligible: boolean) {
    if (eligible === this.#eligible) return;
    this.#eligible = eligible;
    clearTimeout(this.#timer);
    this.blocked = eligible;
    if (eligible) this.#timer = setTimeout(() => (this.blocked = false), 400);
  }
  close() { clearTimeout(this.#timer); }
}
