import {
  DEFAULT_RGB_BRIGHTNESS,
  DEFAULT_RGB_CONTRAST,
  DEFAULT_RGB_GAMMA,
} from "../../constants";
import { ClipMode } from "./clipping";
import {
  ColorEncoding,
  PointColorType,
  PointOpacityType,
  PointShape,
  PointSizeType,
  TreeType,
} from "./enums";

const TREE_TYPE_DEFS = {
  [TreeType.OCTREE]: "tree_type_octree",
  [TreeType.KDTREE]: "tree_type_kdtree",
};

const SIZE_TYPE_DEFS = {
  [PointSizeType.FIXED]: "fixed_point_size",
  [PointSizeType.ATTENUATED]: "attenuated_point_size",
  [PointSizeType.ADAPTIVE]: "adaptive_point_size",
};

const OPACITY_DEFS = {
  [PointOpacityType.ATTENUATED]: "attenuated_opacity",
  [PointOpacityType.FIXED]: "fixed_opacity",
};

const SHAPE_DEFS = {
  [PointShape.SQUARE]: "square_point_shape",
  [PointShape.CIRCLE]: "circle_point_shape",
  [PointShape.PARABOLOID]: "paraboloid_point_shape",
};

const COLOR_DEFS = {
  [PointColorType.RGB]: "color_type_rgb",
  [PointColorType.COLOR]: "color_type_color",
  [PointColorType.DEPTH]: "color_type_depth",
  [PointColorType.HEIGHT]: "color_type_height",
  [PointColorType.INTENSITY]: "color_type_intensity",
  [PointColorType.INTENSITY_GRADIENT]: "color_type_intensity_gradient",
  [PointColorType.LOD]: "color_type_lod",
  [PointColorType.POINT_INDEX]: "color_type_point_index",
  [PointColorType.CLASSIFICATION]: "color_type_classification",
  [PointColorType.RETURN_NUMBER]: "color_type_return_number",
  [PointColorType.SOURCE]: "color_type_source",
  [PointColorType.NORMAL]: "color_type_normal",
  [PointColorType.PHONG]: "color_type_phong",
  [PointColorType.RGB_HEIGHT]: "color_type_rgb_height",
  [PointColorType.COMPOSITE]: "color_type_composite",
};

const CLIP_MODE_DEFS = {
  [ClipMode.DISABLED]: "clip_disabled",
  [ClipMode.CLIP_OUTSIDE]: "clip_outside",
  [ClipMode.CLIP_INSIDE]: "clip_inside",
  [ClipMode.HIGHLIGHT_INSIDE]: "clip_highlight_inside",
};

const INPUT_COLOR_ENCODING = {
  [ColorEncoding.LINEAR]: "input_color_encoding_linear",
  [ColorEncoding.SRGB]: "input_color_encoding_sRGB",
};

const OUTPUT_COLOR_ENCODING = {
  [ColorEncoding.LINEAR]: "output_color_encoding_linear",
  [ColorEncoding.SRGB]: "output_color_encoding_sRGB",
};

export interface PointCloudMaterialDefineOptions {
  treeType: TreeType;
  pointSizeType: PointSizeType;
  shape: PointShape;
  pointColorType: PointColorType;
  clipMode: ClipMode;
  pointOpacityType: PointOpacityType;
  outputColorEncoding: ColorEncoding;
  inputColorEncoding: ColorEncoding;
  opacity: number;
  rgbGamma: number;
  rgbBrightness: number;
  rgbContrast: number;
  useFilterByNormal: boolean;
  useEDL: boolean;
  useLogDepth: boolean;
  useReversedDepth: boolean;
  weighted: boolean;
  numClipBoxes: number;
  numClipSpheres: number;
  numClipPlanes: number;
  highlightPoint: boolean;
  newFormat: boolean;
}

export function applyPointCloudMaterialDefines(
  shaderSrc: string,
  options: PointCloudMaterialDefineOptions,
): string {
  const parts: string[] = [];

  function define(value: string | undefined) {
    if (value) {
      parts.push(`#define ${value}`);
    }
  }

  define(TREE_TYPE_DEFS[options.treeType]);
  define(SIZE_TYPE_DEFS[options.pointSizeType]);
  define(SHAPE_DEFS[options.shape]);
  define(COLOR_DEFS[options.pointColorType]);
  define(CLIP_MODE_DEFS[options.clipMode]);
  define(OPACITY_DEFS[options.pointOpacityType]);
  define(OUTPUT_COLOR_ENCODING[options.outputColorEncoding]);
  define(INPUT_COLOR_ENCODING[options.inputColorEncoding]);

  if (
    options.opacity === 1.0 &&
    options.pointOpacityType === PointOpacityType.FIXED
  ) {
    define("opaque_opacity");
  }

  if (
    options.pointOpacityType === PointOpacityType.ATTENUATED &&
    !options.useEDL &&
    !options.weighted &&
    options.pointColorType !== PointColorType.POINT_INDEX
  ) {
    define("use_opacity_varying");
  }

  if (
    options.rgbGamma !== DEFAULT_RGB_GAMMA ||
    options.rgbBrightness !== DEFAULT_RGB_BRIGHTNESS ||
    options.rgbContrast !== DEFAULT_RGB_CONTRAST
  ) {
    define("use_rgb_gamma_contrast_brightness");
  }

  if (options.useFilterByNormal) {
    define("use_filter_by_normal");
  }

  if (options.useEDL) {
    define("use_edl");
  }

  if (options.useLogDepth) {
    define("use_log_depth");
  }

  if (options.useReversedDepth) {
    define("use_reversed_depth");
  }

  if (options.weighted) {
    define("weighted_splats");
  }

  if (options.numClipBoxes > 0) {
    define("use_clip_box");
  }

  if (options.numClipSpheres > 0) {
    define("use_clip_sphere");
  }

  if (options.numClipPlanes > 0) {
    define("use_clip_plane");
  }

  if (options.highlightPoint) {
    define("highlight_point");
  }

  define("MAX_POINT_LIGHTS 0");
  define("MAX_DIR_LIGHTS 0");

  if (options.newFormat) {
    define("new_format");
  }

  const versionLine = shaderSrc.match(/^\s*#version\s+300\s+es\s*\n/);
  if (versionLine) {
    parts.unshift(versionLine[0]);
    shaderSrc = shaderSrc.replace(versionLine[0], "");
  }

  parts.push(shaderSrc);
  return parts.join("\n");
}
