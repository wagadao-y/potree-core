# Potree Core 2.0

[![npm version](https://badge.fury.io/js/potree-core.svg)](https://badge.fury.io/js/potree-core)

 - このリポジトリは [tentone/potree-core](https://github.com/tentone/potree-core) をベースに取り込んだ fork です。
 - 元実装を出発点にしつつ、このワークスペースでは core と three.js renderer の責務分離、公開 API の整理、テスト整備を進めています。
 - Potree は Markus Schütz によって作られた Web ベースの点群ビジュアライザであり、本プロジェクトではその点群処理の中核部分を独立したライブラリとして扱いやすい形に再構成しています。
 - 点群データの読み込みや可視性制御などの中核ロジックは potree-core に集約し、three.js との描画統合は potree-renderer-three 側で扱います。
 - LAS、LAZ、Binary 形式の点群をサポートします。
 - 一部機能では次の GL extension の対応が必要です。
    - EXT_frag_depth, WEBGL_depth_texture, OES_vertex_array_object


## 使用例
 - このプロジェクトは `npm install` と `npm run build` でビルドできます。
 - build フォルダの成果物を使うか、NPM 経由でプロジェクトへ追加してください。
 - worker フォルダもあわせて配置してください。worker フォルダは source フォルダ内にあります。
 - ビルド成果物は ES module です。他プロジェクトから import できます。three.js は peer dependency として利用可能である必要があります。
 - 以下は、このライブラリを three.js プロジェクトで使って Potree 点群を読み込む最小構成の例です。

```javascript
import {
   createPointCloudOctree,
   Potree,
   updatePointClouds,
} from 'potree-renderer-three';

const scene = new Scene();
const camera = new PerspectiveCamera(60, 1, 0.1, 10000);

const canvas = document.getElementById("canvas");

const renderer = new WebGLRenderer({canvas:canvas});

const geometry = new BoxGeometry(1, 1, 1);
const material = new MeshBasicMaterial({color: 0x00ff00});
const cube = new Mesh(geometry, material);
scene.add(cube);

const controls = new OrbitControls(camera, canvas);
camera.position.z = 10;

const pointClouds = [];

const baseUrl = "data/test/";
const potree = new Potree();
potree.loadPointCloud("metadata.json", baseUrl).then(function(dataset) {
   const pco = createPointCloudOctree(potree, dataset);
   scene.add(pco);
	pointClouds.push(pco);
});

function loop()
{
   updatePointClouds(potree, pointClouds, camera, renderer);

	controls.update();
	renderer.render(scene, camera);

	requestAnimationFrame(loop);
};
loop();
```

## クリップボックス
 - クリップボックスは、点群の描画領域を箱状のボリュームに制限します。
 - `createClipBox(size, position)` ヘルパーを使うと、サイズとワールド座標から `IClipBox` を作成できます。
 - `ClipMode` を material に設定し、`setClipBoxes()` にボックスを渡してください。

```javascript
import { ClipMode, createClipBox } from 'potree-renderer-three';
import { Vector3 } from 'three';

// ワールド座標 (2, 0, 0) を中心とする 5×5×5 のクリップボックスを作成
const clipBox = createClipBox(new Vector3(5, 5, 5), new Vector3(2, 0, 0));

// ボックス内の点をハイライトする
// 他のモード: CLIP_OUTSIDE, CLIP_INSIDE, DISABLED
pco.material.clipMode = ClipMode.HIGHLIGHT_INSIDE;
pco.material.setClipBoxes([clipBox]);
```

 - `ClipMode.DISABLED` - クリッピングしません。
 - `ClipMode.CLIP_OUTSIDE` - ボックス内の点のみ描画します。
 - `ClipMode.CLIP_INSIDE` - ボックス外の点のみ描画します。
 - `ClipMode.HIGHLIGHT_INSIDE` - すべて描画しつつ、ボックス内の点をハイライトします。

## クリップスフィア
 - クリップスフィアは、点群の描画領域を球状のボリュームに制限します。
 - `createClipSphere(center, radius)` ヘルパーを使うと、中心座標と半径から `IClipSphere` を作成できます。
 - `ClipMode` を material に設定し、`setClipSpheres()` に球を渡してください。
 - クリップボックスとクリップスフィアは併用できます。いずれかのボリューム内に入っていれば「内側」とみなされます。

```javascript
import { ClipMode, createClipSphere } from 'potree-renderer-three';
import { Vector3 } from 'three';

// ワールド座標 (0, 1, 0) を中心とする半径 3 のスフィアを作成
const clipSphere = createClipSphere(new Vector3(0, 1, 0), 3);

// 球内の点をハイライトする
// 他のモード: CLIP_OUTSIDE, CLIP_INSIDE, DISABLED
pco.material.clipMode = ClipMode.HIGHLIGHT_INSIDE;
pco.material.setClipSpheres([clipSphere]);
```

 - `ClipMode.DISABLED` - クリッピングしません。
 - `ClipMode.CLIP_OUTSIDE` - 球内の点のみ描画します。
 - `ClipMode.CLIP_INSIDE` - 球外の点のみ描画します。
 - `ClipMode.HIGHLIGHT_INSIDE` - すべて描画しつつ、球内の点をハイライトします。

## Picking
 - 点の picking API は renderer-three 側にあります。たとえば `PointCloudOctree.pick()` や `pickPointClouds()` を利用します。
 - `pixelPosition` に渡す座標は DOM client 座標ではなく、framebuffer のピクセル座標です。
 - canvas event 由来の座標を渡す場合は、現在の device pixel ratio を使って変換してから picking API に渡してください。

```javascript
const rect = canvas.getBoundingClientRect();
const dpr = window.devicePixelRatio;
const framebufferPosition = new Vector3(
   (event.clientX - rect.left) * dpr,
   (event.clientY - rect.top) * dpr,
   0,
);

const hit = pointCloud.pick(renderer, camera, ray, {
   pixelPosition: framebufferPosition,
});
```

## 公開 API
 - `potree-core` の root export は、データセット読み込みと Potree 制御のための安定した user-facing API です。
 - `potree-core/core` は、renderer 統合や高度な利用者向けの lower-level な core primitive を公開します。
 - 描画、picking、material、scene integration には `potree-renderer-three` を優先してください。

### Root exports: `potree-core`
アプリケーション側の統合では、まず root entry を使ってください。

```javascript
import {
   Potree,
   LocalPotreeRequestManager,
} from 'potree-core';
```

root entry は主に次を対象としています。

 - `Potree`
 - `IPotree`
 - `LoadedPointCloud`
 - `LoadOctreeOptions` と load instrumentation 関連型
 - `LocalPotreeRequestManager`
 - point budget の既定値など、安定した public constant

### Advanced exports: `potree-core/core`
`./core` サブパスは、renderer adapter や低レベル統合を実装する場合にのみ利用してください。

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

`./core` entry も利用可能ですが、package root より低レベルな面として扱ってください。

## カスタム Request Manager
   - potree core library は、点群データの読み込みを処理するために custom request manager を利用します。
   - custom implementation に差し替えることで、独自キャッシュや独自の request 処理を組み込めます。
   - Potree v2 の loading では、metadata fetch の成功と `hierarchy.bin` / `octree.bin` の HTTP range response を前提にしています。
   - リモートサーバーは byte-range request をサポートし、partial response に対して妥当な `Content-Range` header を返す必要があります。

   ```javascript
   class CustomRequestManager implements RequestManager 
   {
      fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
         throw new Error("Method not implemented.")
      }

      async getUrl(url: string): Promise<string> {
         return url;
      }
   }
   ```   

## Potree Converter
 - このプロジェクトで扱う点群データは、[Potree Converter](https://github.com/potree/PotreeConverter/releases) 2.x 系が生成する形式を前提にしています。
 - 入力点群は基本的に LAS / LAZ を想定しています。
 - 読み込み時には `metadata.json`、`hierarchy.bin`、`octree.bin` を含む PotreeConverter 2.x 系の出力が必要です。
 - 入力ファイルから出力フォルダを生成するには `./PotreeConverter ../input.laz -o ../output` のように実行します。
