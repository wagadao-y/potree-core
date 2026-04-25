import { type Box3, Sphere, type Vector3 } from "three";
import { DEFAULT_MAX_NUM_NODES_LOADING } from "../constants";
import type { PotreeLoadInstrumentation } from "./LoadInstrumentation";
import type { OctreeGeometryNode } from "./OctreeGeometryNode";
import type { Metadata, NodeLoader } from "./OctreeLoader";
import type { PointAttributes } from "./PointAttributes";

export class OctreeGeometry {
  public root!: OctreeGeometryNode;

  public url: string | null = null;

  public pointAttributes: PointAttributes | null = null;

  public spacing: number = 0;

  public tightBoundingBox: Box3;

  public numNodesLoading: number = 0;

  public maxNumNodesLoading: number = DEFAULT_MAX_NUM_NODES_LOADING;

  public boundingSphere: Sphere;

  public tightBoundingSphere: Sphere;

  public offset!: Vector3;

  public scale!: [number, number, number];

  public disposed: boolean = false;

  public projection?: Metadata["projection"];

  public instrumentation?: PotreeLoadInstrumentation;

  constructor(
    public loader: NodeLoader,
    public boundingBox: Box3, // Need to be get from metadata.json
  ) {
    this.tightBoundingBox = this.boundingBox.clone();
    this.boundingSphere = this.boundingBox.getBoundingSphere(new Sphere());
    this.tightBoundingSphere = this.boundingBox.getBoundingSphere(new Sphere());
  }

  public dispose(): void {
    // this.loader.dispose();
    this.root.traverse((node) => {
      return node.dispose();
    });
    this.disposed = true;
  }
}
