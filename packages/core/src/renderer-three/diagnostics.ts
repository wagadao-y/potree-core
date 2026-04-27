import type { IPotree, IVisibilityUpdateResult } from "../types";
import type { PointCloudOctree } from "./point-cloud-octree";

export interface PointCloudDiagnosticsSnapshot {
  visibleGeometryCount: number;
  loadingNodeCount: number;
  maxLoadingNodeCount: number;
  pointBudget: number;
  pointBudgetUse: number;
  lruPoints: number | null;
  lruNodes: number | null;
  lruBudgetUse: number | null;
}

export function collectPointCloudDiagnostics(
  potree: IPotree | null | undefined,
  pointClouds: PointCloudOctree[],
  visibilityResult: IVisibilityUpdateResult,
): PointCloudDiagnosticsSnapshot {
  const visibleGeometryCount = pointClouds.reduce(
    (sum, pointCloud) => sum + pointCloud.visibleGeometry.length,
    0,
  );
  const loadingNodeCount = pointClouds.reduce(
    (sum, pointCloud) => sum + pointCloud.pcoGeometry.numNodesLoading,
    0,
  );
  const maxLoadingNodeCount = pointClouds.reduce(
    (sum, pointCloud) => sum + pointCloud.pcoGeometry.maxNumNodesLoading,
    0,
  );
  const pointBudget = potree?.pointBudget ?? 0;
  const lru = potree?.lru;
  const pointBudgetUse =
    pointBudget > 0 ? visibilityResult.numVisiblePoints / pointBudget : 0;
  const lruPoints = lru ? lru.numPoints : null;
  const lruNodes = lru ? lru.size : null;
  const lruBudgetUse =
    pointBudget > 0 && lruPoints !== null ? lruPoints / pointBudget : null;

  return {
    visibleGeometryCount,
    loadingNodeCount,
    maxLoadingNodeCount,
    pointBudget,
    pointBudgetUse,
    lruPoints,
    lruNodes,
    lruBudgetUse,
  };
}
