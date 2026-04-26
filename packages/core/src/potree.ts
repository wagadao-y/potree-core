import type { Camera, Ray, WebGLRenderer } from "three";
import {
  PointCloudVisibilityScheduler,
  type PointCloudVisibilityUpdateInput,
} from "./core";
import {
  DEFAULT_MAX_LOADS_TO_GPU,
  DEFAULT_MAX_NUM_NODES_LOADING,
  DEFAULT_POINT_BUDGET,
} from "./core/constants";
import type { IVisibilityUpdateResult } from "./core/types";
import type { LoadOctreeOptions } from "./loading/LoadInstrumentation";
import { loadOctree } from "./loading/load-octree";
import type { OctreeGeometry } from "./loading/OctreeGeometry";
import type { OctreeGeometryNode } from "./loading/OctreeGeometryNode";
import type { RequestManager } from "./loading/RequestManager";
import { PointCloudOctree } from "./point-cloud-octree";
import {
  type ClipVisibilityContext,
  ThreePointCloudVisibilityAdapter,
} from "./renderer-three/adapters/point-cloud-visibility-adapter";
import { getFeatures } from "./renderer-three/features";
import type { PointCloudOctreeNode } from "./renderer-three/geometry/point-cloud-octree-node";
import {
  type PickParams,
  pickPointClouds,
} from "./renderer-three/picking/point-cloud-octree-picker";
import type { IPotree, PickPoint } from "./renderer-three/types";
import { LRU } from "./utils/lru";

export class Potree implements IPotree {
  public get features() {
    return getFeatures();
  }

  public lru = new LRU(DEFAULT_POINT_BUDGET);

  private readonly visibilityAdapter = new ThreePointCloudVisibilityAdapter();

  private readonly visibilityScheduler = new PointCloudVisibilityScheduler<
    OctreeGeometryNode,
    PointCloudOctreeNode,
    PointCloudOctree,
    ClipVisibilityContext
  >(
    this.lru,
    {
      resetRenderedVisibility: (pointCloud) =>
        this.visibilityAdapter.resetRenderedVisibility(pointCloud),
      prepareClipVisibilityContexts: (pointClouds) =>
        this.visibilityAdapter.prepareClipVisibility(pointClouds),
      shouldClip: (pointCloud, boundingBox, clipContext) =>
        this.visibilityAdapter.shouldClip(pointCloud, boundingBox, clipContext),
      updateTreeNodeVisibility: (pointCloud, node, visibleNodes) =>
        this.visibilityAdapter.updateTreeNodeVisibility(
          pointCloud,
          node,
          visibleNodes,
        ),
      materializeLoadedGeometryNode: (pointCloud, geometryNode, parent) =>
        this.visibilityAdapter.materializeLoadedGeometryNode(
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

  public updatePointClouds(
    pointClouds: PointCloudOctree[],
    camera: Camera,
    renderer: WebGLRenderer,
  ): IVisibilityUpdateResult {
    const result = this.updatePointCloudVisibility(
      pointClouds,
      this.visibilityAdapter.createVisibilityInput(
        pointClouds,
        camera,
        renderer,
      ),
    );

    this.visibilityAdapter.updatePointCloudsAfterVisibility(
      pointClouds,
      camera,
      renderer,
    );

    return result;
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

  public static pick(
    pointClouds: PointCloudOctree[],
    renderer: WebGLRenderer,
    camera: Camera,
    ray: Ray,
    params: Partial<PickParams> = {},
  ): PickPoint | null {
    return pickPointClouds(pointClouds, renderer, camera, ray, params);
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
