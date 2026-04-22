export type PotreeLoadStage =
  | "hierarchy-load"
  | "hierarchy-parse"
  | "octree-slice-read"
  | "worker-wait"
  | "decompress-attribute-decode"
  | "worker-transfer"
  | "geometry-creation";

export interface PotreeLoadMeasurement {
  stage: PotreeLoadStage;
  nodeName: string;
  durationMs: number;
  byteSize?: number;
  numPoints?: number;
  metadata?: Record<string, number | string | boolean | undefined>;
}

export interface PotreeLoadInstrumentation {
  onStage?: (measurement: PotreeLoadMeasurement) => void;
}

export interface LoadOctreeOptions {
  instrumentation?: PotreeLoadInstrumentation;
}