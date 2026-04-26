import { Box3, Sphere, Vector3 } from "three";
import type { Box3Like, SphereLike, Vec3Like } from "../../core/types";

export function toThreeVector3(vec: Vec3Like, target = new Vector3()): Vector3 {
  return target.set(vec.x, vec.y, vec.z);
}

export function toThreeBox3(box: Box3Like, target = new Box3()): Box3 {
  target.min.set(box.min.x, box.min.y, box.min.z);
  target.max.set(box.max.x, box.max.y, box.max.z);
  return target;
}

export function toThreeSphere(
  sphere: SphereLike,
  target = new Sphere(),
): Sphere {
  target.center.set(sphere.center.x, sphere.center.y, sphere.center.z);
  target.radius = sphere.radius;
  return target;
}
