import { Color, Texture, Vector3, type Vector4 } from "three";
import {
  DEFAULT_MAX_POINT_SIZE,
  DEFAULT_MIN_POINT_SIZE,
  DEFAULT_RGB_BRIGHTNESS,
  DEFAULT_RGB_CONTRAST,
  DEFAULT_RGB_GAMMA,
} from "../constants";
import { DEFAULT_HIGHLIGHT_COLOR } from "../renderer-three/constants";
import type { IUniform } from "./types";

export interface IPointCloudMaterialUniforms {
  bbSize: IUniform<[number, number, number]>;
  blendDepthSupplement: IUniform<number>;
  blendHardness: IUniform<number>;
  classificationLUT: IUniform<Texture>;
  clipBoxCount: IUniform<number>;
  clipBoxes: IUniform<Float32Array>;
  clipSphereCount: IUniform<number>;
  clipSpheres: IUniform<Float32Array>;
  clipPlaneCount: IUniform<number>;
  clipPlanes: IUniform<Float32Array>;
  depthMap: IUniform<Texture | null>;
  diffuse: IUniform<[number, number, number]>;
  fov: IUniform<number>;
  gradient: IUniform<Texture>;
  heightMax: IUniform<number>;
  heightMin: IUniform<number>;
  intensityBrightness: IUniform<number>;
  intensityContrast: IUniform<number>;
  intensityGamma: IUniform<number>;
  intensityRange: IUniform<[number, number]>;
  level: IUniform<number>;
  maxSize: IUniform<number>;
  minSize: IUniform<number>;
  octreeSize: IUniform<number>;
  opacity: IUniform<number>;
  pcIndex: IUniform<number>;
  rgbBrightness: IUniform<number>;
  rgbContrast: IUniform<number>;
  rgbGamma: IUniform<number>;
  screenHeight: IUniform<number>;
  screenWidth: IUniform<number>;
  orthoHeight: IUniform<number>;
  orthoWidth: IUniform<number>;
  useOrthographicCamera: IUniform<boolean>;
  far: IUniform<number>;
  size: IUniform<number>;
  spacing: IUniform<number>;
  spacingScale: IUniform<number>;
  toModel: IUniform<number[]>;
  transition: IUniform<number>;
  uColor: IUniform<Color>;
  visibleNodes: IUniform<Texture>;
  visibleNodesTextureSize: IUniform<number>;
  vnStart: IUniform<number>;
  wClassification: IUniform<number>;
  wElevation: IUniform<number>;
  wIntensity: IUniform<number>;
  wReturnNumber: IUniform<number>;
  wRGB: IUniform<number>;
  wSourceID: IUniform<number>;
  opacityAttenuation: IUniform<number>;
  filterByNormalThreshold: IUniform<number>;
  highlightedPointCoordinate: IUniform<Vector3>;
  highlightedPointColor: IUniform<Vector4>;
  enablePointHighlighting: IUniform<boolean>;
  highlightedPointScale: IUniform<number>;
  viewScale: IUniform<number>;
}

interface PointCloudMaterialUniformOptions {
  classificationTexture?: Texture;
  gradientTexture?: Texture;
  visibleNodesTexture?: Texture;
  visibleNodesTextureSize: number;
}

export function createPointCloudMaterialUniforms(
  options: PointCloudMaterialUniformOptions,
): IPointCloudMaterialUniforms & Record<string, IUniform<any>> {
  return {
    bbSize: makeUniform("fv", [0, 0, 0] as [number, number, number]),
    blendDepthSupplement: makeUniform("f", 0.0),
    blendHardness: makeUniform("f", 2.0),
    classificationLUT: makeUniform(
      "t",
      options.classificationTexture ?? new Texture(),
    ),
    clipBoxCount: makeUniform("f", 0),
    clipBoxes: makeUniform("Matrix4fv", [] as any),
    clipSphereCount: makeUniform("f", 0),
    clipSpheres: makeUniform("fv", [] as any),
    clipPlaneCount: makeUniform("f", 0),
    clipPlanes: makeUniform("fv", [] as any),
    depthMap: makeUniform("t", null),
    diffuse: makeUniform("fv", [1, 1, 1] as [number, number, number]),
    fov: makeUniform("f", 1.0),
    gradient: makeUniform("t", options.gradientTexture ?? new Texture()),
    heightMax: makeUniform("f", 1.0),
    heightMin: makeUniform("f", 0.0),
    intensityBrightness: makeUniform("f", 0),
    intensityContrast: makeUniform("f", 0),
    intensityGamma: makeUniform("f", 1),
    intensityRange: makeUniform("fv", [0, 65000] as [number, number]),
    isLeafNode: makeUniform("b", 0),
    level: makeUniform("f", 0.0),
    maxSize: makeUniform("f", DEFAULT_MAX_POINT_SIZE),
    minSize: makeUniform("f", DEFAULT_MIN_POINT_SIZE),
    octreeSize: makeUniform("f", 0),
    opacity: makeUniform("f", 1.0),
    pcIndex: makeUniform("f", 0),
    rgbBrightness: makeUniform("f", DEFAULT_RGB_BRIGHTNESS),
    rgbContrast: makeUniform("f", DEFAULT_RGB_CONTRAST),
    rgbGamma: makeUniform("f", DEFAULT_RGB_GAMMA),
    screenHeight: makeUniform("f", 1.0),
    screenWidth: makeUniform("f", 1.0),
    useOrthographicCamera: makeUniform("b", false),
    orthoHeight: makeUniform("f", 1.0),
    orthoWidth: makeUniform("f", 1.0),
    far: makeUniform("f", 1000.0),
    size: makeUniform("f", 1),
    spacing: makeUniform("f", 1.0),
    spacingScale: makeUniform("f", 1.0),
    toModel: makeUniform("Matrix4f", []),
    transition: makeUniform("f", 0.5),
    uColor: makeUniform("c", new Color(0xffffff)),
    visibleNodes: makeUniform(
      "t",
      options.visibleNodesTexture ?? new Texture(),
    ),
    visibleNodesTextureSize: makeUniform("f", options.visibleNodesTextureSize),
    vnStart: makeUniform("f", 0.0),
    wClassification: makeUniform("f", 0),
    wElevation: makeUniform("f", 0),
    wIntensity: makeUniform("f", 0),
    wReturnNumber: makeUniform("f", 0),
    wRGB: makeUniform("f", 1),
    wSourceID: makeUniform("f", 0),
    opacityAttenuation: makeUniform("f", 1),
    filterByNormalThreshold: makeUniform("f", 0),
    highlightedPointCoordinate: makeUniform("fv", new Vector3()),
    highlightedPointColor: makeUniform("fv", DEFAULT_HIGHLIGHT_COLOR.clone()),
    enablePointHighlighting: makeUniform("b", true),
    highlightedPointScale: makeUniform("f", 2.0),
    viewScale: makeUniform("f", 1.0),
  };
}

function makeUniform<T>(type: string, value: T): IUniform<T> {
  return { type, value };
}
