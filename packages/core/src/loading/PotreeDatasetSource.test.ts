import { describe, expect, it, vi } from "vitest";
import { RequestManagerDatasetSource } from "./PotreeDatasetSource";
import type { RequestManager } from "./RequestManager";

describe("RequestManagerDatasetSource", () => {
  it("resolves metadata and binary resources through the wrapped request manager", async () => {
    const requestManager: RequestManager = {
      getUrl: vi
        .fn<RequestManager["getUrl"]>()
        .mockImplementation(async (kind) => `https://example.test/${kind}`),
      fetch: vi
        .fn<RequestManager["fetch"]>()
        .mockResolvedValue(new Response(null, { status: 206 })),
    };
    const source = new RequestManagerDatasetSource(
      "https://example.test/metadata.json",
      requestManager,
    );

    await expect(source.getResourceUrl("octree")).resolves.toBe(
      "https://example.test/octree",
    );
    await source.fetchMetadata();
    await source.fetchRange("hierarchy", BigInt(10), BigInt(20));

    expect(requestManager.getUrl).toHaveBeenNthCalledWith(
      1,
      "octree",
      "https://example.test/metadata.json",
    );
    expect(requestManager.getUrl).toHaveBeenNthCalledWith(
      2,
      "metadata",
      "https://example.test/metadata.json",
    );
    expect(requestManager.getUrl).toHaveBeenNthCalledWith(
      3,
      "hierarchy",
      "https://example.test/metadata.json",
    );
    expect(requestManager.fetch).toHaveBeenNthCalledWith(
      1,
      "https://example.test/metadata",
    );
    expect(requestManager.fetch).toHaveBeenNthCalledWith(
      2,
      "https://example.test/hierarchy",
      {
        headers: {
          "content-type": "multipart/byteranges",
          Range: "bytes=10-19",
        },
      },
    );
  });
});
