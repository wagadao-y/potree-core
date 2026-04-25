import { BinaryHeap } from "../../utils/binary-heap";
import type {
  Box3Like,
  IPointCloudGeometryNode,
  IPointCloudRenderedNode,
  IPointCloudTreeNode,
  IPointCloudVisibilityTarget,
  Vec3Like,
} from "../types";

export class QueueItem {
  public constructor(
    public pointCloudIndex: number,
    public weight: number,
    public node: IPointCloudTreeNode,
    public parent?: IPointCloudTreeNode | null,
  ) {}
}

export interface PointCloudVisibilityView {
  intersectsBox: (box: Box3Like) => boolean;
  cameraPosition: Vec3Like;
}

export type VisibilityPointCloudTarget<
  TGeometryNode extends IPointCloudGeometryNode = IPointCloudGeometryNode,
  TRenderedNode extends
    IPointCloudRenderedNode<TGeometryNode> = IPointCloudRenderedNode<TGeometryNode>,
> = IPointCloudVisibilityTarget<TGeometryNode, TRenderedNode>;

export interface VisibilityStructureCallbacks<TPointCloud> {
  resetRenderedVisibility: (pointCloud: TPointCloud) => void;
}

export interface VisibilityStructures {
  views: (PointCloudVisibilityView | undefined)[];
  priorityQueue: BinaryHeap<QueueItem>;
}

export function updateVisibilityStructures<
  TPointCloud extends VisibilityPointCloudTarget,
>(
  pointClouds: TPointCloud[],
  views: (PointCloudVisibilityView | undefined)[],
  callbacks: VisibilityStructureCallbacks<TPointCloud>,
): VisibilityStructures {
  const priorityQueue = new BinaryHeap<QueueItem>((x) => {
    return 1 / x.weight;
  });

  for (let i = 0; i < pointClouds.length; i++) {
    const pointCloud = pointClouds[i];

    if (!pointCloud.initialized()) {
      continue;
    }

    pointCloud.numVisiblePoints = 0;
    callbacks.resetRenderedVisibility(pointCloud);

    pointCloud.visibleNodes.length = 0;
    pointCloud.visibleGeometry.length = 0;

    if (pointCloud.visible && pointCloud.root !== null && views[i]) {
      priorityQueue.push(new QueueItem(i, Number.MAX_VALUE, pointCloud.root));
    }
  }

  return {
    views,
    priorityQueue,
  };
}
