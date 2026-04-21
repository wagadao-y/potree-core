import type { PointCloudOctreeGeometryNode } from "./point-cloud-octree-geometry-node";

/**
 * Checks if the given node is a geometry node.
 *
 * @param node - Node to check.
 * @returns True if the node is a geometry node, false otherwise.
 */
export function isGeometryNode(
  node?: any,
): node is PointCloudOctreeGeometryNode {
  return node?.isGeometryNode;
}

/**
 * Checks if the given node is a tree node.
 *
 * @param node - Node to check.
 * @returns True if the node is a tree node, false otherwise.
 */
export function isTreeNode(node?: any) {
  return node?.isTreeNode;
}
