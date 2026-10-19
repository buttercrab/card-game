import { describe, expect, it } from 'vitest';
import { MeasurementScheduler, type MeasurementTransaction } from './measurementScheduler';
function harness() {
  let next = 0; const pending = new Map<number, () => void>(); let root = 1; let reads = 0;
  const scheduler = new MeasurementScheduler({ request(callback) { const id=++next; pending.set(id,callback); return id; }, cancel(id) { pending.delete(id); }, context() { reads++; return root; } });
  return {scheduler,pending,root(value:number){root=value;},reads:()=>reads,flush(){const callbacks=[...pending.values()];pending.clear();callbacks.forEach(callback=>callback());}};
}
describe('frame measurement scheduling', () => {
  it('coalesces registrations and resize invalidations into one context read', () => {
    const h=harness(); const values:number[]=[];
    h.scheduler.observe(root=>root,value=>values.push(value),Object.is); h.scheduler.observe(root=>root*2,value=>values.push(value),Object.is);
    h.scheduler.invalidate();h.scheduler.invalidate();expect(h.pending.size).toBe(1);
    h.flush();expect(h.reads()).toBe(1);expect(values).toEqual([1,2]);
  });
  it('finishes every read before publishing changes',()=>{
    const h=harness();const order:string[]=[];
    for(const id of ['a','b'])h.scheduler.observe(()=>{order.push(`read ${id}`);return 1;},()=>order.push(`publish ${id}`),Object.is);
    h.flush();expect(order).toEqual(['read a','read b','publish a','publish b']);
  });
  it('does not publish unchanged measurements',()=>{
    const h=harness();const values:number[]=[];h.scheduler.observe(root=>root,value=>values.push(value),Object.is);
    h.flush();h.scheduler.invalidate();h.flush();expect(values).toEqual([1]);
  });
  it('reads a changed root and gives a remounted registration its initial value',()=>{
    const h=harness();const values:number[]=[];const release=h.scheduler.observe(root=>root,value=>values.push(value),Object.is);
    h.flush();h.root(8);h.scheduler.invalidate();h.flush();release();h.scheduler.observe(root=>root,value=>values.push(value),Object.is);h.flush();expect(values).toEqual([1,8,8]);
  });
  it('removal before a frame prevents stale reads and callbacks',()=>{
    const h=harness();const release=h.scheduler.observe(()=>{throw Error('stale');},()=>{throw Error('stale');},Object.is);
    release();h.flush();
  });
  it('dispose cancels pending work and makes a queued callback harmless',()=>{
    const h=harness();const values:number[]=[];h.scheduler.observe(root=>root,value=>values.push(value),Object.is);
    const stale=[...h.pending.values()][0];h.scheduler.dispose();stale();h.scheduler.invalidate();h.scheduler.observe(root=>root,value=>values.push(value),Object.is);
    expect(h.pending.size).toBe(0);expect(h.reads()).toBe(0);expect(values).toEqual([]);
  });
  it('a subscriber removed during publication receives no stale callback',()=>{
    const h=harness();const values:number[]=[];let release=()=>{};h.scheduler.observe(root=>root,()=>release(),Object.is);
    release=h.scheduler.observe(root=>root,value=>values.push(value),Object.is);h.flush();expect(values).toEqual([]);
  });
  it('invalidation during publication schedules another batch without recursion',()=>{
    const h=harness();const values:number[]=[];h.scheduler.observe(root=>root,value=>{values.push(value);h.scheduler.invalidate();},Object.is);
    h.flush();expect(h.pending.size).toBe(1);h.flush();expect(values).toEqual([1]);expect(h.pending.size).toBe(0);
  });
});

