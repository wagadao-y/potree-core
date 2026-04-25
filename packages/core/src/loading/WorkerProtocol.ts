import type { Box3Like } from "../core/types";
import type { IPointAttributes } from "../point-attributes";

export interface LegacyBinaryDecoderRequest {
  buffer: ArrayBuffer;
  pointAttributes: IPointAttributes;
  version: string;
  offset: [number, number, number];
  scale: number;
}

export interface LegacyBinaryDecoderAttribute {
  attribute: {
    name: number;
    type: {
      ordinal: number;
      size: number;
    };
    byteSize: number;
    numElements: number;
  };
  buffer: ArrayBuffer;
}

export interface LegacyBinaryDecoderResponse {
  buffer: ArrayBuffer;
  mean: [number, number, number];
  attributeBuffers: Record<string, LegacyBinaryDecoderAttribute>;
  tightBoundingBox: Box3Like;
  indices: ArrayBuffer;
}