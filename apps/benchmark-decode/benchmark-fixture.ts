import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ZSTDDecoder } from "zstddec";
// @ts-ignore Legacy JS module is used as a benchmark baseline.
import { BrotliDecode } from "./src/legacy-brotli/decode.js";

export interface BenchmarkFixtureNode {
  name: string;
  offset: number;
  compressedSize: number;
  rawSize: number;
  numPoints: number;
}

export interface BenchmarkFixtureIndex {
  datasetName: string;
  sourceMetadataPath: string;
  originalEncoding: string;
  compression: {
    algorithm: string;
    source: string;
    quality?: number;
  };
  totals: {
    nodes: number;
    points: number;
    rawBytes: number;
    compressedBytes: number;
    compressionRatio: number;
  };
  nodes: BenchmarkFixtureNode[];
}

interface Metadata {
  name: string;
  points: number;
  encoding: string;
  hierarchy: {
    firstChunkSize: number;
  };
}

interface HierarchyNode {
  name: string;
  nodeType: number;
  numPoints: number;
  byteOffset?: bigint;
  byteSize?: bigint;
  hierarchyByteOffset?: bigint;
  hierarchyByteSize?: bigint;
}

export interface BenchmarkFixtureAssets {
  index: BenchmarkFixtureIndex;
  indexJson: string;
  payload: Uint8Array;
}

type FixtureSuite = "brotli" | "zstd";

interface FixtureDefinition {
  suite: FixtureSuite;
  algorithm: BenchmarkFixtureIndex["compression"]["algorithm"];
  metadataPath: string;
  octreePath: string;
  sourceMetadataPath: string;
  sourceOctreePath: string;
}

export async function createBenchmarkAssets(appRoot: string) {
  const zstdDecoder = new ZSTDDecoder();
  await zstdDecoder.init();

  const definitions: Record<FixtureSuite, FixtureDefinition> = {
    brotli: {
      suite: "brotli",
      algorithm: "brotli",
      metadataPath: resolve(
        appRoot,
        "../playground/public/data/pump/metadata.json",
      ),
      octreePath: resolve(appRoot, "../playground/public/data/pump/octree.bin"),
      sourceMetadataPath: "apps/playground/public/data/pump/metadata.json",
      sourceOctreePath: "apps/playground/public/data/pump/octree.bin",
    },
    zstd: {
      suite: "zstd",
      algorithm: "zstd",
      metadataPath: resolve(
        appRoot,
        "../playground/public/data/pump_zstd/metadata.json",
      ),
      octreePath: resolve(
        appRoot,
        "../playground/public/data/pump_zstd/octree.bin",
      ),
      sourceMetadataPath: "apps/playground/public/data/pump_zstd/metadata.json",
      sourceOctreePath: "apps/playground/public/data/pump_zstd/octree.bin",
    },
  };

  const entries = await Promise.all(
    Object.entries(definitions).map(async ([suite, definition]) => {
      const assets = await createFixtureAssets(definition, zstdDecoder);
      return [suite, assets] as const;
    }),
  );

  return Object.fromEntries(entries) as Record<
    FixtureSuite,
    BenchmarkFixtureAssets
  >;
}

async function createFixtureAssets(
  definition: FixtureDefinition,
  zstdDecoder: ZSTDDecoder,
): Promise<BenchmarkFixtureAssets> {
  const hierarchyPath = resolve(definition.metadataPath, "../hierarchy.bin");

  const [metadataText, hierarchyBuffer, octreeBuffer] = await Promise.all([
    readFile(definition.metadataPath, "utf8"),
    readFile(hierarchyPath),
    readFile(definition.octreePath),
  ]);

  const metadata = JSON.parse(metadataText) as Metadata;
  const hierarchyNodes = collectHierarchyNodes(metadata, hierarchyBuffer);

  const nodes: BenchmarkFixtureNode[] = [];
  let rawBytes = 0;
  let compressedBytes = 0;
  let points = 0;

  for (const node of hierarchyNodes) {
    if (node.byteOffset === undefined || node.byteSize === undefined) {
      continue;
    }

    const rawOffset = bigIntToNumber(
      node.byteOffset,
      `${node.name} byteOffset`,
    );
    const compressedSize = bigIntToNumber(
      node.byteSize,
      `${node.name} byteSize`,
    );
    const compressedChunk = octreeBuffer.subarray(
      rawOffset,
      rawOffset + compressedSize,
    );
    const rawSize =
      compressedSize === 0
        ? 0
        : decodeChunk(definition.algorithm, compressedChunk, zstdDecoder)
            .byteLength;

    nodes.push({
      name: node.name,
      offset: rawOffset,
      compressedSize: compressedChunk.byteLength,
      rawSize,
      numPoints: node.numPoints,
    });

    rawBytes += rawSize;
    compressedBytes += compressedChunk.byteLength;
    points += node.numPoints;
  }

  const index: BenchmarkFixtureIndex = {
    datasetName: metadata.name,
    sourceMetadataPath: definition.sourceMetadataPath,
    originalEncoding: metadata.encoding,
    compression: {
      algorithm: definition.algorithm,
      source: definition.sourceOctreePath,
    },
    totals: {
      nodes: nodes.length,
      points,
      rawBytes,
      compressedBytes,
      compressionRatio: compressedBytes === 0 ? 0 : rawBytes / compressedBytes,
    },
    nodes,
  };

  return {
    index,
    indexJson: `${JSON.stringify(index, null, 2)}\n`,
    payload: octreeBuffer,
  };
}

