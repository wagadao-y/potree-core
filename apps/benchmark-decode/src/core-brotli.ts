// @ts-expect-error The legacy Brotli decoder is a copied JS module without TypeScript declarations.
import { BrotliDecode as unsafeBrotliDecode } from "./legacy-brotli/decode.js";

export const BrotliDecode = unsafeBrotliDecode as (input: Int8Array) => Int8Array;