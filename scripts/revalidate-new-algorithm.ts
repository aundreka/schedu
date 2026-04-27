import assert from "node:assert/strict";
import { placeBlocks } from "../algorithm/placeBlocks";
import type { Block, SessionSlot } from "../algorithm/types";

function slot(id: string, date: string): SessionSlot {
  return {
    id,
    courseId: "course_1",
    date,
    startTime: "08:00",
    endTime: "09:30",
    sessionType: "lecture",
    minutes: 90,
    locked: false,
    lockReason: null,
    placements: [],
    termIndex: 0,
    termKey: "final",
  };
}

function block(overrides: Partial<Block> & Pick<Block, "id" | "title" | "type" | "subcategory">): Block {
  return {
    courseId: "course_1",
    sourceTocId: null,
    estimatedMinutes: 45,
    minMinutes: 15,
    maxMinutes: 120,
    required: true,
    splittable: false,
    overlayMode: "major",
    preferredSessionType: "lecture",
    dependencies: [],
    metadata: { termIndex: 0, termKey: "final" },
    ...overrides,
  };
}

function findPlacement(resultSlots: SessionSlot[], blockId: string) {
  for (let slotIndex = 0; slotIndex < resultSlots.length; slotIndex += 1) {
    const placementIndex = resultSlots[slotIndex]!.placements.findIndex(
      (placement) => placement.blockId === blockId
    );
    if (placementIndex >= 0) {
      return { slotIndex, placementIndex };
    }
  }
  return null;
}

function run() {
  const slots: SessionSlot[] = [
    slot("slot_1", "2026-06-01"),
    slot("slot_2", "2026-06-02"),
    slot("slot_3", "2026-06-03"),
  ];

  const lesson1 = block({
    id: "lesson_1",
    title: "L1",
    type: "lesson",
    subcategory: "lecture",
    sourceTocId: "lesson_1",
    metadata: { termIndex: 0, termKey: "final", lessonOrder: 1, globalLessonOrder: 1 },
  });
  const lesson2 = block({
    id: "lesson_2",
    title: "L2",
    type: "lesson",
    subcategory: "lecture",
    sourceTocId: "lesson_2",
    metadata: { termIndex: 0, termKey: "final", lessonOrder: 2, globalLessonOrder: 2 },
  });
  const quiz1 = block({
    id: "quiz_1",
    title: "Q1",
    type: "written_work",
    subcategory: "quiz",
    metadata: {
      termIndex: 0,
      termKey: "final",
      quizOrder: 1,
      globalQuizOrder: 1,
      coveredLessonIds: ["lesson_1", "lesson_2"],
      coveredLessonOrders: [1, 2],
      coveredLessonStartOrder: 1,
      coveredLessonEndOrder: 2,
      coveredLessonCount: 2,
      afterLessonOrder: 2,
    },
  });
  const exam = block({
    id: "exam_1",
    title: "Final Exam",
    type: "exam",
    subcategory: "final",
    estimatedMinutes: 90,
    overlayMode: "exclusive",
    metadata: {
      termIndex: 0,
      termKey: "final",
      preferredDate: "2026-06-03",
      anchoredSlot: "preferred_date",
      rawTermSlots: 3,
      initialDelayCount: 0,
      termSlots: 3,
      extraTermSlots: 0,
      futureDelayCount: 0,
      termLessons: 2,
      termPT: 0,
      termWW: 1,
      termQuizAmount: 1,
    },
  });

  const result = placeBlocks({
    slots,
    blocks: [lesson1, lesson2, quiz1, exam],
  });

  assert.equal(result.unscheduledBlockIds.length, 0, "Expected every test block to be scheduled.");

  const lesson2Placement = findPlacement(result.slots, lesson2.id);
  const quizPlacement = findPlacement(result.slots, quiz1.id);
  const examPlacement = findPlacement(result.slots, exam.id);

  assert.ok(lesson2Placement, "Expected Lesson 2 to be scheduled.");
  assert.ok(quizPlacement, "Expected Quiz 1 to be scheduled.");
  assert.ok(examPlacement, "Expected the exam to be scheduled.");
  assert.equal(result.slots[examPlacement!.slotIndex]!.date, "2026-06-03");
  assert.ok(
    quizPlacement!.slotIndex > lesson2Placement!.slotIndex ||
      (quizPlacement!.slotIndex === lesson2Placement!.slotIndex &&
        quizPlacement!.placementIndex > lesson2Placement!.placementIndex),
    "Expected the quiz to be placed after its covered lessons."
  );

  console.log("new algorithm revalidation: shared-slot placement and quiz coverage checks passed");
}

run();
