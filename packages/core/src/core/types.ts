export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface Box3Like {
  min: Vec3Like;
  max: Vec3Like;
}

export interface SphereLike {
  center: Vec3Like;
  radius: number;
}

export interface IPointCloudTreeNode {
  id: number;
  name: string;
  level: number;
  index: number;
  spacing: number;
  boundingBox: Box3Like;
  boundingSphere: SphereLike;
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
