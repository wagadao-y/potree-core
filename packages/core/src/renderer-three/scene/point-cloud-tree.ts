import { Object3D } from "three";
import { PointCloudTreeModel } from "../../core/point-cloud-tree-model";
import type { IPointCloudTreeNode } from "../../types";

/**
 * Represents a point cloud tree structure backed by a THREE.Object3D.
 */
export class PointCloudTree extends Object3D {
  public readonly treeModel: PointCloudTreeModel;

  public constructor(
    treeModel: PointCloudTreeModel = new PointCloudTreeModel(),
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
