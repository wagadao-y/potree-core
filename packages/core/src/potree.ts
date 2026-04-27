import {
  DEFAULT_MAX_LOADS_TO_GPU,
  DEFAULT_MAX_NUM_NODES_LOADING,
  DEFAULT_POINT_BUDGET,
} from "./core/constants";
import type { LoadOctreeOptions } from "./loading/LoadInstrumentation";
import { loadOctree } from "./loading/load-octree";
import type { RequestManager } from "./loading/RequestManager";
import type { IPotree, LoadedPointCloud } from "./types";
import { LRU } from "./utils/lru";

export class Potree implements IPotree<LoadedPointCloud> {
  public lru = new LRU(DEFAULT_POINT_BUDGET);

  private _pointBudget = DEFAULT_POINT_BUDGET;

  private _maxNumNodesLoading = DEFAULT_MAX_NUM_NODES_LOADING;

  private _maxLoadsToGPU = DEFAULT_MAX_LOADS_TO_GPU;

  public async loadPointCloud(
    url: string,
    baseUrl: string,
    options?: LoadOctreeOptions,
  ): Promise<LoadedPointCloud>;
  public async loadPointCloud(
    url: string,
    requestManager: RequestManager,
    options?: LoadOctreeOptions,
  ): Promise<LoadedPointCloud>;
  public async loadPointCloud(
    url: string,
    reqManager: string | RequestManager,
    options?: LoadOctreeOptions,
  ): Promise<LoadedPointCloud> {
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
        return await loadOctree(url, requestManager, options);
      }

      throw new Error("Unsupported file type. Use metadata.json.");
    }
  }

  public get pointBudget(): number {
    return this._pointBudget;
  }

  public set pointBudget(value: number) {
    if (value === this._pointBudget) {
      return;
    }

    this._pointBudget = value;
    this.lru.pointBudget = value;
    this.lru.freeMemory();
  }

  public get maxNumNodesLoading(): number {
    return this._maxNumNodesLoading;
  }

  public set maxNumNodesLoading(value: number) {
    this._maxNumNodesLoading = value;
  }

  public get maxLoadsToGPU(): number {
    return this._maxLoadsToGPU;
  }

  public set maxLoadsToGPU(value: number) {
    this._maxLoadsToGPU = value;
  }
}
