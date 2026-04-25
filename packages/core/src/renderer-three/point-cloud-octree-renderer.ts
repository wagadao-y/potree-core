import {
  Box3,
  type Camera,
  Frustum,
  Matrix4,
  Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Points,
  Vector3,
  type WebGLRenderer,
} from "three";
import type { Box3Like, IPointCloudTreeNode } from "../core/types";
import type { VisibilityProjection } from "../core/visibility/update-visibility";
import type { PointCloudVisibilityView } from "../core/visibility/visibility-structures";
import type { OctreeGeometryNode } from "../loading/OctreeGeometryNode";
import { ClipMode, PointCloudMaterial } from "../materials";
import type { PointCloudOctree } from "../point-cloud-octree";
import { PointCloudOctreeNode } from "../point-cloud-octree-node";
import { computeTransformedBoundingBox } from "./bounds";
import { Box3Helper } from "./box3-helper";
import { toThreeBox3 } from "./box3-like";
import { materializeOctreeNodeGeometry } from "./octree-node-geometry";

export interface ClipVisibilityContext {
  enabled: boolean;
  clipBoxCount: number;
  clipBoxesWorld: Box3[];
}

export class PointCloudClipVisibilityEvaluator {
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

  public createViews(
    pointClouds: PointCloudOctree[],
    camera: Camera,
  ): (PointCloudVisibilityView | undefined)[] {
    return createPointCloudVisibilityViews(pointClouds, camera);
  }

