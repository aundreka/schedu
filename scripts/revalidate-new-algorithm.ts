import assert from "node:assert/strict";
import { buildPacingPlan } from "../algorithm/buildPacingPlan";
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
    placements: [],
  };
}

function block(overrides: Partial<Block> & Pick<Block, "id" | "title" | "type" | "subcategory">): Block {
  return {
    courseId: "course_1",
    sourceTocId: null,
    estimatedMinutes: 60,
    minMinutes: 15,
    maxMinutes: 120,
    required: true,
    splittable: false,
    overlayMode: "major",
    preferredSessionType: "lecture",
    dependencies: [],
    metadata: {},
    ...overrides,
  };
}

function placementMinutesByBlock(slot: SessionSlot, blockId: string) {
  return slot.placements
    .filter((placement) => placement.blockId === blockId)
    .reduce((sum, placement) => sum + placement.minutesUsed, 0);
}

function run() {
  const slots: SessionSlot[] = [
    slot("slot_1", "2026-06-01"),
    slot("slot_2", "2026-06-01"),
    slot("slot_3", "2026-06-02"),
    slot("slot_4", "2026-06-03"),
    slot("slot_5", "2026-06-04"),
  ];

  const lesson1 = block({
    id: "lesson_1",
    title: "Lesson 1",
    type: "lesson",
    subcategory: "lecture",
    estimatedMinutes: 120,
    splittable: true,
  });

  const seatwork = block({
    id: "seatwork_1",
    title: "Seatwork",
    type: "written_work",
    subcategory: "seatwork",
    estimatedMinutes: 60,
    overlayMode: "minor",
    preferredSessionType: "any",
    dependencies: [lesson1.id],
    metadata: {
      linkedLessonBlockId: lesson1.id,
    },
  });

  const lesson2 = block({
    id: "lesson_2",
    title: "Lesson 2",
    type: "lesson",
    subcategory: "lecture",
    estimatedMinutes: 120,
    splittable: true,
  });

  const preparation = block({
    id: "prep_reporting",
    title: "Preparation for Reporting",
    type: "buffer",
    subcategory: "preparation",
    estimatedMinutes: 30,
    overlayMode: "minor",
    preferredSessionType: "any",
    dependencies: [lesson2.id],
    metadata: {
      linkedLessonBlockId: lesson2.id,
    },
  });

  const reporting = block({
    id: "reporting_1",
    title: "Reporting",
    type: "performance_task",
    subcategory: "reporting",
    estimatedMinutes: 120,
    splittable: true,
    dependencies: [lesson2.id, preparation.id],
  });

  const blocks = [lesson1, seatwork, lesson2, preparation, reporting];
  const pacingPlan = buildPacingPlan({ slots, blocks });
  const anchoredPlan = {
    ...pacingPlan,
    majorBlockOrder: [lesson1, lesson2, reporting],
    anchors: [
      {
        blockId: lesson1.id,
        preferredSlotId: "slot_1",
        preferredDate: "2026-06-01",
        anchorType: "distributed" as const,
      },
      {
        blockId: lesson2.id,
        preferredSlotId: "slot_3",
        preferredDate: "2026-06-02",
        anchorType: "distributed" as const,
      },
      {
        blockId: reporting.id,
        preferredSlotId: "slot_4",
        preferredDate: "2026-06-03",
        anchorType: "distributed" as const,
      },
    ],
  };

  const result = placeBlocks({
    slots,
    blocks,
    pacingPlan: anchoredPlan,
    teacherRules: {
      allowLessonWrittenWorkOverlay: true,
      preferLessonWrittenWorkOverlay: true,
    },
  });

  assert.equal(result.unscheduledBlocks.length, 0, "Expected every test block to be scheduled.");

  const byId = new Map(result.slots.map((currentSlot) => [currentSlot.id, currentSlot]));
  const slot1 = byId.get("slot_1")!;
  const slot2 = byId.get("slot_2")!;
  const slot3 = byId.get("slot_3")!;
  const slot4 = byId.get("slot_4")!;
  const slot5 = byId.get("slot_5")!;

  assert.equal(placementMinutesByBlock(slot1, lesson1.id), 90);
  assert.equal(placementMinutesByBlock(slot2, lesson1.id), 30);
  assert.equal(placementMinutesByBlock(slot2, seatwork.id), 60);

  assert.equal(placementMinutesByBlock(slot3, lesson2.id), 60);
  assert.equal(placementMinutesByBlock(slot3, preparation.id), 30);
  assert.equal(placementMinutesByBlock(slot4, lesson2.id), 30);
  assert.equal(placementMinutesByBlock(slot4, reporting.id), 60);
  assert.equal(placementMinutesByBlock(slot5, lesson2.id), 30);
  assert.equal(placementMinutesByBlock(slot5, reporting.id), 60);

  const lesson2Placements = result.slots.flatMap((currentSlot) =>
    currentSlot.placements.filter((placement) => placement.blockId === lesson2.id)
  );
  assert.deepEqual(
    lesson2Placements.map((placement) => placement.segmentIndex),
    [1, 2, 3],
    "Expected Lesson 2 to expose a connected 3-segment chain."
  );
  assert.ok(
    lesson2Placements.every((placement) => placement.chainId === lesson2.id),
    "Expected Lesson 2 segments to share a stable chain id."
  );

  const reportingPlacements = result.slots.flatMap((currentSlot) =>
    currentSlot.placements.filter((placement) => placement.blockId === reporting.id)
  );
  assert.deepEqual(
    reportingPlacements.map((placement) => placement.segmentIndex),
    [1, 2],
    "Expected Reporting to expose a connected 2-segment chain."
  );

  console.log("new algorithm revalidation: split, shared-slot, and connected-span checks passed");
}

run();
