import { describe, expect, it, vi } from "vitest";
import {
  createMergedOctreeRanges,
  OctreeRangeCache,
} from "./octree-range-cache";
import type { PotreeDatasetSource } from "./PotreeDatasetSource";
import { PotreeFetchError } from "./validate-fetch-response";

function makeBinaryResponse(
  status: number,
  bytes: number[],
  headers?: HeadersInit,
): Response {
  return new Response(new Uint8Array(bytes), {
    status,
    headers,
  });
}

describe("OctreeRangeCache", () => {
  it("resolves the octree resource url without metadata path replacement", async () => {
    const datasetSource: PotreeDatasetSource = {
      getResourceUrl: vi
        .fn<PotreeDatasetSource["getResourceUrl"]>()
        .mockResolvedValue("https://example.test/octree.bin?signature=abc"),
      fetchMetadata: vi.fn<PotreeDatasetSource["fetchMetadata"]>(),
      fetchRange: vi.fn<PotreeDatasetSource["fetchRange"]>(),
    };
    const cache = new OctreeRangeCache(datasetSource);

    await expect(cache.getOctreeUrl()).resolves.toBe(
      "https://example.test/octree.bin?signature=abc",
    );

    expect(datasetSource.getResourceUrl).toHaveBeenCalledWith("octree");
  });

  it("does not retain failed range fetches in the cache", async () => {
    const datasetSource: PotreeDatasetSource = {
      getResourceUrl: vi.fn<PotreeDatasetSource["getResourceUrl"]>(),
      fetchMetadata: vi.fn<PotreeDatasetSource["fetchMetadata"]>(),
      fetchRange: vi
        .fn<PotreeDatasetSource["fetchRange"]>()
        .mockResolvedValueOnce(
          makeBinaryResponse(200, [1, 2, 3, 4], {
            "Content-Range": "bytes 0-3/8",
          }),
        )
        .mockResolvedValueOnce(
          makeBinaryResponse(206, [5, 6, 7, 8], {
            "Content-Range": "bytes 0-3/8",
          }),
        ),
    };
    const cache = new OctreeRangeCache(datasetSource);

    await expect(
      cache.fetchOctreeRange(
        "https://example.test/octree.bin",
        BigInt(0),
        BigInt(4),
      ),
    ).rejects.toBeInstanceOf(PotreeFetchError);

    const buffer = await cache.fetchOctreeRange(
      "https://example.test/octree.bin",
      BigInt(0),
      BigInt(4),
    );

    expect(Array.from(new Uint8Array(buffer))).toEqual([5, 6, 7, 8]);
    expect(datasetSource.fetchRange).toHaveBeenCalledTimes(2);

    const cached = await cache.readFromOctreeCache(
      "https://example.test/octree.bin",
      BigInt(0),
      BigInt(4),
    );

    expect(Array.from(new Uint8Array(cached!))).toEqual([5, 6, 7, 8]);
  });

  it("merges contiguous pending node ranges into a single request range", () => {
    const ranges = createMergedOctreeRanges([
      {
        node: "b",
        byteOffset: BigInt(4),
        byteSize: BigInt(4),
        endExclusive: BigInt(8),
      },
      {
        node: "a",
        byteOffset: BigInt(0),
        byteSize: BigInt(4),
        endExclusive: BigInt(4),
      },
    ]);

    expect(ranges).toEqual([
      {
        start: BigInt(0),
        endExclusive: BigInt(8),
        nodes: [
          {
            node: "a",
            byteOffset: BigInt(0),
            byteSize: BigInt(4),
            endExclusive: BigInt(4),
          },
          {
            node: "b",
            byteOffset: BigInt(4),
            byteSize: BigInt(4),
            endExclusive: BigInt(8),
          },
        ],
      },
    ]);
  });
});
