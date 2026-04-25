import type {
  Box3Like,
  IPointCloudGeometryNode,
  IPointCloudRenderedNode,
  IPointCloudTreeNode,
  IPointCloudVisibilityTarget,
  IVisibilityUpdateResult,
  Vec3Like,
} from "./types";
import {
  enqueueChildVisibilityItems,
  updateVisibility,
  type VisibilityProjection,
  type VisibilityViewport,
} from "./visibility/update-visibility";
import type { PointCloudVisibilityView } from "./visibility/visibility-structures";

const MAX_VISIBLE_RUN_BYTES_WITHOUT_TRIMMING = BigInt(2 * 1024 * 1024);
const MAX_VISIBLE_RUN_SELECTED_SPAN_BYTES = BigInt(2 * 1024 * 1024);
const MAX_VISIBLE_RUN_PREFETCH_BYTES = BigInt(512 * 1024);
const MAX_VISIBLE_RUN_PREFETCH_NODES = 8;

export interface PointCloudVisibilityUpdateInput {
  views: (PointCloudVisibilityView | undefined)[];
  projection: VisibilityProjection;
  viewport: VisibilityViewport;
}

export interface VisibilityNodeCache<
  TNode extends IPointCloudTreeNode = IPointCloudTreeNode,
> {
  pointBudget: number;
  touch(node: TNode): void;
  freeMemory(): void;
}

export interface BatchLoadableGeometryNode<
  TGeometryNode extends IPointCloudGeometryNode = IPointCloudGeometryNode,
> extends IPointCloudGeometryNode {
  load(): Promise<void>;
  octreeGeometry?: {
    loader?: {
      loadBatchWithCandidates?: (
        nodes: TGeometryNode[],
        candidates: TGeometryNode[],
      ) => Promise<void>;
    };
  };
  byteOffset?: bigint;
  byteSize?: bigint;
}

export interface PointCloudVisibilitySchedulerCallbacks<
  TGeometryNode extends BatchLoadableGeometryNode<TGeometryNode>,
  TRenderedNode extends IPointCloudRenderedNode<TGeometryNode>,
  TPointCloud extends IPointCloudVisibilityTarget<TGeometryNode, TRenderedNode>,
  TClipContext,
> {
  resetRenderedVisibility: (pointCloud: TPointCloud) => void;
  prepareClipVisibilityContexts: (
    pointClouds: TPointCloud[],
  ) => (TClipContext | undefined)[];
  shouldClip: (
    pointCloud: TPointCloud,
    boundingBox: Box3Like,
    clipContext: TClipContext | undefined,
  ) => boolean;
  updateTreeNodeVisibility: (
    pointCloud: TPointCloud,
    node: TRenderedNode,
    visibleNodes: IPointCloudTreeNode[],
  ) => void;
  materializeLoadedGeometryNode: (
    pointCloud: TPointCloud,
    geometryNode: TGeometryNode,
    parent: TRenderedNode | null,
  ) => TRenderedNode;
  updateChildVisibility?: (
    queueItem: {
      pointCloudIndex: number;
      weight: number;
      node: IPointCloudTreeNode;
      parent?: IPointCloudTreeNode | null;
    },
    pointCloud: TPointCloud,
    node: IPointCloudTreeNode,
    cameraPosition: Vec3Like,
    projection: VisibilityProjection,
    halfHeight: number,
    densityLODStats: { culledNodes: number; culledPoints: number },
    pushQueueItem: (queueItem: {
      pointCloudIndex: number;
      weight: number;
      node: IPointCloudTreeNode;
      parent?: IPointCloudTreeNode | null;
    }) => void,
  ) => void;
}

export interface PointCloudVisibilitySchedulerOptions<
  TGeometryNode extends BatchLoadableGeometryNode<TGeometryNode>,
  TRenderedNode extends IPointCloudRenderedNode<TGeometryNode>,
  TPointCloud extends IPointCloudVisibilityTarget<TGeometryNode, TRenderedNode>,
  TClipContext,
> {
  lru: VisibilityNodeCache<TGeometryNode>;
  pointBudget: number;
  maxNumNodesLoading: number;
  maxLoadsToGPU: number;
  callbacks: PointCloudVisibilitySchedulerCallbacks<
    TGeometryNode,
    TRenderedNode,
    TPointCloud,
    TClipContext
  >;
}

