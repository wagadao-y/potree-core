import type { Camera, Vector3, WebGLRenderer } from "three";
import type { IVisibilityUpdateResult } from "../core/types";
import type { LoadOctreeOptions } from "../loading2/LoadInstrumentation";
import type { RequestManager } from "../loading2/RequestManager";
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

  updatePointClouds(
    pointClouds: PointCloudOctree[],
    camera: Camera,
    renderer: WebGLRenderer,
  ): IVisibilityUpdateResult;
}

export interface PickPoint {
  position?: Vector3;
  normal?: Vector3;
  pointCloud?: PointCloudOctree;
  [property: string]: any;
}