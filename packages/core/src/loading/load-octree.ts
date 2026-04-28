import type { LoadOctreeOptions } from "./LoadInstrumentation";
import { OctreeLoader } from "./OctreeLoader";
import { RequestManagerDatasetSource } from "./PotreeDatasetSource";
import type { RequestManager } from "./RequestManager";

/**
 * Loads an octree geometry from a specified URL using the provided request manager.
 *
 * @param url - The URL of the octree geometry to load.
 * @param requestManager - The request manager to handle network requests.
 * @returns A promise that resolves to the loaded octree geometry.
 */
export async function loadOctree(
  url: string,
  requestManager: RequestManager,
  options?: LoadOctreeOptions,
) {
  const loader = new OctreeLoader();
  const { geometry } = await loader.load(
    new RequestManagerDatasetSource(url, requestManager),
    options,
  );

  return geometry;
}
