# packages/core リファクタリング候補 2026-04-26

> 本文書は `tokei packages/core/src --sort code -f` の結果を起点に、現時点の `packages/core/src` で次に進めるリファクタリング候補を整理したものである。既存方針は `docs/packages-core-refactoring-plan-20260425.md` と `docs/packages-core-layer-separation-inventory-20260425.md` を前提にし、本書では「今の行数偏りと責務の残り方」から着手順を決める。

## 計測結果

実行コマンド:

```sh
tokei packages/core/src --sort code -f
```

総量:

| Language | Files | Lines | Code | Comments | Blanks |
| --- | ---: | ---: | ---: | ---: | ---: |
| TypeScript | 71 | 8352 | 6574 | 565 | 1213 |
| F# shader | 2 | 324 | 210 | 64 | 50 |
| Total | 73 | 8676 | 6784 | 629 | 1263 |

上位ファイル:

| 順位 | ファイル | Code | 見立て |
| ---: | --- | ---: | --- |
| 1 | `materials/point-cloud-material.ts` | 607 | material 本体、uniform 定義、状態更新、renderer hook がまだ同居している |
| 2 | `loading/OctreeLoader.ts` | 360 | 分割済みだが、batch orchestration と計測、cache read、decode dispatch の接続が厚い |
| 3 | `loading/brotli-decoder.worker.ts` | 349 | worker 実装であり、行数は多いが責務は比較的閉じている |
| 4 | `renderer-three/point-cloud-octree-picker.ts` | 346 | picking render pass、render target 管理、ray 対象選別、material 同期が同居している |
| 5 | `core/visibility/update-visibility.ts` | 288 | pure core の中心アルゴリズム。大きいが境界は良い |
| 6 | `loading/decoder.worker.ts` | 250 | worker 実装。圧縮方式や属性 decode の変更多発時以外は優先度低 |
| 7 | `core/point-cloud-visibility-scheduler.ts` | 243 | scheduler facade と loader grouping が同居している |
| 8 | `renderer-three/point-cloud-octree-renderer.ts` | 187 | adapter、bounds、debug box、移動 helper が残っている |
| 9 | `loading/octree-range-cache.ts` | 183 | range merge/cache の中核。テスト追加余地が大きい |
| 10 | `core/point-cloud-visible-run.ts` | 181 | visible run 候補選定。scheduler からは分離済み |
| 11 | `loading/PointAttributes.ts` | 165 | データ定義中心。大きいが安定領域 |
| 12 | `renderer-three/point-cloud-visibility-adapter.ts` | 165 | Three.js と pure visibility の接続点 |
| 13 | `rendering/potree-renderer.ts` | 163 | public renderer facade。EDL 周辺の責務確認対象 |
| 14 | `point-cloud-octree.ts` | 162 | facade と renderer scene object の境界が残る |
| 15 | `rendering/edl-pass.ts` | 161 | post-process pass。独立性は高い |

## 全体所見

2026-04-25 時点の計画から、pure core / renderer-three の分離はかなり進んでいる。現在のボトルネックは「Three.js 依存が広く散っている」ことよりも、以下の二点に移っている。

- 大型ファイルの中に、すでに分離された helper を束ねる orchestration が厚く残っている。
- `renderer-three` 配下が flat に近く、責務分離の成果がディレクトリ構造から読み取りにくい。

そのため、次のリファクタリングでは無理に pure core 化を進めるより、責務名を持つ小さな module へ再配置し、既存の分離成果を見える形にするのが費用対効果が高い。

## 優先度 A: 次に着手する候補

### 1. `materials/point-cloud-material.ts` の uniform 定義と初期化を分離する

現状:

- code 607 行で最大。
- すでに shader define、visible nodes texture、classification / clipping update helper は分離済み。
- それでも `IPointCloudMaterialUniforms`、default uniform 構築、property setter、render-time update が同じファイルに残っている。

提案:

- `materials/point-cloud-material-uniforms.ts`
  - `IPointCloudMaterialUniforms`
  - uniform 初期値生成
  - texture / Color / Vector 初期化の局所化
- `materials/point-cloud-material-properties.ts` または `materials/point-cloud-material-state.ts`
  - public property と uniform の対応を閉じ込める候補
  - ただし setter が `RawShaderMaterial` の状態と強く結びつく場合は無理に切らない

