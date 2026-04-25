import {
  Box3,
  type Camera,
  Object3D,
  Vector3,
  type WebGLRenderer,
} from "three";
import type { OctreeGeometryNode } from "../loading/OctreeGeometryNode";
import { PointCloudMaterial } from "../materials";
import type { PointCloudOctree } from "../point-cloud-octree";
import { computeTransformedBoundingBox } from "./bounds";
import { toThreeBox3 } from "./box3-like";
import type { PointCloudOctreeNode } from "./point-cloud-octree-node";
import { materializePointCloudOctreeNode } from "./point-cloud-octree-scene";

const pointCloudVisibleBounds = new WeakMap<PointCloudOctree, Box3>();

function getPointCloudVisibleBoundsState(pointCloud: PointCloudOctree): Box3 {
  let visibleBounds = pointCloudVisibleBounds.get(pointCloud);
  if (visibleBounds === undefined) {
    visibleBounds = new Box3();
    pointCloudVisibleBounds.set(pointCloud, visibleBounds);
  }

  return visibleBounds;
}

export class PointCloudOctreeRendererAdapter {
  public createDefaultMaterial(
    pointCloudGeometry: PointCloudOctree["pcoGeometry"],
  ): PointCloudMaterial {
    return createDefaultPointCloudMaterial(pointCloudGeometry);
  }

  public updateMaterialBounds(
    pointCloud: PointCloudOctree,
    material: PointCloudMaterial,
  ): void {
    updatePointCloudMaterialBounds(pointCloud, material);
  }

  public materializeTreeNode(
    pointCloud: PointCloudOctree,
    geometryNode: OctreeGeometryNode,
    parent?: PointCloudOctreeNode | null,
  ): PointCloudOctreeNode {
    return materializePointCloudOctreeNode(pointCloud, geometryNode, parent);
  }

  public updateVisibleBounds(pointCloud: PointCloudOctree): void {
    updatePointCloudVisibleBounds(pointCloud);
  }

  public updateBoundingBoxes(pointCloud: PointCloudOctree): void {
    updatePointCloudBoundingBoxes(pointCloud);
  }

  public hideDescendants(object: Object3D): void {
    hidePointCloudDescendants(object);
  }

  public moveToOrigin(pointCloud: PointCloudOctree): void {
    movePointCloudToOrigin(pointCloud);
  }

  public moveToGroundPlane(pointCloud: PointCloudOctree): void {
    movePointCloudToGroundPlane(pointCloud);
  }

  public getBoundingBoxWorld(pointCloud: PointCloudOctree): Box3 {
    return getPointCloudBoundingBoxWorld(pointCloud);
  }

  public getVisibleExtent(pointCloud: PointCloudOctree): Box3 {
    return getPointCloudVisibleExtent(pointCloud);
  }

  public dispose(pointCloud: PointCloudOctree): void {
    disposePointCloudVisibleBounds(pointCloud);
  }
}

export const pointCloudOctreeRendererAdapter =
  new PointCloudOctreeRendererAdapter();

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

export function getPointCloudVisibleExtent(pointCloud: PointCloudOctree): Box3 {
  return getPointCloudVisibleBoundsState(pointCloud)
    .clone()
    .applyMatrix4(pointCloud.matrixWorld);
}

export function disposePointCloudVisibleBounds(
  pointCloud: PointCloudOctree,
): void {
  pointCloudVisibleBounds.delete(pointCloud);
}
