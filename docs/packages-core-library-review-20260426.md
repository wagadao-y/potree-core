# packages/core ライブラリレビュー 2026-04-26

## 概要

このリポジトリは、`PointCloudOctree` を Three.js の scene graph に載せる `Object3D` として公開し、`Potree` が Potree データの読込と visibility scheduling を担い、必要に応じて `PotreeRenderer` が EDL 描画を補助する構成になっている。

- 完成済み viewer ではなく、Three.js アプリケーションへ組み込む描画ライブラリとして設計しようとしている方向性自体は妥当である。
- 特に、visibility の中核を `core` に寄せ、Three.js 依存を adapter 層へ逃がしている点は保守性の観点で評価できる。
- 一方で、データ読み込みフロー、ピック精度、worker と GPU を含むライフサイクル管理、公開 API の拡張性には、ライブラリとして実害のある問題が残っている。

## 全体所見

良い点:

- `Potree`、`PointCloudOctree`、`PotreeRenderer` の大枠の責務分離は比較的明確で、viewer アプリへ全面的に閉じてはいない。
- `PointCloudVisibilityScheduler` と Three.js adapter の分離は、中長期的な renderer 差し替えや WebGPU 展開にも耐えやすい。
- `three` を `peerDependencies` にしている点は、ライブラリとして妥当である。

懸念点:

- Potree データ読み込みフローが `metadata.json` 起点の文字列置換に依存しており、署名付き URL 3 本や OPFS などの将来要件に対して脆い。
- worker と fetch の失敗処理、dispose 境界、pick の座標変換が甘く、組み込み先アプリケーションで不具合化しやすい。
- examples と配布 API の境界が緩く、ライブラリとしての公開面が十分に検証されていない。

## レビュー結果

### 1. 圧縮 worker の命名と責務境界が誤解を招く

- 状態: 完了

- 重要度: Medium
- 対象ファイル・該当箇所:
  - `packages/core/src/loading/WorkerPool.ts`
    - worker 種別と生成 worker の対応
  - `packages/core/src/loading/decode-octree-node.ts`
    - `encoding` から worker 種別を選ぶ処理
  - `packages/core/src/loading/compressed-decoder.worker.ts`
    - Brotli / Zstd の両圧縮形式を処理する worker 本体
- 問題の内容:
  - Brotli と Zstd は別経路ではなく、同じ圧縮 worker 内で `encoding` を見て分岐する実装である。
  - それにもかかわらず、旧命名では worker type と worker ファイル名が圧縮方式別に分かれているように読め、Zstd 専用 worker が存在するかのような誤解を招いていた。
- なぜ問題なのか:
  - 実際の decode 経路は壊れていないが、命名と責務の表現が実装実態とずれていると、レビュー、保守、将来の worker 分離判断を誤りやすい。
  - 特に Zstd 対応の有無や、pool が何を単位に分離されているかをコードから素直に読み取れない。
- 対応内容:
  - worker を「圧縮 worker」と「非圧縮 worker」の 2 種別へ整理し、Brotli / Zstd は共通の圧縮 worker で扱う形に改めた。
  - 残る回帰テスト追加はテスト項目へ切り出す。
- 可能な修正例または疑似コード:

```ts
function createWorker(type: WorkerType): Worker {
  switch (type) {
    case WorkerType.COMPRESSED_DECODER_WORKER:
      return new CompressedDecoderWorker();
    case WorkerType.UNCOMPRESSED_DECODER_WORKER:
      return new UncompressedDecoderWorker();
  }
}
```

### 2. dispose 時の decoder worker terminate 経路は実装済みで、playground の点群切替でも dispose を通す

- 状態: 完了

- 重要度: Medium
- 対象ファイル・該当箇所:
  - `packages/core/src/loading/OctreeLoader.ts`
    - `workerPool` の所有
  - `packages/core/src/loading/OctreeGeometry.ts`
    - `dispose()` 内の `this.loader.dispose()` がコメントアウトされたまま
  - `packages/core/src/loading/WorkerPool.ts`
    - `dispose()` / `terminate()` 相当の API 不在
