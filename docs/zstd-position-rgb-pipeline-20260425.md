# Zstd / position+rgb パイプライン調査メモ

- 作成日: 2026-04-25
- 対象: `packages/core` / `apps/playground`
- データ: 同一 COPC LAZ 由来の Potree v2 dataset
- 視点: `Camera pos: 9.0, 1.5, 4.4`
- Canvas: `1920 x 911`
- Pixel ratio: `1.00`
- EDL: disabled
- Density LOD: disabled
- Point budget: `50,000,000`

## 結論

Zstd 化は decompress 単体では明確に効くが、ロード全体では attribute decode / transfer / geometry 作成も含まれるため、steady-state FPS にはほぼ影響しない。

一方で、データ作成時点で属性を `position + rgb` のみに絞ると、JS heap、attribute decode、worker transfer が大きく下がる。表示用途が RGB 点群ビューア中心であれば、データ作成からビューア描画までの標準パイプラインは以下を推奨する。

```text
COPC/LAZ -> Potree v2 dataset
encoding: ZSTD
attributes: position + rgb のみ
```

`intensity`, `classification`, `gps-time` などが必要な用途は、別データセットまたは高機能版として扱うのがよい。

## Zstd と Brotli の比較

フル属性データでの比較。

| 指標 | Brotli | Zstd | 備考 |
| --- | ---: | ---: | --- |
| FPS avg | 25.4 | 25.3 | GPU 支配のため同等 |
| GPU time avg | 39.16 ms | 39.26 ms | 同等 |
| Decompress avg | 2.51 ms | 0.88 ms | Zstd が約 2.85x 高速 |
| Attribute decode avg | 3.95 ms | 4.09 ms | ほぼ同等 |
| Decode avg | 6.46 ms | 4.97 ms | 約 23% 改善 |
| Transfer avg | 1.77 ms | 1.54 ms | 約 13% 改善 |
| Decode throughput | 2.28M pts/s | 2.97M pts/s | 約 30% 改善 |
| JS heap | 2,533 MB | 2,533 MB | 同等 |

判断:

- Zstd は decompress 単体ではベンチマークに近い効果が出ている。
- ただし Zstd 化後は attribute decode が主コストになる。
- ロード完了後の FPS は `GPU time ~= submitted points` に支配されるため、Zstd 化では改善しない。

## position+rgb のみデータの効果

Zstd データでの比較。

| 指標 | フル属性 | position+rgb | 備考 |
| --- | ---: | ---: | --- |
| FPS avg | 25.3 | 25.7 | ほぼ同等 |
| GPU time avg | 39.26 ms | 38.61 ms | ほぼ同等 |
| Fetched bytes | 157.6 MB | 145.4 MB | 約 8% 減 |
| Decompress avg | 0.88 ms | 0.72 ms | 約 18% 改善 |
| Attribute decode avg | 4.09 ms | 2.28 ms | 約 44% 改善 |
| Decode avg | 4.97 ms | 3.00 ms | 約 40% 改善 |
| Transfer avg | 1.54 ms | 0.53 ms | 約 66% 改善 |
| Decode throughput | 2.97M pts/s | 4.92M pts/s | 約 66% 改善 |
| JS heap | 2,533 MB | 803 MB | 約 68% 減 |

Brotli でも同じ傾向が出た。

| 指標 | フル属性 Brotli | position+rgb Brotli |
| --- | ---: | ---: |
| Decompress avg | 2.51 ms | 1.95 ms |
| Attribute decode avg | 3.95 ms | 2.15 ms |
| Decode avg | 6.46 ms | 4.10 ms |
| Transfer avg | 1.77 ms | 0.77 ms |
| JS heap | 2,533 MB | 800 MB |

判断:

- `position+rgb` 化は圧縮サイズ差以上に runtime memory / transfer / decode に効く。
- 特に JS heap の削減が大きく、巨大データ耐性と GC 安定性に効く。
- steady-state FPS は GPU 点数支配のため大きくは変わらない。

## なぜファイルサイズ差より heap 差が大きいか

今回の Zstd 圧縮後ファイルサイズは以下だった。

| データ | Zstd 圧縮後サイズ |
| --- | ---: |
| フル属性 | 555 MB |
| position+rgb | 510 MB |

圧縮後サイズ差は約 8% しかない。一方、フル属性 metadata では raw attribute layout が以下になる。

```text
position: 12 bytes/point
rgb:       6 bytes/point
追加属性: 20 bytes/point
合計:    38 bytes/point
```

`position+rgb` の raw layout は `18 bytes/point` なので、圧縮前の属性量は 2.1 倍ある。追加属性の多くは `0` や `1` の定数に近いため Zstd ではよく圧縮され、ファイルサイズ差には出にくい。

しかし worker decode 後は追加属性ごとに派生バッファが作られる。

```text
Float32 buffer: 4 bytes/point
preciseBuffer: 元型サイズ bytes/point
```

追加属性の合計は以下になる。

```text
追加属性 preciseBuffer: 20 bytes/point
追加属性 Float32 buffer: 9 attributes * 4 = 36 bytes/point
追加派生バッファ合計: 56 bytes/point
```

表示された約 `33M points` に対しては以下になる。

```text
56 * 33,040,000 ~= 1.85 GB
```

これは JS heap の実測差 `約 2.53GB -> 約 0.80GB` とかなり近い。したがって、heap 増加の主因は圧縮済み octree.bin ではなく、decode 後の attribute buffer / preciseBuffer である。

## 設計判断

RGB 表示が主用途の標準配信データは、データ作成時点で `position + rgb` のみにする。

理由:

