import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { performance } from "perf_hooks";
import {
  generateScheduledEntries,
  SCHEDULER_ALGORITHMS,
  type SchedulerAlgorithmId,
  type SchedulerInput,
  type SchedulerSourceEntry,
} from "../algorithms/lessonPlanScheduler";

type ScenarioConfig = {
  id: string;
  label: string;
  weeks: number;
  meetingsPerWeek: 2 | 3 | 4 | 5;
  lessons: number;
  writtenWork: number;
  performanceTask: number;
  exams: number;
};

type BenchmarkRow = {
  scenario: string;
  repeat_idx: number;
  seed: number;
  algorithm_id: string;
  algorithm: string;
  runtime_ms: number;
  coverage_pct: number;
  lesson_order_pct: number;
  assessment_window_pct: number;
  load_balance_pct: number;
  objective_score: number;
  generated_items: number;
};

type SummaryRow = {
  algorithm_id: string;
  algorithm: string;
  n: number;
  objective_mean: number;
  objective_ci95: number;
  coverage_mean: number;
  lesson_order_mean: number;
  assessment_window_mean: number;
  load_balance_mean: number;
  runtime_mean_ms: number;
  runtime_ci95_ms: number;
};

type SignificanceRow = {
  algorithm_a: string;
  algorithm_b: string;
  n_pairs: number;
  mean_diff_a_minus_b: number;
  paired_t_pvalue: number;
  wilcoxon_pvalue: number;
};

const TARGET_CATEGORIES = new Set(["lesson", "written_work", "performance_task", "exam"]);

const WINDOW_BY_CATEGORY: Record<"written_work" | "performance_task" | "exam", [number, number]> = {
  written_work: [0.12, 0.58],
  performance_task: [0.45, 0.88],
  exam: [0.76, 0.98],
};

const SCENARIOS: ScenarioConfig[] = [
  {
    id: "S1",
    label: "Light Load (8 weeks, 2 meetings/week)",
    weeks: 8,
    meetingsPerWeek: 2,
    lessons: 10,
    writtenWork: 3,
    performanceTask: 2,
    exams: 1,
  },
  {
    id: "S2",
    label: "Standard Load (12 weeks, 3 meetings/week)",
    weeks: 12,
    meetingsPerWeek: 3,
    lessons: 18,
    writtenWork: 6,
    performanceTask: 4,
    exams: 2,
  },
  {
    id: "S3",
    label: "Dense Load (18 weeks, 4 meetings/week)",
    weeks: 18,
    meetingsPerWeek: 4,
    lessons: 28,
    writtenWork: 10,
    performanceTask: 7,
    exams: 3,
  },
  {
    id: "S4",
    label: "Very Dense (20 weeks, 5 meetings/week)",
    weeks: 20,
    meetingsPerWeek: 5,
    lessons: 34,
    writtenWork: 12,
    performanceTask: 9,
    exams: 4,
  },
];

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map((v) => Number(v));
  const next = new Date(y, (m || 1) - 1, d || 1);
  next.setDate(next.getDate() + days);
  return isoDate(next.getFullYear(), next.getMonth() + 1, next.getDate());
}

function parseDate(iso: string) {
  const [y, m, d] = iso.split("-").map((v) => Number(v));
  return new Date(y, (m || 1) - 1, d || 1);
}

function enumerateDates(startDate: string, endDate: string) {
  const out: string[] = [];
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    out.push(isoDate(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()));
  }
  return out;
}

function weekdayPool(meetingsPerWeek: ScenarioConfig["meetingsPerWeek"]) {
  if (meetingsPerWeek === 2) return ["monday", "wednesday"];
  if (meetingsPerWeek === 3) return ["monday", "wednesday", "friday"];
  if (meetingsPerWeek === 4) return ["monday", "tuesday", "thursday", "friday"];
  return ["monday", "tuesday", "wednesday", "thursday", "friday"];
}

