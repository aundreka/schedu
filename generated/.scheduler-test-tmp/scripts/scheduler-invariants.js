"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const buildBlocks_1 = require("../algorithm/buildBlocks");
const buildPacingPlan_1 = require("../algorithm/buildPacingPlan");
const buildSlots_1 = require("../algorithm/buildSlots");
const placeBlocks_1 = require("../algorithm/placeBlocks");
const validatePlan_1 = require("../algorithm/validatePlan");
function buildScenario(input) {
    const slots = (0, buildSlots_1.buildSlots)({
        courseId: input.courseId,
        startDate: input.startDate,
        endDate: input.endDate,
        rawMeetingSchedules: input.schedules,
        holidays: input.holidays ?? [],
        termBoundaryDates: input.examBlockTemplates
            .map((template) => template.preferredDate)
            .filter((value) => Boolean(value)),
    });
    const pacingPlan = (0, buildPacingPlan_1.buildPacingPlan)({
        slots,
        tocUnits: input.tocUnits,
        teacherRules: input.teacherRules,
        examBlockTemplates: input.examBlockTemplates,
        initialDelayDates: input.holidays ?? [],
    });
    const blocks = (0, buildBlocks_1.buildBlocks)({
        courseId: input.courseId,
        tocUnits: input.tocUnits,
        teacherRules: input.teacherRules,
        examBlockTemplates: input.examBlockTemplates,
        slots,
        initialDelayDates: input.holidays ?? [],
    });
    const placement = (0, placeBlocks_1.placeBlocks)({ slots, blocks });
    const validation = (0, validatePlan_1.validatePlan)({
        slots: placement.slots,
        blocks,
        tocUnits: input.tocUnits,
        expectedHolidayDates: input.holidays ?? [],
        expectedExamDates: input.examBlockTemplates
            .map((template) => template.preferredDate)
            .filter((value) => Boolean(value)),
        expectedTermCount: Math.max(1, input.examBlockTemplates.length || 1),
        expectedDelayCount: pacingPlan.terms.reduce((sum, term) => sum + term.initialDelayCount, 0),
    });
    return { slots, pacingPlan, blocks, placement, validation };
}
function makeTocUnits(courseId, count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `lesson_${index + 1}`,
        courseId,
        chapterId: index < Math.ceil(count / 2) ? "chapter_a" : "chapter_b",
        chapterTitle: index < Math.ceil(count / 2) ? "Chapter A" : "Chapter B",
        title: `Lesson ${index + 1}`,
        order: index + 1,
        estimatedMinutes: 60,
        difficulty: index % 3 === 0 ? "high" : index % 2 === 0 ? "medium" : "easy",
        preferredSessionType: "lecture",
        required: true,
    }));
}
function majorTitlesBySlotDate(slots, blocks) {
    const blockById = new Map(blocks.map((block) => [block.id, block]));
    return slots
        .map((slot) => {
        const major = slot.placements.find((placement) => placement.lane === "major");
        const block = major ? blockById.get(major.blockId) ?? null : null;
        return {
            date: slot.date,
            title: block?.title ?? null,
            type: block?.type ?? null,
            subcategory: block?.subcategory ?? null,
        };
    })
        .filter((row) => Boolean(row.title));
}
function testPreferredExamDateAnchoring() {
    const courseId = "course_exam_anchor";
    const result = buildScenario({
        courseId,
        startDate: "2026-06-01",
        endDate: "2026-06-26",
        schedules: [
            { id: "mwf_am", dayOfWeek: 1, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
            { id: "mwf_am", dayOfWeek: 3, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
            { id: "mwf_am", dayOfWeek: 5, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
        ],
        tocUnits: makeTocUnits(courseId, 6),
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
    });
    const examSlot = majorTitlesBySlotDate(result.placement.slots, result.blocks).find((row) => row.type === "exam");
    strict_1.default.ok(examSlot, "Expected the exam block to be scheduled.");
    strict_1.default.equal(examSlot?.date, "2026-06-24", "Expected the final exam to anchor to its preferred date.");
    strict_1.default.equal(result.validation.metrics.scheduledRequiredLessonBlocks, result.validation.metrics.totalRequiredLessons, "Expected required lessons to remain fully scheduled in the anchored exam scenario.");
    strict_1.default.equal(result.validation.validationIssues.filter((issue) => issue.code === "VALIDATE_TERM_MISSING_EXAM").length, 0, "Expected the anchored exam scenario to keep its exam block.");
}
function testHolidaySkippingAndLessonCoverage() {
    const courseId = "course_holiday_skip";
    const holidays = ["2026-06-10", "2026-06-12"];
    const result = buildScenario({
        courseId,
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        schedules: [
            { id: "mwf_am", dayOfWeek: 1, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
            { id: "mwf_am", dayOfWeek: 3, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
            { id: "mwf_am", dayOfWeek: 5, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
        ],
        tocUnits: makeTocUnits(courseId, 7),
        teacherRules: {
            quizMode: "hybrid",
            quizEveryNLessons: 3,
            writtenWorkMode: "total",
            minWW: 2,
            allowLessonWrittenWorkOverlay: true,
            preferLessonWrittenWorkOverlay: true,
            minPT: 2,
            includeReviewBeforeExam: true,
        },
        examBlockTemplates: [
            {
                id: "final_exam",
                title: "Final Exam",
                estimatedMinutes: 90,
                subcategory: "final",
                preferredDate: "2026-06-29",
                required: true,
            },
        ],
        holidays,
    });
    strict_1.default.ok(result.placement.slots.every((slot) => !holidays.includes(slot.date)), "Expected holidays to be omitted from generated slots.");
    strict_1.default.equal(result.validation.metrics.unscheduledRequiredLessonIds.length, 0, "Expected all required lessons to remain scheduled despite holidays.");
    strict_1.default.equal(result.validation.metrics.holidayViolations, 0, "Expected no holiday violations for the holiday scenario.");
}
function testMultiTermOrdering() {
    const courseId = "course_multiterm";
    const result = buildScenario({
        courseId,
        startDate: "2026-06-01",
        endDate: "2026-08-07",
        schedules: [
            { id: "mon_am", dayOfWeek: 1, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
            { id: "wed_am", dayOfWeek: 3, startTime: "08:00", endTime: "09:00", sessionType: "lecture" },
            { id: "fri_lab", dayOfWeek: 5, startTime: "13:00", endTime: "14:30", sessionType: "laboratory" },
        ],
        tocUnits: makeTocUnits(courseId, 12),
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
    });
    strict_1.default.equal(result.pacingPlan.terms.length, 2, "Expected two pacing-plan terms.");
    strict_1.default.equal(result.validation.metrics.termCount, 2, "Expected validation to detect two terms.");
    strict_1.default.equal(result.validation.metrics.scheduledRequiredLessonBlocks, result.validation.metrics.totalRequiredLessons, "Expected all required lessons to remain scheduled across both terms.");
    strict_1.default.equal(result.validation.validationIssues.filter((issue) => issue.code === "VALIDATE_TERM_MISSING_EXAM").length, 0, "Expected each term to retain an exam block.");
}
function run() {
    testPreferredExamDateAnchoring();
    testHolidaySkippingAndLessonCoverage();
    testMultiTermOrdering();
    console.log("scheduler invariants: current algorithm checks passed");
}
run();
