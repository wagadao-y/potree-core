import type { PotreeResourceKind } from "./RequestManager";

const POTREE_RESOURCE_FILE_NAMES: Record<PotreeResourceKind, string> = {
  metadata: "metadata.json",
  hierarchy: "hierarchy.bin",
  octree: "octree.bin",
};

export function resolvePotreeResourceUrl(
  kind: PotreeResourceKind,
  url: string,
  baseUrl: string,
): string {
  const metadataUrl = resolveRelativeOrAbsoluteUrl(url, baseUrl);

  if (kind === "metadata") {
    return metadataUrl;
  }

  const metadataPath = stripSearchAndHash(metadataUrl);
  const pathSegments = metadataPath.split("/");

  pathSegments[pathSegments.length - 1] = POTREE_RESOURCE_FILE_NAMES[kind];

  return pathSegments.join("/");
}

function resolveRelativeOrAbsoluteUrl(url: string, baseUrl: string): string {
  if (isAbsoluteUrl(url)) {
    return url;
  }

  if (isAbsoluteUrl(baseUrl)) {
    return new URL(url, baseUrl).toString();
  }

  if (url.startsWith("/")) {
    return url;
  }

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  return `${normalizedBase}${url}`;
}

function stripSearchAndHash(url: string): string {
  const hashIndex = url.indexOf("#");
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const searchIndex = withoutHash.indexOf("?");

  return searchIndex >= 0 ? withoutHash.slice(0, searchIndex) : withoutHash;
}

function isAbsoluteUrl(url: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("//");
}
