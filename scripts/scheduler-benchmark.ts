import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { buildBlocks } from "../algorithm/buildBlocks";
import { buildPacingPlan } from "../algorithm/buildPacingPlan";
import { buildSlots, type RawMeetingSchedule } from "../algorithm/buildSlots";
import { placeBlocks } from "../algorithm/placeBlocks";
import type { ExamBlockTemplate, TeacherRules, TOCUnit } from "../algorithm/types";
import { validatePlan } from "../algorithm/validatePlan";

type Scenario = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  schedules: RawMeetingSchedule[];
  tocUnits: TOCUnit[];
  teacherRules: TeacherRules;
  examBlockTemplates: ExamBlockTemplate[];
  holidays?: string[];
};

type BenchmarkRow = {
  scenario: string;
  label: string;
  slot_count: number;
  lesson_count: number;
  block_count: number;
  runtime_ms: number;
  validation_errors: number;
  utilization_rate_pct: number;
  scheduled_required_lessons: number;
  total_required_lessons: number;
  scheduled_required_ww: number;
  total_required_ww: number;
  scheduled_required_pt: number;
  total_required_pt: number;
};

function makeTocUnits(courseId: string, count: number): TOCUnit[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${courseId}_lesson_${index + 1}`,
    courseId,
    chapterId: `chapter_${Math.floor(index / 4) + 1}`,
    chapterTitle: `Chapter ${Math.floor(index / 4) + 1}`,
    title: `Lesson ${index + 1}`,
    order: index + 1,
    estimatedMinutes: index % 4 === 0 ? 90 : 60,
    difficulty: index % 3 === 0 ? "high" : index % 2 === 0 ? "medium" : "easy",
    preferredSessionType: index % 5 === 0 ? "laboratory" : "lecture",
    required: true,
  }));
}

function runScenario(scenario: Scenario): BenchmarkRow {
  const started = performance.now();
  const slots = buildSlots({
    courseId: scenario.id,
    startDate: scenario.startDate,
    endDate: scenario.endDate,
    rawMeetingSchedules: scenario.schedules,
    holidays: scenario.holidays ?? [],
    termBoundaryDates: scenario.examBlockTemplates
      .map((template) => template.preferredDate)
      .filter((value): value is string => Boolean(value)),
  });
  const pacingPlan = buildPacingPlan({
    slots,
    tocUnits: scenario.tocUnits,
    teacherRules: scenario.teacherRules,
    examBlockTemplates: scenario.examBlockTemplates,
    initialDelayDates: scenario.holidays ?? [],
  });
  const blocks = buildBlocks({
    courseId: scenario.id,
    tocUnits: scenario.tocUnits,
    teacherRules: scenario.teacherRules,
    examBlockTemplates: scenario.examBlockTemplates,
    slots,
    initialDelayDates: scenario.holidays ?? [],
  });
  const placement = placeBlocks({ slots, blocks });
  const validation = validatePlan({
    slots: placement.slots,
    blocks,
    tocUnits: scenario.tocUnits,
    expectedHolidayDates: scenario.holidays ?? [],
    expectedExamDates: scenario.examBlockTemplates
      .map((template) => template.preferredDate)
      .filter((value): value is string => Boolean(value)),
    expectedTermCount: Math.max(1, scenario.examBlockTemplates.length || 1),
    expectedDelayCount: pacingPlan.terms.reduce((sum, term) => sum + term.initialDelayCount, 0),
  });
  const runtimeMs = performance.now() - started;

  return {
    scenario: scenario.id,
    label: scenario.label,
    slot_count: slots.length,
    lesson_count: scenario.tocUnits.length,
    block_count: blocks.length,
    runtime_ms: Number(runtimeMs.toFixed(3)),
    validation_errors: validation.validationIssues.filter((issue) => issue.severity === "error").length,
    utilization_rate_pct: Number((validation.metrics.utilizationRate * 100).toFixed(3)),
    scheduled_required_lessons: validation.metrics.scheduledRequiredLessonBlocks,
    total_required_lessons: validation.metrics.totalRequiredLessons,
    scheduled_required_ww: validation.metrics.scheduledRequiredWrittenWorks,
    total_required_ww: validation.metrics.totalRequiredWrittenWorks,
    scheduled_required_pt: validation.metrics.scheduledRequiredPerformanceTasks,
    total_required_pt: validation.metrics.totalRequiredPerformanceTasks,
  };
}

const scenarios: Scenario[] = [
  {
    id: "benchmark_light",
    label: "Light",
    startDate: "2026-06-01",
    endDate: "2026-06-26",
    schedules: [
      { id: "mon_am", dayOfWeek: 1, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
      { id: "wed_am", dayOfWeek: 3, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
      { id: "fri_am", dayOfWeek: 5, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
    ],
    tocUnits: makeTocUnits("benchmark_light", 6),
    teacherRules: {
      quizMode: "hybrid",
      quizEveryNLessons: 3,
      writtenWorkMode: "total",
      minWW: 2,
      allowLessonWrittenWorkOverlay: true,
      preferLessonWrittenWorkOverlay: true,
      minPT: 1,
      includeReviewBeforeExam: true,
    },
    examBlockTemplates: [
      {
        id: "final_exam",
        title: "Final Exam",
        estimatedMinutes: 90,
        subcategory: "final",
        preferredDate: "2026-06-24",
        required: true,
      },
    ],
  },
  {
    id: "benchmark_mid",
    label: "Mid",
    startDate: "2026-06-01",
    endDate: "2026-08-07",
    schedules: [
      { id: "mon_am", dayOfWeek: 1, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
      { id: "wed_am", dayOfWeek: 3, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
      { id: "fri_lab", dayOfWeek: 5, startTime: "13:00", endTime: "14:30", sessionType: "laboratory" },
    ],
    tocUnits: makeTocUnits("benchmark_mid", 12),
    teacherRules: {
      quizMode: "hybrid",
      quizEveryNLessons: 3,
      writtenWorkMode: "total",
      minWW: 4,
      allowLessonWrittenWorkOverlay: true,
      preferLessonWrittenWorkOverlay: true,
      minPT: 3,
      includeReviewBeforeExam: true,
    },
    examBlockTemplates: [
      {
        id: "midterm_exam",
        title: "Midterm Exam",
        estimatedMinutes: 90,
        subcategory: "midterm",
        preferredDate: "2026-07-03",
        required: true,
      },
      {
        id: "final_exam",
        title: "Final Exam",
        estimatedMinutes: 90,
        subcategory: "final",
        preferredDate: "2026-08-07",
        required: true,
      },
    ],
  },
  {
    id: "benchmark_holiday",
    label: "Holiday Pressure",
    startDate: "2026-06-01",
    endDate: "2026-08-14",
    schedules: [
      { id: "mon_am", dayOfWeek: 1, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
      { id: "tue_am", dayOfWeek: 2, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
      { id: "thu_lab", dayOfWeek: 4, startTime: "13:00", endTime: "14:30", sessionType: "laboratory" },
      { id: "fri_am", dayOfWeek: 5, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
    ],
    tocUnits: makeTocUnits("benchmark_holiday", 14),
    teacherRules: {
      quizMode: "hybrid",
      quizEveryNLessons: 3,
      writtenWorkMode: "total",
      minWW: 5,
      allowLessonWrittenWorkOverlay: true,
      preferLessonWrittenWorkOverlay: true,
      minPT: 4,
      includeReviewBeforeExam: true,
    },
    examBlockTemplates: [
      {
        id: "midterm_exam",
        title: "Midterm Exam",
        estimatedMinutes: 90,
        subcategory: "midterm",
        preferredDate: "2026-07-10",
        required: true,
      },
      {
        id: "final_exam",
        title: "Final Exam",
        estimatedMinutes: 90,
        subcategory: "final",
        preferredDate: "2026-08-14",
        required: true,
      },
    ],
    holidays: ["2026-06-12", "2026-06-19", "2026-07-20"],
  },
];

function toCsv(rows: BenchmarkRow[]) {
  const header = Object.keys(rows[0] ?? {}).join(",");
  const body = rows.map((row) => Object.values(row).join(","));
  return [header, ...body].join("\n");
}

function toMarkdown(rows: BenchmarkRow[]) {
  const headers = Object.keys(rows[0] ?? {});
  const lines = [
    `# Scheduler Benchmark`,
    ``,
    `Measured against the current planner pipeline: \`buildSlots -> buildPacingPlan -> buildBlocks -> placeBlocks -> validatePlan\`.`,
    ``,
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${headers.map((header) => String(row[header as keyof BenchmarkRow])).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function run() {
  const rows = scenarios.map(runScenario);
  const outDir = join(process.cwd(), "generated", "scheduler-benchmarks");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "summary.csv"), toCsv(rows));
  writeFileSync(join(outDir, "summary.md"), toMarkdown(rows));
  console.log(`scheduler benchmark: wrote ${rows.length} scenario rows to generated/scheduler-benchmarks`);
}

run();