- viewer runtime に不要属性 skip の複雑さを持ち込まない。
- compressed payload、decompressed raw buffer、attribute buffer、transfer bytes、JS heap のすべてを下げられる。
- 表示モード切り替え時に「属性がある node / ない node」が混在する問題を避けられる。
- フル属性データが必要な用途は明確に別扱いできる。

runtime 側の未使用属性 skip も可能だが、以下の制約がある。

- 圧縮済み payload には不要属性が残る。
- decompress 後 raw buffer には不要属性が残る。
- worker は属性レイアウトを正しく読み飛ばす必要がある。
- `PointColorType.INTENSITY` や `CLASSIFICATION` へ切り替えた時の再 decode / reload 方針が必要になる。
- キャッシュ済み geometry の属性不足を扱う必要がある。

そのため、標準パイプラインとしてはデータ作成時点の属性削減を優先する。

## 追加実施済み改善

### indices attribute の通常生成を廃止

当初、worker は各 node で `0..numPoints-1` の `Uint32Array` を生成し、`indices` attribute として geometry に持たせていた。

```text
indices: 4 bytes/point
```

`THREE.Points` の通常描画ではこの attribute は不要だった。一方、従来の picking は `PointColorType.POINT_INDEX` で `indices.rgb` を render target に書き、readback 後に `pIndex` として使っていた。

WebGL2 前提に寄せ、pick shader では `indices` attribute の代わりに `gl_VertexID` から point index color を生成するよう変更した。これにより、通常ロード時も picking 時も `indices` attribute を生成しない。

```glsl
int index = gl_VertexID;
int r = index & 255;
int g = (index >> 8) & 255;
int b = (index >> 16) & 255;
```

公開 API は変えていない。`pick()` の戻り値や呼び出し側の使い方はそのままである。

#### 検証結果

`position+rgb` の Zstd データで、読み込み完了後と大量 pick 後を比較した。

| 指標 | 読み込み完了後 | 大量 pick 後 | 備考 |
| --- | ---: | ---: | --- |
| JS heap | 688.7 MB | 675.7 MB | indices 蓄積なし |
| JS heap max 側 | 722.6 MB | 737.8 MB | 配置オブジェクト等の増分のみ |
| FPS avg | 25.5 | 25.4 | 同等 |
| GPU time avg | 38.96 ms | 39.20 ms | ほぼ同等 |
| CPU render submit | 8.58 ms | 8.32 ms | 同等 |
| Draw calls | 2,244 | 2,275 | 配置オブジェクト分で増加 |
| Triangles | 14 | 61,518 | 配置オブジェクト分で増加 |
| GPU geometries | 2,476 | 2,540 | 配置オブジェクト分で増加 |

先に試した lazy indices 方式では、複数回 pick すると ray 候補 node に `indices` attribute が蓄積し、JS heap が増え続けた。`gl_VertexID` 方式ではこの蓄積がなく、通常表示の memory 削減と picking 互換を両立できた。

判断:

- `indices` attribute の通常生成廃止は採用する。
- WebGL2 / hardware acceleration enabled をビューアの前提にする。
- WebGL2 が取れない、または software renderer の環境は非対応とする。

## 今後の改善候補

### 1. worker 返送 payload の削減

非圧縮 `decoder.worker.js` は元 `buffer` を message と transferables に含めている。main thread で使っていないなら削除する。

Zstd/Brotli worker では元 decompressed buffer を transfer していないが、message には `buffer` property が残っている。不要なら message からも外す。

検証項目:

- `worker-transfer`
- JS heap peak
- node load 中の GC pause

### 2. transfer / generated buffer bytes の計測追加

次の判断のため、worker が生成した buffer bytes を stage metadata として出す。

見たい内訳:

- decompressed raw bytes
- position buffer bytes
- color buffer bytes
- preciseBuffer bytes
- vector attribute buffer bytes
- transferables total bytes

これにより、属性削減や payload 削減の効果を数値で追える。

### 3. position+rgb 専用 fast path

metadata が `position + rgb` のみの場合、汎用 attribute loop ではなく専用 decode path にする。

期待効果:

- attribute name 判定の削減
- getter map / bind の回避
- byte offset 計算の単純化

効果は限定的かもしれないが、`Attribute decode avg 2.28ms` に直接効く可能性がある。

### 4. Zstd decoder warmup

初回 node で `zstdDecoder.init()` が乗るため、ロード開始時に worker を作成して Zstd decoder を warmup する。

期待効果:

- 初回表示 latency の安定化
- `worker-wait` / decode p95 の改善

平均値より p95 / max に効く施策として扱う。

### 5. bytes in flight 制御

`maxNumNodesLoading` だけでなく、`maxBytesInFlight` を導入する。

期待効果:

- 巨大 node が混ざるデータで heap peak を抑える。
- worker decode と transfer の同時発生を抑え、フレームスパイクを減らす。

Zstd / position+rgb にしても大規模データでは有効。

### 6. Range merge gap 許容

octree.bin の Range 取得は連続範囲のみ結合している。小さい gap を許容すると request 数を減らせる可能性がある。

ただし、余分な bytes fetch が増えるため以下を見て判断する。

- fetch events
- bytes / fetch
- octree fetched / node bytes
- fetch throughput
- octree read avg

## 優先順位

ロード / decode 周りの次の優先順位は以下。

1. worker 返送 payload から未使用 `buffer` を削除
2. transfer / generated buffer bytes の計測追加
3. `position+rgb` 専用 fast path
4. Zstd decoder warmup
5. `maxBytesInFlight`
6. Range merge gap 許容

FPS 改善については引き続き GPU に送る点数が支配的であり、Screen-Space Density LOD や dynamic point budget を別軸で進める。
