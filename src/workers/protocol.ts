// Messages between the app and the simulation worker, and the one handler both the worker and the main-thread
// fallback run, so a result never depends on where it was computed.
import { simulate, solveEffortPreset, type EffortPreset, type PresetSolution } from '../lib/sim';
import type { SimulationInput, SimulationResult } from '../lib/types';

export type SimJob = { kind: 'simulate'; input: SimulationInput } | { kind: 'preset'; input: SimulationInput; preset: EffortPreset };
export type SimJobKind = SimJob['kind'];

export type SimRequest = SimJob & { id: number };

export type SimResponse =
  | { id: number; ok: true; kind: 'simulate'; result: SimulationResult }
  | { id: number; ok: true; kind: 'preset'; solution: PresetSolution | null }
  | { id: number; ok: false; error: string };

export type JobOutput<K extends SimJobKind> = K extends 'simulate' ? SimulationResult : PresetSolution | null;

export function runJob(request: SimRequest): SimResponse {
  try {
    if (request.kind === 'simulate') return { id: request.id, ok: true, kind: 'simulate', result: simulate(request.input) };
    return { id: request.id, ok: true, kind: 'preset', solution: solveEffortPreset(request.input, request.preset) };
  } catch (err) {
    return { id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Stream buffers of a simulation response, moved (not copied) across the thread boundary. */
export function transferList(response: SimResponse): Transferable[] {
  if (!response.ok || response.kind !== 'simulate') return [];
  const buffers = new Set<ArrayBuffer>();
  for (const stream of Object.values(response.result.streams) as ArrayBufferView[]) {
    if (stream.buffer instanceof ArrayBuffer) buffers.add(stream.buffer);
  }
  return [...buffers];
}
