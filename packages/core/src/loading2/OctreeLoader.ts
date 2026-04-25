import {
  addVec3,
  cloneBox3,
  createBox3,
  createChildBox3,
  createVec3,
  getBoundingSphereForBox3,
  getBox3Size,
  subtractVec3,
} from "../core/box3-like-utils";
import type { Box3Like } from "../core/types";
import type { DecodedPointAttributes } from "./DecodedPointAttributes";
import type {
  LoadOctreeOptions,
  PotreeLoadInstrumentation,
  PotreeLoadMeasurement,
} from "./LoadInstrumentation";
import { OctreeGeometry } from "./OctreeGeometry";
import { OctreeGeometryNode } from "./OctreeGeometryNode";
import {
  PointAttribute,
  PointAttributes,
  PointAttributeTypes,
} from "./PointAttributes";
import type { RequestManager } from "./RequestManager";
import { WorkerPool, WorkerType } from "./WorkerPool";
import type {
  DecoderWorkerMessage,
  DecoderWorkerRequest,
} from "./WorkerProtocol";

const MAX_MERGED_OCTREE_RANGE_BYTES = BigInt(2 * 1024 * 1024);
const MAX_MERGED_OCTREE_RANGE_GAP_BYTES = BigInt(0);
const MAX_OCTREE_RANGE_CACHE_BYTES = 64 * 1024 * 1024;

interface OctreeReadCacheEntry {
  url: string;
  start: bigint;
  endExclusive: bigint;
  buffer?: ArrayBuffer;
  promise?: Promise<ArrayBuffer>;
}

interface PendingOctreeNode {
  node: OctreeGeometryNode;
  byteOffset: bigint;
  byteSize: bigint;
  endExclusive: bigint;
}

interface MergedOctreeRange {
  start: bigint;
  endExclusive: bigint;
  nodes: PendingOctreeNode[];
}

/**
 * NodeLoader is responsible for loading the geometry of octree nodes.
 */
export class NodeLoader {
  /**
   * Point attributes to be used when loading the geometry.
   */
  public attributes?: PointAttributes;

  /**
   * Scale applied to the geometry when loading.
   */
  public scale?: [number, number, number];

  /**
   * Offset applied to the geometry when loading.
   */
  public offset?: [number, number, number];

  public instrumentation?: PotreeLoadInstrumentation;

  private octreeUrlPromise?: Promise<string>;

  private octreeReadCaches: OctreeReadCacheEntry[] = [];

  constructor(
    public url: string,
    public workerPool: WorkerPool,
    public metadata: Metadata,
    public requestManager: RequestManager,
  ) {}

  /**
   * Loads the geometry for a given octree node.
   *
   * @param node - The octree node to load.
   */
  async load(node: OctreeGeometryNode) {
    await this.loadBatch([node]);
  }

  async loadBatch(nodes: OctreeGeometryNode[]) {
    await this.loadBatchWithCandidates(nodes, nodes);
  }

  async loadBatchWithCandidates(
    nodes: OctreeGeometryNode[],
    candidates: OctreeGeometryNode[],
  ) {
    const loadableNodes: OctreeGeometryNode[] = [];

    for (const node of nodes) {
      if (
        !node.loaded &&
        !node.loading &&
        !node.octreeGeometry.disposed &&
        node.octreeGeometry.numNodesLoading <
          node.octreeGeometry.maxNumNodesLoading
      ) {
        node.loading = true;
        node.octreeGeometry.numNodesLoading++;
        loadableNodes.push(node);
      }
    }

    if (loadableNodes.length === 0) {
      return;
    }

    try {
      await Promise.all(
        loadableNodes.map((node) =>
          node.nodeType === 2 ? this.loadHierarchy(node) : Promise.resolve(),
        ),
      );

      const zeroByteLoads: Array<Promise<void>> = [];
      const pendingCandidates: PendingOctreeNode[] = [];
      const decodeNodes = new Set(loadableNodes);

      for (const node of candidates) {
        const { byteOffset, byteSize } = node;

        if (byteOffset === undefined || byteSize === undefined) {
          if (!decodeNodes.has(node)) {
            continue;
          }
          throw new Error("byteOffset and byteSize are required");
        }

        if (byteSize === BigInt(0)) {
          if (!decodeNodes.has(node)) {
            continue;
          }
          console.warn(`loaded node with 0 bytes: ${node.name}`);
          zeroByteLoads.push(this.decodeNode(node, new ArrayBuffer(0)));
          continue;
        }

        pendingCandidates.push({
          node,
          byteOffset,
          byteSize,
          endExclusive: byteOffset + byteSize,
        });
      }

      await Promise.all([
        ...zeroByteLoads,
        ...this.loadMergedOctreeRanges(pendingCandidates, decodeNodes),
      ]);
    } catch (error) {
      for (const node of loadableNodes) {
        if (!node.loading) {
          continue;
        }

        node.loaded = false;
        node.loading = false;
        node.octreeGeometry.numNodesLoading--;
      }
      throw error;
    }
  }