function toWeekdayIndex(name: string) {
  if (name === "sunday") return 0;
  if (name === "monday") return 1;
  if (name === "tuesday") return 2;
  if (name === "wednesday") return 3;
  if (name === "thursday") return 4;
  if (name === "friday") return 5;
  return 6;
}

function getCount(description: string | null) {
  if (!description) return 0;
  const m = description.match(/\d+/);
  return m ? Number(m[0]) : 0;
}

function extractLessonNumber(title: string) {
  const m = title.match(/lesson\s*(\d+)/i);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function buildScenarioInput(scenario: ScenarioConfig): Omit<SchedulerInput, "algorithm"> {
  const startDate = "2026-06-01";
  const endDate = addDays(startDate, scenario.weeks * 7 - 1);
  const weekdays = weekdayPool(scenario.meetingsPerWeek);

  const recurringRows: SchedulerSourceEntry[] = weekdays.map((day, i) => ({
    plan_entry_id: `rec_${scenario.id}_${day}_${i + 1}`,
    lesson_plan_id: `plan_${scenario.id}`,
    title: `${day} meeting`,
    category: "lesson",
    description: null,
    scheduled_date: null,
    start_time: i % 2 === 0 ? "08:00:00" : "13:00:00",
    end_time: i % 2 === 0 ? "10:00:00" : "15:00:00",
    entry_type: "recurring_class",
    day,
    room: i % 2 === 0 ? "lecture" : "laboratory",
    instance_no: i + 1,
  }));

  const lessonRows: SchedulerSourceEntry[] = Array.from({ length: scenario.lessons }, (_, i) => ({
    plan_entry_id: `lesson_${scenario.id}_${i + 1}`,
    lesson_plan_id: `plan_${scenario.id}`,
    title: `Lesson ${i + 1}: Topic ${i + 1}`,
    category: "lesson",
    description: `Synthetic lesson ${i + 1}`,
    scheduled_date: addDays(startDate, i),
    start_time: null,
    end_time: null,
    entry_type: "planned_item",
    day: null,
    room: null,
    instance_no: null,
  }));

  const requirementRows: SchedulerSourceEntry[] = [
    {
      plan_entry_id: `ww_${scenario.id}`,
      lesson_plan_id: `plan_${scenario.id}`,
      title: "Written Work",
      category: "written_work",
      description: `Count: ${scenario.writtenWork}`,
      scheduled_date: endDate,
      start_time: null,
      end_time: null,
      entry_type: "planned_item",
      day: null,
      room: null,
      instance_no: null,
    },
    {
      plan_entry_id: `pt_${scenario.id}`,
      lesson_plan_id: `plan_${scenario.id}`,
      title: "Performance Task",
      category: "performance_task",
      description: `Count: ${scenario.performanceTask}`,
      scheduled_date: endDate,
      start_time: null,
      end_time: null,
      entry_type: "planned_item",
      day: null,
      room: null,
      instance_no: null,
    },
    {
      plan_entry_id: `ex_${scenario.id}`,
      lesson_plan_id: `plan_${scenario.id}`,
      title: "Exam",
      category: "exam",
      description: `Count: ${scenario.exams}`,
      scheduled_date: endDate,
      start_time: null,
      end_time: null,
      entry_type: "planned_item",
      day: null,
      room: null,
      instance_no: null,
    },
  ];

  return {
    lessonPlanId: `plan_${scenario.id}`,
    startDate,
    endDate,
    entries: [...recurringRows, ...lessonRows, ...requirementRows],
  };
}

function buildMeetingSlots(input: Omit<SchedulerInput, "algorithm">) {
  const recurring = input.entries.filter((e) => e.entry_type === "recurring_class" && e.day);
  const dates = enumerateDates(input.startDate, input.endDate);
  const slots: string[] = [];
  for (const d of dates) {
    const weekday = parseDate(d).getDay();
    for (const row of recurring) {
      if (toWeekdayIndex(String(row.day)) === weekday) {
        slots.push(`${d}T${row.start_time ?? "00:00:00"}`);
      }
    }
  }
  if (slots.length > 0) return slots;
  return dates.map((d) => `${d}T00:00:00`);
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededRandom<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  const seeded = mulberry32(seed);
  (Math as { random: () => number }).random = seeded;
  try {
    return fn();
  } finally {
    (Math as { random: () => number }).random = original;
  }
}

function evaluate(
  input: Omit<SchedulerInput, "algorithm">,
  algorithmId: SchedulerAlgorithmId,
  algorithmLabel: string,
  repeatIdx: number,
  seed: number
): BenchmarkRow {
  const expectedCount =
    input.entries.filter((e) => e.category === "lesson").length +
    input.entries
      .filter((e) => e.category === "written_work" || e.category === "performance_task" || e.category === "exam")
      .map((e) => getCount(e.description))
      .reduce((a, b) => a + b, 0);

  const started = performance.now();
  const output = withSeededRandom(seed, () => generateScheduledEntries({ ...input, algorithm: algorithmId }));
  const elapsed = performance.now() - started;

  const generated = output.filter(
    (e) => e.scheduled_date && e.entry_type !== "recurring_class" && TARGET_CATEGORIES.has(e.category)
  );

  const coverage = expectedCount > 0 ? Math.min(1, generated.length / expectedCount) : 1;

  const lessonRows = generated
    .filter((e) => e.category === "lesson")
    .sort((a, b) => extractLessonNumber(a.title) - extractLessonNumber(b.title));
  let lessonViolations = 0;
  for (let i = 1; i < lessonRows.length; i += 1) {
    const prevDate = `${lessonRows[i - 1].scheduled_date ?? ""}T${lessonRows[i - 1].start_time ?? "00:00:00"}`;
    const currDate = `${lessonRows[i].scheduled_date ?? ""}T${lessonRows[i].start_time ?? "00:00:00"}`;
    if (currDate < prevDate) lessonViolations += 1;
  }
  const lessonOrder = lessonRows.length <= 1 ? 1 : 1 - lessonViolations / (lessonRows.length - 1);

  const start = parseDate(input.startDate).getTime();
  const end = parseDate(input.endDate).getTime();
  const span = Math.max(1, end - start);
  const assessRows = generated.filter(
    (e) => e.category === "written_work" || e.category === "performance_task" || e.category === "exam"
  );
  let withinWindow = 0;
  for (const row of assessRows) {
    const t = parseDate(String(row.scheduled_date)).getTime();
    const pos = (t - start) / span;
    const [from, to] = WINDOW_BY_CATEGORY[row.category as "written_work" | "performance_task" | "exam"];
    if (pos >= from && pos <= to) withinWindow += 1;
  }
  const assessWindow = assessRows.length > 0 ? withinWindow / assessRows.length : 1;

  const slots = buildMeetingSlots(input);
  const loadMap = new Map<string, number>();
  slots.forEach((slot) => loadMap.set(slot, 0));
  generated.forEach((row) => {
    const key = `${row.scheduled_date}T${row.start_time ?? "00:00:00"}`;
    loadMap.set(key, (loadMap.get(key) ?? 0) + 1);
  });
  const loads = Array.from(loadMap.values());
  const mean = loads.reduce((a, b) => a + b, 0) / Math.max(1, loads.length);
  const variance = loads.reduce((acc, n) => acc + (n - mean) ** 2, 0) / Math.max(1, loads.length);
  const stdev = Math.sqrt(variance);
  const cv = mean > 0 ? stdev / mean : 1;
  const loadBalance = Math.max(0, 1 - cv);

  const objective = coverage * 40 + lessonOrder * 25 + assessWindow * 20 + loadBalance * 15;

  return {
    scenario: input.lessonPlanId.replace("plan_", ""),
    repeat_idx: repeatIdx,
    seed,
    algorithm_id: algorithmId,
    algorithm: algorithmLabel,
    runtime_ms: Number(elapsed.toFixed(3)),
    coverage_pct: Number((coverage * 100).toFixed(3)),
    lesson_order_pct: Number((lessonOrder * 100).toFixed(3)),
    assessment_window_pct: Number((assessWindow * 100).toFixed(3)),
    load_balance_pct: Number((loadBalance * 100).toFixed(3)),
    objective_score: Number(objective.toFixed(3)),
    generated_items: generated.length,
  };
}

function mean(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdSample(values: number[]) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const v = values.reduce((acc, x) => acc + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

function ci95(values: number[]) {
  if (values.length < 2) return 0;
  return 1.96 * (stdSample(values) / Math.sqrt(values.length));
}

function erf(x: number) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z: number) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function pairedTTestPValue(diffs: number[]) {
  if (diffs.length < 2) return 1;
  const m = mean(diffs);
  const s = stdSample(diffs);
  if (s === 0) return 1;
  const t = m / (s / Math.sqrt(diffs.length));
  // Normal approximation for p-value.
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(t)))));
}