export class PointCloudVisibilityScheduler<
  TGeometryNode extends BatchLoadableGeometryNode<TGeometryNode>,
  TRenderedNode extends IPointCloudRenderedNode<TGeometryNode>,
  TPointCloud extends IPointCloudVisibilityTarget<TGeometryNode, TRenderedNode>,
  TClipContext,
> {
  public pointBudget: number;

  public maxNumNodesLoading: number;

  public maxLoadsToGPU: number;

  public constructor(
    public readonly lru: VisibilityNodeCache<TGeometryNode>,
    private readonly callbacks: PointCloudVisibilitySchedulerCallbacks<
      TGeometryNode,
      TRenderedNode,
      TPointCloud,
      TClipContext
    >,
    options: Omit<
      PointCloudVisibilitySchedulerOptions<
        TGeometryNode,
        TRenderedNode,
        TPointCloud,
        TClipContext
      >,
      "lru" | "callbacks"
    >,
  ) {
    this.pointBudget = options.pointBudget;
    this.maxNumNodesLoading = options.maxNumNodesLoading;
    this.maxLoadsToGPU = options.maxLoadsToGPU;
    this.lru.pointBudget = options.pointBudget;
  }

  public updatePointCloudVisibility(
    pointClouds: TPointCloud[],
    input: PointCloudVisibilityUpdateInput,
  ): IVisibilityUpdateResult {
    const result = updateVisibility<
      TGeometryNode,
      TRenderedNode,
      TPointCloud,
      TClipContext
    >({
      pointClouds,
      views: input.views,
      projection: input.projection,
      viewport: input.viewport,
      pointBudget: this.pointBudget,
      maxNumNodesLoading: this.maxNumNodesLoading,
      maxLoadsToGPU: this.maxLoadsToGPU,
      callbacks: {
        resetRenderedVisibility: this.callbacks.resetRenderedVisibility,
        prepareClipVisibilityContexts:
          this.callbacks.prepareClipVisibilityContexts,
        shouldClip: this.callbacks.shouldClip,
        updateTreeNodeVisibility: (pointCloud, node, visibleNodes) =>
          this.updateTreeNodeVisibility(pointCloud, node, visibleNodes),
        materializeLoadedGeometryNode:
          this.callbacks.materializeLoadedGeometryNode,
        updateChildVisibility:
          this.callbacks.updateChildVisibility ?? enqueueChildVisibilityItems,
        loadGeometryNodes: (nodes, candidates) =>
          this.loadGeometryNodes(nodes, candidates),
      },
    });

    this.lru.freeMemory();

    return result;
  }

  public setPointBudget(pointBudget: number): void {
    if (pointBudget === this.pointBudget) {
      return;
    }

    this.pointBudget = pointBudget;
    this.lru.pointBudget = pointBudget;
    this.lru.freeMemory();
  }

  private updateTreeNodeVisibility(
    pointCloud: TPointCloud,
    node: TRenderedNode,
    visibleNodes: IPointCloudTreeNode[],
  ): void {
    this.lru.touch(node.geometryNode);
    this.callbacks.updateTreeNodeVisibility(pointCloud, node, visibleNodes);
  }

  private loadGeometryNodes(
    nodes: TGeometryNode[],
    candidates: TGeometryNode[],
  ): Promise<void>[] {
    const nodeLoadPromises: Promise<void>[] = [];
    const nodesByLoader = new Map<
      NonNullable<NonNullable<TGeometryNode["octreeGeometry"]>["loader"]>,
      TGeometryNode[]
    >();
    const candidatesByLoader = new Map<
      NonNullable<NonNullable<TGeometryNode["octreeGeometry"]>["loader"]>,
      TGeometryNode[]
    >();

    for (const candidate of candidates) {
      const loader = candidate.octreeGeometry?.loader;

      if (loader?.loadBatchWithCandidates === undefined) {
        continue;
      }

      const batch = candidatesByLoader.get(loader);

      if (batch === undefined) {
        candidatesByLoader.set(loader, [candidate]);
      } else {
        batch.push(candidate);
      }
    }

    for (const node of nodes) {
      const loader = node.octreeGeometry?.loader;

      if (loader?.loadBatchWithCandidates === undefined) {
        nodeLoadPromises.push(node.load());
        continue;
      }

      const batch = nodesByLoader.get(loader);

      if (batch === undefined) {
        nodesByLoader.set(loader, [node]);
      } else {
        batch.push(node);
      }
    }

    for (const [loader, batch] of nodesByLoader) {
      const loadBatchWithCandidates = loader.loadBatchWithCandidates;
      if (loadBatchWithCandidates === undefined) {
        continue;
      }

      const runCandidates = this.collectVisibleRunCandidates(
        batch,
        candidatesByLoader.get(loader) ?? batch,
      );

      nodeLoadPromises.push(
        loadBatchWithCandidates(runCandidates, runCandidates),
      );
    }

    return nodeLoadPromises;
  }

  private collectVisibleRunCandidates(
    selectedNodes: TGeometryNode[],
    candidates: TGeometryNode[],
  ): TGeometryNode[] {
    const orderedCandidates = candidates.filter(hasByteRange);
    const selectedSet = new Set<(typeof orderedCandidates)[number]>();
    for (const node of selectedNodes) {
      if (hasByteRange(node)) {
        selectedSet.add(node);
      }
    }

    if (orderedCandidates.length === 0 || selectedSet.size === 0) {
      return selectedNodes;
    }

    orderedCandidates.sort((a, b) =>
      a.byteOffset < b.byteOffset ? -1 : a.byteOffset > b.byteOffset ? 1 : 0,
    );

    const selectedOrdered = selectedNodes.filter(hasByteRange);
    const runNodes = new Set<(typeof orderedCandidates)[number]>();
    let run: Array<(typeof orderedCandidates)[number]> = [];
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

    for (const candidate of orderedCandidates) {
      const endExclusive = candidate.byteOffset + candidate.byteSize;
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

    const orderedRunNodes: TGeometryNode[] = [];
    const appended = new Set<TGeometryNode>();

    for (const node of selectedOrdered) {
      if (!runNodes.has(node) || appended.has(node)) {
        continue;
      }

      orderedRunNodes.push(node);
      appended.add(node);
    }

    for (const node of orderedCandidates) {
      if (!runNodes.has(node) || appended.has(node)) {
        continue;
      }

      orderedRunNodes.push(node);
      appended.add(node);
    }

    return orderedRunNodes;
  }
}

type ByteRangedNode = {
  byteOffset: bigint;
  byteSize: bigint;
};

function hasByteRange<
  TGeometryNode extends { byteOffset?: bigint; byteSize?: bigint },
>(node: TGeometryNode): node is TGeometryNode & ByteRangedNode {
  return node.byteOffset !== undefined && node.byteSize !== undefined;
}

function addBoundedVisibleRunNodes<
  TGeometryNode extends { byteOffset: bigint; byteSize: bigint },
>(
  runNodes: Set<TGeometryNode>,
  run: TGeometryNode[],
  selectedSet: Set<TGeometryNode>,
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

      return a.node.byteOffset < b.node.byteOffset ? -1 : 1;
    });

  for (const { node } of prefetchCandidates) {
    if (
      prefetchNodes >= MAX_VISIBLE_RUN_PREFETCH_NODES ||
      prefetchBytes + node.byteSize > MAX_VISIBLE_RUN_PREFETCH_BYTES
    ) {
      continue;
    }

    runNodes.add(node);
    prefetchBytes += node.byteSize;
    prefetchNodes++;
  }
}

function getByteDistanceFromClosestSelected<
  TGeometryNode extends { byteOffset: bigint; byteSize: bigint },
>(node: TGeometryNode, selectedNodes: TGeometryNode[]) {
  const start = node.byteOffset;
  const endExclusive = start + node.byteSize;
  let closestDistance: bigint | null = null;

  for (const selectedNode of selectedNodes) {
    const selectedStart = selectedNode.byteOffset;
    const selectedEndExclusive = selectedStart + selectedNode.byteSize;
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

function getRunByteSize<
  TGeometryNode extends { byteOffset: bigint; byteSize: bigint },
>(run: TGeometryNode[]) {
  if (run.length === 0) {
    return BigInt(0);
  }

  const firstNode = run[0];
  const lastNode = run[run.length - 1];
  return lastNode.byteOffset + lastNode.byteSize - firstNode.byteOffset;
}
