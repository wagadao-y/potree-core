# packages/core WebGPU 移行調査メモ

> 現在の WebGL 側の性能改善優先順位は `packages-core-performance-strategy-20260425.md` を優先する。本文書は WebGPU 移行の中長期検討メモとして扱う。

## 対象範囲

- `packages/core` の点群描画パイプライン
- Three.js / WebGL 依存箇所
- 現在の見た目を保った WebGPU 移行方針
- WebGPU 移行後に描画速度を改善するための方針

## 前提

- 本資料は 2026-04-22 時点の静的コード調査と、Three.js / WebGPU 公式ドキュメントを前提にした移行案である。
- `packages/core/package.json` は `three: ^0.184.0` を devDependency としている。
- Three.js 公式ドキュメント上、`WebGPURenderer` は WebGPU 非対応環境で WebGL 2 backend に fallback できる一方、`ShaderMaterial` / `RawShaderMaterial` / `onBeforeCompile` ベースの custom material は非対応で、node materials / TSL への移植が必要とされている。
- Three.js の `PointsNodeMaterial` ドキュメントでは、WebGPU backend の point primitive は 1 pixel point のみで、サイズ付き点を描くには Sprite + instancing を使う必要があると説明されている。

参考:

- Three.js WebGPURenderer manual: https://threejs.org/manual/en/webgpurenderer
- Three.js WebGPURenderer API: https://threejs.org/docs/pages/WebGPURenderer.html
- Three.js PointsNodeMaterial API: https://threejs.org/docs/pages/PointsNodeMaterial.html
- MDN WebGPU API: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- W3C WGSL: https://www.w3.org/TR/WGSL/

## 現在の WebGL 依存

### 公開 API / 型

- `Potree.updatePointClouds(pointClouds, camera, renderer)` が `WebGLRenderer` を受け取る。
- `Potree.pick(...)` と `PointCloudOctree.pick(...)` も `WebGLRenderer` / `WebGLRenderTarget` に依存する。
- `PotreeRenderer`, `EDLPass`, `ScreenPass` は Three.js の `renderer.render`, `setRenderTarget`, `readRenderTargetPixels`, `renderer.state` を直接使う。

対象ファイル:

- `packages/core/src/potree.ts`
- `packages/core/src/types.ts`
- `packages/core/src/rendering/potree-renderer.ts`
- `packages/core/src/rendering/edl-pass.ts`
- `packages/core/src/rendering/screen-pass.ts`
- `packages/core/src/point-cloud-octree-picker.ts`

### Material / shader

`PointCloudMaterial` は `RawShaderMaterial` を継承し、GLSL3 の raw shader を文字列 define で切り替えている。

対象ファイル:

- `packages/core/src/materials/point-cloud-material.ts`
- `packages/core/src/materials/eye-dome-lighting-material.ts`
- `packages/core/src/materials/blur-material.ts`
- `packages/core/src/materials/shaders/*.vs`
- `packages/core/src/materials/shaders/*.fs`

主な機能:

- `gl_PointSize` による可変サイズ点
- `gl_PointCoord` による circle / paraboloid / weighted splat
- `gl_FragDepth` による paraboloid depth / log depth / reversed depth 対応
- `sampler2D visibleNodes` による adaptive point size / LOD color
- gradient / classification texture lookup
- clip box / sphere / plane
- EDL 用に alpha へ `log2(linearDepth)` を格納
- pick 用に point index と node index を RGBA に encode

### Geometry / loader

loader は `BufferGeometry` / `BufferAttribute` を生成し、`PointCloudOctree.toTreeNode` が node ごとに `THREE.Points` を作る。

対象ファイル:

- `packages/core/src/point-cloud-octree.ts`
- `packages/core/src/point-cloud-octree-node.ts`
- `packages/core/src/loading/OctreeLoader.ts`
- `packages/core/src/loading/binary-loader.ts`

この層は Three.js の geometry 表現に依存しているが、デコード済み属性は typed array なので、WebGPU 用 `GPUBuffer` 生成へ流用しやすい。

## 重要な移行制約

### `RawShaderMaterial` はそのまま使えない

Three.js `WebGPURenderer` を採用する場合、現在の GLSL raw shader をそのまま `PointCloudMaterial` として動かす経路はない。`PointCloudMaterial` は以下のいずれかへ移植する必要がある。

- Three.js TSL / node material
- Three.js の WebGPU backend から離れた独自 WebGPU pipeline + WGSL

