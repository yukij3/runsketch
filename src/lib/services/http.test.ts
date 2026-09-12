import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostQueue, HttpError, Semaphore, TimeoutError, fetchJson, fetchWithTimeout } from './http';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('HostQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs FIFO with the minimum interval between starts', async () => {
    const q = new HostQueue(1000);
    const t0 = Date.now();
    const starts: number[] = [];
    const task = (id: number) => async () => {
      starts.push(Date.now() - t0);
      await wait(100);
      return id;
    };
    const all = Promise.all([q.run(task(1)), q.run(task(2)), q.run(task(3))]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await all).toEqual([1, 2, 3]);
    expect(starts).toEqual([0, 1000, 2000]);
  });

  it('serialises: a slow task blocks the next even with zero interval', async () => {
    const q = new HostQueue(0);
    let active = 0;
    let maxActive = 0;
    const log: string[] = [];
    const task = (id: string, ms: number) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      log.push(`start ${id}`);
      await wait(ms);
      log.push(`end ${id}`);
      active--;
    };
    const all = Promise.all([q.run(task('a', 500)), q.run(task('b', 10)), q.run(task('c', 10))]);
    await vi.advanceTimersByTimeAsync(1000);
    await all;
    expect(maxActive).toBe(1);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('removes aborted waiting tasks without running them', async () => {
    const q = new HostQueue(1000);
    const ran: number[] = [];
    const ac = new AbortController();
    const p1 = q.run(async () => {
      ran.push(1);
    });
    const p2 = q.run(async () => {
      ran.push(2);
    }, ac.signal);
    const p3 = q.run(async () => {
      ran.push(3);
    });
    ac.abort();
    const err = await p2.catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all([p1, p3]);
    expect(ran).toEqual([1, 3]);
    expect(q.pending).toBe(0);
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const q = new HostQueue(0);
    const ac = new AbortController();
    ac.abort();
    const task = vi.fn(async () => 1);
    await expect(q.run(task, ac.signal)).rejects.toBeDefined();
    expect(task).not.toHaveBeenCalled();
  });

  it('keeps going after a task rejects', async () => {
    const q = new HostQueue(0);
    const p1 = q.run(async () => {
      throw new Error('boom');
    });
    const p2 = q.run(async () => 'ok');
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('ok');
  });
});

describe('Semaphore', () => {
  it('never exceeds the limit', async () => {
    const sem = new Semaphore(3);
    let active = 0;
    let maxActive = 0;
    const jobs = Array.from({ length: 20 }, (_, i) =>
      sem.use(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 1 + (i % 3)));
        active--;
        return i;
      }),
    );
    expect(await Promise.all(jobs)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(maxActive).toBe(3);
  });
});

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** fetch that never answers until its signal aborts. */
  const hangingFetch = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }),
  );

  it('times out with TimeoutError (default 8 s)', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const p = fetchWithTimeout('https://example.test/');
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(7999);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('propagates an external abort as an AbortError, not a timeout', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const ac = new AbortController();
    const p = fetchWithTimeout('https://example.test/', { signal: ac.signal, timeoutMs: 1000 });
    ac.abort();
    const err = await p.catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(TimeoutError);
    expect((err as Error).name).toBe('AbortError');
  });

  it('passes other init fields through and returns the response', async () => {
    const fetchMock = vi.fn(async () => new Response('{"a":1}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchWithTimeout('https://example.test/', { method: 'POST', timeoutMs: 50 });
    expect(await res.json()).toEqual({ a: 1 });
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('fetchJson throws HttpError with the body on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('from-position not mapped', { status: 400 })));
    const err = await fetchJson('https://example.test/').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
    expect((err as HttpError).body).toContain('not mapped');
  });
});
