# packages/core リファクタリング計画

> 本文書は 2026-04-25 時点の `packages/core` を調査し、ディレクトリ構造、ファイル分割、公開 API、責務分離、コードの見通しの改善に向けた段階的なリファクタリング計画をまとめたものである。既存の層分離方針は `docs/packages-core-layer-separation-inventory-20260425.md` を前提としつつ、本書では pure core / renderer 分離に限定せず、コード品質改善全般を対象とする。

> 2026-04-26 更新: Phase 1 は概ね完了し、Phase 2 から Phase 4 にまたがる主要な責務分離も一段落した。`loading/OctreeLoader.ts`、`PointCloudOctree`、`Potree`、`materials/point-cloud-material.ts`、`renderer-three/point-cloud-octree-renderer.ts` の中心責務は段階的に切り出され、次の関心は残る facade の厚み確認と `packages/core/tsconfig.json` まわりの設定整理へ移りつつある。

## 目的

- `packages/core` の現状構造を整理し、見通しを悪化させている要因を明確にする。
- ディレクトリ構造と公開面を、責務ごとに理解しやすい形へ再編する方針を定める。
- 大きな破壊的変更を一度に入れず、段階的に進められる実行計画に落とし込む。

## 調査サマリ

### 構成の概観

- `src/core`
  - structural math、tree model、visibility scheduler などの pure core 寄りの処理が入っている。
- `src/loading`
  - metadata / hierarchy / worker decode / request manager を担うが、一部に Three.js 表現が混在している。
- `src/renderer-three`
  - Three.js 向け adapter、geometry materialize、feature 判定がある。
- `src/materials`
  - material、shader、classification、clipping、gradient など描画寄り処理が集まっている。
- `src/rendering`
  - renderer facade と post-process がある。
- root 直下
  - `potree.ts`、`point-cloud-octree.ts`、`point-cloud-octree-node.ts`、`point-cloud-octree-picker.ts`、`point-cloud-tree.ts` など、利用者から見た主要型が並ぶ。

### 現状の特徴

- TypeScript ファイルは 55 ファイル、総行数は約 7,900 行で、責務の中心が一部の大型ファイルに偏っている。
- 特に大きいのは `materials/point-cloud-material.ts`、`loading/OctreeLoader.ts`、`point-cloud-octree-picker.ts`、`core/point-cloud-visibility-scheduler.ts`、`renderer-three/point-cloud-octree-renderer.ts`、`point-cloud-octree.ts` である。
- Three.js への直接 import は 20 ファイル超に散らばっており、renderer 固有の関心事が package 全体にまだ広く分散している。
- 既存の pure core 分離は進んでいるが、公開 API と主要クラスの責務混在が残っているため、構造を読み取りづらい。

## 現状の主要課題

### 1. root 直下の主要型に責務が集中している

- `potree.ts` は facade でありながら `Camera`、`WebGLRenderer`、picker、visibility scheduler、feature 判定まで横断している。
- `point-cloud-octree.ts` は tree model、visible node state、material、pick、bounding box 更新、scene object 的責務を同時に抱えている。
- `point-cloud-octree-node.ts` も tree node と描画表現の橋渡しを兼務している。

結果:

- package の入口に置かれているファイルほど責務が広く、読み始めた利用者や保守者が依存方向を把握しにくい。
- 変更の影響範囲が読み取りづらく、ファイル分割の判断も遅れやすい。

### 2. tree / loading / renderer の境界が完全には閉じていない

- `point-cloud-tree.ts` は `Object3D` を継承しており、tree model が scene object でもある。
- `OctreeGeometryNode` は loading 側の型でありながら `BufferGeometry` を保持する。
- `constants.ts` は定数ファイルだが Three.js `Color` と `Vector4` を含む。
- `utils/bounds.ts` は util という名前に対して renderer math 依存を持つ。

結果:

- pure core に寄せたい処理を見つけても、依存境界の整理が先に必要になる。
- renderer の差し替えや将来の renderer 拡張時に影響調査コストが高い。

### 3. 大型ファイルがドメインの複数関心を抱えている

