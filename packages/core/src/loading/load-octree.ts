import type { LoadOctreeOptions } from "./LoadInstrumentation";
import { OctreeLoader } from "./OctreeLoader";
import type { PotreeDatasetSource } from "./PotreeDatasetSource";

/**
 * Loads an octree geometry from a specified URL using the provided request manager.
 *
 * @param url - The URL of the octree geometry to load.
 * @param requestManager - The request manager to handle network requests.
 * @returns A promise that resolves to the loaded octree geometry.
 */
export async function loadOctree(
  datasetSource: PotreeDatasetSource,
  options?: LoadOctreeOptions,
) {
  const loader = new OctreeLoader();
  const { geometry } = await loader.load(datasetSource, options);

  return geometry;
}
