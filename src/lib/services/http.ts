const NI = (): never => { throw new Error('not implemented'); };

/** fetch with timeout + external abort signal. */
export async function fetchWithTimeout(_url: string, _init?: RequestInit & { timeoutMs?: number }): Promise<Response> { return NI(); }

/** Serialises requests to one host with a minimum interval between starts. */
export class HostQueue {
  constructor(_minIntervalMs: number) {}
  run<T>(_task: () => Promise<T>, _signal?: AbortSignal): Promise<T> { return NI(); }
}
