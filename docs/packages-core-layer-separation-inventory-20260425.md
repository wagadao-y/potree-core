# packages/core 層分離棚卸し

> 本文書は `packages/core` を WebGL のまま pure core 相当と renderer 相当に論理分離していくための棚卸しである。最終方針は `packages-core-webgpu-strategy-20260425.md` を前提とする。

## 目的

- 現在の `packages/core` のどこに Three.js 依存があるかを整理する。
- pure core 相当へ寄せる対象と、renderer 相当へ残す対象を明確にする。
- WebGPU 実装前に行うべき WebGL 維持下の構造整理の順序を決める。

## 現状の要約

- 現在の `packages/core` は pure core ではなく、Three.js 依存の scene object、material、render pass、picker を含んでいる。
- ただし、loader、request manager、worker、属性定義、一部ユーティリティは pure core 相当に寄せやすい。
- 問題は renderer 依存が一箇所にまとまっていないことであり、公開 API でも `PointCloudOctree`、`Potree.updatePointClouds`、`PointCloudMaterial` などが混在している。

## 着手済み

- `potree.ts` の visibility scheduling 入口と `updateVisibility` 本体は `src/core/visibility/*` へ切り出し済み。
- `updateVisibility` は `WebGLRenderer` を直接受け取らず、renderer 側で作る viewport 情報を受け取る形へ変更済み。
- `updateVisibility` から `PointCloudOctree.toTreeNode()` の直接呼び出しを外し、loaded geometry node の materialize は callback 経由へ変更済み。
- visible tree node の scene 更新と前フレームの rendered visibility reset は `renderer-three/point-cloud-octree-renderer.ts` へ移動済み。
- `core/visibility` は Three.js `Camera` を直接受け取らず、renderer 側で作る visibility view / projection 情報を受け取る形へ変更済み。
- `core/visibility` から `PointCloudOctree` クラスの直接参照を外し、必要な最小 shape を `VisibilityPointCloudTarget` として受け取る形へ変更済み。
- `core/visibility` から `PointCloudOctreeNode` / `PointCloudOctreeGeometryNode` クラスの直接参照を外し、`IPointCloudRenderedNode` / `IPointCloudGeometryNode` の structural interface へ変更済み。
- Three.js scene node 生成、material update、clip visibility、camera view 変換は `renderer-three/point-cloud-octree-renderer.ts` 側へ集約済み。
- `Potree` から renderer-three 個別 helper への依存を減らし、`ThreePointCloudVisibilityAdapter` 経由で visibility callback を接続する形へ変更済み。
- `Potree.updatePointCloudVisibility()` を追加し、renderer / camera を受け取らず precomputed visibility input だけで LOD / load scheduling を実行できる入口を追加済み。
- visibility scheduling、point budget、LRU touch/free、batch load 候補選定は `src/core/point-cloud-visibility-scheduler.ts` へ抽出済み。
- `Potree` は point cloud load、Three.js view / projection 変換、post-visibility material update を束ねる facade へ一段薄化済み。
- `PointCloudTree` の tree state は `src/core/point-cloud-tree-model.ts` として抽出済みで、Three.js `Object3D` 継承は renderer 側 adapter の責務へ寄せ始めた。
- `core/types.ts` と `core/visibility/*` から Three.js math 型 import を外し、`Box3Like` / `SphereLike` / `Vec3Like` と structural visibility view を使う形へ変更済み。
- `IPointCloudVisibilityTarget` を追加し、`PointCloudOctree` は既存 Object3D 継承を維持しつつ visibility target interface を実装する形へ変更済み。
- `point-cloud-octree.ts` の material 初期化、material bound 更新、scene node 生成は `src/renderer-three/point-cloud-octree-renderer.ts` へ一部切り出し済み。
- `types.ts` は `src/core/types.ts` と `src/renderer-three/types.ts` へ最小分割し、既存の `src/types.ts` は再 export の入口に変更済み。
- package export は root に加えて `./core` と `./renderer-three` を追加し、pure core 相当と renderer-three 相当の import surface を分け始めた。
- WebGL feature 判定は `src/renderer-three/features.ts` へ移動済みで、renderer capability 判定の依存方向を renderer 側へ揃えた。
- 現時点の変更は `packages/core` の `pnpm run typecheck` を通過している。