  public parseHierarchy(node: OctreeGeometryNode, buffer: ArrayBuffer) {
    const view = new DataView(buffer);
    const bytesPerNode = 22;
    const numNodes = buffer.byteLength / bytesPerNode;
    const octree = node.octreeGeometry;

    // let nodes = [node];
    const nodes: OctreeGeometryNode[] = new Array(numNodes);
    nodes[0] = node;
    let nodePos = 1;

    for (let i = 0; i < numNodes; i++) {
      const current = nodes[i];

      const type = view.getUint8(i * bytesPerNode + 0);
      const childMask = view.getUint8(i * bytesPerNode + 1);
      const numPoints = view.getUint32(i * bytesPerNode + 2, true);
      const byteOffset = view.getBigInt64(i * bytesPerNode + 6, true);
      const byteSize = view.getBigInt64(i * bytesPerNode + 14, true);

      if (current.nodeType === 2) {
        // replace proxy with real node
        current.byteOffset = byteOffset;
        current.byteSize = byteSize;
        current.numPoints = numPoints;
      } else if (type === 2) {
        // load proxy
        current.hierarchyByteOffset = byteOffset;
        current.hierarchyByteSize = byteSize;
        current.numPoints = numPoints;
      } else {
        // load real node
        current.byteOffset = byteOffset;
        current.byteSize = byteSize;
        current.numPoints = numPoints;
      }

      current.nodeType = type;

      if (current.nodeType === 2) {
        continue;
      }

      for (let childIndex = 0; childIndex < 8; childIndex++) {
        const childExists = ((1 << childIndex) & childMask) !== 0;

        if (!childExists) {
          continue;
        }

        const childName = current.name + childIndex;

        const childAABB = createChildAABB(current.boundingBox, childIndex);
        const child = new OctreeGeometryNode(childName, octree, childAABB);
        child.name = childName;
        child.spacing = current.spacing / 2;
        child.level = current.level + 1;

        (current.children as any)[childIndex] = child;
        child.parent = current;

        // nodes.push(child);
        nodes[nodePos] = child;
        nodePos++;
      }

      // if((i % 500) === 0){
      // 	yield;
      // }
    }
  }

  async loadHierarchy(node: OctreeGeometryNode) {
    const { hierarchyByteOffset, hierarchyByteSize } = node;

    if (hierarchyByteOffset === undefined || hierarchyByteSize === undefined) {
      throw new Error(
        `hierarchyByteOffset and hierarchyByteSize are undefined for node ${node.name}`,
      );
    }

    const hierarchyPath = (await this.requestManager.getUrl(this.url)).replace(
      "/metadata.json",
      "/hierarchy.bin",
    );

    const first = hierarchyByteOffset;
    const last = first + hierarchyByteSize - BigInt(1);

    const hierarchyLoadStartedAt = performance.now();
    const response = await this.requestManager.fetch(hierarchyPath, {
      headers: {
        "content-type": "multipart/byteranges",
        Range: `bytes=${first}-${last}`,
      },
    });

    const buffer = await response.arrayBuffer();
    this.emitMeasurement({
      stage: "hierarchy-load",
      nodeName: node.name,
      durationMs: performance.now() - hierarchyLoadStartedAt,
      byteSize: buffer.byteLength,
      numPoints: node.numPoints,
    });

    const hierarchyParseStartedAt = performance.now();
    this.parseHierarchy(node, buffer);
    this.emitMeasurement({
      stage: "hierarchy-parse",
      nodeName: node.name,
      durationMs: performance.now() - hierarchyParseStartedAt,
      byteSize: buffer.byteLength,
      numPoints: node.numPoints,
    });
  }

