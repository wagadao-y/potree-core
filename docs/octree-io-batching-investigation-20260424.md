# Octree I/O Batching 調査メモ

## 目的

- `octree.bin` の range request をまとめて、fetch 回数と read latency を減らす
- ただし `Fetched bytes` が増えすぎると S3 転送量と維持費が悪化するため、総転送量も重視する

## 前提

- 対象 viewer は `packages/core`
- 対象データは `--optimize-octree-layout` を有効にした PotreeConverter 出力
- `octree.bin` は post-process で `depth asc + same-depth lexicographic` に並び替えられている
- 同一深さの node name 辞書順は実質 base-8 / Morton-like order とみなせる

## 実装したもの

### 計測強化

- performance panel に以下を追加
  - `Octree nodes / fetch`
  - `Octree cache hit`
  - `Octree fetched / node bytes`
- `Fetched bytes` / `Fetch events` は実 fetch ベースで集計するよう修正

### loader 側

- `OctreeLoader` に range merge / cache を追加
- `MAX_MERGED_OCTREE_RANGE_BYTES = 2MB`
- `MAX_MERGED_OCTREE_RANGE_GAP_BYTES = 0`
- `MAX_OCTREE_RANGE_CACHE_BYTES = 64MB`
- `loadBatchWithCandidates(nodes, candidates)` を追加し、decode 対象ノードと merge 候補ノードを分離できるようにした

### viewer 側

- 同時ロード数を `8` に統一
- 最終候補案は「可視 run 方式」
  - そのフレームで優先ロード対象になるノードは上位 `maxNumNodesLoading`
  - merge 候補は可視未ロードノード全体
  - `byteOffset` 順に並べ、完全隣接 (`gap = 0`) の run を作る
  - 優先ロード対象ノードを 1 つ以上含む run だけを今回の batch 対象にする
  - run 内ノードはまとめて load/decode する

## 比較結果

測定視点:

- `Camera pos: 9.0, 1.5, 4.4`
- `Canvas: 1920 x 911`
- `Point budget: 50,000,000`
- `Visible points: 33,040,439`

### 変更前

- `Fetched bytes: 146.0 MB`
- `Fetch events: 2,393`
- `Bytes / fetch: 62.5 KB`
- `Octree read avg: 1.51 ms`
- `Octree nodes / fetch`: ほぼ `1`

### 先読み batch を強くした案

- 候補探索を広げ、同一 level / name 近傍を優先して batch 化
- 代表値:
  - `Fetched bytes: 397.3 MB`
  - `Fetch events: 533`
  - `Octree nodes / fetch: 5.87`
  - `Octree fetched / node bytes: 2.73x`

評価:

- fetch 回数と read latency は改善
- ただし総転送量が大きく、S3 コスト観点では厳しい

### ロード対象のみ batch にする案

- 今回 decode するノードだけを `loadBatch` に渡す
- 代表値:
  - `Fetched bytes: 155.1 MB`
  - `Fetch events: 2,360`
  - `Octree nodes / fetch: 1.01`
  - `Octree fetched / node bytes: 1.06x`

評価:

- 総転送量は変更前に近い
- ただしまとめ取り効果がほぼ消えた

### 可視 run 方式

- 代表値:
  - `Fetched bytes: 215.0 MB`
  - `Fetch events: 604`
  - `Bytes / fetch: 364.5 KB`
  - `Octree read avg: 0.54 ms`
  - `Octree nodes / fetch: 4.95`
  - `Octree cache hit: 79.8%`
  - `Octree fetched / node bytes: 1.48x`

評価:

- 変更前より転送量は増える
- ただし先読み batch 強化案よりは大幅に少ない
- fetch 回数削減と総転送量のバランスが最も良かった

### 可視 run + 巨大 run のみ制限

- 2MB 以下の可視 run は従来どおり丸ごと採用
- 2MB 超の run でも、優先ロード対象ノード群をつなぐ span が 2MB 以下ならその span を採用
- それでも大きい run だけ、優先ロード対象ノード周辺の `512KB / 8 nodes` に早取りを制限
- 代表値:
  - `Fetched bytes: 154.8 MB`
  - `Fetch events: 647`
  - `Bytes / fetch: 245.0 KB`
  - `Octree read avg: 0.49 ms`
  - `Octree nodes / fetch: 4.52`
  - `Octree cache hit: 77.9%`
  - `Octree fetched / node bytes: 1.06x`

評価:

- `Fetched bytes` はロード対象のみ batch 案に近い水準まで下がった
- `Fetch events` は可視 run 方式よりやや増えるが、変更前より大幅に少ない
- `Octree nodes / fetch` と cache hit も十分維持できている
- 現時点では fetch 回数削減と総転送量のバランスが最も良い

## 解釈

- `gap = 0` にすると、隙間をまたぐ overfetch は発生しない
- それでも `Fetched bytes` が変更前より増えるのは、可視 run に含まれる「今すぐは不要だが、可視で将来使う可能性が高いノード」を先回りで取得しているため
- したがって転送量増分の主因は「隙間」ではなく「可視ノードの早取り」
- ただし可視 run 全体を一律に削ると fetch が細かく分断され、cache hit も悪化する
- そのため、小さい run は維持し、巨大 run だけを制限する方が安定する

## 結論

- 現時点の候補案としては「可視 run + 巨大 run のみ制限」を採用するのが妥当
- 理由:
  - `Fetch events` を大きく減らせる
  - `Octree nodes / fetch` も十分高い
  - `Fetched bytes` は変更前に近い水準まで抑えられる

## 今後の改善候補

- 別視点 / 別データセットで `2MB` / `512KB` / `8 nodes` の閾値を再検証する
- 早取り制限の効果を見やすくするため、selected node 数 / prefetch node 数 / prefetch bytes を instrumentation に追加する
- 可視であっても point budget や優先度が低いノードの早取り量をさらに抑える
