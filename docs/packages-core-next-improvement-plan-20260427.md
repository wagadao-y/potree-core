# packages/core 次改善プラン 2026-04-27

## 目的

- package split 後の `potree-core` / `potree-renderer-three` を前提に、次にどの順で改善を進めるべきかを整理する。
- 依存関係の整理が一段落した今、手戻りの少ない順で correctness、API 契約、テスト、性能改善を進める。
- 実装順、理由、完了条件を 1 本の計画として残す。

## 現在地

- `potree-core` は load、visibility scheduling、worker decode、LRU、neutral type surface に責務を寄せられた。
- `potree-renderer-three` は `PointCloudOctree`、material、picking、EDL、scene materialization、diagnostics を受け持つ構造になった。
- 依存方向は概ね `renderer-three -> core` に揃っており、以前より責務境界が明確である。
- 一方で、利用者が直接触れる API 契約、I/O 失敗時の扱い、pick の座標契約、shared resource の寿命、回帰テストはまだ弱い。

## 判断基準

次の順序は、単に重要度順ではなく、後続作業の手戻りを減らす順で決める。

1. 先に API 契約と失敗系を固める
2. 次にその挙動をテストで固定する
3. その後に source abstraction や拡張性の高い設計へ進む
4. 最後に性能制御を詰める

理由:

- 契約が曖昧なまま test を書くと、後で test ごと作り直しになる。
- I/O や pick の失敗系が不安定なまま性能改善を進めると、計測結果の解釈が難しくなる。
- `RequestManager` / dataset source abstraction は API 契約を含むため、先に fetch / range / pick の期待値を明文化してから着手した方が安全である。

## 推奨する実施順

### フェーズ 1: API 契約と失敗系の硬化

最初にやるべきこと:

1. metadata / hierarchy / octree fetch の成功判定と range 応答検証を入れる
2. pick API の座標系契約を明文化する
3. renderer state を pick 前後で安全に保存・復元する

この順にする理由:

- いま一番リスクが高いのは、壊れた通信や誤った座標入力が壊れた挙動として静かに伝播する点である。
- package split によって core と renderer の担当が明確になったので、今なら `potree-core` 側の I/O 契約と `potree-renderer-three` 側の pick 契約を分けて扱いやすい。
- ここを先に直すと、後続の test と source abstraction の仕様が決めやすい。

対象:

- `packages/core/src/loading/OctreeLoader.ts`
- `packages/core/src/loading/load-octree-hierarchy.ts`
- `packages/core/src/loading/octree-range-cache.ts`
- `packages/renderer-three/src/picking/point-cloud-octree-picker.ts`
- `packages/renderer-three/src/picking/pick-render-target.ts`
- `packages/core/README.md`

完了条件:

- HTTP エラーと range 非対応を原因別に識別できる
- `pixelPosition` がどの座標系を要求するか README と型コメントで明記されている
- pick 実行後に renderer state の副作用が残らない

### フェーズ 2: 回帰テストと公開面の固定

次にやるべきこと:

1. load / pick / dispose / exports の smoke test を追加する
2. Brotli / Zstd の decode 経路を守るテストを追加する
3. 公開 package surface のみで最小 example が build できることを検証する

この順にする理由:

- フェーズ 1 で API 契約を明示した後なら、テストの期待値を固定しやすい。
- split 後は package 境界が整理されたため、`potree-core` と `potree-renderer-three` を別々に smoke test しやすい。
- ここで exports と example の整合を固定しておくと、今後の refactor や source abstraction 変更で公開面を壊しにくい。

対象:

- `packages/core/package.json`
- `packages/renderer-three/package.json`
- test 基盤として追加するファイル群
- `apps/playground`

完了条件:

- 少なくとも load、pick、dispose、exports の 4 系統に自動検証がある
- Brotli / Zstd の両方で最低限の load 成功が確認できる
- 公開 exports のみを使う smoke test が通る

