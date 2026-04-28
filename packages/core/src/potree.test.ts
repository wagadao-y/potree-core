import { describe, expect, it, vi } from "vitest";
import type { PotreeDatasetSource } from "./loading/PotreeDatasetSource";

const loadOctreeMock = vi.fn();

vi.mock("./loading/load-octree", () => ({
  loadOctree: loadOctreeMock,
}));

describe("Potree", () => {
  it("accepts a dataset source directly", async () => {
    loadOctreeMock.mockResolvedValueOnce("loaded-point-cloud");

    const { Potree } = await import("./potree");
    const datasetSource: PotreeDatasetSource = {
      getResourceUrl: vi.fn(),
      fetchMetadata: vi.fn(),
      fetchRange: vi.fn(),
    };

    const potree = new Potree();
    const result = await potree.loadPointCloud("metadata.json", datasetSource);

    expect(result).toBe("loaded-point-cloud");
    expect(loadOctreeMock).toHaveBeenCalledWith(datasetSource, undefined);
  });
});