- 問題の内容:
  - `WorkerPool.dispose()`、`OctreeLoader.dispose()`、`OctreeGeometry.dispose()` の terminate 経路を実装した。
  - あわせて playground の点群切替時に `PointCloudOctree.dispose()` を呼び、不要になった worker が残り続けないようにした。
- なぜ問題なのか:
  - terminate 経路があっても、アプリケーション側で dispose を呼ばなければ worker はページ寿命まで残る。
  - GPU リソースだけでなく worker も解放するのが、描画ライブラリとして自然な所有権境界である。
- 対応内容:
  - `PointCloudOctree.dispose()` から terminate まで届く所有境界を整えた。
  - playground の点群切替時に dispose を通すようにした。
  - 残る回帰テスト追加はテスト項目へ切り出す。
- 可能な修正例または疑似コード:

```ts
class WorkerPool {
  dispose(): void {
    for (const workers of Object.values(this.workers)) {
      for (const worker of workers) {
        worker.terminate();
      }
    }
  }
}

class OctreeLoader {
  dispose(): void {
    this.workerPool.dispose();
  }
}
```

### 3. `metadata.json` 文字列置換依存の URL 解決モデルが、ライブラリ API の拡張性を塞いでいる

- 重要度: High
- 対象ファイル・該当箇所:
  - `packages/core/src/loading/RequestManager.ts`
    - `getUrl(url: string): Promise<string>`
  - `packages/core/src/loading/load-octree-hierarchy.ts`
    - `metadata.json` から `hierarchy.bin` への文字列置換
  - `packages/core/src/loading/octree-range-cache.ts`
    - `metadata.json` から `octree.bin` への文字列置換
  - `packages/core/src/loading/LocalPotreeRequestManager.ts`
    - `File` 前提のローカル実装
- 問題の内容:
  - API 契約は単一 URL を解決するだけだが、実装側では `metadata.json` から `hierarchy.bin` と `octree.bin` を機械的に導出している。
  - ローカル側も `File` を前提にしており、OPFS や他の range-readable source へ自然に広げにくい。
- なぜ問題なのか:
  - 3 本の署名付き URL、query が異なる配信、短寿命 URL の再発行、OPFS source など、今後必要になるデータセットアクセスモデルに対応しにくい。
  - これは単なる実装都合ではなく、公開 API の責務境界が Potree データセット単位になっていないことが根本原因である。
- 推奨される修正方針:
  - `metadata`、`hierarchy`、`octree` を resource kind 付きで解決できる契約へ上げる。
  - 中期的には `fetch` 抽象ではなく、Potree データセット source 抽象へ整理する。
- 可能な修正例または疑似コード:

```ts
type PotreeResourceKind = "metadata" | "hierarchy" | "octree";

interface PotreeDatasetSource {
  getResourceUrl(kind: PotreeResourceKind): Promise<string>;
  readText(kind: "metadata"): Promise<string>;
  readRange(
    kind: "hierarchy" | "octree",
    start: bigint,
    endExclusive: bigint,
  ): Promise<ArrayBuffer>;
}
```

### 4. ピック時の座標系取り扱いは条件付きで誤用しやすく、追加検証が必要

- 重要度: Medium
- 対象ファイル・該当箇所:
  - `packages/core/src/renderer-three/picking/point-cloud-octree-picker.ts`
    - ray から pixelPosition を導出する処理
  - `apps/playground/src/main.ts`
    - `Potree.pick()` の利用例
- 問題の内容:
  - `point-cloud-octree-picker.ts` の Y 変換式は、画面座標の直感とは逆向きに見える。
  - ただし playground での実測では、`Potree.pick()` の既定経路は screen 再投影で 1 から 2 px 程度の差に収まり、上下反転のような大きな乖離は確認できなかった。
  - 一方で `params.pixelPosition` は内部で無変換利用されるため、呼び出し側が左上原点の DOM 座標をそのまま渡すと、座標系の取り違えを起こす余地がある。
- なぜ問題なのか:
  - 既定経路が常時壊れているとは現時点で言えないが、API 利用者が `pixelPosition` の座標系を誤解しやすい。
  - playground 側も ray 生成で canvas の配置や DPR 差を吸収しておらず、レイアウト条件次第で別種の座標ずれが表面化しうる。
