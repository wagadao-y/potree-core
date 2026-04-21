# Brotli vs Zstd Benchmark Memo

## Summary

- Target dataset: pump all nodes
- Brotli source: apps/playground/public/data/pump
- Zstd source: apps/playground/public/data/pump_zstd
- Comparison target:
  - Legacy JS Brotli decoder
  - brotli-dec-wasm
  - zstddec

## Measured Result

- Winner: zstddec
- Summary sentence:
  - 平均 53.92 ms で完了し、次点より 74.56 ms 短く、2.38x 高速です。Brotli 側は 38.21 MiB、Zstd 側は 38.21 MiB の pump 全ノードです。Zstd の圧縮量差分は Brotli 比 +12.02% です。
- Median:
  - JS Brotli: 243.20 ms
  - brotli-dec-wasm: 129.50 ms
  - zstddec: 54.30 ms

## Interpretation

- Ranking is `zstddec > brotli-dec-wasm > legacy JS Brotli`.
- zstddec is clearly faster than brotli-dec-wasm in this workload.
- Compression size worsens by about +12.02% relative to Brotli, but decode speed improves enough that Zstd remains a strong candidate.
- For CPU-bound or local/high-bandwidth environments, Zstd is likely the better default.

## Code Notes

- `apps/playground/public/data/pump_zstd` is used by the benchmark fixture generator.
- Reference:
  - `apps/benchmark-decode/benchmark-fixture.ts`
  - Zstd metadata path: `../playground/public/data/pump_zstd/metadata.json`
  - Zstd octree path: `../playground/public/data/pump_zstd/octree.bin`

## Validation

- Build passed:
  - `pnpm --filter benchmark-decode build`

## Next Step Candidates

- Add ZSTD decode path to `packages/core` and verify runtime loading behavior.
- Compare total load time, not only decompression time.