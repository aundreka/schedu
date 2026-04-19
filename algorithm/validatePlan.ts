import {
  Block,
  SessionSlot,
  TOCUnit,
  ValidationIssue,
} from "./types";

export type ValidatePlanInput = {
  slots: SessionSlot[];
  blocks: Block[];
  tocUnits: TOCUnit[];
  emptyGapThreshold?: number; // consecutive open slots with no meaningful major instruction
  underutilizedSlotThreshold?: number; // 0 to 1
};

export type ValidatePlanResult = {
  validationIssues: ValidationIssue[];
  metrics: {
    totalSlots: number;
    openSlots: number;
    lockedSlots: number;
    emptyOpenSlots: number;
    underutilizedOpenSlots: number;
    totalRequiredLessons: number;
    generatedRequiredLessonBlocks: number;
    scheduledRequiredLessonBlocks: number;
    unscheduledRequiredLessonIds: string[];
    totalRequiredPerformanceTasks: number;
    scheduledRequiredPerformanceTasks: number;
    totalRequiredWrittenWorks: number;
    scheduledRequiredWrittenWorks: number;
    utilizationRate: number; // 0 to 1
    longestEmptyOpenSlotRun: number;
  };
};

function sortSlots(slots: SessionSlot[]): SessionSlot[] {
  return [...slots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;

    const startCompare = (a.startTime ?? "").localeCompare(b.startTime ?? "");
    if (startCompare !== 0) return startCompare;

    return a.id.localeCompare(b.id);
  });
}

function getUsedMinutes(slot: SessionSlot): number {
  return slot.placements.reduce((sum, placement) => sum + placement.minutesUsed, 0);
}

function getRemainingMinutes(slot: SessionSlot): number {
  return Math.max(0, slot.minutes - getUsedMinutes(slot));
}

function getUtilizationRatio(slot: SessionSlot): number {
  if (slot.minutes <= 0) return 0;
  return getUsedMinutes(slot) / slot.minutes;
}

function buildBlockMap(blocks: Block[]): Map<string, Block> {
  return new Map(blocks.map((block) => [block.id, block]));
}

function getPlacedBlockIds(slots: SessionSlot[]): Set<string> {
  return new Set(slots.flatMap((slot) => slot.placements.map((placement) => placement.blockId)));
}

function isRequiredLessonTOCUnit(unit: TOCUnit): boolean {
  return unit.required;
}

function isLessonLikeBlock(block: Block): boolean {
  return block.type === "lesson";
}

function isMeaningfulMajorInstructionSlot(slot: SessionSlot, blockMap: Map<string, Block>): boolean {
  return slot.placements.some((placement) => {
    if (placement.lane !== "major") return false;
    const block = blockMap.get(placement.blockId);
    if (!block) return false;
    return (
      block.type === "lesson" ||
      (block.type === "written_work" && block.subcategory === "quiz") ||
      block.type === "performance_task" ||
      (block.type === "buffer" && block.subcategory === "review") ||
      block.type === "exam"
    );
  });
}

function getLongestEmptyOpenSlotRun(
  slots: SessionSlot[],
  blockMap: Map<string, Block>
): number {
  let longest = 0;
  let current = 0;

  for (const slot of slots) {
    if (slot.locked) {
      current = 0;
      continue;
    }

    if (!isMeaningfulMajorInstructionSlot(slot, blockMap)) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }

  return longest;
}

function getRequiredLessonCoverage(
  tocUnits: TOCUnit[],
  blocks: Block[],
  placedBlockIds: Set<string>
): {
  totalRequiredLessons: number;
  generatedRequiredLessonBlocks: number;
  scheduledRequiredLessonBlocks: number;
  unscheduledRequiredLessonIds: string[];
} {
  const requiredLessonUnits = tocUnits.filter(isRequiredLessonTOCUnit);
  const lessonLikeBlocks = blocks.filter(
    (block) => isLessonLikeBlock(block) && block.required && Boolean(block.sourceTocId)
  );

  const generatedLessonSourceIds = new Set(
    lessonLikeBlocks.map((block) => block.sourceTocId!).filter(Boolean)
  );

  const scheduledLessonSourceIds = new Set(
    lessonLikeBlocks
      .filter((block) => placedBlockIds.has(block.id))
      .map((block) => block.sourceTocId!)
      .filter(Boolean)
  );

  const unscheduledRequiredLessonIds = requiredLessonUnits
    .filter((unit) => !scheduledLessonSourceIds.has(unit.id))
    .map((unit) => unit.id);

  return {
    totalRequiredLessons: requiredLessonUnits.length,
    generatedRequiredLessonBlocks: generatedLessonSourceIds.size,
    scheduledRequiredLessonBlocks: scheduledLessonSourceIds.size,
    unscheduledRequiredLessonIds,
  };
}

function countScheduledBlocksByType(
  blocks: Block[],
  placedBlockIds: Set<string>,
  type: Block["type"]
): { totalRequired: number; scheduledRequired: number } {
  const matching = blocks.filter((block) => block.type === type && block.required);

  return {
    totalRequired: matching.length,
    scheduledRequired: matching.filter((block) => placedBlockIds.has(block.id)).length,
  };
}

