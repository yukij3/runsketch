// Dedicated worker: simulate() and effort-preset solving off the main thread.
import { runJob, transferList, type SimRequest } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<SimRequest>) => {
  const response = runJob(event.data);
  scope.postMessage(response, transferList(response));
};
