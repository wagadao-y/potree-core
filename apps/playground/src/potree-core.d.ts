declare module "potree-core" {
  export enum ClipMode {
    DISABLED,
    HIGHLIGHT_INSIDE,
    CLIP_OUTSIDE,
    CLIP_INSIDE,
  }
  export type PointCloudOctree = any;
  export const PointCloudOctree: any;
  export enum PointSizeType {
    FIXED,
    ATTENUATED,
    ADAPTIVE,
  }
  export const Potree: any;
  export const PotreeRenderer: any;
  export const createClipBox: any;
  export const createClipSphere: any;
}
