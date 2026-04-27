import {
  buildTermSchedulingDiagnostics,
  getUsedMinutes,
} from "./slotState";
import type {
  Block,
  SessionSlot,
  TermSchedulingDiagnostics,
  TOCUnit,
  ValidationIssue,
} from "./types";

export type ValidatePlanInput = {
  slots: SessionSlot[];
  blocks: Block[];
  tocUnits: TOCUnit[];
  emptyGapThreshold?: number;
  underutilizedSlotThreshold?: number;
  expectedHolidayDates?: string[];
  expectedExamDates?: string[];
  expectedTermCount?: number;
  expectedDelayCount?: number;
};

export type ValidatePlanResult = {
  validationIssues: ValidationIssue[];
  termDiagnostics: TermSchedulingDiagnostics[];
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
    utilizationRate: number;
    longestEmptyOpenSlotRun: number;
    termCount: number;
    examCount: number;
    orientationSatisfied: boolean;
    lessonBeforeFinalQuizSatisfied: boolean;
    holidayViolations: number;
    compressionSignals: number;
    expansionSignals: number;
  };
};

function sortSlots(slots: SessionSlot[]) {
  return [...slots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    const timeCompare = (a.startTime ?? "").localeCompare(b.startTime ?? "");
    if (timeCompare !== 0) return timeCompare;
    return a.id.localeCompare(b.id);
  });
}

function getUtilizationRatio(slot: SessionSlot) {
  if (slot.minutes <= 0) return 0;
  return getUsedMinutes(slot) / slot.minutes;
}

function buildBlockMap(blocks: Block[]) {
  return new Map(blocks.map((block) => [block.id, block]));
}

function getPlacedBlockIds(slots: SessionSlot[]) {
  return new Set(slots.flatMap((slot) => slot.placements.map((placement) => placement.blockId)));
}

function isRequiredLessonTOCUnit(unit: TOCUnit) {
  return unit.required;
}

function isMeaningfulInstructionSlot(slot: SessionSlot, blockMap: Map<string, Block>) {
  return slot.placements.some((placement) => {
    const block = blockMap.get(placement.blockId);
    if (!block) return false;
    return (
      block.type === "lesson" ||
      (block.type === "written_work" && block.subcategory === "quiz") ||
      block.type === "performance_task" ||
      (block.type === "buffer" && (block.subcategory === "review" || block.subcategory === "orientation")) ||
      block.type === "exam"
    );
  });
}

