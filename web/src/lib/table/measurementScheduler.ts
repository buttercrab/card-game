/** Frame-local measurement queue. Every round reads before it publishes; a
 * renderer flush lets dependent layout settle before the browser paints. */
export interface MeasurementTransaction { rounds: number; changedRounds: number; settled: boolean; duration: number }
export class MeasurementScheduler<Context> {
  private records = new Set<{ read: (context: Context) => unknown; publish: (value: any) => void; equal: (a: any, b: any) => boolean; value?: unknown; initialized: boolean }>();
  private pending: number | undefined;
  private disposed = false;
  private running = false;
  private invalidated = false;
  constructor(private host: {
    request(callback: () => void): number; cancel(id: number): void; context(): Context;
    /** Apply the published renderer state synchronously, without painting. */
    flush?(): void;
    maxRounds?: number;
    onLimit?(rounds: number): void;
    /** Runs after an unchanged round, before the transaction completes. */
    onSettled?(): void;
    onTransaction?(transaction: MeasurementTransaction): void;
  }) {}

  observe<Value>(read: (context: Context) => Value, publish: (value: Value) => void, equal: (a: Value, b: Value) => boolean): () => void {
    if (this.disposed) return () => {};
    const record = { read, publish, equal, initialized: false };
    this.records.add(record);
    this.invalidate();
    return () => { this.records.delete(record); };
  }
  invalidate(): void {
    if (this.disposed || !this.records.size) return;
    if (this.running) { this.invalidated = true; return; }
    if (this.pending !== undefined) return;
    this.pending = this.host.request(() => {
      this.pending = undefined;
      if (this.disposed || !this.records.size) return;
      this.running = true;
      let retry = false;
      let rounds = 0, changedRounds = 0, settled = false;
      const started = this.host.onTransaction ? performance.now() : 0;
      const limit = Math.max(1, this.host.maxRounds ?? 16);
      try {
        for (let round = 0; round < limit; round++) {
          rounds++;
          this.invalidated = false;
          const context = this.host.context();
          const readings = [...this.records].map(record => ({ record, value: record.read(context) }));
          let changed = false;
          for (const { record, value } of readings) {
            // Subscribers may unregister another record, or dispose the frame.
            if (this.disposed || !this.records.has(record)) continue;
            if (!record.initialized || !record.equal(record.value, value)) {
              record.value = value;
              record.initialized = true;
              changed = true;
              record.publish(value);
            }
          }
          if (this.disposed || !this.records.size) return;
          if (changed) changedRounds++;
          if (!this.host.flush) { retry = this.invalidated; settled = !retry; return; }
          if (!changed && !this.invalidated) {
            this.host.onSettled?.();
            // Revealing settled content may mount new subscriptions.
            if (this.invalidated) continue;
            settled = true; return;
          }
          this.host.flush();
          if (this.disposed || !this.records.size) return;
        }
        // A cyclic or unusually deep layout must not monopolize the UI thread.
        retry = true;
        this.host.onLimit?.(limit);
      } finally {
        this.running = false;
        if (retry) this.invalidate();
        this.host.onTransaction?.({ rounds, changedRounds, settled, duration: performance.now() - started });
      }
    });
  }
  dispose(): void {
    this.disposed = true;
    if (this.pending !== undefined) this.host.cancel(this.pending);
    this.pending = undefined;
    this.records.clear();
  }
}
