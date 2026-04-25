import { addVec3, getBox3Size } from "../core/box3-like-utils";
import type { DecodedPointAttributes } from "./DecodedPointAttributes";
import type { PotreeLoadMeasurement } from "./LoadInstrumentation";
import type { OctreeGeometryNode } from "./OctreeGeometryNode";
import { type WorkerPool, WorkerType } from "./WorkerPool";
import type {
  DecoderWorkerMessage,
  DecoderWorkerRequest,
} from "./WorkerProtocol";

function getDecoderWorkerType(encoding: string): WorkerType {
  switch (encoding) {
    case "BROTLI":
      return WorkerType.DECODER_WORKER_BROTLI;
    case "ZSTD":
      return WorkerType.DECODER_WORKER_ZSTD;
    default:
      return WorkerType.DECODER_WORKER;
  }
}

interface DecodeOctreeNodeOptions {
  node: OctreeGeometryNode;
  buffer: ArrayBuffer;
  encoding: string;
  workerPool: WorkerPool;
  emitMeasurement: (measurement: PotreeLoadMeasurement) => void;
}

export function decodeOctreeNode({
  node,
  buffer,
  encoding,
  workerPool,
  emitMeasurement,
}: DecodeOctreeNodeOptions) {
  return new Promise<void>((resolve, reject) => {
    const workerType = getDecoderWorkerType(encoding);
    const worker = workerPool.getWorker(workerType);
    const workerQueuedAt = performance.now();
    const nodeByteSize = buffer.byteLength;
    let workerStartedAt: number | null = null;
    let workerReturned = false;

    const returnWorker = () => {
      if (workerReturned) {
        return;
      }

      workerReturned = true;
      workerPool.returnWorker(workerType, worker);
    };

    const fail = (error: unknown) => {
      returnWorker();
      node.loaded = false;
      node.loading = false;
      node.octreeGeometry.numNodesLoading--;
      reject(error);
    };

    worker.onerror = (event) => {
      fail(event.error ?? new Error(event.message));
    };

    worker.onmessage = (e: MessageEvent<DecoderWorkerMessage>) => {
      const data = e.data;

      if (data.type === "started") {
        workerStartedAt = performance.now();
        emitMeasurement({
          stage: "worker-wait",
          nodeName: node.name,
          durationMs: workerStartedAt - workerQueuedAt,
          byteSize: nodeByteSize,
          numPoints: node.numPoints,
        });
        return;
      }

      const buffers = data.attributeBuffers;
      const receivedAt = performance.now();
      const metrics = data.metrics;
      const totalDecodeMs = metrics?.decodeMs ?? metrics?.totalWorkerMs ?? 0;
      const decompressMs = metrics?.decompressMs ?? 0;
      const attributeDecodeMs =
        metrics?.attributeDecodeMs ?? Math.max(0, totalDecodeMs - decompressMs);

      emitMeasurement({
        stage: "decompress",
        nodeName: node.name,
        durationMs: decompressMs,
        byteSize: nodeByteSize,
        numPoints: node.numPoints,
      });

      emitMeasurement({
        stage: "attribute-decode",
        nodeName: node.name,
        durationMs: attributeDecodeMs,
        byteSize: nodeByteSize,
        numPoints: node.numPoints,
        metadata: {
          generatedBufferBytes: metrics?.generatedBufferBytes,
          preciseBufferBytes: metrics?.preciseBufferBytes,
          rawBufferBytes: metrics?.rawBufferBytes,
        },
      });

      const transferBaseline = workerStartedAt ?? workerQueuedAt;
      const transferDuration = Math.max(
        0,
        receivedAt - transferBaseline - (metrics?.totalWorkerMs ?? 0),
      );
      emitMeasurement({
        stage: "worker-transfer",
        nodeName: node.name,
        durationMs: transferDuration,
        byteSize: nodeByteSize,
        numPoints: node.numPoints,
        metadata: {
          transferBufferBytes: metrics?.transferBufferBytes,
        },
      });

      returnWorker();

      node.density = data.density;
      node.decodedPointAttributes = buffers as DecodedPointAttributes;
      node.loaded = true;
      node.loading = false;
      node.octreeGeometry.numNodesLoading--;
      resolve();
    };

    const pointAttributes = node.octreeGeometry.pointAttributes;
    const scale = node.octreeGeometry.scale;

    const box = node.boundingBox;
    const min = addVec3(node.octreeGeometry.offset, box.min);
    const size = getBox3Size(box);
    const max = addVec3(min, size);
    const numPoints = node.numPoints;

    const offset = node.octreeGeometry.loader.offset;

    const message: DecoderWorkerRequest = {
      name: node.name,
      encoding,
      buffer,
      pointAttributes,
      scale,
      min,
      max,
      size,
      offset,
      numPoints,
    };

    worker.postMessage(message, [message.buffer]);
  });
}
