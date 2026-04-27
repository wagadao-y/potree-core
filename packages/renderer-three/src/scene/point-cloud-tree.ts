import type { IPointCloudTreeNode } from "potree-core";
import type {
  IPointCloudGeometryNode,
  IPointCloudRenderedNode,
} from "potree-core/core";
import { PointCloudTreeModel } from "potree-core/core";
import { Object3D } from "three";

/**
 * Represents a point cloud tree structure backed by a THREE.Object3D.
 */
export class PointCloudTree<
  TGeometryNode extends IPointCloudGeometryNode = IPointCloudGeometryNode,
  TRenderedNode extends
    IPointCloudRenderedNode<TGeometryNode> = IPointCloudRenderedNode<TGeometryNode>,
> extends Object3D {
  public readonly treeModel: PointCloudTreeModel<TGeometryNode, TRenderedNode>;

  public constructor(
    treeModel: PointCloudTreeModel<
      TGeometryNode,
      TRenderedNode
    > = new PointCloudTreeModel<TGeometryNode, TRenderedNode>(),
  ) {
    super();
    this.treeModel = treeModel;
  }

  public get root(): IPointCloudTreeNode | null {
    return this.treeModel.root;
  }

  public set root(root: IPointCloudTreeNode | null) {
    this.treeModel.root = root;
  }

  public initialized() {
    return this.treeModel.initialized();
  }
}
