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

export type BenchmarkSuite = "js" | "brotli" | "zstd";

export interface BenchmarkRoundResult {
  durationMs: number;
  checksum: number;
}

export interface BenchmarkSummary {
  suite: BenchmarkSuite;
  rounds: BenchmarkRoundResult[];
  coldStartMs: number;
  checksum: number;
  totalBytes: number;
  totalCompressedBytes: number;
  nodeCount: number;
  meanMs: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  throughputMiBPerSec: number;
}

export interface BenchmarkRequest {
  type: "run";
  suite: BenchmarkSuite;
  roundCount: number;
  indexUrl: string;
  payloadUrl: string;
}

export interface BenchmarkProgressMessage {
  type: "progress";
  suite: BenchmarkSuite;
  current: number;
  total: number;
  phase: "warmup" | "measure";
}

export interface BenchmarkResultMessage {
  type: "result";
  suite: BenchmarkSuite;
  summary: BenchmarkSummary;
}

export interface BenchmarkErrorMessage {
  type: "error";
  suite: BenchmarkSuite;
  message: string;
}

export type BenchmarkWorkerMessage =
  | BenchmarkProgressMessage
  | BenchmarkResultMessage
  | BenchmarkErrorMessage;
