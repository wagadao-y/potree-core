import { BufferAttribute, BufferGeometry } from "three";
import type { PointCloudOctreeGeometryNode } from "../point-cloud-octree-geometry-node";

export function materializeOctreeNodeGeometry(
  geometryNode: PointCloudOctreeGeometryNode,
): BufferGeometry {
  if (geometryNode.geometry !== null) {
    return geometryNode.geometry;
  }

  const decodedPointAttributes = geometryNode.decodedPointAttributes;
  if (decodedPointAttributes === null) {
    throw new Error(
      `Decoded point attributes are not available for node ${geometryNode.name}`,
    );
  }

  const geometry = new BufferGeometry();

  for (const property in decodedPointAttributes) {
    const decodedAttribute = decodedPointAttributes[property];
    const buffer = decodedAttribute.buffer;

    if (property === "position") {
      geometry.setAttribute(
        "position",
        new BufferAttribute(new Float32Array(buffer), 3),
      );
      continue;
    }

    if (property === "rgba") {
      geometry.setAttribute(
        "rgba",
        new BufferAttribute(new Uint8Array(buffer), 4, true),
      );
      continue;
    }

    if (property === "NORMAL") {
      geometry.setAttribute(
        "normal",
        new BufferAttribute(new Float32Array(buffer), 3),
      );
      continue;
    }

    if (property === "INDICES") {
      const bufferAttribute = new BufferAttribute(new Uint8Array(buffer), 4);
      bufferAttribute.normalized = true;
      geometry.setAttribute("indices", bufferAttribute);
      continue;
    }

    const bufferAttribute: BufferAttribute & {
      potree?: object;
    } = new BufferAttribute(new Float32Array(buffer), 1);

    bufferAttribute.potree = {
      offset: decodedAttribute.offset,
      scale: decodedAttribute.scale,
      preciseBuffer: decodedAttribute.preciseBuffer,
      range: decodedAttribute.attribute?.range,
    };

    geometry.setAttribute(property, bufferAttribute);
  }

  geometryNode.geometry = geometry;
  geometryNode.decodedPointAttributes = null;
  return geometry;
}