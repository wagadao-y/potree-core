# packages/core 性能分析メモ

## 対象範囲

- WebGL / Three.js 描画パイプライン
- ポイントクラウドの読み込み、LOD 制御、オクツリー走査
- GPU / CPU 負荷、メモリ使用量、GC
- Web Worker / 非同期処理
- データ転送 / ストリーミング
- クリッピング処理

## 前提

- 本資料は静的コード分析です。
- 計測値ではなく、実装上の支配コストと発生頻度から優先度を付けています。
- 主な確認対象:
  - `packages/core/src/potree.ts`
  - `packages/core/src/materials/point-cloud-material.ts`
  - `packages/core/src/loading/OctreeLoader.ts`
  - `packages/core/src/loading/decoder.worker.js`
  - `packages/core/src/rendering/edl-pass.ts`
  - `apps/playground/src/main.ts`

## 実施済み改善

- 2026-04-24 / commit `5686e5e 可視判定と可視ノード更新の負荷を削減`
  - `packages/core/src/potree.ts`
    - 可視判定 hot loop 内の `renderer.getSize()` / `getPixelRatio()` を loop 外へ移動。
    - `shouldClip()` の node ごとの `Box3.clone()` / `new Box3()` / `new Vector3()` を撤去し、scratch / cache を再利用。
    - `hideDescendants(pointCloud)` による subtree walk をやめ、前フレームの `visibleNodes` だけを非表示化。
  - `packages/core/src/materials/point-cloud-material.ts`
    - 可視ノードテクスチャ更新の `Uint8Array` / child offset 配列を再利用。
    - `onBeforeRender` の `visibleNodes.indexOf(node)` と `visibleNodeTextureOffsets.get(node.name)` を撤去。
  - 最終確認値:
    - `CPU work avg`: 16.12 ms -> 14.48 ms
    - `LOD / Visibility Update avg`: 4.94 ms -> 4.40 ms
    - `CPU render submit avg`: 10.99 ms -> 9.90 ms
  - 備考:
    - `visibleNodes.sort(byLevelAndIndex)` の撤去と `onBeforeRender` の uniform 条件分岐削減は計測上悪化したため未採用。

## 現在の実測上の支配要因

- 2026-04-24 時点の最終確認では、CPU 側の改善後も GPU が frame time を支配している。
  - `CPU work avg`: 14.48 ms
  - `GPU time avg`: 39.30 ms
  - `Submitted points est`: 33,040,439
  - `Draw calls`: 2,244
- そのため、以降の FPS 改善は CPU hot loop よりも、GPU に送る点数、draw call 数、adaptive shader の per-vertex 負荷を下げる施策を優先する。
- ロード系の `OctreeLoader` / worker payload 改善は、初回表示、ロード中の heap peak、ネットワーク効率には有効だが、ロード完了後の steady-state FPS 改善としては次点にする。

## 主要ボトルネック

- 問題: 可視判定ホットループ内で、ノードごとにレンダラー状態取得とクリップ用オブジェクト生成を繰り返している
  - 対象ファイル / 関数: `packages/core/src/potree.ts` / `updateVisibility`, `shouldClip`
  - 該当コード:

    ```ts
    if (
      node.level > maxLevel ||
      !frustums[pointCloudIndex].intersectsBox(node.boundingBox) ||
      this.shouldClip(pointCloud, node.boundingBox)
    ) {
      continue;
    }

    const halfHeight =
      0.5 *
      renderer.getSize(this._rendererSize).height *
      renderer.getPixelRatio();
    ```

    ```ts
    const box2 = boundingBox.clone();
    pointCloud.updateMatrixWorld(true);
    box2.applyMatrix4(pointCloud.matrixWorld);

    const clipBoxWorld = new Box3(
      new Vector3(-0.5, -0.5, -0.5),
      new Vector3(0.5, 0.5, 0.5),
    ).applyMatrix4(clipMatrixWorld);
    ```
  - なぜ遅いか:
    - 優先度キュー走査の最内周で `renderer.getSize`, `getPixelRatio`, `Box3.clone`, `new Box3`, `new Vector3` が候補ノード数ぶん走る。
    - クリップボックス数が増えると `shouldClip` が `候補ノード数 x clipBoxes.length` で増え、CPU 時間と GC の両方を押し上げる。
  - 改善案:
    - [実施済み] `halfHeight` は `while` ループの外で 1 回だけ算出する。
    - [実施済み] `pointCloud.updateMatrixWorld(true)` も point cloud ごとに 1 回に寄せる。
    - [実施済み] `clipBoxes` はフレーム開始時に world `Box3[]` としてキャッシュし、`shouldClip` は scratch `Box3` 1 個で `intersectsBox` のみ行う。
    - `shouldClip` に plane / sphere の粗判定も追加し、GPU に送る前に弾く。
  - 実施状況:
    - 2026-04-24 実施済み。`renderer.getSize()` / `getPixelRatio()` を hot loop 外へ移動し、`shouldClip` の `Box3.clone()` / `new Box3()` / `new Vector3()` を撤去した。
    - commit: `5686e5e 可視判定と可視ノード更新の負荷を削減`
  - 優先度: 高
  - 検証指標:
    - `updateVisibility` の CPU 時間
    - 1 フレームあたりの JS allocation 量
    - GC pause
    - FPS

