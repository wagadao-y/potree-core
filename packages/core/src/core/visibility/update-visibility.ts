import type {
  Box3Like,
  IPointCloudGeometryNode,
  IPointCloudRenderedNode,
  IPointCloudTreeNode,
  IVisibilityUpdateResult,
  Vec3Like,
} from "../types";
import {
  type PointCloudVisibilityView,
  QueueItem,
  updateVisibilityStructures,
  type VisibilityPointCloudTarget,
} from "./visibility-structures";

export type VisibilityProjection =
  | {
      type: "perspective";
      fovRadians: number;
    }
  | {
      type: "orthographic";
      verticalSpan: number;
      zoom: number;
    };

export interface UpdateVisibilityCallbacks<
  TGeometryNode extends IPointCloudGeometryNode,
  TRenderedNode extends IPointCloudRenderedNode<TGeometryNode>,
  TPointCloud extends VisibilityPointCloudTarget<TGeometryNode, TRenderedNode>,
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
  updateChildVisibility: (
    queueItem: QueueItem,
    pointCloud: TPointCloud,
    node: IPointCloudTreeNode,
    cameraPosition: Vec3Like,
    projection: VisibilityProjection,
    halfHeight: number,
    densityLODStats: { culledNodes: number; culledPoints: number },
    pushQueueItem: (queueItem: QueueItem) => void,
  ) => void;
  loadGeometryNodes: (
    nodes: TGeometryNode[],
    candidates: TGeometryNode[],
  ) => Promise<void>[];
}

export interface VisibilityViewport {
  height: number;
  pixelRatio: number;
}

export interface UpdateVisibilityOptions<
  TGeometryNode extends IPointCloudGeometryNode,
  TRenderedNode extends IPointCloudRenderedNode<TGeometryNode>,
  TPointCloud extends VisibilityPointCloudTarget<TGeometryNode, TRenderedNode>,
  TClipContext,
> {
  pointClouds: TPointCloud[];
  views: (PointCloudVisibilityView | undefined)[];
  projection: VisibilityProjection;
  viewport: VisibilityViewport;
  pointBudget: number;
  maxNumNodesLoading: number;
  maxLoadsToGPU: number;
  callbacks: UpdateVisibilityCallbacks<
    TGeometryNode,
    TRenderedNode,
    TPointCloud,
    TClipContext
  >;
}

export function updateVisibility<
  TGeometryNode extends IPointCloudGeometryNode,
  TRenderedNode extends IPointCloudRenderedNode<TGeometryNode>,
  TPointCloud extends VisibilityPointCloudTarget<TGeometryNode, TRenderedNode>,
  TClipContext,
