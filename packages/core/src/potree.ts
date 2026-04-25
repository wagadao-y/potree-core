import {
  type Camera,
  type Ray,
  Vector2,
  type WebGLRenderer,
} from "three";
import {
  DEFAULT_POINT_BUDGET,
  DEFAULT_MAX_LOADS_TO_GPU,
  DEFAULT_MAX_NUM_NODES_LOADING,
} from "./constants";
import {
  QueueItem,
} from "./core/visibility/visibility-structures";
import {
  enqueueChildVisibilityItems,
  type VisibilityProjection,
  updateVisibility,
} from "./core/visibility/update-visibility";
import { getFeatures } from "./features";
import type { LoadOctreeOptions } from "./loading2/LoadInstrumentation";
import { loadOctree } from "./loading2/load-octree";
import type { OctreeGeometry } from "./loading2/OctreeGeometry";
import { OctreeGeometryNode } from "./loading2/OctreeGeometryNode";
import type { RequestManager } from "./loading2/RequestManager";
import type { PointCloudMaterial } from "./materials";
import { PointCloudOctree } from "./point-cloud-octree";
import type { PointCloudOctreeGeometryNode } from "./point-cloud-octree-geometry-node";
import type { PointCloudOctreeNode } from "./point-cloud-octree-node";
import {
  type PickParams,
  PointCloudOctreePicker,
} from "./point-cloud-octree-picker";
import type { IPointCloudTreeNode, IVisibilityUpdateResult } from "./core/types";
import type { IPotree, PickPoint } from "./renderer-three/types";
import {
  PointCloudClipVisibilityEvaluator,
  createPointCloudVisibilityViews,
  createVisibilityProjection,
  materializePointCloudOctreeNode,
  resetPointCloudOctreeRenderedVisibility,
  updatePointCloudAfterVisibility,
  updatePointCloudOctreeNodeVisibility,
  type ClipVisibilityContext,
} from "./renderer-three/point-cloud-octree-renderer";
import { LRU } from "./utils/lru";

const MAX_VISIBLE_RUN_BYTES_WITHOUT_TRIMMING = BigInt(2 * 1024 * 1024);
const MAX_VISIBLE_RUN_SELECTED_SPAN_BYTES = BigInt(2 * 1024 * 1024);
const MAX_VISIBLE_RUN_PREFETCH_BYTES = BigInt(512 * 1024);
const MAX_VISIBLE_RUN_PREFETCH_NODES = 8;

export class Potree implements IPotree {
  public static picker: PointCloudOctreePicker | undefined;

  public _pointBudget: number = DEFAULT_POINT_BUDGET;

  public _rendererSize: Vector2 = new Vector2();

  private readonly clipVisibility = new PointCloudClipVisibilityEvaluator();

  public maxNumNodesLoading: number = DEFAULT_MAX_NUM_NODES_LOADING;

  public maxLoadsToGPU: number = DEFAULT_MAX_LOADS_TO_GPU;

  public get features() {
    return getFeatures();
  }

  public lru = new LRU(this._pointBudget);

  public async loadPointCloud(
    url: string,
    baseUrl: string,
    options?: LoadOctreeOptions,
  ): Promise<PointCloudOctree>;
  public async loadPointCloud(
    url: string,
    requestManager: RequestManager,
    options?: LoadOctreeOptions,
  ): Promise<PointCloudOctree>;
  public async loadPointCloud(
    url: string,
    reqManager: string | RequestManager,
    materialOrOptions?: PointCloudMaterial | LoadOctreeOptions,
  ): Promise<PointCloudOctree> {
    const material =
      materialOrOptions instanceof Object &&
      "instrumentation" in materialOrOptions
        ? undefined
        : (materialOrOptions as PointCloudMaterial | undefined);
    const options =
      materialOrOptions instanceof Object &&
      "instrumentation" in materialOrOptions
        ? materialOrOptions
        : undefined;

    if (typeof reqManager === "string") {
      // Handle baseUrl case
      const baseUrl = reqManager;

      const requestManager: RequestManager = {
        getUrl: async (relativeUrl) => `${baseUrl}${relativeUrl}`,
        fetch: async (input, init) => fetch(input, init),
      };
      return this.loadPointCloud(url, requestManager, options);
    } else {
      // Handle RequestManager case
      const requestManager = reqManager;

      if (url.endsWith("metadata.json")) {
        return await loadOctree(url, requestManager, options).then(
          (geometry: OctreeGeometry) => {
            return new PointCloudOctree(this, geometry, material);
          },
        );
      }

      throw new Error("Unsupported file type. Use metadata.json.");
    }
  }

