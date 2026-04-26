import type { PotreeLoadMeasurement } from "./LoadInstrumentation";
import type { PendingOctreeNode } from "./octree-range-cache";

export function createOctreeSliceReadMeasurement<
  TNode extends {
    name: string;
    numPoints: number;
  },
>(
  pendingNode: PendingOctreeNode<TNode>,
  durationMs: number,
  fetchedByteSize: number,
  mergedNodeCount: number,
  cacheHit: boolean,
): PotreeLoadMeasurement {
  return {
    stage: "octree-slice-read",
    nodeName: pendingNode.node.name,
    durationMs,
    byteSize: Number(pendingNode.byteSize),
    numPoints: pendingNode.node.numPoints,
    metadata: {
      cacheHit,
      fetchedByteSize,
      mergedNodeCount,
    },
  };
}
