import { describe, expect, it } from 'vitest';
import { defaultAthlete, defaultSession, flatProfile, simulate } from '../lib/sim';
import type { SimulationInput } from '../lib/types';
import { runJob, transferList, type SimRequest, type SimResponse } from '../workers/protocol';
import { createSimClient, isSuperseded, type WorkerLike } from './simClient';

const input = (seed: number): SimulationInput => ({
  profile: flatProfile(1500),
  athlete: defaultAthlete(),
  session: { ...defaultSession('run', 0), seed },
});

/** Manual worker: requests pile up until the test answers them. */
class FakeWorker implements WorkerLike {
  static all: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<SimResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  received: SimRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(message: SimRequest) {
    this.received.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  answer(index = this.received.length - 1) {
    this.onmessage?.({ data: runJob(this.received[index]) } as MessageEvent<SimResponse>);
  }
  fail() {
    this.onerror?.({ preventDefault() {} } as ErrorEvent);
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('simulation client', () => {
  it('computes the same result through the worker protocol as on the main thread, with stream buffers transferred', () => {
    const response = runJob({ id: 1, kind: 'simulate', input: input(5) });
    expect(response.ok).toBe(true);
    if (!response.ok || response.kind !== 'simulate') return;
    expect(Array.from(response.result.streams.hr)).toEqual(Array.from(simulate(input(5)).streams.hr));
    expect(transferList(response)).toHaveLength(13);
    expect(transferList(response)).toContain(response.result.streams.temperature.buffer);
    expect(Math.max(...response.result.streams.temperature)).toBeGreaterThan(0);
    expect(transferList({ id: 2, ok: false, error: 'x' })).toEqual([]);
  });

  it('latest request wins: queued and running jobs of the same kind are superseded', async () => {
    FakeWorker.all = [];
    let clock = 0;
    const client = createSimClient({ createWorker: () => new FakeWorker(), now: () => clock });
    const outcomes: string[] = [];
    const track = (name: string, p: Promise<unknown>) =>
      p.then(
        () => outcomes.push(`${name}:ok`),
        (err) => outcomes.push(`${name}:${isSuperseded(err) ? 'superseded' : 'error'}`),
      );
    const a = track('a', client.simulate(input(1)));
    const b = track('b', client.simulate(input(2)));
    const c = track('c', client.simulate(input(3)));
    const worker = FakeWorker.all[0];
    expect(worker.received.map((r) => r.id)).toEqual([1]);
    await settle();
    expect(outcomes).toEqual(['a:superseded', 'b:superseded']);
    // The abandoned job finishes quickly, so the worker is kept and the latest job runs next.
    worker.answer(0);
    expect(worker.received.map((r) => r.id)).toEqual([1, 3]);
    worker.answer(1);
    await Promise.all([a, b, c]);
    expect(outcomes).toEqual(['a:superseded', 'b:superseded', 'c:ok']);
    expect(FakeWorker.all).toHaveLength(1);

    // A long-running superseded job is abandoned by replacing the worker.
    const d = track('d', client.simulate(input(4)));
    clock += 1000;
    const e = track('e', client.simulate(input(5)));
    expect(worker.terminated).toBe(true);
    expect(FakeWorker.all).toHaveLength(2);
    FakeWorker.all[1].answer();
    await Promise.all([d, e]);
    expect(outcomes.slice(3)).toEqual(['d:superseded', 'e:ok']);
    client.dispose();
  });

  it('keeps preset and simulation jobs apart', async () => {
    FakeWorker.all = [];
    const client = createSimClient({ createWorker: () => new FakeWorker() });
    const preset = client.solvePreset(input(1), 'steady');
    const sim = client.simulate(input(1));
    const worker = FakeWorker.all[0];
    worker.answer(0);
    worker.answer(1);
    expect((await preset)?.preset).toBe('steady');
    expect((await sim).streams.t.length).toBeGreaterThan(0);
    client.dispose();
  });

  it('falls back to the main thread when the worker cannot be constructed or fails to load', async () => {
    const broken = createSimClient({
      createWorker: () => {
        throw new Error('no workers here');
      },
    });
    const result = await broken.simulate(input(9));
    expect(broken.mode).toBe('main');
    expect(result.summary.distance).toBeGreaterThan(1400);

    FakeWorker.all = [];
    const crashing = createSimClient({ createWorker: () => new FakeWorker() });
    const pending = crashing.simulate(input(9));
    FakeWorker.all[0].fail();
    expect(crashing.mode).toBe('main');
    expect((await pending).summary.distance).toBeGreaterThan(1400);
    expect(FakeWorker.all).toHaveLength(1);
  });
});
