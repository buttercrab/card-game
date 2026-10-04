// Reports uncaught errors to the server, so a crash someone never mentions
// still gets seen. Only the error, the page (without the room id) and the
// browser go out: never names or the state of a game. Failures stay silent.

const ENDPOINT = '/api/errors';
const LIMIT = 5;

/** This build, by the hash in the bundle's file name ('dev' under Vite's dev server). */
const version = new URL(import.meta.url).pathname.match(/-([\w-]+)\.js$/)?.[1] ?? 'dev';

const seen = new Set<string>();

/** The page without its query, hash or room id. */
function page(): string {
  return location.origin + location.pathname.replace(/^\/r\/[^/]+/, '/r/:id');
}

function report(message: string, stack: string) {
  // Browser extensions run in the page too, and ResizeObserver's loop
  // warning is harmless noise.
  if (/-extension:\/\//.test(stack) || /ResizeObserver loop/.test(message)) return;
  const key = `${message}\n${stack.split('\n').find((l) => l.trim() && !l.includes(message)) ?? ''}`;
  if (seen.has(key) || seen.size >= LIMIT) return;
  seen.add(key);
  const body = JSON.stringify({
    message: message.slice(0, 1000),
    stack: stack.slice(0, 4000),
    url: page(),
    ua: navigator.userAgent,
    version,
  });
  try {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon?.(ENDPOINT, blob)) return;
    void fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    // Reporting must never become an error of its own.
  }
}

function describe(value: unknown): { message: string; stack: string } {
  if (value instanceof Error) return { message: `${value.name}: ${value.message}`, stack: value.stack ?? '' };
  return { message: String(value), stack: '' };
}

export function installErrorReports() {
  window.addEventListener('error', (event) => {
    // A failed image or script load is an Event with no error; skip those.
    if (!event.message && !event.error) return;
    const { message, stack } = event.error ? describe(event.error) : { message: event.message, stack: '' };
    report(message || event.message, stack || `${event.filename}:${event.lineno}:${event.colno}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const { message, stack } = describe(event.reason);
    report(`Unhandled rejection: ${message}`, stack);
  });
}