- 問題: 毎フレーム、前回可視だった subtree 全体を非表示化している
  - 対象ファイル / 関数: `packages/core/src/potree.ts` / `updateVisibilityStructures`, `packages/core/src/point-cloud-octree.ts` / `hideDescendants`
  - 該当コード:

    ```ts
    pointCloud.hideDescendants(pointCloud);
    ```

    ```ts
    public hideDescendants(object: Object3D): void {
      const toHide: Object3D[] = [];
      addVisibleChildren(object);

      while (toHide.length > 0) {
        const objToHide = toHide.shift()!;
        objToHide.visible = false;
        addVisibleChildren(objToHide);
      }
    }
    ```
  - なぜ遅いか:
    - 表示ノードが多いほど毎フレーム `Object3D` を広く走査する。
    - `shift()` は配列の先頭削除なのでキュー実装として不利。
    - LOD 更新とは独立に、可視状態リセットだけで O(N) の CPU コストが乗る。
  - 改善案:
    - [実施済み] 前フレームの `pointCloud.visibleNodes` のみを走査して `sceneNode.visible = false` にする。
    - `hideDescendants` は削除するか、必要なら `pop()` ベースに変える。
    - `frameStamp` をノードに持たせ、今フレームで触れたノードだけ true にする差分更新へ変更する。
  - 実施状況:
    - 2026-04-24 実施済み。`updateVisibilityStructures()` で `hideDescendants(pointCloud)` を呼ばず、前フレームの `visibleNodes` だけを非表示化する `hideVisibleNodes()` へ変更した。
    - `visibleNodes` / `visibleGeometry` は毎フレーム新規配列を作らず、`length = 0` で再利用する。
    - commit: `5686e5e 可視判定と可視ノード更新の負荷を削減`
  - 優先度: 高
  - 検証指標:
    - `updateVisibilityStructures` の CPU 時間
    - visible nodes 数
    - `Object3D.visible` 書き換え回数
    - FPS

