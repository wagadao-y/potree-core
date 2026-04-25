import { Box3, type Matrix4, Vector3 } from "three";

/**
 * Computes the transformed bounding box of a given Box3 using a transformation matrix.
 *
 * @param box - The original bounding box to transform.
 * @param transform - The transformation matrix to apply.
 * @returns A new Box3 that represents the transformed bounding box.
 */
export function computeTransformedBoundingBox(
  box: Box3,
  transform: Matrix4,
): Box3 {
  return new Box3().setFromPoints([
    new Vector3(box.min.x, box.min.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.min.x, box.min.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.max.x, box.min.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.min.x, box.max.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.min.x, box.min.y, box.max.z).applyMatrix4(transform),
    new Vector3(box.min.x, box.max.y, box.max.z).applyMatrix4(transform),
    new Vector3(box.max.x, box.max.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.max.x, box.min.y, box.max.z).applyMatrix4(transform),
    new Vector3(box.max.x, box.max.y, box.max.z).applyMatrix4(transform),
  ]);
}
