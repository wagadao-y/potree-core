import "./style.css";
import type {
  BenchmarkFixtureIndex,
  BenchmarkSummary,
  BenchmarkSuite,
  BenchmarkWorkerMessage,
} from "./types";

const FIXTURE_INDEX_URLS: Record<BenchmarkSuite, string> = {
  js: "/fixtures/brotli/index.json",
  brotli: "/fixtures/brotli/index.json",
  zstd: "/fixtures/zstd/index.json",
};
const FIXTURE_PAYLOAD_URLS: Record<BenchmarkSuite, string> = {
  js: "/fixtures/brotli/payload.bin",
  brotli: "/fixtures/brotli/payload.bin",
  zstd: "/fixtures/zstd/payload.bin",
};
const DEFAULT_ROUNDS = 5;
const SUITE_LABELS: Record<BenchmarkSuite, string> = {
  js: "js 版の Brotli デコード",
  brotli: "brotli-dec-wasm",
  zstd: "zstddec",
};

const app = requireElement<HTMLDivElement>("#app");

app.innerHTML = `
  <main class="shell">
    <section class="title-row">
      <article class="card toolbar title-card">
        <div class="toolbar-main">
          <p class="eyebrow">Potree Decode Benchmark</p>
          <h1>pump 全ノード比較</h1>
          <p class="lede">
            Brotli 圧縮ノードでは JS 実装と brotli-dec-wasm、Zstd 圧縮ノードでは zstddec を使って展開時間を比較します。
          </p>
        </div>
        <div class="actions">
          <label class="rounds-field">
            <span>計測ラウンド数</span>
            <input id="round-count" type="number" min="1" max="20" value="${DEFAULT_ROUNDS}" />
          </label>
          <button id="run-benchmark" type="button">ベンチマーク実行</button>
        </div>
        <p id="status-line" class="status-line toolbar-status">fixture 情報を読み込み中...</p>
      </article>
    </section>

    <section class="winner-row">
      <article class="card summary-card winner-card winner-card-wide">
        <div class="card-header">
          <h2>判定</h2>
          <span class="badge accent">steady-state</span>
        </div>
        <div id="winner-panel" class="winner-panel muted">
          実行後に、平均時間とスループットから採用候補を表示します。
        </div>
      </article>
    </section>

    <section class="benchmark-grid">
      <article class="card summary-card fixture-card">
        <div class="card-header">
          <h2>Fixture</h2>
          <span class="badge">direct</span>
        </div>
        <div id="fixture-summary" class="stats-grid"></div>
      </article>

      <article class="card result-card">
        <div class="card-header">
          <h2>JS Brotli</h2>
          <span id="js-progress" class="progress-chip">待機中</span>
        </div>
        <div id="js-result" class="result-body placeholder">未計測</div>
      </article>

      <article class="card result-card">
        <div class="card-header">
          <h2>brotli-dec-wasm</h2>
          <span id="brotli-progress" class="progress-chip">待機中</span>
        </div>
        <div id="brotli-result" class="result-body placeholder">未計測</div>
      </article>

      <article class="card result-card">
        <div class="card-header">
          <h2>zstddec</h2>
          <span id="zstd-progress" class="progress-chip">待機中</span>
        </div>
        <div id="zstd-result" class="result-body placeholder">未計測</div>
      </article>
    </section>
  </main>
`;

const roundInput = requireElement<HTMLInputElement>("#round-count");
const runButton = requireElement<HTMLButtonElement>("#run-benchmark");
const statusLine = requireElement<HTMLParagraphElement>("#status-line");
const fixtureSummary = requireElement<HTMLDivElement>("#fixture-summary");
const winnerPanel = requireElement<HTMLDivElement>("#winner-panel");
const jsProgress = requireElement<HTMLSpanElement>("#js-progress");
const brotliProgress = requireElement<HTMLSpanElement>("#brotli-progress");
const zstdProgress = requireElement<HTMLSpanElement>("#zstd-progress");
const jsResult = requireElement<HTMLDivElement>("#js-result");
const brotliResult = requireElement<HTMLDivElement>("#brotli-result");
const zstdResult = requireElement<HTMLDivElement>("#zstd-result");

const benchmarkWorker = new Worker(new URL("./benchmark.worker.ts", import.meta.url), {
  type: "module",
});

let fixtureIndexes: { brotli: BenchmarkFixtureIndex; zstd: BenchmarkFixtureIndex } | null =
  null;
let isRunning = false;

void initialize();

runButton.addEventListener("click", () => {
  void runBenchmarks();
});