- 推奨される修正方針:
  - `pixelPosition` がどの座標系を要求するかを明文化する。
  - 必要なら canvas 左上原点の座標を受ける公開 API を別途用意し、内部で framebuffer 座標へ正規化する。
  - 既定経路の式修正は、専用の再現ケースと自動テストを用意してから判断する。
- 可能な修正例または疑似コード:

```ts
interface PickParams {
  // framebuffer pixel 座標なのか、canvas 左上原点の座標なのかを明示する
  pixelPosition?: Vector3;
}

function normalizeCanvasPixelToFramebuffer(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  return { x, y: height - y };
}
```

### 5. fetch 成功判定と range 応答検証がなく、I/O エラーが壊れた parse/decode として伝播する

- 重要度: High
- 対象ファイル・該当箇所:
  - `packages/core/src/loading/OctreeLoader.ts`
    - metadata fetch 後に `response.ok` を見ず `response.json()` を呼ぶ
  - `packages/core/src/loading/load-octree-hierarchy.ts`
    - hierarchy range fetch 後のステータス未検証
  - `packages/core/src/loading/octree-range-cache.ts`
    - octree range fetch 後のステータス未検証
- 問題の内容:
  - metadata、hierarchy、octree の各 fetch 経路で HTTP ステータスや `Content-Range` を確認していない。
- なぜ問題なのか:
  - 403、404、署名付き URL 期限切れ、range 非対応、部分破損などが、JSON parse error や decode failure としてしか観測できなくなる。
  - secure delivery や部分読込の運用時に、原因別の取り扱いができない。
- 推奨される修正方針:
  - metadata は 200 系、range 読込は 206 と `Content-Range` の整合を確認する。
  - エラーは原因別の型または code を持つ形で上位へ返す。
- 可能な修正例または疑似コード:

```ts
const response = await requestManager.fetch(url, init);
if (!response.ok) {
  throw new PotreeLoadError("range-fetch-failed", response.status, url);
}

if (isRangeRequest && response.status !== 206) {
  throw new PotreeLoadError("range-not-supported", response.status, url);
}
```

### 6. ピック処理が renderer state を汚染しやすく、ホスト側レンダリングへ副作用を残す

- 重要度: Medium
- 対象ファイル・該当箇所:
  - `packages/core/src/renderer-three/picking/pick-render-target.ts`
    - `depthTest`、`depthWrite`、`blending`、`scissor`、render target の直接変更
  - `packages/core/src/renderer-three/picking/point-cloud-octree-picker.ts`
    - pick 前後の state 保存と復元
- 問題の内容:
  - pick 中に renderer の内部状態を直接変更する一方で、確実に復元しているのは render target 程度に留まる。
- なぜ問題なのか:
  - 利用者のアプリケーション側で multi-pass、postprocess、独自 render state 管理をしている場合、呼び出し順によって描画が壊れる恐れがある。
  - ライブラリとして Three.js アプリへ自然に組み込むには、renderer state の副作用を最小化すべきである。
- 推奨される修正方針:
  - pick 前に変更対象の state を保存し、`finally` で必ず復元する。
  - 可能であれば pick 用 pass に閉じ込め、外部 renderer 状態へ直接触れる範囲を減らす。
- 可能な修正例または疑似コード:

```ts
const prev = captureRendererState(renderer);
try {
  preparePickRender(...);
  renderPickScene(...);
} finally {
  restoreRendererState(renderer, prev);
}
```

### 7. examples が公開 package surface ではなく内部 source に依存しており、配布 API を検証できていない

- 重要度: Medium
- 対象ファイル・該当箇所:
  - `apps/playground/src/main.ts`
    - `packages/core/src/...` への直接 import
  - `packages/core/src/index.ts`
    - 公開エントリーポイント
  - `packages/core/package.json`
    - `exports`
- 問題の内容:
  - playground が公開 export ではなく内部 source ファイルへ直接依存している。
- なぜ問題なのか:
  - 実際の npm 利用者が使う API 面と、リポジトリ内で検証している面が一致しない。
  - export 漏れや公開 API の破壊的変更が、example では見逃される。
- 推奨される修正方針:
  - examples は必ず `potree-core` および `exports` に定義したサブパスだけを利用する。
  - 必要な内部ユーティリティは、正式に export するか example 側で自前実装する。
