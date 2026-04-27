import type { Box3, Matrix4, Object3D, Vector3 } from "three";
import type { IPointCloudVisibilityTarget } from "../core/types";
import type { OctreeGeometryNode } from "../loading/OctreeGeometryNode";
import type { PointCloudOctree } from "../point-cloud-octree";
import type { LoadedPointCloud } from "../types";
import type { PointCloudOctreeNode } from "./geometry/point-cloud-octree-node";
import type { PointCloudMaterial } from "./materials";

export type { IPotree } from "../types";

export interface ThreePointCloudVisibilityTarget
  extends IPointCloudVisibilityTarget<
    OctreeGeometryNode,
    PointCloudOctreeNode
  > {
  disposed: boolean;
  pcoGeometry: LoadedPointCloud;
  boundingBox: Box3;
  material: PointCloudMaterial;
  boundingBoxNodes: Object3D[];
  showBoundingBox: boolean;
  matrixWorld: Matrix4;
  position: Vector3;
  scale: Vector3;
  parent: Object3D | null;
  add(object: Object3D): this;
  updateMatrixWorld(force: boolean): void;
  getBoundingBoxWorld(): Box3;
}

export interface PickPoint {
  position?: Vector3;
  normal?: Vector3;
  pointCloud?: PointCloudOctree;
  [property: string]: any;
}
