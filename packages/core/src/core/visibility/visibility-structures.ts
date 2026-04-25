import {
  type Camera,
  Frustum,
  Matrix4,
  Vector3,
} from "three";
import { PointCloudOctree } from "../../point-cloud-octree";
import type { IPointCloudTreeNode } from "../types";
import { BinaryHeap } from "../../utils/binary-heap";

export class QueueItem {
  public constructor(
    public pointCloudIndex: number,
    public weight: number,
    public node: IPointCloudTreeNode,
    public parent?: IPointCloudTreeNode | null,
  ) {}
}

export interface VisibilityStructures {
  frustums: Frustum[];
  cameraPositions: Vector3[];
  priorityQueue: BinaryHeap<QueueItem>;
}

export function updateVisibilityStructures(
  pointClouds: PointCloudOctree[],
  camera: Camera,
): VisibilityStructures {
  const frustumMatrix = new Matrix4();
  const inverseWorldMatrix = new Matrix4();
  const cameraMatrix = new Matrix4();

  const frustums: Frustum[] = [];
  const cameraPositions: Vector3[] = [];
  const priorityQueue = new BinaryHeap<QueueItem>((x) => {
    return 1 / x.weight;
  });

  for (let i = 0; i < pointClouds.length; i++) {
    const pointCloud = pointClouds[i];

    if (!pointCloud.initialized()) {
      continue;
    }

    pointCloud.numVisiblePoints = 0;
    hideVisibleNodes(pointCloud);

    pointCloud.visibleNodes.length = 0;
    pointCloud.visibleGeometry.length = 0;

    camera.updateMatrixWorld(false);

    const inverseViewMatrix = camera.matrixWorldInverse;
    const worldMatrix = pointCloud.matrixWorld;
    frustumMatrix
      .identity()
      .multiply(camera.projectionMatrix)
      .multiply(inverseViewMatrix)
      .multiply(worldMatrix);
    frustums.push(new Frustum().setFromProjectionMatrix(frustumMatrix));

    inverseWorldMatrix.copy(worldMatrix).invert();
    cameraMatrix
      .identity()
      .multiply(inverseWorldMatrix)
      .multiply(camera.matrixWorld);
    cameraPositions.push(new Vector3().setFromMatrixPosition(cameraMatrix));

    if (pointCloud.visible && pointCloud.root !== null) {
      priorityQueue.push(new QueueItem(i, Number.MAX_VALUE, pointCloud.root));
    }

    for (const boundingBoxNode of pointCloud.boundingBoxNodes) {
      boundingBoxNode.visible = false;
    }
  }

  return {
    frustums,
    cameraPositions,
    priorityQueue,
  };
}

function hideVisibleNodes(pointCloud: PointCloudOctree): void {
  const visibleNodes = pointCloud.visibleNodes;

  for (let i = 0; i < visibleNodes.length; i++) {
    visibleNodes[i].sceneNode.visible = false;
  }
}