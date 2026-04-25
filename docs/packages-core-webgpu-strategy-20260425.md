# packages/core WebGPU 方針

> 現在の WebGL 側の性能改善優先順位は `packages-core-performance-strategy-20260425.md` を優先する。本文書は `packages/core` の WebGPU 化を進める際の設計方針を定義する。

## 目的

- `packages/core` の WebGPU 対応を進める際の設計方針を固定する。
- Three.js との自然な統合を維持しつつ、将来の WebGPU 専用最適化を阻害しない構成を選ぶ。
- 実験実装を進める際の判断基準を明文化し、実装ごとの方針ぶれを減らす。

## 結論

### 1. `ref/potree-renderer` の位置づけ

- `ref/potree-renderer` は WebGPU 実装技法の参考として有用である。
- 特に `apps/playground-webgpu` と `packages/renderer-webgpu` は、Three.js WebGPU renderer との統合方法、depth sharing、post-render overlay、GPU timing、描画モード切替の実例として価値が高い。
- 一方で、`packages/renderer-webgpu/src/potree-point-cloud.ts` は Object3D、LOD、decode、GPU 常駐、描画準備、debug 可視化をまとめて抱えており、責務分離の完成形としては採用しない。
- したがって、`ref/potree-renderer` は どう描くか の参考として使い、どこに責務を置くか の最終設計は本リポジトリ側で再定義する。

### 2. `packages/core` の層分離

- `packages/core` は Three.js に依存しない純粋な Potree ロジック層と、Three.js に依存する renderer 層に論理分離していく。
- 当面は同一パッケージ内のディレクトリ分離で進め、パッケージ分割は必須としない。
- 新しい WebGPU 実装は、この論理分離を前提に追加する。

### 3. playground からの参照方法

- 開発中の playground や実験アプリからは `packages/core` の src を直接エイリアスする。
- これは開発効率のためであり、反映速度、型追跡、デバッグ容易性を優先する。
- ただし src 直参照だけに依存せず、package entry と build 出力を通す検証経路は別途維持する。

## 設計方針

### `ref/potree-renderer` から採用するもの

- Three.js WebGPU renderer から device、context、render pass を取得して点群描画へ接続する統合方法。
- direct、indirect、compute を切り替えられる描画モード設計。
- 描画フックを depth sharing と post-render overlay に分ける考え方。
- GPU timing や描画統計を API と HUD の両方で観測可能にする構成。
- LOD worker、decode worker、visible set 再利用、prepass 再利用などの実装上の工夫。

### `ref/potree-renderer` からそのまま採用しないもの

- `PotreePointCloud` に Three.js の scene object と core ロジックを同居させる構造。
- Object3D 継承を前提にした core API。
- Box3Helper や render proxy のような debug、scene 連携責務を core の中心型へ持ち込むこと。

## 推奨レイヤ構成

### core 層

- dataset 読込
- hierarchy 展開
- LOD 選択
- node state 遷移
- decode worker とデコード処理
- cache
- allocator
- visible node 集合の決定
- 描画計画の元データ生成

この層では Three.js の型、Object3D、Camera、Material、Renderer を持ち込まない。

### renderer 層

- Three.js の Camera や renderer から core 用 view 情報への変換
- Three.js scene への取り付け
- WebGL、WebGPU の pipeline 構築
- material と shader 管理
- depth sharing、overlay などの統合フック
- debug helper
- HUD 向け統計表示や開発用 UI 連携

この層が core 層の出力を消費し、Three.js 側の API と結び付ける。

## 実装ルール

### 1. 新規 WebGPU 実装は core-first で設計する

- 先に Three.js 非依存のデータ構造と制御フローを決める。
- Three.js 依存コードは adapter、integration、renderer 側に閉じ込める。
- Three.js object を直接返す API を増やさない。

### 2. `packages/core` 内では論理的な依存方向を守る

- pure core 相当の領域から Three.js 依存領域を import しない。
- renderer 層は core 層を参照してよいが、逆方向は作らない。
- 当面は単一パッケージでもよいが、将来の `renderer-three` / `renderer-webgpu` 分離を妨げる構造にしない。

### 3. playground は src 直参照を標準とする

- playground は実験速度を優先して src エイリアスを使う。
- package export や dist の健全性確認は build、typecheck、将来のサンプルアプリで補う。
- playground 自体を公開 API の唯一の検証経路にしない。

## 非目標

- この段階でパッケージを `core` と `renderer-*` に物理分割すること。
- 既存 WebGL 実装を直ちに廃止すること。
- `ref/potree-renderer` の構造をそのまま移植すること。

## 当面の進め方

1. `packages/core` 内の Three.js 依存箇所を棚卸しし、pure core 相当と renderer 相当へ分類する。
2. WebGPU 実装で必要なデータ構造を Three.js 非依存で定義する。
3. Three.js WebGPU との統合層を adapter として実装する。
4. playground からは src 直参照で開発し、build と typecheck で package 面の破綻を検出する。

## 関連文書

- `packages-core-webgpu-migration-analysis.md`
  - WebGPU 移行の調査メモ。
  - 本文書の背景資料として扱う。

- `packages-core-performance-strategy-20260425.md`
  - 現行の性能改善方針。
  - 実装優先順位はこの文書を優先する。