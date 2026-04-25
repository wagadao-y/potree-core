export interface DecodedPointAttribute {
  buffer: ArrayBuffer;
  attribute?: {
    range?: [number, number];
  };
  offset?: number;
  scale?: number;
  preciseBuffer?: ArrayBuffer;
}

export interface DecodedPointAttributes {
  [property: string]: DecodedPointAttribute;
}