function wilcoxonSignedRankPValue(diffsRaw: number[]) {
  const diffs = diffsRaw.filter((d) => d !== 0);
  const n = diffs.length;
  if (n < 2) return 1;

  const pairs = diffs.map((d) => ({ sign: Math.sign(d), abs: Math.abs(d) }));
  pairs.sort((a, b) => a.abs - b.abs);

  const ranks = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && pairs[j + 1].abs === pairs[i].abs) j += 1;
    const avgRank = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k += 1) ranks[k] = avgRank;
    i = j + 1;
  }

  let wPos = 0;
  let wNeg = 0;
  for (let k = 0; k < n; k += 1) {
    if (pairs[k].sign > 0) wPos += ranks[k];
    if (pairs[k].sign < 0) wNeg += ranks[k];
  }
  const w = Math.min(wPos, wNeg);
  const mu = (n * (n + 1)) / 4;
  const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24);
  if (sigma === 0) return 1;
  const z = (w - mu + 0.5 * Math.sign(mu - w)) / sigma;
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))));
}

function aggregate(rows: BenchmarkRow[]): SummaryRow[] {
  const grouped = new Map<string, BenchmarkRow[]>();
  for (const row of rows) {
    grouped.set(row.algorithm_id, [...(grouped.get(row.algorithm_id) ?? []), row]);
  }

  const out = Array.from(grouped.entries()).map(([id, items]) => {
    const objectiveValues = items.map((r) => r.objective_score);
    const runtimeValues = items.map((r) => r.runtime_ms);
    return {
      algorithm_id: id,
      algorithm: items[0].algorithm,
      n: items.length,
      objective_mean: Number(mean(objectiveValues).toFixed(3)),
      objective_ci95: Number(ci95(objectiveValues).toFixed(3)),
      coverage_mean: Number(mean(items.map((r) => r.coverage_pct)).toFixed(3)),
      lesson_order_mean: Number(mean(items.map((r) => r.lesson_order_pct)).toFixed(3)),
      assessment_window_mean: Number(mean(items.map((r) => r.assessment_window_pct)).toFixed(3)),
      load_balance_mean: Number(mean(items.map((r) => r.load_balance_pct)).toFixed(3)),
      runtime_mean_ms: Number(mean(runtimeValues).toFixed(3)),
      runtime_ci95_ms: Number(ci95(runtimeValues).toFixed(3)),
    };
  });

  out.sort((a, b) => b.objective_mean - a.objective_mean);
  return out;
}

