import { Points } from "three";
import { OctreeGeometry } from "../loading2/OctreeGeometry";
import { PointCloudMaterial } from "../materials";
import type { PointCloudOctree } from "../point-cloud-octree";
import type { PointCloudOctreeGeometryNode } from "../point-cloud-octree-geometry-node";
import { PointCloudOctreeNode } from "../point-cloud-octree-node";
import type { PCOGeometry } from "./types";
import { computeTransformedBoundingBox } from "../utils/bounds";

export function createDefaultPointCloudMaterial(
  pcoGeometry: PCOGeometry,
): PointCloudMaterial {
  return pcoGeometry instanceof OctreeGeometry
    ? new PointCloudMaterial({ newFormat: true })
    : new PointCloudMaterial();
}

export function updatePointCloudMaterialBounds(
  pointCloud: PointCloudOctree,
  material: PointCloudMaterial,
): void {
  pointCloud.updateMatrixWorld(true);

  const { min, max } = computeTransformedBoundingBox(
    pointCloud.pcoGeometry.tightBoundingBox || pointCloud.getBoundingBoxWorld(),
    pointCloud.matrixWorld,
  );

  const bWidth = max.z - min.z;
  material.heightMin = min.z - 0.2 * bWidth;
  material.heightMax = max.z + 0.2 * bWidth;
}

export function createPointCloudOctreeNode(
  pointCloud: PointCloudOctree,
  geometryNode: PointCloudOctreeGeometryNode,
): PointCloudOctreeNode {
  const points = new Points(geometryNode.geometry, pointCloud.material);
  const node = new PointCloudOctreeNode(geometryNode, points);
  points.name = geometryNode.name;
  points.position.copy(geometryNode.boundingBox.min);
  points.frustumCulled = false;
  points.onBeforeRender = PointCloudMaterial.makeOnBeforeRender(pointCloud, node);
  return node;
}