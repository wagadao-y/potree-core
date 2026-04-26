import {
  type Camera,
  Color,
  LinearFilter,
  NearestFilter,
  NoBlending,
  Points,
  type Ray,
  RGBAFormat,
  Scene,
  Sphere,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { ClipMode, PointCloudMaterial, PointColorType } from "../materials";
import type { PointCloudOctree } from "../point-cloud-octree";
import type { PickPoint } from "../types";
import { clamp } from "../utils/math";
import { COLOR_BLACK, DEFAULT_PICK_WINDOW_SIZE } from "./constants";
import type { PointCloudOctreeNode } from "./point-cloud-octree-node";
import {
  findPointCloudPickHit,
  getPointCloudPickPoint,
  type RenderedNode,
} from "./point-cloud-pick-result";

const pointCloudOctreePickers = new WeakMap<
  PointCloudOctree,
  PointCloudOctreePicker
>();

let sharedPointCloudOctreePicker: PointCloudOctreePicker | undefined;

export interface PickParams {
  pickWindowSize: number;
  pickOutsideClipRegion: boolean;
  pixelPosition: Vector3;
  onBeforePickRender: (
    material: PointCloudMaterial,
    renterTarget: WebGLRenderTarget,
  ) => void;
}

interface IPickState {
  renderTarget: WebGLRenderTarget;
  material: PointCloudMaterial;
  scene: Scene;
}

export class PointCloudOctreePicker {
  private static readonly helperVec3 = new Vector3();

  private static readonly helperSphere = new Sphere();

  private static readonly clearColor = new Color();

  private pickState: IPickState | undefined;

  dispose() {
    if (this.pickState) {
      this.pickState.material.dispose();
      this.pickState.renderTarget.dispose();
    }
  }

  pick(
    renderer: WebGLRenderer,
    camera: Camera,
    ray: Ray,
    octrees: PointCloudOctree[],
    params: Partial<PickParams> = {},
  ): PickPoint | null {
    if (octrees.length === 0) {
      return null;
    }

    if (!this.pickState) {
      this.pickState = PointCloudOctreePicker.getPickState();
    }

    const pickState = this.pickState;
    const pickMaterial = pickState.material;

    const pixelRatio = renderer.getPixelRatio();
    const width = Math.ceil(renderer.domElement.clientWidth * pixelRatio);
    const height = Math.ceil(renderer.domElement.clientHeight * pixelRatio);
    PointCloudOctreePicker.updatePickRenderTarget(
      this.pickState,
      width,
      height,
    );

    const pixelPosition = PointCloudOctreePicker.helperVec3;

    if (params.pixelPosition) {
      pixelPosition.copy(params.pixelPosition);
    } else {
      pixelPosition.addVectors(camera.position, ray.direction).project(camera);
      pixelPosition.x = (pixelPosition.x + 1) * width * 0.5;
      pixelPosition.y = (pixelPosition.y + 1) * height * 0.5;
    }

    const pickWndSize = Math.floor(
      (params.pickWindowSize || DEFAULT_PICK_WINDOW_SIZE) * pixelRatio,
    );
    const halfPickWndSize = (pickWndSize - 1) / 2;
    const x = Math.floor(clamp(pixelPosition.x - halfPickWndSize, 0, width));
    const y = Math.floor(clamp(pixelPosition.y - halfPickWndSize, 0, height));

    const prevRenderTarget = renderer.getRenderTarget();

    PointCloudOctreePicker.prepareRender(
      renderer,
      x,
      y,
      pickWndSize,
      pickMaterial,
      pickState,
    );

    const renderedNodes = PointCloudOctreePicker.render(
      renderer,
      camera,
      pickMaterial,
      octrees,
      ray,
      pickState,
      params,
    );

    const pixels = PointCloudOctreePicker.readPixels(
      renderer,
      x,
      y,
      pickWndSize,
    );

    renderer.setRenderTarget(prevRenderTarget);

    const hit = findPointCloudPickHit(pixels, pickWndSize);
    return getPointCloudPickPoint(hit, renderedNodes);
  }

  private static prepareRender(
    renderer: WebGLRenderer,
    x: number,
    y: number,
    pickWndSize: number,
    pickMaterial: PointCloudMaterial,
    pickState: IPickState,
  ) {
    renderer.setRenderTarget(pickState.renderTarget);

    const pixelRatio = renderer.getPixelRatio();
    renderer.setScissor(
      x / pixelRatio,
      y / pixelRatio,
      pickWndSize / pixelRatio,
      pickWndSize / pixelRatio,
    );
    renderer.setScissorTest(true);
    renderer.state.buffers.depth.setTest(pickMaterial.depthTest);
    renderer.state.buffers.depth.setMask(pickMaterial.depthWrite);
    renderer.state.setBlending(NoBlending);

    renderer.getClearColor(PointCloudOctreePicker.clearColor);
    const oldClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(COLOR_BLACK, 0);
    renderer.clear(true, true, true);
    renderer.setClearColor(PointCloudOctreePicker.clearColor, oldClearAlpha);
  }

  private static render(
    renderer: WebGLRenderer,
    camera: Camera,
    pickMaterial: PointCloudMaterial,
    octrees: PointCloudOctree[],
    ray: Ray,
    pickState: IPickState,
    params: Partial<PickParams>,
  ): RenderedNode[] {
    const renderedNodes: RenderedNode[] = [];
    for (const octree of octrees) {
      const nodes = PointCloudOctreePicker.nodesOnRay(octree, ray);
      if (!nodes.length) {
        continue;
      }

      PointCloudOctreePicker.updatePickMaterial(
        pickMaterial,
        octree.material,
        params,
      );
      pickMaterial.updateMaterial(octree, nodes, camera, renderer);

      if (params.onBeforePickRender) {
        params.onBeforePickRender(pickMaterial, pickState.renderTarget);
      }

      pickState.scene.children = PointCloudOctreePicker.createTempNodes(
        octree,
        nodes,
        pickMaterial,
        renderedNodes.length,
      );

      renderer.render(pickState.scene, camera);

      nodes.forEach((node) => {
        renderedNodes.push({ node: node, octree: octree });
      });
    }
    return renderedNodes;
  }

  private static nodesOnRay(
    octree: PointCloudOctree,
    ray: Ray,
  ): PointCloudOctreeNode[] {
    const nodesOnRay: PointCloudOctreeNode[] = [];

    const rayClone = ray.clone();
    for (const node of octree.visibleNodes) {
      const sphere = PointCloudOctreePicker.helperSphere
        .copy(node.boundingSphere)
        .applyMatrix4(octree.matrixWorld);

      if (rayClone.intersectsSphere(sphere)) {
        nodesOnRay.push(node);
      }
    }

    return nodesOnRay;
  }

  private static readPixels(
    renderer: WebGLRenderer,
    x: number,
    y: number,
    pickWndSize: number,
  ): Uint8Array {
    const pixels = new Uint8Array(4 * pickWndSize * pickWndSize);
    renderer.readRenderTargetPixels(
      renderer.getRenderTarget()!,
      x,
      y,
      pickWndSize,
      pickWndSize,
      pixels,
    );
    renderer.setScissorTest(false);
    renderer.setRenderTarget(null!);
    return pixels;
  }

  private static createTempNodes(
    octree: PointCloudOctree,
    nodes: PointCloudOctreeNode[],
    pickMaterial: PointCloudMaterial,
    nodeIndexOffset: number,
  ): Points[] {
    const tempNodes: Points[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const sceneNode = node.sceneNode;
      const tempNode = new Points(sceneNode.geometry, pickMaterial);
      tempNode.matrix = sceneNode.matrixWorld;
      tempNode.matrixWorld = sceneNode.matrixWorld;
      tempNode.matrixAutoUpdate = false;
      tempNode.frustumCulled = false;
      tempNode.layers.enableAll();

      const nodeIndex = nodeIndexOffset + i + 1;
      if (nodeIndex > 255) {
        throw Error("More than 255 nodes for pick are not supported.");
      }
      tempNode.onBeforeRender = PointCloudMaterial.makeOnBeforeRender(
        octree,
        node,
        nodeIndex,
      );

      tempNodes.push(tempNode);
    }
    return tempNodes;
  }

  private static updatePickMaterial(
    pickMaterial: PointCloudMaterial,
    nodeMaterial: PointCloudMaterial,
    params: Partial<PickParams>,
  ): void {
    pickMaterial.pointSizeType = nodeMaterial.pointSizeType;
    pickMaterial.shape = nodeMaterial.shape;
    pickMaterial.size = nodeMaterial.size;
    pickMaterial.minSize = nodeMaterial.minSize;
    pickMaterial.maxSize = nodeMaterial.maxSize;
    pickMaterial.classification = nodeMaterial.classification;
    pickMaterial.useFilterByNormal = nodeMaterial.useFilterByNormal;
    pickMaterial.filterByNormalThreshold = nodeMaterial.filterByNormalThreshold;

    if (params.pickOutsideClipRegion) {
      pickMaterial.clipMode = ClipMode.DISABLED;
    } else {
      pickMaterial.clipMode = nodeMaterial.clipMode;
      pickMaterial.setClipBoxes(
        nodeMaterial.clipMode === ClipMode.CLIP_OUTSIDE
          ? nodeMaterial.clipBoxes
          : [],
      );
    }
  }

  private static updatePickRenderTarget(
    pickState: IPickState,
    width: number,
    height: number,
  ): void {
    if (
      pickState.renderTarget.width === width &&
      pickState.renderTarget.height === height
    ) {
      return;
    }

    pickState.renderTarget.dispose();
    pickState.renderTarget = PointCloudOctreePicker.makePickRenderTarget();
    pickState.renderTarget.setSize(width, height);
  }

  private static makePickRenderTarget() {
    return new WebGLRenderTarget(1, 1, {
      minFilter: LinearFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
    });
  }

  private static getPickState() {
    const scene = new Scene();

    // @ts-ignore
    scene.autoUpdate = false;

    const material = new PointCloudMaterial();
    material.pointColorType = PointColorType.POINT_INDEX;

    return {
      renderTarget: PointCloudOctreePicker.makePickRenderTarget(),
      material: material,
      scene: scene,
    };
  }
}

export function pickPointCloud(
  pointCloud: PointCloudOctree,
  renderer: WebGLRenderer,
  camera: Camera,
  ray: Ray,
  params: Partial<PickParams> = {},
): PickPoint | null {
  let picker = pointCloudOctreePickers.get(pointCloud);
  if (picker === undefined) {
    picker = new PointCloudOctreePicker();
    pointCloudOctreePickers.set(pointCloud, picker);
  }

  return picker.pick(renderer, camera, ray, [pointCloud], params);
}

export function disposePointCloudOctreePicker(
  pointCloud: PointCloudOctree,
): void {
  const picker = pointCloudOctreePickers.get(pointCloud);
  if (picker !== undefined) {
    picker.dispose();
    pointCloudOctreePickers.delete(pointCloud);
  }
}

export function pickPointClouds(
  pointClouds: PointCloudOctree[],
  renderer: WebGLRenderer,
  camera: Camera,
  ray: Ray,
  params: Partial<PickParams> = {},
): PickPoint | null {
  sharedPointCloudOctreePicker =
    sharedPointCloudOctreePicker ?? new PointCloudOctreePicker();
  return sharedPointCloudOctreePicker.pick(
    renderer,
    camera,
    ray,
    pointClouds,
    params,
  );
}
