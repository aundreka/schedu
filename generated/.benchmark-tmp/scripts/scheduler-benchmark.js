"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_perf_hooks_1 = require("node:perf_hooks");
const buildBlocks_1 = require("../algorithm/buildBlocks");
const buildPacingPlan_1 = require("../algorithm/buildPacingPlan");
const buildSlots_1 = require("../algorithm/buildSlots");
const placeBlocks_1 = require("../algorithm/placeBlocks");
const validatePlan_1 = require("../algorithm/validatePlan");
function makeTocUnits(courseId, count) {
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
function runScenario(scenario) {
    const started = node_perf_hooks_1.performance.now();
    const slots = (0, buildSlots_1.buildSlots)({
        courseId: scenario.id,
        startDate: scenario.startDate,
        endDate: scenario.endDate,
        rawMeetingSchedules: scenario.schedules,
        holidays: scenario.holidays ?? [],
        termBoundaryDates: scenario.examBlockTemplates
            .map((template) => template.preferredDate)
            .filter((value) => Boolean(value)),
    });
    const pacingPlan = (0, buildPacingPlan_1.buildPacingPlan)({
        slots,
        tocUnits: scenario.tocUnits,
        teacherRules: scenario.teacherRules,
        examBlockTemplates: scenario.examBlockTemplates,
        initialDelayDates: scenario.holidays ?? [],
    });
    const blocks = (0, buildBlocks_1.buildBlocks)({
        courseId: scenario.id,
        tocUnits: scenario.tocUnits,
        teacherRules: scenario.teacherRules,
        examBlockTemplates: scenario.examBlockTemplates,
        slots,
        initialDelayDates: scenario.holidays ?? [],
    });
    const placement = (0, placeBlocks_1.placeBlocks)({ slots, blocks });
    const validation = (0, validatePlan_1.validatePlan)({
        slots: placement.slots,
        blocks,
        tocUnits: scenario.tocUnits,
        expectedHolidayDates: scenario.holidays ?? [],
        expectedExamDates: scenario.examBlockTemplates
            .map((template) => template.preferredDate)
            .filter((value) => Boolean(value)),
        expectedTermCount: Math.max(1, scenario.examBlockTemplates.length || 1),
        expectedDelayCount: pacingPlan.terms.reduce((sum, term) => sum + term.initialDelayCount, 0),
    });
    const runtimeMs = node_perf_hooks_1.performance.now() - started;
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
const scenarios = [
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
function toCsv(rows) {
    const header = Object.keys(rows[0] ?? {}).join(",");
    const body = rows.map((row) => Object.values(row).join(","));
    return [header, ...body].join("\n");
}
function toMarkdown(rows) {
    const headers = Object.keys(rows[0] ?? {});
    const lines = [
        `# Scheduler Benchmark`,
        ``,
        `Measured against the current planner pipeline: \`buildSlots -> buildPacingPlan -> buildBlocks -> placeBlocks -> validatePlan\`.`,
        ``,
        `| ${headers.join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${headers.map((header) => String(row[header])).join(" | ")} |`),
    ];
    return lines.join("\n");
}
function run() {
    const rows = scenarios.map(runScenario);
    const outDir = (0, node_path_1.join)(process.cwd(), "generated", "scheduler-benchmarks");
    (0, node_fs_1.mkdirSync)(outDir, { recursive: true });
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(outDir, "summary.csv"), toCsv(rows));
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(outDir, "summary.md"), toMarkdown(rows));
    console.log(`scheduler benchmark: wrote ${rows.length} scenario rows to generated/scheduler-benchmarks`);
}
run();
