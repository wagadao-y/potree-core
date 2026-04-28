import type { PotreeResourceKind, RequestManager } from "./RequestManager";

type MaybePromise<T> = T | Promise<T>;

export type PotreeResourceUrlResolver = () => MaybePromise<string>;

export type PotreeResourceUrlSource = string | PotreeResourceUrlResolver;

export interface PotreeResourceUrls {
  metadata: PotreeResourceUrlSource;
  hierarchy: PotreeResourceUrlSource;
  octree: PotreeResourceUrlSource;
}

export interface SignedUrlPotreeRequestManagerOptions {
  fetch?: typeof fetch;
}

export class SignedUrlPotreeRequestManager implements RequestManager {
  private readonly fetchImpl: typeof fetch;

  public constructor(
    private readonly resourceUrls: PotreeResourceUrls,
    options?: SignedUrlPotreeRequestManagerOptions,
  ) {
    this.fetchImpl = options?.fetch ?? fetch;
  }

  public fetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    return this.fetchImpl(input, init);
  }

  public async getUrl(kind: PotreeResourceKind, _url: string): Promise<string> {
    const resolved = this.resourceUrls[kind];
    return typeof resolved === "function" ? await resolved() : resolved;
  }
}