function getLongestEmptyOpenSlotRun(slots: SessionSlot[], blockMap: Map<string, Block>) {
  let longest = 0;
  let current = 0;

  for (const slot of slots) {
    if (slot.locked) {
      current = 0;
      continue;
    }

    if (!isMeaningfulInstructionSlot(slot, blockMap)) {
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
) {
  const requiredLessonUnits = tocUnits.filter(isRequiredLessonTOCUnit);
  const lessonBlocks = blocks.filter(
    (block) => block.type === "lesson" && block.required && Boolean(block.sourceTocId)
  );

  const generatedLessonSourceIds = new Set(
    lessonBlocks.map((block) => block.sourceTocId!).filter(Boolean)
  );

  const scheduledLessonSourceIds = new Set(
    lessonBlocks
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
) {
  const matching = blocks.filter((block) => block.type === type && block.required);
  return {
    totalRequired: matching.length,
    scheduledRequired: matching.filter((block) => placedBlockIds.has(block.id)).length,
  };
}

function getPrimaryBlock(slot: SessionSlot, blockMap: Map<string, Block>) {
  const placements = slot.placements
    .map((placement) => blockMap.get(placement.blockId) ?? null)
    .filter((block): block is Block => Boolean(block));
  return (
    placements.find((block) => block.type === "exam") ??
    placements.find((block) => block.type === "buffer" && block.subcategory === "orientation") ??
    placements[0] ??
    null
  );
}

function groupSlotsByTerm(slots: SessionSlot[]) {
  const grouped = new Map<number, SessionSlot[]>();
  for (const slot of slots) {
    const key = slot.termIndex ?? 0;
    const current = grouped.get(key) ?? [];
    current.push(slot);
    grouped.set(key, current);
  }
  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([termIndex, termSlots]) => ({
      termIndex,
      slots: sortSlots(termSlots),
    }));
}

function validateTermShape(
  groupedTerms: ReturnType<typeof groupSlotsByTerm>,
  blockMap: Map<string, Block>,
  issues: ValidationIssue[]
) {
  let orientationSatisfied = true;
  let lessonBeforeFinalQuizSatisfied = true;
  let compressionSignals = 0;
  let expansionSignals = 0;

  for (const term of groupedTerms) {
    const slots = term.slots;
    if (slots.length === 0) continue;
    let termCompressionSignals = 0;
    let termExpansionSignals = 0;

    const firstSlot = slots[0]!;
    const secondSlot = slots[1] ?? null;
    const lastSlot = slots[slots.length - 1]!;
    const firstMajor = getPrimaryBlock(firstSlot, blockMap);
    const secondMajor = secondSlot ? getPrimaryBlock(secondSlot, blockMap) : null;
    const lastMajor = getPrimaryBlock(lastSlot, blockMap);
    const examBlock =
      slots
        .map((slot) => getPrimaryBlock(slot, blockMap))
        .find((block) => block?.type === "exam") ?? null;
    const examAtLastSlot = lastMajor?.type === "exam";
    const examAnchoredToPreferredDate =
      examBlock?.type === "exam" &&
      examBlock.subcategory === "final" &&
      examBlock.metadata.anchoredSlot === "preferred_date";
    const firstPlacementByBlockId = new Map<string, number>();
    slots.forEach((slot, slotIndex) => {
      slot.placements.forEach((placement) => {
        if (!firstPlacementByBlockId.has(placement.blockId)) {
          firstPlacementByBlockId.set(placement.blockId, slotIndex);
        }
      });
    });

    if (!examBlock) {
      issues.push({
        code: "VALIDATE_TERM_MISSING_EXAM",
        severity: "error",
        message: `Term ${term.termIndex + 1} is missing its exam block.`,
        relatedIds: slots.map((slot) => slot.id),
      });
    } else if (!examAtLastSlot && !examAnchoredToPreferredDate) {
      issues.push({
        code: "VALIDATE_TERM_MISSING_EXAM_AT_END",
        severity: "error",
        message: `Term ${term.termIndex + 1} does not end with an exam block.`,
        relatedIds: [lastSlot.id],
      });
    }

    if (term.termIndex === 0) {
      const orientationBlock = Array.from(firstPlacementByBlockId.keys())
        .map((blockId) => blockMap.get(blockId) ?? null)
        .find((block) => block?.type === "buffer" && block.subcategory === "orientation") ?? null;
      const firstLessonBlock = Array.from(firstPlacementByBlockId.keys())
        .map((blockId) => blockMap.get(blockId) ?? null)
        .find((block) => block?.type === "lesson" && !block.metadata.extraCandidateType) ?? null;
      const orientationIndex = orientationBlock ? (firstPlacementByBlockId.get(orientationBlock.id) ?? -1) : -1;
      const firstLessonIndex = firstLessonBlock ? (firstPlacementByBlockId.get(firstLessonBlock.id) ?? -1) : -1;
      const hasOrientation = orientationIndex === 0;
      const hasAnchoredFirstLesson = firstLessonIndex >= 0 && firstLessonIndex <= 1;

      if (!hasOrientation || !hasAnchoredFirstLesson) {
        orientationSatisfied = false;
        issues.push({
          code: "VALIDATE_FIRST_TERM_ORIENTATION_SEQUENCE",
          severity: "error",
          message:
            "The first term must start with orientation followed by the first lesson.",
          relatedIds: [firstSlot.id, ...(secondSlot ? [secondSlot.id] : [])],
        });
      }
    } else {
      const firstRequiredLesson = Array.from(firstPlacementByBlockId.entries())
        .map(([blockId, slotIndex]) => ({
          block: blockMap.get(blockId) ?? null,
          slotIndex,
        }))
        .filter(
          (entry): entry is { block: Block; slotIndex: number } =>
            Boolean(entry.block?.type === "lesson" && !entry.block.metadata.extraCandidateType)
        )
        .sort((a, b) => a.slotIndex - b.slotIndex)[0] ?? null;
      if (!firstRequiredLesson || firstRequiredLesson.slotIndex !== 0) {
        orientationSatisfied = false;
        issues.push({
          code: "VALIDATE_TERM_START_FIRST_LESSON",
          severity: "error",
          message: `Term ${term.termIndex + 1} must begin with the first lesson of that term.`,
          relatedIds: [firstSlot.id],
        });
      }
    }

    let finalQuizIndex = -1;
    let lastLessonIndex = -1;

    for (let index = 0; index < slots.length; index += 1) {
      const major = getPrimaryBlock(slots[index]!, blockMap);

      const minorBlocks = slots[index]!.placements
        .map((placement) => blockMap.get(placement.blockId))
        .filter((block): block is Block => Boolean(block))
        .filter((block) => block.type === "written_work" || block.type === "performance_task");

      if (
        minorBlocks.some((block) => block.type === "written_work") &&
        major?.type === "lesson"
      ) {
        compressionSignals += 1;
        termCompressionSignals += 1;
      }

      if (
        (major?.metadata.lowPriority ?? false) ||
        minorBlocks.some((block) => Boolean(block.metadata.lowPriority))
      ) {
        expansionSignals += 1;
        termExpansionSignals += 1;
      }
    }

    for (const [blockId, slotIndex] of firstPlacementByBlockId.entries()) {
      const block = blockMap.get(blockId) ?? null;
      if (block?.type === "lesson" && !block.metadata.extraCandidateType) {
        lastLessonIndex = Math.max(lastLessonIndex, slotIndex);
      }
      if (block?.type === "written_work" && block.subcategory === "quiz") {
        finalQuizIndex = Math.max(finalQuizIndex, slotIndex);
      }
    }

    if (finalQuizIndex >= 0 && lastLessonIndex > finalQuizIndex) {
      lessonBeforeFinalQuizSatisfied = false;
      issues.push({
        code: "VALIDATE_LESSON_AFTER_FINAL_QUIZ",
        severity: "error",
        message: `Term ${term.termIndex + 1} has lessons after its final quiz.`,
        relatedIds: slots
          .slice(finalQuizIndex, lastLessonIndex + 1)
          .map((slot) => slot.id),
      });
    }

    const extraTermSlots = Number(examBlock?.metadata.extraTermSlots ?? 0);
    const futureDelayCount = Number(examBlock?.metadata.futureDelayCount ?? 0);

    if (extraTermSlots > 0 && termExpansionSignals === 0) {
      issues.push({
        code: "VALIDATE_EXPECTED_EXPANSION_NOT_FOUND",
        severity: "warning",
        message: `Term ${term.termIndex + 1} had spare slots but no low-priority expansion signals were found.`,
        relatedIds: slots.map((slot) => slot.id),
      });
    }

    if (extraTermSlots - futureDelayCount < 0 && termCompressionSignals === 0) {
      issues.push({
        code: "VALIDATE_EXPECTED_COMPRESSION_NOT_FOUND",
        severity: "warning",
        message: `Term ${term.termIndex + 1} appears compressed but no compression signal was found.`,
        relatedIds: slots.map((slot) => slot.id),
      });
    }
  }

  return {
    orientationSatisfied,
    lessonBeforeFinalQuizSatisfied,
    compressionSignals,
    expansionSignals,
  };
}

function validateExpectedTermStructure(
  groupedTerms: ReturnType<typeof groupSlotsByTerm>,
  blocks: Block[],
  issues: ValidationIssue[],
  expectedTermCount?: number
) {
  const examBlocks = blocks
    .filter((block) => block.type === "exam")
    .sort((a, b) => Number(a.metadata.termIndex ?? 0) - Number(b.metadata.termIndex ?? 0));

  const termCount = groupedTerms.length;
  const examCount = examBlocks.length;
  const expectedCount = expectedTermCount ?? (examCount || termCount);

  if (termCount !== expectedCount) {
    issues.push({
      code: "VALIDATE_TERM_COUNT_MISMATCH",
      severity: "error",
      message: `Expected ${expectedCount} term partitions but found ${termCount}.`,
      relatedIds: groupedTerms.flatMap((term) => term.slots.map((slot) => slot.id)),
    });
  }

  const examSubcategories = examBlocks.map((block) => block.subcategory);
  if (
    expectedCount === 2 &&
    examSubcategories.length === 2 &&
    (examSubcategories[0] !== "midterm" || examSubcategories[1] !== "final")
  ) {
    issues.push({
      code: "VALIDATE_TWO_TERM_EXAM_ORDER",
      severity: "error",
      message: "Two-term plans must use midterm then final exam ordering.",
      relatedIds: examBlocks.map((block) => block.id),
    });
  }

  if (
    expectedCount === 3 &&
    examSubcategories.length === 3 &&
    (examSubcategories[0] !== "prelim" ||
      examSubcategories[1] !== "midterm" ||
      examSubcategories[2] !== "final")
  ) {
    issues.push({
      code: "VALIDATE_THREE_TERM_EXAM_ORDER",
      severity: "error",
      message: "Three-term plans must use prelim, midterm, then final exam ordering.",
      relatedIds: examBlocks.map((block) => block.id),
    });
  }

  return {
    termCount,
    examCount,
  };
}

function validateExpectedDates(
  sortedSlots: SessionSlot[],
  blockMap: Map<string, Block>,
  issues: ValidationIssue[],
  expectedHolidayDates?: string[],
  expectedExamDates?: string[]
) {
  let holidayViolations = 0;

  const holidaySet = new Set(expectedHolidayDates ?? []);
  if (holidaySet.size > 0) {
    const violatingSlots = sortedSlots.filter((slot) => holidaySet.has(slot.date));
    holidayViolations = violatingSlots.length;
    if (violatingSlots.length > 0) {
      issues.push({
        code: "VALIDATE_HOLIDAY_SLOT_PRESENT",
        severity: "error",
        message: "Slots were generated on expected holiday dates.",
        relatedIds: violatingSlots.map((slot) => slot.id),
      });
    }
  }

  const examDates = expectedExamDates ?? [];
  for (const examDate of examDates) {
    const slotOnDate = sortedSlots.filter((slot) => slot.date === examDate);
    const hasExamOnDate = slotOnDate.some((slot) => {
      const major = getPrimaryBlock(slot, blockMap);
      return major?.type === "exam";
    });

    if (!hasExamOnDate) {
      issues.push({
        code: "VALIDATE_EXPECTED_EXAM_DATE_MISSING",
        severity: "error",
        message: `No exam block was found on expected exam date ${examDate}.`,
        relatedIds: slotOnDate.map((slot) => slot.id),
      });
    }
  }

  return {
    holidayViolations,
  };
}

function validateExpectedDelays(
  blocks: Block[],
  issues: ValidationIssue[],
  expectedDelayCount?: number
) {
  if (expectedDelayCount === undefined) return;

  const totalFutureDelays = blocks
    .filter((block) => block.type === "exam")
    .reduce((sum, block) => sum + Number(block.metadata.futureDelayCount ?? 0), 0);

  if (totalFutureDelays > expectedDelayCount) {
    issues.push({
      code: "VALIDATE_DELAY_COUNT_OVERFLOW",
      severity: "warning",
      message:
        "Future delay metadata exceeds the expected delay count passed to validation.",
      relatedIds: blocks.filter((block) => block.type === "exam").map((block) => block.id),
    });
  }
}

function validateExactTermSlots(
  groupedTerms: ReturnType<typeof groupSlotsByTerm>,
  blockMap: Map<string, Block>,
  issues: ValidationIssue[]
) {
  for (const term of groupedTerms) {
    const examBlock = term.slots
      .map((slot) => getPrimaryBlock(slot, blockMap))
      .find((block) => block?.type === "exam");

    if (!examBlock) continue;

    const rawTermSlotsFromMetadata = Number(examBlock.metadata.rawTermSlots ?? NaN);
    const initialDelayCount = Number(examBlock.metadata.initialDelayCount ?? 0);
    const termSlotsFromMetadata = Number(examBlock.metadata.termSlots ?? NaN);
    const actualRawTermSlots = term.slots.length;
    const orientationAdjustment =
      term.termIndex === 0 &&
      (() => {
        const firstBlock = getPrimaryBlock(term.slots[0]!, blockMap);
        return firstBlock?.type === "buffer" && firstBlock.subcategory === "orientation";
      })()
        ? 1
        : 0;
    const computedTermSlots =
      actualRawTermSlots - initialDelayCount - orientationAdjustment;

    if (
      Number.isFinite(rawTermSlotsFromMetadata) &&
      rawTermSlotsFromMetadata !== actualRawTermSlots
    ) {
      issues.push({
        code: "VALIDATE_RAW_TERM_SLOT_COUNT_MISMATCH",
        severity: "error",
        message: `Term ${term.termIndex + 1} raw slot count does not match exam metadata.`,
        relatedIds: term.slots.map((slot) => slot.id),
      });
    }

    if (
      Number.isFinite(termSlotsFromMetadata) &&
      termSlotsFromMetadata !== computedTermSlots
    ) {
      issues.push({
        code: "VALIDATE_TERM_SLOT_COUNT_MISMATCH",
        severity: "error",
        message: `Term ${term.termIndex + 1} termSlots must equal raw term slots minus initial delays${orientationAdjustment ? " and orientation" : ""}.`,
        relatedIds: term.slots.map((slot) => slot.id),
      });
    }
  }
}

function validateQuizCoverageAndSlotCapacity(
  groupedTerms: ReturnType<typeof groupSlotsByTerm>,
  blockMap: Map<string, Block>,
  tocUnits: TOCUnit[],
  issues: ValidationIssue[]
) {
  const requiredLessonIds = new Set(tocUnits.filter((unit) => unit.required).map((unit) => unit.id));

  for (const term of groupedTerms) {
    const firstPlacementByBlockId = new Map<string, { slotIndex: number; placementIndex: number }>();
    const lessonFirstPlacementByOrder = new Map<number, { slotIndex: number; placementIndex: number }>();
    const coveredLessonIdsInTerm = new Set<string>();

    term.slots.forEach((slot, slotIndex) => {
      const usedMinutes = getUsedMinutes(slot);
      if (slot.minutes > 0 && usedMinutes > slot.minutes) {
        issues.push({
          code: "VALIDATE_SLOT_MINUTE_OVERFLOW",
          severity: "error",
          message: `Slot ${slot.id} exceeds its scheduled minutes.`,
          relatedIds: [slot.id],
        });
      }

      slot.placements.forEach((placement, placementIndex) => {
        if (!firstPlacementByBlockId.has(placement.blockId)) {
          firstPlacementByBlockId.set(placement.blockId, { slotIndex, placementIndex });
        }
        const block = blockMap.get(placement.blockId) ?? null;
        if (block?.type === "lesson" && !block.metadata.extraCandidateType) {
          const lessonOrder = Number(block.metadata.lessonOrder ?? 0);
          if (lessonOrder > 0 && !lessonFirstPlacementByOrder.has(lessonOrder)) {
            lessonFirstPlacementByOrder.set(lessonOrder, { slotIndex, placementIndex });
          }
        }
      });
    });

    for (const slot of term.slots) {
      for (const placement of slot.placements) {
        const block = blockMap.get(placement.blockId) ?? null;
        if (!block || block.type !== "written_work" || block.subcategory !== "quiz") continue;

        const coveredLessonIds = Array.isArray(block.metadata.coveredLessonIds)
          ? block.metadata.coveredLessonIds.filter((value): value is string => typeof value === "string")
          : [];
        const coveredLessonOrders = Array.isArray(block.metadata.coveredLessonOrders)
          ? block.metadata.coveredLessonOrders
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && value > 0)
          : [];
        const startOrder = Number(block.metadata.coveredLessonStartOrder ?? 0);
        const endOrder = Number(block.metadata.coveredLessonEndOrder ?? 0);
        const coveredLessonCount = Number(block.metadata.coveredLessonCount ?? coveredLessonOrders.length);
        const quizPlacement = firstPlacementByBlockId.get(block.id) ?? null;

        if (
          !quizPlacement ||
          coveredLessonIds.length === 0 ||
          coveredLessonOrders.length === 0 ||
          startOrder <= 0 ||
          endOrder <= 0 ||
          coveredLessonCount < 1
        ) {
          issues.push({
            code: "VALIDATE_QUIZ_COVERAGE_METADATA",
            severity: "error",
            message: `Quiz ${block.title} is missing valid lesson scope metadata.`,
            relatedIds: [block.id],
          });
          continue;
        }

        coveredLessonIds.forEach((lessonId) => coveredLessonIdsInTerm.add(lessonId));
        const lastCoveredPlacement = lessonFirstPlacementByOrder.get(endOrder) ?? null;
        if (!lastCoveredPlacement) {
          issues.push({
            code: "VALIDATE_QUIZ_COVERAGE_LESSON_MISSING",
            severity: "error",
            message: `Quiz ${block.title} references lessons that were not placed.`,
            relatedIds: [block.id],
          });
          continue;
        }

        if (
          quizPlacement.slotIndex < lastCoveredPlacement.slotIndex ||
          (quizPlacement.slotIndex === lastCoveredPlacement.slotIndex &&
            quizPlacement.placementIndex <= lastCoveredPlacement.placementIndex)
        ) {
          issues.push({
            code: "VALIDATE_QUIZ_BEFORE_COVERED_LESSONS",
            severity: "error",
            message: `Quiz ${block.title} must appear after the lessons it covers.`,
            relatedIds: [block.id],
          });
        }
      }
    }

    const termRequiredLessons = Array.from(requiredLessonIds).filter((lessonId) =>
      Array.from(blockMap.values()).some(
        (block) =>
          block.type === "lesson" &&
          !block.metadata.extraCandidateType &&
          Number(block.metadata.termIndex ?? -1) === term.termIndex &&
          block.sourceTocId === lessonId
      )
    );
    const uncoveredRequiredLessons = termRequiredLessons.filter(
      (lessonId) => !coveredLessonIdsInTerm.has(lessonId)
    );
    if (uncoveredRequiredLessons.length > 0) {
      issues.push({
        code: "VALIDATE_REQUIRED_LESSON_MISSING_QUIZ_COVERAGE",
        severity: "error",
        message: `Some lessons in term ${term.termIndex + 1} are not covered by any quiz.`,
        relatedIds: uncoveredRequiredLessons,
      });
    }
  }
}

function expectedBlockTitle(block: Block) {
  if (block.type === "lesson") {
    const order = Number(block.metadata.globalLessonOrder ?? block.metadata.lessonOrder ?? NaN);
    return Number.isFinite(order) && order > 0 ? `L${order}` : null;
  }
  if (block.type === "written_work" && block.subcategory !== "quiz") {
    const order = Number(block.metadata.wwOrder ?? NaN);
    return Number.isFinite(order) && order > 0 ? `WW${order}` : null;
  }
  if (block.type === "performance_task") {
    const order = Number(block.metadata.ptOrder ?? NaN);
    return Number.isFinite(order) && order > 0 ? `PT${order}` : null;
  }
  if (block.type === "written_work" && block.subcategory === "quiz") {
    const order = Number(block.metadata.quizOrder ?? NaN);
    return Number.isFinite(order) && order > 0 ? `Q${order}` : null;
  }
  return null;
}

function validateBlockTitlesAndOrder(blocks: Block[], issues: ValidationIssue[]) {
  const orderChecks: {
    code: string;
    type: Block["type"];
    matcher: (block: Block) => boolean;
    orderKey: string;
    label: string;
  }[] = [
    {
      code: "VALIDATE_LESSON_TITLE_ORDER",
      type: "lesson",
      matcher: (block) => block.type === "lesson" && !block.metadata.extraCandidateType,
      orderKey: "globalLessonOrder",
      label: "lesson",
    },
    {
      code: "VALIDATE_WW_TITLE_ORDER",
      type: "written_work",
      matcher: (block) =>
        block.type === "written_work" &&
        block.subcategory !== "quiz" &&
        !block.metadata.extraCandidateType,
      orderKey: "wwOrder",
      label: "written work",
    },
    {
      code: "VALIDATE_PT_TITLE_ORDER",
      type: "performance_task",
      matcher: (block) => block.type === "performance_task" && !block.metadata.extraCandidateType,
      orderKey: "ptOrder",
      label: "performance task",
    },
    {
      code: "VALIDATE_QUIZ_TITLE_ORDER",
      type: "written_work",
      matcher: (block) => block.type === "written_work" && block.subcategory === "quiz",
      orderKey: "quizOrder",
      label: "quiz",
    },
  ];

  for (const check of orderChecks) {
    const matching = blocks
      .filter(check.matcher)
      .sort(
        (a, b) =>
          Number(a.metadata[check.orderKey] ?? 0) - Number(b.metadata[check.orderKey] ?? 0) ||
          a.id.localeCompare(b.id)
      );

    for (let index = 0; index < matching.length; index += 1) {
      const block = matching[index]!;
      const expectedOrder = index + 1;
      const actualOrder = Number(block.metadata[check.orderKey] ?? 0);
      if (actualOrder !== expectedOrder) {
        issues.push({
          code: check.code,
          severity: "error",
          message: `Global ${check.label} ordering must be sequential across terms.`,
          relatedIds: [block.id],
        });
      }

      const expectedTitle = expectedBlockTitle(block);
      if (expectedTitle && block.title.trim() !== expectedTitle) {
        issues.push({
          code: `${check.code}_TITLE`,
          severity: "error",
          message: `${check.label} titles must use acronym numbering like ${expectedTitle}.`,
          relatedIds: [block.id],
        });
      }
    }
  }
}

export function validatePlan(input: ValidatePlanInput): ValidatePlanResult {
  const {
    slots,
    blocks,
    tocUnits,
    emptyGapThreshold = 4,
    underutilizedSlotThreshold = 0.5,
    expectedHolidayDates,
    expectedExamDates,
    expectedTermCount,
    expectedDelayCount,
  } = input;

  const sortedSlots = sortSlots(slots);
  const blockMap = buildBlockMap(blocks);
  const placedBlockIds = getPlacedBlockIds(sortedSlots);
  const groupedTerms = groupSlotsByTerm(sortedSlots);

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
  const longestEmptyOpenSlotRun = getLongestEmptyOpenSlotRun(sortedSlots, blockMap);

  const lessonCoverage = getRequiredLessonCoverage(tocUnits, blocks, placedBlockIds);
  const ptCounts = countScheduledBlocksByType(blocks, placedBlockIds, "performance_task");
  const wwCounts = countScheduledBlocksByType(blocks, placedBlockIds, "written_work");

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
        .filter(
          (block) =>
            block.type === "performance_task" &&
            block.required &&
            !placedBlockIds.has(block.id)
        )
        .map((block) => block.id),
    });
  }

  if (wwCounts.scheduledRequired < wwCounts.totalRequired) {
    validationIssues.push({
      code: "VALIDATE_UNSCHEDULED_REQUIRED_WW",
      severity: "warning",
      message: "Some required written work blocks were not scheduled.",
      relatedIds: blocks
        .filter(
          (block) =>
            block.type === "written_work" &&
            block.required &&
            !placedBlockIds.has(block.id)
        )
        .map((block) => block.id),
    });
  }

  if (emptyOpenSlots > 0) {
    validationIssues.push({
      code: "VALIDATE_EMPTY_OPEN_SLOTS",
      severity:
        emptyOpenSlots > Math.max(1, Math.floor(openSlots * 0.1)) ? "warning" : "info",
      message: "There are open slots with no placements.",
      relatedIds: sortedSlots
        .filter((slot) => !slot.locked && slot.placements.length === 0)
        .map((slot) => slot.id),
    });
  }

  if (underutilizedOpenSlots > Math.max(1, Math.floor(openSlots * 0.15))) {
    validationIssues.push({
      code: "VALIDATE_UNDERUTILIZED_OPEN_SLOTS",
      severity: "info",
      message: "There are several placed slots with low utilization.",
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
      code: "VALIDATE_LONG_EMPTY_SLOT_RUN",
      severity: "warning",
      message: "There is a long run of empty open instructional slots.",
      relatedIds: sortedSlots
        .filter((slot) => !slot.locked && slot.placements.length === 0)
        .map((slot) => slot.id),
    });
  }

  const { termCount, examCount } = validateExpectedTermStructure(
    groupedTerms,
    blocks,
    validationIssues,
    expectedTermCount
  );

  const {
    orientationSatisfied,
    lessonBeforeFinalQuizSatisfied,
    compressionSignals,
    expansionSignals,
  } = validateTermShape(groupedTerms, blockMap, validationIssues);

  const { holidayViolations } = validateExpectedDates(
    sortedSlots,
    blockMap,
    validationIssues,
    expectedHolidayDates,
    expectedExamDates
  );

  validateExpectedDelays(blocks, validationIssues, expectedDelayCount);
  validateExactTermSlots(groupedTerms, blockMap, validationIssues);
  validateBlockTitlesAndOrder(blocks, validationIssues);
  validateQuizCoverageAndSlotCapacity(groupedTerms, blockMap, tocUnits, validationIssues);
  const termDiagnostics = groupedTerms.map((term) =>
    buildTermSchedulingDiagnostics({
      termIndex: term.termIndex,
      slots: term.slots,
      blocks: blocks.filter((block) => Number(block.metadata.termIndex ?? -1) === term.termIndex),
      unscheduledBlockIds: blocks
        .filter(
          (block) =>
            Number(block.metadata.termIndex ?? -1) === term.termIndex &&
            !placedBlockIds.has(block.id)
        )
        .map((block) => block.id),
      hasValidationErrors: validationIssues.some((issue) =>
        issue.relatedIds.some((relatedId) => term.slots.some((slot) => slot.id === relatedId))
      ),
    })
  );

  for (const diagnostic of termDiagnostics) {
    if (!diagnostic.guaranteedPlacementSatisfied) {
      validationIssues.push({
        code: "VALIDATE_GUARANTEED_BLOCKS_NOT_PLACED",
        severity: "error",
        message: `Term ${diagnostic.termIndex + 1} still has guaranteed blocks that were not placed.`,
        relatedIds: diagnostic.unscheduledRequiredBlockIds,
      });
    }
    if (diagnostic.emptyEligibleSlotCount > 0 && diagnostic.unscheduledRequiredBlockIds.length > 0) {
      validationIssues.push({
        code: "VALIDATE_TERM_HAS_EMPTY_SLOTS_WITH_UNSCHEDULED_REQUIRED_BLOCKS",
        severity: "warning",
        message: `Term ${diagnostic.termIndex + 1} still has empty eligible slots while required blocks remain unscheduled.`,
        relatedIds: diagnostic.unscheduledRequiredBlockIds,
      });
    }
    if (diagnostic.requiresCompression && diagnostic.unscheduledRequiredBlockIds.length > 0) {
      validationIssues.push({
        code: "VALIDATE_TERM_REQUIRES_COMPRESSION",
        severity: "warning",
        message: `Term ${diagnostic.termIndex + 1} requires compression because empty slots are exhausted.`,
        relatedIds: diagnostic.unscheduledRequiredBlockIds,
      });
    }
    if (diagnostic.droppedElasticBlockIds.length > 0) {
      validationIssues.push({
        code: "VALIDATE_DROPPED_ELASTIC_BLOCKS",
        severity: "info",
        message: `Term ${diagnostic.termIndex + 1} dropped optional elastic blocks to preserve the core plan.`,
        relatedIds: diagnostic.droppedElasticBlockIds,
      });
    }
  }

  return {
    validationIssues,
    termDiagnostics,
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
      termCount,
      examCount,
      orientationSatisfied,
      lessonBeforeFinalQuizSatisfied,
      holidayViolations,
      compressionSignals,
      expansionSignals,
    },
  };
}
