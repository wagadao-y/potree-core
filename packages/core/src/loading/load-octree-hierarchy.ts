import type { PotreeLoadMeasurement } from "./LoadInstrumentation";
import type { OctreeGeometryNode } from "./OctreeGeometryNode";
import { parseOctreeHierarchy } from "./parse-octree-hierarchy";
import type { RequestManager } from "./RequestManager";
import { validateRangeResponse } from "./validate-fetch-response";

interface LoadOctreeHierarchyOptions {
  url: string;
  node: OctreeGeometryNode;
  requestManager: RequestManager;
  emitMeasurement: (measurement: PotreeLoadMeasurement) => void;
}

export async function loadOctreeHierarchy({
  url,
  node,
  requestManager,
  emitMeasurement,
}: LoadOctreeHierarchyOptions): Promise<void> {
  const { hierarchyByteOffset, hierarchyByteSize } = node;

  if (hierarchyByteOffset === undefined || hierarchyByteSize === undefined) {
    throw new Error(
      `hierarchyByteOffset and hierarchyByteSize are undefined for node ${node.name}`,
    );
  }

  const hierarchyPath = (await requestManager.getUrl(url)).replace(
    "/metadata.json",
    "/hierarchy.bin",
  );

  const first = hierarchyByteOffset;
  const last = first + hierarchyByteSize - BigInt(1);

  const hierarchyLoadStartedAt = performance.now();
  const response = await requestManager.fetch(hierarchyPath, {
    headers: {
      "content-type": "multipart/byteranges",
      Range: `bytes=${first}-${last}`,
    },
  });
  validateRangeResponse(response, hierarchyPath, first, last + BigInt(1));

  const buffer = await response.arrayBuffer();
  emitMeasurement({
    stage: "hierarchy-load",
    nodeName: node.name,
    durationMs: performance.now() - hierarchyLoadStartedAt,
    byteSize: buffer.byteLength,
    numPoints: node.numPoints,
  });

  const hierarchyParseStartedAt = performance.now();
  parseOctreeHierarchy(node, buffer);
  emitMeasurement({
    stage: "hierarchy-parse",
    nodeName: node.name,
    durationMs: performance.now() - hierarchyParseStartedAt,
    byteSize: buffer.byteLength,
    numPoints: node.numPoints,
  });
}
