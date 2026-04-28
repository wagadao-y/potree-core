import { describe, expect, it, vi } from "vitest";
import { loadOctreeHierarchy } from "./load-octree-hierarchy";
import type { RequestManager } from "./RequestManager";
import { PotreeFetchError } from "./validate-fetch-response";

function makeResponse(status: number, headers?: HeadersInit): Response {
  return new Response(null, {
    status,
    headers,
  });
}

describe("loadOctreeHierarchy", () => {
  it("rejects invalid range responses before parsing hierarchy data", async () => {
    const requestManager: RequestManager = {
      getUrl: vi
        .fn<RequestManager["getUrl"]>()
        .mockResolvedValue("https://example.test/metadata.json"),
      fetch: vi.fn<RequestManager["fetch"]>().mockResolvedValue(
        makeResponse(200, {
          "Content-Range": "bytes 10-19/100",
        }),
      ),
    };
    const emitMeasurement = vi.fn();

    await expect(
      loadOctreeHierarchy({
        url: "https://example.test/metadata.json",
        node: {
          name: "r",
          hierarchyByteOffset: BigInt(10),
          hierarchyByteSize: BigInt(10),
          numPoints: 123,
        } as never,
        requestManager,
        emitMeasurement,
      }),
    ).rejects.toBeInstanceOf(PotreeFetchError);

    expect(requestManager.fetch).toHaveBeenCalledWith(
      "https://example.test/hierarchy.bin",
      {
        headers: {
          "content-type": "multipart/byteranges",
          Range: "bytes=10-19",
        },
      },
    );
    expect(emitMeasurement).not.toHaveBeenCalled();
  });
});
