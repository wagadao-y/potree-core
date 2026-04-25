import type { Vec3Like } from "../core/types";
import type { DecodedPointAttributes } from "./DecodedPointAttributes";
import type { PointAttributes } from "./PointAttributes";

export interface DecoderWorkerRequest {
  name: string;
  encoding: string;
  buffer: ArrayBuffer;
  pointAttributes: PointAttributes;
  scale?: [number, number, number];
  min: Vec3Like;
  max: Vec3Like;
  size: Vec3Like;
  offset?: [number, number, number];
  numPoints: number;
}

export interface DecoderWorkerMetrics {
  decodeMs: number;
  decompressMs: number;
  attributeDecodeMs: number;
  totalWorkerMs: number;
  rawBufferBytes: number;
  generatedBufferBytes: number;
  transferBufferBytes: number;
  preciseBufferBytes: number;
}

export interface DecoderWorkerStartedMessage {
  type: "started";
  name: string;
}

export interface DecoderWorkerResultMessage {
  type: "result";
  attributeBuffers: DecodedPointAttributes;
  density: number;
  metrics: DecoderWorkerMetrics;
}

export type DecoderWorkerMessage =
  | DecoderWorkerStartedMessage
  | DecoderWorkerResultMessage;