>(
  options: UpdateVisibilityOptions<
    TGeometryNode,
    TRenderedNode,
    TPointCloud,
    TClipContext
  >,
): IVisibilityUpdateResult {
  let numVisiblePoints = 0;

  const visibleNodes: TRenderedNode[] = [];
  const unloadedGeometry: TGeometryNode[] = [];
  const densityLODStats = {
    culledNodes: 0,
    culledPoints: 0,
  };

  const { views, priorityQueue } =
    updateVisibilityStructures(options.pointClouds, options.views, {
      resetRenderedVisibility: options.callbacks.resetRenderedVisibility,
    });

  const halfHeight =
    0.5 * options.viewport.height * options.viewport.pixelRatio;
  const clipContexts = options.callbacks.prepareClipVisibilityContexts(
    options.pointClouds,
  );

  let loadedToGPUThisFrame = 0;
  let exceededMaxLoadsToGPU = false;
  let nodeLoadFailed = false;
  while (priorityQueue.size() > 0) {
    const queueItem = priorityQueue.pop();
    if (queueItem === undefined) {
      continue;
    }

    let node = queueItem.node;

    if (numVisiblePoints + node.numPoints > options.pointBudget) {
      break;
    }

    const pointCloudIndex = queueItem.pointCloudIndex;
    const pointCloud = options.pointClouds[pointCloudIndex];
    const view = views[pointCloudIndex];

    if (view === undefined) {
      continue;
    }

    const maxLevel =
      pointCloud.maxLevel !== undefined ? pointCloud.maxLevel : Infinity;

    if (
      node.level > maxLevel ||
      !view.intersectsBox(node.boundingBox) ||
      options.callbacks.shouldClip(
        pointCloud,
        node.boundingBox,
        clipContexts[pointCloudIndex],
      )
    ) {
      continue;
    }

    numVisiblePoints += node.numPoints;
    pointCloud.numVisiblePoints += node.numPoints;

    const parentNode = queueItem.parent;
    const treeParent =
      parentNode && isRenderedNode<TGeometryNode, TRenderedNode>(parentNode)
        ? parentNode
        : null;

    if (
      isGeometryNode<TGeometryNode>(node) &&
      node.numPoints > 0 &&
      (!parentNode || treeParent)
    ) {
      if (node.loaded && loadedToGPUThisFrame < options.maxLoadsToGPU) {
        node = options.callbacks.materializeLoadedGeometryNode(
          pointCloud,
          node,
          treeParent,
        );
        loadedToGPUThisFrame += 1;
      } else if (!node.failed) {
        if (node.loaded && loadedToGPUThisFrame >= options.maxLoadsToGPU) {
          exceededMaxLoadsToGPU = true;
        }
        unloadedGeometry.push(node);
        pointCloud.visibleGeometry.push(node);
      } else {
        nodeLoadFailed = true;
        continue;
      }
    }

    if (isRenderedNode<TGeometryNode, TRenderedNode>(node)) {
      options.callbacks.updateTreeNodeVisibility(
        pointCloud,
        node,
        visibleNodes,
      );
      pointCloud.visibleGeometry.push(node.geometryNode);
    }

    options.callbacks.updateChildVisibility(
      queueItem,
      pointCloud,
      node,
      view.cameraPosition,
      options.projection,
      halfHeight,
      densityLODStats,
      (nextQueueItem) => {
        priorityQueue.push(nextQueueItem);
      },
    );
  }

  const numNodesToLoad = Math.min(
    options.maxNumNodesLoading,
    unloadedGeometry.length,
  );
  const nodeLoadPromises = options.callbacks.loadGeometryNodes(
    unloadedGeometry.slice(0, numNodesToLoad),
    unloadedGeometry,
  );

  return {
    visibleNodes,
    numVisiblePoints,
    densityCulledNodes: densityLODStats.culledNodes,
    densityCulledPoints: densityLODStats.culledPoints,
    exceededMaxLoadsToGPU,
    nodeLoadFailed,
    nodeLoadPromises,
  };
}

function isGeometryNode<TGeometryNode extends IPointCloudGeometryNode>(
  node: IPointCloudTreeNode | undefined | null,
): node is TGeometryNode {
  return node?.isGeometryNode === true;
}

function isRenderedNode<
  TGeometryNode extends IPointCloudGeometryNode,
  TRenderedNode extends IPointCloudRenderedNode<TGeometryNode>,
>(node: IPointCloudTreeNode | undefined | null): node is TRenderedNode {
  return node?.isTreeNode === true;
}

export function enqueueChildVisibilityItems(
  queueItem: QueueItem,
  pointCloud: VisibilityPointCloudTarget,
  node: IPointCloudTreeNode,
  cameraPosition: Vec3Like,
  projection: VisibilityProjection,
  halfHeight: number,
  densityLODStats: { culledNodes: number; culledPoints: number },
  pushQueueItem: (queueItem: QueueItem) => void,
): void {
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child === null) {
      continue;
    }

    const sphere = child.boundingSphere;
    const distance = distanceTo(sphere.center, cameraPosition);
    const radius = sphere.radius;

    let projectionFactor = 0.0;
    let weight: number;
    let screenPixelRadius: number;

    if (projection.type === "perspective") {
      const slope = Math.tan(projection.fovRadians / 2.0);
      projectionFactor = halfHeight / (slope * distance);
      screenPixelRadius = radius * projectionFactor;
      weight =
        distance < radius
          ? Number.MAX_VALUE
          : screenPixelRadius + 1 / distance;
    } else {
      projectionFactor =
        ((2 * halfHeight) / projection.verticalSpan) * projection.zoom;
      screenPixelRadius = radius * projectionFactor;
      weight = screenPixelRadius;
    }

    if (screenPixelRadius < pointCloud.minNodePixelSize) {
      continue;
    }

    if (pointCloud.screenSpaceDensityLODEnabled) {
      const projectedArea = Math.PI * screenPixelRadius * screenPixelRadius;
      const pointsPerPixel = child.numPoints / Math.max(projectedArea, 1);
      if (pointsPerPixel > pointCloud.maxPointsPerPixel) {
        densityLODStats.culledNodes += 1;
        densityLODStats.culledPoints += child.numPoints;
        continue;
      }
    }

    pushQueueItem(
      new QueueItem(queueItem.pointCloudIndex, weight, child, node),
    );
  }
}

function distanceTo(a: Vec3Like, b: Vec3Like): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
