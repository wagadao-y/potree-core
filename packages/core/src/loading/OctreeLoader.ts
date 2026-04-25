import {
  cloneBox3,
  createBox3,
  createVec3,
  getBoundingSphereForBox3,
  subtractVec3,
} from "../core/box3-like-utils";
import { decodeOctreeNode } from "./decode-octree-node";
import type {
  LoadOctreeOptions,
  PotreeLoadInstrumentation,
  PotreeLoadMeasurement,
} from "./LoadInstrumentation";
import { OctreeGeometry } from "./OctreeGeometry";
import { OctreeGeometryNode } from "./OctreeGeometryNode";
import {
  createMergedOctreeRanges,
  type MergedOctreeRange,
  OctreeRangeCache,
  type PendingOctreeNode,
  sliceCachedOctreeBuffer,
} from "./octree-range-cache";
import {
  PointAttribute,
  PointAttributes,
  PointAttributeTypes,
} from "./PointAttributes";
import { parseOctreeHierarchy } from "./parse-octree-hierarchy";
import type { RequestManager } from "./RequestManager";
import { WorkerPool } from "./WorkerPool";

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

  private readonly octreeRangeCache: OctreeRangeCache;

  constructor(
    public url: string,
    public workerPool: WorkerPool,
    public metadata: Metadata,
    public requestManager: RequestManager,
  ) {
    this.octreeRangeCache = new OctreeRangeCache(url, requestManager);
  }

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
      const pendingCandidates: PendingOctreeNode<OctreeGeometryNode>[] = [];
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
    parseOctreeHierarchy(node, buffer);
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
    pendingNodes: PendingOctreeNode<OctreeGeometryNode>[],
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
    range: MergedOctreeRange<OctreeGeometryNode>,
    decodeNodes: Set<OctreeGeometryNode>,
  ) {
    const urlOctree = await this.octreeRangeCache.getOctreeUrl();
    const cachedBuffer = await this.octreeRangeCache.readFromOctreeCache(
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
    const fetchedBuffer = await this.octreeRangeCache.fetchOctreeRange(
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
    pendingNode: PendingOctreeNode<OctreeGeometryNode>,
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
    return decodeOctreeNode({
      node,
      buffer,
      encoding: this.metadata.encoding,
      workerPool: this.workerPool,
      emitMeasurement: (measurement) => this.emitMeasurement(measurement),
    });
  }
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
