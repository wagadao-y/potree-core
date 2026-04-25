import { Box3, Vector3 } from "three";
import type { Box3Like } from "../core/types";
import type { DecodedPointAttributes } from "../loading2/DecodedPointAttributes";
import {
  PointAttributeName,
} from "../point-attributes";
import type { PointCloudOctreeGeometryNode } from "../point-cloud-octree-geometry-node";
import { toThreeBox3 } from "../renderer-three/box3-like";
import { Version } from "../version";
import BinaryDecoderWorker from "../workers/binary-decoder.worker.ts?worker&inline";
import type {
  LegacyBinaryDecoderAttribute,
  LegacyBinaryDecoderRequest,
  LegacyBinaryDecoderResponse,
} from "./WorkerProtocol";
import type { GetUrlFn, XhrRequest } from "./types";

interface BinaryLoaderOptions {
  getUrl?: GetUrlFn;
  version: string;
  boundingBox: Box3Like;
  scale: number;
  xhrRequest: XhrRequest;
}

type Callback = (node: PointCloudOctreeGeometryNode) => void;

export class BinaryLoader {
  version: Version;

  boundingBox: Box3Like;

  scale: number;

  getUrl: GetUrlFn;

  disposed: boolean = false;

  xhrRequest: XhrRequest;

  callbacks: Callback[];

  private workers: Worker[] = [];

  constructor({
    getUrl = (s) => {
      return Promise.resolve(s);
    },
    version,
    boundingBox,
    scale,
    xhrRequest,
  }: BinaryLoaderOptions) {
    if (typeof version === "string") {
      this.version = new Version(version);
    } else {
      this.version = version;
    }

    this.xhrRequest = xhrRequest;
    this.getUrl = getUrl;
    this.boundingBox = boundingBox;
    this.scale = scale;
    this.callbacks = [];
  }

  dispose(): void {
    this.workers.forEach((worker) => {
      worker.terminate();
    });
    this.workers = [];

    this.disposed = true;
  }

  load(node: PointCloudOctreeGeometryNode): Promise<void> {
    if (node.loaded || this.disposed) {
      return Promise.resolve();
    }

    return Promise.resolve(this.getUrl(this.getNodeUrl(node)))
      .then((url) => {
        return this.xhrRequest(url, { mode: "cors" });
      })
      .then((res) => {
        return res.arrayBuffer();
      })
      .then((buffer) => {
        return new Promise((resolve) => {
          return this.parse(node, buffer, resolve);
        });
      });
  }

  private getNodeUrl(node: PointCloudOctreeGeometryNode): string {
    let url = node.getUrl();
    if (this.version.equalOrHigher("1.4")) {
      url += ".bin";
    }

    return url;
  }

  private parse(
    node: PointCloudOctreeGeometryNode,
    buffer: ArrayBuffer,
    resolve: () => void,
  ): void {
    if (this.disposed) {
      resolve();
      return;
    }

    const worker = this.getWorker();

    const pointAttributes = node.pcoGeometry.pointAttributes;
    const numPoints = buffer.byteLength / pointAttributes.byteSize;

    if (this.version.upTo("1.5")) {
      node.numPoints = numPoints;
    }

    worker.onmessage = (e: MessageEvent<LegacyBinaryDecoderResponse>) => {
      if (this.disposed) {
        resolve();
        return;
      }

      const data = e.data;

      node.mean = new Vector3().fromArray(data.mean);
      node.tightBoundingBox = this.getTightBoundingBox(data.tightBoundingBox);
      node.decodedPointAttributes = this.toDecodedPointAttributes(data);
      node.loaded = true;
      node.loading = false;
      node.failed = false;
      node.pcoGeometry.numNodesLoading--;
      node.pcoGeometry.needsUpdate = true;

      this.releaseWorker(worker);

      this.callbacks.forEach((callback) => {
        callback(node);
      });
      resolve();
    };

    const message: LegacyBinaryDecoderRequest = {
      buffer: buffer,
      pointAttributes: pointAttributes,
      version: this.version.version,
      offset: [
        node.pcoGeometry.offset.x,
        node.pcoGeometry.offset.y,
        node.pcoGeometry.offset.z,
      ],
      scale: this.scale,
    };

    worker.postMessage(message, [message.buffer]);
  }

  private getWorker(): Worker {
    const worker = this.workers.pop();
    if (worker) {
      return worker;
    }

    // return new Worker(
    //   new URL('../workers/binary-decoder.worker.js', import.meta.url),
    //   { type: 'module' },
    // )
    return new BinaryDecoderWorker();
  }

  private releaseWorker(worker: Worker): void {
    this.workers.push(worker);
  }

  private getTightBoundingBox(box: Box3Like): Box3 {
    const tightBoundingBox = toThreeBox3(box);
    tightBoundingBox.max.sub(tightBoundingBox.min);
    tightBoundingBox.min.set(0, 0, 0);

    return tightBoundingBox;
  }

  private toDecodedPointAttributes(
    data: LegacyBinaryDecoderResponse,
  ): DecodedPointAttributes {
    const decodedPointAttributes: DecodedPointAttributes = {
      INDICES: {
        buffer: data.indices,
      },
    };

    for (const property in data.attributeBuffers) {
      const decodedAttribute = data.attributeBuffers[property];
      const attributeName = this.getDecodedAttributeName(decodedAttribute);
      if (attributeName === null) {
        continue;
      }

      decodedPointAttributes[attributeName] = {
        buffer: decodedAttribute.buffer,
      };
    }

    return decodedPointAttributes;
  }

  private getDecodedAttributeName(
    decodedAttribute: LegacyBinaryDecoderAttribute,
  ): string | null {
    switch (decodedAttribute.attribute.name) {
      case PointAttributeName.POSITION_CARTESIAN:
        return "position";
      case PointAttributeName.COLOR_PACKED:
        return "color";
      case PointAttributeName.INTENSITY:
        return "intensity";
      case PointAttributeName.CLASSIFICATION:
        return "classification";
      case PointAttributeName.NORMAL_SPHEREMAPPED:
      case PointAttributeName.NORMAL_OCT16:
      case PointAttributeName.NORMAL:
        return "NORMAL";
      default:
        return null;
    }
  }
}
