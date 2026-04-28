import { describe, expect, it } from "vitest";

import { collectVisibleRunCandidates } from "./point-cloud-visible-run";

type TestNode = {
  id: string;
  byteOffset?: bigint;
  byteSize?: bigint;
};

function createNode(
  id: string,
  byteOffset: bigint,
  byteSize: bigint,
): TestNode {
  return {
    id,
    byteOffset,
    byteSize,
  };
}

describe("collectVisibleRunCandidates", () => {
  it("returns selected nodes first, then the rest of the contiguous run", () => {
    const nodeA = createNode("a", BigInt(0), BigInt(4));
    const nodeB = createNode("b", BigInt(4), BigInt(4));
    const nodeC = createNode("c", BigInt(8), BigInt(4));

    const result = collectVisibleRunCandidates([nodeB], [nodeA, nodeB, nodeC]);

    expect(result).toEqual([nodeB, nodeA, nodeC]);
  });

  it("trims oversized runs down to the selected span when that span stays within the limit", () => {
    const mib = BigInt(1024 * 1024);
    const nodeA = createNode("a", BigInt(0), mib);
    const nodeB = createNode("b", mib, mib);
    const nodeC = createNode("c", mib * BigInt(2), mib);

    const result = collectVisibleRunCandidates(
      [nodeB, nodeC],
      [nodeA, nodeB, nodeC],
    );

    expect(result).toEqual([nodeB, nodeC]);
  });
});
