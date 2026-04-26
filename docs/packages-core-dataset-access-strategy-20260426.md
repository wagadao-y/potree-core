# packages/core データセットアクセス方針 2026-04-26

## 目的

- 将来的に必要となる 2 つの重要機能を、場当たり的な個別対応ではなく共通の設計方針として整理する。
- 対象機能は、S3 などでの署名付き URL 3 本による安全な配信と、OPFS を利用したローカル永続キャッシュ / ローカル閲覧である。
- セキュリティ向上とローカル閲覧体験向上の両方を満たしつつ、`packages/core` の読込経路を拡張しやすい形へ寄せる。

## 背景

- 現在の `packages/core` は `RequestManager` を通じて metadata の取得と fetch を抽象化している。
- 一方で、実際の hierarchy / octree 読込では `metadata.json` からの文字列置換で `hierarchy.bin` と `octree.bin` を導出している。
- また、ローカル読込は `LocalPotreeRequestManager` が `File` を前提としており、`FileList` から 3 ファイルを受ける UI と結び付いている。

この構成は、同一ディレクトリ配下に 3 ファイルが並ぶ標準的な Potree v2 データセットには十分である。一方で、プロダクトとして次の要件に対応するには前提が不足している。

1. metadata、hierarchy、octree がそれぞれ別の署名付き URL で配布されること。
2. ローカル一時ファイルではなく、OPFS に保持したデータを range 読込しながら快適に閲覧できること。

## この対応が重要な理由

### 1. セキュリティ向上

- S3 署名付き URL に対応できると、公開バケットや長寿命 URL に依存せず、必要なオブジェクトだけを期限付きで配信できる。
- metadata、hierarchy、octree を個別に署名することで、配信制御、期限、監査、キャッシュ戦略をオブジェクト単位で調整しやすい。
- 認可済みクライアントだけが短時間アクセスできる構成は、プロダクトとしての配信セキュリティ強化に直結する。

### 2. ローカル閲覧体験向上

- OPFS を使うと、一度取得した点群データをブラウザ内に永続化し、再訪時の待ち時間やネットワーク依存を減らせる。
- ローカルファイル選択よりも、ユーザー操作を減らした継続的な閲覧体験を作りやすい。
- 大きなデータセットでも、必要 range だけを読む形を維持すれば、全体読込を避けつつ快適性を高められる。

## 現状の制約

### URL 解決モデルの制約

- `RequestManager.getUrl(url)` は 1 つの入力 URL から 1 つの解決先を返す契約である。
- hierarchy と octree は `metadata.json` の URL から文字列置換で導出しており、3 ファイル個別 URL の解決モデルになっていない。
- そのため、S3 署名付き URL のように query を含む別 URL を 3 本使うケースには、そのままでは対応できない。

### ローカル読込モデルの制約

- `LocalPotreeRequestManager` は `File` を保持し、`instanceof File` を満たすことを前提にしている。
- これは input type=file 由来の `FileList` には適合するが、OPFS の `FileSystemFileHandle` を直接扱う抽象にはなっていない。
- OPFS でも `getFile()` を毎回呼べば動かせる可能性はあるが、永続キャッシュや今後の拡張を考えると専用実装またはより下位の共通抽象が望ましい。

## 将来要件

### 必須要件

1. metadata、hierarchy、octree を個別に解決できること。
2. hierarchy と octree に対して byte range 読込できること。
3. remote 配信と local 永続化で、上位ローダーの制御フローをなるべく変えずに使えること。
4. セキュリティ要件に応じて、署名付き URL の再発行や期限切れ処理を実装できること。
5. OPFS を使う場合でも、全量メモリ展開ではなく必要範囲を読む形を維持できること。

### 望ましい要件

1. 同じローダーで、通常 URL、署名付き URL、ローカルファイル、OPFS を切り替えられること。
2. 将来的に IndexedDB、zip 展開済みキャッシュ、単一アーカイブなどへ拡張しやすいこと。
3. 署名失効、キャッシュ不整合、部分破損などの失敗時に、原因別に扱えること。

## 結論

- 将来的な本命は、`fetch` と `File` を二分することではなく、「Potree データセットの 3 リソースを個別に解決し、必要 range を読める」抽象へ整理することである。
- 短期的には既存の `RequestManager` を拡張して 3 ファイル個別 URL を扱えるようにし、中期的には dataset access abstraction へ寄せるのが妥当である。
- OPFS 対応も S3 署名付き URL 対応も、本質的には transport の違いではなく dataset resource 解決と range read の違いとして扱うべきである。

## 推奨方針

### 1. `metadata.json` 起点の文字列置換をやめる

