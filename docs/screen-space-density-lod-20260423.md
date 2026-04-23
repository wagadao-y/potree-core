# Screen-Space Density LOD 検証メモ

- 作成日: 2026-04-23
- 対象: `packages/core` / `apps/playground`
- 視点: `Camera pos: 9.0, 1.5, 4.4`
- Pixel ratio: `1.00`
- EDL: disabled

## 背景

GPU時間は表示点数にほぼ比例しており、`Point Budget` を下げると負荷は下がるが、単純なbudget削減では画質も一律に下がる。

そこで、画面上で既に十分密な領域では子nodeの展開を止める `screen-space density LOD` を追加した。目的は、見た目への寄与が小さい過密な詳細点をCPU側LOD選択の段階で描画対象から外し、GPUへ投入する点数を減らすことである。

## 実装概要

`PointCloudOctree` に以下の設定を追加した。

```ts
screenSpaceDensityLODEnabled: boolean;
maxPointsPerPixel: number;
```

`Potree.updateChildVisibility()` で子nodeをpriority queueへ積む前に、子nodeの投影面積あたり点数を概算する。

```ts
projectedArea = Math.PI * screenPixelRadius * screenPixelRadius;
pointsPerPixel = child.numPoints / Math.max(projectedArea, 1);
```

`pointsPerPixel` が `maxPointsPerPixel` を超えた場合、その子nodeはqueueに積まない。

```ts
if (pointsPerPixel > pointCloud.maxPointsPerPixel) {
  densityLODStats.culledNodes++;
  densityLODStats.culledPoints += child.numPoints;
  continue;
}
```

この処理は、親nodeを表示した上で、画面上で過密と判断した子nodeへの詳細化だけを止める。つまり、点群全体を一律に削るのではなく、画面上の密度に応じてLODの深さを制御する。

## lil-gui設定

playgroundの `Points` フォルダに以下を追加した。

- `Screen Density LOD`: 有効/無効
- `Max Points / Pixel`: 子node展開を止める密度閾値

`maxPointsPerPixel` は小さいほど軽く、粗くなる。大きいほど高密度・高負荷になる。

## Performance panel

LOD / Visibility セクションに以下を追加した。

- `Density LOD`: 有効状態と `maxPointsPerPixel`
- `Density culled nodes`: density判定で展開を止めたnode数
- `Density culled points`: density判定で描画対象から外れた推定点数

## 検証結果

同じ視点、`Point budget: 50,000,000`、`Size Type: Adaptive`、`Min point size: 2.00` で比較した。

| Max points / pixel | Visible points | Visible nodes | Culled nodes | Culled points | Draw calls | CPU render submit avg | GPU time avg | FPS avg | 備考 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| disabled | 28,873,627 | 2,017 | 0 | 0 | 2,021 | 10.45 ms | 36.63 ms | 27.2 | 基準 |
| 0.5 | 8,045,920 | 878 | 530 | 12,087,361 | 882 | 4.31 ms | 10.39 ms | 60.0 | 速いがスカスカ感あり |
| 1.0 | 15,212,295 | 1,453 | 493 | 12,844,108 | 1,457 | 7.12 ms | 18.37 ms | 53.7 | 性能と密度のバランスが良い |
| 1.5 | 21,344,849 | 1,831 | 423 | 12,110,400 | 1,835 | 7.95 ms | 26.43 ms | 37.5 | やや重い |
| 2.0 | 25,410,330 | 1,997 | 256 | 8,024,750 | 2,001 | 8.84 ms | 31.87 ms | 31.1 | 無効に近い |

## 観察

`maxPointsPerPixel = 1.0` では、表示点数が `28.87M` から `15.21M` に減り、GPU時間が `36.63 ms` から `18.37 ms` に改善した。GPU時間の低下は表示点数の低下に近く、今回のボトルネックがGPUへ投入する点数に強く支配されていることと整合する。

`maxPointsPerPixel = 0.5` は60fpsに到達したが、見た目にスカスカ感が出た。軽量モードやカメラ操作中の一時的LODとしては有効だが、通常表示の初期値としては粗い。

`maxPointsPerPixel = 1.5` 以上ではGPU時間が大きく戻り、性能改善幅が小さくなる。高画質プリセットには使えるが、標準設定としては重い。

## 推奨設定

- 標準初期値: `Screen Density LOD = enabled`, `Max Points / Pixel = 1.0`
- 高FPS / 操作中LOD: `0.5`
- 高画質: `1.5`
- 従来相当: `2.0` 以上または disabled

点群ビューアとしては、広域表示時に1pxあたり過剰な点を描かず、詳細が必要な場合はカメラを寄せて見る方針が自然である。そのため、`1.0` は初期値として妥当である。

## 現在の制限

現在のdensity判定は、nodeの投影面積と点数だけを見る。実際の `gl_PointSize`、`PointSizeType`、`PointShape` はまだ考慮していない。

実際の点サイズはシェーダ側で以下の影響を受ける。

- `PointSizeType.FIXED`
- `PointSizeType.ATTENUATED`
- `PointSizeType.ADAPTIVE`
- `minSize` / `maxSize`
- `PointShape.SQUARE` / `CIRCLE` / `PARABOLOID`

今回の検証では、点サイズを考慮しない簡易判定でも十分な効果が出た。ただし、より正確にするなら `pointsPerPixel` に推定点面積を掛けたcoverageベースの判定へ拡張できる。

```ts
coveragePerPixel = pointsPerPixel * estimatedPointAreaPx;
```

この場合、`estimatedPointAreaPx` はまず `minSize * minSize` のような保守的な近似から始めるのがよい。