- 問題: 可視ノードテクスチャを毎フレーム全再構築し、描画ごとに線形探索している
  - 対象ファイル / 関数: `packages/core/src/materials/point-cloud-material.ts` / `updateMaterial`, `updateVisibilityTextureData`, `makeOnBeforeRender`
  - 該当コード:

    ```ts
    if (
      this.pointSizeType === PointSizeType.ADAPTIVE ||
      this.pointColorType === PointColorType.LOD
    ) {
      this.updateVisibilityTextureData(visibleNodes);
    }
    ```

    ```ts
    nodes.sort(byLevelAndIndex);

    const data = new Uint8Array(nodes.length * 4);
    const offsetsToChild = new Array(nodes.length).fill(Infinity);
    ```

    ```ts
    materialUniforms.pcIndex.value =
      pcIndex !== undefined ? pcIndex : octree.visibleNodes.indexOf(node);

    (material as RawShaderMaterial).uniformsNeedUpdate = true;
    ```
  - なぜ遅いか:
    - 毎フレーム `sort` と新規 `Uint8Array` / `Array` を生成している。
    - `visibleNodes.indexOf(node)` は draw call ごとに線形探索なので、可視ノード数が増えると CPU コストが急増する。
    - `uniformsNeedUpdate` を draw call ごとに立てるため、Three.js 側の uniform 更新コストも増える。
  - 改善案:
    - [実施済み] `updateTreeNodeVisibility` 時に `node.pcIndex` を確定させ、`indexOf` を撤去する。
    - [実施済み] `vnStart` も node 側へ保持し、`Map` 参照を減らす。
    - [一部実施済み] `visibleNodesTexture` 用のバッファを再利用し、毎フレームの `Uint8Array` / child offset 配列 allocation を避ける。
    - `visibleNodes` のソート済み配列を LOD 更新側で保持し、マテリアル側の再ソートを避ける。
  - 実施状況:
    - 2026-04-24 実施済み。DataTexture の既存 `image.data` へ直接書き込み、child offset 用 `Uint32Array` を再利用するよう変更した。
    - `PointCloudOctreeNode` に `visibleNodeTextureOffset` と `parent` を追加し、`onBeforeRender` の `visibleNodeTextureOffsets.get(node.name)` と `octree.visibleNodes.indexOf(node)` を撤去した。
    - `visibleNodes.sort(byLevelAndIndex)` の撤去は試したが、計測で悪化したため未採用。
    - commit: `5686e5e 可視判定と可視ノード更新の負荷を削減`
  - 優先度: 高
  - 検証指標:
    - `updateMaterial` の CPU 時間
    - draw call 数
    - `onBeforeRender` の総時間
    - JS heap 増分
    - FPS

- 問題: octree.bin の Range 取得は結合済みだが、結合後の node 切り出しで `ArrayBuffer.slice()` コピーが発生し、結合条件も厳しすぎる
  - 対象ファイル / 関数: `packages/core/src/loading/OctreeLoader.ts` / `loadBatchWithCandidates`, `loadMergedOctreeRange`, `sliceCachedOctreeBuffer`
  - 該当コード:

    ```ts
    const fetchedBuffer = await this.fetchOctreeRange(
      urlOctree,
      range.start,
      range.endExclusive,
    );

    const buffer = sliceCachedOctreeBuffer(
      fetchedBuffer,
      range.start,
      pendingNode.byteOffset,
      pendingNode.endExclusive,
    );
    ```

    ```ts
    const MAX_MERGED_OCTREE_RANGE_GAP_BYTES = BigInt(0);

    function sliceCachedOctreeBuffer(
      buffer: ArrayBuffer,
      cacheStart: bigint,
      start: bigint,
      endExclusive: bigint,
    ) {
      const sliceStart = Number(start - cacheStart);
      const sliceEnd = Number(endExclusive - cacheStart);
      return buffer.slice(sliceStart, sliceEnd);
    }
    ```
  - なぜ遅いか:
    - 現行実装は `createMergedOctreeRanges()` で連続ノードの Range 結合まではできているが、各 node を worker に渡す前に `buffer.slice()` で再コピーしている。
    - まとめて取得した大きな `ArrayBuffer` を node 数ぶん複製する形になり、ネットワークより後段のメモリ帯域と GC が律速になりやすい。
    - `MAX_MERGED_OCTREE_RANGE_GAP_BYTES = 0` のため、近接しているが完全連続ではない node を束ねられず、結合効率が頭打ちになる。
    - 同時ロード制御が `maxNumNodesLoading` のみなので、巨大ノードが混ざると bytes in flight を抑えにくい。
  - 改善案:
    - node 切り出しを `Uint8Array.subarray()` やオフセット付きビュー化に寄せ、不要な `ArrayBuffer.slice()` を避ける。
    - worker 側を `buffer + start/end` 受け取りに拡張し、共有バッファ上の範囲だけ decode できるようにする。
    - `MAX_MERGED_OCTREE_RANGE_GAP_BYTES` に小さな許容量を持たせ、近接 Range をまとめる。
    - `maxNumNodesLoading` に加えて `maxBytesInFlight` を導入し、帯域とメモリ量の両方でバックプレッシャーを掛ける。
  - 優先度: 高
  - 検証指標:
    - 初回表示までの時間
    - 全ロード時間
    - 1 秒あたり request 数
    - 平均 bytes/request
    - `octree-slice-read` 後の JS heap 増分