async function initialize() {
  try {
    const [brotliResponse, zstdResponse] = await Promise.all([
      fetch(FIXTURE_INDEX_URLS.brotli),
      fetch(FIXTURE_INDEX_URLS.zstd),
    ]);

    if (!brotliResponse.ok) {
      throw new Error(`Brotli fixture index fetch failed with ${brotliResponse.status}`);
    }
    if (!zstdResponse.ok) {
      throw new Error(`Zstd fixture index fetch failed with ${zstdResponse.status}`);
    }

    fixtureIndexes = {
      brotli: (await brotliResponse.json()) as BenchmarkFixtureIndex,
      zstd: (await zstdResponse.json()) as BenchmarkFixtureIndex,
    };
    renderFixtureSummary(fixtureIndexes.brotli, fixtureIndexes.zstd);
    statusLine.textContent = "fixture 読み込み完了。計測を開始できます。";
  } catch (error) {
    statusLine.textContent = formatError(error);
    runButton.disabled = true;
  }
}

async function runBenchmarks() {
  if (isRunning || fixtureIndexes === null) {
    return;
  }

  isRunning = true;
  runButton.disabled = true;
  const roundCount = clampRounds(roundInput.valueAsNumber);
  roundInput.value = String(roundCount);
  statusLine.textContent = `計測を開始します。Brotli 2 系統と Zstd を各 ${roundCount} ラウンドで順に比較します。`;
  jsResult.innerHTML = "<p class=\"placeholder\">計測中...</p>";
  brotliResult.innerHTML = "<p class=\"placeholder\">計測中...</p>";
  zstdResult.innerHTML = "<p class=\"placeholder\">計測待機中...</p>";
  winnerPanel.classList.add("muted");
  winnerPanel.textContent = "計測結果を集計中です。";
  setProgress(jsProgress, "待機中", false);
  setProgress(brotliProgress, "待機中", false);
  setProgress(zstdProgress, "待機中", false);

  try {
    const jsSummary = await runSuite("js", roundCount);
    jsResult.innerHTML = renderResult(jsSummary);

    const brotliSummary = await runSuite("brotli", roundCount);
    brotliResult.innerHTML = renderResult(brotliSummary);

    const zstdSummary = await runSuite("zstd", roundCount);
    zstdResult.innerHTML = renderResult(zstdSummary);

    renderWinner(jsSummary, brotliSummary, zstdSummary);
    statusLine.textContent = "計測が完了しました。steady-state の平均時間で比較しています。";
  } catch (error) {
    statusLine.textContent = formatError(error);
  } finally {
    isRunning = false;
    runButton.disabled = fixtureIndexes === null;
  }
}

function runSuite(suite: BenchmarkSuite, roundCount: number) {
  setProgress(getProgressElement(suite), "準備中", true);

  return new Promise<BenchmarkSummary>((resolve, reject) => {
    const onMessage = (event: MessageEvent<BenchmarkWorkerMessage>) => {
      const message = event.data;
      if (message.suite !== suite) {
        return;
      }

      if (message.type === "progress") {
        const label =
          message.phase === "warmup"
            ? "ウォームアップ"
            : `${message.current}/${message.total} ラウンド`;
        setProgress(getProgressElement(suite), label, true);
        return;
      }

      benchmarkWorker.removeEventListener("message", onMessage);

      if (message.type === "error") {
        setProgress(getProgressElement(suite), "失敗", false);
        reject(new Error(message.message));
        return;
      }

      setProgress(getProgressElement(suite), "完了", false);
      resolve(message.summary);
    };

    benchmarkWorker.addEventListener("message", onMessage);
    benchmarkWorker.postMessage({
      type: "run",
      suite,
      roundCount,
      indexUrl: FIXTURE_INDEX_URLS[suite],
      payloadUrl: FIXTURE_PAYLOAD_URLS[suite],
    });
  });
}

