import type { PointCloudVisibilityUpdateInput } from "./core";
import { DEFAULT_POINT_BUDGET } from "./core/constants";
import type { IVisibilityUpdateResult } from "./core/types";
import type { LoadOctreeOptions } from "./loading/LoadInstrumentation";
import { loadOctree } from "./loading/load-octree";
import type { OctreeGeometry } from "./loading/OctreeGeometry";
import type { RequestManager } from "./loading/RequestManager";
import { PointCloudOctree } from "./point-cloud-octree";
import { createThreePointCloudVisibilityScheduler } from "./renderer-three/create-three-point-cloud-visibility-scheduler";
import type { IPotree } from "./types";
import { LRU } from "./utils/lru";

export class Potree implements IPotree {
  public lru = new LRU(DEFAULT_POINT_BUDGET);

  private readonly visibilityScheduler: ReturnType<
    typeof createThreePointCloudVisibilityScheduler
  > = createThreePointCloudVisibilityScheduler(this.lru);

  public async loadPointCloud(
    url: string,
    baseUrl: string,
    options?: LoadOctreeOptions,
  ): Promise<PointCloudOctree>;
  public async loadPointCloud(
    url: string,
    requestManager: RequestManager,
    options?: LoadOctreeOptions,
  ): Promise<PointCloudOctree>;
  public async loadPointCloud(
    url: string,
    reqManager: string | RequestManager,
    options?: LoadOctreeOptions,
  ): Promise<PointCloudOctree> {
    if (typeof reqManager === "string") {
      // Handle baseUrl case
      const baseUrl = reqManager;

      const requestManager: RequestManager = {
        getUrl: async (relativeUrl) => `${baseUrl}${relativeUrl}`,
        fetch: async (input, init) => fetch(input, init),
      };
      return this.loadPointCloud(url, requestManager, options);
    } else {
      // Handle RequestManager case
      const requestManager = reqManager;

      if (url.endsWith("metadata.json")) {
        return await loadOctree(url, requestManager, options).then(
          (geometry: OctreeGeometry) => {
            return new PointCloudOctree(this, geometry);
          },
        );
      }

      throw new Error("Unsupported file type. Use metadata.json.");
    }
  }

  public updatePointCloudVisibility(
    pointClouds: PointCloudOctree[],
    input: PointCloudVisibilityUpdateInput,
  ): IVisibilityUpdateResult {
    return this.visibilityScheduler.updatePointCloudVisibility(
      pointClouds,
      input,
    );
  }

  public get pointBudget(): number {
    return this.visibilityScheduler.pointBudget;
  }

  public set pointBudget(value: number) {
    this.visibilityScheduler.setPointBudget(value);
  }

  public get maxNumNodesLoading(): number {
    return this.visibilityScheduler.maxNumNodesLoading;
  }

  public set maxNumNodesLoading(value: number) {
    this.visibilityScheduler.maxNumNodesLoading = value;
  }

  public get maxLoadsToGPU(): number {
    return this.visibilityScheduler.maxLoadsToGPU;
  }

  public set maxLoadsToGPU(value: number) {
    this.visibilityScheduler.maxLoadsToGPU = value;
  }
}
