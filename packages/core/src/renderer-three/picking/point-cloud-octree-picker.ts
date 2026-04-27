import {
  type Camera,
  type Ray,
  Scene,
  Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import type { PointCloudOctree } from "../../point-cloud-octree";
import { clamp } from "../../utils/math";
import { DEFAULT_PICK_WINDOW_SIZE } from "../constants";
import { ClipMode, PointCloudMaterial, PointColorType } from "../materials";
import type { PickPoint } from "../types";
import {
  makePickRenderTarget,
  preparePickRender,
  readPickPixels,
  updatePickRenderTarget,
} from "./pick-render-target";
import { createTempNodes, nodesOnRay } from "./pick-scene";
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
    pickState.renderTarget = updatePickRenderTarget(
      pickState.renderTarget,
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

    preparePickRender(
      renderer,
      pickState.renderTarget,
      x,
      y,
      pickWndSize,
      pickMaterial.depthTest,
      pickMaterial.depthWrite,
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

    const pixels = readPickPixels(renderer, x, y, pickWndSize);

    renderer.setRenderTarget(prevRenderTarget);

    const hit = findPointCloudPickHit(pixels, pickWndSize);
    return getPointCloudPickPoint(hit, renderedNodes);
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
      const nodes = nodesOnRay(octree, ray);
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

      pickState.scene.children = createTempNodes(
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

  private static getPickState() {
    const scene = new Scene();

    // @ts-ignore
    scene.autoUpdate = false;

    const material = new PointCloudMaterial();
    material.pointColorType = PointColorType.POINT_INDEX;

    return {
      renderTarget: makePickRenderTarget(),
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
