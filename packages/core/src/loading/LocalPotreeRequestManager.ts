import type { RequestManager } from "./RequestManager";

type LocalPotreeFileName = "metadata.json" | "hierarchy.bin" | "octree.bin";

type LocalPotreeFiles = Record<LocalPotreeFileName, File>;

const REQUIRED_FILES: LocalPotreeFileName[] = [
  "metadata.json",
  "hierarchy.bin",
  "octree.bin",
];

export class LocalPotreeRequestManager implements RequestManager {
  private readonly files: LocalPotreeFiles;

  private readonly baseUrl: string;

  public constructor(
    files: Partial<LocalPotreeFiles>,
    baseUrl = "localpotree://dataset/",
  ) {
    this.files = LocalPotreeRequestManager.validateFiles(files);
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  }

  public async fetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const resourceUrl = this.extractUrl(input);
    const fileName = this.resolveFileName(resourceUrl);
    const file = this.files[fileName];

    if (fileName === "metadata.json") {
      return new Response(file, {
        headers: {
          "content-type": "application/json",
          "content-length": String(file.size),
        },
      });
    }

    const range = this.parseRangeHeader(init?.headers);
    const body =
      range === null ? file : file.slice(range.start, range.endExclusive);

    return new Response(body, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(body.size),
        "content-range": range
          ? `bytes ${range.start}-${range.endExclusive - 1}/${file.size}`
          : `bytes 0-${file.size - 1}/${file.size}`,
      },
      status: range === null ? 200 : 206,
    });
  }

  public async getUrl(url: string): Promise<string> {
    const fileName = this.resolveFileName(url);
    return new URL(fileName, this.baseUrl).toString();
  }

  public static fromFileList(fileList: FileList | Iterable<File>) {
    const files: Partial<LocalPotreeFiles> = {};

    for (const file of Array.from(fileList)) {
      if (LocalPotreeRequestManager.isRequiredFileName(file.name)) {
        files[file.name] = file;
      }
    }

    return new LocalPotreeRequestManager(files);
  }

  public static hasRequiredFiles(fileList: FileList | Iterable<File>) {
    const names = new Set(Array.from(fileList, (file) => file.name));
    return REQUIRED_FILES.every((fileName) => names.has(fileName));
  }

  private static isRequiredFileName(
    fileName: string,
  ): fileName is LocalPotreeFileName {
    return REQUIRED_FILES.includes(fileName as LocalPotreeFileName);
  }

  private static validateFiles(
    files: Partial<LocalPotreeFiles>,
  ): LocalPotreeFiles {
    for (const fileName of REQUIRED_FILES) {
      if (!(files[fileName] instanceof File)) {
        throw new Error(`Missing local Potree file: ${fileName}`);
      }
    }

    return files as LocalPotreeFiles;
  }

  private extractUrl(input: RequestInfo | URL) {
    if (typeof input === "string") {
      return input;
    }

    if (input instanceof URL) {
      return input.toString();
    }

    return input.url;
  }

  private resolveFileName(url: string): LocalPotreeFileName {
    const normalizedUrl = url.startsWith(this.baseUrl)
      ? url
      : new URL(url, this.baseUrl).toString();
    const fileName = new URL(normalizedUrl).pathname.split("/").at(-1);

    if (
      fileName === undefined ||
      !LocalPotreeRequestManager.isRequiredFileName(fileName)
    ) {
      throw new Error(`Unsupported local Potree resource: ${url}`);
    }

    return fileName;
  }

  private parseRangeHeader(headers?: HeadersInit) {
    const rangeHeader = this.getHeaderValue(headers, "range");

    if (rangeHeader === null) {
      return null;
    }

    const match = /^bytes=(\d+)-(\d+)$/i.exec(rangeHeader.trim());

    if (match === null) {
      throw new Error(`Unsupported Range header: ${rangeHeader}`);
    }

    const start = Number.parseInt(match[1], 10);
    const endInclusive = Number.parseInt(match[2], 10);

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(endInclusive) ||
      endInclusive < start
    ) {
      throw new Error(`Invalid Range header: ${rangeHeader}`);
    }

    return {
      start,
      endExclusive: endInclusive + 1,
    };
  }

  private getHeaderValue(headers: HeadersInit | undefined, name: string) {
    if (headers === undefined) {
      return null;
    }

    if (headers instanceof Headers) {
      return headers.get(name);
    }

    if (Array.isArray(headers)) {
      const match = headers.find(
        ([headerName]) => headerName.toLowerCase() === name.toLowerCase(),
      );
      return match?.[1] ?? null;
    }

    for (const [headerName, headerValue] of Object.entries(headers)) {
      if (headerName.toLowerCase() === name.toLowerCase()) {
        return headerValue;
      }
    }

    return null;
  }
}
