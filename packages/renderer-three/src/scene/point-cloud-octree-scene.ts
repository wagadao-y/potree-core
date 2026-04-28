import type { IPointCloudTreeNode, OctreeGeometryNode } from "potree-core/core";
import { Box3, type Object3D, Points, Vector3 } from "three";
import { materializeOctreeNodeGeometry } from "../geometry/octree-node-geometry";
import { PointCloudOctreeNode } from "../geometry/point-cloud-octree-node";
import { PointCloudMaterial } from "../materials";
import { Box3Helper } from "../math/box3-helper";
import { toThreeBox3 } from "../math/box3-like";
import type { ThreePointCloudVisibilityTarget } from "../types";

export function createPointCloudOctreeNode(
  pointCloud: ThreePointCloudVisibilityTarget,
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
  pointCloud: ThreePointCloudVisibilityTarget,
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
      parent.children[geometryNode.index] = geometryNode;
    });
  } else {
    pointCloud.root = node;
    pointCloud.add(points);
  }

  return node;
}

export function updatePointCloudOctreeNodeVisibility(
  pointCloud: ThreePointCloudVisibilityTarget,
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
  pointCloud: ThreePointCloudVisibilityTarget,
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
  pointCloud: ThreePointCloudVisibilityTarget,
  node: PointCloudOctreeNode,
): void {
  if (pointCloud.showBoundingBox && !node.boundingBoxNode) {
    const boxHelper = new Box3Helper(toThreeBox3(node.boundingBox, new Box3()));
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

export function movePointCloudToOrigin(
  pointCloud: ThreePointCloudVisibilityTarget,
): void {
  pointCloud.position.set(0, 0, 0);
  pointCloud.position
    .set(0, 0, 0)
    .sub(pointCloud.getBoundingBoxWorld().getCenter(new Vector3()));
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