- `metadata.json` から `hierarchy.bin` / `octree.bin` を文字列置換で作る設計は廃止対象とする。
- 代わりに、metadata、hierarchy、octree をそれぞれ個別リソースとして解決する。
- これにより、同一パス前提、query 共有前提、署名 URL の再利用前提を外せる。

### 2. URL 解決と byte range 読込を、データセット単位の責務として扱う

- 呼び出し側が欲しいのは汎用 fetch ではなく、Potree データセットの各リソースを正しく取得する能力である。
- したがって責務境界は network / file ではなく、dataset resource resolution / range access に置く。
- 署名付き URL、通常 HTTP、ローカル `File`、OPFS を、この責務境界の下で差し替えられるようにする。

### 3. OPFS は local file の亜種ではなく、永続キャッシュ付きデータソースとして扱う

- OPFS は一時的なファイル選択 UI と違い、継続利用、再訪、部分更新、キャッシュ管理が関心事になる。
- そのため、単なる `File` 変換で吸収するよりも、専用の source として扱う方が今後の UX 改善に繋がる。

## 推奨インターフェース方向

最小変更で済ませる案としては、既存 `RequestManager` を 3 リソース解決可能に拡張する方法がある。

例:

```ts
type PotreeResourceKind = "metadata" | "hierarchy" | "octree";

interface RequestManager {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  getUrl(kind: PotreeResourceKind, url: string): Promise<string>;
}
```

ただし、中期的には fetch 互換 API そのものよりも、Potree 読込に必要な能力を直接表した抽象の方がよい。

例:

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

この形なら、remote と local の差分を上位へ漏らしにくい。

## 実装方針

### 段階 1: 署名付き URL 3 本対応

- `metadata`、`hierarchy`、`octree` を個別に解決できるようにする。
- 既存の loader から文字列置換を除去し、resource kind を明示して URL を取得する。
- まずは HTTP fetch ベースのままでよい。
- 署名期限切れ時に再解決できるよう、URL 解決はキャッシュしすぎない方針を検討する。

### 段階 2: OPFS 対応

- OPFS 内の `metadata.json`、`hierarchy.bin`、`octree.bin` を dataset source として扱う。
- metadata は全文読込、hierarchy / octree は range 読込で返す。
- 初回取得元が remote の場合でも、将来的には remote source から OPFS へ保存し、次回は OPFS source を優先する構成を視野に入れる。

### 段階 3: source の共通化

- `LocalPotreeRequestManager`、将来の `OpfsPotreeRequestManager`、署名付き URL 対応 manager を個別増殖させるより、dataset source 抽象へ寄せる。
- 上位ローダーは metadata / hierarchy / octree の取得方法ではなく、「データセットを読む」ことだけに依存する形へ整理する。

## セキュリティ観点

- 署名付き URL は短寿命化と再発行前提で設計する。
- metadata と octree の URL を機械的に相互導出しないことで、誤署名 URL 利用や意図しない object 参照を避けやすくなる。
- ログや例外メッセージに署名 query をそのまま出しすぎない配慮が必要である。
- OPFS はブラウザ内永続化であるため、キャッシュ削除、容量超過、データ破損時の復旧動線を考慮する。

## UX 観点

- ローカルファイル選択は簡単だが、再訪のたびに選び直す必要がある。
- OPFS 対応により、ユーザーにとっては「前回読んだ点群をそのまま開ける」体験を提供しやすくなる。
- remote から OPFS へ保存できるようになれば、初回はオンライン取得、2 回目以降は高速ローカル閲覧という構成が可能になる。

## 非目標

- この段階で `packages/core` の全 loader API を一気に全面刷新すること。
- OPFS への書き込み戦略、同期 UI、容量管理 UI を今回の文書で詳細設計すること。
- S3 以外の全ストレージサービス固有仕様まで網羅すること。

## 当面の進め方

1. 現行の `metadata.json` 文字列置換箇所を、resource kind 明示の解決へ置き換える。
2. 署名付き URL 3 本を扱える最小実装を追加し、remote secure delivery の成立性を先に確保する。
3. その後、OPFS source を追加し、ローカル永続化経路を実装する。
4. `LocalPotreeRequestManager` は当面維持しつつ、最終的には source abstraction へ収束させる。

## 関連文書

- `packages-core-layer-separation-inventory-20260425.md`
  - `loading/RequestManager.ts` と `loading/LocalPotreeRequestManager.ts` の現在位置づけを整理している。

- `packages-core-performance-strategy-20260425.md`
  - ローカル快適性や再訪時体感を改善する際の、読込・キャッシュ観点の優先順位と合わせて参照する。