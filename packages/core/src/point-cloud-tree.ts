import { Object3D } from "three";
import { PointCloudTreeModel } from "./core/point-cloud-tree-model";
import type { IPointCloudTreeNode } from "./types";

/**
 * Represents a point cloud tree structure.
 */
export class PointCloudTree extends Object3D {
  public readonly treeModel: PointCloudTreeModel;

  public constructor(treeModel: PointCloudTreeModel = new PointCloudTreeModel()) {
    super();
    this.treeModel = treeModel;
  }

  /**
   * The root node of the point cloud tree.
   */
  public get root(): IPointCloudTreeNode | null {
    return this.treeModel.root;
  }

  public set root(root: IPointCloudTreeNode | null) {
    this.treeModel.root = root;
  }

  /**
   * Checks if the point cloud tree has been initialized.
   *
   * @returns Returns true if the tree has been initialized (i.e., root is not null), false otherwise.
   */
  public initialized() {
    return this.treeModel.initialized();
  }
}
