import { describe, expect, it, vi } from "vitest";
import { SignedUrlPotreeRequestManager } from "./SignedUrlPotreeRequestManager";

describe("SignedUrlPotreeRequestManager", () => {
  it("returns per-resource urls without metadata path derivation", async () => {
    const requestManager = new SignedUrlPotreeRequestManager({
      metadata: "https://example.test/metadata.json?signature=meta",
      hierarchy: "https://example.test/hierarchy.bin?signature=hier",
      octree: "https://example.test/octree.bin?signature=oct",
    });

    await expect(
      requestManager.getUrl("metadata", "ignored://metadata.json"),
    ).resolves.toBe("https://example.test/metadata.json?signature=meta");
    await expect(
      requestManager.getUrl("hierarchy", "ignored://metadata.json"),
    ).resolves.toBe("https://example.test/hierarchy.bin?signature=hier");
    await expect(
      requestManager.getUrl("octree", "ignored://metadata.json"),
    ).resolves.toBe("https://example.test/octree.bin?signature=oct");
  });

  it("supports url resolvers so expired signed urls can be refreshed", async () => {
    const metadataResolver = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("https://example.test/metadata.json?token=first")
      .mockResolvedValueOnce("https://example.test/metadata.json?token=second");
    const requestManager = new SignedUrlPotreeRequestManager({
      metadata: metadataResolver,
      hierarchy: "https://example.test/hierarchy.bin?token=hier",
      octree: "https://example.test/octree.bin?token=oct",
    });

    await expect(
      requestManager.getUrl(
        "metadata",
        "https://placeholder.test/metadata.json",
      ),
    ).resolves.toBe("https://example.test/metadata.json?token=first");
    await expect(
      requestManager.getUrl(
        "metadata",
        "https://placeholder.test/metadata.json",
      ),
    ).resolves.toBe("https://example.test/metadata.json?token=second");
    expect(metadataResolver).toHaveBeenCalledTimes(2);
  });

  it("delegates fetch to the injected implementation", async () => {
    const response = new Response(null, { status: 206 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    const requestManager = new SignedUrlPotreeRequestManager(
      {
        metadata: "https://example.test/metadata.json",
        hierarchy: "https://example.test/hierarchy.bin",
        octree: "https://example.test/octree.bin",
      },
      {
        fetch: fetchMock,
      },
    );

    await expect(
      requestManager.fetch("https://example.test/octree.bin", {
        headers: {
          Range: "bytes=0-9",
        },
      }),
    ).resolves.toBe(response);

    expect(fetchMock).toHaveBeenCalledWith("https://example.test/octree.bin", {
      headers: {
        Range: "bytes=0-9",
      },
    });
  });
});