function significance(rows: BenchmarkRow[]): SignificanceRow[] {
  const algorithms = Array.from(new Set(rows.map((r) => r.algorithm_id)));
  const labels = new Map<string, string>();
  rows.forEach((r) => labels.set(r.algorithm_id, r.algorithm));

  const byAlgoAndPair = new Map<string, Map<string, number>>();
  for (const algo of algorithms) byAlgoAndPair.set(algo, new Map<string, number>());
  rows.forEach((r) => {
    const key = `${r.scenario}|${r.repeat_idx}`;
    byAlgoAndPair.get(r.algorithm_id)?.set(key, r.objective_score);
  });

  const results: SignificanceRow[] = [];
  for (let i = 0; i < algorithms.length; i += 1) {
    for (let j = i + 1; j < algorithms.length; j += 1) {
      const a = algorithms[i];
      const b = algorithms[j];
      const mapA = byAlgoAndPair.get(a) ?? new Map<string, number>();
      const mapB = byAlgoAndPair.get(b) ?? new Map<string, number>();

      const diffs: number[] = [];
      for (const [k, va] of mapA.entries()) {
        if (!mapB.has(k)) continue;
        diffs.push(va - (mapB.get(k) ?? 0));
      }

      results.push({
        algorithm_a: labels.get(a) ?? a,
        algorithm_b: labels.get(b) ?? b,
        n_pairs: diffs.length,
        mean_diff_a_minus_b: Number(mean(diffs).toFixed(4)),
        paired_t_pvalue: Number(pairedTTestPValue(diffs).toFixed(6)),
        wilcoxon_pvalue: Number(wilcoxonSignedRankPValue(diffs).toFixed(6)),
      });
    }
  }
  return results;
}

