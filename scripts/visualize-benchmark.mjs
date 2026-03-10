import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, resolve } from "path";

function parseCsv(csvText) {
  const lines = csvText.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row = {};
    headers.forEach((h, i) => {
      const value = cols[i] ?? "";
      const num = Number(value);
      row[h] = Number.isFinite(num) && value.trim() !== "" ? num : value;
    });
    return row;
  });
}

function findLatestBenchmarkDir(baseDir) {
  const dirs = readdirSync(baseDir)
    .map((name) => ({ name, full: join(baseDir, name) }))
    .filter((x) => statSync(x.full).isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  if (dirs.length === 0) {
    throw new Error(`No benchmark directories found in ${baseDir}`);
  }
  return dirs[dirs.length - 1].full;
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function colorForIndex(i) {
  const palette = ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948"];
  return palette[i % palette.length];
}

function renderBarChart(title, rows, valueKey, labelKey, options = {}) {
  const width = 860;
  const barHeight = 36;
  const leftPad = 240;
  const topPad = 24;
  const maxValue = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);
  const chartHeight = topPad + rows.length * barHeight + 20;
  const chartWidth = width - leftPad - 60;
  const format = options.format ?? ((x) => String(Number(x).toFixed(2)));
  const scale = options.scale === "log" ? (v) => Math.log10(1 + v) / Math.log10(1 + maxValue) : (v) => v / maxValue;

  const bars = rows
    .map((row, i) => {
      const raw = Number(row[valueKey]) || 0;
      const ratio = Math.max(0, Math.min(1, scale(raw)));
      const w = Math.max(1, ratio * chartWidth);
      const y = topPad + i * barHeight;
      return `
        <text x="8" y="${y + 22}" class="axisLabel">${esc(row[labelKey])}</text>
        <rect x="${leftPad}" y="${y + 6}" width="${w}" height="22" fill="${colorForIndex(i)}" rx="6"></rect>
        <text x="${leftPad + w + 8}" y="${y + 22}" class="valueLabel">${esc(format(raw))}</text>
      `;
    })
    .join("");

  return `
    <section class="card">
      <h3>${esc(title)}</h3>
      <svg width="${width}" height="${chartHeight}" viewBox="0 0 ${width} ${chartHeight}">
        <line x1="${leftPad}" y1="${topPad - 2}" x2="${leftPad}" y2="${chartHeight - 12}" stroke="#cfd8e3" />
        ${bars}
      </svg>
    </section>
  `;
}

function renderSignificanceHeatmap(sigRows) {
  const names = Array.from(
    new Set(sigRows.flatMap((r) => [String(r.algorithm_a), String(r.algorithm_b)]))
  );
  const pMap = new Map();
  sigRows.forEach((r) => {
    const a = String(r.algorithm_a);
    const b = String(r.algorithm_b);
    const p = Number(r.wilcoxon_pvalue);
    pMap.set(`${a}|${b}`, p);
    pMap.set(`${b}|${a}`, p);
  });

  const header = names.map((n) => `<th>${esc(n)}</th>`).join("");
  const rows = names
    .map((a) => {
      const tds = names
        .map((b) => {
          if (a === b) return `<td class="diag">-</td>`;
          const p = Number(pMap.get(`${a}|${b}`) ?? 1);
          const sig = p < 0.05;
          return `<td class="${sig ? "sig" : "ns"}">${p.toFixed(4)}</td>`;
        })
        .join("");
      return `<tr><th>${esc(a)}</th>${tds}</tr>`;
    })
    .join("");

  return `
    <section class="card">
      <h3>Wilcoxon p-value Heatmap (Objective Score)</h3>
      <table class="heatmap">
        <thead><tr><th></th>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="legend"><span class="dot sigDot"></span> p &lt; 0.05 (significant) &nbsp; <span class="dot nsDot"></span> p ≥ 0.05</p>
    </section>
  `;
}

function renderScenarioTable(detailRows) {
  const byScenarioAlgo = new Map();
  detailRows.forEach((r) => {
    const key = `${r.scenario}|${r.algorithm}`;
    const arr = byScenarioAlgo.get(key) ?? [];
    arr.push(Number(r.objective_score) || 0);
    byScenarioAlgo.set(key, arr);
  });

  const scenarios = Array.from(new Set(detailRows.map((r) => String(r.scenario))));
  const algos = Array.from(new Set(detailRows.map((r) => String(r.algorithm))));

  const header = algos.map((a) => `<th>${esc(a)}</th>`).join("");
  const body = scenarios
    .map((s) => {
      const cells = algos
        .map((a) => {
          const vals = byScenarioAlgo.get(`${s}|${a}`) ?? [];
          const avg = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : 0;
          return `<td>${avg.toFixed(2)}</td>`;
        })
        .join("");
      return `<tr><th>${esc(s)}</th>${cells}</tr>`;
    })
    .join("");

  return `
    <section class="card">
      <h3>Average Objective Score by Scenario</h3>
      <table class="matrix">
        <thead><tr><th>Scenario</th>${header}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </section>
  `;
}

function buildHtml({ runDir, summaryRows, detailRows, sigRows }) {
  const sortedByObjective = [...summaryRows].sort((a, b) => Number(b.objective_mean) - Number(a.objective_mean));
  const runtimeSorted = [...summaryRows].sort((a, b) => Number(a.runtime_mean_ms) - Number(b.runtime_mean_ms));

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Scheduler Benchmark Visualization</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f4f7fb; color: #1b2430; }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 28px 20px 40px; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    .sub { color: #5a6679; margin-bottom: 18px; }
    .grid { display: grid; gap: 14px; }
    .card { background: white; border: 1px solid #dbe3ef; border-radius: 14px; padding: 14px 16px; box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04); }
    h3 { margin: 2px 0 10px; font-size: 18px; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { border: 1px solid #e4ebf5; padding: 6px 8px; text-align: left; }
    th { background: #f8fbff; }
    .heatmap td { text-align: center; font-variant-numeric: tabular-nums; }
    .diag { background: #f7f9fc; color: #98a4b8; }
    .sig { background: #ffe1e1; color: #8c1a1a; font-weight: 600; }
    .ns { background: #e6f7ea; color: #125b2a; }
    .legend { font-size: 12px; color: #5a6679; margin-top: 10px; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 10px; margin-right: 6px; vertical-align: middle; }
    .sigDot { background: #ffb7b7; }
    .nsDot { background: #c6f1ce; }
    .axisLabel { font-size: 12px; fill: #334155; }
    .valueLabel { font-size: 12px; fill: #1e293b; font-weight: 600; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Scheduler Benchmark Visualization</h1>
    <div class="sub">Run directory: <code>${esc(runDir)}</code></div>
    <div class="grid">
      ${renderBarChart("Objective Score (Higher is Better)", sortedByObjective, "objective_mean", "algorithm", {
        format: (x) => x.toFixed(3),
      })}
      ${renderBarChart("Runtime Mean ms (Lower is Better, Log Scale)", runtimeSorted, "runtime_mean_ms", "algorithm", {
        format: (x) => x.toFixed(3),
        scale: "log",
      })}
      ${renderScenarioTable(detailRows)}
      ${renderSignificanceHeatmap(sigRows)}
    </div>
  </div>
</body>
</html>`;
}

function main() {
  const baseDir = resolve(process.cwd(), "generated", "scheduler-benchmarks");
  const providedDir = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : null;
  const runDir = providedDir ?? findLatestBenchmarkDir(baseDir);

  const summaryCsv = readFileSync(join(runDir, "benchmark_summary.csv"), "utf8");
  const detailsCsv = readFileSync(join(runDir, "benchmark_details.csv"), "utf8");
  const sigCsv = readFileSync(join(runDir, "benchmark_significance.csv"), "utf8");

  const summaryRows = parseCsv(summaryCsv);
  const detailRows = parseCsv(detailsCsv);
  const sigRows = parseCsv(sigCsv);

  const html = buildHtml({ runDir, summaryRows, detailRows, sigRows });
  const outPath = join(runDir, "benchmark_visualization.html");
  writeFileSync(outPath, html, "utf8");
  console.log(`Visualization generated: ${outPath}`);
}

main();
