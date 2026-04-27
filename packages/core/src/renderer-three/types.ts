import type { Vector3 } from "three";
import type { LoadOctreeOptions } from "../loading/LoadInstrumentation";
import type { RequestManager } from "../loading/RequestManager";
import type { PointCloudOctree } from "../point-cloud-octree";
import type { LRU } from "../utils/lru";

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

export interface PickPoint {
  position?: Vector3;
  normal?: Vector3;
  pointCloud?: PointCloudOctree;
  [property: string]: any;
}