  public updatePointClouds(
    pointClouds: PointCloudOctree[],
    camera: Camera,
    renderer: WebGLRenderer,
  ): IVisibilityUpdateResult {
    const result = this.updateVisibility(pointClouds, camera, renderer);

    for (let i = 0; i < pointClouds.length; i++) {
      const pointCloud = pointClouds[i];
      if (pointCloud.disposed) {
        continue;
      }

      updatePointCloudAfterVisibility(pointCloud, camera, renderer);
    }

    this.lru.freeMemory();

    return result;
  }

  public static pick(
    pointClouds: PointCloudOctree[],
    renderer: WebGLRenderer,
    camera: Camera,
    ray: Ray,
    params: Partial<PickParams> = {},
  ): PickPoint | null {
    Potree.picker = Potree.picker || new PointCloudOctreePicker();
    return Potree.picker.pick(renderer, camera, ray, pointClouds, params);
  }

  public get pointBudget(): number {
    return this._pointBudget;
  }

  public set pointBudget(value: number) {
    if (value !== this._pointBudget) {
      this._pointBudget = value;
      this.lru.pointBudget = value;
      this.lru.freeMemory();
    }
  }

  private updateVisibility(
    pointClouds: PointCloudOctree[],
    camera: Camera,
    renderer: WebGLRenderer,
  ): IVisibilityUpdateResult {
    const rendererSize = renderer.getSize(this._rendererSize);
    const visibilityViews = createPointCloudVisibilityViews(pointClouds, camera);
    const projection = createVisibilityProjection(camera);

    return updateVisibility<
      PointCloudOctreeGeometryNode,
      PointCloudOctreeNode,
      PointCloudOctree,
      ClipVisibilityContext
    >({
      pointClouds,
      views: visibilityViews,
      projection,
      viewport: {
        height: rendererSize.height,
        pixelRatio: renderer.getPixelRatio(),
      },
      pointBudget: this.pointBudget,
      maxNumNodesLoading: this.maxNumNodesLoading,
      maxLoadsToGPU: this.maxLoadsToGPU,
      callbacks: {
        resetRenderedVisibility: (pointCloud) =>
          resetPointCloudOctreeRenderedVisibility(pointCloud),
        prepareClipVisibilityContexts: (targetPointClouds) =>
          this.clipVisibility.prepare(targetPointClouds),
        shouldClip: (pointCloud, boundingBox, clipContext) =>
          this.clipVisibility.shouldClip(
            pointCloud,
            boundingBox,
            clipContext,
          ),
        updateTreeNodeVisibility: (pointCloud, node, visibleNodes) =>
          this.updateTreeNodeVisibility(pointCloud, node, visibleNodes),
        materializeLoadedGeometryNode: (pointCloud, geometryNode, parent) =>
          this.materializeLoadedGeometryNode(
            pointCloud,
            geometryNode,
            parent,
          ),
        updateChildVisibility: (
          queueItem,
          pointCloud,
          node,
          cameraPosition,
          targetProjection,
          halfHeight,
          densityLODStats,
          pushQueueItem,
        ) =>
          this.updateChildVisibility(
            queueItem,
            pointCloud,
            node,
            cameraPosition,
            targetProjection,
            halfHeight,
            densityLODStats,
            pushQueueItem,
          ),
        loadGeometryNodes: (nodes, candidates) =>
          this.loadGeometryNodes(nodes, candidates),
      },
    });
  }

  private materializeLoadedGeometryNode(
    pointCloud: PointCloudOctree,
    geometryNode: PointCloudOctreeGeometryNode,
    parent: PointCloudOctreeNode | null,
  ): PointCloudOctreeNode {
    return materializePointCloudOctreeNode(pointCloud, geometryNode, parent);
  }