function toCsv<T extends Record<string, string | number>>(rows: T[]) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]) as Array<keyof T>;
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((h) => String(row[h])).join(","));
  });
  return `${lines.join("\n")}\n`;
}

function latexEscape(value: string) {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/_/g, "\\_")
    .replace(/%/g, "\\%")
    .replace(/&/g, "\\&");
}

function toLatexSummary(summary: SummaryRow[]) {
  const lines: string[] = [];
  lines.push("\\begin{tabular}{lrrrr}");
  lines.push("\\hline");
  lines.push("Algorithm & Objective (mean$\\pm$CI) & Coverage\\% & Load Balance\\% & Runtime ms (mean$\\pm$CI)\\\\");
  lines.push("\\hline");
  summary.forEach((r) => {
    lines.push(
      `${latexEscape(r.algorithm)} & ${r.objective_mean} $\\pm$ ${r.objective_ci95} & ${r.coverage_mean} & ${r.load_balance_mean} & ${r.runtime_mean_ms} $\\pm$ ${r.runtime_ci95_ms}\\\\`
    );
  });
  lines.push("\\hline");
  lines.push("\\end{tabular}");
  return `${lines.join("\n")}\n`;
}

function toLatexSignificance(rows: SignificanceRow[]) {
  const lines: string[] = [];
  lines.push("\\begin{tabular}{llrrr}");
  lines.push("\\hline");
  lines.push("Algorithm A & Algorithm B & Mean diff & Paired t-test p & Wilcoxon p\\\\");
  lines.push("\\hline");
  rows.forEach((r) => {
    lines.push(
      `${latexEscape(r.algorithm_a)} & ${latexEscape(r.algorithm_b)} & ${r.mean_diff_a_minus_b} & ${r.paired_t_pvalue} & ${r.wilcoxon_pvalue}\\\\`
    );
  });
  lines.push("\\hline");
  lines.push("\\end{tabular}");
  return `${lines.join("\n")}\n`;
}

