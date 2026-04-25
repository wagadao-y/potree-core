import type { Box3Like, SphereLike, Vec3Like } from "./types";

export function createVec3(x = 0, y = 0, z = 0): Vec3Like {
  return { x, y, z };
}

export function cloneVec3(vec: Vec3Like): Vec3Like {
  return { x: vec.x, y: vec.y, z: vec.z };
}

export function addVec3(a: Vec3Like, b: Vec3Like): Vec3Like {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtractVec3(a: Vec3Like, b: Vec3Like): Vec3Like {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function createBox3(min: Vec3Like, max: Vec3Like): Box3Like {
  return { min: cloneVec3(min), max: cloneVec3(max) };
}

export function cloneBox3(box: Box3Like): Box3Like {
  return createBox3(box.min, box.max);
}

export function getBox3Size(box: Box3Like): Vec3Like {
  return {
    x: box.max.x - box.min.x,
    y: box.max.y - box.min.y,
    z: box.max.z - box.min.z,
  };
}

export function getBox3Center(box: Box3Like): Vec3Like {
  return {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
}

export function getBoundingSphereForBox3(box: Box3Like): SphereLike {
  const center = getBox3Center(box);
  const dx = box.max.x - center.x;
  const dy = box.max.y - center.y;
  const dz = box.max.z - center.z;

  return {
    center,
    radius: Math.sqrt(dx * dx + dy * dy + dz * dz),
  };
}

export function createChildBox3(box: Box3Like, index: number): Box3Like {
  const min = cloneVec3(box.min);
  const max = cloneVec3(box.max);
  const size = getBox3Size(box);

  if ((index & 0b0001) > 0) {
    min.z += size.z / 2;
  } else {
    max.z -= size.z / 2;
  }

  if ((index & 0b0010) > 0) {
    min.y += size.y / 2;
  } else {
    max.y -= size.y / 2;
  }

  if ((index & 0b0100) > 0) {
    min.x += size.x / 2;
  } else {
    max.x -= size.x / 2;
  }

  return { min, max };
}
