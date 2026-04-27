import type { LRU, OctreeGeometryNode } from "potree-core";
import {
  DEFAULT_MAX_LOADS_TO_GPU,
  DEFAULT_MAX_NUM_NODES_LOADING,
  DEFAULT_POINT_BUDGET,
} from "potree-core";
import { PointCloudVisibilityScheduler } from "potree-core/core";
import {
  type ClipVisibilityContext,
  ThreePointCloudVisibilityAdapter,
} from "./adapters/point-cloud-visibility-adapter";
import type { PointCloudOctreeNode } from "./geometry/point-cloud-octree-node";
import type { ThreePointCloudVisibilityTarget } from "./types";

export function createThreePointCloudVisibilityScheduler(lru: LRU) {
  const visibilityAdapter = new ThreePointCloudVisibilityAdapter();

  return new PointCloudVisibilityScheduler<
    OctreeGeometryNode,
    PointCloudOctreeNode,
    ThreePointCloudVisibilityTarget,
    ClipVisibilityContext
  >(
    lru,
    {
      resetRenderedVisibility: (pointCloud) =>
        visibilityAdapter.resetRenderedVisibility(pointCloud),
      prepareClipVisibilityContexts: (pointClouds) =>
        visibilityAdapter.prepareClipVisibility(pointClouds),
      shouldClip: (pointCloud, boundingBox, clipContext) =>
        visibilityAdapter.shouldClip(pointCloud, boundingBox, clipContext),
      updateTreeNodeVisibility: (pointCloud, node, visibleNodes) =>
        visibilityAdapter.updateTreeNodeVisibility(
          pointCloud,
          node,
          visibleNodes,
        ),
      materializeLoadedGeometryNode: (pointCloud, geometryNode, parent) =>
        visibilityAdapter.materializeLoadedGeometryNode(
          pointCloud,
          geometryNode,
          parent,
        ),
    },
    {
      pointBudget: DEFAULT_POINT_BUDGET,
      maxNumNodesLoading: DEFAULT_MAX_NUM_NODES_LOADING,
      maxLoadsToGPU: DEFAULT_MAX_LOADS_TO_GPU,
    },
  );
}
