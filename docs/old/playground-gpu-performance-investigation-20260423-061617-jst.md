# Playground GPU 性能調査メモ

- 調査日時: 2026-04-23 06:16:17 JST
- 対象: `apps/playground`
- 主な環境: RTX 3060 搭載マシン
- 視点: `Camera pos: 9.0, 1.5, 4.4`
- Canvas: `1469 x 911`
- Pixel ratio: `1.00`
- EDL: disabled

## 結論

今回のボトルネックは、処理実装上の局所的な無駄ではなく、表示点数そのものが支配的である。

GPU 時間は表示点数にほぼ比例しており、`Size Type` を `Adaptive` から `Fixed` に変更しても有意な改善はなかった。`minPointSize` を `2.0` から `1.0` に下げると少し改善したが、主因を変えるほどではなかった。

したがって、同じ描画方式のまま FPS を大きく改善するには、実装最適化よりも `pointBudget`、LOD、点サイズ、描画解像度などの表示ポリシーを調整する必要がある。

## 実測結果

### Point budget 比較

| Point budget | Three.js points | Draw calls | GPU time avg | CPU render submit avg | FPS avg |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 30MP 相当 | 28,873,627 | 2,021 | 33.56 ms | 9.15 ms | 29.5 |
| 20MP | 19,996,269 | 1,188 | 22.77 ms | 4.95 ms | 43.6 |
| 10MP | 9,982,254 | 446 | 11.69 ms | 2.16 ms | 60.1 |

GPU 時間は点数比に近く低下した。

- 30MP 相当から 20MP: 点数は約 69%、GPU 時間は約 68%
- 20MP から 10MP: 点数は約 50%、GPU 時間は約 51%
- 30MP 相当から 10MP: 点数は約 35%、GPU 時間は約 35%

この結果から、GPU 側は表示点数スループットにほぼ支配されていると判断できる。

### Size Type 比較

ロード完了後、同じ表示点数・同じ draw call 数で比較した。

| Size Type | Three.js points | Draw calls | GPU time avg | CPU render submit avg |
| --- | ---: | ---: | ---: | ---: |
| Adaptive | 28,873,627 | 2,021 | 33.68 ms | 9.34 ms |
| Fixed | 28,873,627 | 2,021 | 33.89 ms | 10.26 ms |

差は `0.21 ms` 程度で、`Adaptive` の LOD 計算は今回の主因ではなかった。

### Min point size 比較

同じ表示点数・同じ `Size Type: Adaptive` で比較した。

| Min point size | Three.js points | Draw calls | GPU time avg | FPS avg |
| ---: | ---: | ---: | ---: | ---: |
| 2.00 | 28,873,627 | 2,021 | 33.68 ms | 29.5 |
| 1.00 | 28,873,627 | 2,021 | 32.08 ms | 31.0 |

`minPointSize` を下げると約 `1.60 ms` 改善した。overdraw / fragment 負荷は一部あるが、主因ではない。

## 実装上の確認点

EDL 無効時、playground の GPU 計測区間は主に `renderer.render(scene, camera)` である。

```ts
if (!params.edlEnabled) {
  renderer.render(scene, camera);
} else {
  potreeRenderer.render({ renderer, scene, camera, pointClouds });
}
```

点群は可視 octree node ごとに `THREE.Points` として生成されるため、visible nodes 数が draw calls に強く反映される。

```ts
const points = new Points(geometryNode.geometry, this.material);
```

今回の計測では、draw calls も CPU render submit に効いていた。

- 30MP 相当: `2,021 calls`, `CPU render submit avg 9.15 ms`
- 10MP: `446 calls`, `CPU render submit avg 2.16 ms`

ただし、FPS を支配していたのは CPU submit より GPU time である。

## 判断

今回の範囲では、FPS 改善の本命は以下である。

- `pointBudget` を下げる
- 画面上で過密な点を間引く
- `minPointSize` を下げる
- `minNodePixelSize` を上げて visible nodes / draw calls を減らす
- target FPS に応じて point budget を動的調整する
- 統合 GPU 向けに低い初期プリセットを用意する

RTX 3060 でもこの視点では 10MP 付近が 60fps の目安だった。統合 GPU では、初期値として 2MP から 5MP 程度を想定した方が安全である。

## WebGPU 化について

今回の結果から見ると、WebGL から WebGPU へ描画 API を置き換えるだけでは根本的な改善は期待しにくい。

理由は、GPU 時間が表示点数にほぼ比例しているためである。同じ点数を同じように点スプライトとして描く限り、WebGPU でも同じ GPU 上で同程度の頂点処理、ラスタライズ、メモリ読み出しが発生する。

WebGPU で勝機があるとすれば、compute shader を使って描画前に点を減らす設計である。

有望な方向:

- screen-space binning により、ピクセルまたはタイルごとに代表点だけを残す
- hierarchical / tile-based culling により、画面上で十分密な領域の細かい点を捨てる
- compute shader で LOD selection を行い、カメラ距離や投影サイズから描画対象を決める
- depth-aware decimation により、既に手前に点がある領域では奥の点を捨てる
- compute 結果を indirect draw へ渡し、残した点だけを描画する

一方で、以下は今回の主因に対しては効果が限定的と考えられる。

- WebGL の render path を WebGPU render pass に移植するだけ
- draw call / state change の削減だけ
- shader の小さな軽量化だけ
- CPU 側 visibility traversal の最適化だけ

これらは CPU render submit や update 時間には効く可能性があるが、今回の支配要因である `GPU time ~= visible points` には負けやすい。

したがって WebGPU 版を検討する場合は、WebGL 版の単純移植ではなく、最初から screen-space point budget renderer として設計するのがよい。

目標も単純な `pointBudget` ではなく、以下のような画面空間ベースの制御に寄せるべきである。

- pixel / tile あたり最大点数
- target GPU ms
- target FPS
- camera movement 中と静止時で異なる点数予算
- GPU 種別や実測 GPU time に応じた動的 point budget

## 推奨プリセット案

| 用途 | Point budget | Min point size | Min node pixel size | EDL |
| --- | ---: | ---: | ---: | --- |
| 高画質 / 30fps 目安 | 30MP | 2.0 | 50 | disabled |
| 標準 / 45fps 目安 | 20MP | 2.0 | 50-100 | disabled |
| 高 FPS / 60fps 目安 | 10MP | 1.0-2.0 | 100 | disabled |
| 統合 GPU 初期値 | 2MP-5MP | 1.0-1.5 | 100-150 | disabled |

## 補足

`Size Type: Fixed` でも `Point size: 0.10` が `Min point size: 2.00` に clamp されるため、多くの点は最終的に 2px 以上で描画される。

そのため、`Size Type` だけでは比較条件として不十分であり、playground のパフォーマンスパネルには以下を追加した。

- `Size Type`
- `Point size`
- `Min point size`
- `Max point size`
