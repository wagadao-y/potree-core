import { PointAttribute, PointAttributeTypes } from "./PointAttributes";
import type {
  DecoderWorkerMessage,
  DecoderWorkerRequest,
  DecoderWorkerResultMessage,
} from "./WorkerProtocol";

type WorkerScope = typeof globalThis & {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

const workerScope = globalThis as WorkerScope;

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

workerScope.onmessage = function (event) {
  const request = event.data as DecoderWorkerRequest;
  const {
    buffer,
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

  const attributeDecodeStartedAt = performance.now();
  const view = new DataView(buffer);

  const attributeBuffers = {};
  let attributeOffset = 0;

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
  for (const pointAttribute of pointAttributes.attributes) {
    if (["POSITION_CARTESIAN", "position"].includes(pointAttribute.name)) {
      const buff = new ArrayBuffer(numPoints * 4 * 3);
      const positions = new Float32Array(buff);

      for (let j = 0; j < numPoints; j++) {
        const pointOffset = j * bytesPerPoint;

        const x =
          view.getInt32(pointOffset + attributeOffset + 0, true) * scale[0] +
          offset[0] -
          min.x;
        const y =
          view.getInt32(pointOffset + attributeOffset + 4, true) * scale[1] +
          offset[1] -
          min.y;
        const z =
          view.getInt32(pointOffset + attributeOffset + 8, true) * scale[2] +
          offset[2] -
          min.z;

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
        const pointOffset = j * bytesPerPoint;

        const r = view.getUint16(pointOffset + attributeOffset + 0, true);
        const g = view.getUint16(pointOffset + attributeOffset + 2, true);
        const b = view.getUint16(pointOffset + attributeOffset + 4, true);

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
        const pointOffset = j * bytesPerPoint;
        const value = getter(pointOffset + attributeOffset, true);

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

    attributeOffset += pointAttribute.byteSize;
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

  const message: DecoderWorkerResultMessage = {
    type: "result",
    attributeBuffers,
    density: occupancy,
    metrics: {
      decodeMs: totalWorkerMs,
      decompressMs: 0,
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
  message.metrics.rawBufferBytes = buffer.byteLength;
  message.metrics.generatedBufferBytes = generatedBufferBytes;
  message.metrics.transferBufferBytes = transferBufferBytes;
  message.metrics.preciseBufferBytes = preciseBufferBytes;

  workerScope.postMessage(message satisfies DecoderWorkerMessage, transferables);
};