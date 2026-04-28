import { describe, expect, it, vi } from "vitest";

import { updateVisibilityStructures } from "./visibility-structures";

function createPointCloud(id: number, overrides?: Record<string, unknown>) {
  return {
    root: {
      id,
      name: `r${id}`,
      level: 0,
      index: 0,
      spacing: 1,
      boundingBox: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 1, y: 1, z: 1 },
      },
      boundingSphere: {
        center: { x: 0, y: 0, z: 0 },
        radius: 1,
      },
      loaded: false,
      numPoints: 10,
      isGeometryNode: true,
      isTreeNode: false,
      children: [],
      isLeafNode: true,
      dispose() {},
      traverse() {},
    },
    visible: true,
    minNodePixelSize: 0,
    screenSpaceDensityLODEnabled: false,
    maxPointsPerPixel: Infinity,
    numVisiblePoints: 99,
    visibleNodes: [{ id: id + 100 }],
    visibleGeometry: [{ id: id + 200 }],
    initialized() {
      return true;
    },
    ...overrides,
  };
}

describe("updateVisibilityStructures", () => {
  it("resets initialized point clouds and queues only visible roots with views", () => {
    const callbacks = {
      resetRenderedVisibility: vi.fn(),
    };
    const active = createPointCloud(1);
    const hidden = createPointCloud(2, { visible: false });
    const uninitialized = createPointCloud(3, {
      initialized() {
        return false;
      },
    });

    const { priorityQueue } = updateVisibilityStructures(
      [active, hidden, uninitialized],
      [
        {
          intersectsBox: () => true,
          cameraPosition: { x: 0, y: 0, z: 1 },
        },
        {
          intersectsBox: () => true,
          cameraPosition: { x: 0, y: 0, z: 1 },
        },
        {
          intersectsBox: () => true,
          cameraPosition: { x: 0, y: 0, z: 1 },
        },
      ],
      callbacks,
    );

    expect(callbacks.resetRenderedVisibility).toHaveBeenCalledTimes(2);
    expect(active.numVisiblePoints).toBe(0);
    expect(active.visibleNodes).toEqual([]);
    expect(active.visibleGeometry).toEqual([]);
    expect(hidden.numVisiblePoints).toBe(0);
    expect(hidden.visibleNodes).toEqual([]);
    expect(hidden.visibleGeometry).toEqual([]);
    expect(uninitialized.numVisiblePoints).toBe(99);
    expect(priorityQueue.size()).toBe(1);
    expect(priorityQueue.pop()).toEqual(
      expect.objectContaining({ pointCloudIndex: 0, node: active.root }),
    );
  });
});
