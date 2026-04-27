export class PotreeFetchError extends Error {
  public constructor(
    message: string,
    public readonly code:
      | "http-error"
      | "range-status-invalid"
      | "content-range-missing"
      | "content-range-invalid",
    public readonly url: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "PotreeFetchError";
  }
}

export function validateMetadataResponse(
  response: Response,
  url: string,
): void {
  if (response.ok) {
    return;
  }

  throw new PotreeFetchError(
    `Failed to fetch metadata from ${url}: HTTP ${response.status}`,
    "http-error",
    url,
    response.status,
  );
}

export function validateRangeResponse(
  response: Response,
  url: string,
  start: bigint,
  endExclusive: bigint,
): void {
  if (!response.ok) {
    throw new PotreeFetchError(
      `Failed to fetch byte range ${start}-${endExclusive - BigInt(1)} from ${url}: HTTP ${response.status}`,
      "http-error",
      url,
      response.status,
    );
  }

  if (response.status !== 206) {
    throw new PotreeFetchError(
      `Expected HTTP 206 for byte range ${start}-${endExclusive - BigInt(1)} from ${url}, got ${response.status}`,
      "range-status-invalid",
      url,
      response.status,
    );
  }

  const contentRange = response.headers.get("content-range");
  if (contentRange === null) {
    throw new PotreeFetchError(
      `Missing Content-Range header for byte range ${start}-${endExclusive - BigInt(1)} from ${url}`,
      "content-range-missing",
      url,
      response.status,
    );
  }

  const expectedStart = start.toString();
  const expectedEnd = (endExclusive - BigInt(1)).toString();
  const expectedPrefix = `bytes ${expectedStart}-${expectedEnd}/`;

  if (!contentRange.startsWith(expectedPrefix)) {
    throw new PotreeFetchError(
      `Invalid Content-Range for ${url}: expected prefix ${expectedPrefix}, got ${contentRange}`,
      "content-range-invalid",
      url,
      response.status,
    );
  }
}