期待効果:

- material 本体を shader material lifecycle と public API に寄せられる。
- uniform 追加時の編集箇所が明確になる。
- WebGPU 版 material を検討する際に、shader 固有 state と UI/semantic state を比較しやすくなる。

注意点:

- `PointCloudMaterial` は public class なので、外部から参照される property 名や挙動を変えない。
- 分割後は `pnpm run typecheck` だけでなく、shader define と clipping の組み合わせに関わる手動確認または小さなユニットテストが欲しい。

### 2. `renderer-three/point-cloud-octree-picker.ts` を render target 管理と探索ロジックに分ける

現状:

- code 346 行。
- hit decode は `point-cloud-pick-result.ts` へ分離済み。
- まだ render target lifecycle、pick window 計算、ray に乗る node 選別、temporary scene 構築、material 同期が同居している。

提案:

- `renderer-three/picking/pick-render-target.ts`
  - render target 作成、resize、pixel read、clear/scissor 設定
- `renderer-three/picking/pick-scene.ts`
  - temporary `Points` node の生成と scene children の差し替え
- `renderer-three/picking/point-cloud-octree-picker.ts`
  - public picker class と処理順の orchestration

期待効果:

- picker の副作用範囲が renderer state、temporary scene、hit decode の三つに分かる。
- picking の不具合調査時に WebGL state 復元漏れと decode 誤りを切り分けやすい。

注意点:

- `renderer.setRenderTarget(prevRenderTarget)` 以外の renderer state 復元が暗黙に残っているため、分割時に scissor test や blend/depth state の扱いを確認する。
- public export は現状維持し、`renderer-three/picking/*` は内部 module として始める。

### 3. `renderer-three` 配下をサブディレクトリ化する

現状:

- `renderer-three` 直下に 16 ファイルが並ぶ。
- adapter、scene node、geometry materialize、picking、feature detection、math conversion が同階層にあり、分離済みの責務が見た目に反映されていない。

提案構造:

```text
packages/core/src/renderer-three/
  index.ts
  adapters/
    point-cloud-visibility-adapter.ts
  geometry/
    octree-node-geometry.ts
  math/
    bounds.ts
    box3-like.ts
    box3-helper.ts
  picking/
    point-cloud-octree-picker.ts
    point-cloud-pick-result.ts
  scene/
    point-cloud-octree-node.ts
    point-cloud-octree-renderer.ts
    point-cloud-octree-scene.ts
    point-cloud-tree.ts
    point-cloud-visibility-view.ts
  features.ts
  constants.ts
  types.ts
```

期待効果:

- pure core から renderer-three へ接続する入口が `adapters` として読める。
- geometry upload と scene node の違いが明確になる。
- 今後 WebGPU renderer を追加する際、`renderer-three` のどの領域を対応させるべきか見積もりやすい。

注意点:

- package export の `./renderer-three` は現在かなり絞られているため、内部 import の機械的更新で済む可能性が高い。
- 一度に移動すると diff が大きくなるため、`picking`、`geometry/math`、`scene/adapters` の順に小分けにする。

## 優先度 B: A の後に検討する候補

### 4. `OctreeLoader.ts` の計測と range decode orchestration を整理する

現状:

- code 360 行。
- hierarchy parse、range cache、batch planning、decode node は分離済み。
- 本体は薄くなったが、`loadMergedOctreeRange()` に read/cache hit/measurement/decode dispatch が集中している。

提案:

- `loading/octree-load-measurements.ts`
  - read/decode/hierarchy measurement の生成補助
- `loading/load-merged-octree-range.ts`
  - `MergedOctreeRange` を buffer slice と decode task へ変換する処理

期待効果:

- `NodeLoader` は「どの node をいつ読むか」の orchestration に集中できる。
- 計測項目の追加や変更で loader 本体を触る量が減る。

注意点:

- `OctreeLoader.ts` はすでに一度大きく分割済みなので、行数削減だけを目的にしない。
- `octree-range-cache.ts` と責務が重なりやすいため、cache class には I/O と buffer cache、load helper には decode task 化、という境界にする。

### 5. `PointCloudVisibilityScheduler` から loader grouping を切り出す

現状:

