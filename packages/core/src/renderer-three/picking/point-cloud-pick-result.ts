import { type BufferAttribute, type Points, Vector3, Vector4 } from "three";
import type { PointCloudHit } from "../../types";
import type { PointCloudOctreeNode } from "../geometry/point-cloud-octree-node";
import type { PointCloudOctree } from "../point-cloud-octree";
import type { PickPoint } from "../types";

export interface RenderedNode {
  node: PointCloudOctreeNode;
  octree: PointCloudOctree;
}

export function findPointCloudPickHit(
  pixels: Uint8Array,
  pickWindowSize: number,
): PointCloudHit | null {
  const ibuffer = new Uint32Array(pixels.buffer);

  let minDistance = Number.MAX_VALUE;
  let hit: PointCloudHit | null = null;

  for (let x = 0; x < pickWindowSize; x++) {
    for (let y = 0; y < pickWindowSize; y++) {
      const offset = x + y * pickWindowSize;
      const distance =
        (x - (pickWindowSize - 1) / 2) ** 2 +
        (y - (pickWindowSize - 1) / 2) ** 2;

      const pointCloudIndex = pixels[4 * offset + 3];
      pixels[4 * offset + 3] = 0;
      const pointIndex = ibuffer[offset];

      if (pointCloudIndex > 0 && distance < minDistance) {
        hit = {
          pIndex: pointIndex,
          pcIndex: pointCloudIndex - 1,
        };
        minDistance = distance;
      }
    }
  }

  return hit;
}

export function getPointCloudPickPoint(
  hit: PointCloudHit | null,
  nodes: RenderedNode[],
): PickPoint | null {
  if (!hit) {
    return null;
  }

  const point: PickPoint = {};
  const points = nodes[hit.pcIndex]?.node.sceneNode;

  if (!points) {
    return null;
  }

  point.pointCloud = nodes[hit.pcIndex].octree;

  const attributes: BufferAttribute[] = (points.geometry as any).attributes;

  for (const property in attributes) {
    if (!Object.hasOwn(attributes, property)) {
      continue;
    }

    const values = attributes[property];

    if (property === "position") {
      addPositionToPickPoint(point, hit, values, points);
    } else if (property === "normal") {
      addNormalToPickPoint(point, hit, values, points);
    } else if (property === "indices") {
    } else if (values.itemSize === 1) {
      point[property] = values.array[hit.pIndex];
    } else {
      const value: number[] = [];
      for (let index = 0; index < values.itemSize; index++) {
        value.push(values.array[values.itemSize * hit.pIndex + index]);
      }
      point[property] = value;
    }
  }

  return point;
}

function addPositionToPickPoint(
  point: PickPoint,
  hit: PointCloudHit,
  values: BufferAttribute,
  points: Points,
): void {
  point.position = new Vector3()
    .fromBufferAttribute(values, hit.pIndex)
    .applyMatrix4(points.matrixWorld);
}

function addNormalToPickPoint(
  point: PickPoint,
  hit: PointCloudHit,
  values: BufferAttribute,
  points: Points,
): void {
  const normal = new Vector3().fromBufferAttribute(values, hit.pIndex);
  const normal4 = new Vector4(normal.x, normal.y, normal.z, 0).applyMatrix4(
    points.matrixWorld,
  );
  normal.set(normal4.x, normal4.y, normal4.z);

  point.normal = normal;
}