- `loading/OctreeLoader.ts` は range read、cache、hierarchy parse、worker decode、load batching を一箇所で扱っている。
- `materials/point-cloud-material.ts` は material 本体、uniform 管理、classification、clipping、shader 切替に近い役割をまとめて抱えている。
- `point-cloud-octree-picker.ts` は picking アルゴリズムと renderer resource 前提が密結合している。

結果:

- 1 ファイル内で文脈が頻繁に切り替わり、局所修正でも副作用の見極めが難しい。
- テストや将来の抽出単位を決めづらい。

### 4. 公開 API の意図が利用者に伝わりにくい

- root export と subpath export の併用自体は始まっているが、利用者が root import だけを見ると pure core 相当と renderer 相当が依然として混在して見える。
- `materials`、`renderer-three`、`core`、facade クラスの関係が import surface から一目で分かりにくい。

結果:

- 内部構造の変更がそのまま public surface の不安定さにつながりやすい。
- package の推奨利用形が曖昧になる。

### 5. 命名と配置が責務を十分に説明していない

- `core` は pure core 寄りだが、root 直下にも中核ロジックが残っている。
- `rendering` と `renderer-three` はどちらも描画関連で、役割の境界が名前からは明快でない。
- `utils` の中に pure helper と renderer 依存 helper が混在している。

結果:

- 新規参加者がディレクトリを見ても責務境界を推定しにくい。
- 「とりあえず既存ファイルに足す」判断が起きやすく、構造が再び崩れやすい。

## 改善方針

### 方針 1. 利用者向け facade と内部実装を明確に分ける

- root 直下は利用者向けの主要入口だけに寄せる。
- tree model、visibility scheduling、loading pipeline、renderer adapter は内部の責務単位でまとまったディレクトリへ移す。
- root import は「通常利用の推奨入口」、subpath export は「意図を持った利用者向けの明示的入口」という役割に整理する。

### 方針 2. pure core と renderer 固有処理の境界をディレクトリと型で揃える

- pure core に残すもの:
  - tree model
  - visibility scheduling
  - metadata / hierarchy / decoded buffer
  - request / worker / cache 制御
- renderer 側に寄せるもの:
  - Three.js scene object
  - material / shader
  - pick の renderer resource
  - geometry materialize
  - post-process

### 方針 3. 大型ファイルは「関心事単位」で分割する

- 行数を均等に割るのではなく、責務が独立してテストしやすい単位で切る。
- 具体的には以下の観点で分割する。
  - state と behavior
  - decoding と transport
  - algorithm と adapter
  - data definition と renderer binding

### 方針 4. util は依存境界ごとに分ける

- pure helper は `core` もしくは `shared` 相当へ置く。
- Three.js 前提 helper は `renderer-three` 配下へ寄せる。
- util という名前だけでは責務が見えにくい場合は、用途ベースの配置に変える。

## 2026-04-26 時点の進捗サマリ

### 完了済み

- `constants.ts` の責務整理を行い、renderer 依存定数を `renderer-three/constants.ts` へ分離した。
- renderer 固有 helper を `utils` から `renderer-three` へ移し、配置だけでは責務が読めない状態を減らした。
- `PointCloudTree`、`PointCloudOctreeNode`、picker 実装を root 直下から `renderer-three` へ移し、描画寄り責務の集約を進めた。
- `PointCloudOctree` と `Potree` から renderer 固有 state の一部を外し、visible bounds と picker を renderer-three 側の helper / WeakMap 管理へ移した。
- `OctreeGeometryNode` から `BufferGeometry` 保持を外し、geometry materialize / dispose を `renderer-three/octree-node-geometry.ts` に集約した。
- `OctreeLoader.ts` から hierarchy parse を `parse-octree-hierarchy.ts` へ、range read/cache を `octree-range-cache.ts` へ、worker decode を `decode-octree-node.ts` へ分離した。
- `OctreeLoader.ts` の batch planning と hierarchy transport も helper 化し、loader 本体を orchestration 中心へ寄せた。
- `PointCloudOctree` の renderer helper 依存を adapter 経由へ集約し、`Potree` の visibility input 構築と post-visibility 更新ループも renderer-three 側へ委譲した。
- `materials/point-cloud-material.ts` から visible nodes texture 管理と shader define 構築を分離し、material 本体の責務を縮小した。
- `renderer-three/point-cloud-octree-renderer.ts` から visibility adapter、rendered-node / scene helper、visibility view / projection 生成を別ファイルへ分離した。

