import {
  type Box3,
  EventDispatcher,
  type Object3D,
  type Points,
  Sphere,
} from "three";
import type {
  IPointCloudRenderedNode,
  IPointCloudTreeNode,
} from "../core/types";
import type { OctreeGeometryNode } from "../loading/OctreeGeometryNode";
import { toThreeBox3, toThreeSphere } from "./box3-like";
import { disposeMaterializedOctreeNodeGeometry } from "./octree-node-geometry";

export class PointCloudOctreeNode
  extends EventDispatcher
  implements IPointCloudRenderedNode<OctreeGeometryNode>
{
  public geometryNode: OctreeGeometryNode;

  public sceneNode: Points;

  public pcIndex: number | undefined = undefined;

  public visibleNodeTextureOffset: number | undefined = undefined;

  public parent: PointCloudOctreeNode | null = null;

  public boundingBoxNode: Object3D | null = null;

  public readonly children: (IPointCloudTreeNode | null)[];

  public readonly loaded = true;

  public readonly isTreeNode = true;

  public readonly isGeometryNode = false;

  public constructor(geometryNode: OctreeGeometryNode, sceneNode: Points) {
    super();

    this.geometryNode = geometryNode;
    this.sceneNode = sceneNode;
    this.children = geometryNode.children.slice();
  }

  public dispose(): void {
    this.geometryNode.dispose();
  }

  public disposeSceneNode(): void {
    const node = this.sceneNode;

    disposeMaterializedOctreeNodeGeometry(this.geometryNode);
    node.geometry = undefined as any;
  }

  public traverse(
    cb: (node: IPointCloudTreeNode) => void,
    includeSelf?: boolean,
  ): void {
    this.geometryNode.traverse(cb, includeSelf);
  }

  public get id() {
    return this.geometryNode.id;
  }

  public get name() {
    return this.geometryNode.name;
  }

  public get level(): number {
    return this.geometryNode.level;
  }

  public get isLeafNode(): boolean {
    return this.geometryNode.isLeafNode;
  }

  public get numPoints(): number {
    return this.geometryNode.numPoints;
  }

  public get index() {
    return this.geometryNode.index;
  }

  public get boundingSphere(): Sphere {
    return toThreeSphere(this.geometryNode.boundingSphere, new Sphere());
  }

  public get boundingBox(): Box3 {
    return toThreeBox3(this.geometryNode.boundingBox);
  }

  public get spacing() {
    return this.geometryNode.spacing;
  }
}
