import { type Box3, type Camera, type OrthographicCamera, type PerspectiveCamera, type Vector2, type Vector3, type WebGLRenderer } from "three";
import { PERSPECTIVE_CAMERA } from "../../constants";
import type { PointCloudOctreeGeometryNode } from "../../point-cloud-octree-geometry-node";
import type { PointCloudOctreeNode } from "../../point-cloud-octree-node";
import { PointCloudOctree } from "../../point-cloud-octree";
import { isGeometryNode, isTreeNode } from "../../type-predicates";
import type { IPointCloudTreeNode, IVisibilityUpdateResult } from "../types";
import { QueueItem, updateVisibilityStructures } from "./visibility-structures";

export interface UpdateVisibilityCallbacks<TClipContext> {
  prepareClipVisibilityContexts: (
    pointClouds: PointCloudOctree[],
  ) => (TClipContext | undefined)[];
  shouldClip: (
    pointCloud: PointCloudOctree,
    boundingBox: Box3,
    clipContext: TClipContext | undefined,
  ) => boolean;
  updateTreeNodeVisibility: (
    pointCloud: PointCloudOctree,
    node: PointCloudOctreeNode,
    visibleNodes: IPointCloudTreeNode[],
  ) => void;
  updateChildVisibility: (
    queueItem: QueueItem,
    pointCloud: PointCloudOctree,
    node: IPointCloudTreeNode,
    cameraPosition: Vector3,
    camera: Camera,
    halfHeight: number,
    densityLODStats: { culledNodes: number; culledPoints: number },
    pushQueueItem: (queueItem: QueueItem) => void,
  ) => void;
  loadGeometryNodes: (
    nodes: PointCloudOctreeGeometryNode[],
    candidates: PointCloudOctreeGeometryNode[],
  ) => Promise<void>[];
}

export interface UpdateVisibilityOptions<TClipContext> {
  pointClouds: PointCloudOctree[];
  camera: Camera;
  renderer: WebGLRenderer;
  rendererSize: Vector2;
  pointBudget: number;
  maxNumNodesLoading: number;
  maxLoadsToGPU: number;
  callbacks: UpdateVisibilityCallbacks<TClipContext>;
}

export function updateVisibility<TClipContext>(
  options: UpdateVisibilityOptions<TClipContext>,
): IVisibilityUpdateResult {
  let numVisiblePoints = 0;

  const visibleNodes: PointCloudOctreeNode[] = [];
  const unloadedGeometry: PointCloudOctreeGeometryNode[] = [];
  const densityLODStats = {
    culledNodes: 0,
    culledPoints: 0,
  };

  const { frustums, cameraPositions, priorityQueue } =
    updateVisibilityStructures(options.pointClouds, options.camera);

  const halfHeight =
    0.5 *
    options.renderer.getSize(options.rendererSize).height *
    options.renderer.getPixelRatio();
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

    const maxLevel =
      pointCloud.maxLevel !== undefined ? pointCloud.maxLevel : Infinity;

    if (
      node.level > maxLevel ||
      !frustums[pointCloudIndex].intersectsBox(node.boundingBox) ||
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
    const treeParent = parentNode && isTreeNode(parentNode) ? parentNode : null;

    if (
      isGeometryNode(node) &&
      node.numPoints > 0 &&
      (!parentNode || treeParent)
    ) {
      if (node.loaded && loadedToGPUThisFrame < options.maxLoadsToGPU) {
        node = pointCloud.toTreeNode(node, treeParent);
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

    if (isTreeNode(node)) {
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
      cameraPositions[pointCloudIndex],
      options.camera,
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

export function enqueueChildVisibilityItems(
  queueItem: QueueItem,
  pointCloud: PointCloudOctree,
  node: IPointCloudTreeNode,
  cameraPosition: Vector3,
  camera: Camera,
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
    const distance = sphere.center.distanceTo(cameraPosition);
    const radius = sphere.radius;

    let projectionFactor = 0.0;
    let weight: number;
    let screenPixelRadius: number;

    if (camera.type === PERSPECTIVE_CAMERA) {
      const perspective = camera as PerspectiveCamera;
      const fov = (perspective.fov * Math.PI) / 180.0;
      const slope = Math.tan(fov / 2.0);
      projectionFactor = halfHeight / (slope * distance);
      screenPixelRadius = radius * projectionFactor;
      weight =
        distance < radius
          ? Number.MAX_VALUE
          : screenPixelRadius + 1 / distance;
    } else {
      const orthographic = camera as OrthographicCamera;
      projectionFactor =
        ((2 * halfHeight) / (orthographic.top - orthographic.bottom)) *
        orthographic.zoom;
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