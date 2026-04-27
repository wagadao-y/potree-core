import type { LoadedPointCloud, OctreeGeometryNode } from "potree-core";
import type { IPointCloudVisibilityTarget } from "potree-core/core";
import type { Box3, Matrix4, Object3D, Vector3 } from "three";
import type { PointCloudOctreeNode } from "./geometry/point-cloud-octree-node";
import type { PointCloudMaterial } from "./materials";
import type { PointCloudOctree } from "./point-cloud-octree";

export type {
  IPotree,
  IVisibilityUpdateResult,
  LoadedPointCloud,
} from "potree-core";

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
