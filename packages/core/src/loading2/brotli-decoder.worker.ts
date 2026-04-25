import brotliPromise from "brotli-dec-wasm";
import { ZSTDDecoder } from "zstddec";
import { PointAttribute, PointAttributeTypes } from "./PointAttributes";
import type {
  DecoderWorkerMessage,
  DecoderWorkerRequest,
  DecoderWorkerResultMessage,
} from "./WorkerProtocol";

type WorkerScope = typeof globalThis & {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent) => void | Promise<void>) | null;
};

const workerScope = globalThis as WorkerScope;

const zstdDecoder = new ZSTDDecoder();
let zstdDecoderInitPromise: Promise<void> | undefined;

function initZstdDecoder() {
  zstdDecoderInitPromise ??= zstdDecoder.init();
  return zstdDecoderInitPromise;
}

const typedArrayMapping = {
  int8: Int8Array,
  int16: Int16Array,
  int32: Int32Array,
  int64: Float64Array,
  uint8: Uint8Array,
  uint16: Uint16Array,
  uint32: Uint32Array,
  uint64: Float64Array,
  float: Float32Array,
  double: Float64Array,
};

function dealign24b(mortoncode: number) {
  let x = mortoncode;

  x =
    ((x & 0b001000001000001000001000) >> 2) |
    ((x & 0b000001000001000001000001) >> 0);
  x =
    ((x & 0b000011000000000011000000) >> 4) |
    ((x & 0b000000000011000000000011) >> 0);
  x =
    ((x & 0b000000001111000000000000) >> 8) |
    ((x & 0b000000000000000000001111) >> 0);
  x =
    ((x & 0b000000000000000000000000) >> 16) |
    ((x & 0b000000000000000011111111) >> 0);

  return x;
}

const mask_b0 = new Uint8Array([
  0, 1, 0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3, 2, 3, 0, 1, 0, 1, 0, 1, 0, 1, 2, 3,
  2, 3, 2, 3, 2, 3, 0, 1, 0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3, 2, 3, 0, 1, 0, 1,
  0, 1, 0, 1, 2, 3, 2, 3, 2, 3, 2, 3, 0, 1, 0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3,
  2, 3, 0, 1, 0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3, 2, 3, 0, 1, 0, 1, 0, 1, 0, 1,
  2, 3, 2, 3, 2, 3, 2, 3, 0, 1, 0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3, 2, 3, 0, 1,
  0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3, 2, 3, 0, 1, 0, 1, 0, 1, 0, 1, 2, 3, 2, 3,
  2, 3, 2, 3, 0, 1, 0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3, 2, 3, 0, 1, 0, 1, 0, 1,
  0, 1, 2, 3, 2, 3, 2, 3, 2, 3, 0, 1, 0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3, 2, 3,
  0, 1, 0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3, 2, 3, 0, 1, 0, 1, 0, 1, 0, 1, 2, 3,
  2, 3, 2, 3, 2, 3, 0, 1, 0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3, 2, 3,
]);

void mask_b0;

