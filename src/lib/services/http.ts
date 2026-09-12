// Network primitives shared by routing, elevation and geocoding.

export const DEFAULT_TIMEOUT_MS = 8000;

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, url: string, body = '') {
    super(`HTTP ${status} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

export function abortError(signal?: AbortSignal): unknown {
  if (signal?.reason !== undefined) return signal.reason;
  return new DOMException('The operation was aborted.', 'AbortError');
}

/** True when the failure came from the caller cancelling (as opposed to a timeout or network error). */
export function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof DOMException && err.name === 'AbortError';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

export type TimedInit = RequestInit & { timeoutMs?: number };

/**
 * Runs `fn` with a signal that aborts on the external signal or after `timeoutMs`.
 * A timeout surfaces as TimeoutError; an external abort as the caller's abort reason.
 */
async function withTimeout<T>(
  external: AbortSignal | null | undefined,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (external?.aborted) throw abortError(external);
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(external?.reason);
  external?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new TimeoutError(timeoutMs));
  }, timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (external?.aborted) throw abortError(external);
    if (timedOut) throw new TimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onAbort);
  }
}

/**
 * fetch with timeout + external abort signal. The timeout covers the response headers only;
 * use fetchText/fetchJson/fetchBlob when the body must arrive within the same budget.
 */
export async function fetchWithTimeout(url: string, init?: TimedInit): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init ?? {};
  return withTimeout(signal, timeoutMs, (s) => fetch(url, { ...rest, signal: s }));
}

async function fetchBody<T>(url: string, init: TimedInit | undefined, read: (r: Response) => Promise<T>): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init ?? {};
  return withTimeout(signal, timeoutMs, async (s) => {
    const res = await fetch(url, { ...rest, signal: s });
    if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''));
    return read(res);
  });
}

/** GET text; throws HttpError on non-2xx. Timeout covers the body. */
export function fetchText(url: string, init?: TimedInit): Promise<string> {
  return fetchBody(url, init, (r) => r.text());
}

/** GET JSON; throws HttpError on non-2xx, SyntaxError on bad JSON. Timeout covers the body. */
export function fetchJson<T = unknown>(url: string, init?: TimedInit): Promise<T> {
  return fetchBody(url, init, (r) => r.json() as Promise<T>);
}

/** GET binary; throws HttpError on non-2xx. Timeout covers the body. */
export function fetchBlob(url: string, init?: TimedInit): Promise<Blob> {
  return fetchBody(url, init, (r) => r.blob());
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface QueueEntry {
  task: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/** Serialises requests to one host with a minimum interval between starts. */
export class HostQueue {
  private readonly minIntervalMs: number;
  private readonly queue: QueueEntry[] = [];
  private busy = false;
  private lastStart = -Infinity;

  constructor(minIntervalMs: number) {
    this.minIntervalMs = Math.max(0, minIntervalMs);
  }

  /** Number of tasks waiting (not counting the one running). */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Enqueue a task. If `signal` aborts while the task is still waiting it is removed and the
   * promise rejects without the task ever starting. A running task must honour the signal itself.
   */
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError(signal));
      const entry: QueueEntry = { task, resolve: resolve as (v: unknown) => void, reject, signal };
      if (signal) {
        entry.onAbort = () => {
          const i = this.queue.indexOf(entry);
          if (i >= 0) {
            this.queue.splice(i, 1);
            reject(abortError(signal));
          }
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.queue.push(entry);
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length > 0) {
        const wait = this.lastStart + this.minIntervalMs - Date.now();
        if (wait > 0) await sleep(wait);
        const entry = this.queue.shift();
        if (!entry) break;
        if (entry.onAbort) entry.signal?.removeEventListener('abort', entry.onAbort);
        this.lastStart = Date.now();
        try {
          entry.resolve(await entry.task());
        } catch (err) {
          entry.reject(err);
        }
      }
    } finally {
      this.busy = false;
    }
  }
}

/** Limits how many async jobs run at once (no ordering or interval guarantees beyond FIFO start). */
export class Semaphore {
  private readonly max: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(max: number) {
    this.max = Math.max(1, max);
  }

  async use<T>(job: () => Promise<T>): Promise<T> {
    // A released slot is handed straight to the next waiter, so newcomers cannot overshoot `max`.
    if (this.active < this.max) this.active++;
    else await new Promise<void>((r) => this.waiters.push(r));
    try {
      return await job();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}
