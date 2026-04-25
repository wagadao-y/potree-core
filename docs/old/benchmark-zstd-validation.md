# Brotli と Zstd のベンチマーク検証メモ

## 概要

- 対象データセット: pump 全ノード
- Brotli ソース: `apps/playground/public/data/pump`
- Zstd ソース: `apps/playground/public/data/pump_zstd`
- 比較対象:
  - 旧来の JavaScript Brotli デコーダ
  - `brotli-dec-wasm`
  - `zstddec`

## 計測結果

- 勝者: `zstddec`
- 要約:
  - 平均 53.92 ms で完了し、次点より 74.56 ms 短く、2.38 倍高速でした。
  - Brotli 側も Zstd 側も、対象データは 38.21 MiB の pump 全ノードです。
  - 圧縮サイズは Zstd が Brotli 比で +12.02% 大きくなります。
- 中央値:
  - JavaScript Brotli: 243.20 ms
  - `brotli-dec-wasm`: 129.50 ms
  - `zstddec`: 54.30 ms

## 解釈

- 順位は `zstddec > brotli-dec-wasm > 旧来の JavaScript Brotli` です。
- このワークロードでは `zstddec` が明確に最速です。
- 圧縮率は Brotli より悪化しますが、デコード速度の差が十分に大きいため、CPU ボトルネック寄りの環境では Zstd が有力候補です。
- ローカル環境や高帯域ネットワークでは、Zstd の採用価値が高いです。

## コード上のメモ

- ベンチマーク fixture 生成では `apps/playground/public/data/pump_zstd` を使用しています。
- 関連箇所:
  - `apps/benchmark-decode/benchmark-fixture.ts`
  - Zstd metadata path: `../playground/public/data/pump_zstd/metadata.json`
  - Zstd octree path: `../playground/public/data/pump_zstd/octree.bin`

## 検証結果

- ビルド成功:
  - `pnpm --filter benchmark-decode build`

## 次の候補

- `packages/core` に Zstd decode 経路を追加し、実ランタイムでのロード挙動を確認する
- デコード時間だけでなく、総ロード時間でも比較する