- 問題: worker から main thread への返送データが大きく、不要なバッファ返却も含んでいる
  - 対象ファイル / 関数: `packages/core/src/loading/OctreeLoader.ts` / `NodeLoader.load`, `packages/core/src/loading/decoder.worker.js`, `packages/core/src/loading/brotli-decoder.worker.js`
  - 該当コード:

    ```ts
    const message = {
      name: node.name,
      buffer: buffer,
      pointAttributes: pointAttributes,
      scale: scale,
      min: min,
      max: max,
      size: size,
      offset: offset,
      numPoints: numPoints,
    };

    worker.postMessage(message, [message.buffer]);
    ```

    ```ts
    const message = {
      buffer: buffer,
      attributeBuffers: attributeBuffers,
      density: occupancy,
    };

    const transferables = [];
    for (const property in message.attributeBuffers) {
      transferables.push(message.attributeBuffers[property].buffer);
    }
    transferables.push(buffer);

    postMessage(message, transferables);
    ```
  - なぜ遅いか:
    - main thread は worker から戻った `message.buffer` を使っていない。
    - 通常 decoder worker は属性バッファに加えて元バッファまで transfer しており、転送量と一時メモリ量が増えている。
    - Brotli worker は元バッファ transfer を避けている一方で、両 worker とも未使用属性を含む全属性 decode を続けている。
    - 属性ごとに `ArrayBuffer` を個別生成するため、デコード直後のヒープピークが高い。
  - 改善案:
    - worker から返す payload から `buffer` を削除する。
    - main thread から `requiredAttributes` を渡し、material で未使用の属性は decode しない。
    - 可能なら属性群を一つの大きい共有バッファにパックし、属性ビューだけを返す。
  - 優先度: 高
  - 検証指標:
    - worker 1 回あたりの transfer bytes
    - decode ms/node
    - worker busy time
    - JS heap peak
    - GC pause

- 問題: EDL は描画パスを増やし、point cloud subtree の layer 再同期も毎フレーム走る
  - 対象ファイル / 関数: `packages/core/src/rendering/edl-pass.ts` / `render`, `packages/core/src/rendering/potree-renderer.ts` / `applyEDLState`
  - 該当コード:

    ```ts
    camera.layers.mask = oldLayerMask & ~(1 << pointCloudLayer);
    renderer.render(scene, camera);

    renderer.setRenderTarget(this.rtEDL);
    renderer.clear(true, true, true);
    camera.layers.mask = 1 << pointCloudLayer;
    renderer.render(scene, camera);
    ```

    ```ts
    this.setLayerMaskRecursive(pco, desiredMask);
    ```
  - なぜ遅いか:
    - EDL 有効時は少なくとも 2 回の scene render と 1 回のフルスクリーン合成が必要になり、GPU frame time が伸びやすい。
    - `setLayerMaskRecursive` が point cloud subtree 全体に対して毎フレーム実行され、CPU でもコストが発生する。
  - 改善案:
    - `PointCloudOctree.toTreeNode` で生成した `Points` に layer mask を設定し、フレームごとの subtree 再帰をなくす。
    - EDL 用の layer0 render を dirty flag 付きにして、背景が変わらない間は再利用可能にする。
    - 高 DPI 環境では EDL render target の解像度を段階的に落とせる設定を追加する。
  - 優先度: 中
  - 検証指標:
    - GPU frame time
    - draw call 数
    - render target 切り替え回数
    - EDL 有無の FPS 差分

## 今回のレビューで確認した補足

- `packages/core/src/loading/OctreeLoader.ts` の IO は、以前のメモにあった「node 単位で細かい HTTP Range request に分断」は現状そのままではない。
  - `loadBatchWithCandidates()` と `createMergedOctreeRanges()` により、連続した octree.bin 範囲は結合取得される。
  - 今の主課題は request 数そのものより、結合後のコピー回数、gap 許容量、bytes in flight 制御不足に移っている。
- `packages/core/src/materials/point-cloud-material.ts` の `visibleNodes.indexOf(node)` は現行コードでも残っており、draw call 数に比例して CPU コストが増える。
- `packages/core/src/potree.ts` の `renderer.getSize(...).height * renderer.getPixelRatio()` は可視ノード探索ループ内に残っており、フレーム不変計算の外出し余地がある。
- `packages/core/src/potree.ts` の `shouldClip()` は `pointCloud.updateMatrixWorld(true)` と `Box3` / `Vector3` 生成を候補 node ごとに行っており、clip box 利用時の支配コストになりやすい。

