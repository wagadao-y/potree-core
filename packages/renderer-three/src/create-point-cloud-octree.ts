import type { IPotree, LoadedPointCloud } from "potree-core";
import type { PointCloudMaterial } from "./materials";
import { PointCloudOctree } from "./point-cloud-octree";

export function createPointCloudOctree(
  potree: IPotree,
  pointCloud: LoadedPointCloud,
  material?: PointCloudMaterial,
): PointCloudOctree {
  return new PointCloudOctree(potree, pointCloud, material);
}
