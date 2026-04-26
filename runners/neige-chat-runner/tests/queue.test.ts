import { describe, expect, it } from 'vitest';

import { AsyncQueue } from '../src/queue.js';

describe('AsyncQueue', () => {
  it('yields buffered items synchronously when pushed before next()', async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    const it = q[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ value: 1, done: false });
    expect(await it.next()).toEqual({ value: 2, done: false });
  });

  it('parks next() until a push arrives', async () => {
    const q = new AsyncQueue<string>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    let resolved = false;
    pending.then(() => {
      resolved = true;
    });
    // Microtasks have run; nothing pushed yet → still pending.
    await Promise.resolve();
    expect(resolved).toBe(false);
    q.push('hi');
    expect(await pending).toEqual({ value: 'hi', done: false });
  });

  it('close() drains buffered items, then signals done', async () => {
    const q = new AsyncQueue<number>();
    q.push(7);
    q.close();
    const it = q[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ value: 7, done: false });
    const second = await it.next();
    expect(second.done).toBe(true);
  });

  it('close() resolves a pending next() with done', async () => {
    const q = new AsyncQueue<number>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.close();
    const result = await pending;
    expect(result.done).toBe(true);
  });

  it('push() after close() is a silent drop', async () => {
    const q = new AsyncQueue<number>();
    q.close();
    q.push(99);
    const it = q[Symbol.asyncIterator]();
    expect((await it.next()).done).toBe(true);
  });

  it('works as for-await iterable through close()', async () => {
    const q = new AsyncQueue<number>();
    q.push(10);
    q.push(20);
    q.push(30);
    q.close();
    const collected: number[] = [];
    for await (const item of q) collected.push(item);
    expect(collected).toEqual([10, 20, 30]);
  });

  it('return() on the iterator closes the queue', async () => {
    const q = new AsyncQueue<number>();
    const it = q[Symbol.asyncIterator]();
    expect(it.return).toBeDefined();
    const r = await it.return!();
    expect(r.done).toBe(true);
    // Subsequent next() returns done as well.
    expect((await it.next()).done).toBe(true);
  });

  it('fail() rejects pending next()', async () => {
    const q = new AsyncQueue<number>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.fail(new Error('boom'));
    await expect(pending).rejects.toThrow('boom');
  });
});