- 問題: LRU の解放閾値が大きく、破棄が一括でメモリスパイクを起こしやすい
  - 対象ファイル / 関数: `packages/core/src/utils/lru.ts` / `freeMemory`, `disposeSubtree`
  - 該当コード:

    ```ts
    while (this.numPoints > this.pointBudget * 2) {
      const node = this.getLRUItem();
      if (node) {
        this.disposeSubtree(node);
      }
    }
    ```
  - なぜ遅いか:
    - 予算の 2 倍まで保持してからまとめて解放するため、JS heap と GPU バッファが一時的に膨らみやすい。
    - 解放処理がフレーム境界で集中し、フレームスパイクを起こしやすい。
  - 改善案:
    - 閾値を `1.1` から `1.25` 倍程度のヒステリシスに縮める。
    - 1 フレームで解放する点数上限を設け、段階的に破棄する。
    - `disposeSubtree` の収集配列で root を重複追加しないよう整理する。
  - 優先度: 中
  - 検証指標:
    - JS heap peak
    - GPU memory
    - eviction 発生時の frame time spike
    - GC pause

## クリッピング処理の追加調査

### 使用箇所

- `apps/playground/src/main.ts` では以下の 3 系統を使用している
  - `material.clippingPlanes`
  - `material.setClipBoxes(...)`
  - `material.setClipSpheres(...)`

### クリッピング固有の重い箇所

- 問題: clip plane uniform を毎フレーム新規 `Float32Array` で作り直している
  - 対象ファイル / 関数: `packages/core/src/materials/point-cloud-material.ts` / `syncClippingPlanes`
  - 該当コード:

    ```ts
    if (count > 0 && planes) {
      const arr = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        arr[i * 4 + 0] = planes[i].normal.x;
        arr[i * 4 + 1] = planes[i].normal.y;
        arr[i * 4 + 2] = planes[i].normal.z;
        arr[i * 4 + 3] = planes[i].constant;
      }
      this.setUniform("clipPlanes", arr);
    }
    ```
  - なぜ遅いか:
    - plane が変化していなくてもフレームごとに配列を作る。
    - 大規模点群では可視ノード更新と同時にこの allocation が継続し、GC の一因になる。
  - 改善案:
    - `clipPlanesArray` を material 内に保持して再利用する。
    - `Plane.normal` と `constant` の前回値を持ち、変化時のみ uniform を書き換える。
  - 優先度: 高
  - 検証指標:
    - `updateMaterial` の CPU 時間
    - JS allocation / frame
    - clipping 操作中の FPS

- 問題: clip box / sphere 更新のたびに uniform 配列を再生成している
  - 対象ファイル / 関数: `packages/core/src/materials/point-cloud-material.ts` / `setClipBoxes`, `setClipSpheres`
  - 該当コード:

    ```ts
    const clipBoxesArray = new Float32Array(clipBoxesLength);
    for (let i = 0; i < this.numClipBoxes; i++) {
      clipBoxesArray.set(clipBoxes[i].inverse.elements, 16 * i);
    }
    ```

    ```ts
    const clipSpheresArray = new Float32Array(clipSpheresLength);
    for (let i = 0; i < this.numClipSpheres; i++) {
      clipSpheresArray[i * 4 + 0] = clipSpheres[i].center.x;
      clipSpheresArray[i * 4 + 1] = clipSpheres[i].center.y;
      clipSpheresArray[i * 4 + 2] = clipSpheres[i].center.z;
      clipSpheresArray[i * 4 + 3] = clipSpheres[i].radius;
    }
    ```
  - なぜ遅いか:
    - ギズモ操作や UI スライダ操作で `setClipBoxes` / `setClipSpheres` を連続呼び出しすると、入力イベント頻度で毎回配列確保が起こる。
  - 改善案:
    - material に `clipBoxesArray` / `clipSpheresArray` を保持し、要素数が同じ間は中身だけ更新する。
    - clip volume 操作を `requestAnimationFrame` 単位に集約し、1 フレーム 1 回だけ uniform 更新する。
  - 優先度: 中
  - 検証指標:
    - clip 操作中の FPS
    - JS allocation / frame
    - input latency