  private loadGeometryNodes(
    nodes: PointCloudOctreeGeometryNode[],
    candidates: PointCloudOctreeGeometryNode[],
  ): Promise<void>[] {
    const nodeLoadPromises: Promise<void>[] = [];
    type BatchLoader = {
      loadBatchWithCandidates: (
        nodes: PointCloudOctreeGeometryNode[],
        candidates: PointCloudOctreeGeometryNode[],
      ) => Promise<void>;
    };
    const loading2NodesByLoader = new Map<
      BatchLoader,
      PointCloudOctreeGeometryNode[]
    >();
    const loading2CandidatesByLoader = new Map<
      BatchLoader,
      PointCloudOctreeGeometryNode[]
    >();

    for (const candidate of candidates) {
      const anyCandidate = candidate as PointCloudOctreeGeometryNode & {
        octreeGeometry?: {
          loader?: {
            loadBatchWithCandidates?: (
              nodes: PointCloudOctreeGeometryNode[],
              candidates: PointCloudOctreeGeometryNode[],
            ) => Promise<void>;
          };
        };
      };
      const loader = anyCandidate.octreeGeometry?.loader;

      if (loader?.loadBatchWithCandidates === undefined) {
        continue;
      }

      const batchLoader = loader as BatchLoader;
      const batch = loading2CandidatesByLoader.get(batchLoader);

      if (batch === undefined) {
        loading2CandidatesByLoader.set(batchLoader, [candidate]);
      } else {
        batch.push(candidate);
      }
    }

    for (const node of nodes) {
      const anyNode = node as PointCloudOctreeGeometryNode & {
        octreeGeometry?: {
          loader?: {
            loadBatchWithCandidates?: (
              nodes: PointCloudOctreeGeometryNode[],
              candidates: PointCloudOctreeGeometryNode[],
            ) => Promise<void>;
          };
        };
      };
      const loader = anyNode.octreeGeometry?.loader;

      if (loader?.loadBatchWithCandidates !== undefined) {
        const batchLoader = loader as BatchLoader;
        const batch = loading2NodesByLoader.get(batchLoader);

        if (batch === undefined) {
          loading2NodesByLoader.set(batchLoader, [node]);
        } else {
          batch.push(node);
        }
        continue;
      }

      nodeLoadPromises.push(node.load());
    }

    for (const [loader, batch] of loading2NodesByLoader) {
      const runCandidates = this.collectVisibleRunCandidates(
        batch,
        loading2CandidatesByLoader.get(loader) ?? batch,
      );
      nodeLoadPromises.push(
        loader.loadBatchWithCandidates(
          runCandidates,
          runCandidates,
        ),
      );
    }

    return nodeLoadPromises;
  }

  private collectVisibleRunCandidates(
    selectedNodes: PointCloudOctreeGeometryNode[],
    candidates: PointCloudOctreeGeometryNode[],
  ): PointCloudOctreeGeometryNode[] {
    const loading2Candidates: OctreeGeometryNode[] = [];
    for (const candidate of candidates) {
      if (
        candidate instanceof OctreeGeometryNode &&
        candidate.byteOffset !== undefined &&
        candidate.byteSize !== undefined
      ) {
        loading2Candidates.push(candidate);
      }
    }
    const selectedSet = new Set<OctreeGeometryNode>();
    for (const node of selectedNodes) {
      if (
        node instanceof OctreeGeometryNode &&
        node.byteOffset !== undefined &&
        node.byteSize !== undefined
      ) {
        selectedSet.add(node);
      }
    }

    if (loading2Candidates.length === 0 || selectedSet.size === 0) {
      return selectedNodes;
    }

    loading2Candidates.sort((a, b) =>
      a.byteOffset! < b.byteOffset! ? -1 : a.byteOffset! > b.byteOffset! ? 1 : 0,
    );

    const selectedOrdered: OctreeGeometryNode[] = [];
    for (const node of selectedNodes) {
      if (
        node instanceof OctreeGeometryNode &&
        node.byteOffset !== undefined &&
        node.byteSize !== undefined
      ) {
        selectedOrdered.push(node);
      }
    }

    const runNodes = new Set<OctreeGeometryNode>();
    let run: OctreeGeometryNode[] = [];
    let runContainsSelected = false;
    let previousEndExclusive: bigint | null = null;

    const flushRun = () => {
      if (!runContainsSelected) {
        run = [];
        runContainsSelected = false;
        previousEndExclusive = null;
        return;
      }

      addBoundedVisibleRunNodes(runNodes, run, selectedSet);

      run = [];
      runContainsSelected = false;
      previousEndExclusive = null;
    };

    for (const candidate of loading2Candidates) {
      const endExclusive = candidate.byteOffset! + candidate.byteSize!;
      const contiguous =
        previousEndExclusive !== null &&
        candidate.byteOffset === previousEndExclusive;

      if (!contiguous && run.length > 0) {
        flushRun();
      }

      run.push(candidate);
      runContainsSelected ||= selectedSet.has(candidate);
      previousEndExclusive = endExclusive;
    }

    flushRun();

    const orderedRunNodes: OctreeGeometryNode[] = [];
    const appended = new Set<OctreeGeometryNode>();

    for (const node of selectedOrdered) {
      if (!runNodes.has(node) || appended.has(node)) {
        continue;
      }
      orderedRunNodes.push(node);
      appended.add(node);
    }

    for (const node of loading2Candidates) {
      if (!runNodes.has(node) || appended.has(node)) {
        continue;
      }
      orderedRunNodes.push(node);
      appended.add(node);
    }

    return orderedRunNodes as unknown as PointCloudOctreeGeometryNode[];
  }

