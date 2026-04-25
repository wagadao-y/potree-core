// @ts-ignore Legacy JS module is used as a benchmark baseline.
import { BrotliDecode as unsafeBrotliDecode } from "./legacy-brotli/decode.js";

export const BrotliDecode = unsafeBrotliDecode as (
  input: Int8Array,
) => Int8Array;