### WebGPU の point primitive では現状の点スプライトを再現できない

現在の見た目は `gl_PointSize` と `gl_PointCoord` に依存している。WebGPU backend で `THREE.Points` を使うだけだと、可変サイズ、circle、paraboloid、weighted splat が再現できない。

見た目を維持するには、各点を 1 primitive の point として描くのではなく、点ごとに camera-facing quad を生成する必要がある。

実装候補:

- Three.js WebGPU path: `Sprite` + `PointsNodeMaterial` + instanced buffer attributes
- 独自 WebGPU path: `vertex_index` / `instance_index` から 4 頂点または 6 頂点の billboard quad を procedural に生成

### Post-processing も移植対象

`EDLPass` は WebGL render target と GLSL fullscreen pass に依存する。Three.js 公式ドキュメントでは、従来の `EffectComposer` pass は `WebGPURenderer` では使えず、WebGPU 向け post-processing stack / TSL へ移る前提になっている。

このリポジトリの EDL は独自 pass なので、Three.js WebGPU に乗せる場合でも、EDL shader と render target 管理は別途移植が必要。

## 移行アプローチ

### 案 A: Three.js WebGPURenderer + TSL / node material へ移植

概要:

- `three/webgpu` から `WebGPURenderer` を使う。
- 点群 material を `RawShaderMaterial` から TSL / node material へ置き換える。
- `THREE.Points` ではなく、Sprite instancing で point quad を描く。
- EDL / picking / normalize / blur pass を Three.js WebGPU の post-processing 方式へ移植する。

利点:

- Three.js scene / camera / controls / fallback backend との親和性が高い。
- 利用側は従来の Three.js app に近い構成を保てる。
- WebGPU 非対応環境に WebGL 2 fallback を提供しやすい。

課題:

- 現在の GLSL shader を TSL に再実装する作業量が大きい。
- TSL で点群向けの細かい buffer / render pass / MRT 最適化をどこまで制御できるか検証が必要。
- point quad 化により頂点数は増える。WebGL の `gl.POINTS` と単純比較すると不利になる可能性がある。

向いているケース:

- まず Three.js ecosystem 互換を優先したい。
- core package の利用者に renderer 差し替えだけで試せる path を提供したい。
- 初期段階では性能改善より WebGPU 対応と見た目 parity を優先する。

### 案 B: 点群だけ独自 WebGPU renderer を実装

概要:

- Three.js は camera / scene integration に限定し、点群描画は `GPUDevice` / `GPURenderPipeline` / WGSL で直接実装する。
- loader / LOD / octree / clipping API は維持し、node ごとの属性 typed array から `GPUBuffer` を生成する。
- `PotreeWebGPURenderer` を新設し、Three.js scene render の前後に点群 pass を差し込む。

利点:

- WebGPU の storage buffer、compute shader、indirect draw、MRT、bind group reuse を直接使える。
- adaptive LOD、GPU culling、point compaction、depth prepass など点群専用最適化を入れやすい。
- TSL の表現力や Three.js WebGPU 実装の制約に引きずられにくい。

課題:

- Three.js の render state / depth buffer / color management / XR / render target 連携を自前で合わせる必要がある。
- fallback 用 WebGL path と WebGPU path の二重保守になる。
- picking、EDL、透明 / weighted splat、log depth の parity 検証が重い。

向いているケース:

- 移行後の主要目的が描画速度改善である。
- 大規模点群で CPU draw call overhead や GPU culling を本格的に改善したい。
- Three.js WebGPU の material 制約を避けたい。

### 案 C: WebGL 既定 + WebGPU opt-in の段階移行

概要:

- 既存 `PointCloudMaterial` / `PotreeRenderer` は WebGL path として維持する。
- `PotreeWebGPURenderer` と `WebGPUPointCloudMaterial` 相当を追加し、明示的 opt-in にする。
- 同じ camera / point cloud / material setting から WebGL と WebGPU のスクリーンショット比較を行う。

利点:

- 既存利用者への破壊的変更を抑えられる。
- 見た目 parity を機能単位で検証できる。
- 移行中も WebGL を基準実装として残せる。

課題:

- 一時的に renderer / material / shader の二重実装になる。
- material 設定の対応表と未対応機能の明示が必要。

推奨:

- このリポジトリでは案 C を前提に、内部実装は初期は案 A 寄り、性能改善フェーズで案 B の専用 pipeline へ進めるのが現実的。
- 理由は、現在の公開 API が Three.js 前提であり、いきなり独自 WebGPU renderer に寄せると利用側互換性と検証範囲が大きくなりすぎるため。

