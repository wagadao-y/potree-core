import type { OctreeGeometryNode } from "potree-core/core";
import {
  Box3,
  type Camera,
  Object3D,
  Vector3,
  type WebGLRenderer,
} from "three";
import type { PointCloudOctreeNode } from "../geometry/point-cloud-octree-node";
import { PointCloudMaterial } from "../materials";
import { computeTransformedBoundingBox } from "../math/bounds";
import { toThreeBox3 } from "../math/box3-like";
import { materializePointCloudOctreeNode } from "../scene/point-cloud-octree-scene";
import type { ThreePointCloudVisibilityTarget } from "../types";

const pointCloudVisibleBounds = new WeakMap<
  ThreePointCloudVisibilityTarget,
  Box3
>();

function getPointCloudVisibleBoundsState(
  pointCloud: ThreePointCloudVisibilityTarget,
): Box3 {
  let visibleBounds = pointCloudVisibleBounds.get(pointCloud);
  if (visibleBounds === undefined) {
    visibleBounds = new Box3();
    pointCloudVisibleBounds.set(pointCloud, visibleBounds);
  }

  return visibleBounds;
}

export class PointCloudOctreeRendererAdapter {
  public createDefaultMaterial(
    pointCloudGeometry: ThreePointCloudVisibilityTarget["pcoGeometry"],
  ): PointCloudMaterial {
    return createDefaultPointCloudMaterial(pointCloudGeometry);
  }

  public updateMaterialBounds(
    pointCloud: ThreePointCloudVisibilityTarget,
    material: PointCloudMaterial,
  ): void {
    updatePointCloudMaterialBounds(pointCloud, material);
  }

  public materializeTreeNode(
    pointCloud: ThreePointCloudVisibilityTarget,
    geometryNode: OctreeGeometryNode,
    parent?: PointCloudOctreeNode | null,
  ): PointCloudOctreeNode {
    return materializePointCloudOctreeNode(pointCloud, geometryNode, parent);
  }

  public updateVisibleBounds(
    pointCloud: ThreePointCloudVisibilityTarget,
  ): void {
    updatePointCloudVisibleBounds(pointCloud);
  }

  public updateBoundingBoxes(
    pointCloud: ThreePointCloudVisibilityTarget,
  ): void {
    updatePointCloudBoundingBoxes(pointCloud);
  }

  public hideDescendants(object: Object3D): void {
    hidePointCloudDescendants(object);
  }

  public moveToOrigin(pointCloud: ThreePointCloudVisibilityTarget): void {
    movePointCloudToOrigin(pointCloud);
  }

  public moveToGroundPlane(pointCloud: ThreePointCloudVisibilityTarget): void {
    movePointCloudToGroundPlane(pointCloud);
  }

  public getBoundingBoxWorld(
    pointCloud: ThreePointCloudVisibilityTarget,
  ): Box3 {
    return getPointCloudBoundingBoxWorld(pointCloud);
  }

  public getVisibleExtent(pointCloud: ThreePointCloudVisibilityTarget): Box3 {
    return getPointCloudVisibleExtent(pointCloud);
  }

  public dispose(pointCloud: ThreePointCloudVisibilityTarget): void {
    disposePointCloudVisibleBounds(pointCloud);
  }
}

export const pointCloudOctreeRendererAdapter =
  new PointCloudOctreeRendererAdapter();

export function createDefaultPointCloudMaterial(
  _pcoGeometry: ThreePointCloudVisibilityTarget["pcoGeometry"],
): PointCloudMaterial {
  return new PointCloudMaterial({ newFormat: true });
}

export function updatePointCloudMaterialBounds(
  pointCloud: ThreePointCloudVisibilityTarget,
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
  pointCloud: ThreePointCloudVisibilityTarget,
  camera: Camera,
  renderer: WebGLRenderer,
): void {
  pointCloud.material.updateMaterial(
    pointCloud,
    pointCloud.visibleNodes,
    camera,
    renderer,
  );
  updatePointCloudVisibleBounds(pointCloud);
  updatePointCloudBoundingBoxes(pointCloud);
}

export function updatePointCloudVisibleBounds(
  pointCloud: ThreePointCloudVisibilityTarget,
): void {
  const visibleBounds = getPointCloudVisibleBoundsState(pointCloud);
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
  pointCloud: ThreePointCloudVisibilityTarget,
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

  bbRoot.children = visibleBoxes.filter(
    (boundingBoxNode): boundingBoxNode is Object3D => boundingBoxNode !== null,
  );
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
  pointCloud: ThreePointCloudVisibilityTarget,
): Box3 {
  pointCloud.updateMatrixWorld(true);
  return computeTransformedBoundingBox(
    pointCloud.boundingBox,
    pointCloud.matrixWorld,
  );
}

export function movePointCloudToOrigin(
  pointCloud: ThreePointCloudVisibilityTarget,
): void {
  pointCloud.position.set(0, 0, 0);
  pointCloud.position
    .set(0, 0, 0)
    .sub(getPointCloudBoundingBoxWorld(pointCloud).getCenter(new Vector3()));
}

export function movePointCloudToGroundPlane(
  pointCloud: ThreePointCloudVisibilityTarget,
): void {
  pointCloud.position.y += -getPointCloudBoundingBoxWorld(pointCloud).min.y;
}

export function getPointCloudVisibleExtent(
  pointCloud: ThreePointCloudVisibilityTarget,
): Box3 {
  return getPointCloudVisibleBoundsState(pointCloud)
    .clone()
    .applyMatrix4(pointCloud.matrixWorld);
}

export function disposePointCloudVisibleBounds(
  pointCloud: ThreePointCloudVisibilityTarget,
): void {
  pointCloudVisibleBounds.delete(pointCloud);
}
