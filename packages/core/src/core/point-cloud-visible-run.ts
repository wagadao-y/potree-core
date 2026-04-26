const MAX_VISIBLE_RUN_BYTES_WITHOUT_TRIMMING = BigInt(2 * 1024 * 1024);
const MAX_VISIBLE_RUN_SELECTED_SPAN_BYTES = BigInt(2 * 1024 * 1024);
const MAX_VISIBLE_RUN_PREFETCH_BYTES = BigInt(512 * 1024);
const MAX_VISIBLE_RUN_PREFETCH_NODES = 8;

type ByteRangedNode = {
  byteOffset: bigint;
  byteSize: bigint;
};

export function collectVisibleRunCandidates<
  TGeometryNode extends { byteOffset?: bigint; byteSize?: bigint },
>(
  selectedNodes: TGeometryNode[],
  candidates: TGeometryNode[],
): TGeometryNode[] {
  const orderedCandidates = candidates.filter(hasByteRange);
  const selectedSet = new Set<(typeof orderedCandidates)[number]>();

  for (const node of selectedNodes) {
    if (hasByteRange(node)) {
      selectedSet.add(node);
    }
  }

  if (orderedCandidates.length === 0 || selectedSet.size === 0) {
    return selectedNodes;
  }

  orderedCandidates.sort((left, right) =>
    left.byteOffset < right.byteOffset
      ? -1
      : left.byteOffset > right.byteOffset
        ? 1
        : 0,
  );

  const selectedOrdered = selectedNodes.filter(hasByteRange);
  const runNodes = new Set<(typeof orderedCandidates)[number]>();
  let run: Array<(typeof orderedCandidates)[number]> = [];
  let runContainsSelected = false;
  let previousEndExclusive: bigint | null = null;

  const flushRun = () => {
    if (!runContainsSelected) {
      run = [];
      runContainsSelected = false;
      previousEndExclusive = null;
      return;
    }

    addBoundedVisibleRunNodes(runNodes, run, selectedSet);

    run = [];
    runContainsSelected = false;
    previousEndExclusive = null;
  };

  for (const candidate of orderedCandidates) {
    const endExclusive = candidate.byteOffset + candidate.byteSize;
    const contiguous =
      previousEndExclusive !== null &&
      candidate.byteOffset === previousEndExclusive;

    if (!contiguous && run.length > 0) {
      flushRun();
    }

    run.push(candidate);
    runContainsSelected ||= selectedSet.has(candidate);
    previousEndExclusive = endExclusive;
  }

  flushRun();

  const orderedRunNodes: TGeometryNode[] = [];
  const appended = new Set<TGeometryNode>();

  for (const node of selectedOrdered) {
    if (!runNodes.has(node) || appended.has(node)) {
      continue;
    }

    orderedRunNodes.push(node);
    appended.add(node);
  }

  for (const node of orderedCandidates) {
    if (!runNodes.has(node) || appended.has(node)) {
      continue;
    }

    orderedRunNodes.push(node);
    appended.add(node);
  }

  return orderedRunNodes;
}

function hasByteRange<
  TGeometryNode extends { byteOffset?: bigint; byteSize?: bigint },
>(node: TGeometryNode): node is TGeometryNode & ByteRangedNode {
  return node.byteOffset !== undefined && node.byteSize !== undefined;
}

function addBoundedVisibleRunNodes<
  TGeometryNode extends { byteOffset: bigint; byteSize: bigint },
>(
  runNodes: Set<TGeometryNode>,
  run: TGeometryNode[],
  selectedSet: Set<TGeometryNode>,
) {
  const runByteSize = getRunByteSize(run);
  if (runByteSize <= MAX_VISIBLE_RUN_BYTES_WITHOUT_TRIMMING) {
    for (const node of run) {
      runNodes.add(node);
    }
    return;
  }

  const selectedIndices = run.flatMap((node, index) =>
    selectedSet.has(node) ? [index] : [],
  );
  const selectedNodes = selectedIndices.map((index) => run[index]);
  if (selectedNodes.length === 0) {
    return;
  }

  const selectedSpanStart = selectedIndices[0];
  const selectedSpanEnd = selectedIndices[selectedIndices.length - 1];
  const selectedSpanByteSize = getRunByteSize(
    run.slice(selectedSpanStart, selectedSpanEnd + 1),
  );

  if (selectedSpanByteSize <= MAX_VISIBLE_RUN_SELECTED_SPAN_BYTES) {
    for (let index = selectedSpanStart; index <= selectedSpanEnd; index++) {
      runNodes.add(run[index]);
    }
    return;
  }

  for (const node of selectedNodes) {
    runNodes.add(node);
  }

  let prefetchBytes = BigInt(0);
  let prefetchNodes = 0;
  const prefetchCandidates = run
    .filter((node) => !selectedSet.has(node))
    .map((node) => ({
      node,
      distanceFromSelected: getByteDistanceFromClosestSelected(
        node,
        selectedNodes,
      ),
    }))
    .sort((left, right) => {
      if (left.distanceFromSelected !== right.distanceFromSelected) {
        return left.distanceFromSelected < right.distanceFromSelected ? -1 : 1;
      }

      return left.node.byteOffset < right.node.byteOffset ? -1 : 1;
    });

  for (const { node } of prefetchCandidates) {
    if (
      prefetchNodes >= MAX_VISIBLE_RUN_PREFETCH_NODES ||
      prefetchBytes + node.byteSize > MAX_VISIBLE_RUN_PREFETCH_BYTES
    ) {
      continue;
    }

    runNodes.add(node);
    prefetchBytes += node.byteSize;
    prefetchNodes++;
  }
}

function getByteDistanceFromClosestSelected<
  TGeometryNode extends { byteOffset: bigint; byteSize: bigint },
>(node: TGeometryNode, selectedNodes: TGeometryNode[]) {
  const start = node.byteOffset;
  const endExclusive = start + node.byteSize;
  let closestDistance: bigint | null = null;

  for (const selectedNode of selectedNodes) {
    const selectedStart = selectedNode.byteOffset;
    const selectedEndExclusive = selectedStart + selectedNode.byteSize;
    let distance: bigint;

    if (endExclusive <= selectedStart) {
      distance = selectedStart - endExclusive;
    } else if (start >= selectedEndExclusive) {
      distance = start - selectedEndExclusive;
    } else {
      distance = BigInt(0);
    }

    if (closestDistance === null || distance < closestDistance) {
      closestDistance = distance;
    }
  }

  return closestDistance ?? BigInt(0);
}

function getRunByteSize<
  TGeometryNode extends { byteOffset: bigint; byteSize: bigint },
>(run: TGeometryNode[]) {
  if (run.length === 0) {
    return BigInt(0);
  }

  const firstNode = run[0];
  const lastNode = run[run.length - 1];
  return lastNode.byteOffset + lastNode.byteSize - firstNode.byteOffset;
}