function decodeChunk(
  algorithm: FixtureDefinition["algorithm"],
  compressedChunk: Uint8Array,
  zstdDecoder: ZSTDDecoder,
) {
  if (algorithm === "brotli") {
    return BrotliDecode(
      new Int8Array(
        compressedChunk.buffer,
        compressedChunk.byteOffset,
        compressedChunk.byteLength,
      ),
    );
  }

  return zstdDecoder.decode(compressedChunk);
}

function collectHierarchyNodes(
  metadata: Metadata,
  hierarchyBuffer: Uint8Array,
): HierarchyNode[] {
  const root: HierarchyNode = {
    name: "r",
    nodeType: 2,
    numPoints: metadata.points,
    byteOffset: 0n,
    hierarchyByteOffset: 0n,
    hierarchyByteSize: BigInt(metadata.hierarchy.firstChunkSize),
  };

  const nodesInOrder: HierarchyNode[] = [root];
  const pendingHierarchy: HierarchyNode[] = [root];

  while (pendingHierarchy.length > 0) {
    const current = pendingHierarchy.shift();
    if (
      current === undefined ||
      current.hierarchyByteOffset === undefined ||
      current.hierarchyByteSize === undefined
    ) {
      continue;
    }

    const start = bigIntToNumber(
      current.hierarchyByteOffset,
      `${current.name} hierarchyByteOffset`,
    );
    const size = bigIntToNumber(
      current.hierarchyByteSize,
      `${current.name} hierarchyByteSize`,
    );
    const chunk = hierarchyBuffer.subarray(start, start + size);
    parseHierarchyChunk(current, chunk, nodesInOrder, pendingHierarchy);
  }

  return nodesInOrder;
}

function parseHierarchyChunk(
  root: HierarchyNode,
  buffer: Uint8Array,
  nodesInOrder: HierarchyNode[],
  pendingHierarchy: HierarchyNode[],
) {
  const bytesPerNode = 22;
  const numNodes = buffer.byteLength / bytesPerNode;
  const dataView = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  const chunkNodes: HierarchyNode[] = new Array(numNodes);
  chunkNodes[0] = root;
  let nextNodeIndex = 1;

  for (let index = 0; index < numNodes; index++) {
    const current = chunkNodes[index];
    if (current === undefined) {
      throw new Error(`Missing hierarchy node at index ${index}`);
    }

    const nodeType = dataView.getUint8(index * bytesPerNode + 0);
    const childMask = dataView.getUint8(index * bytesPerNode + 1);
    const numPoints = dataView.getUint32(index * bytesPerNode + 2, true);
    const byteOffset = dataView.getBigInt64(index * bytesPerNode + 6, true);
    const byteSize = dataView.getBigInt64(index * bytesPerNode + 14, true);

    if (current.nodeType === 2) {
      current.byteOffset = byteOffset;
      current.byteSize = byteSize;
      current.numPoints = numPoints;
    } else if (nodeType === 2) {
      current.hierarchyByteOffset = byteOffset;
      current.hierarchyByteSize = byteSize;
      current.numPoints = numPoints;
    } else {
      current.byteOffset = byteOffset;
      current.byteSize = byteSize;
      current.numPoints = numPoints;
    }

    current.nodeType = nodeType;

    if (current.nodeType === 2) {
      pendingHierarchy.push(current);
      continue;
    }

    for (let childIndex = 0; childIndex < 8; childIndex++) {
      const childExists = ((1 << childIndex) & childMask) !== 0;
      if (!childExists) {
        continue;
      }

      const child: HierarchyNode = {
        name: `${current.name}${childIndex}`,
        nodeType: 0,
        numPoints: 0,
      };

      chunkNodes[nextNodeIndex] = child;
      nextNodeIndex += 1;
      nodesInOrder.push(child);
    }
  }
}

function bigIntToNumber(value: bigint, label: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error(`${label} is outside Number safe integer range`);
  }

  return numeric;
}
