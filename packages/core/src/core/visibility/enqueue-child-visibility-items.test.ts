import { describe, expect, it, vi } from "vitest";
import {
  enqueueChildVisibilityItems,
  type VisibilityProjection,
} from "./update-visibility";
import { QueueItem } from "./visibility-structures";

const projection: VisibilityProjection = {
  type: "perspective",
  fovRadians: Math.PI / 4,
};

describe("enqueueChildVisibilityItems", () => {
  it("culls children that exceed the screen-space density threshold", () => {
    const child = {
      id: 2,
      name: "r0",
      level: 1,
      index: 0,
      spacing: 0.5,
      boundingBox: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 1, y: 1, z: 1 },
      },
      boundingSphere: {
        center: { x: 0, y: 0, z: 0 },
        radius: 1,
      },
      loaded: false,
      numPoints: 1_000_000,
      isGeometryNode: true,
      isTreeNode: false,
      children: [],
      isLeafNode: true,
      dispose() {},
      traverse() {},
    };
    const parent = {
      ...child,
      id: 1,
      name: "r",
      level: 0,
      numPoints: 10,
      children: [child],
    };
    const pointCloud = {
      root: parent,
      visible: true,
      minNodePixelSize: 0,
      screenSpaceDensityLODEnabled: true,
      maxPointsPerPixel: 1,
      numVisiblePoints: 0,
      visibleNodes: [],
      visibleGeometry: [],
      initialized() {
        return true;
      },
    };
    const densityLODStats = {
      culledNodes: 0,
      culledPoints: 0,
    };
    const pushQueueItem = vi.fn();

    enqueueChildVisibilityItems(
      new QueueItem(0, Number.MAX_VALUE, parent),
      pointCloud,
      parent,
      { x: 0, y: 0, z: 2 },
      projection,
      100,
      densityLODStats,
      pushQueueItem,
    );

    expect(pushQueueItem).not.toHaveBeenCalled();
    expect(densityLODStats).toEqual({
      culledNodes: 1,
      culledPoints: 1_000_000,
    });
  });
});
