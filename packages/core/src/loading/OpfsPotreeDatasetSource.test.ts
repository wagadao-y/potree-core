import { describe, expect, it, vi } from "vitest";
import { OpfsPotreeDatasetSource } from "./OpfsPotreeDatasetSource";

function createFileHandle(file: File) {
  return {
    name: file.name,
    getFile: vi.fn().mockResolvedValue(file),
  } as unknown as FileSystemFileHandle;
}

describe("OpfsPotreeDatasetSource", () => {
  it("loads required file handles from a directory handle", async () => {
    const metadataHandle = createFileHandle(
      new File(["{}"], "metadata.json", { type: "application/json" }),
    );
    const hierarchyHandle = createFileHandle(
      new File([new Uint8Array([1])], "hierarchy.bin"),
    );
    const octreeHandle = createFileHandle(
      new File([new Uint8Array([2])], "octree.bin"),
    );
    const directoryHandle = {
      getFileHandle: vi.fn(async (name: string) => {
        switch (name) {
          case "metadata.json":
            return metadataHandle;
          case "hierarchy.bin":
            return hierarchyHandle;
          case "octree.bin":
            return octreeHandle;
          default:
            throw new Error(`Unexpected file: ${name}`);
        }
      }),
    } as unknown as FileSystemDirectoryHandle;

    const source = await OpfsPotreeDatasetSource.fromDirectoryHandle(
      directoryHandle,
      "opfs://pump/",
    );

    await expect(source.getResourceUrl("hierarchy")).resolves.toBe(
      "opfs://pump/hierarchy.bin",
    );
    expect(directoryHandle.getFileHandle).toHaveBeenCalledTimes(3);
  });

  it("returns metadata as a full response", async () => {
    const source = new OpfsPotreeDatasetSource({
      "metadata.json": createFileHandle(
        new File([JSON.stringify({ points: 1 })], "metadata.json", {
          type: "application/json",
        }),
      ),
      "hierarchy.bin": createFileHandle(
        new File([new Uint8Array([1])], "hierarchy.bin"),
      ),
      "octree.bin": createFileHandle(
        new File([new Uint8Array([2])], "octree.bin"),
      ),
    });

    const response = await source.fetchMetadata();

    await expect(response.text()).resolves.toBe('{"points":1}');
    expect(response.headers.get("content-type")).toBe("application/json");
  });

  it("reads hierarchy and octree by range without full-buffer expansion", async () => {
    const source = new OpfsPotreeDatasetSource({
      "metadata.json": createFileHandle(new File(["{}"], "metadata.json")),
      "hierarchy.bin": createFileHandle(
        new File([new Uint8Array([0, 1, 2, 3, 4])], "hierarchy.bin"),
      ),
      "octree.bin": createFileHandle(
        new File([new Uint8Array([5, 6, 7, 8, 9])], "octree.bin"),
      ),
    });

    const response = await source.fetchRange("octree", BigInt(1), BigInt(4));
    const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));

    expect(bytes).toEqual([6, 7, 8]);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 1-3/5");
  });
});
