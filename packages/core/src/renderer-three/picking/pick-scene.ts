import { Points, type Ray, Sphere } from "three";
import { PointCloudMaterial } from "../../materials";
import type { PointCloudOctree } from "../../point-cloud-octree";
import type { PointCloudOctreeNode } from "../geometry/point-cloud-octree-node";

const helperSphere = new Sphere();

export function nodesOnRay(
  octree: PointCloudOctree,
  ray: Ray,
): PointCloudOctreeNode[] {
  const pickedNodes: PointCloudOctreeNode[] = [];
  const rayClone = ray.clone();

  for (const node of octree.visibleNodes) {
    const sphere = helperSphere
      .copy(node.boundingSphere)
      .applyMatrix4(octree.matrixWorld);

    if (rayClone.intersectsSphere(sphere)) {
      pickedNodes.push(node);
    }
  }

  return pickedNodes;
}

export function createTempNodes(
  octree: PointCloudOctree,
  nodes: PointCloudOctreeNode[],
  pickMaterial: PointCloudMaterial,
  nodeIndexOffset: number,
): Points[] {
  const tempNodes: Points[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const sceneNode = node.sceneNode;
    const tempNode = new Points(sceneNode.geometry, pickMaterial);
    tempNode.matrix = sceneNode.matrixWorld;
    tempNode.matrixWorld = sceneNode.matrixWorld;
    tempNode.matrixAutoUpdate = false;
    tempNode.frustumCulled = false;
    tempNode.layers.enableAll();

    const nodeIndex = nodeIndexOffset + i + 1;
    if (nodeIndex > 255) {
      throw Error("More than 255 nodes for pick are not supported.");
    }

    tempNode.onBeforeRender = PointCloudMaterial.makeOnBeforeRender(
      octree,
      node,
      nodeIndex,
    );

    tempNodes.push(tempNode);
  }

  return tempNodes;
}
