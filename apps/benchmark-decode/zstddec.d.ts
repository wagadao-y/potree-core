declare module "zstddec" {
  export class ZSTDDecoder {
    init(): Promise<void>;
    decode(array: Uint8Array, uncompressedSize?: number): Uint8Array;
  }
}

declare module "./src/legacy-brotli/decode.js" {
  export function BrotliDecode(input: Int8Array): Int8Array;
}

declare module "./legacy-brotli/decode.js" {
  export function BrotliDecode(input: Int8Array): Int8Array;
}