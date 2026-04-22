# packages/core クリッピング処理調査メモ

## 対象

- `apps/playground/src/main.ts`
- `packages/core/src/potree.ts`
- `packages/core/src/materials/point-cloud-material.ts`
- `packages/core/src/materials/shaders/pointcloud.vs`
- `packages/core/src/point-cloud-octree-picker.ts`

## 現在の処理フロー

1. `apps/playground/src/main.ts` の render loop で `potree.updatePointClouds(pointClouds, camera, renderer)` を呼ぶ。
2. `packages/core/src/potree.ts` の `updateVisibility` が CPU 側で LOD / frustum / point budget / minNodePixelSize を評価し、可視ノードを決める。
3. 可視ノードに選ばれた `PointCloudOctreeNode` の `sceneNode.visible` が `true` になり、共有の `PointCloudMaterial` が割り当てられる。
4. `PointCloudMaterial.updateMaterial` が clip box / sphere / plane などの uniform と、adaptive LOD 用の visible node texture を更新する。
5. 実際の点単位クリッピングは `pointcloud.vs` の vertex shader で行われる。

例外として、clip box かつ `ClipMode.CLIP_OUTSIDE` の場合だけ、`potree.ts` の `shouldClip` によって node bounding box 単位の CPU 早期除外が入っている。

## 現在のクリップ機能

- `material.setClipBoxes(...)`
  - `IClipBox.inverse` を `clipBoxes` uniform に詰め、shader で点を box local 空間へ変換して内外判定する。
- `material.setClipSpheres(...)`
  - `center + radius` を `clipSpheres` uniform に詰め、shader で world position との距離を判定する。
- `material.clippingPlanes`
  - Three.js 標準プロパティ名を使っているが、renderer の標準 clipping path ではなく、`syncClippingPlanes` が独自 `clipPlanes` uniform に詰め替えている。

`ClipMode` は以下の意味を持つ。

- `DISABLED`: クリップしない。
- `CLIP_OUTSIDE`: clip volume の内側だけを描画する。
- `CLIP_INSIDE`: clip volume の内側を捨てる。
- `HIGHLIGHT_INSIDE`: 全点を描画し、clip volume の内側をハイライトする。

## Three.js 標準 clippingPlanes との関係

Three.js の `Material.clippingPlanes` は world space の `Plane[]` を受け取り、`WebGLRenderer.localClippingEnabled = true` のときに renderer 側で view space の `clippingPlanes` uniform へ変換する。

ただし `PointCloudMaterial` は `RawShaderMaterial` を継承しているため、Three.js の shader chunk は自動挿入されない。標準 clipping path に乗せるには少なくとも以下が必要になる。

- `PointCloudMaterial.clipping = true` を設定する。
- shader 側で Three.js 標準の `clippingPlanes[NUM_CLIPPING_PLANES]` / `NUM_CLIPPING_PLANES` / `UNION_CLIPPING_PLANES` 形式を扱う。
- playground または利用側で `renderer.localClippingEnabled = true` を設定する。

一方、Three.js 標準 clipping は plane のみを対象とする。現在の box / sphere / `HIGHLIGHT_INSIDE` は Potree 独自機能として残す必要がある。

## 標準実装と独自実装のコスト比較

描画性能だけを見ると、点群用途では現在の独自実装のほうが有利になりやすい。

- 現在の独自実装
  - vertex shader で点ごとに clip 判定する。
  - 捨てる点はラスタライズ前に除外できる。
  - 点サイズが大きい場合や EDL / 透明描画と組み合わせる場合に有利。
- Three.js 標準 clipping
  - 通常は fragment shader 側で `discard` する。
  - 点スプライトが一度ラスタライズされた後にピクセル単位で捨てるため、点サイズが大きいほど不利。
  - renderer 側が plane 変換と uniform 管理を担うため、API 互換性と保守性は高い。

結論として、`material.clippingPlanes` の API 互換性は維持しつつ、内部実装は点群向けの vertex-stage clipping を維持するハイブリッドが現実的。

## LOD / 可視ノード選定とクリッピング

現在は基本的に以下の順で処理される。

1. CPU 側で LOD / 可視ノードを決める。
2. 可視ノード内の各点を GPU 側でクリップする。

ただし clip box + `CLIP_OUTSIDE` だけは、visibility traversal 中に node bounding box と clip box の交差を見て、完全に外側の node を CPU 側で枝刈りする。

このため、plane / sphere / `CLIP_INSIDE` では以下の問題が残る。

