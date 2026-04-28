import { describe, expect, it, vi } from "vitest";

import { groupGeometryLoads } from "./group-geometry-loads";

type TestLoader = {
  loadBatchWithCandidates?: (
    nodes: TestNode[],
    candidates: TestNode[],
  ) => Promise<void>;
};

type TestNode = {
  id: string;
  byteOffset?: bigint;
  byteSize?: bigint;
  load: () => Promise<void>;
  octreeGeometry?: {
    loader?: TestLoader;
  };
};

function createNode(
  id: string,
  options?: {
    byteOffset?: bigint;
    byteSize?: bigint;
    loader?: TestLoader;
    load?: () => Promise<void>;
  },
): TestNode {
  return {
    id,
    byteOffset: options?.byteOffset,
    byteSize: options?.byteSize,
    load: options?.load ?? vi.fn().mockResolvedValue(undefined),
    octreeGeometry:
      options?.loader === undefined
        ? undefined
        : {
            loader: options.loader,
          },
  };
}

describe("groupGeometryLoads", () => {
  it("batches nodes by loader and passes visible run candidates", async () => {
    const loadBatchWithCandidates = vi.fn().mockResolvedValue(undefined);
    const loader: TestLoader = {
      loadBatchWithCandidates,
    };
    const nodeA = createNode("a", {
      byteOffset: BigInt(0),
      byteSize: BigInt(4),
      loader,
    });
    const nodeB = createNode("b", {
      byteOffset: BigInt(4),
      byteSize: BigInt(4),
      loader,
    });
    const nodeC = createNode("c", {
      byteOffset: BigInt(8),
      byteSize: BigInt(4),
      loader,
    });

    const promises = groupGeometryLoads([nodeB], [nodeA, nodeB, nodeC]);

    expect(promises).toHaveLength(1);
    await Promise.all(promises);

    expect(loadBatchWithCandidates).toHaveBeenCalledWith(
      [nodeB, nodeA, nodeC],
      [nodeB, nodeA, nodeC],
    );
  });

  it("falls back to node.load when batch loading is unavailable", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const node = createNode("solo", {
      load,
    });

    const promises = groupGeometryLoads([node], [node]);

    expect(promises).toHaveLength(1);
    await Promise.all(promises);

    expect(load).toHaveBeenCalledTimes(1);
  });
});
