import { describe, expect, it } from "vitest";

import {
  PotreeFetchError,
  validateMetadataResponse,
  validateRangeResponse,
} from "./validate-fetch-response";

function makeResponse(status: number, headers?: HeadersInit): Response {
  return new Response(null, {
    status,
    headers,
  });
}

describe("validateMetadataResponse", () => {
  it("accepts successful metadata responses", () => {
    expect(() => {
      validateMetadataResponse(
        makeResponse(200),
        "https://example.test/metadata.json",
      );
    }).not.toThrow();
  });

  it("throws a PotreeFetchError for failed metadata responses", () => {
    expect(() => {
      validateMetadataResponse(
        makeResponse(404),
        "https://example.test/metadata.json",
      );
    }).toThrowError(PotreeFetchError);
  });
});

describe("validateRangeResponse", () => {
  it("accepts a matching HTTP 206 response", () => {
    expect(() => {
      validateRangeResponse(
        makeResponse(206, {
          "Content-Range": "bytes 10-19/100",
        }),
        "https://example.test/octree.bin",
        BigInt(10),
        BigInt(20),
      );
    }).not.toThrow();
  });

  it("rejects non-partial range responses", () => {
    expect(() => {
      validateRangeResponse(
        makeResponse(200, {
          "Content-Range": "bytes 10-19/100",
        }),
        "https://example.test/octree.bin",
        BigInt(10),
        BigInt(20),
      );
    }).toThrowError(/Expected HTTP 206/);
  });

  it("rejects responses with a missing content-range header", () => {
    expect(() => {
      validateRangeResponse(
        makeResponse(206),
        "https://example.test/octree.bin",
        BigInt(10),
        BigInt(20),
      );
    }).toThrowError(/Missing Content-Range/);
  });

  it("rejects responses whose content-range does not match the requested bytes", () => {
    expect(() => {
      validateRangeResponse(
        makeResponse(206, {
          "Content-Range": "bytes 11-19/100",
        }),
        "https://example.test/octree.bin",
        BigInt(10),
        BigInt(20),
      );
    }).toThrowError(/Invalid Content-Range/);
  });
});