workerScope.onmessage = async function (event) {
  const request = event.data as DecoderWorkerRequest;
  const {
    encoding,
    pointAttributes,
    scale,
    name,
    min,
    size,
    offset,
    numPoints,
  } = request;

  const tStart = performance.now();

  workerScope.postMessage({
    type: "started",
    name,
  });

  let buffer;
  let decompressMs = 0;
  if (numPoints == 0 || request.buffer.byteLength === 0) {
    buffer = { buffer: new ArrayBuffer(0) };
  } else {
    try {
      const decompressStartedAt = performance.now();
      const compressed = new Uint8Array(request.buffer);
      let decoded;

      if (encoding === "ZSTD") {
        await initZstdDecoder();
        decoded = zstdDecoder.decode(compressed);
      } else {
        const brotli = await brotliPromise;
        decoded = brotli.decompress(compressed);
      }

      buffer = {
        buffer:
          decoded.byteOffset === 0 &&
          decoded.byteLength === decoded.buffer.byteLength
            ? decoded.buffer
            : decoded.slice().buffer,
      };
      decompressMs = performance.now() - decompressStartedAt;
    } catch (e) {
      buffer = {
        buffer: new ArrayBuffer(numPoints * (pointAttributes.byteSize + 12)),
      };
      console.error(`problem with node ${name}: `, e);
    }
  }

  const attributeDecodeStartedAt = performance.now();
  const view = new DataView(buffer.buffer);

  const attributeBuffers = {};

  let bytesPerPoint = 0;
  for (const pointAttribute of pointAttributes.attributes) {
    bytesPerPoint += pointAttribute.byteSize;
  }

  const gridSize = 32;
  const grid = new Uint32Array(gridSize ** 3);
  const toIndex = (x, y, z) => {
    const dx = (gridSize * x) / size.x;
    const dy = (gridSize * y) / size.y;
    const dz = (gridSize * z) / size.z;

    const ix = Math.min(Math.floor(dx), gridSize - 1);
    const iy = Math.min(Math.floor(dy), gridSize - 1);
    const iz = Math.min(Math.floor(dz), gridSize - 1);

    return ix + iy * gridSize + iz * gridSize * gridSize;
  };

  let numOccupiedCells = 0;
  let byteOffset = 0;
  for (const pointAttribute of pointAttributes.attributes) {
    if (["POSITION_CARTESIAN", "position"].includes(pointAttribute.name)) {
      const buff = new ArrayBuffer(numPoints * 4 * 3);
      const positions = new Float32Array(buff);

      for (let j = 0; j < numPoints; j++) {
        const mc_0 = view.getUint32(byteOffset + 4, true);
        const mc_1 = view.getUint32(byteOffset + 0, true);
        const mc_2 = view.getUint32(byteOffset + 12, true);
        const mc_3 = view.getUint32(byteOffset + 8, true);

        byteOffset += 16;

        let X =
          dealign24b((mc_3 & 0x00ffffff) >>> 0) |
          (dealign24b(((mc_3 >>> 24) | (mc_2 << 8)) >>> 0) << 8);

        let Y =
          dealign24b((mc_3 & 0x00ffffff) >>> 1) |
          (dealign24b(((mc_3 >>> 24) | (mc_2 << 8)) >>> 1) << 8);

        let Z =
          dealign24b((mc_3 & 0x00ffffff) >>> 2) |
          (dealign24b(((mc_3 >>> 24) | (mc_2 << 8)) >>> 2) << 8);

        if (mc_1 != 0 || mc_2 != 0) {
          X =
            X |
            (dealign24b((mc_1 & 0x00ffffff) >>> 0) << 16) |
            (dealign24b(((mc_1 >>> 24) | (mc_0 << 8)) >>> 0) << 24);

          Y =
            Y |
            (dealign24b((mc_1 & 0x00ffffff) >>> 1) << 16) |
            (dealign24b(((mc_1 >>> 24) | (mc_0 << 8)) >>> 1) << 24);

          Z =
            Z |
            (dealign24b((mc_1 & 0x00ffffff) >>> 2) << 16) |
            (dealign24b(((mc_1 >>> 24) | (mc_0 << 8)) >>> 2) << 24);
        }

        const x = X * scale[0] + offset[0] - min.x;
        const y = Y * scale[1] + offset[1] - min.y;
        const z = Z * scale[2] + offset[2] - min.z;

        const index = toIndex(x, y, z);
        const count = grid[index]++;
        if (count === 0) {
          numOccupiedCells++;
        }

        positions[3 * j + 0] = x;
        positions[3 * j + 1] = y;
        positions[3 * j + 2] = z;
      }

      attributeBuffers[pointAttribute.name] = {
        buffer: buff,
        attribute: pointAttribute,
      };
    } else if (["RGBA", "rgba"].includes(pointAttribute.name)) {
      const buff = new ArrayBuffer(numPoints * 4);
      const colors = new Uint8Array(buff);

      for (let j = 0; j < numPoints; j++) {
        const mc_0 = view.getUint32(byteOffset + 4, true);
        const mc_1 = view.getUint32(byteOffset + 0, true);
        byteOffset += 8;

        const r =
          dealign24b((mc_1 & 0x00ffffff) >>> 0) |
          (dealign24b(((mc_1 >>> 24) | (mc_0 << 8)) >>> 0) << 8);

        const g =
          dealign24b((mc_1 & 0x00ffffff) >>> 1) |
          (dealign24b(((mc_1 >>> 24) | (mc_0 << 8)) >>> 1) << 8);

        const b =
          dealign24b((mc_1 & 0x00ffffff) >>> 2) |
          (dealign24b(((mc_1 >>> 24) | (mc_0 << 8)) >>> 2) << 8);

        colors[4 * j + 0] = r > 255 ? r / 256 : r;
        colors[4 * j + 1] = g > 255 ? g / 256 : g;
        colors[4 * j + 2] = b > 255 ? b / 256 : b;
      }

      attributeBuffers[pointAttribute.name] = {
        buffer: buff,
        attribute: pointAttribute,
      };
    } else {
      const buff = new ArrayBuffer(numPoints * 4);
      const f32 = new Float32Array(buff);

      const TypedArray = typedArrayMapping[pointAttribute.type.name];
      const preciseBuffer = new TypedArray(numPoints);

      let [attributeOffsetBase, attributeScale] = [0, 1];

      const getterMap = {
        int8: view.getInt8,
        int16: view.getInt16,
        int32: view.getInt32,
        uint8: view.getUint8,
        uint16: view.getUint16,
        uint32: view.getUint32,
        float: view.getFloat32,
        double: view.getFloat64,
      };
      const getter = getterMap[pointAttribute.type.name].bind(view);

      if (pointAttribute.type.size > 4) {
        const [amin, amax] = pointAttribute.range;
        if (typeof amin === "number" && typeof amax === "number") {
          attributeOffsetBase = amin;
          attributeScale = 1 / (amax - amin);
        }
      }

      for (let j = 0; j < numPoints; j++) {
        const value = getter(byteOffset, true);
        byteOffset += pointAttribute.byteSize;

        f32[j] = (value - attributeOffsetBase) * attributeScale;
        preciseBuffer[j] = value;
      }

      attributeBuffers[pointAttribute.name] = {
        buffer: buff,
        preciseBuffer,
        attribute: pointAttribute,
        offset: attributeOffsetBase,
        scale: attributeScale,
      };
    }
  }

  const occupancy = Math.floor(numPoints / numOccupiedCells);

  {
    const vectors = pointAttributes.vectors;

    for (const vector of vectors) {
      const { name, attributes } = vector;
      const numVectorElements = attributes.length;
      const buffer = new ArrayBuffer(numVectorElements * numPoints * 4);
      const f32 = new Float32Array(buffer);

      let iElement = 0;
      for (const sourceName of attributes) {
        const sourceBuffer = attributeBuffers[sourceName];
        const { offset, scale } = sourceBuffer;
        const view = new DataView(sourceBuffer.buffer);

        const getter = view.getFloat32.bind(view);

        for (let j = 0; j < numPoints; j++) {
          const value = getter(j * 4, true);

          f32[j * numVectorElements + iElement] = value / scale + offset;
        }

        iElement++;
      }

      const vecAttribute = new PointAttribute(
        name,
        PointAttributeTypes.DATA_TYPE_FLOAT,
        3,
      );

      attributeBuffers[name] = {
        buffer,
        attribute: vecAttribute,
      };
    }
  }

  const attributeDecodeMs = performance.now() - attributeDecodeStartedAt;
  const totalWorkerMs = performance.now() - tStart;
  const pointsPerMs = numPoints / totalWorkerMs;
  void pointsPerMs;

  const message: DecoderWorkerResultMessage = {
    type: "result",
    attributeBuffers,
    density: occupancy,
    metrics: {
      decodeMs: totalWorkerMs,
      decompressMs,
      attributeDecodeMs,
      totalWorkerMs,
      rawBufferBytes: 0,
      generatedBufferBytes: 0,
      transferBufferBytes: 0,
      preciseBufferBytes: 0,
    },
  };

  const transferables = [];
  for (const property in message.attributeBuffers) {
    transferables.push(message.attributeBuffers[property].buffer);
  }
  let generatedBufferBytes = 0;
  let transferBufferBytes = 0;
  let preciseBufferBytes = 0;
  for (const property in message.attributeBuffers) {
    const attributeBuffer = message.attributeBuffers[property];
    generatedBufferBytes += attributeBuffer.buffer?.byteLength ?? 0;
    transferBufferBytes += attributeBuffer.buffer?.byteLength ?? 0;
    preciseBufferBytes += attributeBuffer.preciseBuffer?.byteLength ?? 0;
  }
  message.metrics.rawBufferBytes = buffer.buffer.byteLength;
  message.metrics.generatedBufferBytes = generatedBufferBytes;
  message.metrics.transferBufferBytes = transferBufferBytes;
  message.metrics.preciseBufferBytes = preciseBufferBytes;

  workerScope.postMessage(message satisfies DecoderWorkerMessage, transferables);
};