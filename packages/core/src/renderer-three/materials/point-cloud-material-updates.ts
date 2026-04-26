import type { Plane } from "three";
import type { IClipBox, IClipSphere } from "./clipping";
import type { IClassification } from "./types";

export function cloneClassification(
  classification: IClassification,
): IClassification {
  const copy: IClassification = {} as IClassification;

  for (const key of Object.keys(classification)) {
    copy[key] = classification[key].clone();
  }

  return copy;
}

export function classificationsEqual(
  left: IClassification | undefined,
  right: IClassification,
): boolean {
  if (left === undefined) {
    return false;
  }

  if (Object.keys(left).length !== Object.keys(right).length) {
    return false;
  }

  for (const key of Object.keys(right)) {
    if (left[key] === undefined || !right[key].equals(left[key])) {
      return false;
    }
  }

  return true;
}

export function buildClipBoxesArray(
  clipBoxes: IClipBox[],
  clipBoxCount: number,
): Float32Array {
  const clipBoxesLength = clipBoxCount * 16;
  const clipBoxesArray = new Float32Array(clipBoxesLength);

  for (let index = 0; index < clipBoxCount; index++) {
    clipBoxesArray.set(clipBoxes[index].inverse.elements, 16 * index);
  }

  for (let index = 0; index < clipBoxesLength; index++) {
    if (Number.isNaN(clipBoxesArray[index])) {
      clipBoxesArray[index] = Infinity;
    }
  }

  return clipBoxesArray;
}

export function buildClipSpheresArray(
  clipSpheres: IClipSphere[],
  clipSphereCount: number,
): Float32Array {
  const clipSpheresLength = clipSphereCount * 4;
  const clipSpheresArray = new Float32Array(clipSpheresLength);

  for (let index = 0; index < clipSphereCount; index++) {
    clipSpheresArray[index * 4 + 0] = clipSpheres[index].center.x;
    clipSpheresArray[index * 4 + 1] = clipSpheres[index].center.y;
    clipSpheresArray[index * 4 + 2] = clipSpheres[index].center.z;
    clipSpheresArray[index * 4 + 3] = clipSpheres[index].radius;
  }

  return clipSpheresArray;
}

export function buildClipPlanesArray(planes: readonly Plane[]): Float32Array {
  const clipPlanesArray = new Float32Array(planes.length * 4);

  for (let index = 0; index < planes.length; index++) {
    clipPlanesArray[index * 4 + 0] = planes[index].normal.x;
    clipPlanesArray[index * 4 + 1] = planes[index].normal.y;
    clipPlanesArray[index * 4 + 2] = planes[index].normal.z;
    clipPlanesArray[index * 4 + 3] = planes[index].constant;
  }

  return clipPlanesArray;
}
