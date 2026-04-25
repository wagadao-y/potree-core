import { handleMessage } from "./binary-decoder-worker-internal";

type WorkerScope = typeof globalThis & {
  onmessage: ((event: MessageEvent) => void) | null;
};

const workerScope = globalThis as WorkerScope;

workerScope.onmessage = handleMessage;