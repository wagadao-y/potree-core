# docs

## 現在参照する文書

- `packages-core-performance-strategy-20260425.md`
  - 2026-04-25 時点の最新のパフォーマンス改善方針。
  - 実装済み事項、標準データ配信方針、今後の優先順位をここで管理する。

- `packages-core-clipping-analysis.md`
  - クリッピング処理に絞った現行の設計 / 改善メモ。
  - CPU 粗判定、clip-aware point budget、clip relation cache などの検討を扱う。

- `packages-core-webgpu-migration-analysis.md`
  - WebGPU 移行方針の調査メモ。
  - WebGL 側の現在方針とは切り分けて読む。

## 履歴メモ

- `old/` には、最新方針に統合済みの検証ログ、個別ベンチマーク、過去の分析メモを置く。
- これらは判断の経緯を残すための資料であり、現行の優先順位や既定方針は上記の現行文書を優先する。

現時点で `old/` に置く主な資料:

- `benchmark-zstd-validation.md`
- `lod-visibility-worker-investigation-20260423.md`
- `octree-io-batching-investigation-20260424.md`
- `playground-gpu-performance-investigation-20260423-061617-jst.md`
- `screen-space-density-lod-20260423.md`
- `packages-core-performance-analysis.md`
- `zstd-position-rgb-pipeline-20260425.md`

## 運用ルール

- 新しい実装判断や優先順位の更新は、まず `packages-core-performance-strategy-20260425.md` に反映する。
- 個別の検証や一時的な比較結果は、日付つきのメモとして追加する。
- 個別メモの結論が方針へ取り込まれたら、トップレベルに置き続けず `old/` へ移す。