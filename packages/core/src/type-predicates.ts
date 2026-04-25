import type { IPointCloudGeometryNode } from "./core/types";
import type { PointCloudOctreeNode } from "./point-cloud-octree-node";

/**
 * Checks if the given node is a geometry node.
 *
 * @param node - Node to check.
 * @returns True if the node is a geometry node, false otherwise.
 */
export function isGeometryNode(
  node?: any,
): node is IPointCloudGeometryNode {
  return node?.isGeometryNode;
}

/**
 * Checks if the given node is a tree node.
 *
 * @param node - Node to check.
 * @returns True if the node is a tree node, false otherwise.
 */
export function isTreeNode(node?: any): node is PointCloudOctreeNode {
  return node?.isTreeNode;
}
