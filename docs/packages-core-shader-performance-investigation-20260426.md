# packages/core シェーダーパフォーマンス調査 2026-04-26

## 目的

- `packages/core/src/materials/shaders` 配下の現行シェーダーを確認し、描画パフォーマンス改善の余地を整理する。
- 実装前に、GPU hot path に効きやすい候補と、CPU / GC 側の周辺改善候補を切り分ける。
- 既存のパフォーマンス方針は `docs/packages-core-performance-strategy-20260425.md` を前提にし、本書ではシェーダーに絞った追加調査結果を扱う。

## 対象

対象ファイル:

- `packages/core/src/materials/shaders/pointcloud.vs`
- `packages/core/src/materials/shaders/pointcloud.fs`
- `packages/core/src/materials/shaders/edl.vs`
- `packages/core/src/materials/shaders/edl.fs`

行数測定:

```sh
tokei packages/core/src/materials/shaders
```

結果:

| Language | Files | Lines | Code | Comments | Blanks |
| --- | ---: | ---: | ---: | ---: | ---: |
| F# | 2 | 328 | 214 | 64 | 50 |
| Total | 2 | 328 | 214 | 64 | 50 |

注: `tokei` は `.fs` を F# として集計するため、`pointcloud.fs` と `edl.fs` のみが上記に出ている。`.vs` も調査対象に含めている。

## 全体所見

改善余地はある。特に効果が見込めるのは次の領域である。

- adaptive point size / LOD color 時の vertex shader 内 LOD 算出
- EDL post-process の fullscreen fragment shader
- clipping 有効時の vertex shader 内 world position 計算
- classification color の重複 texture lookup
- weighted splats の fragment shader 内 ALU

一方、常に全モードで効く改善は限られる。現行の `PointCloudMaterial` は define によって多くの分岐をコンパイル時に落としているため、各案は「どの描画モードで効くか」を明確にして実装する必要がある。

## 優先度 A: GPU hot path に効く可能性が高い案

### 1. `pointcloud.vs` の octree LOD 算出を軽量化する

対象:

- `pointcloud.vs` の `getLOD()`
- `adaptive_point_size` または `color_type_lod` かつ `tree_type_octree` のとき

現状:

- 各頂点ごとに最大 31 step の loop を回す。
- loop 内で `pow(2.0, i + level)`、`texture(visibleNodes, ...)`、bit 判定、child offset 算出を行う。
- dense view では頂点数に比例してこのコストが増えるため、adaptive point size 使用時の主要コストになりやすい。

改善案:

- `pow(2.0, i + level)` を loop 内で毎回呼ばず、初期値を作って `nodeSizeAtLevel *= 0.5` で更新する。
- `numberOfOnes(mask, index - 1)` は、WebGL2 / GLSL ES 3.00 前提なら `bitCount()` と mask 操作で置き換えられるか検証する。
- `int(round(value.r * 255.0))` 系の decode を局所 helper 化し、同じ値を複数回変換しない。

期待効果:

- adaptive point size 有効時の vertex ALU 削減。
- LOD color 表示時の vertex ALU 削減。

注意点:

- `visibleNodes` texture の encoding と child offset 仕様を変えない。
- `bitCount()` 採用時は WebGL2 / GLSL ES 3.00 での実機互換性を確認する。
- LOD の境界が 1 level ずれると見た目と point size が変わるため、既存 dataset で比較が必要。

### 2. draw call ごとに一定の scale 計算を uniform 化する

対象:

- `pointcloud.vs` の point size computation

現状:

```glsl
float scale = length(modelViewMatrix * vec4(0, 0, 0, 1) - modelViewMatrix * vec4(spacing, 0, 0, 1)) / spacing;
projFactor *= scale;
```

この値は material / node / camera の組み合わせで決まり、頂点ごとに変わらない。現状は各頂点で matrix multiply を 2 回実行している。

改善案:

- CPU 側の `onBeforeRender` または material update 時に scale を計算し、uniform として渡す。
- shader 側は `projFactor *= spacingScale` のような形にする。

期待効果:

- 全 point size mode のうち、`attenuated_point_size` / `adaptive_point_size` で頂点ごとの行列演算を削減できる。
- 点数が多い steady-state で効きやすい。

注意点:

- node ごとの scale、octree scale、camera view matrix の更新タイミングを正しく扱う。
- uniform 更新が draw call ごとに増えるため、既存の `onBeforeRender` 更新とまとめる。

### 3. EDL の背景 fragment を早期 discard する

対象:

- `edl.fs`

現状:

- `main()` で現在 pixel の depth を読んだ後、背景 `depth == 0.0` でも先に `response(depth)` を呼ぶ。
- `response()` は `NEIGHBOUR_COUNT` 回の texture sampling を行う。
- 背景 discard は近傍 sampling の後に実行される。

改善案:

```glsl
float depth = color.a;
depth = (depth == 1.0) ? 0.0 : depth;
if (depth == 0.0) {
	discard;
}
float res = response(depth);
```

期待効果:

- EDL 有効時、背景領域で `NEIGHBOUR_COUNT` 回の texture fetch を丸ごと避けられる。
- 点群が画面全体を覆わない view では効果が出やすい。

