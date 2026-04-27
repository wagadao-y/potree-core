import { PointCloudOctree } from "../point-cloud-octree";
import type { IPotree, LoadedPointCloud } from "../types";
import type { PointCloudMaterial } from "./materials";

export function createPointCloudOctree(
  potree: IPotree,
  pointCloud: LoadedPointCloud,
  material?: PointCloudMaterial,
): PointCloudOctree {
  return new PointCloudOctree(potree, pointCloud, material);
}
