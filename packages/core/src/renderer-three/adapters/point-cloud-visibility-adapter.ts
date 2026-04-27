import {
  Box3,
  type Camera,
  type Plane,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from "three";
import type { PointCloudVisibilityUpdateInput } from "../../core";
import type { Box3Like, IPointCloudTreeNode } from "../../core/types";
import type { OctreeGeometryNode } from "../../loading/OctreeGeometryNode";
import type { PointCloudOctreeNode } from "../geometry/point-cloud-octree-node";
import { ClipMode } from "../materials";
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
import type { ThreePointCloudVisibilityTarget } from "../types";
import { updatePointCloudAfterVisibility } from "./point-cloud-octree-renderer";

export interface ClipVisibilityContext {
  enabled: boolean;
  clipMode: ClipMode;
  clipBoxCount: number;
  clipBoxesWorld: Box3[];
  clipPlanes: Plane[];
  clipPlaneCount: number;
}

class PointCloudClipVisibilityEvaluator {
  private readonly clipUnitBox = new Box3(
    new Vector3(-0.5, -0.5, -0.5),
    new Vector3(0.5, 0.5, 0.5),
  );

  private readonly clipNodeWorldBox = new Box3();

  private readonly clipNodeCorners = Array.from(
    { length: 8 },
    () => new Vector3(),
  );

  private readonly clipLocalCorner = new Vector3();

  private readonly clipContexts: (ClipVisibilityContext | undefined)[] = [];

  public prepare(
    pointClouds: ThreePointCloudVisibilityTarget[],
  ): (ClipVisibilityContext | undefined)[] {
    const contexts = this.clipContexts;
    contexts.length = pointClouds.length;

    for (let i = 0; i < pointClouds.length; i++) {
      const pointCloud = pointClouds[i];
      const material = pointCloud.material;
      const existingContext = contexts[i];
      const clipPlanes = material.clippingPlanes ?? [];
      const supportsClipPruning =
        material.clipMode === ClipMode.CLIP_OUTSIDE ||
        material.clipMode === ClipMode.CLIP_INSIDE;

      if (
        !supportsClipPruning ||
        (material.numClipBoxes === 0 && clipPlanes.length === 0)
      ) {
        if (existingContext !== undefined) {
          existingContext.enabled = false;
          existingContext.clipMode = ClipMode.DISABLED;
          existingContext.clipBoxCount = 0;
          existingContext.clipPlaneCount = 0;
          existingContext.clipPlanes = [];
        }
        continue;
      }

      pointCloud.updateMatrixWorld(true);

      let context = existingContext;
      if (context === undefined) {
        context = {
          enabled: true,
          clipMode: material.clipMode,
          clipBoxCount: 0,
          clipBoxesWorld: [],
          clipPlanes: [],
          clipPlaneCount: 0,
        };
        contexts[i] = context;
      }

      const clipBoxesWorld = context.clipBoxesWorld;
      const clipBoxes = material.clipBoxes;
      context.enabled = true;
      context.clipMode = material.clipMode;
      context.clipBoxCount = clipBoxes.length;
      context.clipPlanes = clipPlanes;
      context.clipPlaneCount = clipPlanes.length;

      for (let j = 0; j < context.clipBoxCount; j++) {
        const clipBoxWorld = clipBoxesWorld[j] ?? new Box3();
        clipBoxWorld.copy(this.clipUnitBox).applyMatrix4(clipBoxes[j].matrix);
        clipBoxesWorld[j] = clipBoxWorld;
      }
    }

    return contexts;
  }

  public shouldClip(
    pointCloud: ThreePointCloudVisibilityTarget,
    boundingBox: Box3Like,
    clipContext: ClipVisibilityContext | undefined,
  ): boolean {
    if (clipContext === undefined || !clipContext.enabled) {
      return false;
    }

    const nodeWorldBox = this.clipNodeWorldBox
      .copy(toThreeBox3(boundingBox))
      .applyMatrix4(pointCloud.matrixWorld);

    if (clipContext.clipMode === ClipMode.CLIP_OUTSIDE) {
      if (this.isEntirelyRejectedByAnyPlane(nodeWorldBox, clipContext)) {
        return true;
      }

      return !this.intersectsAnyClipBox(nodeWorldBox, clipContext);
    }

    if (clipContext.clipMode !== ClipMode.CLIP_INSIDE) {
      return false;
    }

    if (!this.isEntirelyAcceptedByPlanes(nodeWorldBox, clipContext)) {
      return false;
    }

    return this.isEntirelyInsideAnyClipBox(
      nodeWorldBox,
      pointCloud,
      clipContext,
    );
  }

  private intersectsAnyClipBox(
    nodeWorldBox: Box3,
    clipContext: ClipVisibilityContext,
  ): boolean {
    const clipBoxesWorld = clipContext.clipBoxesWorld;

    if (clipContext.clipBoxCount === 0) {
      return true;
    }

    for (let i = 0; i < clipContext.clipBoxCount; i++) {
      if (clipBoxesWorld[i]?.intersectsBox(nodeWorldBox)) {
        return true;
      }
    }

    return false;
  }

  private isEntirelyRejectedByAnyPlane(
    nodeWorldBox: Box3,
    clipContext: ClipVisibilityContext,
  ): boolean {
    if (clipContext.clipPlaneCount === 0) {
      return false;
    }

    this.populateBoxCorners(nodeWorldBox);

    for (let i = 0; i < clipContext.clipPlaneCount; i++) {
      const plane = clipContext.clipPlanes[i];
      let allNegative = true;

      for (const corner of this.clipNodeCorners) {
        if (plane.distanceToPoint(corner) >= 0.0) {
          allNegative = false;
          break;
        }
      }

      if (allNegative) {
        return true;
      }
    }

    return false;
  }

  private isEntirelyAcceptedByPlanes(
    nodeWorldBox: Box3,
    clipContext: ClipVisibilityContext,
  ): boolean {
    if (clipContext.clipPlaneCount === 0) {
      return true;
    }

    this.populateBoxCorners(nodeWorldBox);

    for (let i = 0; i < clipContext.clipPlaneCount; i++) {
      const plane = clipContext.clipPlanes[i];

      for (const corner of this.clipNodeCorners) {
        if (plane.distanceToPoint(corner) < 0.0) {
          return false;
        }
      }
    }

    return true;
  }

  private isEntirelyInsideAnyClipBox(
    nodeWorldBox: Box3,
    pointCloud: ThreePointCloudVisibilityTarget,
    clipContext: ClipVisibilityContext,
  ): boolean {
    if (clipContext.clipBoxCount === 0) {
      return clipContext.clipPlaneCount > 0;
    }

    this.populateBoxCorners(nodeWorldBox);
    const clipBoxes = pointCloud.material.clipBoxes;

    for (let i = 0; i < clipContext.clipBoxCount; i++) {
      const clipBox = clipBoxes[i];
      let containsAllCorners = true;

      for (const corner of this.clipNodeCorners) {
        this.clipLocalCorner.copy(corner).applyMatrix4(clipBox.inverse);

        if (
          Math.abs(this.clipLocalCorner.x) > 0.5 ||
          Math.abs(this.clipLocalCorner.y) > 0.5 ||
          Math.abs(this.clipLocalCorner.z) > 0.5
        ) {
          containsAllCorners = false;
          break;
        }
      }

      if (containsAllCorners) {
        return true;
      }
    }

    return false;
  }

  private populateBoxCorners(box: Box3): void {
    const { min, max } = box;
    const corners = this.clipNodeCorners;

    corners[0].set(min.x, min.y, min.z);
    corners[1].set(min.x, min.y, max.z);
    corners[2].set(min.x, max.y, min.z);
    corners[3].set(min.x, max.y, max.z);
    corners[4].set(max.x, min.y, min.z);
    corners[5].set(max.x, min.y, max.z);
    corners[6].set(max.x, max.y, min.z);
    corners[7].set(max.x, max.y, max.z);
  }
}

export class ThreePointCloudVisibilityAdapter {
  private readonly clipVisibility = new PointCloudClipVisibilityEvaluator();

  private readonly rendererSize = new Vector2();

  public createViews(
    pointClouds: ThreePointCloudVisibilityTarget[],
    camera: Camera,
  ) {
    return createVisibilityViews(pointClouds, camera);
  }

  public createProjection(camera: Camera) {
    return createProjection(camera);
  }

  public createVisibilityInput(
    pointClouds: ThreePointCloudVisibilityTarget[],
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

  public resetRenderedVisibility(
    pointCloud: ThreePointCloudVisibilityTarget,
  ): void {
    resetPointCloudOctreeRenderedVisibility(pointCloud);
  }

  public prepareClipVisibility(
    pointClouds: ThreePointCloudVisibilityTarget[],
  ): (ClipVisibilityContext | undefined)[] {
    return this.clipVisibility.prepare(pointClouds);
  }

  public shouldClip(
    pointCloud: ThreePointCloudVisibilityTarget,
    boundingBox: Box3Like,
    clipContext: ClipVisibilityContext | undefined,
  ): boolean {
    return this.clipVisibility.shouldClip(pointCloud, boundingBox, clipContext);
  }

  public materializeLoadedGeometryNode(
    pointCloud: ThreePointCloudVisibilityTarget,
    geometryNode: OctreeGeometryNode,
    parent: PointCloudOctreeNode | null,
  ): PointCloudOctreeNode {
    return materializePointCloudOctreeNode(pointCloud, geometryNode, parent);
  }

  public updateTreeNodeVisibility(
    pointCloud: ThreePointCloudVisibilityTarget,
    node: PointCloudOctreeNode,
    visibleNodes: IPointCloudTreeNode[],
  ): void {
    updatePointCloudOctreeNodeVisibility(pointCloud, node, visibleNodes);
  }

  public updateAfterVisibility(
    pointCloud: ThreePointCloudVisibilityTarget,
    camera: Camera,
    renderer: WebGLRenderer,
  ): void {
    updatePointCloudAfterVisibility(pointCloud, camera, renderer);
  }

  public updatePointCloudsAfterVisibility(
    pointClouds: ThreePointCloudVisibilityTarget[],
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
