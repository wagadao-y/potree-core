import { DEFAULT_MAX_NUM_NODES_LOADING } from "../constants";
import { cloneBox3, getBoundingSphereForBox3 } from "../core/box3-like-utils";
import type { Box3Like, SphereLike, Vec3Like } from "../core/types";
import type { PotreeLoadInstrumentation } from "./LoadInstrumentation";
import type { OctreeGeometryNode } from "./OctreeGeometryNode";
import type { Metadata, NodeLoader } from "./OctreeLoader";
import type { PointAttributes } from "./PointAttributes";

export class OctreeGeometry {
  public root!: OctreeGeometryNode;

  public url: string | null = null;

  public pointAttributes: PointAttributes | null = null;

  public spacing: number = 0;

  public tightBoundingBox: Box3Like;

  public numNodesLoading: number = 0;

  public maxNumNodesLoading: number = DEFAULT_MAX_NUM_NODES_LOADING;

  public boundingSphere: SphereLike;

  public tightBoundingSphere: SphereLike;

  public offset!: Vec3Like;

  public scale!: [number, number, number];

  public disposed: boolean = false;

  public projection?: Metadata["projection"];

  public instrumentation?: PotreeLoadInstrumentation;

  constructor(
    public loader: NodeLoader,
    public boundingBox: Box3Like, // Need to be get from metadata.json
  ) {
    this.tightBoundingBox = cloneBox3(this.boundingBox);
    this.boundingSphere = getBoundingSphereForBox3(this.boundingBox);
    this.tightBoundingSphere = getBoundingSphereForBox3(this.boundingBox);
  }

  public dispose(): void {
    // this.loader.dispose();
    this.root.traverse((node) => {
      return node.dispose();
    });
    this.disposed = true;
  }
}