- 問題: CPU 側の粗判定が clip box の `CLIP_OUTSIDE` にしか効かず、plane / sphere で完全に切れるノードも GPU へ流れる
  - 対象ファイル / 関数: `packages/core/src/potree.ts` / `shouldClip`
  - 該当コード:

    ```ts
    if (
      material.numClipBoxes === 0 ||
      material.clipMode !== ClipMode.CLIP_OUTSIDE
    ) {
      return false;
    }
    ```
  - なぜ遅いか:
    - clip plane や clip sphere ではノード単位の早期除外が働かず、完全に切り落とせるノードも draw call に残る。
    - その結果、GPU は不要なポイントに対して clip 判定を per-point / per-fragment で実行する。
  - 改善案:
    - node の `boundingSphere` または `boundingBox` を使い、clip plane に対しては signed distance、clip sphere に対しては中心距離で粗判定する。
    - `CLIP_INSIDE`, `CLIP_OUTSIDE`, `HIGHLIGHT_INSIDE` ごとに、完全包含 / 完全排除 / 部分交差を返す enum ベース判定へ拡張する。
    - 部分交差ノードのみ GPU へ送る。
  - 優先度: 高
  - 検証指標:
    - クリップ有効時の visible nodes 数
    - draw call 数
    - GPU frame time
    - クリッピング操作中の FPS

- 問題: playground の plane 更新が変更イベントごとに `Plane[]` を作り直している
  - 対象ファイル / 関数: `apps/playground/src/main.ts` / `updateClipPlanes`
  - 該当コード:

    ```ts
    function updateClipPlanes() {
      if (!clipPlanesTarget) return;
      const planes: Plane[] = [];
      if (clipPlaneState.enableX) planes.push(clipPlaneX);
      if (clipPlaneState.enableY) planes.push(clipPlaneY);
      if (clipPlaneState.enableZ) planes.push(clipPlaneZ);
      clipPlanesTarget.material.clippingPlanes =
        planes.length > 0 ? planes : null;
    }
    ```
  - なぜ遅いか:
    - UI イベント頻度で新しい配列を material に渡すため、drag 中に不要な更新が多い。
    - core 側でも `syncClippingPlanes` が走るので、更新コストが積み上がる。
  - 改善案:
    - 固定長 3 要素の plane 配列を持ち、enabled 状態だけを bitmask 化して core へ伝える。
    - 変更通知を `requestAnimationFrame` で間引きし、drag 中の更新をフレーム単位に揃える。
  - 優先度: 中
  - 検証指標:
    - clip 操作時の input latency
    - material 更新回数 / 秒
    - JS allocation / 秒

- 問題: クリップで捨てられる点も `pointBudget` を消費しており、小さいクリップ領域で LOD 品質が上がりにくい
  - 対象ファイル / 関数: `packages/core/src/potree.ts` / `updateVisibility`
  - 該当コード:

    ```ts
    if (numVisiblePoints + node.numPoints > this.pointBudget) {
      break;
    }
    ```
  - なぜ遅いか:
    - GPU 側で最終的に捨てられる点も CPU の LOD 選定時点では全量として budget を消費する。
    - 小さい clip box / sphere / plane 範囲だけを見ている場合、描画されない点に budget を奪われ、必要な範囲の詳細ノードへ到達しにくい。
  - 改善案:
    - node と clip volume の関係から `visiblePointEstimate` を概算し、budget 判定と priority weight に使う。
    - `Outside` は 0、`Inside` は `node.numPoints`、`Intersecting` は bounding volume の体積比や距離比から保守的に見積もる。
    - まずは `CLIP_OUTSIDE` の box / sphere / plane に限定し、見積もりが不安定な場合は従来通り `node.numPoints` にフォールバックする。
  - 優先度: 高
  - 検証指標:
    - clip 有効時の visible nodes 数
    - clip 領域内の実効点密度
    - 同一 `pointBudget` での見た目の LOD
    - `updateVisibility` の CPU 時間

