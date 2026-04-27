import { byLevelAndIndex } from "potree-core";
import { Color, NearestFilter, type Texture } from "three";
import type { PointCloudOctreeNode } from "../geometry/point-cloud-octree-node";
import { generateDataTexture } from "./texture-generation";

export class PointCloudVisibleNodesTexture {
  public texture: Texture;

  public textureSize: number;

  private childOffsets: Uint32Array;

  public constructor(initialTextureSize: number) {
    this.textureSize = initialTextureSize;
    this.texture = createVisibleNodesTexture(initialTextureSize);
    this.childOffsets = new Uint32Array(initialTextureSize);
  }

  public dispose(): void {
    this.texture.dispose();
  }

  public update(nodes: PointCloudOctreeNode[]): void {
    nodes.sort(byLevelAndIndex);

    this.ensureCapacity(nodes.length);

    const textureImage = this.texture.image as { data: Uint8Array };
    const data = textureImage.data;
    const offsetsToChild = this.childOffsets;
    data.fill(0, 0, nodes.length * 4);
    offsetsToChild.fill(0, 0, nodes.length);

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      node.visibleNodeTextureOffset = i;

      if (i > 0) {
        const parentOffset = node.parent?.visibleNodeTextureOffset;
        if (parentOffset === undefined) {
          data[i * 4 + 3] = node.name.length;
          continue;
        }

        const parentOffsetToChild = i - parentOffset;

        const previousOffsetToChild = offsetsToChild[parentOffset];
        offsetsToChild[parentOffset] =
          previousOffsetToChild === 0
            ? parentOffsetToChild
            : Math.min(previousOffsetToChild, parentOffsetToChild);

        const offset = parentOffset * 4;
        data[offset] = data[offset] | (1 << node.index);
        data[offset + 1] = offsetsToChild[parentOffset] >> 8;
        data[offset + 2] = offsetsToChild[parentOffset] & 255;
      }

      data[i * 4 + 3] = node.name.length;
    }

    this.texture.needsUpdate = true;
  }

  private ensureCapacity(numNodes: number): void {
    if (numNodes <= this.textureSize) {
      return;
    }

    const textureSize = ceilPowerOfTwo(numNodes);
    const previousTexture = this.texture;

    this.texture = createVisibleNodesTexture(textureSize);
    this.textureSize = textureSize;
    this.childOffsets = new Uint32Array(textureSize);
    previousTexture.dispose();
  }
}

function createVisibleNodesTexture(size: number): Texture {
  const texture = generateDataTexture(size, 1, new Color(0xffffff));
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;

  return texture;
}

function ceilPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(value));
}