## 分類基準

### pure core 相当

- Three.js の型や scene object を持たない。
- 役割が dataset 読込、階層管理、LOD、デコード、キャッシュ、割当て、可視判定入力生成に留まる。
- 将来の WebGL / WebGPU renderer が共通利用できる。

### renderer 相当

- Three.js の Object3D、Camera、Material、Renderer、BufferGeometry、RenderTarget を直接扱う。
- scene への取り付け、描画、pick、post-process、debug 表示を担う。
- pure core の出力を consumable な描画表現へ変換する。

### 混在

- pure core に置くべき責務と renderer に置くべき責務が同じファイル、同じ型の中で混ざっている。
- この領域が最優先の分離対象である。

## 棚卸し結果

### 1. pure core 相当に寄せる候補

#### 読込と要求管理

- `loading2/LocalPotreeRequestManager.ts`
  - `File` と `fetch` 互換レスポンスを扱うが Three.js には依存しない。
  - local dataset 読込のための request adapter であり pure core 相当。

- `loading2/RequestManager.ts`
  - request abstraction であり pure core 相当。

- `loading2/load-octree.ts`
  - 現状は `OctreeLoader` に委譲する薄い入口。
  - `OctreeLoader` 本体が Three.js 非依存になれば pure core 側へ置ける。

- `loading2/LoadInstrumentation.ts`
  - 計測用型であり pure core 相当。

#### worker とデコード周辺

- `workers/*`
  - Three.js 非依存で、pure core 相当へ寄せるべき。

- `loading2/WorkerPool.ts`
  - worker orchestration であり pure core 相当。

#### データ定義とユーティリティの一部

- `point-attributes.ts`
  - 点属性定義であり pure core 相当。

- `type-predicates.ts`
  - Three.js 非依存へ保てるなら pure core 相当。

- `utils/lru.ts`
  - pure core 相当。

- `utils/binary-heap.js`
  - pure core 相当。

- `workers/custom-array-view.ts`
  - pure core 相当。

### 2. renderer 相当に残す候補

#### rendering と post-process

- `rendering/potree-renderer.ts`
  - 明確に renderer 相当。

- `rendering/edl-pass.ts`
  - 明確に renderer 相当。

- `rendering/screen-pass.ts`
  - 明確に renderer 相当。

#### material と shader

- `materials/*`
  - `PointCloudMaterial`、EDL、blur、classification、gradient、texture generation を含み、Three.js 依存が強い。
  - 全体として renderer 相当。

#### picking と debug 可視化

- `point-cloud-octree-picker.ts`
  - renderer 相当。

- `utils/box3-helper.ts`
  - debug 表示寄りで renderer 相当。

### 3. 混在しており分離対象になる候補

#### `point-cloud-tree.ts`

- 現状は `Object3D` 継承であり renderer 相当。
- ただし名前から受ける期待は tree model であり、抽象ツリー本体は pure core 相当に寄せたい。
- 方針としては、tree model と scene object を分けるべき。

#### `point-cloud-octree.ts`

- 現状は最も強い混在点である。
- 含まれている pure core 寄り責務:
  - visible node 管理
  - bounding volume 保持
  - LOD 関連の設定値
- 含まれている renderer 責務:
  - `Points` 生成
  - `PointCloudMaterial` 保持
  - `onBeforeRender` 接続
  - pick 呼び出し
  - bounding box scene node
- 結論として、将来は data/controller 側と Three.js scene adapter 側へ分解すべき。

#### `potree.ts`

- 現状は pure core orchestration と renderer 更新が混在している。
- pure core 寄り責務:
  - point budget
  - LRU 管理
  - visibility 更新アルゴリズム
  - load queue 制御
- renderer 責務:
  - `updatePointClouds(pointClouds, camera, renderer)`
  - material update 呼び出し
  - bounding box update
  - static pick
- ここは将来 `visibility scheduler` と `three renderer facade` に分けるのが妥当。

#### `types.ts`

- 現状の公開型は `Camera`、`WebGLRenderer`、`Vector3`、`Box3`、`Sphere` を含んでおり renderer 依存している。
- 型の境界を切り直し、pure core 用 public types と renderer 用 public types に分離する必要がある。

