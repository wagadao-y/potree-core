import { describe, expect, it, vi } from "vitest";

import { OctreeLoader } from "./OctreeLoader";
import type { PotreeDatasetSource } from "./PotreeDatasetSource";
import { PotreeFetchError } from "./validate-fetch-response";

describe("OctreeLoader", () => {
  it("rejects failed metadata responses before parsing json", async () => {
    const json = vi.fn();
    const response = {
      ok: false,
      status: 404,
      json,
    } as Response;
    const datasetSource: PotreeDatasetSource = {
      getResourceUrl: vi
        .fn<PotreeDatasetSource["getResourceUrl"]>()
        .mockResolvedValue("https://example.test/metadata.json"),
      fetchMetadata: vi
        .fn<PotreeDatasetSource["fetchMetadata"]>()
        .mockResolvedValue(response),
      fetchRange: vi.fn<PotreeDatasetSource["fetchRange"]>(),
    };
    const loader = new OctreeLoader();

    await expect(loader.load(datasetSource)).rejects.toBeInstanceOf(
      PotreeFetchError,
    );

    expect(datasetSource.getResourceUrl).toHaveBeenCalledWith("metadata");
    expect(datasetSource.fetchMetadata).toHaveBeenCalledWith();
    expect(json).not.toHaveBeenCalled();
  });
});
