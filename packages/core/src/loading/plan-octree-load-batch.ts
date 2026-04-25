import type { OctreeGeometryNode } from "./OctreeGeometryNode";
import type { PendingOctreeNode } from "./octree-range-cache";

export interface OctreeLoadBatchPlan {
  loadableNodes: OctreeGeometryNode[];
  zeroByteNodes: OctreeGeometryNode[];
  pendingNodes: PendingOctreeNode<OctreeGeometryNode>[];
  decodeNodes: Set<OctreeGeometryNode>;
}

export function planOctreeLoadBatch(
  nodes: OctreeGeometryNode[],
  candidates: OctreeGeometryNode[],
): OctreeLoadBatchPlan {
  const loadableNodes: OctreeGeometryNode[] = [];

  for (const node of nodes) {
    if (
      !node.loaded &&
      !node.loading &&
      !node.octreeGeometry.disposed &&
      node.octreeGeometry.numNodesLoading <
        node.octreeGeometry.maxNumNodesLoading
    ) {
      node.loading = true;
      node.octreeGeometry.numNodesLoading++;
      loadableNodes.push(node);
    }
  }

  const zeroByteNodes: OctreeGeometryNode[] = [];
  const pendingNodes: PendingOctreeNode<OctreeGeometryNode>[] = [];
  const decodeNodes = new Set(loadableNodes);

  for (const node of candidates) {
    const { byteOffset, byteSize } = node;

    if (byteOffset === undefined || byteSize === undefined) {
      if (!decodeNodes.has(node)) {
        continue;
      }
      throw new Error("byteOffset and byteSize are required");
    }

    if (byteSize === BigInt(0)) {
      if (!decodeNodes.has(node)) {
        continue;
      }
      zeroByteNodes.push(node);
      continue;
    }

    pendingNodes.push({
      node,
      byteOffset,
      byteSize,
      endExclusive: byteOffset + byteSize,
    });
  }

  return {
    loadableNodes,
    zeroByteNodes,
    pendingNodes,
    decodeNodes,
  };
}
