import type { LoadOctreeOptions } from "./loading/LoadInstrumentation";
import type { OctreeGeometry } from "./loading/OctreeGeometry";
import type { RequestManager } from "./loading/RequestManager";
import type { LRU } from "./utils/lru";

export type {
  IPointCloudTreeNode,
  IVisibilityUpdateResult,
  PointCloudHit,
} from "./core/types";

export type LoadedPointCloud = OctreeGeometry;

export interface IPotree<TPointCloud = LoadedPointCloud> {
  pointBudget: number;
  maxNumNodesLoading: number;
  maxLoadsToGPU: number;
  lru: LRU;

  loadPointCloud(
    url: string,
    baseUrl: string,
    options?: LoadOctreeOptions,
  ): Promise<TPointCloud>;
  loadPointCloud(
    url: string,
    requestManager: RequestManager,
    options?: LoadOctreeOptions,
  ): Promise<TPointCloud>;
}
