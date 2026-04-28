import { describe, expect, it, vi } from "vitest";

import type {
  Box3Like,
  IPointCloudGeometryNode,
  IPointCloudRenderedNode,
  Vec3Like,
} from "../types";
import {
  updateVisibility,
  type VisibilityProjection,
} from "./update-visibility";

type TestGeometryNode = IPointCloudGeometryNode & {
  failed?: boolean;
};

type TestRenderedNode = IPointCloudRenderedNode<TestGeometryNode>;

type TestPointCloud = {
  root: TestGeometryNode | null;
  visible: boolean;
  maxLevel?: number;
  minNodePixelSize: number;
  screenSpaceDensityLODEnabled: boolean;
  maxPointsPerPixel: number;
  numVisiblePoints: number;
  visibleNodes: TestRenderedNode[];
  visibleGeometry: TestGeometryNode[];
  initialized(): boolean;
};

const box: Box3Like = {
  min: { x: 0, y: 0, z: 0 },
  max: { x: 1, y: 1, z: 1 },
};

const cameraPosition: Vec3Like = { x: 0, y: 0, z: 10 };
const projection: VisibilityProjection = {
  type: "perspective",
  fovRadians: Math.PI / 4,
};

function createGeometryNode(
  overrides?: Partial<TestGeometryNode>,
): TestGeometryNode {
  return {
    id: 1,
    name: "r",
    level: 0,
    index: 0,
    spacing: 1,
    boundingBox: box,
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
    ...overrides,
  };
}

function createPointCloud(root: TestGeometryNode): TestPointCloud {
  return {
    root,
    visible: true,
    minNodePixelSize: 0,
    screenSpaceDensityLODEnabled: false,
    maxPointsPerPixel: Infinity,
    numVisiblePoints: 123,
    visibleNodes: [],
    visibleGeometry: [],
    initialized() {
      return true;
    },
  };
}

function createRenderedNode(
  geometryNode: TestGeometryNode,
  overrides?: Partial<TestRenderedNode>,
): TestRenderedNode {
  return {
    id: geometryNode.id + 100,
    name: `${geometryNode.name}-rendered`,
    level: geometryNode.level,
    index: geometryNode.index,
    spacing: geometryNode.spacing,
    boundingBox: geometryNode.boundingBox,
    boundingSphere: geometryNode.boundingSphere,
    loaded: true,
    numPoints: geometryNode.numPoints,
    isGeometryNode: false,
    isTreeNode: true,
    children: [],
    isLeafNode: geometryNode.isLeafNode,
    geometryNode,
    parent: null,
    dispose() {},
    traverse() {},
    ...overrides,
  };
}

function createCallbacks() {
  return {
    resetRenderedVisibility: vi.fn(),
    prepareClipVisibilityContexts: vi.fn().mockReturnValue([undefined]),
    shouldClip: vi.fn().mockReturnValue(false),
    updateTreeNodeVisibility: vi.fn(),
    materializeLoadedGeometryNode: vi.fn(),
    updateChildVisibility: vi.fn(),
    loadGeometryNodes: vi.fn().mockReturnValue([]),
  };
}

describe("updateVisibility", () => {
  it("stops before processing nodes that exceed the point budget", () => {
    const root = createGeometryNode({ numPoints: 10, loaded: false });
    const pointCloud = createPointCloud(root);
    const callbacks = createCallbacks();

    const result = updateVisibility({
      pointClouds: [pointCloud],
      views: [
        {
          intersectsBox: () => true,
          cameraPosition,
        },
      ],
      projection,
      viewport: {
        height: 100,
        pixelRatio: 1,
      },
      pointBudget: 5,
      maxNumNodesLoading: 4,
      maxLoadsToGPU: 1,
      callbacks,
    });

    expect(result.numVisiblePoints).toBe(0);
    expect(result.visibleNodes).toEqual([]);
    expect(pointCloud.visibleGeometry).toEqual([]);
    expect(callbacks.loadGeometryNodes).toHaveBeenCalledWith([], []);
  });

  it("flags exceededMaxLoadsToGPU and queues loaded geometry for later loading", () => {
    const root = createGeometryNode({ numPoints: 10, loaded: true });
    const pointCloud = createPointCloud(root);
    const callbacks = createCallbacks();

    const result = updateVisibility({
      pointClouds: [pointCloud],
      views: [
        {
          intersectsBox: () => true,
          cameraPosition,
        },
      ],
      projection,
      viewport: {
        height: 100,
        pixelRatio: 1,
      },
      pointBudget: 100,
      maxNumNodesLoading: 4,
      maxLoadsToGPU: 0,
      callbacks,
    });

    expect(result.exceededMaxLoadsToGPU).toBe(true);
    expect(result.numVisiblePoints).toBe(10);
    expect(pointCloud.visibleGeometry).toEqual([root]);
    expect(callbacks.materializeLoadedGeometryNode).not.toHaveBeenCalled();
    expect(callbacks.loadGeometryNodes).toHaveBeenCalledWith([root], [root]);
  });

  it("flags failed geometry nodes without enqueueing them for load", () => {
    const root = createGeometryNode({
      numPoints: 10,
      loaded: false,
      failed: true,
    });
    const pointCloud = createPointCloud(root);
    const callbacks = createCallbacks();

    const result = updateVisibility({
      pointClouds: [pointCloud],
      views: [
        {
          intersectsBox: () => true,
          cameraPosition,
        },
      ],
      projection,
      viewport: {
        height: 100,
        pixelRatio: 1,
      },
      pointBudget: 100,
      maxNumNodesLoading: 4,
      maxLoadsToGPU: 1,
      callbacks,
    });

    expect(result.nodeLoadFailed).toBe(true);
    expect(result.visibleNodes).toEqual([]);
    expect(pointCloud.visibleGeometry).toEqual([]);
    expect(callbacks.loadGeometryNodes).toHaveBeenCalledWith([], []);
  });

  it("materializes loaded geometry nodes and forwards the rendered node to child visibility updates", () => {
    const root = createGeometryNode({ numPoints: 10, loaded: true });
    const pointCloud = createPointCloud(root);
    const callbacks = createCallbacks();
    const renderedNode = createRenderedNode(root);
    callbacks.materializeLoadedGeometryNode.mockReturnValue(renderedNode);
    callbacks.updateTreeNodeVisibility.mockImplementation(
      (_pointCloud, node, visibleNodes) => {
        visibleNodes.push(node);
      },
    );

    const result = updateVisibility({
      pointClouds: [pointCloud],
      views: [
        {
          intersectsBox: () => true,
          cameraPosition,
        },
      ],
      projection,
      viewport: {
        height: 100,
        pixelRatio: 1,
      },
      pointBudget: 100,
      maxNumNodesLoading: 4,
      maxLoadsToGPU: 1,
      callbacks,
    });

    expect(callbacks.materializeLoadedGeometryNode).toHaveBeenCalledWith(
      pointCloud,
      root,
      null,
    );
    expect(callbacks.updateTreeNodeVisibility).toHaveBeenCalledWith(
      pointCloud,
      renderedNode,
      result.visibleNodes,
    );
    expect(callbacks.updateChildVisibility).toHaveBeenCalledWith(
      expect.objectContaining({ node: root }),
      pointCloud,
      renderedNode,
      cameraPosition,
      projection,
      50,
      { culledNodes: 0, culledPoints: 0 },
      expect.any(Function),
    );
    expect(result.visibleNodes).toEqual([renderedNode]);
    expect(pointCloud.visibleGeometry).toEqual([root]);
    expect(callbacks.loadGeometryNodes).toHaveBeenCalledWith([], []);
  });
});