### 進行中

- `PointCloudOctree` と `Potree` は facade としてかなり薄くなったが、src 直下の入口としてはまだ厚みが残っている。
- `renderer-three` 配下の責務分割は進んだが、ファイル配置はまだ `scene`、`geometry`、`adapters` などのサブディレクトリに整理し切っていない。
- `materials/point-cloud-material.ts` は改善したものの、classification / clipping / uniform 更新の一部はなお同一ファイルに残っている。
- `packages/core/tsconfig.json` は構造改善後の実態に対して、設定の整理余地があるかを次段で確認する価値が高い。

### 残作業の判断軸

- ここまでで「loading と renderer の結合を下げる」ための基盤分離は一通り進んだ。
- 今後は「実装の所在が読めること」と「主要 facade を短時間で理解できること」の改善効果が高い。
- そのため、残タスクは loading の追加分割よりも、material / picking / renderer facade の見通し改善を優先するのが妥当である。

## 目標ディレクトリ構造

完全な最終形を一気に目指すのではなく、以下を中期的な到達点とする。

```text
packages/core/src/
  index.ts
  facade/
    potree.ts
    point-cloud-octree.ts
    point-cloud-octree-node.ts
  core/
    index.ts
    geometry/
    tree/
    visibility/
    scheduling/
    types/
    math/
  loading/
    index.ts
    metadata/
    hierarchy/
    transport/
    decode/
    cache/
    workers/
  renderer-three/
    index.ts
    adapters/
    scene/
    geometry/
    picking/
    features/
    math/
    types/
  materials/
    index.ts
    point-cloud/
    edl/
    classification/
    clipping/
    gradients/
    textures/
  rendering/
    index.ts
    passes/
    renderer/
```

補足:

- `facade` は中間段階でのみ導入してもよい。最終的に root 直下へ戻すかどうかは、利用者向け入口の見通しで判断する。
- `core/math` と `renderer-three/math` のように、数学的処理でも依存境界に応じて明示的に分ける。
- `loading/workers` と `loading/decode` を分け、worker transport と decode orchestration を切り離す。

## 具体的な改善対象

### A. facade / 主要型の薄化

対象:

- `potree.ts`
- `point-cloud-octree.ts`
- `point-cloud-octree-node.ts`
- `point-cloud-tree.ts`

改善内容:

- facade は orchestration に集中させ、実処理は `core` / `renderer-three` / `loading` へ委譲する。
- `PointCloudTree` を tree model と scene object の両義的な存在にしない。
- `PointCloudOctree` は利用者向け API を残しつつ、renderer 固有処理の直接保持を減らす。

狙い:

- 主要クラスを読めば「何を調停しているか」が分かる状態にする。
- 実装詳細を辿るときだけ下位層へ降りる構造にする。

### B. loading の責務分割

対象:

- `loading/OctreeLoader.ts`
- `loading/OctreeGeometry.ts`
- `loading/OctreeGeometryNode.ts`
- `loading/WorkerPool.ts`
- `loading/WorkerProtocol.ts`

改善内容:

- range read / cache / hierarchy parse / decode dispatch / decode result apply を別モジュールへ分割する。
- loading 側のノード型は decoded data までを持ち、Three.js `BufferGeometry` の保持は renderer 側へ寄せる。
- metadata と runtime loading state を必要に応じて分ける。

狙い:

- load pipeline を読むときに、I/O、decode、node state の文脈が混ざらないようにする。
- renderer 非依存な読み込み基盤として理解しやすくする。

### C. renderer-three の責務の見える化

対象:

- `renderer-three/point-cloud-octree-renderer.ts`
- `renderer-three/octree-node-geometry.ts`
- `point-cloud-octree-picker.ts`
- `rendering/potree-renderer.ts`

改善内容:

- scene 更新、geometry materialize、pick、post-process をサブディレクトリごとに明示する。
- `point-cloud-octree-picker.ts` は `renderer-three/picking` へ移す候補として扱う。
- `rendering` は renderer facade と render pass に整理し、`renderer-three` との役割差を名前で伝える。

狙い:

- Three.js 固有ロジックを探す場所を限定する。
- renderer を差し替えない場合でも、描画関連の保守コストを下げる。