## 見た目 parity のために移植する機能

### 1. Point quad 化

現在:

- `THREE.Points`
- vertex shader で `gl_PointSize`
- fragment shader で `gl_PointCoord`

WebGPU:

- 点ごとに billboard quad を生成する。
- quad corner から `pointCoord` 相当の `vec2(-1..1)` を fragment shader へ渡す。
- `fixed_point_size`, `attenuated_point_size`, `adaptive_point_size` の計算は現在の `pointcloud.vs` と同じ式を WGSL / TSL に移植する。

注意:

- 6 vertices per point の non-indexed triangle list は実装が単純だが vertex invocation が多い。
- 4 vertices + index buffer か triangle strip 相当の procedural 生成を検討する。
- node ごとの draw call を減らすまでは、WebGL より速くならない可能性がある。

### 2. Material variant / define

現在は `PointColorType`, `PointSizeType`, `PointShape`, `ClipMode`, EDL, log depth などを `#define` で shader variant 化している。

WebGPU でも variant 管理は必要。初期移植では WebGL と同じ粒度を保つ。

- color type: RGB / HEIGHT / INTENSITY / CLASSIFICATION / LOD / POINT_INDEX など
- point shape: square / circle / paraboloid / weighted splat
- size type: fixed / attenuated / adaptive
- clipping: disabled / outside / inside / highlight
- depth mode: standard / logarithmic / reversed
- format: legacy attributes / `newFormat` rgba

WebGPU では pipeline 作成コストが見えやすいため、`PointCloudMaterial` の setter で即時 pipeline 再生成するのではなく、material key を作って pipeline cache に載せる。

### 3. Adaptive LOD visible node data

現在:

- `visibleNodesTexture` に child mask と child offset を詰める。
- vertex shader が `texture(visibleNodes, ...)` で LOD を辿る。

WebGPU:

- 初期 parity では同じ 1D texture 相当の sampled texture で移植できる。
- 性能改善フェーズでは storage buffer に置き換えるほうがよい。

storage buffer 化の利点:

- texture upload より更新データ構造が素直。
- `u32` mask / offset / level をそのまま扱える。
- compute shader から同じ buffer を参照しやすい。

### 4. Clipping

現在:

- box / sphere / plane の点単位判定は vertex shader。
- CPU 側は clip box + `CLIP_OUTSIDE` の粗い node reject のみ。

WebGPU:

- 点単位 clipping は quad の center point で vertex stage に実装する。
- clip 判定で捨てる場合は quad 全頂点を clip 外へ移動する、または visibility flag を fragment へ渡して discard する。
- 見た目 parity を優先するなら、現在と同じく vertex stage で quad ごと捨てる。

改善余地:

- clip volume を storage buffer 化して最大数制限を緩和する。
- node relation を CPU / GPU の両方で使い、完全外側 node の draw call 自体を消す。

### 5. EDL

現在:

1. 通常 scene を point cloud layer なしで描く。
2. point cloud layer を offscreen target に描く。
3. fullscreen EDL pass で周辺 depth を参照し、default framebuffer へ合成する。

WebGPU:

- color + encoded depth を持つ render target を作る。
- point pass で alpha または別 attachment に `log2(linearDepth)` 相当を書き込む。
- fullscreen pass を WGSL / TSL で移植し、`@builtin(frag_depth)` 相当で depth を復元する。

性能改善フェーズでは、color と depth encoding を別 attachment に分ける MRT を検討する。RGBA color の alpha を depth に使う現在の方式より、format 選択と precision を制御しやすい。

### 6. Picking

現在:

- ray と交差する visible node だけを一時 `Points` として pick scene に描く。
- fragment color に point index、alpha に node index を encode する。
- `readRenderTargetPixels` で小さい window を readback する。

WebGPU:

- 初期 parity では同じ offscreen pick render target + `queue.onSubmittedWorkDone` / buffer map readback に置き換える。
- WebGPU readback は非同期になるため、公開 API は同期戻り値を維持しにくい。

推奨:

- 互換 API として `pickAsync(...)` を追加する。
- 既存 `pick(...)` は WebGL path のみ同期対応、WebGPU path では deprecated または内部で直近結果を返す設計を検討する。

## 実装ステップ案

### Phase 0: 計測と parity fixture

- WebGL 版で基準スクリーンショットを作る。
- material 設定ごとの fixture を用意する。
- `updateVisibility`, `updateMaterial`, draw call 数, visible points, GPU frame time を記録する。

