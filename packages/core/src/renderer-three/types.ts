import type { Vector3 } from "three";
import type { PointCloudOctree } from "../point-cloud-octree";

export type { IPotree } from "../types";

export interface PickPoint {
  position?: Vector3;
  normal?: Vector3;
  pointCloud?: PointCloudOctree;
  [property: string]: any;
}
