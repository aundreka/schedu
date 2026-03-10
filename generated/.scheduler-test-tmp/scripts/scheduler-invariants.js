"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("assert/strict"));
const lessonPlanScheduler_1 = require("../algorithms/lessonPlanScheduler");
function entry(overrides) {
    return {
        description: null,
        scheduled_date: null,
        start_time: null,
        end_time: null,
        ...overrides,
    };
}
function recurringRow(id, lessonPlanId, day, start, end, meetingType) {
    return entry({
        plan_entry_id: id,
        lesson_plan_id: lessonPlanId,
        title: `${day} class ${start}`,
        category: "lesson",
        entry_type: "recurring_class",
        day,
        start_time: start,
        end_time: end,
        meeting_type: meetingType,
    });
}
function testLockedMultiSlotPlacement() {
    const input = {
        lessonPlanId: "plan_lock_slot",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        entries: [
            recurringRow("rec_1", "plan_lock_slot", "monday", "08:00:00", "09:00:00", "lecture"),
            recurringRow("rec_2", "plan_lock_slot", "monday", "10:00:00", "11:00:00", "laboratory"),
            entry({
                plan_entry_id: "lesson_locked",
                lesson_plan_id: "plan_lock_slot",
                title: "Lesson 1",
                category: "lesson",
                scheduled_date: "2026-06-01",
                start_time: "10:00:00",
                end_time: "11:00:00",
                is_locked: true,
            }),
        ],
    };
    const result = (0, lessonPlanScheduler_1.generateSchedulePlan)(input);
    const locked = result.entries.find((e) => e.is_locked &&
        e.title === "Lesson 1" &&
        e.scheduled_date === "2026-06-01" &&
        e.start_time === "10:00:00" &&
        e.end_time === "11:00:00");
    strict_1.default.ok(locked, "Expected locked lesson entry to be preserved.");
    strict_1.default.equal(locked?.scheduled_date, "2026-06-01");
    strict_1.default.equal(locked?.start_time, "10:00:00");
    strict_1.default.equal(locked?.end_time, "11:00:00");
}
function testFinalExamDoesNotOverwriteLastOccupiedMeeting() {
    const input = {
        lessonPlanId: "plan_final_exam_shift",
        startDate: "2026-06-01",
        endDate: "2026-06-05",
        entries: [
            recurringRow("rec_mon", "plan_final_exam_shift", "monday", "08:00:00", "09:00:00", "lecture"),
            recurringRow("rec_wed", "plan_final_exam_shift", "wednesday", "08:00:00", "09:00:00", "lecture"),
            recurringRow("rec_fri", "plan_final_exam_shift", "friday", "08:00:00", "09:00:00", "lecture"),
            entry({
                plan_entry_id: "exam_final",
                lesson_plan_id: "plan_final_exam_shift",
                title: "Final Exam",
                category: "exam",
            }),
            entry({
                plan_entry_id: "locked_last_slot",
                lesson_plan_id: "plan_final_exam_shift",
                title: "Locked Last Slot",
                category: "written_work",
                scheduled_date: "2026-06-05",
                start_time: "08:00:00",
                end_time: "09:00:00",
                is_locked: true,
            }),
        ],
    };
    const result = (0, lessonPlanScheduler_1.generateSchedulePlan)(input);
    const lockedLast = result.entries.find((e) => e.is_locked &&
        e.title === "Locked Last Slot" &&
        e.scheduled_date === "2026-06-05" &&
        e.start_time === "08:00:00");
    strict_1.default.ok(lockedLast, "Expected locked non-lesson entry on last slot.");
    strict_1.default.equal(lockedLast?.scheduled_date, "2026-06-05");
    strict_1.default.equal(lockedLast?.start_time, "08:00:00");
    const finalExam = result.entries.find((e) => e.category === "exam" && e.title.toLowerCase().includes("final"));
    strict_1.default.ok(finalExam, "Expected final exam to be present.");
    strict_1.default.notEqual(finalExam?.scheduled_date, "2026-06-05", "Final exam should not overwrite last occupied meeting.");
    const shiftedDiagnostic = result.diagnostics.constraints.find((d) => d.code === "FINAL_EXAM_SHIFTED");
    strict_1.default.ok(shiftedDiagnostic, "Expected FINAL_EXAM_SHIFTED diagnostic when last meeting is occupied.");
}
function testBlackoutDatesAreRespected() {
    const input = {
        lessonPlanId: "plan_blackout",
        startDate: "2026-06-01",
        endDate: "2026-06-05",
        blackoutDates: ["2026-06-03"],
        entries: [
            recurringRow("rec_mon", "plan_blackout", "monday", "08:00:00", "09:00:00", "lecture"),
            recurringRow("rec_wed", "plan_blackout", "wednesday", "08:00:00", "09:00:00", "lecture"),
            recurringRow("rec_fri", "plan_blackout", "friday", "08:00:00", "09:00:00", "lecture"),
            entry({
                plan_entry_id: "lesson_1",
                lesson_plan_id: "plan_blackout",
                title: "Lesson 1",
                category: "lesson",
            }),
            entry({
                plan_entry_id: "exam_1",
                lesson_plan_id: "plan_blackout",
                title: "Final Exam",
                category: "exam",
            }),
        ],
    };
    const result = (0, lessonPlanScheduler_1.generateSchedulePlan)(input);
    const scheduledOnBlackout = result.entries.filter((e) => e.scheduled_date === "2026-06-03");
    strict_1.default.equal(scheduledOnBlackout.length, 0, "Expected no entries scheduled on blackout date.");
}
function testGeneratedEntryIdsAreUnique() {
    const input = {
        lessonPlanId: "plan_unique_ids",
        startDate: "2026-06-01",
        endDate: "2026-06-19",
        entries: [
            recurringRow("rec_mon", "plan_unique_ids", "monday", "08:00:00", "10:00:00", "lecture"),
            recurringRow("rec_wed", "plan_unique_ids", "wednesday", "08:00:00", "10:00:00", "lecture"),
            recurringRow("rec_fri", "plan_unique_ids", "friday", "08:00:00", "10:00:00", "laboratory"),
            ...Array.from({ length: 8 }, (_, i) => entry({
                plan_entry_id: `lesson_${i + 1}`,
                lesson_plan_id: "plan_unique_ids",
                title: `Lesson ${i + 1}`,
                category: "lesson",
                lesson_estimated_minutes: i % 2 === 0 ? 120 : 60,
            })),
            entry({
                plan_entry_id: "written_work_1",
                lesson_plan_id: "plan_unique_ids",
                title: "Written Work",
                category: "written_work",
            }),
            entry({
                plan_entry_id: "performance_task_1",
                lesson_plan_id: "plan_unique_ids",
                title: "Performance Task",
                category: "performance_task",
            }),
            entry({
                plan_entry_id: "exam_final",
                lesson_plan_id: "plan_unique_ids",
                title: "Final Exam",
                category: "exam",
            }),
        ],
    };
    const result = (0, lessonPlanScheduler_1.generateSchedulePlan)(input);
    const ids = result.entries.map((e) => e.plan_entry_id);
    const unique = new Set(ids);
    strict_1.default.equal(unique.size, ids.length, "Expected generated plan_entry_id values to be unique.");
}
function run() {
    testLockedMultiSlotPlacement();
    testFinalExamDoesNotOverwriteLastOccupiedMeeting();
    testBlackoutDatesAreRespected();
    testGeneratedEntryIdsAreUnique();
    console.log("scheduler invariants: all checks passed");
}
run();
