import type { PotreeLoadMeasurement } from "./LoadInstrumentation";
import { createOctreeSliceReadMeasurement } from "./octree-load-measurements";
import {
  createMergedOctreeRanges,
  type MergedOctreeRange,
  type OctreeRangeCache,
  type PendingOctreeNode,
  sliceCachedOctreeBuffer,
} from "./octree-range-cache";

interface LoadMergedOctreeRangesOptions<
  TNode extends { name: string; numPoints: number },
> {
  pendingNodes: PendingOctreeNode<TNode>[];
  decodeNodes: Set<TNode>;
  octreeRangeCache: OctreeRangeCache;
  emitMeasurement: (measurement: PotreeLoadMeasurement) => void;
  decodeNode: (node: TNode, buffer: ArrayBuffer) => Promise<void>;
}

export function loadMergedOctreeRanges<
  TNode extends { name: string; numPoints: number },
>({
  pendingNodes,
  decodeNodes,
  octreeRangeCache,
  emitMeasurement,
  decodeNode,
}: LoadMergedOctreeRangesOptions<TNode>): Promise<void>[] {
  const ranges = createMergedOctreeRanges(pendingNodes).filter((range) =>
    range.nodes.some((pendingNode) => decodeNodes.has(pendingNode.node)),
  );

  return ranges.map((range) =>
    loadMergedOctreeRange({
      range,
      decodeNodes,
      octreeRangeCache,
      emitMeasurement,
      decodeNode,
    }),
  );
}

interface LoadMergedOctreeRangeOptions<
  TNode extends { name: string; numPoints: number },
> {
  range: MergedOctreeRange<TNode>;
  decodeNodes: Set<TNode>;
  octreeRangeCache: OctreeRangeCache;
  emitMeasurement: (measurement: PotreeLoadMeasurement) => void;
  decodeNode: (node: TNode, buffer: ArrayBuffer) => Promise<void>;
}

async function loadMergedOctreeRange<
  TNode extends { name: string; numPoints: number },
>({
  range,
  decodeNodes,
  octreeRangeCache,
  emitMeasurement,
  decodeNode,
}: LoadMergedOctreeRangeOptions<TNode>): Promise<void> {
  const urlOctree = await octreeRangeCache.getOctreeUrl();
  const cachedBuffer = await octreeRangeCache.readFromOctreeCache(
    urlOctree,
    range.start,
    range.endExclusive,
  );

  const decodePendingNodes = range.nodes.filter((pendingNode) =>
    decodeNodes.has(pendingNode.node),
  );

  if (cachedBuffer !== null) {
    await Promise.all(
      decodePendingNodes.map((pendingNode) => {
        const buffer = sliceCachedOctreeBuffer(
          cachedBuffer,
          range.start,
          pendingNode.byteOffset,
          pendingNode.endExclusive,
        );
        emitMeasurement(
          createOctreeSliceReadMeasurement(
            pendingNode,
            0,
            0,
            range.nodes.length,
            true,
          ),
        );
        return decodeNode(pendingNode.node, buffer);
      }),
    );
    return;
  }

  const readStartedAt = performance.now();
  const fetchedBuffer = await octreeRangeCache.fetchOctreeRange(
    urlOctree,
    range.start,
    range.endExclusive,
  );
  const readDurationMs = performance.now() - readStartedAt;

  await Promise.all(
    decodePendingNodes.map((pendingNode, index) => {
      const buffer = sliceCachedOctreeBuffer(
        fetchedBuffer,
        range.start,
        pendingNode.byteOffset,
        pendingNode.endExclusive,
      );
      emitMeasurement(
        createOctreeSliceReadMeasurement(
          pendingNode,
          index === 0 ? readDurationMs : 0,
          index === 0 ? fetchedBuffer.byteLength : 0,
          range.nodes.length,
          index !== 0,
        ),
      );
      return decodeNode(pendingNode.node, buffer);
    }),
  );
}
