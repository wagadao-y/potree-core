import type { PotreeResourceKind, RequestManager } from "./RequestManager";

export interface PotreeDatasetSource {
  getResourceUrl(kind: PotreeResourceKind): Promise<string>;
  fetchMetadata(): Promise<Response>;
  fetchRange(
    kind: Extract<PotreeResourceKind, "hierarchy" | "octree">,
    start: bigint,
    endExclusive: bigint,
  ): Promise<Response>;
}

export class RequestManagerDatasetSource implements PotreeDatasetSource {
  public constructor(
    private readonly url: string,
    private readonly requestManager: RequestManager,
  ) {}

  public getResourceUrl(kind: PotreeResourceKind): Promise<string> {
    return this.requestManager.getUrl(kind, this.url);
  }

  public async fetchMetadata(): Promise<Response> {
    const metadataUrl = await this.getResourceUrl("metadata");
    return this.requestManager.fetch(metadataUrl);
  }

  public async fetchRange(
    kind: Extract<PotreeResourceKind, "hierarchy" | "octree">,
    start: bigint,
    endExclusive: bigint,
  ): Promise<Response> {
    const resourceUrl = await this.getResourceUrl(kind);
    return this.requestManager.fetch(resourceUrl, {
      headers: {
        "content-type": "multipart/byteranges",
        Range: `bytes=${start}-${endExclusive - BigInt(1)}`,
      },
    });
  }
}
