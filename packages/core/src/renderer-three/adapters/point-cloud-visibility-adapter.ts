import { Box3, type Camera, Vector2, Vector3, type WebGLRenderer } from "three";
import type { PointCloudVisibilityUpdateInput } from "../../core";
import type { Box3Like, IPointCloudTreeNode } from "../../core/types";
import type { OctreeGeometryNode } from "../../loading/OctreeGeometryNode";
import { ClipMode } from "../../materials";
import type { PointCloudOctree } from "../../point-cloud-octree";
import type { PointCloudOctreeNode } from "../geometry/point-cloud-octree-node";
import { toThreeBox3 } from "../math/box3-like";
import {
  materializePointCloudOctreeNode,
  resetPointCloudOctreeRenderedVisibility,
  updatePointCloudOctreeNodeVisibility,
} from "../scene/point-cloud-octree-scene";
import {
  createVisibilityProjection as createProjection,
  createPointCloudVisibilityViews as createVisibilityViews,
} from "../scene/point-cloud-visibility-view";
import { updatePointCloudAfterVisibility } from "./point-cloud-octree-renderer";

export interface ClipVisibilityContext {
  enabled: boolean;
  clipBoxCount: number;
  clipBoxesWorld: Box3[];
}

class PointCloudClipVisibilityEvaluator {
  private readonly clipUnitBox = new Box3(
    new Vector3(-0.5, -0.5, -0.5),
    new Vector3(0.5, 0.5, 0.5),
  );

  private readonly clipNodeWorldBox = new Box3();

  private readonly clipContexts: (ClipVisibilityContext | undefined)[] = [];

  public prepare(
    pointClouds: PointCloudOctree[],
  ): (ClipVisibilityContext | undefined)[] {
    const contexts = this.clipContexts;
    contexts.length = pointClouds.length;

    for (let i = 0; i < pointClouds.length; i++) {
      const pointCloud = pointClouds[i];
      const material = pointCloud.material;
      const existingContext = contexts[i];

      if (
        material.numClipBoxes === 0 ||
        material.clipMode !== ClipMode.CLIP_OUTSIDE
      ) {
        if (existingContext !== undefined) {
          existingContext.enabled = false;
          existingContext.clipBoxCount = 0;
        }
        continue;
      }

      pointCloud.updateMatrixWorld(true);

      let context = existingContext;
      if (context === undefined) {
        context = {
          enabled: true,
          clipBoxCount: 0,
          clipBoxesWorld: [],
        };
        contexts[i] = context;
      }

      const clipBoxesWorld = context.clipBoxesWorld;
      const clipBoxes = material.clipBoxes;
      context.enabled = true;
      context.clipBoxCount = clipBoxes.length;

      for (let j = 0; j < context.clipBoxCount; j++) {
        const clipBoxWorld = clipBoxesWorld[j] ?? new Box3();
        clipBoxWorld.copy(this.clipUnitBox).applyMatrix4(clipBoxes[j].matrix);
        clipBoxesWorld[j] = clipBoxWorld;
      }
    }

    return contexts;
  }

  public shouldClip(
    pointCloud: PointCloudOctree,
    boundingBox: Box3Like,
    clipContext: ClipVisibilityContext | undefined,
  ): boolean {
    if (clipContext === undefined || !clipContext.enabled) {
      return false;
    }

    const nodeWorldBox = this.clipNodeWorldBox
      .copy(toThreeBox3(boundingBox))
      .applyMatrix4(pointCloud.matrixWorld);
    const clipBoxesWorld = clipContext.clipBoxesWorld;

    for (let i = 0; i < clipContext.clipBoxCount; i++) {
      if (clipBoxesWorld[i]?.intersectsBox(nodeWorldBox)) {
        return false;
      }
    }

    return true;
  }
}

export class ThreePointCloudVisibilityAdapter {
  private readonly clipVisibility = new PointCloudClipVisibilityEvaluator();

  private readonly rendererSize = new Vector2();

  public createViews(pointClouds: PointCloudOctree[], camera: Camera) {
    return createVisibilityViews(pointClouds, camera);
  }

  public createProjection(camera: Camera) {
    return createProjection(camera);
  }

  public createVisibilityInput(
    pointClouds: PointCloudOctree[],
    camera: Camera,
    renderer: WebGLRenderer,
  ): PointCloudVisibilityUpdateInput {
    const rendererSize = renderer.getSize(this.rendererSize);

    return {
      views: this.createViews(pointClouds, camera),
      projection: this.createProjection(camera),
      viewport: {
        height: rendererSize.y,
        pixelRatio: renderer.getPixelRatio(),
      },
    };
  }

  public resetRenderedVisibility(pointCloud: PointCloudOctree): void {
    resetPointCloudOctreeRenderedVisibility(pointCloud);
  }

  public prepareClipVisibility(
    pointClouds: PointCloudOctree[],
  ): (ClipVisibilityContext | undefined)[] {
    return this.clipVisibility.prepare(pointClouds);
  }

  public shouldClip(
    pointCloud: PointCloudOctree,
    boundingBox: Box3Like,
    clipContext: ClipVisibilityContext | undefined,
  ): boolean {
    return this.clipVisibility.shouldClip(pointCloud, boundingBox, clipContext);
  }

  public materializeLoadedGeometryNode(
    pointCloud: PointCloudOctree,
    geometryNode: OctreeGeometryNode,
    parent: PointCloudOctreeNode | null,
  ): PointCloudOctreeNode {
    return materializePointCloudOctreeNode(pointCloud, geometryNode, parent);
  }

  public updateTreeNodeVisibility(
    pointCloud: PointCloudOctree,
    node: PointCloudOctreeNode,
    visibleNodes: IPointCloudTreeNode[],
  ): void {
    updatePointCloudOctreeNodeVisibility(pointCloud, node, visibleNodes);
  }

  public updateAfterVisibility(
    pointCloud: PointCloudOctree,
    camera: Camera,
    renderer: WebGLRenderer,
  ): void {
    updatePointCloudAfterVisibility(pointCloud, camera, renderer);
  }

  public updatePointCloudsAfterVisibility(
    pointClouds: PointCloudOctree[],
    camera: Camera,
    renderer: WebGLRenderer,
  ): void {
    for (let i = 0; i < pointClouds.length; i++) {
      const pointCloud = pointClouds[i];
      if (pointCloud.disposed) {
        continue;
      }

      this.updateAfterVisibility(pointCloud, camera, renderer);
    }
  }
}