#### `loading2/OctreeGeometry.ts`

- Three.js の `Box3`、`Sphere`、`Vector3` を持っており純粋ではない。
- ただし本質は geometry metadata と hierarchy 側であり、Three.js math type を独自型へ落とせば pure core 相当に近い。

#### `loading2/OctreeGeometryNode.ts`

- `BufferGeometry` と `Sphere` を持っており renderer 寄りの設計。
- ただし hierarchy node metadata と geometry upload 状態のような責務は pure core に切り出し得る。

#### `loading2/OctreeLoader.ts`

- `BufferGeometry` と `BufferAttribute` を作っているため renderer 依存。
- metadata / binary decode と geometry object 生成を分割すべき。

#### `loading/binary-loader.ts`

- legacy loader だが Three.js geometry 生成をしており renderer 相当寄り。
- ただしバイナリ解釈部分は pure core へ寄せられる。

#### `point-cloud-octree-geometry.ts`

- Box3、Vector3 に依存している。
- geometry metadata holder として pure core 化の余地はあるが、現状は混在。

#### `point-cloud-octree-geometry-node.ts`

- node metadata と Three.js 側 geometry 状態が混在している。

#### `point-cloud-octree-node.ts`

- tree node と scene node の両方を担っており混在。

#### `constants.ts`

- `Color` と `Vector4` に依存しており pure constant file ではない。
- renderer constants と core constants を分けるべき。

#### `dem-node.ts`

- math 型として `Vector3` などを使っているため、Three.js math 依存をどう扱うかの判断が必要。
- すぐ renderer へ出すより、数値配列または独自 math 型へ寄せられるかを見て判断する。

#### `utils/bounds.ts`

- Box3 と Matrix4 に依存するため renderer math 依存がある。
- util としては再利用価値があるが、pure core に置くなら math 型の置き換えが必要。

## 公開 API の問題点

- `src/index.ts` が materials、rendering、point cloud object、picker をすべてまとめて export している。
- この状態では pure core 相当だけを import する入口が存在しない。
- まずは内部整理より先に export を切るのではなく、内部の論理分離後に export surface を段階的に切るほうが安全。

補足:

- root export は後方互換のため維持している。
- 一方で `./core` と `./renderer-three` を追加したため、新規利用側は混在 export を避けて段階的に移行できる状態になった。

## 最初の分離対象

### 第1段階

- `potree.ts` から visibility scheduler 相当を切り出す。
- `point-cloud-octree.ts` から scene object と material 依存を切り出す。
- `types.ts` の pure core 用型と renderer 用型を分ける。

現状:

- 3 項目とも最小単位の切り出しには着手済み。
- ただし `point-cloud-octree.ts` と `potree.ts` にはまだ renderer 依存が残っており、分離途中の段階である。

### 第2段階

- `loading2/OctreeLoader.ts` を metadata / decode / Three geometry 生成に分割する。
- `point-cloud-octree-node.ts` と `point-cloud-tree.ts` から Object3D 継承前提を外せる構造を考える。
- `constants.ts` を core constants と renderer constants に分割する。

### 第3段階

- `index.ts` の export surface を pure core と renderer で整理する。
- その後に WebGL renderer と WebGPU renderer が共通利用する core API を固定する。

## 推奨するディレクトリ方針

- 当面は単一パッケージ内でよい。
- ただし新規コードは次の意図で配置する。

- `src/core/*`
  - dataset、hierarchy、LOD、decode、cache、allocator、visibility planning

- `src/renderer-three/*`
  - scene adapter、material、rendering pass、picker、debug helper

- `src/shared/*`
  - 純粋 utility、型、定数のうち renderer 非依存に保てるもの

実際のディレクトリ名は今後調整してよいが、依存方向は `core -> shared`、`renderer-three -> core/shared` に固定する。

## 結論

- 次にやるべきことは WebGPU 実装追加ではなく、現行 WebGL 実装を保ったまま `packages/core` の混在責務を論理分離すること。
- 最優先の切り出し対象は `potree.ts`、`point-cloud-octree.ts`、`types.ts` である。
- ここを整理してから WebGPU renderer を載せるほうが、将来の `renderer-three` / `renderer-webgpu` 分離へ自然につながる。