function toMarkdown(rows: BenchmarkRow[], summary: SummaryRow[], sig: SignificanceRow[], repeats: number, seedBase: number) {
  const lines: string[] = [];
  lines.push("# Scheduler Benchmark Results");
  lines.push("");
  lines.push("## Configuration");
  lines.push("");
  lines.push(`- Repeats per scenario: ${repeats}`);
  lines.push(`- Seed base: ${seedBase}`);
  lines.push("- Significance tests: paired t-test and Wilcoxon signed-rank (normal approximation)");
  lines.push("");
  lines.push("## Summary (Average Across Scenario × Repeat)");
  lines.push("");
  lines.push("| Rank | Algorithm | n | Objective Mean | Objective CI95 | Coverage % | Lesson Order % | Assess Window % | Load Balance % | Runtime ms | Runtime CI95 |");
  lines.push("|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  summary.forEach((row, idx) => {
    lines.push(
      `| ${idx + 1} | ${row.algorithm} | ${row.n} | ${row.objective_mean} | ${row.objective_ci95} | ${row.coverage_mean} | ${row.lesson_order_mean} | ${row.assessment_window_mean} | ${row.load_balance_mean} | ${row.runtime_mean_ms} | ${row.runtime_ci95_ms} |`
    );
  });
  lines.push("");
  lines.push("## Significance (Objective Score Pairwise)");
  lines.push("");
  lines.push("| Algorithm A | Algorithm B | n pairs | Mean diff A-B | Paired t p-value | Wilcoxon p-value |");
  lines.push("|---|---|---:|---:|---:|---:|");
  sig.forEach((row) => {
    lines.push(
      `| ${row.algorithm_a} | ${row.algorithm_b} | ${row.n_pairs} | ${row.mean_diff_a_minus_b} | ${row.paired_t_pvalue} | ${row.wilcoxon_pvalue} |`
    );
  });
  lines.push("");
  lines.push("## Per Run Detail");
  lines.push("");
  lines.push("| Scenario | Repeat | Seed | Algorithm | Objective | Coverage % | Lesson Order % | Assess Window % | Load Balance % | Runtime ms | Items |");
  lines.push("|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|");
  rows.forEach((row) => {
    lines.push(
      `| ${row.scenario} | ${row.repeat_idx} | ${row.seed} | ${row.algorithm} | ${row.objective_score} | ${row.coverage_pct} | ${row.lesson_order_pct} | ${row.assessment_window_pct} | ${row.load_balance_pct} | ${row.runtime_ms} | ${row.generated_items} |`
    );
  });
  lines.push("");
  lines.push("## Scenarios");
  lines.push("");
  SCENARIOS.forEach((s) => {
    lines.push(`- ${s.id}: ${s.label}; lessons=${s.lessons}, WW=${s.writtenWork}, PT=${s.performanceTask}, EX=${s.exams}`);
  });
  return `${lines.join("\n")}\n`;
}

function run() {
  const repeats = Math.max(1, Number(process.env.BENCH_REPEATS ?? "5"));
  const seedBase = Number(process.env.BENCH_SEED ?? "20260309");

  const rows: BenchmarkRow[] = [];
  for (let si = 0; si < SCENARIOS.length; si += 1) {
    const scenario = SCENARIOS[si];
    const input = buildScenarioInput(scenario);

    for (let ai = 0; ai < SCHEDULER_ALGORITHMS.length; ai += 1) {
      const algo = SCHEDULER_ALGORITHMS[ai];
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        const seed = seedBase + si * 10000 + ai * 100 + repeat;
        rows.push(evaluate(input, algo.id, algo.label, repeat, seed));
      }
    }
  }

  const summary = aggregate(rows);
  const sig = significance(rows);
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const base = join(process.cwd(), "generated", "scheduler-benchmarks", stamp);
  mkdirSync(base, { recursive: true });

  writeFileSync(join(base, "benchmark_details.csv"), toCsv(rows), "utf8");
  writeFileSync(join(base, "benchmark_summary.csv"), toCsv(summary), "utf8");
  writeFileSync(join(base, "benchmark_significance.csv"), toCsv(sig), "utf8");
  writeFileSync(join(base, "benchmark_report.md"), toMarkdown(rows, summary, sig, repeats, seedBase), "utf8");
  writeFileSync(join(base, "benchmark_summary.tex"), toLatexSummary(summary), "utf8");
  writeFileSync(join(base, "benchmark_significance.tex"), toLatexSignificance(sig), "utf8");

  console.log(`Scheduler benchmark written to: ${base}`);
  console.log("Files:");
  console.log("- benchmark_report.md");
  console.log("- benchmark_summary.csv");
  console.log("- benchmark_details.csv");
  console.log("- benchmark_significance.csv");
  console.log("- benchmark_summary.tex");
  console.log("- benchmark_significance.tex");
}

run();
