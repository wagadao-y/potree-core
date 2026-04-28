# own-potree-core

このリポジトリは [tentone/potree-core](https://github.com/tentone/potree-core) をベースに取り込んだ fork です。

元実装を出発点にしつつ、現在は次の整理を進めています。

- core と three.js renderer の責務分離
- 公開 API の明確化
- core ロジックのテスト整備
- downstream から扱いやすいワークスペース構成への再編

## パッケージ構成

- `packages/core`
  - 点群データの読み込み、octree 管理、可視性制御などの core ロジックを提供します。
- `packages/renderer-three`
  - `potree-core` を three.js に接続する描画統合層です。
- `apps/playground`
  - 開発用の動作確認アプリです。
- `apps/benchmark-decode`
  - デコード系の検証用アプリです。

## データ形式の前提

- このリポジトリで扱う点群データは、PotreeConverter 2.x 系が出力したデータセットのみです。
- 読み込みに必要なのは `metadata.json`、`hierarchy.bin`、`octree.bin` を含むデータセットです。
- HTTP 配信時は `hierarchy.bin` と `octree.bin` に対する byte range request を正しく扱えるサーバー構成が必要です。

## 使い分け

- データセットの読み込みやロード制御だけを使いたい場合は `potree-core` を使います。
- three.js 上で描画、picking、clip volume を扱う場合は `potree-renderer-three` を使います。
- 低レベルの scheduler や geometry node を直接扱う場合は `potree-core/core` を使います。

## 開発コマンド

- `pnpm install`
- `pnpm run dev`
- `pnpm run test`
- `pnpm run check:write`
- `pnpm run typecheck`

## 関連ドキュメント

- core パッケージの公開 API と利用方針は `packages/core/README.md` を参照してください。
- 設計メモや調査結果は `docs/` 配下にまとめています。