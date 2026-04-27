import { compareBlocksByCanonicalSequence } from "./sequence";
import { isGuaranteedBlock } from "./schedulingPolicy";
import {
  addPlacement,
  canPlaceInSlot,
  rebuildPlacementIds,
} from "./slotState";
import type { Block, PlacementResult, SessionSlot } from "./types";

type PlaceCoreBlocksInput = {
  slots: SessionSlot[];
  blocks: Block[];
  requireEmptySlotsOnly?: boolean;
};

function compareSlots(a: SessionSlot, b: SessionSlot) {
  const dateCompare = a.date.localeCompare(b.date);
  if (dateCompare !== 0) return dateCompare;
  return (a.startTime ?? "").localeCompare(b.startTime ?? "");
}

function cloneSlots(slots: SessionSlot[]) {
  return [...slots]
    .map((slot) => ({
      ...slot,
      placements: [...slot.placements],
    }))
    .sort(compareSlots);
}

function pickSlotIndex(
  slots: SessionSlot[],
  block: Block,
  blockMap: Map<string, Block>,
  startIndex: number,
  endIndex: number,
  requireEmptySlotsOnly: boolean
) {
  for (let index = Math.max(0, startIndex); index <= endIndex && index < slots.length; index += 1) {
    if (
      canPlaceInSlot(slots[index]!, block, blockMap, {
        requireEmpty: requireEmptySlotsOnly,
      })
    ) {
      return index;
    }
  }
  return -1;
}

function pickOverflowSlotIndex(
  slots: SessionSlot[],
  block: Block,
  blockMap: Map<string, Block>,
  startIndex: number,
  endIndex: number
) {
  for (let index = Math.max(0, startIndex); index <= endIndex && index < slots.length; index += 1) {
    const slot = slots[index]!;
    if (slot.locked) continue;
    const originalMinutes = slot.minutes;
    slot.minutes = 0;
    const canPlace = canPlaceInSlot(slot, block, blockMap, { requireEmpty: false });
    slot.minutes = originalMinutes;
    if (canPlace) return index;
  }
  return -1;
}

function pickExamSlotIndex(
  slots: SessionSlot[],
  exam: Block,
  blockMap: Map<string, Block>,
  requireEmptySlotsOnly: boolean
) {
  const preferredDate =
    typeof exam.metadata.preferredDate === "string" ? exam.metadata.preferredDate : null;
  if (preferredDate) {
    for (let index = slots.length - 1; index >= 0; index -= 1) {
      if (slots[index]!.date !== preferredDate) continue;
      if (
        canPlaceInSlot(slots[index]!, exam, blockMap, {
          requireEmpty: requireEmptySlotsOnly,
        })
      ) {
        return index;
      }
    }
  }

  for (let index = slots.length - 1; index >= 0; index -= 1) {
    if (
      canPlaceInSlot(slots[index]!, exam, blockMap, {
        requireEmpty: requireEmptySlotsOnly,
      })
    ) {
      return index;
    }
  }

  return -1;
}

function sortBlocks(blocks: Block[], matcher: (block: Block) => boolean) {
  return blocks.filter(matcher).sort(compareBlocksByCanonicalSequence);
}

function collectSeededState(
  slots: SessionSlot[],
  blocksById: Map<string, Block>
) {
  const placedBlockIds = new Set<string>();
  const lessonSlotIndexByOrder = new Map<number, number>();
  let seededExamSlotIndex = -1;
  let seededOrientationSlotIndex = -1;
  let lastSeededLessonSlotIndex = -1;

  slots.forEach((slot, slotIndex) => {
    slot.placements = slot.placements.filter((placement) => blocksById.has(placement.blockId));
    slot.placements.forEach((placement, placementIndex) => {
      const block = blocksById.get(placement.blockId) ?? null;
      if (!block) return;
      placedBlockIds.add(block.id);
      if (block.type === "lesson" && !block.metadata.extraCandidateType) {
        const lessonOrder = Number(block.metadata.lessonOrder ?? 0);
        if (lessonOrder > 0 && !lessonSlotIndexByOrder.has(lessonOrder)) {
          lessonSlotIndexByOrder.set(lessonOrder, slotIndex);
        }
        lastSeededLessonSlotIndex = Math.max(lastSeededLessonSlotIndex, slotIndex);
      }
      if (block.type === "exam" && seededExamSlotIndex < 0) {
        seededExamSlotIndex = slotIndex;
      }
      if (
        block.type === "buffer" &&
        block.subcategory === "orientation" &&
        seededOrientationSlotIndex < 0
      ) {
        seededOrientationSlotIndex = slotIndex;
      }
      if (placementIndex === 0) rebuildPlacementIds(slot);
    });
  });

  return {
    placedBlockIds,
    lessonSlotIndexByOrder,
    seededExamSlotIndex,
    seededOrientationSlotIndex,
    lastSeededLessonSlotIndex,
  };
}

