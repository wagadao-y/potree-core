import {
  AdditiveBlending,
  type BufferGeometry,
  type Camera,
  type Color,
  GLSL3,
  LessEqualDepth,
  type Material,
  Matrix4,
  NoBlending,
  type OrthographicCamera,
  type PerspectiveCamera,
  RawShaderMaterial,
  type Scene,
  type Texture,
  Vector3,
  type Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { getBox3Size } from "../core/box3-like-utils";
import type { PointCloudOctree } from "../point-cloud-octree";
import { PERSPECTIVE_CAMERA } from "../renderer-three/constants";
import type { PointCloudOctreeNode } from "../renderer-three/geometry/point-cloud-octree-node";
import { DEFAULT_CLASSIFICATION } from "./classification";
import { ClipMode, type IClipBox, type IClipSphere } from "./clipping";
import { ColorEncoding } from "./color-encoding";
import {
  PointColorType,
  PointOpacityType,
  PointShape,
  PointSizeType,
  TreeType,
} from "./enums";
import { SPECTRAL } from "./gradients";
import { applyPointCloudMaterialDefines } from "./point-cloud-material-defines";
import {
  createPointCloudMaterialUniforms,
  type IPointCloudMaterialUniforms,
} from "./point-cloud-material-uniforms";
import {
  buildClipBoxesArray,
  buildClipPlanesArray,
  buildClipSpheresArray,
  classificationsEqual,
  cloneClassification,
} from "./point-cloud-material-updates";
import { PointCloudVisibleNodesTexture } from "./point-cloud-visible-nodes-texture";
import FragShader from "./shaders/pointcloud.fs?raw";
import VertShader from "./shaders/pointcloud.vs?raw";
import {
  generateClassificationTexture,
  generateGradientTexture,
} from "./texture-generation";
import type { IClassification, IGradient, IUniform } from "./types";

const spacingScaleModelViewMatrix = new Matrix4();
const spacingScaleOrigin = new Vector3();
const spacingScaleOffset = new Vector3();

/**
 * Configuration parameters for point cloud material rendering.
 *
 * @interface IPointCloudMaterialParameters
 */
export interface IPointCloudMaterialParameters {
  /**
   * The base size of points in the point cloud.
   */
  size: number;

  /**
   * The minimum allowed size for points when scaling.
   */
  minSize: number;

  /**
   * The maximum allowed size for points when scaling.
   */
  maxSize: number;

  /**
   * The type of tree structure used for organizing the point cloud data.
   */
  treeType: TreeType;

  /**
   * Whether to use the new format for point cloud data processing.
   */
  newFormat: boolean;
}

export class PointCloudMaterial extends RawShaderMaterial {
  private static readonly INITIAL_VISIBLE_NODES_TEXTURE_SIZE = 2048;

  lights = false;

  fog = false;

  numClipBoxes: number = 0;

  clipBoxes: IClipBox[] = [];

  numClipSpheres: number = 0;

  clipSpheres: IClipSphere[] = [];

  private numClipPlanes: number = 0;

  visibleNodesTexture: Texture | undefined;

  private readonly visibleNodesTextureData = new PointCloudVisibleNodesTexture(
    PointCloudMaterial.INITIAL_VISIBLE_NODES_TEXTURE_SIZE,
  );

  private _gradient = SPECTRAL;

  private gradientTexture: Texture | undefined = generateGradientTexture(
    this._gradient,
  );

  private _classification: IClassification = DEFAULT_CLASSIFICATION;

  private classificationTexture: Texture | undefined =
    generateClassificationTexture(this._classification);

  uniforms: IPointCloudMaterialUniforms & Record<string, IUniform<any>> =
    createPointCloudMaterialUniforms({
      classificationTexture: this.classificationTexture,
      gradientTexture: this.gradientTexture,
      visibleNodesTextureSize: this.visibleNodesTextureData.textureSize,
    });

  @uniform("bbSize") bbSize!: [number, number, number];

  @uniform("depthMap") depthMap!: Texture | undefined;

  @uniform("fov") fov!: number;

  @uniform("heightMax") heightMax!: number;

  @uniform("heightMin") heightMin!: number;

  @uniform("intensityBrightness") intensityBrightness!: number;

  @uniform("intensityContrast") intensityContrast!: number;

  @uniform("intensityGamma") intensityGamma!: number;

  @uniform("intensityRange") intensityRange!: [number, number];

  @uniform("maxSize") maxSize!: number;

  @uniform("minSize") minSize!: number;

  @uniform("octreeSize") octreeSize!: number;

  @uniform("opacity", true) opacity!: number;

  @uniform("rgbBrightness", true) rgbBrightness!: number;

  @uniform("rgbContrast", true) rgbContrast!: number;

  @uniform("rgbGamma", true) rgbGamma!: number;

  @uniform("screenHeight") screenHeight!: number;

  @uniform("screenWidth") screenWidth!: number;

  @uniform("orthoWidth") orthoWidth!: number;

  @uniform("orthoHeight") orthoHeight!: number;

  @uniform("useOrthographicCamera") useOrthographicCamera!: boolean;

  @uniform("far") far!: number;

  @uniform("size") size!: number;

  @uniform("spacing") spacing!: number;

  @uniform("spacingScale") spacingScale!: number;

  @uniform("transition") transition!: number;

  @uniform("uColor") color!: Color;

  @uniform("wClassification") weightClassification!: number;

  @uniform("wElevation") weightElevation!: number;

  @uniform("wIntensity") weightIntensity!: number;

  @uniform("wReturnNumber") weightReturnNumber!: number;

  @uniform("wRGB") weightRGB!: number;

  @uniform("wSourceID") weightSourceID!: number;

  @uniform("opacityAttenuation") opacityAttenuation!: number;

  @uniform("filterByNormalThreshold") filterByNormalThreshold!: number;

  @uniform("highlightedPointCoordinate") highlightedPointCoordinate!: Vector3;

  @uniform("highlightedPointColor") highlightedPointColor!: Vector4;

  @uniform("enablePointHighlighting") enablePointHighlighting!: boolean;

  @uniform("highlightedPointScale") highlightedPointScale!: number;

  @uniform("viewScale") viewScale!: number;

  // Declare PointCloudMaterial attributes that need shader updates upon change, and set default values.
  @requiresShaderUpdate() useClipBox: boolean = false;

  @requiresShaderUpdate() useClipSphere: boolean = false;

  @requiresShaderUpdate() weighted: boolean = false;

  @requiresShaderUpdate() pointColorType: PointColorType = PointColorType.RGB;

  @requiresShaderUpdate() pointSizeType: PointSizeType = PointSizeType.ADAPTIVE;

  @requiresShaderUpdate() clipMode: ClipMode = ClipMode.DISABLED;

  @requiresShaderUpdate() useEDL: boolean = false;

  @requiresShaderUpdate() shape: PointShape = PointShape.SQUARE;

  @requiresShaderUpdate() treeType: TreeType = TreeType.OCTREE;

  @requiresShaderUpdate() pointOpacityType: PointOpacityType =
    PointOpacityType.FIXED;

  @requiresShaderUpdate() useFilterByNormal: boolean = false;

  @requiresShaderUpdate() highlightPoint: boolean = false;

  @requiresShaderUpdate() inputColorEncoding: ColorEncoding =
    ColorEncoding.SRGB;

  @requiresShaderUpdate() outputColorEncoding: ColorEncoding =
    ColorEncoding.LINEAR;

  @requiresShaderUpdate() private useLogDepth: boolean = false;

  @requiresShaderUpdate() private useReversedDepth: boolean = false;

  attributes = {
    position: { type: "fv", value: [] },
    color: { type: "fv", value: [] },
    normal: { type: "fv", value: [] },
    intensity: { type: "f", value: [] },
    classification: { type: "f", value: [] },
    returnNumber: { type: "f", value: [] },
    numberOfReturns: { type: "f", value: [] },
    pointSourceID: { type: "f", value: [] },
    indices: { type: "fv", value: [] },
  };

  newFormat: boolean;

  constructor(parameters: Partial<IPointCloudMaterialParameters> = {}) {
    super();

    const tex = this.visibleNodesTextureData.texture;
    this.visibleNodesTexture = tex;
    this.setUniform("visibleNodes", tex);

    this.treeType = getValid(parameters.treeType, TreeType.OCTREE);
    this.size = getValid(parameters.size, 1.0);
    this.minSize = getValid(parameters.minSize, 2.0);
    this.maxSize = getValid(parameters.maxSize, 50.0);

    this.newFormat = Boolean(parameters.newFormat);

    this.classification = DEFAULT_CLASSIFICATION;

    Object.assign(this.defaultAttributeValues, {
      classification: [0, 0, 0],
      indices: [0, 0, 0, 0],
      normal: [0, 0, 0],
    });

    this.vertexColors = true;

    // throw new Error('Not implemented');
    // this.extensions.fragDepth = true;

    this.updateShaderSource();
  }

  dispose(): void {
    super.dispose();

    if (this.gradientTexture) {
      this.gradientTexture.dispose();
      this.gradientTexture = undefined;
    }

    this.visibleNodesTextureData.dispose();
    this.visibleNodesTexture = undefined;

    if (this.classificationTexture) {
      this.classificationTexture.dispose();
      this.classificationTexture = undefined;
    }

    if (this.depthMap) {
      this.depthMap.dispose();
      this.depthMap = undefined;
    }
  }

  updateShaderSource(): void {
    this.glslVersion = GLSL3;

    this.vertexShader = this.applyDefines(VertShader);
    this.fragmentShader = this.applyDefines(FragShader);

    if (this.opacity === 1.0) {
      this.blending = NoBlending;
      this.transparent = false;
      this.depthTest = true;
      this.depthWrite = true;
      this.depthFunc = LessEqualDepth;
    } else if (this.opacity < 1.0 && !this.useEDL) {
      this.blending = AdditiveBlending;
      this.transparent = true;
      this.depthTest = false;
      this.depthWrite = true;
    }

    if (this.weighted) {
      this.blending = AdditiveBlending;
      this.transparent = true;
      this.depthTest = true;
      this.depthWrite = false;
      this.depthFunc = LessEqualDepth;
    }

    this.needsUpdate = true;
  }

  applyDefines(shaderSrc: string): string {
    return applyPointCloudMaterialDefines(shaderSrc, {
      treeType: this.treeType,
      pointSizeType: this.pointSizeType,
      shape: this.shape,
      pointColorType: this.pointColorType,
      clipMode: this.clipMode,
      pointOpacityType: this.pointOpacityType,
      outputColorEncoding: this.outputColorEncoding,
      inputColorEncoding: this.inputColorEncoding,
      opacity: this.opacity,
      rgbGamma: this.rgbGamma,
      rgbBrightness: this.rgbBrightness,
      rgbContrast: this.rgbContrast,
      useFilterByNormal: this.useFilterByNormal,
      useEDL: this.useEDL,
      useLogDepth: this.useLogDepth,
      useReversedDepth: this.useReversedDepth,
      weighted: this.weighted,
      numClipBoxes: this.numClipBoxes,
      numClipSpheres: this.numClipSpheres,
      numClipPlanes: this.numClipPlanes,
      highlightPoint: this.highlightPoint,
      newFormat: this.newFormat,
    });
  }

  setClipBoxes(clipBoxes: IClipBox[]): void {
    if (!clipBoxes) {
      return;
    }

    this.clipBoxes = clipBoxes;

    const doUpdate =
      this.numClipBoxes !== clipBoxes.length &&
      (clipBoxes.length === 0 || this.numClipBoxes === 0);

    this.numClipBoxes = clipBoxes.length;
    this.setUniform("clipBoxCount", this.numClipBoxes);

    if (doUpdate) {
      this.updateShaderSource();
    }

    this.setUniform(
      "clipBoxes",
      buildClipBoxesArray(clipBoxes, this.numClipBoxes),
    );
  }

  setClipSpheres(clipSpheres: IClipSphere[]): void {
    if (!clipSpheres) {
      return;
    }

    this.clipSpheres = clipSpheres;

    const doUpdate = (this.numClipSpheres === 0) !== (clipSpheres.length === 0);

    this.numClipSpheres = clipSpheres.length;
    this.setUniform("clipSphereCount", this.numClipSpheres);

    if (doUpdate) {
      this.updateShaderSource();
    }

    this.setUniform(
      "clipSpheres",
      buildClipSpheresArray(clipSpheres, this.numClipSpheres),
    );
  }

  /**
   * Syncs the inherited `clippingPlanes` property to internal shader uniforms.
   * Called automatically each frame from `updateMaterial()`.
   */
  private syncClippingPlanes(): void {
    const planes = this.clippingPlanes;
    const count = planes?.length ?? 0;

    //Only update shader source if we transition between having clipping planes and not having clipping planes.
    //The shader only needs to know whether clipping planes are in use.
    const doUpdate = (this.numClipPlanes === 0) !== (count === 0);

    this.numClipPlanes = count;
    this.setUniform("clipPlaneCount", count);

    if (doUpdate) {
      this.updateShaderSource();
    }

    // If there are clipping planes, update shader uniforms each frame with their positions.
    if (count > 0 && planes) {
      this.setUniform("clipPlanes", buildClipPlanesArray(planes));
    }
  }

  get gradient(): IGradient {
    return this._gradient;
  }

  set gradient(value: IGradient) {
    if (this._gradient !== value) {
      this._gradient = value;
      this.gradientTexture = generateGradientTexture(this._gradient);
      this.setUniform("gradient", this.gradientTexture);
    }
  }

  get classification(): IClassification {
    return this._classification;
  }

  set classification(value: IClassification) {
    const copy = cloneClassification(value);
    const isEqual = classificationsEqual(this._classification, copy);

    if (!isEqual) {
      this._classification = copy;
      this.recomputeClassification();
    }
  }

  private recomputeClassification(): void {
    this.classificationTexture = generateClassificationTexture(
      this._classification,
    );
    this.setUniform("classificationLUT", this.classificationTexture);
  }

  get elevationRange(): [number, number] {
    return [this.heightMin, this.heightMax];
  }

  set elevationRange(value: [number, number]) {
    this.heightMin = value[0];
    this.heightMax = value[1];
  }

  getUniform<K extends keyof IPointCloudMaterialUniforms>(
    name: K,
  ): IPointCloudMaterialUniforms[K]["value"] {
    return this.uniforms === undefined
      ? (undefined as any)
      : this.uniforms[name].value;
  }

  setUniform<K extends keyof IPointCloudMaterialUniforms>(
    name: K,
    value: IPointCloudMaterialUniforms[K]["value"],
  ): void {
    if (this.uniforms === undefined) {
      return;
    }

    const uObj = this.uniforms[name];

    if (uObj.type === "c") {
      (uObj.value as Color).copy(value as Color);
    } else if (value !== uObj.value) {
      uObj.value = value;
    }
  }

  updateMaterial(
    octree: PointCloudOctree,
    visibleNodes: PointCloudOctreeNode[],
    camera: Camera,
    renderer: WebGLRenderer,
  ): void {
    const pixelRatio = renderer.getPixelRatio();

    // Sync clipping planes to shader uniforms
    this.syncClippingPlanes();

    const capabilities =
      renderer.capabilities as typeof renderer.capabilities & {
        reversedDepthBuffer?: boolean;
        reverseDepthBuffer?: boolean;
      };
    const useReversedDepth =
      capabilities.reversedDepthBuffer === true ||
      capabilities.reverseDepthBuffer === true;

    this.useReversedDepth = useReversedDepth;
    this.useLogDepth =
      renderer.capabilities.logarithmicDepthBuffer && !useReversedDepth;

    if (camera.type === PERSPECTIVE_CAMERA) {
      this.useOrthographicCamera = false;
      this.fov = (camera as PerspectiveCamera).fov * (Math.PI / 180);
      this.far = (camera as PerspectiveCamera).far;
    } // ORTHOGRAPHIC
    else {
      const orthoCamera = camera as OrthographicCamera;
      this.useOrthographicCamera = true;
      this.orthoWidth =
        (orthoCamera.right - orthoCamera.left) / orthoCamera.zoom;
      this.orthoHeight =
        (orthoCamera.top - orthoCamera.bottom) / orthoCamera.zoom;
      this.fov = Math.PI / 2; // will result in slope = 1 in the shader
      this.far = (camera as OrthographicCamera).far;
    }
    const renderTarget = renderer.getRenderTarget();
    if (renderTarget !== null && renderTarget instanceof WebGLRenderTarget) {
      this.screenWidth = renderTarget.width;
      this.screenHeight = renderTarget.height;
    } else {
      this.screenWidth = renderer.domElement.clientWidth * pixelRatio;
      this.screenHeight = renderer.domElement.clientHeight * pixelRatio;
    }

    const maxScale = Math.max(octree.scale.x, octree.scale.y, octree.scale.z);
    this.spacing = octree.pcoGeometry.spacing * maxScale;
    this.octreeSize = getBox3Size(octree.pcoGeometry.boundingBox).x;
    const view = (camera as any).view;
    if (view?.enabled) {
      this.viewScale = view.fullWidth / view.width;
    } else {
      this.viewScale = 1.0;
    }

    if (
      this.pointSizeType === PointSizeType.ADAPTIVE ||
      this.pointColorType === PointColorType.LOD
    ) {
      this.updateVisibilityTextureData(visibleNodes);
    }
  }

  private updateVisibilityTextureData(nodes: PointCloudOctreeNode[]) {
    const previousTexture = this.visibleNodesTexture;

    this.visibleNodesTextureData.update(nodes);
    this.visibleNodesTexture = this.visibleNodesTextureData.texture;

    if (previousTexture !== this.visibleNodesTexture) {
      this.setUniform("visibleNodes", this.visibleNodesTexture);
      this.setUniform(
        "visibleNodesTextureSize",
        this.visibleNodesTextureData.textureSize,
      );
    }
  }

  static makeOnBeforeRender(
    _octree: PointCloudOctree,
    node: PointCloudOctreeNode,
    pcIndex?: number,
  ) {
    return (
      _renderer: WebGLRenderer,
      _scene: Scene,
      _camera: Camera,
      _geometry: BufferGeometry,
      material: Material,
    ) => {
      if (material instanceof PointCloudMaterial) {
        const materialUniforms = material.uniforms;

        materialUniforms.level.value = node.level;
        materialUniforms.isLeafNode.value = node.isLeafNode;

        const vnStart = node.visibleNodeTextureOffset;
        if (vnStart !== undefined) {
          materialUniforms.vnStart.value = vnStart;
        }

        materialUniforms.pcIndex.value =
          pcIndex !== undefined ? pcIndex : (node.pcIndex ?? 0);

        if (
          material.pointSizeType === PointSizeType.ATTENUATED ||
          material.pointSizeType === PointSizeType.ADAPTIVE
        ) {
          materialUniforms.spacingScale.value = computeSpacingScale(
            material.spacing,
            _camera,
            node.sceneNode.matrixWorld,
          );
        } else {
          materialUniforms.spacingScale.value = 1.0;
        }

        // Remove the cast to any after updating to Three.JS >= r113
        (material as RawShaderMaterial).uniformsNeedUpdate = true;
      }
    };
  }
}

function computeSpacingScale(
  spacing: number,
  camera: Camera,
  matrixWorld: Matrix4,
): number {
  if (spacing === 0) {
    return 1.0;
  }

  spacingScaleModelViewMatrix.multiplyMatrices(
    camera.matrixWorldInverse,
    matrixWorld,
  );
  spacingScaleOrigin.set(0, 0, 0).applyMatrix4(spacingScaleModelViewMatrix);
  spacingScaleOffset
    .set(spacing, 0, 0)
    .applyMatrix4(spacingScaleModelViewMatrix);

  return spacingScaleOrigin.distanceTo(spacingScaleOffset) / spacing;
}

function getValid<T>(a: T | undefined, b: T): T {
  return a === undefined ? b : a;
}

// tslint:disable:no-invalid-this
function uniform<K extends keyof IPointCloudMaterialUniforms>(
  uniformName: K,
  requireSrcUpdate: boolean = false,
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    Object.defineProperty(target, propertyKey, {
      get: function () {
        return this.getUniform(uniformName);
      },
      set: function (value: any) {
        if (value !== this.getUniform(uniformName)) {
          this.setUniform(uniformName, value);
          if (requireSrcUpdate) {
            this.updateShaderSource();
          }
        }
      },
    });
  };
}

function requiresShaderUpdate() {
  return (target: object, propertyKey: string | symbol): void => {
    const fieldName = `_${propertyKey.toString()}`;

    Object.defineProperty(target, propertyKey, {
      get: function () {
        return this[fieldName];
      },
      set: function (value: any) {
        if (value !== this[fieldName]) {
          this[fieldName] = value;
          this.updateShaderSource();
        }
      },
    });
  };
}
