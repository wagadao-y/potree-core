import type { PotreeLoadMeasurement } from "./LoadInstrumentation";
import type { OctreeGeometryNode } from "./OctreeGeometryNode";
import type { PotreeDatasetSource } from "./PotreeDatasetSource";
import { parseOctreeHierarchy } from "./parse-octree-hierarchy";
import { validateRangeResponse } from "./validate-fetch-response";

interface LoadOctreeHierarchyOptions {
  node: OctreeGeometryNode;
  datasetSource: PotreeDatasetSource;
  emitMeasurement: (measurement: PotreeLoadMeasurement) => void;
}

export async function loadOctreeHierarchy({
  node,
  datasetSource,
  emitMeasurement,
}: LoadOctreeHierarchyOptions): Promise<void> {
  const { hierarchyByteOffset, hierarchyByteSize } = node;

  if (hierarchyByteOffset === undefined || hierarchyByteSize === undefined) {
    throw new Error(
      `hierarchyByteOffset and hierarchyByteSize are undefined for node ${node.name}`,
    );
  }

  const hierarchyPath = await datasetSource.getResourceUrl("hierarchy");

  const first = hierarchyByteOffset;
  const last = first + hierarchyByteSize - BigInt(1);

  const hierarchyLoadStartedAt = performance.now();
  const response = await datasetSource.fetchRange(
    "hierarchy",
    first,
    last + BigInt(1),
  );
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