  private emitMeasurement(measurement: PotreeLoadMeasurement) {
    this.instrumentation?.onStage?.(measurement);
  }

  private loadMergedOctreeRanges(
    pendingNodes: PendingOctreeNode[],
    decodeNodes: Set<OctreeGeometryNode>,
  ) {
    const ranges = createMergedOctreeRanges(pendingNodes).filter((range) =>
      range.nodes.some((pendingNode) => decodeNodes.has(pendingNode.node)),
    );
    return ranges.map((range) =>
      this.loadMergedOctreeRange(range, decodeNodes),
    );
  }

  private async loadMergedOctreeRange(
    range: MergedOctreeRange,
    decodeNodes: Set<OctreeGeometryNode>,
  ) {
    const urlOctree = await this.getOctreeUrl();
    const cachedBuffer = await this.readFromOctreeCache(
      urlOctree,
      range.start,
      range.endExclusive,
    );

    if (cachedBuffer !== null) {
      const decodePendingNodes = range.nodes.filter((pendingNode) =>
        decodeNodes.has(pendingNode.node),
      );
      return await Promise.all(
        decodePendingNodes.map((pendingNode) => {
          const buffer = sliceCachedOctreeBuffer(
            cachedBuffer,
            range.start,
            pendingNode.byteOffset,
            pendingNode.endExclusive,
          );
          this.emitOctreeReadMeasurement(
            pendingNode,
            0,
            0,
            range.nodes.length,
            true,
          );
          return this.decodeNode(pendingNode.node, buffer);
        }),
      ).then(() => undefined);
    }

    const readStartedAt = performance.now();
    const fetchedBuffer = await this.fetchOctreeRange(
      urlOctree,
      range.start,
      range.endExclusive,
    );
    const readDurationMs = performance.now() - readStartedAt;
    const decodePendingNodes = range.nodes.filter((pendingNode) =>
      decodeNodes.has(pendingNode.node),
    );

    return await Promise.all(
      decodePendingNodes.map((pendingNode, index) => {
        const buffer = sliceCachedOctreeBuffer(
          fetchedBuffer,
          range.start,
          pendingNode.byteOffset,
          pendingNode.endExclusive,
        );
        this.emitOctreeReadMeasurement(
          pendingNode,
          index === 0 ? readDurationMs : 0,
          index === 0 ? fetchedBuffer.byteLength : 0,
          range.nodes.length,
          index !== 0,
        );
        return this.decodeNode(pendingNode.node, buffer);
      }),
    ).then(() => undefined);
  }

  private emitOctreeReadMeasurement(
    pendingNode: PendingOctreeNode,
    durationMs: number,
    fetchedByteSize: number,
    mergedNodeCount: number,
    cacheHit: boolean,
  ) {
    this.emitMeasurement({
      stage: "octree-slice-read",
      nodeName: pendingNode.node.name,
      durationMs,
      byteSize: Number(pendingNode.byteSize),
      numPoints: pendingNode.node.numPoints,
      metadata: {
        cacheHit,
        fetchedByteSize,
        mergedNodeCount,
      },
    });
  }