  public createProjection(camera: Camera): VisibilityProjection {
    return createVisibilityProjection(camera);
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
}

export function createDefaultPointCloudMaterial(
  _pcoGeometry: PointCloudOctree["pcoGeometry"],
): PointCloudMaterial {
  return new PointCloudMaterial({ newFormat: true });
}

export function updatePointCloudMaterialBounds(
  pointCloud: PointCloudOctree,
  material: PointCloudMaterial,
): void {
  pointCloud.updateMatrixWorld(true);

  const { min, max } = computeTransformedBoundingBox(
    pointCloud.pcoGeometry.tightBoundingBox
      ? toThreeBox3(pointCloud.pcoGeometry.tightBoundingBox)
      : pointCloud.getBoundingBoxWorld(),
    pointCloud.matrixWorld,
  );

  const bWidth = max.z - min.z;
  material.heightMin = min.z - 0.2 * bWidth;
  material.heightMax = max.z + 0.2 * bWidth;
}

export function updatePointCloudAfterVisibility(
  pointCloud: PointCloudOctree,
  camera: Camera,
  renderer: WebGLRenderer,
): void {
  pointCloud.material.updateMaterial(
    pointCloud,
    pointCloud.visibleNodes,
    camera,
    renderer,
  );
  pointCloud.updateVisibleBounds();
  pointCloud.updateBoundingBoxes();
}

export function updatePointCloudVisibleBounds(
  pointCloud: PointCloudOctree,
  visibleBounds: Box3,
): void {
  visibleBounds.min.set(Infinity, Infinity, Infinity);
  visibleBounds.max.set(-Infinity, -Infinity, -Infinity);

  for (const node of pointCloud.visibleNodes) {
    if (node.isLeafNode) {
      visibleBounds.expandByPoint(node.boundingBox.min);
      visibleBounds.expandByPoint(node.boundingBox.max);
    }
  }
}

export function updatePointCloudBoundingBoxes(
  pointCloud: PointCloudOctree,
): void {
  if (!pointCloud.showBoundingBox || !pointCloud.parent) {
    return;
  }

  let bbRoot = pointCloud.parent.getObjectByName("bbroot");
  if (!bbRoot) {
    bbRoot = new Object3D();
    bbRoot.name = "bbroot";
    pointCloud.parent.add(bbRoot);
  }

  const visibleBoxes: Array<Object3D | null> = [];
  for (const node of pointCloud.visibleNodes) {
    if (node.boundingBoxNode !== undefined && node.isLeafNode) {
      visibleBoxes.push(node.boundingBoxNode);
    }
  }

  bbRoot.children = visibleBoxes;
}

export function hidePointCloudDescendants(object: Object3D): void {
  const toHide: Object3D[] = [];
  addVisibleChildren(object);

  while (toHide.length > 0) {
    const objectToHide = toHide.shift();
    if (objectToHide === undefined) {
      continue;
    }

    objectToHide.visible = false;
    addVisibleChildren(objectToHide);
  }

  function addVisibleChildren(node: Object3D) {
    for (const child of node.children) {
      if (child.visible) {
        toHide.push(child);
      }
    }
  }
}

export function getPointCloudBoundingBoxWorld(
  pointCloud: PointCloudOctree,
): Box3 {
  pointCloud.updateMatrixWorld(true);
  return computeTransformedBoundingBox(
    pointCloud.boundingBox,
    pointCloud.matrixWorld,
  );
}

export function movePointCloudToOrigin(pointCloud: PointCloudOctree): void {
  pointCloud.position.set(0, 0, 0);
  pointCloud.position
    .set(0, 0, 0)
    .sub(getPointCloudBoundingBoxWorld(pointCloud).getCenter(new Vector3()));
}

export function movePointCloudToGroundPlane(
  pointCloud: PointCloudOctree,
): void {
  pointCloud.position.y += -getPointCloudBoundingBoxWorld(pointCloud).min.y;
}

export function getPointCloudVisibleExtent(
  pointCloud: PointCloudOctree,
  visibleBounds: Box3,
): Box3 {
  return visibleBounds.applyMatrix4(pointCloud.matrixWorld);
}

export function createPointCloudOctreeNode(
  pointCloud: PointCloudOctree,
  geometryNode: OctreeGeometryNode,
): PointCloudOctreeNode {
  const points = new Points(
    materializeOctreeNodeGeometry(geometryNode),
    pointCloud.material,
  );
  const node = new PointCloudOctreeNode(geometryNode, points);
  points.name = geometryNode.name;
  points.position.set(
    geometryNode.boundingBox.min.x,
    geometryNode.boundingBox.min.y,
    geometryNode.boundingBox.min.z,
  );
  points.frustumCulled = false;
  points.onBeforeRender = PointCloudMaterial.makeOnBeforeRender(
    pointCloud,
    node,
  );
  return node;
}

export function materializePointCloudOctreeNode(
  pointCloud: PointCloudOctree,
  geometryNode: OctreeGeometryNode,
  parent?: PointCloudOctreeNode | null,
): PointCloudOctreeNode {
  const node = createPointCloudOctreeNode(pointCloud, geometryNode);
  const points = node.sceneNode;
  points.name = geometryNode.name;

  if (parent) {
    node.parent = parent;
    parent.sceneNode.add(points);
    parent.children[geometryNode.index] = node;

    geometryNode.oneTimeDisposeHandlers.push(() => {
      node.disposeSceneNode();
      parent.sceneNode.remove(node.sceneNode);
      // Replace the rendered node with the geometry node when GPU resources are evicted.
      parent.children[geometryNode.index] = geometryNode;
    });
  } else {
    pointCloud.root = node;
    pointCloud.add(points);
  }

  return node;
}

export function createPointCloudVisibilityViews(
  pointClouds: PointCloudOctree[],
  camera: Camera,
): (PointCloudVisibilityView | undefined)[] {
  const frustumMatrix = new Matrix4();
  const inverseWorldMatrix = new Matrix4();
  const cameraMatrix = new Matrix4();

  const views: (PointCloudVisibilityView | undefined)[] = new Array(
    pointClouds.length,
  );

  camera.updateMatrixWorld(false);

  for (let i = 0; i < pointClouds.length; i++) {
    const pointCloud = pointClouds[i];

    if (!pointCloud.initialized()) {
      continue;
    }

    const inverseViewMatrix = camera.matrixWorldInverse;
    const worldMatrix = pointCloud.matrixWorld;
    frustumMatrix
      .identity()
      .multiply(camera.projectionMatrix)
      .multiply(inverseViewMatrix)
      .multiply(worldMatrix);

    inverseWorldMatrix.copy(worldMatrix).invert();
    cameraMatrix
      .identity()
      .multiply(inverseWorldMatrix)
      .multiply(camera.matrixWorld);

    const frustum = new Frustum().setFromProjectionMatrix(frustumMatrix);
    const tempBox = new Box3();
    views[i] = {
      intersectsBox: (box: Box3Like) =>
        frustum.intersectsBox(toThreeBox3(box, tempBox)),
      cameraPosition: new Vector3().setFromMatrixPosition(cameraMatrix),
    };
  }

  return views;
}

export function createVisibilityProjection(
  camera: Camera,
): VisibilityProjection {
  const perspective = camera as PerspectiveCamera;
  if (perspective.isPerspectiveCamera === true) {
    return {
      type: "perspective",
      fovRadians: perspective.fov * (Math.PI / 180),
    };
  }

  const orthographic = camera as OrthographicCamera;
  return {
    type: "orthographic",
    verticalSpan: orthographic.top - orthographic.bottom,
    zoom: orthographic.zoom,
  };
}

export function updatePointCloudOctreeNodeVisibility(
  pointCloud: PointCloudOctree,
  node: PointCloudOctreeNode,
  visibleNodes: IPointCloudTreeNode[],
): void {
  const sceneNode = node.sceneNode;
  sceneNode.visible = true;
  sceneNode.material = pointCloud.material;
  sceneNode.updateMatrix();
  sceneNode.matrixWorld.multiplyMatrices(
    pointCloud.matrixWorld,
    sceneNode.matrix,
  );

  node.pcIndex = pointCloud.visibleNodes.length;
  visibleNodes.push(node);
  pointCloud.visibleNodes.push(node);

  updatePointCloudOctreeNodeBoundingBoxVisibility(pointCloud, node);
}

export function resetPointCloudOctreeRenderedVisibility(
  pointCloud: PointCloudOctree,
): void {
  const visibleNodes = pointCloud.visibleNodes;

  for (let i = 0; i < visibleNodes.length; i++) {
    visibleNodes[i].sceneNode.visible = false;
  }

  for (const boundingBoxNode of pointCloud.boundingBoxNodes) {
    boundingBoxNode.visible = false;
  }
}

function updatePointCloudOctreeNodeBoundingBoxVisibility(
  pointCloud: PointCloudOctree,
  node: PointCloudOctreeNode,
): void {
  if (pointCloud.showBoundingBox && !node.boundingBoxNode) {
    const boxHelper = new Box3Helper(toThreeBox3(node.boundingBox));
    boxHelper.matrixAutoUpdate = false;
    pointCloud.boundingBoxNodes.push(boxHelper);
    node.boundingBoxNode = boxHelper;
    node.boundingBoxNode.matrix.copy(pointCloud.matrixWorld);
  } else if (pointCloud.showBoundingBox && node.boundingBoxNode) {
    node.boundingBoxNode.visible = true;
    node.boundingBoxNode.matrix.copy(pointCloud.matrixWorld);
  } else if (!pointCloud.showBoundingBox && node.boundingBoxNode) {
    node.boundingBoxNode.visible = false;
  }
}
