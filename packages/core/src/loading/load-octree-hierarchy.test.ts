import { describe, expect, it, vi } from "vitest";
import { loadOctreeHierarchy } from "./load-octree-hierarchy";
import type { PotreeDatasetSource } from "./PotreeDatasetSource";
import { PotreeFetchError } from "./validate-fetch-response";

function makeResponse(status: number, headers?: HeadersInit): Response {
  return new Response(null, {
    status,
    headers,
  });
}

describe("loadOctreeHierarchy", () => {
  it("rejects invalid range responses before parsing hierarchy data", async () => {
    const datasetSource: PotreeDatasetSource = {
      getResourceUrl: vi
        .fn<PotreeDatasetSource["getResourceUrl"]>()
        .mockImplementation(async (kind) => {
          switch (kind) {
            case "metadata":
              return "https://example.test/metadata.json";
            case "hierarchy":
              return "https://example.test/hierarchy.bin";
            case "octree":
              return "https://example.test/octree.bin";
          }
        }),
      fetchMetadata: vi.fn<PotreeDatasetSource["fetchMetadata"]>(),
      fetchRange: vi.fn<PotreeDatasetSource["fetchRange"]>().mockResolvedValue(
        makeResponse(200, {
          "Content-Range": "bytes 10-19/100",
        }),
      ),
    };
    const emitMeasurement = vi.fn();

    await expect(
      loadOctreeHierarchy({
        node: {
          name: "r",
          hierarchyByteOffset: BigInt(10),
          hierarchyByteSize: BigInt(10),
          numPoints: 123,
        } as never,
        datasetSource,
        emitMeasurement,
      }),
    ).rejects.toBeInstanceOf(PotreeFetchError);

    expect(datasetSource.fetchRange).toHaveBeenCalledWith(
      "hierarchy",
      BigInt(10),
      BigInt(20),
    );
    expect(datasetSource.getResourceUrl).toHaveBeenCalledWith("hierarchy");
    expect(emitMeasurement).not.toHaveBeenCalled();
  });
});
