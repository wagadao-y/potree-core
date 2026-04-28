# potree-core

`potree-core` は、Potree 系データセットの読み込み、octree 管理、可視性制御などを担う core パッケージです。

- 描画や picking を含まない、three.js 非依存の中核ロジックを提供します。
- three.js との統合は `potree-renderer-three` 側で扱います。
- renderer 実装や高度な統合向けには `potree-core/core` サブパスを提供します。

## 基本的な使い方

```javascript
import { Potree } from 'potree-core';

const potree = new Potree();
const dataset = await potree.loadPointCloud(
   'metadata.json',
   'https://example.com/potree/',
);
```

`loadPointCloud()` は `metadata.json` を入口としてデータセットを読み込みます。描画は行わないため、読み込んだデータセットを画面へ出すには `potree-renderer-three` などの renderer 統合層が必要です。

## 公開 API

- `potree-core` の root export は、アプリケーションから利用する安定した user-facing API です。
- `potree-core/core` は、renderer 統合や高度な利用者向けの lower-level な core primitive を公開します。

### Root exports: `potree-core`

通常の利用では root entry を使ってください。

```javascript
import {
   Potree,
   LocalPotreeRequestManager,
} from 'potree-core';
```

主な公開対象は次のとおりです。

- `Potree`
- `IPotree`
- `LoadedPointCloud`
- `LoadOctreeOptions` と load instrumentation 関連型
- `LocalPotreeRequestManager`
- point budget などの安定した public constant

### Advanced exports: `potree-core/core`

renderer adapter や低レベル統合を実装する場合のみ `./core` サブパスを利用してください。

```javascript
import {
   PointCloudVisibilityScheduler,
   OctreeGeometryNode,
} from 'potree-core/core';
```

この entry には、たとえば次の lower-level な構成要素が含まれます。

- visibility scheduler と visibility structures
- tree model と tree-node type
- octree geometry node type
- renderer 実装で使う math / utility helper

## LocalPotreeRequestManager

ローカルの `File` / `FileList` から Potree データセットを読む場合は `LocalPotreeRequestManager` を使えます。

```javascript
import {
   LocalPotreeRequestManager,
   Potree,
} from 'potree-core';

const requestManager = LocalPotreeRequestManager.fromFileList(fileInput.files);
const potree = new Potree();
const dataset = await potree.loadPointCloud('metadata.json', requestManager);
```

`LocalPotreeRequestManager` は `metadata.json`、`hierarchy.bin`、`octree.bin` の 3 ファイルを前提にします。

## カスタム Request Manager

独自キャッシュや独自の取得経路を組み込みたい場合は、custom request manager を実装できます。

- `metadata.json` の取得成功を前提にします。
- `hierarchy.bin` と `octree.bin` は HTTP range response を正しく返す必要があります。
- partial response では妥当な `Content-Range` header が必要です。

```javascript
class CustomRequestManager implements RequestManager {
   fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      throw new Error('Method not implemented.');
   }

   async getUrl(url: string): Promise<string> {
      return url;
   }
}
```