### D. materials の内部モジュール化

対象:

- `materials/point-cloud-material.ts`
- `materials/clipping.ts`
- `materials/classification.ts`
- `materials/texture-generation.ts`

改善内容:

- material クラス本体と、uniform / classification / clipping / texture generation を分ける。
- 依存の方向は `material class -> module` に揃える。
- shader 切替や texture 生成ロジックは、可能な範囲で構成要素として読みやすくする。

狙い:

- 最も大きいファイルの見通しを改善し、描画機能追加時の変更面を狭める。

### E. constants / types / utils の再配置

対象:

- `constants.ts`
- `types.ts`
- `utils/bounds.ts`
- `utils/lru.ts`
- `utils/binary-heap.ts`

改善内容:

- `constants.ts` は core constants と renderer constants に分ける。
- root `types.ts` は再 export に限定し、定義自体は責務ごとの層に置く。
- `utils` は pure helper と renderer helper を分離し、用途ベースの配置へ寄せる。

狙い:

- 小さなファイルでも依存方向を名前から推定できるようにする。

## 段階的実施計画

### Phase 1. 棚卸しを構造へ反映する

状態:

- 概ね完了

目的:

- 既存の層分離の成果をディレクトリ配置に反映し、次の分割がしやすい状態にする。

作業:

- root 直下の主要ファイルのうち、renderer 固有 helper の import が多いものを洗い出す。
- `renderer-three` と `rendering` の責務定義を文書化し、必要ならサブディレクトリだけ先に切る。
- `constants.ts` と `utils` のうち、依存境界が分かりやすく切れるものから移す。

完了条件:

- ディレクトリ名だけで pure core / loading / renderer の大まかな境界が説明できる。

進捗メモ:

- constants の責務整理、renderer helper の `renderer-three` 集約、tree/node/picker の移設は完了した。
- ただし `renderer-three` 自体の内部サブディレクトリ整理は残っているため、この Phase は「配置の大枠は達成、内部命名は継続改善」の状態で閉じる。

### Phase 2. loading と renderer の結合点を下げる

状態:

- 概ね完了

目的:

- `loading` が decoded data を返し、renderer が Three.js 表現へ変換する流れを明確にする。

作業:

- `OctreeLoader` を range read、hierarchy parse、decode apply の複数モジュールへ分ける。
- `OctreeGeometryNode` の保持データを棚卸しし、renderer 固有状態を外す。
- geometry materialize を `renderer-three/geometry` へ集約する。

完了条件:

- loading 関連ファイルを読んでも Three.js 表現の生成詳細がほぼ出てこない。

進捗メモ:

- `OctreeGeometryNode` から `BufferGeometry` を外し、renderer 側の geometry cache へ移した。
- `OctreeLoader.ts` は hierarchy parse、range read/cache、worker decode の 3 つを別モジュールへ分離済みで、主要な責務分割は完了した。
- batch planning と hierarchy load も helper へ分離済みで、残りは命名や配置の整理が中心になった。

### Phase 3. facade と tree の責務を縮小する

状態:

- 大部分が完了

目的:

- 主要型の読みやすさを改善し、主要ファイルを変更点の入口ではなく調停点にする。

作業:

- `PointCloudTree` の役割を見直し、tree model と scene object の責務を明確化する。
- `PointCloudOctree` の material、pick、visible state 更新を段階的に helper / adapter へ逃がす。
- `Potree` は loading orchestration、visibility scheduling、renderer update の呼び分けに集中させる。

完了条件:

- `potree.ts` と `point-cloud-octree.ts` を読んだとき、内部実装を知らなくても役割が短時間で把握できる。

進捗メモ:

- `PointCloudTree` と `PointCloudOctreeNode` の renderer-three への移設は完了した。
- `PointCloudOctree` から visible bounds / picker の state は外れ、`Potree` の static picker も renderer-three helper に委譲済みである。
- `PointCloudOctree` の renderer helper 依存は adapter に集約され、`Potree` の visibility input 構築も renderer-three 側へ逃がした。
- src 直下の入口としては `point-cloud-octree.ts` と `potree.ts` にまだやや厚みが残るため、ここは必要性を見ながら追加で薄化する。

### Phase 4. materials と picking を保守しやすい単位へ分割する

