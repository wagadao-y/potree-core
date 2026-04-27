import {
  Color,
  LinearFilter,
  NearestFilter,
  NoBlending,
  RGBAFormat,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { COLOR_BLACK } from "../constants";

const clearColor = new Color();

export function makePickRenderTarget(): WebGLRenderTarget {
  return new WebGLRenderTarget(1, 1, {
    minFilter: LinearFilter,
    magFilter: NearestFilter,
    format: RGBAFormat,
  });
}

export function updatePickRenderTarget(
  renderTarget: WebGLRenderTarget,
  width: number,
  height: number,
): WebGLRenderTarget {
  if (renderTarget.width === width && renderTarget.height === height) {
    return renderTarget;
  }

  renderTarget.dispose();
  const nextRenderTarget = makePickRenderTarget();
  nextRenderTarget.setSize(width, height);
  return nextRenderTarget;
}

export function preparePickRender(
  renderer: WebGLRenderer,
  renderTarget: WebGLRenderTarget,
  x: number,
  y: number,
  pickWindowSize: number,
  depthTest: boolean,
  depthWrite: boolean,
): void {
  renderer.setRenderTarget(renderTarget);

  const pixelRatio = renderer.getPixelRatio();
  renderer.setScissor(
    x / pixelRatio,
    y / pixelRatio,
    pickWindowSize / pixelRatio,
    pickWindowSize / pixelRatio,
  );
  renderer.setScissorTest(true);
  renderer.state.buffers.depth.setTest(depthTest);
  renderer.state.buffers.depth.setMask(depthWrite);
  renderer.state.setBlending(NoBlending);

  renderer.getClearColor(clearColor);
  const oldClearAlpha = renderer.getClearAlpha();
  renderer.setClearColor(COLOR_BLACK, 0);
  renderer.clear(true, true, true);
  renderer.setClearColor(clearColor, oldClearAlpha);
}

export function readPickPixels(
  renderer: WebGLRenderer,
  x: number,
  y: number,
  pickWindowSize: number,
): Uint8Array {
  const pixels = new Uint8Array(4 * pickWindowSize * pickWindowSize);
  renderer.readRenderTargetPixels(
    renderer.getRenderTarget()!,
    x,
    y,
    pickWindowSize,
    pickWindowSize,
    pixels,
  );
  renderer.setScissorTest(false);
  renderer.setRenderTarget(null!);
  return pixels;
}
