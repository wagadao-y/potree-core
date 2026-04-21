import brotliPromise from "brotli-dec-wasm";
import { ZSTDDecoder } from "zstddec";
import { BrotliDecode } from "./core-brotli";
import type {
  BenchmarkFixtureIndex,
  BenchmarkRequest,
  BenchmarkRoundResult,
  BenchmarkSuite,
  BenchmarkSummary,
} from "./types";

const fixtureCache = new Map<
  string,
  Promise<{ index: BenchmarkFixtureIndex; payload: Uint8Array }>
>();
const zstdDecoder = new ZSTDDecoder();

self.onmessage = async (event: MessageEvent<BenchmarkRequest>) => {
  const request = event.data;

  if (request.type !== "run") {
    return;
  }

  try {
    const summary = await runBenchmark(request);
    self.postMessage({
      type: "result",
      suite: request.suite,
      summary,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      suite: request.suite,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

async function runBenchmark(
  request: BenchmarkRequest,
): Promise<BenchmarkSummary> {
  const fixture = await loadFixture(request.indexUrl, request.payloadUrl);

  if (fixture.index.nodes.length === 0) {
    throw new Error("No benchmark nodes were generated.");
  }

  await warmDecoder(request.suite);

  self.postMessage({
    type: "progress",
    suite: request.suite,
    current: 0,
    total: request.roundCount,
    phase: "warmup",
  });

  const coldStart = await runPass(request.suite, fixture);
  const rounds: BenchmarkRoundResult[] = [];

  for (let roundIndex = 0; roundIndex < request.roundCount; roundIndex++) {
    const round = await runPass(request.suite, fixture);
    rounds.push(round);
    self.postMessage({
      type: "progress",
      suite: request.suite,
      current: roundIndex + 1,
      total: request.roundCount,
      phase: "measure",
    });
  }

  const durations = rounds.map((round) => round.durationMs).sort((a, b) => a - b);
  const durationTotal = durations.reduce((total, value) => total + value, 0);
  const meanMs = durationTotal / durations.length;
  const middleIndex = Math.floor(durations.length / 2);
  const medianMs =
    durations.length % 2 === 0
      ? (durations[middleIndex - 1] + durations[middleIndex]) / 2
      : durations[middleIndex];
  const totalBytes = fixture.index.totals.rawBytes;

  return {
    suite: request.suite,
    rounds,
    coldStartMs: coldStart.durationMs,
    checksum: coldStart.checksum,
    totalBytes,
    totalCompressedBytes: fixture.index.totals.compressedBytes,
    nodeCount: fixture.index.totals.nodes,
    meanMs,
    medianMs,
    minMs: durations[0],
    maxMs: durations[durations.length - 1],
    throughputMiBPerSec: (totalBytes / 1024 / 1024 / meanMs) * 1000,
  };
}

async function loadFixture(indexUrl: string, payloadUrl: string) {
  const cacheKey = `${indexUrl}::${payloadUrl}`;
  const cached = fixtureCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const loadingPromise = Promise.all([fetch(indexUrl), fetch(payloadUrl)]).then(
    async ([indexResponse, payloadResponse]) => {
      if (!indexResponse.ok) {
        throw new Error(`Fixture index fetch failed: ${indexResponse.status}`);
      }
      if (!payloadResponse.ok) {
        throw new Error(`Fixture payload fetch failed: ${payloadResponse.status}`);
      }

      const index = (await indexResponse.json()) as BenchmarkFixtureIndex;
      const payload = new Uint8Array(await payloadResponse.arrayBuffer());

      return { index, payload };
    },
  );

  fixtureCache.set(cacheKey, loadingPromise);
  return loadingPromise;
}

async function warmDecoder(suite: BenchmarkSuite) {
  if (suite === "js") {
    return;
  }

  if (suite === "brotli") {
    await brotliPromise;
    return;
  }

  await zstdDecoder.init();
}

async function runPass(
  suite: BenchmarkSuite,
  fixture: { index: BenchmarkFixtureIndex; payload: Uint8Array },
): Promise<BenchmarkRoundResult> {
  const decoder = await getDecoder(suite);
  let checksum = 0;
  const startedAt = performance.now();

  for (const node of fixture.index.nodes) {
    if (node.compressedSize === 0) {
      continue;
    }

    const compressed = fixture.payload.subarray(
      node.offset,
      node.offset + node.compressedSize,
    );
    const decompressed = decoder(compressed);

    if (decompressed.byteLength !== node.rawSize) {
      throw new Error(
        `Unexpected output size for ${node.name}: expected ${node.rawSize}, got ${decompressed.byteLength}`,
      );
    }

    checksum = (checksum + sampleChecksum(decompressed)) >>> 0;
  }

  return {
    durationMs: performance.now() - startedAt,
    checksum,
  };
}

async function getDecoder(suite: BenchmarkSuite) {
  if (suite === "js") {
    return (input: Uint8Array) => {
      const output = BrotliDecode(
        new Int8Array(input.buffer, input.byteOffset, input.byteLength),
      );

      return new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
    };
  }

  if (suite === "brotli") {
    const brotli = await brotliPromise;
    return (input: Uint8Array) => brotli.decompress(input);
  }

  await zstdDecoder.init();
  return (input: Uint8Array) => zstdDecoder.decode(input);
}

function sampleChecksum(bytes: Uint8Array): number {
  if (bytes.byteLength === 0) {
    return 0;
  }

  const sampleCount = Math.min(32, bytes.byteLength);
  const stride = Math.max(1, Math.floor(bytes.byteLength / sampleCount));
  let checksum = bytes.byteLength >>> 0;

  for (let index = 0; index < bytes.byteLength; index += stride) {
    checksum = Math.imul(checksum ^ bytes[index], 16777619) >>> 0;
  }

  return Math.imul(checksum ^ bytes[bytes.byteLength - 1], 16777619) >>> 0;
}