- 可能な修正例または疑似コード:

```ts
import { somePublicHelper } from "potree-core/renderer-three";
```

### 8. 読込、LOD、pick、dispose、エラー系を守る自動テストが実質存在しない

- 重要度: Medium
- 対象ファイル・該当箇所:
  - `packages/core/package.json`
    - `test` script 不在
  - `packages/core` 配下
    - 明確な test/spec 構成が見当たらない
- 問題の内容:
  - 自動テストの仕組みが事実上なく、主要ロジックの退行を継続的に防げていない。
- なぜ問題なのか:
  - このライブラリは非同期 I/O、worker、GPU resource、LOD、pick と複数の壊れやすい境界を持つ。
  - 今回見つかった Zstd 経路や pick 座標のような不具合は、自動テストがあれば早期に検知できた可能性が高い。
- 推奨される修正方針:
  - loading、visibility、pick、dispose、package exports の少なくとも 5 系統は自動化する。
  - レンダリング品質は visual regression か headless WebGL smoke test を併用する。
- 可能な修正例または疑似コード:

```ts
it("loads a zstd-encoded node", async () => {
  const pointCloud = await potree.loadPointCloud(...);
  expect(pointCloud.pcoGeometry.root).toBeDefined();
});
```

### 9. デバッグ bounding box 表示が親 scene を直接書き換え、viewer 寄り責務が public object に混ざっている

- 重要度: Low
- 対象ファイル・該当箇所:
  - `packages/core/src/renderer-three/adapters/point-cloud-octree-renderer.ts`
    - `bbroot` を親 object へ自動追加する処理
- 問題の内容:
  - `showBoundingBox` を有効にすると、`PointCloudOctree` 自身ではなく親 object 配下へ `bbroot` を固定名で追加し、その children を差し替える。
- なぜ問題なのか:
  - 利用者の scene graph を暗黙に書き換えるため、debug overlay や scene 管理ロジックと衝突しやすい。
  - ライブラリとしては viewer 的なデバッグ責務が public object へ混入している。
- 推奨される修正方針:
  - debug 表示は `PointCloudOctree` 配下に閉じるか、明示的に helper object を返す API に分離する。
- 可能な修正例または疑似コード:

```ts
const overlay = createBoundingBoxOverlay(pointCloud);
scene.add(overlay);
```

## 観点別メモ

### ライブラリ設計・公開 API

- `Potree` が loader と visibility policy の中心、`PointCloudOctree` が scene object 兼ユーザー向け facade という構図はわかりやすい。
- ただし、`RequestManager` の責務は Potree データセット単位ではなく URL 単位に閉じており、公開 API と将来要件が噛み合っていない。
- examples が内部 source へ直接依存しているため、利用者向け API 面の完成度評価が難しくなっている。

### Three.js との統合設計

- `PointCloudOctree` を `Object3D` として scene に載せる方式は自然である。
- `PotreeRenderer` は EDL を opt-in にしており、通常の `renderer.render(scene, camera)` を壊していない点は良い。
- 一方で pick 処理は renderer state への副作用が強く、Three.js アプリへの統合面で改善余地がある。

### Potree / 点群データ処理

- metadata、hierarchy、octree の 3 資源を持つ Potree 形式に対して、現在の API はまだ十分に抽象化されていない。
- 読込失敗時の原因別ハンドリングが弱く、署名 URL や破損データ時の運用が難しい。

### 描画性能

- `PointCloudVisibilityScheduler` による point budget、max loads to GPU、max nodes loading の枠組み自体はある。
- ただし、ボトルネックの多くは今後 worker 管理、ロード失敗 handling、pick の候補絞り込みで顕在化しやすい。

### ピック処理・空間検索

- pick は visible node ベースの offscreen render で構成されており、Three.js の `Raycaster` 補完も用意されている。
- 一方で座標系契約がまだ曖昧で、renderer state 汚染とあわせて実運用での統合リスクが残っている。

### 状態管理・ライフサイクル

- `PointCloudOctree.dispose()` で geometry、material、picker、LRU を片付ける意図は明確である。
- worker terminate 経路は実装されたが、共有 picker など補助リソースの寿命管理は引き続き整理余地がある。