describe('pre-paint layout transactions', () => {
  function transaction(flush: () => void, maxRounds = 16, onLimit = () => {}, onTransaction?: (transaction: MeasurementTransaction) => void) {
    const pending = new Map<number, () => void>(); let sequence = 0;
    const scheduler = new MeasurementScheduler({
      request(callback) { const id = ++sequence; pending.set(id, callback); return id; },
      cancel(id) { pending.delete(id); }, context: () => ({}), flush, maxRounds, onLimit, onTransaction,
    });
    return { scheduler, pending, frame() { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback()); } };
  }
  it('settles a nested dependency chain in one requested frame', () => {
    let rendered = [0, 0, 0], draft = [...rendered], flushes = 0;
    const h = transaction(() => { rendered = [...draft]; flushes++; h.scheduler.invalidate(); });
    for (let index = 0; index < 3; index++) h.scheduler.observe(
      () => index === 0 ? 100 : rendered[index - 1] + 10,
      value => { draft[index] = value; }, Object.is,
    );
    h.frame();
    expect(rendered).toEqual([100, 110, 120]);
    expect(flushes).toBe(3); expect(h.pending.size).toBe(0);
    h.scheduler.invalidate(); h.frame(); expect(flushes).toBe(3);
  });
  it('includes subscriptions mounted by the renderer flush', () => {
    const values: number[] = []; let mounted = false;
    const h = transaction(() => {
      if (!mounted) { mounted = true; h.scheduler.observe(() => 2, value => values.push(value), Object.is); }
    });
    h.scheduler.observe(() => 1, value => values.push(value), Object.is);
    h.frame(); expect(values).toEqual([1, 2]); expect(h.pending.size).toBe(0);
  });
  it('keeps reads before publications in every settling round', () => {
    const order: string[] = []; let rendered = 0;
    const h = transaction(() => { order.push('flush'); rendered = 1; });
    for (const id of ['a', 'b']) h.scheduler.observe(() => { order.push(`read ${id}`); return rendered; }, () => order.push(`publish ${id}`), Object.is);
    h.frame(); expect(order).toEqual([
      'read a', 'read b', 'publish a', 'publish b', 'flush',
      'read a', 'read b', 'publish a', 'publish b', 'flush', 'read a', 'read b',
    ]);
  });
  it('bounds a cyclic layout and continues without synchronous recursion', () => {
    let rendered = 0, draft = 0, limitHits = 0;
    const h = transaction(() => { rendered = draft; }, 3, () => { limitHits++; });
    h.scheduler.observe(() => 1 - rendered, value => { draft = value; }, Object.is);
    h.frame(); expect(limitHits).toBe(1); expect(h.pending.size).toBe(1);
    h.scheduler.dispose(); expect(h.pending.size).toBe(0);
  });
  it('stops safely when a renderer flush disposes the frame', () => {
    let reads = 0;
    const h = transaction(() => { h.scheduler.dispose(); });
    h.scheduler.observe(() => { reads++; return 1; }, () => {}, Object.is);
    h.frame(); expect(reads).toBe(1); expect(h.pending.size).toBe(0);
  });
  it('reports convergence rounds and timing only through the optional observer', () => {
    const reports: MeasurementTransaction[] = [];
    const h = transaction(() => {}, 16, () => {}, report => reports.push(report));
    h.scheduler.observe(() => 1, () => {}, Object.is); h.frame();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ rounds: 2, changedRounds: 1, settled: true });
    expect(reports[0].duration).toBeGreaterThanOrEqual(0);
    h.scheduler.invalidate(); h.frame();
    expect(reports[1]).toMatchObject({ rounds: 1, changedRounds: 0, settled: true });
  });
  it('reports the round limit as unsettled rather than claiming an atomic layout', () => {
    const reports: MeasurementTransaction[] = []; let state = 0;
    const h = transaction(() => {}, 3, () => {}, report => reports.push(report));
    h.scheduler.observe(() => state++, () => {}, Object.is); h.frame();
    expect(reports[0]).toMatchObject({ rounds: 3, changedRounds: 3, settled: false });
    h.scheduler.dispose();
  });
});
