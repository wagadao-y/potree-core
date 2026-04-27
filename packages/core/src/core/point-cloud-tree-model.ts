import { DEFAULT_MIN_NODE_PIXEL_SIZE } from "./constants";
import type {
  IPointCloudGeometryNode,
  IPointCloudRenderedNode,
  IPointCloudTreeNode,
} from "./types";

export class PointCloudTreeModel<
  TGeometryNode extends IPointCloudGeometryNode = IPointCloudGeometryNode,
  TRenderedNode extends
    IPointCloudRenderedNode<TGeometryNode> = IPointCloudRenderedNode<TGeometryNode>,
> {
  public root: IPointCloudTreeNode | null = null;

  public maxLevel: number = Infinity;

  public minNodePixelSize: number = DEFAULT_MIN_NODE_PIXEL_SIZE;

  public screenSpaceDensityLODEnabled: boolean = false;

  public maxPointsPerPixel: number = 1;

  public visibleNodes: TRenderedNode[] = [];

  public visibleGeometry: TGeometryNode[] = [];

  public numVisiblePoints: number = 0;

  public initialized(): boolean {
    return this.root !== null;
  }
}