最低限の fixture:

- RGB + adaptive size + square
- RGB + circle
- HEIGHT / INTENSITY / CLASSIFICATION
- clip box / sphere / plane
- EDL on / off
- picking
- perspective / orthographic
- log depth / reversed depth

### Phase 1: renderer 型の抽象化

- `WebGLRenderer` を直接要求する内部 API を `PotreeRenderContext` のような薄い interface へ分離する。
- `renderer.getSize`, `getPixelRatio`, render target size, depth mode など、`updateMaterial` に必要な情報だけを渡す。
- `PointCloudMaterial.updateMaterial` から WebGL 固有の `WebGLRenderTarget` 判定を外す。

狙い:

- WebGL と WebGPU で LOD / material setting の共通部分を共有する。
- renderer 差し替え時の変更範囲を狭める。

### Phase 2: WebGPU point quad prototype

- `newFormat` の `position + rgba + indices` だけを対象に最小 shader を作る。
- fixed point size の square / circle を描く。
- node ごとの `GPUBuffer` を作り、visible node を draw する。
- WebGL の同一 camera とスクリーンショット比較する。

この段階では EDL / adaptive size / clipping / picking は未対応でよい。

### Phase 3: shader feature parity

優先順:

1. attenuated / adaptive point size
2. RGB / HEIGHT / INTENSITY / CLASSIFICATION / LOD
3. circle / paraboloid
4. clipping
5. EDL
6. picking
7. weighted splats / opacity variants

### Phase 4: WebGPU opt-in API

例:

```ts
const potreeRenderer = await PotreeRenderer.create({
  backend: "webgpu",
  fallback: "webgl",
  edl: { enabled: true },
});
```

または既存 renderer と分ける:

```ts
const potreeRenderer = new PotreeWebGPURenderer();
await potreeRenderer.init(canvas);
```

初期は既存 `PotreeRenderer` を壊さず、新 class として追加するほうが安全。

### Phase 5: WebGPU 専用最適化

見た目 parity が取れてから、WebGPU の機能を使った構造変更へ進む。

## 移行後の描画速度改善アプローチ

### 1. draw call batching

現在は visible node ごとに `THREE.Points` を描くため、可視ノード数に比例して draw call が増える。

WebGPU では以下を狙う。

- node 属性 buffer を bind group で個別に切り替えるのではなく、複数 node を大きな GPUBuffer に pack する。
- node metadata buffer に offset / count / transform / material index を持たせる。
- 同一 material variant の node をまとめて draw する。
- 可能なら indirect draw buffer を使い、CPU からの draw loop を短くする。

期待効果:

- CPU render overhead の削減
- bind group / pipeline switch の削減
- visible node 数が多いシーンで効きやすい

### 2. GPU frustum culling / clip culling

現在の LOD / frustum / clip 粗判定は CPU priority queue で行っている。

WebGPU では compute shader で node metadata を評価し、visible node list / indirect draw command を作れる。

段階案:

1. CPU LOD は維持し、clip / frustum reject だけ GPU compute で試す。
2. GPU が visible node flag を作り、CPU は readback せず indirect draw に使う。
3. LOD priority も GPU 側へ寄せる。

注意:

- 現在の traversal は point budget と streaming load と密接に結びついている。
- いきなり全 GPU 化すると loader との連携が難しいため、最初は「ロード済み node の描画 culling」から始める。

### 3. adaptive LOD の storage buffer 化

`visibleNodesTexture` は毎フレーム `Uint8Array` を再構築して texture upload している。

改善案:

- visible node data を `GPUBufferUsage.STORAGE | COPY_DST` の buffer にする。
- child mask / child offset / level / vnStart を `u32` 配列で保持する。
- material 側の `Map<string, number>` 参照を減らし、node metadata に `vnStart` を直接持たせる。

期待効果:

- CPU allocation と texture upload の削減
- shader 側の整数演算が素直になる
- compute culling と同じ metadata を共有できる

### 4. GPU point expansion と compaction

quad 化により頂点数は増えるため、捨てる点を早く減らすことが重要になる。

改善案:

- compute shader で clip / classification alpha / normal filter を先に評価し、生き残る点だけ compact する。
- compacted point buffer を draw する。
- 小さい clip 領域や classification filter で有効点が少ないケースに効く。

注意:

- 毎フレーム全点 compact は高コストになり得る。
- camera / clip / filter が変わった時だけ更新する、または node 単位で cache する。