注意点:

- 現行は depth が 0 の fragment に対して `response()` 内で `100.0` を足す分岐があるが、その後 discard しているため最終色には寄与しない。
- depth write の扱いが変わらないことを確認する。

## 優先度 B: 条件付きで効く案

### 4. clipping の world position 計算を共有する

対象:

- `pointcloud.vs` の clipping block

現状:

- clip box loop 内で `clipBoxes[i] * modelMatrix * vec4(position, 1.0)` を毎回計算している。
- clip sphere と clip plane でも別々に `modelMatrix * vec4(position, 1.0)` を計算している。

改善案:

- clipping block の先頭で `vec4 worldPos = modelMatrix * vec4(position, 1.0);` を一度だけ作る。
- clip box は `clipBoxes[i] * worldPos` を使う。
- sphere / plane も同じ `worldPos` を使う。

期待効果:

- clipping 有効時、頂点ごとの matrix multiply を削減できる。
- clip box 数が増えるほど効果が大きい。

注意点:

- clipping 無効時に余計な world position 計算を増やさないよう、`#if defined use_clip_box || ...` block 内に閉じる。

### 5. classification の texture lookup を重複させない

対象:

- `pointcloud.vs` の `color_type_classification`

現状:

- classification color で `vec4 cl = getClassification(); vColor = cl.rgb;` を実行する。
- その後、alpha 0 の cull 判定で `getClassification().a` を再度呼ぶ。
- 結果として classification 表示時に同じ LUT を 2 回 texture lookup する。

改善案:

- classification branch 内で取得した `cl` を alpha 判定にも使う。
- define の組み合わせ上、`color_type_composite` との分岐を壊さない形にする。

期待効果:

- classification 表示時に 1 頂点 1 texture lookup を削減できる。

注意点:

- `color_type_composite` では classification alpha が重みとして使われるため、既存挙動を維持する。
- classification alpha 0 の cull は color type classification の時だけなのか、他 mode でも意図されるのかを確認する。

### 6. weighted splats の weight 計算から sqrt を外す

対象:

- `pointcloud.fs` の `weighted_splats`

現状:

```glsl
float wx = 2.0 * length(pc);
float w = exp(-wx * wx * 0.5);
```

`length(pc)` は sqrt を含むが、最終的に二乗している。

改善案:

```glsl
float w = exp(-2.0 * dot(pc, pc));
```

期待効果:

- weighted splats 有効時の fragment ALU を削減できる。

注意点:

- 数式上は同等だが、丸め差による見た目の差分は確認する。
- weighted splats は EDL とは同時使用されない想定があるため、該当 render path で個別に確認する。

## 優先度 C: CPU / GC 側の周辺改善

### 7. EDL projection matrix uniform 更新時の allocation をなくす

対象:

- `EyeDomeLightingMaterial.setProjectionMatrix()`
- `EDLPass.render()`

現状:

- `EDLPass.render()` は毎フレーム `setProjectionMatrix(camera.projectionMatrix)` を呼ぶ。
- `setProjectionMatrix()` は毎回 `new Float32Array(16)` を作って uniform に代入している。

改善案:

- constructor で確保済みの `Float32Array(16)` を再利用し、`set()` だけ行う。
- uniform object 自体の参照も維持する。

期待効果:

- EDL 有効時の per-frame allocation を削減できる。
- GPU time ではなく、CPU frame time / GC spike の安定化に効く可能性がある。

注意点:

- Three.js が uniform value の同一参照更新を正しく拾うことを確認する。

## 実装順の推奨

1. EDL 背景早期 discard
   - 変更が小さく、効果が出る条件も明確。
2. classification texture lookup 重複削除
   - 変更が局所的で、classification 表示時の削減が明確。
3. weighted splats の weight 計算簡略化
   - 数式確認しやすく、変更が小さい。
4. clipping world position 共有
   - clipping 組み合わせの確認が必要だが、実装範囲は shader 内で閉じる。
5. point size scale uniform 化
   - CPU 側 uniform 更新設計が必要なため、shader 単体変更より少し重い。
6. octree LOD 算出軽量化
   - 効果は大きい可能性があるが、LOD 境界の視覚差分検証が必要。

## 検証観点

共通:

- FPS
- GPU time
- submitted points
- draw calls
- visible nodes
- shader compile error がないこと

個別:

- adaptive point size ON / OFF
- `PointColorType.LOD`
- `PointColorType.CLASSIFICATION`
- clipping box / sphere / plane の単独と併用
- EDL ON、背景面積が大きい view / 点群が画面を覆う view
- weighted splats ON
- perspective / orthographic camera
- logarithmic depth buffer / reversed depth buffer の有無

## 現時点で見送る案

- シェーダーの大規模分割や include 化
  - 現状は define による dead code elimination が効いており、性能改善としての優先度は低い。
- EDL の depth encoding 変更
  - alpha channel に `log2(linearDepth)` を入れる現行仕様は pass 間 contract になっているため、見た目と互換性の検証負荷が高い。
- `new_format` と旧 format の統合
  - shader の見通し改善にはなるが、描画性能改善としては主戦場ではない。

