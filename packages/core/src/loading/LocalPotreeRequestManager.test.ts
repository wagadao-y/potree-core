import { describe, expect, it } from "vitest";
import { LocalPotreeRequestManager } from "./LocalPotreeRequestManager";

function createDatasetFiles() {
  return {
    "metadata.json": new File(["{}"], "metadata.json", {
      type: "application/json",
    }),
    "hierarchy.bin": new File([new Uint8Array([1, 2, 3])], "hierarchy.bin"),
    "octree.bin": new File([new Uint8Array([4, 5, 6])], "octree.bin"),
  };
}

describe("LocalPotreeRequestManager", () => {
  it("resolves hierarchy and octree urls from a metadata url", async () => {
    const requestManager = new LocalPotreeRequestManager(
      createDatasetFiles(),
      "localpotree://dataset/",
    );

    await expect(
      requestManager.getUrl("hierarchy", "localpotree://dataset/metadata.json"),
    ).resolves.toBe("localpotree://dataset/hierarchy.bin");
    await expect(
      requestManager.getUrl("octree", "localpotree://dataset/metadata.json"),
    ).resolves.toBe("localpotree://dataset/octree.bin");
  });
});
