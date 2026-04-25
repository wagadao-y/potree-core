import { createChildBox3 } from "../core/box3-like-utils";
import type { Box3Like } from "../core/types";
import { OctreeGeometryNode } from "./OctreeGeometryNode";

function createChildAABB(aabb: Box3Like, index: number) {
  return createChildBox3(aabb, index);
}

export function parseOctreeHierarchy(
  node: OctreeGeometryNode,
  buffer: ArrayBuffer,
): void {
  const view = new DataView(buffer);
  const bytesPerNode = 22;
  const numNodes = buffer.byteLength / bytesPerNode;
  const octree = node.octreeGeometry;

  const nodes: OctreeGeometryNode[] = new Array(numNodes);
  nodes[0] = node;
  let nodePos = 1;

  for (let i = 0; i < numNodes; i++) {
    const current = nodes[i];

    const type = view.getUint8(i * bytesPerNode + 0);
    const childMask = view.getUint8(i * bytesPerNode + 1);
    const numPoints = view.getUint32(i * bytesPerNode + 2, true);
    const byteOffset = view.getBigInt64(i * bytesPerNode + 6, true);
    const byteSize = view.getBigInt64(i * bytesPerNode + 14, true);

    if (current.nodeType === 2) {
      current.byteOffset = byteOffset;
      current.byteSize = byteSize;
      current.numPoints = numPoints;
    } else if (type === 2) {
      current.hierarchyByteOffset = byteOffset;
      current.hierarchyByteSize = byteSize;
      current.numPoints = numPoints;
    } else {
      current.byteOffset = byteOffset;
      current.byteSize = byteSize;
      current.numPoints = numPoints;
    }

    current.nodeType = type;

    if (current.nodeType === 2) {
      continue;
    }

    for (let childIndex = 0; childIndex < 8; childIndex++) {
      const childExists = ((1 << childIndex) & childMask) !== 0;

      if (!childExists) {
        continue;
      }

      const childName = current.name + childIndex;
      const childAABB = createChildAABB(current.boundingBox, childIndex);
      const child = new OctreeGeometryNode(childName, octree, childAABB);
      child.name = childName;
      child.spacing = current.spacing / 2;
      child.level = current.level + 1;

      (current.children as any)[childIndex] = child;
      child.parent = current;

      nodes[nodePos] = child;
      nodePos++;
    }
  }
}