- 問題: clip volume が変化していないフレームでも、候補 node ごとに同じ粗判定を繰り返す
  - 対象ファイル / 関数: `packages/core/src/potree.ts` / `shouldClip`
  - なぜ遅いか:
    - カメラ移動だけのフレームでは clip volume と node の幾何関係は変わらないが、visibility traversal のたびに再計算される。
    - plane / sphere の粗判定を追加すると、判定の種類が増えるぶんホットループの CPU コストが増えやすい。
  - 改善案:
    - material 側に `clipVersion` を持ち、clip volume / clip mode が変わった時だけインクリメントする。
    - node 側に `lastClipVersion` と `clipRelation` (`Outside` / `Inside` / `Intersecting`) を保持する。
    - `clipVersion` が一致する場合は cached relation を使い、粗判定を省略する。
  - 優先度: 高
  - 検証指標:
    - `shouldClip` 呼び出し回数
    - clip relation cache hit rate
    - カメラ移動のみの `updateVisibility` CPU 時間

- 問題: CPU 粗判定を高精度にしすぎると、visibility traversal の最内周が重くなる
  - 対象ファイル / 関数: `packages/core/src/potree.ts` / `shouldClip`
  - なぜ遅いか:
    - node ごとに OBB corner 判定や複数 volume 判定を常に行うと、GPU に送る点数は減っても CPU 側の traversal が律速になり得る。
    - plane が点群中央を横切るケースでは、境界 node が多く、精密判定しても枝刈り量が少ない場合がある。
  - 改善案:
    - 2 段階判定にする。
      1. `boundingSphere` で cheap reject / accept を行う。
      2. 曖昧な node だけ `boundingBox` corners や OBB 判定へ進む。
    - clip volume 数が多い場合は、最も reject 率が高い volume から先に評価する。
    - `HIGHLIGHT_INSIDE` は全点描画が必要なので CPU 枝刈り対象から外す。
  - 優先度: 中
  - 検証指標:
    - `shouldClip` の平均処理時間
    - 粗判定による reject / accept / intersecting 比率
    - visible nodes 数
    - GPU frame time

- 問題: clip volume に完全内包される node でも、GPU では点ごとの clip 判定を続ける
  - 対象ファイル / 関数: `packages/core/src/materials/shaders/pointcloud.vs`, `packages/core/src/materials/point-cloud-material.ts` / `makeOnBeforeRender`
  - なぜ遅いか:
    - CPU 側で node が完全に clip 内部と分かっていても、共有 material の shader は全 node で同じ clip 判定を実行する。
    - 境界 node が少なく内部 node が多いクリップ条件では、不要な per-point 判定が残る。
  - 改善案:
    - node ごとの `clipRelation` を `onBeforeRender` で uniform として渡し、`Inside` node では shader 内の clip 判定をスキップする。
    - もしくは clipped/interior 用 material variant を分け、内部 node は clip define なしの shader で描画する。
    - material variant は shader 切り替えと draw order への影響があるため、まずは uniform branch で検証する。
  - 優先度: 中
  - 検証指標:
    - GPU vertex shader time
    - `Inside` / `Intersecting` node 数
    - shader program 切り替え回数
    - FPS

- 問題: shader の clip 判定が汎用ループで、少数 clip volume の一般的なケースに最適化されていない
  - 対象ファイル / 関数: `packages/core/src/materials/shaders/pointcloud.vs`
  - 該当コード:

    ```glsl
    for (int i = 0; i < max_clip_planes; i++) {
      if (i == int(clipPlaneCount)) break;
      ...
    }
    ```
  - なぜ遅いか:
    - 1 plane / 1 sphere / 1 box のようなよくあるケースでも、汎用ループと count 分岐を通る。
    - clip type が複数有効な場合、すべての点で box / sphere / plane 判定が合成される。
  - 改善案:
    - `CLIP_PLANE_COUNT_1`, `CLIP_SPHERE_COUNT_1`, `CLIP_BOX_COUNT_1` など、少数ケース用の define を追加する。
    - 1 個だけの clip volume はループなしの直書き path にする。
    - variant 増加を避けるため、まずは最頻出の 1 plane / 1 sphere / 1 box のみ対象にする。
  - 優先度: 低〜中
  - 検証指標:
    - GPU frame time
    - shader compile / switch 回数
    - clip volume 数別 FPS

