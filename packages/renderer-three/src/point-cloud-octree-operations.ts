import type { IPointCloudTreeNode } from "potree-core/core";
import type {
  Camera,
  Intersection,
  Ray,
  Raycaster,
  WebGLRenderer,
} from "three";
import { pointCloudOctreeRendererAdapter } from "./adapters/point-cloud-octree-renderer";
import {
  disposePointCloudOctreePicker,
  type PickParams,
  pickPointCloud,
} from "./picking/point-cloud-octree-picker";
import type { PointCloudOctree } from "./point-cloud-octree";
import type { PickPoint } from "./types";

export function disposePointCloudOctree(pointCloud: PointCloudOctree): void {
  if (pointCloud.root) {
    pointCloud.root.dispose();
  }

  pointCloud.pcoGeometry.root.traverse((node: IPointCloudTreeNode) => {
    return pointCloud.potree.lru.remove(node);
  });
  pointCloud.pcoGeometry.dispose();
  pointCloud.material.dispose();

  pointCloud.visibleNodes = [];
  pointCloud.visibleGeometry = [];

  disposePointCloudOctreePicker(pointCloud);
  pointCloudOctreeRendererAdapter.dispose(pointCloud);

  pointCloud.disposed = true;
}

export function pickPointCloudOctree(
  pointCloud: PointCloudOctree,
  renderer: WebGLRenderer,
  camera: Camera,
  ray: Ray,
  params: Partial<PickParams> = {},
): PickPoint | null {
  return pickPointCloud(pointCloud, renderer, camera, ray, params);
}

export function raycastPointCloudOctree(
  pointCloud: PointCloudOctree,
  raycaster: Raycaster,
  intersects: Intersection[],
): void {
  for (const node of pointCloud.visibleNodes) {
    const sceneNode = node.sceneNode;
    if (sceneNode && !sceneNode.layers.test(raycaster.layers)) {
      sceneNode.raycast(raycaster, intersects);
    }
  }
}