- code 243 行。
- visibility update の facade と LRU touch/free は scheduler の責務として妥当。
- 一方で `loadGeometryNodes()` 内の loader grouping は、visibility scheduling という名前から少し外れている。

提案:

- `core/visibility/group-geometry-loads.ts`
  - loader ごとの nodes/candidates grouping
  - `loadBatchWithCandidates` がない node の fallback load

期待効果:

- scheduler 本体が point budget、LRU、visibility update の接続に集中する。
- batch load grouping のテストを pure function 寄りに書きやすくなる。

注意点:

- `BatchLoadableGeometryNode` の型境界を広げすぎない。
- loader grouping は loading へ置きたくなるが、現状は visibility scheduler の「選ばれた node をどう load request に変換するか」という責務なので、まずは `core/visibility` 近傍が自然。

### 6. `point-cloud-octree.ts` を facade と Three.js object として再評価する

現状:

- code 162 行まで縮小済み。
- ただし `PointCloudTree` 継承、material 保持、picker、raycast、visible state が同じ public class に残る。

提案:

- すぐに分割するより、まず public API として残すメソッドを明文化する。
- `PointCloudOctree` は利用者向け Three.js object と割り切り、pure data/controller を別名で抽出するかどうかを次フェーズで判断する。

期待効果:

- 無理な分割で外部 API を壊すリスクを避けられる。
- root export の責務を説明しやすくなる。

注意点:

- `PointCloudOctree` は package の主要利用型なので、内部美化だけを目的に破壊的変更をしない。
- WebGPU 対応時に `PointCloudOctree` を renderer 非依存にしたくなる可能性はあるが、その場合は設計判断として別文書で扱う。

## 優先度 C: 今は大きく触らない候補

### worker 実装

対象:

- `loading/brotli-decoder.worker.ts` code 349
- `loading/decoder.worker.ts` code 250

理由:

- 行数は大きいが worker 内に責務が閉じており、現在の構造改善の主因ではない。
- 圧縮形式、属性 decode、worker protocol の変更予定が出た時に合わせて見直す方がよい。

### `core/visibility/update-visibility.ts`

理由:

- code 288 と大きいが、pure core の中心アルゴリズムとして境界が明確。
- callback 注入により renderer 依存は外れている。
- 分割するとアルゴリズムの流れが追いづらくなる可能性がある。

対応方針:

- 今は分割よりテストを優先する。
- point budget、max level、clip、maxLoadsToGPU、load failure、density LOD のケースを固定できると、以降の renderer 側変更が楽になる。

### shader / EDL pass

対象:

- `materials/shaders/pointcloud.fs` code 158
- `rendering/edl-pass.ts` code 161
- `materials/eye-dome-lighting-material.ts` code 107

理由:

- 描画品質に直結し、構造目的の分割だけではリスクが高い。
- EDL や shader の見直しは、WebGPU 戦略または描画機能追加のタイミングで扱うのが妥当。

## 推奨着手順

1. `materials/point-cloud-material.ts` から uniform 定義と初期化を切り出す。
2. `renderer-three/point-cloud-octree-picker.ts` を `picking` 配下へ移し、render target 管理を分離する。
3. `renderer-three` のサブディレクトリ化を小さな移動 PR として進める。
4. `PointCloudVisibilityScheduler` の loader grouping を pure helper 化し、テストを足す。
5. `OctreeLoader.ts` の `loadMergedOctreeRange()` を計測と decode task 化の観点で再分割する。

この順序にすると、public API の破壊を避けながら、行数上位かつ変更効果が読みやすい箇所から整理できる。

## 完了条件

各段階の完了条件は以下とする。

- `pnpm run check:write` が通る。
- `pnpm run typecheck` が通る。
- root export と `packages/core/package.json` の subpath export が意図せず広がらない。
- internal import の移動だけで public import path を変更していないことを確認する。
- 可能なら、分割した pure helper には小さなテストを追加する。

## 補足

今回の `tokei` 結果では `materials/point-cloud-material.ts` が突出しているため、次の一手は material 分割が最も自然である。一方で、過去の計画で重要だった pure core / renderer 境界の大きな問題はすでにかなり減っている。したがって今後は、境界をさらに深く掘るよりも、既存の境界がディレクトリ名とファイル名から読めるようにすることを優先する。