function renderFixtureSummary(
  brotliIndex: BenchmarkFixtureIndex,
  zstdIndex: BenchmarkFixtureIndex,
) {
  const compressedDeltaPercent =
    brotliIndex.totals.compressedBytes === 0
      ? 0
      : ((zstdIndex.totals.compressedBytes - brotliIndex.totals.compressedBytes) /
          brotliIndex.totals.compressedBytes) *
        100;
  const items = [
    ["データセット", brotliIndex.datasetName],
    ["Brotli encoding", brotliIndex.originalEncoding],
    ["Zstd encoding", zstdIndex.originalEncoding],
    [
      "ノード数",
      formatComparableInteger(brotliIndex.totals.nodes, zstdIndex.totals.nodes),
    ],
    [
      "ポイント総数",
      formatComparableInteger(brotliIndex.totals.points, zstdIndex.totals.points),
    ],
    [
      "生データ総量",
      formatComparableBytes(brotliIndex.totals.rawBytes, zstdIndex.totals.rawBytes),
    ],
    ["Brotli 圧縮量", formatBytes(brotliIndex.totals.compressedBytes)],
    ["Zstd 圧縮量", formatBytes(zstdIndex.totals.compressedBytes)],
    ["圧縮差分", formatPercent(compressedDeltaPercent)],
    ["Brotli 圧縮率", `${brotliIndex.totals.compressionRatio.toFixed(2)}x`],
    ["Zstd 圧縮率", `${zstdIndex.totals.compressionRatio.toFixed(2)}x`],
    ["Brotli ソース", brotliIndex.sourceMetadataPath],
    ["Zstd ソース", zstdIndex.sourceMetadataPath],
  ];

  fixtureSummary.innerHTML = items
    .map(
      ([label, value]) => `
        <div class="stat">
          <span class="stat-label">${label}</span>
          <strong class="stat-value">${value}</strong>
        </div>
      `,
    )
    .join("");
}

function renderResult(summary: BenchmarkSummary) {
  const rows = [
    ["cold start", formatMs(summary.coldStartMs)],
    ["mean", formatMs(summary.meanMs)],
    ["median", formatMs(summary.medianMs)],
    ["min", formatMs(summary.minMs)],
    ["max", formatMs(summary.maxMs)],
    ["throughput", `${summary.throughputMiBPerSec.toFixed(2)} MiB/s`],
    ["nodes", formatInteger(summary.nodeCount)],
    ["raw bytes", formatBytes(summary.totalBytes)],
    ["compressed bytes", formatBytes(summary.totalCompressedBytes)],
    ["checksum", `0x${summary.checksum.toString(16).padStart(8, "0")}`],
  ];

  return `
    <dl class="result-list">
      ${rows
        .map(
          ([label, value]) => `
            <div class="result-row">
              <dt>${label}</dt>
              <dd>${value}</dd>
            </div>
          `,
        )
        .join("")}
    </dl>
  `;
}

function renderWinner(
  jsSummary: BenchmarkSummary,
  brotliSummary: BenchmarkSummary,
  zstdSummary: BenchmarkSummary,
) {
  const summaries = [jsSummary, brotliSummary, zstdSummary];
  const sorted = [...summaries].sort((left, right) => left.meanMs - right.meanMs);
  const faster = sorted[0];
  const runnerUp = sorted[1];
  const speedup = runnerUp.meanMs / faster.meanMs;
  const delta = runnerUp.meanMs - faster.meanMs;
  const compressedDeltaPercent =
    brotliSummary.totalCompressedBytes === 0
      ? 0
      : ((zstdSummary.totalCompressedBytes - brotliSummary.totalCompressedBytes) /
          brotliSummary.totalCompressedBytes) *
        100;
  const suiteLabel = SUITE_LABELS[faster.suite];

  winnerPanel.classList.remove("muted");
  winnerPanel.innerHTML = `
    <strong>${suiteLabel}</strong>
    <span class="winner-text">平均 ${formatMs(faster.meanMs)} で完了し、次点より ${formatMs(delta)} 短く、${speedup.toFixed(2)}x 高速です。Brotli 側は ${formatBytes(brotliSummary.totalBytes)}、Zstd 側は ${formatBytes(zstdSummary.totalBytes)} の pump 全ノードです。Zstd の圧縮量差分は Brotli 比 ${formatPercent(compressedDeltaPercent)} です。</span>
  `;
}

function getProgressElement(suite: BenchmarkSuite) {
  if (suite === "js") {
    return jsProgress;
  }

  return suite === "brotli" ? brotliProgress : zstdProgress;
}

function requireElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);

  if (element === null) {
    throw new Error(`Required element not found: ${selector}`);
  }

  return element;
}

function setProgress(element: HTMLSpanElement, text: string, active: boolean) {
  element.textContent = text;
  element.classList.toggle("active", active);
}

function clampRounds(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_ROUNDS;
  }

  return Math.min(20, Math.max(1, Math.round(value)));
}

function formatMs(value: number) {
  return `${value.toFixed(2)} ms`;
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("ja-JP").format(value);
}

function formatComparableInteger(left: number, right: number) {
  return left === right
    ? formatInteger(left)
    : `${formatInteger(left)} / ${formatInteger(right)}`;
}

function formatBytes(value: number) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 100 || unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatComparableBytes(left: number, right: number) {
  return left === right
    ? formatBytes(left)
    : `${formatBytes(left)} / ${formatBytes(right)}`;
}

function formatPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return `エラー: ${error.message}`;
  }

  return `エラー: ${String(error)}`;
}
