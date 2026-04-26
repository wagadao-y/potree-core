import {
  type Box3,
  type Camera,
  type Intersection,
  type Object3D,
  type Ray,
  type Raycaster,
  Sphere,
  type WebGLRenderer,
} from "three";
import { DEFAULT_MIN_NODE_PIXEL_SIZE } from "./core/constants";
import type {
  IPointCloudTreeNode,
  IPointCloudVisibilityTarget,
} from "./core/types";
import type { OctreeGeometry } from "./loading/OctreeGeometry";
import type { OctreeGeometryNode } from "./loading/OctreeGeometryNode";
import type { PointCloudMaterial, PointSizeType } from "./materials";
import { pointCloudOctreeRendererAdapter } from "./renderer-three/adapters/point-cloud-octree-renderer";
import type { PointCloudOctreeNode } from "./renderer-three/geometry/point-cloud-octree-node";
import { toThreeBox3, toThreeVector3 } from "./renderer-three/math/box3-like";
import {
  disposePointCloudOctreePicker,
  type PickParams,
  pickPointCloud,
} from "./renderer-three/picking/point-cloud-octree-picker";
import { PointCloudTree } from "./renderer-three/scene/point-cloud-tree";
import type { IPotree, PickPoint } from "./renderer-three/types";

/**
 * Public Three.js facade for an octree-backed point cloud.
 *
 * This class intentionally remains both a scene object and the main user-facing
 * API surface for point cloud interaction. Renderer integration hooks are kept
 * public where the visibility pipeline needs them, but user code should primarily
 * interact with material, transforms, picking, bounds, and lifecycle methods.
 */
