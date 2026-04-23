# LOD可視ノード選定 WebWorker化検証メモ

- 作成日: 2026-04-23
- 対象: `packages/core`
- 視点: `Camera pos: 9.0, 1.5, 4.4`
- Pixel ratio: `1.00`
- EDL: disabled
- Preset: `preset-1`
- Density LOD: disabled

## 結論

現状の `Potree.updateVisibility()` をそのまま WebWorker 化する方針は採用しない。

同期実装では LOD / Visibility の `Update` が平均 `4.74 ms` だったのに対し、WebWorker 化版では平均 `26.82 ms` まで悪化した。Worker に LOD 計算を逃がしても、メインスレッド側で毎フレーム発生するノードツリー走査、シリアライズ、差分検出、postMessage、結果反映用 lookup 構築のコストが LOD 計算本体を上回った。

今回のケースでは、LOD計算は最適化対象としては支配的ではない。優先度は GPU 描画負荷、表示点数、draw call、ロード/デコード系の安定化の方が高い。

## 検証した方針

当初の狙いは、LOD / 可視ノード選定をメインスレッドから外し、UI操作や描画フレームを詰まらせないことだった。

Worker に移そうとした処理:

- priority queue による octree traversal
- point budget 判定
- frustum 判定
- screen pixel radius による LOD 判定
- screen-space density LOD 判定
- clip box 判定

メインスレッドに残す必要がある処理:

- `PointCloudOctree.toTreeNode()`
- `THREE.Points` / scene graph 更新
- `sceneNode.visible` 更新
- `BufferGeometry` / GPU 反映
- LRU 更新
- ノードロード要求

つまり、Worker化できるのは純粋な選定計算だけで、Three.js / GPU / scene graph に触る処理はメインスレッドに残る。

## 実測比較

ユーザー計測値をそのまま比較する。

| 実装 | FPS avg | CPU work avg | Update avg | Update p95 | Visible points | Visible nodes | Visible geometry | Draw calls | GPU time avg |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebWorker化版 | 24.8 | 37.69 ms | 26.82 ms | 31.00 ms | 33,040,380 | 1,765 | 2,240 | 1,769 | 33.17 ms |
| 同期実装 | 29.7 | 14.29 ms | 4.74 ms | 6.60 ms | 28,873,627 | 2,017 | 2,017 | 2,021 | 33.48 ms |

ロード / デコード系も Worker 化版の方が悪化した。

| 実装 | Octree read avg | Hierarchy load avg | Worker wait avg | Transfer avg | Fetch throughput |
| --- | ---: | ---: | ---: | ---: | ---: |
| WebWorker化版 | 59.27 ms | 14.62 ms | 18.70 ms | 4.37 ms | 1.2 MB/s |
| 同期実装 | 1.45 ms | 1.63 ms | 0.55 ms | 1.15 ms | 40.5 MB/s |

Canvas サイズなど完全に同一条件ではないが、差が大きく、少なくとも今回の Worker 化方式が有利とは言えない。

## 悪化した理由

### 1. LOD計算本体が十分軽かった

同期実装の `Update avg` は `4.74 ms`、p95 でも `6.60 ms` だった。

この程度の処理を Worker に移す場合、Worker に渡すデータ準備と結果反映が数ms以内に収まらないと意味がない。今回の実装ではその条件を満たせなかった。

### 2. ノードツリーの同期コストが高い

Three.js オブジェクトや `PointCloudOctreeNode` / `PointCloudOctreeGeometryNode` の参照は Worker にそのまま渡せない。そのため、Worker 用に以下を軽量構造へ変換する必要があった。

- node id
- level
- numPoints
- boundingBox
- boundingSphere
- children id
- point cloud ごとの camera position / frustum / clip boxes

初期実装では毎フレーム全ノードをシリアライズしており、これは明確に重かった。

その後、Worker 側にノードキャッシュを持たせて差分送信にしたが、メインスレッド側で差分検出のためにツリーを走査する必要が残り、十分な改善にはならなかった。

### 3. 結果反映にもメインスレッド走査が必要

Worker は `nodeId` を返すだけなので、メインスレッド側では `nodeId -> 実ノード参照` の解決が必要になる。

この lookup を毎フレーム構築すると、LOD計算を Worker に逃がしても結局メインスレッドでツリー走査が発生する。

### 4. ロード / デコード Worker と競合しやすい

点群ロードでは既にデコード用 Worker が使われている。LOD Worker が追加で走ると、ロード・デコード・転送の待ち時間が増える可能性がある。

実測でも Worker 化版は `Worker wait avg` が `0.55 ms` から `18.70 ms` に悪化していた。

## 判断

今回の構造では、LOD可視ノード選定の WebWorker 化はユーザー体験改善として割に合わない。

理由:

- 同期LOD計算は既に数ms程度で収まっている。
- Worker 化にはノード情報同期と結果反映の固定費がある。
- Three.js / GPU / scene graph 反映はメインスレッドから逃がせない。
- ロード・デコード系 Worker と競合し、読み込み完了までが遅くなるリスクがある。
- 実測で FPS / CPU work / Update / IO / Worker wait が悪化した。

## 今後Worker化するなら必要な設計

単に `updateVisibility()` の計算部分だけを Worker に移すのでは不十分である。

成立させるには、少なくとも以下が必要になる。

- 階層ロード時にだけ Worker へ node 追加・更新を通知する。
- Worker 側が octree の canonical な軽量表現を保持する。
- メインスレッド側も `nodeId -> node reference` の永続 lookup を保持し、毎フレーム再構築しない。
- フレームごとの postMessage は camera matrix、projection、pointBudget、LOD設定、clip設定だけにする。
- Worker 結果は `sequenceId` で古いものを破棄する。
- ロード・デコード Worker とLOD Workerの同時実行数を制御する。
- 初回ロード中は Worker LOD を抑制する、または低頻度化する。

このレベルまで設計を変えるなら検証価値はある。ただし、現在のボトルネック傾向を見る限り、優先度は高くない。

## 優先すべき代替案

現状では、LOD Worker化より以下の方が効果を見込みやすい。

- `pointBudget` の動的調整
- screen-space density LOD の調整
- `minNodePixelSize` を上げて visible nodes / draw calls を減らす
- カメラ操作中だけ低密度LODにする
- draw calls 削減
- 表示点数そのものの削減
- WebGPU / compute shader による screen-space point reduction

特に既存調査では GPU time が表示点数にほぼ比例しているため、FPS改善の本命は CPU側LOD計算の退避ではなく、GPUへ投入する点数とdraw callを減らすことである。

## 最終方針

LOD可視ノード選定の WebWorker 化は、現時点では見送る。

既存の同期 `updateVisibility()` を維持し、性能改善は表示ポリシー、screen-space density LOD、描画負荷削減を中心に進める。