- 完全にクリップされる node も可視ノードとして残る。
- draw call と GPU per-point 判定が残る。
- GPU で捨てられる点も `pointBudget` を消費する。
- 小さいクリップ領域だけを見る場合、必要な範囲の詳細 LOD まで到達しにくい。

## CPU 枝刈りの方針

点群では CPU 側で node 単位の粗いクリップ枝刈りを行う価値がある。ただし点単位の正確な判定を CPU で行うのではなく、以下のハイブリッドが望ましい。

- CPU
  - octree node の bounding sphere / bounding box を使い、`Outside` / `Inside` / `Intersecting` を判定する。
  - `Outside` は traversal から除外する。
  - `Inside` は通常の可視 node として扱う。
  - `Intersecting` は GPU の点単位 clipping に任せる。
- GPU
  - 境界 node の各点に対して正確な clip 判定を行う。

判定 enum の例:

```ts
enum ClipNodeRelation {
  Outside,
  Inside,
  Intersecting,
}
```

`ClipMode` ごとの扱い:

- `CLIP_OUTSIDE`
  - clip volume 外側を消す。
  - volume と交差しない node は枝刈り可能。
- `CLIP_INSIDE`
  - clip volume 内側を消す。
  - volume に完全内包される node は枝刈り可能。
- `HIGHLIGHT_INSIDE`
  - 全点を描画するため、基本的に CPU 枝刈りしてはいけない。

## 追加の最適化案

### Clip-aware point budget

`node.numPoints` ではなく、clip relation に基づく概算点数を budget に使う。

- `Outside`: 0
- `Inside`: `node.numPoints`
- `Intersecting`: volume 交差率から保守的に見積もる

これにより、クリップで捨てられる点が budget を浪費しにくくなり、小さいクリップ領域でより深い LOD を選びやすくなる。

### Clip relation cache

clip volume が変化していないフレームでは、node と clip volume の関係は再利用できる。

- material に `clipVersion` を持つ。
- clip volume / clip mode が変わった時だけ `clipVersion` を更新する。
- node に `lastClipVersion` と `clipRelation` を保持する。

カメラ移動だけのフレームでは、visibility traversal 中の clip 粗判定を省略しやすい。

### 2 段階粗判定

CPU 判定を常に高精度にすると traversal が重くなるため、安い判定から順に行う。

1. bounding sphere による cheap reject / accept
2. 曖昧な node だけ bounding box corners や OBB 判定

clip volume 数が複数ある場合は、reject 率が高いものから先に評価する。

### 完全内側 node の GPU clip 判定省略

CPU 側で `Inside` と分かっている node は、GPU 側の clip 判定を省略できる可能性がある。

実装案:

- `onBeforeRender` で node ごとの `clipRelation` uniform を渡し、`Inside` node は shader 内の clip 判定をスキップする。
- もしくは `Inside` node 用に clip define なしの material variant を使う。

まずは shader variant 増加を避けるため、uniform branch で検証するのが安全。

### Shader の少数ケース特殊化

現在の shader は `max_clip_boxes` / `max_clip_spheres` / `max_clip_planes` に対する汎用ループで判定している。

よくあるケースだけ専用 define を持つと、GPU 側の分岐とループを減らせる。

- 1 plane
- 1 sphere
- 1 box
- 3 axis-aligned planes

ただし shader variant が増えるため、最頻出ケースだけに限定する。

### クリップ操作中の LOD 更新間引き

ドラッグやスライダ操作中は、clip uniform 更新を優先し、LOD / visibility traversal は数フレーム間引く。

- 操作中: 低 latency なプレビューを優先。
- 操作終了時: full update を強制し、最終 LOD を確定。

API としては `beginClipInteraction()` / `endClipInteraction()` または `updatePointClouds({ lodThrottle })` のような制御が考えられる。

## 実装優先度

1. `ClipNodeRelation` の導入と `shouldClip` の返り値拡張
2. plane / sphere の CPU 粗判定追加
3. clip relation cache
4. clip-aware point budget
5. 完全内側 node の GPU clip 判定省略
6. shader の少数ケース特殊化
7. クリップ操作中の LOD 更新間引き

## 検証項目

- `updateVisibility` の CPU 時間
- `shouldClip` の CPU 時間
- clip relation cache hit rate
- `Outside` / `Inside` / `Intersecting` node 数
- visible nodes 数
- draw call 数
- GPU frame time
- clip 操作中 FPS
- input latency
- clip 領域内の実効点密度
- 同一 `pointBudget` での見た目の LOD
