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
import { loadMergedOctreeRanges } from "./load-merged-octree-range";
import { loadOctreeHierarchy } from "./load-octree-hierarchy";
import { OctreeGeometry } from "./OctreeGeometry";
import { OctreeGeometryNode } from "./OctreeGeometryNode";
import { OctreeRangeCache } from "./octree-range-cache";
import {
  PointAttribute,
  PointAttributes,
  PointAttributeTypes,
} from "./PointAttributes";
import {
  markLoadableOctreeNodes,
  planOctreeLoadBatch,
} from "./plan-octree-load-batch";
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
    const loadableNodes = markLoadableOctreeNodes(nodes);

    if (loadableNodes.length === 0) {
      return;
    }

    try {
      await Promise.all(
        loadableNodes.map((node) =>
          node.nodeType === 2 ? this.loadHierarchy(node) : Promise.resolve(),
        ),
      );

      const { zeroByteNodes, pendingNodes, decodeNodes } = planOctreeLoadBatch(
        loadableNodes,
        candidates,
      );

      const zeroByteLoads = zeroByteNodes.map((node) => {
        console.warn(`loaded node with 0 bytes: ${node.name}`);
        return this.decodeNode(node, new ArrayBuffer(0));
      });

      await Promise.all([
        ...zeroByteLoads,
        ...loadMergedOctreeRanges({
          pendingNodes,
          decodeNodes,
          octreeRangeCache: this.octreeRangeCache,
          emitMeasurement: (measurement) => this.emitMeasurement(measurement),
          decodeNode: (node, buffer) => this.decodeNode(node, buffer),
        }),
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
    await loadOctreeHierarchy({
      url: this.url,
      node,
      requestManager: this.requestManager,
      emitMeasurement: (measurement) => this.emitMeasurement(measurement),
    });
  }

  private emitMeasurement(measurement: PotreeLoadMeasurement) {
    this.instrumentation?.onStage?.(measurement);
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
