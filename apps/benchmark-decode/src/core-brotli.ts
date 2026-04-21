// @ts-expect-error The core Brotli decoder is a legacy JS module without TypeScript declarations.
import { BrotliDecode as unsafeBrotliDecode } from "../../../packages/core/src/loading2/libs/brotli/decode.js";

export const BrotliDecode = unsafeBrotliDecode as (input: Int8Array) => Int8Array;