### フェーズ 3: dataset source abstraction の導入

次にやるべきこと:

1. `metadata.json` 文字列置換前提をやめる方針を確定する
2. dataset 単位の source abstraction を設計する
3. `RequestManager` と local source の責務を整理する

この順にする理由:

- これは今後の HTTP、署名 URL、File、OPFS 対応の基盤になるが、API 契約を含むためフェーズ 1 より先にやるべきではない。
- 先に失敗系と test を固めておけば、source abstraction の差し替えで挙動が壊れていないことを確認しやすい。

対象:

- `packages/core/src/loading/RequestManager.ts`
- `packages/core/src/loading/LocalPotreeRequestManager.ts`
- `packages/core/src/loading/load-octree.ts`
- `packages/core/src/potree.ts`
- 新設する dataset source interface

完了条件:

- metadata、hierarchy、octree の resource 解決が dataset abstraction 経由になる
- 署名 URL 3 本、File、OPFS を後から差し込める責務境界がある
- `metadata.json` 固定前提が public API から外れている

### フェーズ 4: ライフサイクルと shared resource の整理

次にやるべきこと:

1. shared picker や auxiliary GPU resource の寿命を見直す
2. dispose 契約を worker、GPU、cache まで含めて明文化する
3. diagnostics と debug helper の責務を viewer 寄り機能として切り分けるか判断する

この順にする理由:

- split 後の構造では、resource ownership が core と renderer-three に分かれたため、ここで寿命管理を明確にする価値が高い。
- ただし correctness と test が先に固まっていないと、dispose の改善が回帰か最適化か判定しにくい。

対象:

- `packages/renderer-three/src/picking/*`
- `packages/renderer-three/src/rendering/*`
- `packages/renderer-three/src/diagnostics.ts`
- `packages/renderer-three/src/point-cloud-octree.ts`

完了条件:

- dispose 後に何が解放されるかを説明できる
- shared resource の所有者がコードと docs の両方で明確になっている
- diagnostics / debug 表示の責務境界が整理されている

### フェーズ 5: 運用向けの性能制御

最後にやるべきこと:

1. Screen-Space Density LOD の実運用パラメータを詰める
2. dynamic point budget を導入する
3. clip-aware scheduling と draw call 削減を検討する

この順にする理由:

- ここは steady-state FPS へ効くが、契約や失敗系の不安定さが残っている段階で着手すると評価がぶれやすい。
- 構造整理後の性能改善は、より純粋に submitted points と draw calls の問題として扱える。

対象:

- `packages/core/src/core/point-cloud-visibility-scheduler.ts`
- `packages/core/src/core/visibility/*`
- `packages/renderer-three/src/update-point-clouds.ts`
- performance docs 群

完了条件:

- GPU time を基準に point budget を自動制御できる
- 近接・高密度視点での submitted points と GPU time を意図的に抑えられる
- clip 条件下で budget の浪費を減らせる方向性が確認できる

## 直近 3 ステップ

今すぐ着手するなら、この順がよい。

1. fetch / range 検証の追加
2. pick API の座標契約と renderer state 復元の整理
3. その 2 つを守る最小 smoke test の追加

この 3 ステップを先にやると、今後の大きめの設計変更も safer に進められる。

## 今は後回しでよいもの

- shader micro optimization の追加調査
- position 表現の再圧縮方式の再検討
- runtime での未使用属性 skip の本格導入
- 大規模な renderer batching 実装

これらは価値はあるが、現時点では correctness と API 契約を固めた後の方が投資効率が高い。

## まとめ

package split 後の次の一手は、さらに構造をいじることではなく、整理された境界の上で契約を固めることにある。

進め方としては、

1. I/O と pick の契約を硬化する
2. その挙動を test で固定する
3. その後に source abstraction を導入する
4. 最後にライフサイクルと性能制御を詰める

という順が最も手戻りが少ない。