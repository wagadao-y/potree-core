import { BufferAttribute, BufferGeometry } from "three";
import type { OctreeGeometryNode } from "../loading/OctreeGeometryNode";
import { toThreeBox3 } from "./box3-like";

export function materializeOctreeNodeGeometry(
  geometryNode: OctreeGeometryNode,
): BufferGeometry {
  if (geometryNode.geometry != null) {
    return geometryNode.geometry;
  }

  const decodedPointAttributes = geometryNode.decodedPointAttributes;
  if (decodedPointAttributes === null) {
    throw new Error(
      `Decoded point attributes are not available for node ${geometryNode.name}`,
    );
  }

  const geometry = new BufferGeometry();
  geometry.boundingBox = toThreeBox3(geometryNode.boundingBox);

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

    if (property === "color") {
      geometry.setAttribute(
        "color",
        new BufferAttribute(new Uint8Array(buffer), 3, true),
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

    if (property === "classification") {
      geometry.setAttribute(
        "classification",
        new BufferAttribute(new Uint8Array(buffer), 1),
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

  if (!geometry.getAttribute("normal")) {
    const positionAttribute = geometry.getAttribute("position");
    if (positionAttribute) {
      geometry.setAttribute(
        "normal",
        new BufferAttribute(new Float32Array(positionAttribute.count * 3), 3),
      );
    }
  }

  geometryNode.geometry = geometry;
  geometryNode.decodedPointAttributes = null;
  return geometry;
}
