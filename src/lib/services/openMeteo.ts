// One request queue per Open-Meteo host, shared by the elevation fallback and the weather service.
import { HostQueue } from './http';

/** Minimum interval between request starts to one Open-Meteo host, ms. */
export const OPEN_METEO_INTERVAL_MS = 150;

const queues = new Map<string, HostQueue>();

/** The queue for the host of `url` (api, historical-forecast-api, archive-api …), created on first use. */
export function openMeteoQueue(url: string): HostQueue {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    host = url;
  }
  let queue = queues.get(host);
  if (!queue) {
    queue = new HostQueue(OPEN_METEO_INTERVAL_MS);
    queues.set(host, queue);
  }
  return queue;
}