export class PointCloudOctree
  extends PointCloudTree
  implements
    IPointCloudVisibilityTarget<OctreeGeometryNode, PointCloudOctreeNode>
{
  /**
   * The name of the point cloud octree.
   */
  public potree: IPotree;

  /**
   * Indicates whether the point cloud octree has been disposed.
   *
   * This is set to true when the octree is disposed, and can be used to check if the octree is still valid.
   */
  public disposed: boolean = false;

  /**
   * The geometry of the point cloud octree.
   *
   * This contains the root node and other properties related to the point cloud geometry.
   */
  public pcoGeometry: OctreeGeometry;

  /**
   * The bounding box of the point cloud octree.
   *
   * This is used to define the spatial extent of the point cloud.
   */
  public boundingBox: Box3;

  /**
   * The bounding sphere of the point cloud octree.
   *
   * This is used for spatial queries and to determine visibility.
   */
  public boundingSphere: Sphere;

  /**
   * The position of the point cloud octree in the 3D space.
   *
   * This is used to position the octree in the scene.
   */
  public level: number = 0;

  /**
   * The maximum level of detail for the point cloud octree.
   *
   * This is used to limit the depth of the octree when rendering or processing.
   */
  public maxLevel: number = Infinity;

  /**
   * The minimum radius of a node's bounding sphere on the screen in order to be displayed.
   */
  public minNodePixelSize: number = DEFAULT_MIN_NODE_PIXEL_SIZE;

  /**
   * If enabled, child LOD nodes that are already too dense in screen space are not expanded.
   */
  public screenSpaceDensityLODEnabled: boolean = false;

  /**
   * Maximum number of points per projected pixel before child LOD expansion stops.
   */
  public maxPointsPerPixel: number = 1;

  /**
   * Bounding box nodes for visualization.
   */
  public boundingBoxNodes: Object3D[] = [];

  /**
   * An array of visible nodes in the point cloud octree.
   *
   * These nodes are currently visible in the scene and can be rendered.
   */
  public visibleNodes: PointCloudOctreeNode[] = [];

  /**
   * An array of visible geometry nodes in the point cloud octree.
   *
   * These nodes contain the geometry data for rendering and are currently visible.
   */
  public visibleGeometry: OctreeGeometryNode[] = [];

  /**
   * The number of visible points in the point cloud octree.
   *
   * This is used to keep track of how many points are currently visible in the scene.
   */
  public numVisiblePoints: number = 0;

  /**
   * Indicates whether the bounding box should be shown in the scene.
   *
   * This can be toggled to visualize the spatial extent of the point cloud octree.
   */
  public showBoundingBox: boolean = false;

  // @ts-ignore
  private _material: PointCloudMaterial = null;

  public constructor(
    potree: IPotree,
    pcoGeometry: OctreeGeometry,
    material?: PointCloudMaterial,
  ) {
    super();

    this.name = "";
    this.potree = potree;
    this.root = pcoGeometry.root;
    this.pcoGeometry = pcoGeometry;
    this.boundingBox = toThreeBox3(pcoGeometry.boundingBox);
    this.boundingSphere = this.boundingBox.getBoundingSphere(new Sphere());

    this.position.copy(toThreeVector3(pcoGeometry.offset));
    this.updateMatrix();

    this.material =
      material ||
      pointCloudOctreeRendererAdapter.createDefaultMaterial(pcoGeometry);
  }

  /**
   * Releases geometry, material, picker, and cached renderer-side state.
   */
  public dispose(): void {
    if (this.root) {
      this.root.dispose();
    }

    this.pcoGeometry.root.traverse((n: IPointCloudTreeNode) => {
      return this.potree.lru.remove(n);
    });
    this.pcoGeometry.dispose();
    this.material.dispose();

    this.visibleNodes = [];
    this.visibleGeometry = [];

    disposePointCloudOctreePicker(this);
    pointCloudOctreeRendererAdapter.dispose(this);

    this.disposed = true;
  }

  public get material(): PointCloudMaterial {
    return this._material;
  }

  /**
   * Replaces the active material and immediately synchronizes derived bounds.
   */
  public set material(material: PointCloudMaterial) {
    this._material = material;
    pointCloudOctreeRendererAdapter.updateMaterialBounds(this, material);
  }

  public get pointSizeType(): PointSizeType {
    return this.material.pointSizeType;
  }

  public set pointSizeType(value: PointSizeType) {
    this.material.pointSizeType = value;
  }

  /**
   * Renderer integration hook that materializes a loaded geometry node.
   * End-user code should not usually need to call this directly.
   */
  public toTreeNode(
    geometryNode: OctreeGeometryNode,
    parent?: PointCloudOctreeNode | null,
  ): PointCloudOctreeNode {
    return pointCloudOctreeRendererAdapter.materializeTreeNode(
      this,
      geometryNode,
      parent,
    );
  }

  /**
   * Renderer integration hook that refreshes the cached visible bounds.
   */
  public updateVisibleBounds() {
    pointCloudOctreeRendererAdapter.updateVisibleBounds(this);
  }

  /**
   * Renderer integration hook that synchronizes debug bounding boxes.
   */
  public updateBoundingBoxes(): void {
    pointCloudOctreeRendererAdapter.updateBoundingBoxes(this);
  }

  public updateMatrixWorld(force: boolean): void {
    if (this.matrixAutoUpdate === true) {
      this.updateMatrix();
    }

    if (this.matrixWorldNeedsUpdate === true || force === true) {
      if (!this.parent) {
        this.matrixWorld.copy(this.matrix);
      } else {
        this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      }

      this.matrixWorldNeedsUpdate = false;

      force = true;
    }
  }

  /**
   * Renderer integration hook used when visibility changes hide child scene nodes.
   */
  public hideDescendants(object: PointCloudOctreeNode["sceneNode"]): void {
    pointCloudOctreeRendererAdapter.hideDescendants(object);
  }

  /**
   * Recenters the point cloud at the world origin.
   */
  public moveToOrigin(): void {
    pointCloudOctreeRendererAdapter.moveToOrigin(this);
  }

  /**
   * Moves the point cloud so its world-space minimum Y sits on the ground plane.
   */
  public moveToGroundPlane(): void {
    pointCloudOctreeRendererAdapter.moveToGroundPlane(this);
  }

  /**
   * Returns the world-space bounding box for the current transform.
   */
  public getBoundingBoxWorld(): Box3 {
    return pointCloudOctreeRendererAdapter.getBoundingBoxWorld(this);
  }

  /**
   * Returns the current visible extent in world space.
   */
  public getVisibleExtent() {
    return pointCloudOctreeRendererAdapter.getVisibleExtent(this);
  }

  /**
   * Performs point picking against the currently visible nodes.
   */
  public pick(
    renderer: WebGLRenderer,
    camera: Camera,
    ray: Ray,
    params: Partial<PickParams> = {},
  ): PickPoint | null {
    return pickPointCloud(this, renderer, camera, ray, params);
  }

  /**
   * Implements THREE.js raycaster support for point cloud picking.
   *
   * When EDL is active, point cloud child nodes are moved to a dedicated rendering layer
   * (e.g. layer 1) so they are excluded from the normal scene render pass. This means
   * the default THREE.js layer test inside `Raycaster.intersectObject()` will fail for
   * those nodes, making `raycaster.intersectObject()` return no hits.
   *
   * This override handles that case by directly calling `raycast()` on each visible node's
   * scene node whenever the node's layer is NOT visible to the raycaster (i.e. EDL mode).
   * When nodes ARE on a raycaster-visible layer (non-EDL mode), this method does nothing
   * and lets the normal recursive traversal call `Points.raycast()` instead, avoiding
   * double-counting of intersections.
   */
  public raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    for (const node of this.visibleNodes) {
      const sceneNode = node.sceneNode;
      if (sceneNode && !sceneNode.layers.test(raycaster.layers)) {
        // Node is on a layer the raycaster cannot see (e.g. EDL dedicated layer).
        // Call raycast() directly, bypassing the layer check, so picks still work.
        sceneNode.raycast(raycaster, intersects);
      }
      // If sceneNode.layers.test(raycaster.layers) is true, the recursive traversal
      // from intersectObject() will process this node normally — no action needed here.
    }
  }

  /**
   * Approximate visibility progress based on rendered versus visible geometry nodes.
   */
  public get progress() {
    return this.visibleGeometry.length === 0
      ? 0
      : this.visibleNodes.length / this.visibleGeometry.length;
  }
}