### 非同期処理・Worker・I/O

- worker decode によるメインスレッド負荷軽減は妥当である。
- ただし cancel、timeout、retry、原因別エラー伝播は未整備で、失敗系の堅牢性が不足している。

### 正確性・数値計算

- visibility の基盤は整理されているが、pick 周りの座標系契約がまだ曖昧である。
- 画面系と 3D 系の境界は、今後も重点的な検証対象にすべきである。

### テスト・検証

- 現状は examples による目視確認へ寄りすぎている。
- 点群ライブラリとして重要な loading、LOD、pick、dispose、error handling の自動テストが必要である。

### パッケージ・ビルド・配布

- `three` を `peerDependencies` に置いている点は妥当である。
- `exports` も最低限整理されているが、examples が公開面だけで成立していないため、配布品質の確認としては不十分である。

### ドキュメント・利用者体験

- README は概念説明と最小例を持っているが、dispose、pick 座標、EDL、制限事項、Potree データ構成の前提をもう少し明示した方がよい。
- 署名 URL 3 本や OPFS のような今後の設計方向は、別文書との整合を保ちながら段階的に公開すべきである。

## すぐ修正すべき問題

1. pick API の座標系契約を明文化し、必要なら canvas 座標受け API を追加する。
2. metadata / hierarchy / octree の fetch で HTTP 成功判定と range 応答検証を追加する。
3. `metadata.json` 文字列置換依存から脱却する API 方針を確定する。

## 次のマイナーリリースまでに改善すべき問題

1. pick 中の renderer state を完全に保存・復元する。
2. examples を公開 package surface のみで動くように修正する。
3. `RequestManager` と local source の責務境界を整理する。
4. ロード失敗時のエラー型と再試行方針を明確にする。
5. 共有 picker など補助リソースの寿命管理を整理する。

## 将来的な設計改善案

1. Potree データセット単位の source abstraction を導入し、HTTP、署名 URL、File、OPFS を同じ責務境界で扱う。
2. `Potree` は load と visibility policy に集中させ、viewer 寄りの debug 機能は別モジュール化する。
3. pick API を ray ベースだけでなく canvas pixel ベースでも提供し、利用者が誤用しにくい形にする。
4. dispose 契約を worker、GPU、cache、scene object を含めて明文化する。

## 追加すべきテスト

1. Brotli / Zstd の両 encoding での読込テスト。
2. worker 命名整理後の decode 経路と dispose 経路を守る回帰テスト。
3. 3 本の URL が個別に解決されるケースを想定した resource resolution テスト。
4. 403、404、期限切れ、range 非対応、壊れた `Content-Range` のエラーテスト。
5. pick の正確性を DPR 1 / 2、Perspective / Orthographic で検証するテスト。
6. dispose 後に worker、geometry、material、pick render target が解放されることのテスト。
7. 公開 exports のみで最小 example が build できる smoke test。

## README または examples に追加すべき内容

1. Three.js 既存アプリへの最小統合例。
2. 初期化、load、update、render、dispose を通した完全サンプル。
3. pointer 座標から pick する正しい例。
4. `PotreeRenderer` と EDL の使い方。
5. `LocalPotreeRequestManager` の制約と、現状の dataset 前提。
6. 対応 Potree 形式、range request 必須条件、CORS や署名 URL 運用時の注意。

## 参照した主な箇所

- `packages/core/src/index.ts`
- `packages/core/src/potree.ts`
- `packages/core/src/point-cloud-octree.ts`
- `packages/core/src/loading/OctreeLoader.ts`
- `packages/core/src/loading/load-octree-hierarchy.ts`
- `packages/core/src/loading/octree-range-cache.ts`
- `packages/core/src/loading/WorkerPool.ts`
- `packages/core/src/loading/decode-octree-node.ts`
- `packages/core/src/core/point-cloud-visibility-scheduler.ts`
- `packages/core/src/core/visibility/update-visibility.ts`
- `packages/core/src/renderer-three/picking/point-cloud-octree-picker.ts`
- `packages/core/src/renderer-three/picking/pick-render-target.ts`
- `packages/core/src/rendering/potree-renderer.ts`
- `packages/core/package.json`
- `packages/core/README.md`
- `apps/playground/src/main.ts`