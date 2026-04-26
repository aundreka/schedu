import assert from "node:assert/strict";
import { buildBlocks } from "../algorithm/buildBlocks";
import { buildPacingPlan } from "../algorithm/buildPacingPlan";
import { buildSlots, type RawMeetingSchedule } from "../algorithm/buildSlots";
import { placeBlocks } from "../algorithm/placeBlocks";
import type { ExamBlockTemplate, TeacherRules, TOCUnit } from "../algorithm/types";
import { validatePlan } from "../algorithm/validatePlan";

type ScenarioInput = {
  courseId: string;
  startDate: string;
  endDate: string;
  schedules: RawMeetingSchedule[];
  tocUnits: TOCUnit[];
  teacherRules: TeacherRules;
  examBlockTemplates: ExamBlockTemplate[];
  holidays?: string[];
};

function buildScenario(input: ScenarioInput) {
  const slots = buildSlots({
    courseId: input.courseId,
    startDate: input.startDate,
    endDate: input.endDate,
    rawMeetingSchedules: input.schedules,
    holidays: input.holidays ?? [],
    termBoundaryDates: input.examBlockTemplates
      .map((template) => template.preferredDate)
      .filter((value): value is string => Boolean(value)),
  });
  const pacingPlan = buildPacingPlan({
    slots,
    tocUnits: input.tocUnits,
    teacherRules: input.teacherRules,
    examBlockTemplates: input.examBlockTemplates,
    initialDelayDates: input.holidays ?? [],
  });
  const blocks = buildBlocks({
    courseId: input.courseId,
    tocUnits: input.tocUnits,
    teacherRules: input.teacherRules,
    examBlockTemplates: input.examBlockTemplates,
    slots,
    initialDelayDates: input.holidays ?? [],
  });
  const placement = placeBlocks({ slots, blocks });
  const validation = validatePlan({
    slots: placement.slots,
    blocks,
    tocUnits: input.tocUnits,
    expectedHolidayDates: input.holidays ?? [],
    expectedExamDates: input.examBlockTemplates
      .map((template) => template.preferredDate)
      .filter((value): value is string => Boolean(value)),
    expectedTermCount: Math.max(1, input.examBlockTemplates.length || 1),
    expectedDelayCount: pacingPlan.terms.reduce((sum, term) => sum + term.initialDelayCount, 0),
  });

  return { slots, pacingPlan, blocks, placement, validation };
}

function makeTocUnits(courseId: string, count: number): TOCUnit[] {
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

function majorTitlesBySlotDate(
  slots: ReturnType<typeof buildScenario>["placement"]["slots"],
  blocks: ReturnType<typeof buildScenario>["blocks"]
) {
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

  const examSlot = majorTitlesBySlotDate(result.placement.slots, result.blocks).find(
    (row) => row.type === "exam"
  );
  assert.ok(examSlot, "Expected the exam block to be scheduled.");
  assert.equal(examSlot?.date, "2026-06-24", "Expected the final exam to anchor to its preferred date.");
  assert.equal(
    result.validation.metrics.scheduledRequiredLessonBlocks,
    result.validation.metrics.totalRequiredLessons,
    "Expected required lessons to remain fully scheduled in the anchored exam scenario."
  );
  assert.equal(
    result.validation.validationIssues.filter((issue) => issue.code === "VALIDATE_TERM_MISSING_EXAM").length,
    0,
    "Expected the anchored exam scenario to keep its exam block."
  );
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

  assert.ok(
    result.placement.slots.every((slot) => !holidays.includes(slot.date)),
    "Expected holidays to be omitted from generated slots."
  );
  assert.equal(
    result.validation.metrics.unscheduledRequiredLessonIds.length,
    0,
    "Expected all required lessons to remain scheduled despite holidays."
  );
  assert.equal(
    result.validation.metrics.holidayViolations,
    0,
    "Expected no holiday violations for the holiday scenario."
  );
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

  assert.equal(result.pacingPlan.terms.length, 2, "Expected two pacing-plan terms.");
  assert.equal(result.validation.metrics.termCount, 2, "Expected validation to detect two terms.");
  assert.equal(
    result.validation.metrics.scheduledRequiredLessonBlocks,
    result.validation.metrics.totalRequiredLessons,
    "Expected all required lessons to remain scheduled across both terms."
  );
  assert.equal(
    result.validation.validationIssues.filter((issue) => issue.code === "VALIDATE_TERM_MISSING_EXAM").length,
    0,
    "Expected each term to retain an exam block."
  );
}

function run() {
  testPreferredExamDateAnchoring();
  testHolidaySkippingAndLessonCoverage();
  testMultiTermOrdering();
  console.log("scheduler invariants: current algorithm checks passed");
}

run();
