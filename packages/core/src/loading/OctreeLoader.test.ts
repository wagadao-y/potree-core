import { describe, expect, it, vi } from "vitest";

import { OctreeLoader } from "./OctreeLoader";
import type { RequestManager } from "./RequestManager";
import { PotreeFetchError } from "./validate-fetch-response";

describe("OctreeLoader", () => {
  it("rejects failed metadata responses before parsing json", async () => {
    const json = vi.fn();
    const response = {
      ok: false,
      status: 404,
      json,
    } as Response;
    const requestManager: RequestManager = {
      getUrl: vi
        .fn<RequestManager["getUrl"]>()
        .mockResolvedValue("https://example.test/metadata.json"),
      fetch: vi.fn<RequestManager["fetch"]>().mockResolvedValue(response),
    };
    const loader = new OctreeLoader();

    await expect(
      loader.load("https://example.test/metadata.json", requestManager),
    ).rejects.toBeInstanceOf(PotreeFetchError);

    expect(requestManager.getUrl).toHaveBeenCalledWith(
      "https://example.test/metadata.json",
    );
    expect(requestManager.fetch).toHaveBeenCalledWith(
      "https://example.test/metadata.json",
    );
    expect(json).not.toHaveBeenCalled();
  });
});
