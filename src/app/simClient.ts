// Runs simulation jobs in a Web Worker with latest-request-wins semantics, or on the main thread when no worker
// can be started. A newer job of the same kind supersedes the older one: its promise rejects with
// SupersededError, a queued job is dropped, and a running job is abandoned (the worker is replaced when the job
// has already run for a while, so a stale 6 h ride never delays the edit that replaced it).
import type { EffortPreset, PresetSolution } from '../lib/sim';
import type { SimulationInput, SimulationResult } from '../lib/types';
import { runJob, type JobOutput, type SimJob, type SimJobKind, type SimRequest, type SimResponse } from '../workers/protocol';

export class SupersededError extends Error {
  constructor() {
    super('Superseded by a newer request');
    this.name = 'SupersededError';
  }
}

export const isSuperseded = (err: unknown): boolean => err instanceof SupersededError;

/** The part of Worker the client uses (tests pass a fake). */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<SimResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: SimRequest): void;
  terminate(): void;
}

export interface SimClient {
  simulate(input: SimulationInput): Promise<SimulationResult>;
  solvePreset(input: SimulationInput, preset: EffortPreset): Promise<PresetSolution | null>;
  /** 'worker' until a worker fails to start or crashes, then 'main'. */
  readonly mode: 'worker' | 'main';
  dispose(): void;
}

export interface SimClientOptions {
  /** Creates the worker; null or a throwing factory selects the main thread. */
  createWorker: (() => WorkerLike) | null;
  /** A running job superseded after this long is abandoned by replacing the worker, ms. */
  restartAfterMs?: number;
  now?: () => number;
  /** Main-thread fallback scheduler (defaults to a macrotask so callers always get a pending promise). */
  defer?: (fn: () => void) => void;
}

interface Job {
  id: number;
  job: SimJob;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  startedAt: number;
  /** Superseded while running: its response is ignored. */
  abandoned: boolean;
}

export function createSimClient(options: SimClientOptions): SimClient {
  const restartAfter = options.restartAfterMs ?? 250;
  const now = options.now ?? (() => performance.now());
  const defer = options.defer ?? ((fn: () => void) => void setTimeout(fn, 0));
  let mode: 'worker' | 'main' = options.createWorker ? 'worker' : 'main';
  let worker: WorkerLike | null = null;
  let nextId = 1;
  let current: Job | null = null;
  let disposed = false;
  const queue = new Map<SimJobKind, Job>();

  const fallBack = () => {
    mode = 'main';
    worker?.terminate();
    worker = null;
  };

  const settle = (job: Job, response: SimResponse) => {
    if (!response.ok) job.reject(new Error(response.error));
    else job.resolve(response.kind === 'simulate' ? response.result : response.solution);
  };

  function spawn(): WorkerLike | null {
    if (worker || mode === 'main' || !options.createWorker) return worker;
    try {
      const w = options.createWorker();
      w.onmessage = (event) => {
        if (w !== worker) return;
        const job = current;
        if (!job || event.data.id !== job.id) return;
        current = null;
        if (!job.abandoned) settle(job, event.data);
        pump();
      };
      w.onerror = (event) => {
        if (w !== worker) return;
        event.preventDefault?.();
        // A worker that cannot load (or crashes) hands its job and every later one to the main thread.
        const job = current;
        current = null;
        fallBack();
        if (job && !job.abandoned) queue.set(job.job.kind, job);
        pump();
      };
      worker = w;
    } catch {
      fallBack();
    }
    return worker;
  }

  function pump() {
    if (disposed || current) return;
    const next = queue.values().next();
    if (next.done) return;
    const job = next.value;
    queue.delete(job.job.kind);
    current = job;
    job.startedAt = now();
    const w = spawn();
    if (w) {
      w.postMessage({ ...job.job, id: job.id } as SimRequest);
      return;
    }
    defer(() => {
      if (current !== job) return;
      current = null;
      if (!job.abandoned && !disposed) settle(job, runJob({ ...job.job, id: job.id } as SimRequest));
      pump();
    });
  }

  function request<K extends SimJobKind>(job: SimJob & { kind: K }): Promise<JobOutput<K>> {
    return new Promise<JobOutput<K>>((resolve, reject) => {
      if (disposed) {
        reject(new SupersededError());
        return;
      }
      const entry: Job = { id: nextId++, job, resolve: resolve as (v: unknown) => void, reject, startedAt: 0, abandoned: false };
      const queued = queue.get(job.kind);
      if (queued) queued.reject(new SupersededError());
      if (current && current.job.kind === job.kind && !current.abandoned) {
        current.abandoned = true;
        current.reject(new SupersededError());
        if (worker && now() - current.startedAt >= restartAfter) {
          worker.terminate();
          worker = null;
          current = null;
        }
      }
      queue.set(job.kind, entry);
      pump();
    });
  }

  return {
    simulate: (input) => request({ kind: 'simulate', input }),
    solvePreset: (input, preset) => request({ kind: 'preset', input, preset }),
    get mode() {
      return mode;
    },
    dispose() {
      disposed = true;
      for (const job of queue.values()) job.reject(new SupersededError());
      queue.clear();
      if (current && !current.abandoned) current.reject(new SupersededError());
      current = null;
      worker?.terminate();
      worker = null;
    },
  };
}
