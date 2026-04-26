import {
  Box3,
  type Camera,
  Frustum,
  Matrix4,
  type OrthographicCamera,
  type PerspectiveCamera,
  Vector3,
} from "three";
import type { Box3Like } from "../../core/types";
import type { VisibilityProjection } from "../../core/visibility/update-visibility";
import type { PointCloudVisibilityView } from "../../core/visibility/visibility-structures";
import type { PointCloudOctree } from "../../point-cloud-octree";
import { toThreeBox3 } from "../math/box3-like";

export function createPointCloudVisibilityViews(
  pointClouds: PointCloudOctree[],
  camera: Camera,
): (PointCloudVisibilityView | undefined)[] {
  const frustumMatrix = new Matrix4();
  const inverseWorldMatrix = new Matrix4();
  const cameraMatrix = new Matrix4();

  const views: (PointCloudVisibilityView | undefined)[] = new Array(
    pointClouds.length,
  );

  camera.updateMatrixWorld(false);

  for (let i = 0; i < pointClouds.length; i++) {
    const pointCloud = pointClouds[i];

    if (!pointCloud.initialized()) {
      continue;
    }

    const inverseViewMatrix = camera.matrixWorldInverse;
    const worldMatrix = pointCloud.matrixWorld;
    frustumMatrix
      .identity()
      .multiply(camera.projectionMatrix)
      .multiply(inverseViewMatrix)
      .multiply(worldMatrix);

    inverseWorldMatrix.copy(worldMatrix).invert();
    cameraMatrix
      .identity()
      .multiply(inverseWorldMatrix)
      .multiply(camera.matrixWorld);

    const frustum = new Frustum().setFromProjectionMatrix(frustumMatrix);
    const tempBox = new Box3();
    views[i] = {
      intersectsBox: (box: Box3Like) =>
        frustum.intersectsBox(toThreeBox3(box, tempBox)),
      cameraPosition: new Vector3().setFromMatrixPosition(cameraMatrix),
    };
  }

  return views;
}

export function createVisibilityProjection(
  camera: Camera,
): VisibilityProjection {
  const perspective = camera as PerspectiveCamera;
  if (perspective.isPerspectiveCamera === true) {
    return {
      type: "perspective",
      fovRadians: perspective.fov * (Math.PI / 180),
    };
  }

  const orthographic = camera as OrthographicCamera;
  return {
    type: "orthographic",
    verticalSpan: orthographic.top - orthographic.bottom,
    zoom: orthographic.zoom,
  };
}