export function placeCoreBlocks(input: PlaceCoreBlocksInput): PlacementResult {
  const slots = cloneSlots(input.slots);
  const blocksById = new Map(input.blocks.map((block) => [block.id, block]));
  const requireEmptySlotsOnly = Boolean(input.requireEmptySlotsOnly);

  const {
    placedBlockIds,
    lessonSlotIndexByOrder,
    seededExamSlotIndex,
    seededOrientationSlotIndex,
    lastSeededLessonSlotIndex,
  } = collectSeededState(slots, blocksById);

  const orientation =
    input.blocks.find(
      (block) =>
        block.type === "buffer" &&
        block.subcategory === "orientation" &&
        !block.metadata.extraCandidateType &&
        !placedBlockIds.has(block.id)
    ) ?? null;
  const exam =
    input.blocks.find(
      (block) =>
        block.type === "exam" &&
        !block.metadata.extraCandidateType &&
        !placedBlockIds.has(block.id)
    ) ?? null;

  let examSlotIndex = seededExamSlotIndex >= 0 ? seededExamSlotIndex : slots.length - 1;
  if (exam) {
    const picked = pickExamSlotIndex(slots, exam, blocksById, requireEmptySlotsOnly);
    if (picked >= 0) {
      examSlotIndex = picked;
      addPlacement(slots[picked]!, exam);
      placedBlockIds.add(exam.id);
    }
  }

  let cursor =
    seededOrientationSlotIndex >= 0
      ? seededOrientationSlotIndex + 1
      : Math.max(0, lastSeededLessonSlotIndex);
  if (orientation) {
    const picked = pickSlotIndex(
      slots,
      orientation,
      blocksById,
      0,
      Math.max(0, examSlotIndex - 1),
      requireEmptySlotsOnly
    );
    if (picked >= 0) {
      addPlacement(slots[picked]!, orientation);
      placedBlockIds.add(orientation.id);
      cursor = Math.max(cursor, picked + 1);
    }
  }

  const lastUsableSlotIndex = Math.max(0, examSlotIndex - (exam || seededExamSlotIndex >= 0 ? 1 : 0));
  const lessons = sortBlocks(
    input.blocks,
    (block) =>
      block.type === "lesson" &&
      !block.metadata.extraCandidateType &&
      !placedBlockIds.has(block.id)
  );
  const performanceTasks = sortBlocks(
    input.blocks,
    (block) =>
      block.type === "performance_task" &&
      !block.metadata.extraCandidateType &&
      !placedBlockIds.has(block.id)
  );
  const quizzes = sortBlocks(
    input.blocks,
    (block) =>
      block.type === "written_work" &&
      block.subcategory === "quiz" &&
      !block.metadata.extraCandidateType &&
      !placedBlockIds.has(block.id)
  );
  const writtenWorks = sortBlocks(
    input.blocks,
    (block) =>
      block.type === "written_work" &&
      block.subcategory !== "quiz" &&
      !block.metadata.extraCandidateType &&
      !placedBlockIds.has(block.id)
  );
  const otherBuffers = sortBlocks(
    input.blocks,
    (block) =>
      block.type === "buffer" &&
      block.subcategory !== "orientation" &&
      !block.metadata.extraCandidateType &&
      !placedBlockIds.has(block.id)
  );

  for (const lesson of lessons) {
    const slotIndex = pickSlotIndex(
      slots,
      lesson,
      blocksById,
      cursor,
      lastUsableSlotIndex,
      requireEmptySlotsOnly
    );
    if (slotIndex < 0) continue;
    addPlacement(slots[slotIndex]!, lesson);
    placedBlockIds.add(lesson.id);
    const lessonOrder = Number(lesson.metadata.lessonOrder ?? 0);
    if (lessonOrder > 0) lessonSlotIndexByOrder.set(lessonOrder, slotIndex);
    cursor = Math.max(cursor, slotIndex);
  }

  const totalLessonCount = Math.max(
    lessons.length + lessonSlotIndexByOrder.size,
    1
  );
  const ptByLessonAnchor = new Map<number, Block[]>();
  performanceTasks.forEach((block, index) => {
    const anchor = Math.min(
      totalLessonCount,
      Math.max(1, Math.round(((index + 1) / (performanceTasks.length + 1)) * totalLessonCount))
    );
    const current = ptByLessonAnchor.get(anchor) ?? [];
    current.push(block);
    ptByLessonAnchor.set(anchor, current);
  });

  for (const [anchorLessonOrder, blocks] of Array.from(ptByLessonAnchor.entries()).sort((a, b) => a[0] - b[0])) {
    const anchorIndex = lessonSlotIndexByOrder.get(anchorLessonOrder) ?? cursor;
    for (const block of blocks) {
      const slotIndex = pickSlotIndex(
        slots,
        block,
        blocksById,
        anchorIndex,
        lastUsableSlotIndex,
        requireEmptySlotsOnly
      );
      if (slotIndex < 0) continue;
      addPlacement(slots[slotIndex]!, block);
      placedBlockIds.add(block.id);
    }
  }

  for (const quiz of quizzes) {
    const afterLessonOrder = Number(
      quiz.metadata.coveredLessonEndOrder ?? quiz.metadata.afterLessonOrder ?? 0
    );
    const anchorIndex = lessonSlotIndexByOrder.get(afterLessonOrder);
    if (afterLessonOrder > 0 && anchorIndex === undefined) continue;
    const startIndex = anchorIndex ?? cursor;
    const slotIndex = pickSlotIndex(
      slots,
      quiz,
      blocksById,
      startIndex,
      lastUsableSlotIndex,
      requireEmptySlotsOnly
    );
    if (slotIndex < 0) continue;
    addPlacement(slots[slotIndex]!, quiz);
    placedBlockIds.add(quiz.id);
  }

  const fillables = [...writtenWorks, ...otherBuffers];
  for (const block of fillables) {
    const slotIndex = pickSlotIndex(
      slots,
      block,
      blocksById,
      0,
      lastUsableSlotIndex,
      requireEmptySlotsOnly
    );
    if (slotIndex < 0) continue;
    addPlacement(slots[slotIndex]!, block);
    placedBlockIds.add(block.id);
  }

  const remainingGuaranteedBlocks = input.blocks.filter(
    (block) => !placedBlockIds.has(block.id) && isGuaranteedBlock(block)
  );
  for (const block of remainingGuaranteedBlocks) {
    let startIndex = 0;
    if (block.type === "written_work" && block.subcategory === "quiz") {
      const afterLessonOrder = Number(
        block.metadata.coveredLessonEndOrder ?? block.metadata.afterLessonOrder ?? 0
      );
      const anchorIndex = lessonSlotIndexByOrder.get(afterLessonOrder);
      if (afterLessonOrder > 0 && anchorIndex !== undefined) {
        startIndex = anchorIndex;
      }
    }
    const slotIndex = pickOverflowSlotIndex(
      slots,
      block,
      blocksById,
      startIndex,
      lastUsableSlotIndex
    );
    if (slotIndex < 0) continue;
    addPlacement(slots[slotIndex]!, block);
    placedBlockIds.add(block.id);
  }

  return {
    slots,
    unscheduledBlockIds: input.blocks
      .filter((block) => !placedBlockIds.has(block.id))
      .map((block) => block.id),
  };
}
