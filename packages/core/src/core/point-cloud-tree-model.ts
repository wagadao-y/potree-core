import type { IPointCloudTreeNode } from "./types";

export class PointCloudTreeModel {
  public root: IPointCloudTreeNode | null = null;

  public initialized(): boolean {
    return this.root !== null;
  }
}
