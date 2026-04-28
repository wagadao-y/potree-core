import type { PotreeDatasetSource } from "./PotreeDatasetSource";
import type { PotreeResourceKind } from "./RequestManager";

type OpfsPotreeFileName = "metadata.json" | "hierarchy.bin" | "octree.bin";

type OpfsPotreeFileHandle = Pick<FileSystemFileHandle, "getFile" | "name">;

type OpfsPotreeDirectoryHandle = Pick<
  FileSystemDirectoryHandle,
  "getFileHandle"
>;

export type OpfsPotreeFileHandles = Record<
  OpfsPotreeFileName,
  OpfsPotreeFileHandle
>;

const REQUIRED_FILES: readonly OpfsPotreeFileName[] = [
  "metadata.json",
  "hierarchy.bin",
  "octree.bin",
];

const RESOURCE_FILE_NAMES: Record<PotreeResourceKind, OpfsPotreeFileName> = {
  metadata: "metadata.json",
  hierarchy: "hierarchy.bin",
  octree: "octree.bin",
};

export class OpfsPotreeDatasetSource implements PotreeDatasetSource {
  private readonly baseUrl: string;

  public constructor(
    private readonly handles: OpfsPotreeFileHandles,
    baseUrl = "opfs://dataset/",
  ) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  }

  public static async fromDirectoryHandle(
    directoryHandle: OpfsPotreeDirectoryHandle,
    baseUrl = "opfs://dataset/",
  ): Promise<OpfsPotreeDatasetSource> {
    const handles = {} as OpfsPotreeFileHandles;

    for (const fileName of REQUIRED_FILES) {
      handles[fileName] = await directoryHandle.getFileHandle(fileName);
    }

    return new OpfsPotreeDatasetSource(handles, baseUrl);
  }

  public getResourceUrl(kind: PotreeResourceKind): Promise<string> {
    return Promise.resolve(
      new URL(RESOURCE_FILE_NAMES[kind], this.baseUrl).toString(),
    );
  }

  public async fetchMetadata(): Promise<Response> {
    const file = await this.handles["metadata.json"].getFile();

    return new Response(file, {
      headers: {
        "content-type": file.type || "application/json",
        "content-length": String(file.size),
      },
    });
  }

  public async fetchRange(
    kind: Extract<PotreeResourceKind, "hierarchy" | "octree">,
    start: bigint,
    endExclusive: bigint,
  ): Promise<Response> {
    const file = await this.handles[RESOURCE_FILE_NAMES[kind]].getFile();
    const startOffset = this.toSafeNumber(start, "range start");
    const endOffset = this.toSafeNumber(endExclusive, "range end");

    if (startOffset < 0 || endOffset < startOffset || endOffset > file.size) {
      throw new Error(
        `Invalid OPFS range for ${kind}: ${startOffset}-${endOffset} of ${file.size}`,
      );
    }

    const body = file.slice(startOffset, endOffset);

    return new Response(body, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(body.size),
        "content-range": `bytes ${startOffset}-${endOffset - 1}/${file.size}`,
      },
      status: 206,
    });
  }

  private toSafeNumber(value: bigint, label: string): number {
    const numericValue = Number(value);

    if (!Number.isSafeInteger(numericValue)) {
      throw new Error(
        `OPFS ${label} exceeds Number safe integer range: ${value}`,
      );
    }

    return numericValue;
  }
}