  private decodeNode(node: OctreeGeometryNode, buffer: ArrayBuffer) {
    return new Promise<void>((resolve, reject) => {
      const workerType = getDecoderWorkerType(this.metadata.encoding);
      const worker = this.workerPool.getWorker(workerType);
      const workerQueuedAt = performance.now();
      const nodeByteSize = buffer.byteLength;
      let workerStartedAt: number | null = null;
      let workerReturned = false;

      const returnWorker = () => {
        if (workerReturned) {
          return;
        }

        workerReturned = true;
        this.workerPool.returnWorker(workerType, worker);
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
          this.emitMeasurement({
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
          metrics?.attributeDecodeMs ??
          Math.max(0, totalDecodeMs - decompressMs);

        this.emitMeasurement({
          stage: "decompress",
          nodeName: node.name,
          durationMs: decompressMs,
          byteSize: nodeByteSize,
          numPoints: node.numPoints,
        });

        this.emitMeasurement({
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
        this.emitMeasurement({
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
        encoding: this.metadata.encoding,
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

  private async getOctreeUrl() {
    this.octreeUrlPromise ??= this.requestManager
      .getUrl(this.url)
      .then((url) => url.replace("/metadata.json", "/octree.bin"));

    return this.octreeUrlPromise;
  }

  private async readFromOctreeCache(
    url: string,
    start: bigint,
    endExclusive: bigint,
  ) {
    const cache = this.octreeReadCaches.find((entry) => {
      return (
        entry.url === url &&
        start >= entry.start &&
        endExclusive <= entry.endExclusive
      );
    });

    if (cache === undefined) {
      return null;
    }

    let buffer = cache.buffer;

    if (buffer === undefined) {
      try {
        buffer = await cache.promise;
      } catch (error) {
        this.octreeReadCaches = this.octreeReadCaches.filter(
          (entry) => entry !== cache,
        );
        throw error;
      }
    }

    if (buffer === undefined) {
      return null;
    }

    cache.buffer = buffer;
    cache.endExclusive = cache.start + BigInt(buffer.byteLength);

    if (endExclusive > cache.endExclusive) {
      return null;
    }

    return sliceCachedOctreeBuffer(buffer, cache.start, start, endExclusive);
  }

  private async fetchOctreeRange(
    urlOctree: string,
    start: bigint,
    endExclusive: bigint,
  ) {
    const fetchPromise = this.requestManager
      .fetch(urlOctree, {
        headers: {
          "content-type": "multipart/byteranges",
          Range: `bytes=${start}-${endExclusive - BigInt(1)}`,
        },
      })
      .then((response) => response.arrayBuffer());

    const cache: OctreeReadCacheEntry = {
      url: urlOctree,
      start,
      endExclusive,
      promise: fetchPromise,
    };
    this.octreeReadCaches.push(cache);

    try {
      const buffer = await fetchPromise;
      cache.buffer = buffer;
      cache.endExclusive = start + BigInt(buffer.byteLength);
      this.pruneOctreeReadCaches();
      return buffer;
    } catch (error) {
      this.octreeReadCaches = this.octreeReadCaches.filter(
        (entry) => entry !== cache,
      );
      throw error;
    }
  }

  private pruneOctreeReadCaches() {
    let totalBytes = this.octreeReadCaches.reduce(
      (total, cache) => total + (cache.buffer?.byteLength ?? 0),
      0,
    );

    while (
      totalBytes > MAX_OCTREE_RANGE_CACHE_BYTES &&
      this.octreeReadCaches.length > 1
    ) {
      const cache = this.octreeReadCaches.shift();
      totalBytes -= cache?.buffer?.byteLength ?? 0;
    }
  }
}

function sliceCachedOctreeBuffer(
  buffer: ArrayBuffer,
  cacheStart: bigint,
  start: bigint,
  endExclusive: bigint,
) {
  const sliceStart = Number(start - cacheStart);
  const sliceEnd = Number(endExclusive - cacheStart);
  return buffer.slice(sliceStart, sliceEnd);
}

function createMergedOctreeRanges(
  pendingNodes: PendingOctreeNode[],
): MergedOctreeRange[] {
  const sortedNodes = [...pendingNodes].sort((a, b) =>
    compareBigInts(a.byteOffset, b.byteOffset),
  );
  const ranges: MergedOctreeRange[] = [];

  for (const pendingNode of sortedNodes) {
    const nodeRangeSize = pendingNode.byteSize;
    const currentRange = ranges.at(-1);

    if (
      currentRange === undefined ||
      nodeRangeSize > MAX_MERGED_OCTREE_RANGE_BYTES
    ) {
      ranges.push({
        start: pendingNode.byteOffset,
        endExclusive: pendingNode.endExclusive,
        nodes: [pendingNode],
      });
      continue;
    }

    const gap =
      pendingNode.byteOffset > currentRange.endExclusive
        ? pendingNode.byteOffset - currentRange.endExclusive
        : BigInt(0);
    const mergedEndExclusive =
      pendingNode.endExclusive > currentRange.endExclusive
        ? pendingNode.endExclusive
        : currentRange.endExclusive;
    const mergedByteSize = mergedEndExclusive - currentRange.start;

    if (
      gap <= MAX_MERGED_OCTREE_RANGE_GAP_BYTES &&
      mergedByteSize <= MAX_MERGED_OCTREE_RANGE_BYTES
    ) {
      currentRange.endExclusive = mergedEndExclusive;
      currentRange.nodes.push(pendingNode);
      continue;
    }

    ranges.push({
      start: pendingNode.byteOffset,
      endExclusive: pendingNode.endExclusive,
      nodes: [pendingNode],
    });
  }

  return ranges;
}

function compareBigInts(a: bigint, b: bigint) {
  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
}

/**
 * Creates a child AABB from the given parent AABB based on the specified index.
 *
 * @param aabb - The parent AABB from which to create the child AABB.
 * @param index - The index of the child AABB to create, which determines its position relative to the parent AABB.
 * @returns The newly created child AABB.
 */
function createChildAABB(aabb: Box3Like, index: number) {
  return createChildBox3(aabb, index);
}

const typenameTypeattributeMap = {
  double: PointAttributeTypes.DATA_TYPE_DOUBLE,
  float: PointAttributeTypes.DATA_TYPE_FLOAT,
  int8: PointAttributeTypes.DATA_TYPE_INT8,
  uint8: PointAttributeTypes.DATA_TYPE_UINT8,
  int16: PointAttributeTypes.DATA_TYPE_INT16,
  uint16: PointAttributeTypes.DATA_TYPE_UINT16,
  int32: PointAttributeTypes.DATA_TYPE_INT32,
  uint32: PointAttributeTypes.DATA_TYPE_UINT32,
  int64: PointAttributeTypes.DATA_TYPE_INT64,
  uint64: PointAttributeTypes.DATA_TYPE_UINT64,
};

type AttributeType = keyof typeof typenameTypeattributeMap;

/**
 * Attribute interface defines the structure of an attribute in the octree geometry.
 */
export interface Attribute {
  name: string;
  description: string;
  size: number;
  numElements: number;
  type: AttributeType;
  min: number[];
  max: number[];
}

/**
 * Metadata interface defines the structure of the metadata for an octree geometry.
 */
export interface Metadata {
  version: string;
  name: string;
  description: string;
  points: number;
  projection: string;
  hierarchy: {
    firstChunkSize: number;
    stepSize: number;
    depth: number;
  };
  offset: [number, number, number];
  scale: [number, number, number];
  spacing: number;
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
  };
  encoding: string;
  attributes: Attribute[];
}

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

/**
 * OctreeLoader is responsible for loading octree geometries from a given URL.
 */
export class OctreeLoader {
  /**
   * WorkerPool instance used for managing workers for loading tasks.
   */
  public workerPool: WorkerPool = new WorkerPool();

  /**
   * Parses the attributes from a JSON array and converts them into PointAttributes.
   *
   * @param jsonAttributes Array of attributes in JSON format.
   * @returns A PointAttributes instance containing the parsed attributes.
   */
  public static parseAttributes(jsonAttributes: Attribute[]): PointAttributes {
    const attributes = new PointAttributes();

    // Replacements object for string to string
    const replacements: { [key: string]: string } = { rgb: "rgba" };

    for (const jsonAttribute of jsonAttributes) {
      const { name, numElements, min, max } = jsonAttribute;

      const type = typenameTypeattributeMap[jsonAttribute.type]; // Fix the typing, currently jsonAttribute has type 'never'

      const potreeAttributeName = replacements[name]
        ? replacements[name]
        : name;

      const attribute = new PointAttribute(
        potreeAttributeName,
        type,
        numElements,
      );

      if (numElements === 1) {
        attribute.range = [min[0], max[0]];
      } else {
        attribute.range = [min, max];
      }

      if (name === "gps-time") {
        // HACK: Guard against bad gpsTime range in metadata, see potree/potree#909
        if (
          typeof attribute.range[0] === "number" &&
          attribute.range[0] === attribute.range[1]
        ) {
          attribute.range[1] += 1;
        }
      }

      attribute.initialRange = attribute.range;

      attributes.add(attribute);
    }

    {
      // check if it has normals
      const hasNormals =
        attributes.attributes.find((a) => {
          return a.name === "NormalX";
        }) !== undefined &&
        attributes.attributes.find((a) => {
          return a.name === "NormalY";
        }) !== undefined &&
        attributes.attributes.find((a) => {
          return a.name === "NormalZ";
        }) !== undefined;

      if (hasNormals) {
        const vector = {
          name: "NORMAL",
          attributes: ["NormalX", "NormalY", "NormalZ"],
        };
        attributes.addVector(vector);
      }
    }

    return attributes;
  }

  /**
   * Loads an octree geometry from a given URL using the provided RequestManager.
   *
   * @param url - The URL from which to load the octree geometry metadata.
   * @param requestManager - The RequestManager instance used to handle HTTP requests.
   * @returns Geometry object containing the loaded octree geometry.
   */
  public async load(
    url: string,
    requestManager: RequestManager,
    options?: LoadOctreeOptions,
  ) {
    const response = await requestManager.fetch(
      await requestManager.getUrl(url),
    );
    const metadata: Metadata = await response.json();

    const attributes = OctreeLoader.parseAttributes(metadata.attributes);

    const loader = new NodeLoader(
      url,
      this.workerPool,
      metadata,
      requestManager,
    );
    loader.attributes = attributes;
    loader.scale = metadata.scale;
    loader.offset = metadata.offset;
    loader.instrumentation = options?.instrumentation;

    const octree = new OctreeGeometry(
      loader,
      createBox3(
        createVec3(...metadata.boundingBox.min),
        createVec3(...metadata.boundingBox.max),
      ),
    );
    octree.url = await requestManager.getUrl(url);
    octree.spacing = metadata.spacing;
    octree.scale = metadata.scale;

    const min = createVec3(...metadata.boundingBox.min);
    const max = createVec3(...metadata.boundingBox.max);
    const offset = createVec3(min.x, min.y, min.z);
    const boundingBox = createBox3(
      subtractVec3(min, offset),
      subtractVec3(max, offset),
    );

    octree.projection = metadata.projection;
    octree.boundingBox = boundingBox;
    octree.tightBoundingBox = cloneBox3(boundingBox);
    octree.boundingSphere = getBoundingSphereForBox3(boundingBox);
    octree.tightBoundingSphere = getBoundingSphereForBox3(boundingBox);
    octree.offset = offset;
    octree.pointAttributes = OctreeLoader.parseAttributes(metadata.attributes);
    octree.instrumentation = options?.instrumentation;

    const root = new OctreeGeometryNode("r", octree, boundingBox);
    root.level = 0;
    root.nodeType = 2;
    root.hierarchyByteOffset = BigInt(0);
    root.hierarchyByteSize = BigInt(metadata.hierarchy.firstChunkSize);
    root.spacing = octree.spacing;
    root.byteOffset = BigInt(0); // Originally 0

    octree.root = root;

    loader.load(root);

    const result = { geometry: octree };

    return result;
  }
}
