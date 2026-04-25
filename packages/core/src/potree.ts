import {
  type Camera,
  type Ray,
  Vector2,
  type WebGLRenderer,
} from "three";
import {
  DEFAULT_POINT_BUDGET,
  DEFAULT_MAX_LOADS_TO_GPU,
  DEFAULT_MAX_NUM_NODES_LOADING,
} from "./constants";
import {
  PointCloudVisibilityScheduler,
  type PointCloudVisibilityUpdateInput,
} from "./core";
import type { LoadOctreeOptions } from "./loading2/LoadInstrumentation";
import { loadOctree } from "./loading2/load-octree";
import type { OctreeGeometry } from "./loading2/OctreeGeometry";
import type { OctreeGeometryNode } from "./loading2/OctreeGeometryNode";
import type { RequestManager } from "./loading2/RequestManager";
import { PointCloudOctree } from "./point-cloud-octree";
import type { PointCloudOctreeNode } from "./point-cloud-octree-node";
import {
  type PickParams,
  PointCloudOctreePicker,
} from "./point-cloud-octree-picker";
import type { IVisibilityUpdateResult } from "./core/types";
import type { IPotree, PickPoint } from "./renderer-three/types";
import {
  ThreePointCloudVisibilityAdapter,
  type ClipVisibilityContext,
} from "./renderer-three/point-cloud-octree-renderer";
import { getFeatures } from "./renderer-three/features";
import { LRU } from "./utils/lru";

export class Potree implements IPotree {
  public static picker: PointCloudOctreePicker | undefined;

  public _rendererSize: Vector2 = new Vector2();

  public get features() {
    return getFeatures();
  }

  public lru = new LRU(DEFAULT_POINT_BUDGET);

  private readonly visibilityAdapter = new ThreePointCloudVisibilityAdapter();

  private readonly visibilityScheduler =
    new PointCloudVisibilityScheduler<
      OctreeGeometryNode,
      PointCloudOctreeNode,
      PointCloudOctree,
      ClipVisibilityContext
    >(this.lru, {
      resetRenderedVisibility: (pointCloud) =>
        this.visibilityAdapter.resetRenderedVisibility(pointCloud),
      prepareClipVisibilityContexts: (pointClouds) =>
        this.visibilityAdapter.prepareClipVisibility(pointClouds),
      shouldClip: (pointCloud, boundingBox, clipContext) =>
        this.visibilityAdapter.shouldClip(
          pointCloud,
          boundingBox,
          clipContext,
        ),
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
    }, {
      pointBudget: DEFAULT_POINT_BUDGET,
      maxNumNodesLoading: DEFAULT_MAX_NUM_NODES_LOADING,
      maxLoadsToGPU: DEFAULT_MAX_LOADS_TO_GPU,
    });

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
    const rendererSize = renderer.getSize(this._rendererSize);
    const result = this.updatePointCloudVisibility(pointClouds, {
      views: this.visibilityAdapter.createViews(pointClouds, camera),
      projection: this.visibilityAdapter.createProjection(camera),
      viewport: {
        height: rendererSize.height,
        pixelRatio: renderer.getPixelRatio(),
      },
    });

    for (let i = 0; i < pointClouds.length; i++) {
      const pointCloud = pointClouds[i];
      if (pointCloud.disposed) {
        continue;
      }

      this.visibilityAdapter.updateAfterVisibility(pointCloud, camera, renderer);
    }

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
    Potree.picker = Potree.picker || new PointCloudOctreePicker();
    return Potree.picker.pick(renderer, camera, ray, pointClouds, params);
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
