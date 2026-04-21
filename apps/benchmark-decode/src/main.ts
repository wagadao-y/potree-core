import "./style.css";
import type {
  BenchmarkFixtureIndex,
  BenchmarkSummary,
  BenchmarkSuite,
  BenchmarkWorkerMessage,
} from "./types";

const FIXTURE_INDEX_URL = "/fixtures/pump/index.json";
const FIXTURE_PAYLOAD_URL = "/fixtures/pump/payload.bin";
const DEFAULT_ROUNDS = 5;

const app = requireElement<HTMLDivElement>("#app");

app.innerHTML = `
  <main class="shell">
    <section class="toolbar card">
      <div class="toolbar-main">
        <p class="eyebrow">Potree Brotli Decode Benchmark</p>
        <h1>pump 全ノード比較</h1>
        <p class="lede">
          実際の Brotli 圧縮ノードを使って JS 実装と wasm 実装の展開時間を比較します。
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
    </section>

    <section class="overview-grid">
      <article class="card summary-card fixture-card">
        <div class="card-header">
          <h2>Fixture</h2>
          <span class="badge">direct</span>
        </div>
        <div id="fixture-summary" class="stats-grid"></div>
      </article>

      <article class="card summary-card winner-card">
        <div class="card-header">
          <h2>判定</h2>
          <span class="badge accent">steady-state</span>
        </div>
        <div id="winner-panel" class="winner-panel muted">
          実行後に、平均時間とスループットから採用候補を表示します。
        </div>
      </article>

      <article class="card result-card">
        <div class="card-header">
          <h2>core JS Brotli</h2>
          <span id="js-progress" class="progress-chip">待機中</span>
        </div>
        <div id="js-result" class="result-body placeholder">未計測</div>
      </article>

      <article class="card result-card">
        <div class="card-header">
          <h2>brotli-dec-wasm</h2>
          <span id="wasm-progress" class="progress-chip">待機中</span>
        </div>
        <div id="wasm-result" class="result-body placeholder">未計測</div>
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
const wasmProgress = requireElement<HTMLSpanElement>("#wasm-progress");
const jsResult = requireElement<HTMLDivElement>("#js-result");
const wasmResult = requireElement<HTMLDivElement>("#wasm-result");

const benchmarkWorker = new Worker(new URL("./benchmark.worker.ts", import.meta.url), {
  type: "module",
});

let fixtureIndex: BenchmarkFixtureIndex | null = null;
let isRunning = false;

void initialize();

runButton.addEventListener("click", () => {
  void runBenchmarks();
});

async function initialize() {
  try {
    const response = await fetch(FIXTURE_INDEX_URL);
    if (!response.ok) {
      throw new Error(`fixture index fetch failed with ${response.status}`);
    }

    fixtureIndex = (await response.json()) as BenchmarkFixtureIndex;
    renderFixtureSummary(fixtureIndex);
    statusLine.textContent = "fixture 読み込み完了。計測を開始できます。";
  } catch (error) {
    statusLine.textContent = formatError(error);
    runButton.disabled = true;
  }
}

async function runBenchmarks() {
  if (isRunning || fixtureIndex === null) {
    return;
  }

  isRunning = true;
  runButton.disabled = true;
  const roundCount = clampRounds(roundInput.valueAsNumber);
  roundInput.value = String(roundCount);
  statusLine.textContent = `計測を開始します。対象ノード ${fixtureIndex.totals.nodes} 件、${roundCount} ラウンドです。`;
  jsResult.innerHTML = "<p class=\"placeholder\">計測中...</p>";
  wasmResult.innerHTML = "<p class=\"placeholder\">計測待機中...</p>";
  winnerPanel.classList.add("muted");
  winnerPanel.textContent = "計測結果を集計中です。";
  setProgress(jsProgress, "待機中", false);
  setProgress(wasmProgress, "待機中", false);

  try {
    const jsSummary = await runSuite("js", roundCount);
    jsResult.innerHTML = renderResult(jsSummary);

    const wasmSummary = await runSuite("wasm", roundCount);
    wasmResult.innerHTML = renderResult(wasmSummary);

    renderWinner(jsSummary, wasmSummary);
    statusLine.textContent = "計測が完了しました。steady-state の平均時間で比較しています。";
  } catch (error) {
    statusLine.textContent = formatError(error);
  } finally {
    isRunning = false;
    runButton.disabled = fixtureIndex === null;
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
      indexUrl: FIXTURE_INDEX_URL,
      payloadUrl: FIXTURE_PAYLOAD_URL,
    });
  });
}

function renderFixtureSummary(index: BenchmarkFixtureIndex) {
  const items = [
    ["元 metadata encoding", index.originalEncoding],
    ["ノード数", formatInteger(index.totals.nodes)],
    ["ポイント総数", formatInteger(index.totals.points)],
    ["生データ総量", formatBytes(index.totals.rawBytes)],
    ["圧縮後総量", formatBytes(index.totals.compressedBytes)],
    ["圧縮率", `${index.totals.compressionRatio.toFixed(2)}x`],
    ["圧縮ソース", index.compression.source],
    ["ソース", index.sourceMetadataPath],
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

function renderWinner(jsSummary: BenchmarkSummary, wasmSummary: BenchmarkSummary) {
  const faster = jsSummary.meanMs <= wasmSummary.meanMs ? jsSummary : wasmSummary;
  const slower = faster.suite === "js" ? wasmSummary : jsSummary;
  const speedup = slower.meanMs / faster.meanMs;
  const delta = slower.meanMs - faster.meanMs;
  const suiteLabel = faster.suite === "js" ? "core JS Brotli" : "brotli-dec-wasm";

  winnerPanel.classList.remove("muted");
  winnerPanel.innerHTML = `
    <strong>${suiteLabel}</strong>
    <p>
      平均 ${formatMs(faster.meanMs)} で完了し、もう一方より ${formatMs(delta)} 短く、
      ${speedup.toFixed(2)}x 高速です。
    </p>
    <p>比較対象は ${formatBytes(faster.totalBytes)} の pump 全ノードです。</p>
  `;
}

function getProgressElement(suite: BenchmarkSuite) {
  return suite === "js" ? jsProgress : wasmProgress;
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

function formatError(error: unknown) {
  if (error instanceof Error) {
    return `エラー: ${error.message}`;
  }

  return `エラー: ${String(error)}`;
}