### 5. EDL の MRT / half float 最適化

現在は EDL 用 color target の alpha に log depth を詰める。

WebGPU では以下を検討する。

- color attachment: `rgba8unorm` または renderer output に合わせた format
- depth encoding attachment: `r16float` / `r32float`
- hardware depth buffer: 通常 depth test 用

期待効果:

- color precision と depth precision を独立に選べる。
- EDL pass の texture bandwidth を制御しやすい。
- alpha を opacity と depth marker の両方に使う曖昧さを解消できる。

### 6. node data upload の永続化

現在は `BufferGeometry` 作成後、Three.js が WebGL buffer upload を管理する。

WebGPU 専用 path では以下を明示的に管理する。

- node loaded 時に `GPUBuffer` を作成し、LRU dispose 時に破棄する。
- worker から戻す属性を material 設定に応じて絞る。
- position / color / intensity などを SoA のまま使うか、よく使う組み合わせを interleave するかを benchmark で決める。

期待効果:

- 不要属性の upload 削減
- GPU memory 使用量の制御
- LRU と GPU resource lifetime の整合

### 7. depth prepass / hierarchical depth

大きい点サイズ、paraboloid、EDL では overdraw が増えやすい。

改善案:

- square / circle point では depth prepass を試す。
- EDL on のときは point color pass と depth encode pass の統合 / 分離を benchmark する。
- 画面タイルごとの approximate depth を compute し、背面点を早期 reject する。

注意:

- 点群は穴が多いため、深度だけで aggressive に捨てると見た目が変わる。
- まずは近似 reject を disabled にできる実験機能として入れる。

### 8. streaming / decode と render の連携

WebGPU 移行だけでは node load の Range request や worker decode は速くならない。

描画速度と体感速度を上げるには、以下も並行して必要。

- 近接 node の Range request batching
- worker から未使用元 buffer を返さない
- material が必要とする属性だけ decode / upload
- `maxBytesInFlight` による通信量制御
- GPU upload queue の backpressure

この項目は `docs/packages-core-performance-strategy-20260425.md` のロード / メモリ改善方針と重なる。

## 推奨ロードマップ

1. WebGL 版の性能 / 見た目基準を固定する。
2. `WebGLRenderer` 型依存を内部 interface へ分離する。
3. WebGPU opt-in renderer を新設し、fixed square point の最小描画を通す。
4. point quad shader で circle / attenuated / adaptive size を再現する。
5. color type と clipping を移植する。
6. EDL と picking を移植する。
7. screenshot / benchmark で WebGL と parity 判定する。
8. draw call batching と storage buffer 化を入れる。
9. GPU culling / indirect draw / compaction を段階的に試す。

## 優先度

高:

- point quad 化の方針確定
- `RawShaderMaterial` からの移植方針確定
- WebGL / WebGPU 共通の renderer context 抽象化
- fixed RGB point の WebGPU prototype
- visual parity fixture

中:

- EDL WebGPU pass
- picking の async API
- visible node data の storage buffer 化
- node GPUBuffer lifetime と LRU 連携

低:

- 完全 GPU LOD traversal
- point compaction
- hierarchical depth / advanced occlusion
- weighted splat の高性能化

## リスク

- Three.js `WebGPURenderer` は改善が続いているが、公式ドキュメント上も experimental とされ、scene setup によっては `WebGLRenderer` のほうが速い場合がある。
- WebGPU へ移行しても、point quad 化で vertex / fragment work が増え、初期実装は WebGL より遅くなる可能性がある。
- `pick(...)` は WebGPU readback の非同期性により API 互換を保ちにくい。
- EDL / log depth / reversed depth / orthographic の組み合わせは見た目差分が出やすい。
- Three.js WebGPU + TSL を選ぶ場合、独自 WebGPU 最適化の自由度が下がる可能性がある。

## 結論

同じ見た目で WebGPU に移行する最大の論点は、renderer 差し替えではなく「点をどう描くか」である。現在の `gl_PointSize` / `gl_PointCoord` 依存を WebGPU で再現するには、点を billboard quad / sprite instancing として描く必要がある。

短期的には WebGL path を維持したまま WebGPU opt-in renderer を追加し、fixed RGB point から段階的に shader parity を広げるのが安全である。中長期的に描画速度を上げるには、Three.js の WebGPU support に乗るだけでは不十分で、draw call batching、storage buffer 化、GPU culling、indirect draw、EDL の MRT 化まで踏み込む必要がある。
