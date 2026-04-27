import type { LoadOctreeOptions } from "./loading/LoadInstrumentation";
import type { RequestManager } from "./loading/RequestManager";
import type { PointCloudOctree } from "./point-cloud-octree";
import type { LRU } from "./utils/lru";

export type {
  IPointCloudTreeNode,
  IVisibilityUpdateResult,
  PointCloudHit,
} from "./core/types";

export interface IPotree {
  pointBudget: number;
  maxNumNodesLoading: number;
  maxLoadsToGPU: number;
  lru: LRU;

  loadPointCloud(
    url: string,
    baseUrl: string,
    options?: LoadOctreeOptions,
  ): Promise<PointCloudOctree>;
  loadPointCloud(
    url: string,
    requestManager: RequestManager,
    options?: LoadOctreeOptions,
  ): Promise<PointCloudOctree>;
}
