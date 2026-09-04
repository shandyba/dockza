import { describe, it, expect } from 'vitest';
import { RefreshGate } from '@utils/refresh-gate';

/** A promise plus its resolver, so a test can decide exactly when a fetch lands. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending microtasks (the gate's awaits) run before the test asserts. */
const flush = () => new Promise<void>((r) => setImmediate(r));

describe('RefreshGate', () => {
  it('applies a fetch that nothing invalidated', async () => {
    const applied: string[] = [];
    const gate = new RefreshGate(async (token) => {
      await Promise.resolve();
      if (gate.isCurrent(token)) applied.push('fresh');
    });

    await gate.poll();

    expect(applied).toEqual(['fresh']);
  });

  it('drops a fetch that a mutation outraced mid-flight', async () => {
    const listing = deferred<string[]>();
    const applied: string[][] = [];
    const gate = new RefreshGate(async (token) => {
      const items = await listing.promise;
      if (!gate.isCurrent(token)) return;
      applied.push(items);
    });

    const inFlight = gate.poll();

    // The mutation lands while the listing is still pending.
    gate.invalidate();
    listing.resolve(['a', 'b']);
    await inFlight;

    expect(applied).toEqual([]);
  });

  it('skips poll() while a fetch is in flight so ticks cannot stack up', async () => {
    const listing = deferred<void>();
    let started = 0;
    const gate = new RefreshGate(async () => {
      started++;
      await listing.promise;
    });

    const first = gate.poll();
    await flush();
    await gate.poll();
    await gate.poll();

    expect(started).toBe(1);

    listing.resolve();
    await first;
  });

  it('runs force() even while a fetch is in flight, without waiting for it', async () => {
    const stale = deferred<void>();
    const starts: number[] = [];
    const gate = new RefreshGate(async (token) => {
      starts.push(token);
      // Only the first task blocks; the forced one resolves immediately.
      if (starts.length === 1) await stale.promise;
    });

    const inFlight = gate.poll();
    await flush();

    // Would deadlock (or be silently dropped) if force() honored the in-flight guard.
    await gate.force();

    expect(starts).toEqual([0, 1]);

    stale.resolve();
    await inFlight;
  });

  it('keeps only the newest token current across two mutations, in either completion order', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const tokens: number[] = [];
    const applied: number[] = [];

    const gate = new RefreshGate(async (token) => {
      tokens.push(token);
      await (tokens.length === 1 ? first.promise : second.promise);
      if (gate.isCurrent(token)) applied.push(token);
    });

    const m1 = gate.force();
    await flush();
    const m2 = gate.force();
    await flush();

    // The older fetch lands last — it must still lose.
    second.resolve();
    await m2;
    first.resolve();
    await m1;

    expect(tokens).toEqual([1, 2]);
    expect(applied).toEqual([2]);
  });

  it('still refetches after a mutation whose action rejected', async () => {
    let started = 0;
    const gate = new RefreshGate(async (token) => {
      started++;
      expect(gate.isCurrent(token)).toBe(true);
    });

    const run = async () => {
      gate.invalidate();
      try {
        await Promise.reject(new Error('docker said no'));
      } finally {
        await gate.force();
      }
    };

    await expect(run()).rejects.toThrow('docker said no');
    expect(started).toBe(1);
  });

  it('invalidate() alone schedules no fetch', async () => {
    let started = 0;
    const gate = new RefreshGate(async () => {
      started++;
    });

    gate.invalidate();
    gate.invalidate();
    await flush();

    expect(started).toBe(0);
    expect(gate.isCurrent(gate.token())).toBe(true);
  });
});