  private updateTreeNodeVisibility(
    pointCloud: PointCloudOctree,
    node: PointCloudOctreeNode,
    visibleNodes: IPointCloudTreeNode[],
  ): void {
    this.lru.touch(node.geometryNode);
    updatePointCloudOctreeNodeVisibility(pointCloud, node, visibleNodes);
  }

  private updateChildVisibility(
    queueItem: QueueItem,
    pointCloud: PointCloudOctree,
    node: IPointCloudTreeNode,
    cameraPosition: import("three").Vector3,
    projection: VisibilityProjection,
    halfHeight: number,
    densityLODStats: { culledNodes: number; culledPoints: number },
    pushQueueItem: (queueItem: QueueItem) => void,
  ): void {
    enqueueChildVisibilityItems(
      queueItem,
      pointCloud,
      node,
      cameraPosition,
      projection,
      halfHeight,
      densityLODStats,
      pushQueueItem,
    );
  }

}

function addBoundedVisibleRunNodes(
  runNodes: Set<OctreeGeometryNode>,
  run: OctreeGeometryNode[],
  selectedSet: Set<OctreeGeometryNode>,
) {
  const runByteSize = getRunByteSize(run);
  if (runByteSize <= MAX_VISIBLE_RUN_BYTES_WITHOUT_TRIMMING) {
    for (const node of run) {
      runNodes.add(node);
    }
    return;
  }

  const selectedIndices = run.flatMap((node, index) =>
    selectedSet.has(node) ? [index] : [],
  );
  const selectedNodes = selectedIndices.map((index) => run[index]);
  if (selectedNodes.length === 0) {
    return;
  }

  const selectedSpanStart = selectedIndices[0];
  const selectedSpanEnd = selectedIndices[selectedIndices.length - 1];
  const selectedSpanByteSize = getRunByteSize(
    run.slice(selectedSpanStart, selectedSpanEnd + 1),
  );

  if (selectedSpanByteSize <= MAX_VISIBLE_RUN_SELECTED_SPAN_BYTES) {
    for (let i = selectedSpanStart; i <= selectedSpanEnd; i++) {
      runNodes.add(run[i]);
    }
    return;
  }

  for (const node of selectedNodes) {
    runNodes.add(node);
  }

  let prefetchBytes = BigInt(0);
  let prefetchNodes = 0;
  const prefetchCandidates = run
    .filter((node) => !selectedSet.has(node))
    .map((node) => ({
      node,
      distanceFromSelected: getByteDistanceFromClosestSelected(
        node,
        selectedNodes,
      ),
    }))
    .sort((a, b) => {
      if (a.distanceFromSelected !== b.distanceFromSelected) {
        return a.distanceFromSelected < b.distanceFromSelected ? -1 : 1;
      }

      return a.node.byteOffset! < b.node.byteOffset! ? -1 : 1;
    });

  for (const { node } of prefetchCandidates) {
    const byteSize = node.byteSize!;
    if (
      prefetchNodes >= MAX_VISIBLE_RUN_PREFETCH_NODES ||
      prefetchBytes + byteSize > MAX_VISIBLE_RUN_PREFETCH_BYTES
    ) {
      continue;
    }

    runNodes.add(node);
    prefetchBytes += byteSize;
    prefetchNodes++;
  }
}

function getByteDistanceFromClosestSelected(
  node: OctreeGeometryNode,
  selectedNodes: OctreeGeometryNode[],
) {
  const start = node.byteOffset!;
  const endExclusive = start + node.byteSize!;
  let closestDistance: bigint | null = null;

  for (const selectedNode of selectedNodes) {
    const selectedStart = selectedNode.byteOffset!;
    const selectedEndExclusive = selectedStart + selectedNode.byteSize!;
    let distance: bigint;

    if (endExclusive <= selectedStart) {
      distance = selectedStart - endExclusive;
    } else if (start >= selectedEndExclusive) {
      distance = start - selectedEndExclusive;
    } else {
      distance = BigInt(0);
    }

    if (closestDistance === null || distance < closestDistance) {
      closestDistance = distance;
    }
  }

  return closestDistance ?? BigInt(0);
}

function getRunByteSize(run: OctreeGeometryNode[]) {
  if (run.length === 0) {
    return BigInt(0);
  }

  const firstNode = run[0];
  const lastNode = run[run.length - 1];
  return lastNode.byteOffset! + lastNode.byteSize! - firstNode.byteOffset!;
}