export function validatePlan(input: ValidatePlanInput): ValidatePlanResult {
  const {
    slots,
    blocks,
    tocUnits,
    emptyGapThreshold = 4,
    underutilizedSlotThreshold = 0.5,
  } = input;

  const sortedSlots = sortSlots(slots);
  const blockMap = buildBlockMap(blocks);
  const placedBlockIds = getPlacedBlockIds(sortedSlots);

  const totalSlots = sortedSlots.length;
  const lockedSlots = sortedSlots.filter((slot) => slot.locked).length;
  const openSlots = totalSlots - lockedSlots;

  const emptyOpenSlots = sortedSlots.filter(
    (slot) => !slot.locked && slot.placements.length === 0
  ).length;

  const underutilizedOpenSlots = sortedSlots.filter(
    (slot) =>
      !slot.locked &&
      slot.placements.length > 0 &&
      getUtilizationRatio(slot) < underutilizedSlotThreshold
  ).length;

  const totalMinutes = sortedSlots.reduce((sum, slot) => sum + slot.minutes, 0);
  const usedMinutes = sortedSlots.reduce((sum, slot) => sum + getUsedMinutes(slot), 0);
  const utilizationRate = totalMinutes > 0 ? usedMinutes / totalMinutes : 0;

  const lessonCoverage = getRequiredLessonCoverage(tocUnits, blocks, placedBlockIds);

  const ptCounts = countScheduledBlocksByType(blocks, placedBlockIds, "performance_task");
  const wwCounts = countScheduledBlocksByType(blocks, placedBlockIds, "written_work");

  const longestEmptyOpenSlotRun = getLongestEmptyOpenSlotRun(sortedSlots, blockMap);

  const validationIssues: ValidationIssue[] = [];

  if (lessonCoverage.generatedRequiredLessonBlocks < lessonCoverage.totalRequiredLessons) {
    validationIssues.push({
      code: "VALIDATE_MISSING_GENERATED_LESSON_BLOCKS",
      severity: "error",
      message: "Not every required TOC lesson was converted into a lesson block.",
      relatedIds: lessonCoverage.unscheduledRequiredLessonIds,
    });
  }

  if (lessonCoverage.unscheduledRequiredLessonIds.length > 0) {
    validationIssues.push({
      code: "VALIDATE_UNSCHEDULED_REQUIRED_LESSONS",
      severity: "error",
      message: "Some required lessons from the table of contents were not scheduled.",
      relatedIds: lessonCoverage.unscheduledRequiredLessonIds,
    });
  }

  if (ptCounts.scheduledRequired < ptCounts.totalRequired) {
    validationIssues.push({
      code: "VALIDATE_UNSCHEDULED_REQUIRED_PTS",
      severity: "warning",
      message: "Some required performance tasks were not scheduled.",
      relatedIds: blocks
        .filter((block) => block.type === "performance_task" && block.required && !placedBlockIds.has(block.id))
        .map((block) => block.id),
    });
  }

  if (wwCounts.scheduledRequired < wwCounts.totalRequired) {
    validationIssues.push({
      code: "VALIDATE_UNSCHEDULED_REQUIRED_WW",
      severity: "warning",
      message: "Some required written work blocks were not scheduled.",
      relatedIds: blocks
        .filter((block) => block.type === "written_work" && block.required && !placedBlockIds.has(block.id))
        .map((block) => block.id),
    });
  }

  if (emptyOpenSlots > 0) {
    validationIssues.push({
      code: "VALIDATE_EMPTY_OPEN_SLOTS",
      severity: emptyOpenSlots > Math.max(1, Math.floor(openSlots * 0.1)) ? "warning" : "info",
      message: "There are open slots with no placements.",
      relatedIds: sortedSlots
        .filter((slot) => !slot.locked && slot.placements.length === 0)
        .map((slot) => slot.id),
    });
  }

  if (underutilizedOpenSlots > Math.max(1, Math.floor(openSlots * 0.15))) {
    validationIssues.push({
      code: "VALIDATE_UNDERUTILIZED_SLOTS",
      severity: "info",
      message: "Many open slots are underutilized. Consider stronger backfilling or compaction.",
      relatedIds: sortedSlots
        .filter(
          (slot) =>
            !slot.locked &&
            slot.placements.length > 0 &&
            getUtilizationRatio(slot) < underutilizedSlotThreshold
        )
        .map((slot) => slot.id),
    });
  }

  if (longestEmptyOpenSlotRun >= emptyGapThreshold) {
    validationIssues.push({
      code: "VALIDATE_LONG_EMPTY_RUN",
      severity: "warning",
      message: `There is a long run of ${longestEmptyOpenSlotRun} consecutive open slots without meaningful major instruction.`,
    });
  }

  if (utilizationRate < 0.5) {
    validationIssues.push({
      code: "VALIDATE_LOW_UTILIZATION",
      severity: "info",
      message: "Overall slot utilization is low. The pacing plan may still be too sparse.",
    });
  }

  return {
    validationIssues,
    metrics: {
      totalSlots,
      openSlots,
      lockedSlots,
      emptyOpenSlots,
      underutilizedOpenSlots,
      totalRequiredLessons: lessonCoverage.totalRequiredLessons,
      generatedRequiredLessonBlocks: lessonCoverage.generatedRequiredLessonBlocks,
      scheduledRequiredLessonBlocks: lessonCoverage.scheduledRequiredLessonBlocks,
      unscheduledRequiredLessonIds: lessonCoverage.unscheduledRequiredLessonIds,
      totalRequiredPerformanceTasks: ptCounts.totalRequired,
      scheduledRequiredPerformanceTasks: ptCounts.scheduledRequired,
      totalRequiredWrittenWorks: wwCounts.totalRequired,
      scheduledRequiredWrittenWorks: wwCounts.scheduledRequired,
      utilizationRate,
      longestEmptyOpenSlotRun,
    },
  };
}