状態:

- 進行中

目的:

- 描画機能追加時に最も壊れやすい領域を局所化する。

作業:

- `point-cloud-material.ts` から uniform、classification、clipping、texture generation の関心を切り出す。
- picker を `renderer-three/picking` へ寄せ、描画資源との結合を明示する。
- render pass と renderer facade の境界を整理する。

完了条件:

- material / picking の変更で unrelated な描画コードを触る範囲が減る。

進捗メモ:

- picker の実体は `renderer-three` に移設済みだが、`picking` サブディレクトリ化や API の整理までは未着手である。
- `materials/point-cloud-material.ts` から visible nodes texture 管理と shader define 構築は切り出し済みである。
- `renderer-three/point-cloud-octree-renderer.ts` から visibility adapter、scene helper、visibility view 生成は分離済みで、残る主対象は clipping / classification などの material 更新ロジックである。

### Phase 5. 公開 API を整理する

状態:

- 一部着手、まだ後半フェーズ

目的:

- package の推奨利用形を明確にし、内部リファクタリングの自由度を上げる。

作業:

- root export を「通常利用で必要なもの」に絞る。
- `./core`、`./renderer-three`、必要に応じて `./materials` の位置づけを明文化する。
- 破壊的変更がある場合は migration guide を docs に追加する。

完了条件:

- import surface を見るだけで、利用者がどの層を使っているか判別できる。

進捗メモ:

- `./core` と `./renderer-three` の subpath export はすでに使える状態にあり、土台はできている。
- ただし root export の最終整理は内部構造の安定化後に実施すべきで、優先順位はまだ高くない。

## 優先順位

2026-04-26 時点の残作業優先順位:

1. `packages/core/tsconfig.json` の設定棚卸しと役割整理
2. `materials/point-cloud-material.ts` に残る classification / clipping / uniform 更新ロジックの追加分離
3. `renderer-three` 配下の `scene` / `geometry` / `adapters` / `picking` 方向の再配置
4. `potree.ts` と `point-cloud-octree.ts` の追加薄化を行うかの再評価
5. root export と subpath export の最終整理

優先順位の理由:

- 1 は、構造変更後のコンパイル対象、宣言出力、module resolution の前提が実態とずれていないかを確認する意味があり、次段の整備テーマとして妥当である。
- 2 と 3 は依然として構造改善の余地があるが、第一段の主要分離は済んでいるため、次は設定整理と局所改善の比重が高い。
- 4 は現在でも実施可能だが、追加の薄化が本当に必要かは一度評価してからでよい。
- 5 は内部構造と設定の整理が落ち着いた後に進める方が手戻りが少ない。

## 実施時のルール

- 1 回の変更で責務移動とロジック変更を同時にやり過ぎない。
- まず import 方向と配置を整え、その後にロジックを薄くする。
- facade は互換 API の緩衝地帯として使い、内部構造の変更を外へ漏らしにくくする。
- root export の整理は後半に回し、内部構造が落ち着いてから公開面を詰める。

## 各フェーズの検証観点

- `pnpm --filter potree-core typecheck`
- `pnpm --filter potree-core build`
- playground での基本表示確認
- point picking と clipping の退行確認
- 既存 docs との整合性確認

## この計画で期待する効果

- ファイル名と配置から責務を推定しやすくなる。
- root 直下の主要ファイルが読みやすくなり、変更影響の見積もりがしやすくなる。
- loading と renderer の境界が明確になり、将来の描画拡張や最適化の足場が安定する。
- 大型ファイルの局所分割により、コードレビューと保守の負担を下げられる。

## 次のアクション候補

次の実作業としては、以下の順が妥当である。

1. `packages/core/tsconfig.json` を対象に、include / exclude、declaration 出力、moduleResolution、editor 用と build 用の責務を棚卸しする
2. `materials/point-cloud-material.ts` に残る classification / clipping / uniform 更新ロジックの独立性を確認する
3. `renderer-three` のファイル群を `scene`、`geometry`、`adapters`、`picking` へ再配置するか判断する
4. その後に export surface を再点検し、必要なら migration note を docs に追加する

この順で進めると、第一段のリファクタリング成果を保ったまま、次段では設定整理と残る局所改善を安全に進めやすい。