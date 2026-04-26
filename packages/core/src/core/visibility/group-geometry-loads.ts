import { collectVisibleRunCandidates } from "../point-cloud-visible-run";

type BatchLoadableLoader<TGeometryNode> = {
  loadBatchWithCandidates?: (
    nodes: TGeometryNode[],
    candidates: TGeometryNode[],
  ) => Promise<void>;
};

type GroupLoadableGeometryNode<TGeometryNode> = {
  load(): Promise<void>;
  octreeGeometry?: {
    loader?: BatchLoadableLoader<TGeometryNode>;
  };
};

export function groupGeometryLoads<
  TGeometryNode extends GroupLoadableGeometryNode<TGeometryNode> & {
    byteOffset?: bigint;
    byteSize?: bigint;
  },
>(nodes: TGeometryNode[], candidates: TGeometryNode[]): Promise<void>[] {
  const nodeLoadPromises: Promise<void>[] = [];
  const nodesByLoader = new Map<
    BatchLoadableLoader<TGeometryNode>,
    TGeometryNode[]
  >();
  const candidatesByLoader = new Map<
    BatchLoadableLoader<TGeometryNode>,
    TGeometryNode[]
  >();

  for (const candidate of candidates) {
    const loader = candidate.octreeGeometry?.loader;

    if (loader?.loadBatchWithCandidates === undefined) {
      continue;
    }

    const batch = candidatesByLoader.get(loader);
    if (batch === undefined) {
      candidatesByLoader.set(loader, [candidate]);
    } else {
      batch.push(candidate);
    }
  }

  for (const node of nodes) {
    const loader = node.octreeGeometry?.loader;

    if (loader?.loadBatchWithCandidates === undefined) {
      nodeLoadPromises.push(node.load());
      continue;
    }

    const batch = nodesByLoader.get(loader);
    if (batch === undefined) {
      nodesByLoader.set(loader, [node]);
    } else {
      batch.push(node);
    }
  }

  for (const [loader, batch] of nodesByLoader) {
    if (loader.loadBatchWithCandidates === undefined) {
      continue;
    }

    const runCandidates = collectVisibleRunCandidates(
      batch,
      candidatesByLoader.get(loader) ?? batch,
    );

    nodeLoadPromises.push(
      loader.loadBatchWithCandidates(runCandidates, runCandidates),
    );
  }

  return nodeLoadPromises;
}
