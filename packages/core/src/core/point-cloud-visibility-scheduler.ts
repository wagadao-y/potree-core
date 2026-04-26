import type {
  Box3Like,
  IPointCloudGeometryNode,
  IPointCloudRenderedNode,
  IPointCloudTreeNode,
  IPointCloudVisibilityTarget,
  IVisibilityUpdateResult,
  Vec3Like,
} from "./types";
import { groupGeometryLoads } from "./visibility/group-geometry-loads";
import {
  enqueueChildVisibilityItems,
  updateVisibility,
  type VisibilityProjection,
  type VisibilityViewport,
} from "./visibility/update-visibility";
import type { PointCloudVisibilityView } from "./visibility/visibility-structures";

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
    return groupGeometryLoads(nodes, candidates);
  }
}