- 問題: clip 操作中に LOD traversal と uniform 更新が同じ頻度で走り、入力追従性と描画安定性が悪化しやすい
  - 対象ファイル / 関数: `apps/playground/src/main.ts`, `packages/core/src/potree.ts` / `updatePointClouds`
  - なぜ遅いか:
    - スライダやギズモ操作中は clip volume が連続変化し、毎フレーム visibility traversal と material 更新が揺れ続ける。
    - 操作中は正確な LOD よりも低 latency なプレビューが重要な場合が多い。
  - 改善案:
    - clip 操作中は uniform 更新を優先し、LOD / visibility 更新は数フレーム間引く。
    - 操作終了時に full update を強制し、最終状態の LOD を確定する。
    - API として `beginClipInteraction()` / `endClipInteraction()` か、`updatePointClouds({ lodThrottle })` のような制御を検討する。
  - 優先度: 中
  - 検証指標:
    - clip 操作中 FPS
    - input latency
    - 操作終了後に高精度 LOD へ収束するまでの時間

## 優先順位

現在の優先順位は、2026-04-24 の実測で GPU time が約 39 ms と支配的だったことを前提にする。初回ロードやロード中の heap peak を改善する場合は、`OctreeLoader.ts` / worker payload 系を別枠で優先する。

1. submitted points を減らす LOD / density 制御
   - `screenSpaceDensityLODEnabled` / `maxPointsPerPixel` の実用設定を詰める。
   - adaptive point size 時に過密な child 展開を止め、`Submitted points est` と `GPU time` の低下を確認する。
2. draw call 数の削減
   - 現状 2,244 draw calls が `CPU render submit` と GPU command 処理の両方に効いている。
   - 遠距離 / 小サイズ node の統合描画、または leaf node の batch 化を検討する。
3. adaptive shader / visible nodes texture の GPU 負荷切り分け
   - `PointSizeType.FIXED` / `ATTENUATED` / `ADAPTIVE` を同一カメラで比較し、adaptive shader の vertex cost を測る。
   - GPU time が大きく落ちる場合は、adaptive path の texture lookup / LOD traversal 削減を優先する。
4. clip relation enum / cache と clip-aware point budget
   - clip 利用時に、完全外部 node を早期除外し、完全内部 node の shader clip 判定を避ける。
   - 小さい clip 領域でも budget を有効に使えるようにする。
5. clip plane / sphere の CPU 粗判定追加
   - box 以外の clip volume でも GPU へ送る不要点を減らす。
6. shader clip 判定の少数ケース特殊化
   - 1 plane / 1 sphere / 1 box の最頻出ケースを loop なし path にする。
7. EDL の layer 再同期撤去
   - EDL 有効時の追加 render pass / layer 操作コストを確認してから着手する。
8. `OctreeLoader.ts` の Range request バッチ化
   - steady-state FPS より、初回表示とロード中 heap peak 改善目的で実施する。
9. worker 転送 payload の削減
   - decode / transfer / heap peak 改善目的で実施する。
10. clip uniform 配列の再利用
    - clip 操作中の allocation / input latency 改善目的で実施する。
11. LRU の段階解放
    - heap / GPU memory のピーク抑制目的で実施する。
12. [実施済み] `potree.ts` の可視判定ホットループと `shouldClip` の allocation 削減
13. [実施済み] `hideDescendants` の差分更新化
14. [一部実施済み] `point-cloud-material.ts` の可視ノードテクスチャ再構築、`indexOf` 撤去

## 推奨計測項目

- 描画
  - FPS
  - GPU frame time
  - submitted points
  - draw call 数
  - visible nodes 数
  - `PointSizeType` 別 GPU frame time
- CPU
  - `updateVisibility` の実行時間
  - `updateMaterial` の実行時間
  - `onBeforeRender` の総時間
- メモリ
  - JS heap peak
  - GC pause
  - GPU memory
- ロード
  - 初回表示までの時間
  - 全ロード時間
  - request 数
  - average bytes/request
- クリッピング
  - clip 操作中 FPS
  - input latency
  - clip 有効時の visible nodes / draw call 減少量
  - clip relation cache hit rate
  - `Outside` / `Inside` / `Intersecting` node 数
  - clip 領域内の実効点密度
