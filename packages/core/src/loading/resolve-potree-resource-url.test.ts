import { describe, expect, it } from "vitest";
import { resolvePotreeResourceUrl } from "./resolve-potree-resource-url";

describe("resolvePotreeResourceUrl", () => {
  it("keeps metadata url as-is relative to the provided base url", () => {
    expect(
      resolvePotreeResourceUrl(
        "metadata",
        "metadata.json",
        "https://example.test/data/pump/",
      ),
    ).toBe("https://example.test/data/pump/metadata.json");
  });

  it("supports root-relative base urls used by browser apps", () => {
    expect(
      resolvePotreeResourceUrl("metadata", "metadata.json", "/data/pump/"),
    ).toBe("/data/pump/metadata.json");
    expect(
      resolvePotreeResourceUrl("hierarchy", "metadata.json", "/data/pump/"),
    ).toBe("/data/pump/hierarchy.bin");
  });

  it("resolves hierarchy and octree as siblings of metadata", () => {
    expect(
      resolvePotreeResourceUrl(
        "hierarchy",
        "metadata.json",
        "https://example.test/data/pump/",
      ),
    ).toBe("https://example.test/data/pump/hierarchy.bin");
    expect(
      resolvePotreeResourceUrl(
        "octree",
        "nested/metadata.json",
        "https://example.test/data/",
      ),
    ).toBe("https://example.test/data/nested/octree.bin");
  });

  it("drops metadata query parameters when resolving binary siblings", () => {
    expect(
      resolvePotreeResourceUrl(
        "hierarchy",
        "metadata.json?token=meta",
        "https://example.test/data/pump/",
      ),
    ).toBe("https://example.test/data/pump/hierarchy.bin");
  });
});
