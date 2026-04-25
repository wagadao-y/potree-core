import type { RequestManager } from "./RequestManager";

const MAX_MERGED_OCTREE_RANGE_BYTES = BigInt(2 * 1024 * 1024);
const MAX_MERGED_OCTREE_RANGE_GAP_BYTES = BigInt(0);
const MAX_OCTREE_RANGE_CACHE_BYTES = 64 * 1024 * 1024;

interface OctreeReadCacheEntry {
  url: string;
  start: bigint;
  endExclusive: bigint;
  buffer?: ArrayBuffer;
  promise?: Promise<ArrayBuffer>;
}

export interface PendingOctreeNode<TNode> {
  node: TNode;
  byteOffset: bigint;
  byteSize: bigint;
  endExclusive: bigint;
}

export interface MergedOctreeRange<TNode> {
  start: bigint;
  endExclusive: bigint;
  nodes: PendingOctreeNode<TNode>[];
}

export class OctreeRangeCache {
  private octreeUrlPromise?: Promise<string>;

  private octreeReadCaches: OctreeReadCacheEntry[] = [];

  public constructor(
    private readonly url: string,
    private readonly requestManager: RequestManager,
  ) {}

  public async getOctreeUrl() {
    this.octreeUrlPromise ??= this.requestManager
      .getUrl(this.url)
      .then((url) => url.replace("/metadata.json", "/octree.bin"));

    return this.octreeUrlPromise;
  }

  public async readFromOctreeCache(
    url: string,
    start: bigint,
    endExclusive: bigint,
  ) {
    const cache = this.octreeReadCaches.find((entry) => {
      return (
        entry.url === url &&
        start >= entry.start &&
        endExclusive <= entry.endExclusive
      );
    });

    if (cache === undefined) {
      return null;
    }

    let buffer = cache.buffer;

    if (buffer === undefined) {
      try {
        buffer = await cache.promise;
      } catch (error) {
        this.octreeReadCaches = this.octreeReadCaches.filter(
          (entry) => entry !== cache,
        );
        throw error;
      }
    }

    if (buffer === undefined) {
      return null;
    }

    cache.buffer = buffer;
    cache.endExclusive = cache.start + BigInt(buffer.byteLength);

    if (endExclusive > cache.endExclusive) {
      return null;
    }

    return sliceCachedOctreeBuffer(buffer, cache.start, start, endExclusive);
  }

  public async fetchOctreeRange(
    urlOctree: string,
    start: bigint,
    endExclusive: bigint,
  ) {
    const fetchPromise = this.requestManager
      .fetch(urlOctree, {
        headers: {
          "content-type": "multipart/byteranges",
          Range: `bytes=${start}-${endExclusive - BigInt(1)}`,
        },
      })
      .then((response) => response.arrayBuffer());

    const cache: OctreeReadCacheEntry = {
      url: urlOctree,
      start,
      endExclusive,
      promise: fetchPromise,
    };
    this.octreeReadCaches.push(cache);

    try {
      const buffer = await fetchPromise;
      cache.buffer = buffer;
      cache.endExclusive = start + BigInt(buffer.byteLength);
      this.pruneOctreeReadCaches();
      return buffer;
    } catch (error) {
      this.octreeReadCaches = this.octreeReadCaches.filter(
        (entry) => entry !== cache,
      );
      throw error;
    }
  }

  private pruneOctreeReadCaches() {
    let totalBytes = this.octreeReadCaches.reduce(
      (total, cache) => total + (cache.buffer?.byteLength ?? 0),
      0,
    );

    while (
      totalBytes > MAX_OCTREE_RANGE_CACHE_BYTES &&
      this.octreeReadCaches.length > 1
    ) {
      const cache = this.octreeReadCaches.shift();
      totalBytes -= cache?.buffer?.byteLength ?? 0;
    }
  }
}

export function sliceCachedOctreeBuffer(
  buffer: ArrayBuffer,
  cacheStart: bigint,
  start: bigint,
  endExclusive: bigint,
) {
  const sliceStart = Number(start - cacheStart);
  const sliceEnd = Number(endExclusive - cacheStart);
  return buffer.slice(sliceStart, sliceEnd);
}

export function createMergedOctreeRanges<TNode>(
  pendingNodes: PendingOctreeNode<TNode>[],
): MergedOctreeRange<TNode>[] {
  const sortedNodes = [...pendingNodes].sort((a, b) =>
    compareBigInts(a.byteOffset, b.byteOffset),
  );
  const ranges: MergedOctreeRange<TNode>[] = [];

  for (const pendingNode of sortedNodes) {
    const nodeRangeSize = pendingNode.byteSize;
    const currentRange = ranges.at(-1);

    if (
      currentRange === undefined ||
      nodeRangeSize > MAX_MERGED_OCTREE_RANGE_BYTES
    ) {
      ranges.push({
        start: pendingNode.byteOffset,
        endExclusive: pendingNode.endExclusive,
        nodes: [pendingNode],
      });
      continue;
    }

    const gap =
      pendingNode.byteOffset > currentRange.endExclusive
        ? pendingNode.byteOffset - currentRange.endExclusive
        : BigInt(0);
    const mergedEndExclusive =
      pendingNode.endExclusive > currentRange.endExclusive
        ? pendingNode.endExclusive
        : currentRange.endExclusive;
    const mergedByteSize = mergedEndExclusive - currentRange.start;

    if (
      gap <= MAX_MERGED_OCTREE_RANGE_GAP_BYTES &&
      mergedByteSize <= MAX_MERGED_OCTREE_RANGE_BYTES
    ) {
      currentRange.endExclusive = mergedEndExclusive;
      currentRange.nodes.push(pendingNode);
      continue;
    }

    ranges.push({
      start: pendingNode.byteOffset,
      endExclusive: pendingNode.endExclusive,
      nodes: [pendingNode],
    });
  }

  return ranges;
}

function compareBigInts(a: bigint, b: bigint) {
  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
}
