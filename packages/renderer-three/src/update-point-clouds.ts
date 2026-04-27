import type { IPotree } from "potree-core";
import type { IVisibilityUpdateResult } from "potree-core/core";
import type { Camera, WebGLRenderer } from "three";
import { ThreePointCloudVisibilityAdapter } from "./adapters/point-cloud-visibility-adapter";
import { createThreePointCloudVisibilityScheduler } from "./create-three-point-cloud-visibility-scheduler";
import type { ThreePointCloudVisibilityTarget } from "./types";

const visibilityAdapter = new ThreePointCloudVisibilityAdapter();
type VisibilitySchedulerOwner = IPotree & object;

const visibilitySchedulers = new WeakMap<
  VisibilitySchedulerOwner,
  ReturnType<typeof createThreePointCloudVisibilityScheduler>
>();

function getVisibilityScheduler(potree: VisibilitySchedulerOwner) {
  let scheduler = visibilitySchedulers.get(potree);
  if (scheduler === undefined) {
    scheduler = createThreePointCloudVisibilityScheduler(potree.lru);
    visibilitySchedulers.set(potree, scheduler);
  }

  scheduler.setPointBudget(potree.pointBudget);
  scheduler.maxNumNodesLoading = potree.maxNumNodesLoading;
  scheduler.maxLoadsToGPU = potree.maxLoadsToGPU;

  return scheduler;
}

export function updatePointClouds(
  potree: VisibilitySchedulerOwner,
  pointClouds: ThreePointCloudVisibilityTarget[],
  camera: Camera,
  renderer: WebGLRenderer,
): IVisibilityUpdateResult {
  const result = getVisibilityScheduler(potree).updatePointCloudVisibility(
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
