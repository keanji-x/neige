/**
 * Async-iterable push-pull queue.
 *
 * Producers call `push(item)`; `close()` ends the stream cleanly. The
 * iterator stays parked on a Deferred when empty so consumers don't busy-
 * loop. We only support a single consumer — the SDK's `prompt` parameter
 * is the sole reader and we never race two iterators on the same queue.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiters: Array<{
    resolve: (value: IteratorResult<T>) => void;
    reject: (err: unknown) => void;
  }> = [];
  private closed = false;
  private error: unknown = undefined;

  push(item: T): void {
    if (this.closed) {
      // Drop silently rather than throw — closing is a normal lifecycle
      // event and producers may race with EOF on stdin.
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  /**
   * End the iterator. Pending and future `next()` calls resolve with
   * `{ done: true }` once the buffer is drained.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.resolve({ value: undefined as unknown as T, done: true });
    }
  }

  /**
   * End the iterator with an error. Pending `next()` calls reject; future
   * ones return `{ done: true }`.
   */
  fail(err: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.error = err;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.reject(err);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          const value = this.buffer.shift()!;
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          if (this.error !== undefined) {
            return Promise.reject(this.error);
          }
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
      return: (): Promise<IteratorResult<T>> => {
        this.close();
        return Promise.resolve({ value: undefined as unknown as T, done: true });
      },
    };
  }
}
