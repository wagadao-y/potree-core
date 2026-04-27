import type { Camera, WebGLRenderer } from "three";
import type { IVisibilityUpdateResult } from "../core/types";
import type { Potree } from "../potree";
import { ThreePointCloudVisibilityAdapter } from "./adapters/point-cloud-visibility-adapter";
import type { ThreePointCloudVisibilityTarget } from "./types";

const visibilityAdapter = new ThreePointCloudVisibilityAdapter();

export function updatePointClouds(
  potree: Potree,
  pointClouds: ThreePointCloudVisibilityTarget[],
  camera: Camera,
  renderer: WebGLRenderer,
): IVisibilityUpdateResult {
  const result = potree.updatePointCloudVisibility(
    pointClouds,
    visibilityAdapter.createVisibilityInput(pointClouds, camera, renderer),
  );

  visibilityAdapter.updatePointCloudsAfterVisibility(
    pointClouds,
    camera,
    renderer,
  );

  return result;
}
