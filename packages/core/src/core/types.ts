import type { Box3, Sphere } from "three";

export interface IPointCloudTreeNode {
  id: number;
  name: string;
  level: number;
  index: number;
  spacing: number;
  boundingBox: Box3;
  boundingSphere: Sphere;
  loaded: boolean;
  numPoints: number;
  readonly isGeometryNode: boolean;
  readonly isTreeNode: boolean;
  readonly children: ReadonlyArray<IPointCloudTreeNode | null>;
  readonly isLeafNode: boolean;

  dispose(): void;

  traverse(
    cb: (node: IPointCloudTreeNode) => void,
    includeSelf?: boolean,
  ): void;
}

export interface IPointCloudGeometryNode extends IPointCloudTreeNode {
  readonly isGeometryNode: true;
  readonly isTreeNode: false;
  failed?: boolean;
}

export interface IPointCloudRenderedNode<
  TGeometryNode extends IPointCloudGeometryNode = IPointCloudGeometryNode,
> extends IPointCloudTreeNode {
  readonly isGeometryNode: false;
  readonly isTreeNode: true;
  geometryNode: TGeometryNode;
  parent: IPointCloudRenderedNode<TGeometryNode> | null;
}

export interface IVisibilityUpdateResult {
  visibleNodes: IPointCloudTreeNode[];
  numVisiblePoints: number;
  densityCulledNodes: number;
  densityCulledPoints: number;
  exceededMaxLoadsToGPU: boolean;
  nodeLoadFailed: boolean;
  nodeLoadPromises: Promise<void>[];
}

export interface PointCloudHit {
  pIndex: number;
  pcIndex: number;
}
