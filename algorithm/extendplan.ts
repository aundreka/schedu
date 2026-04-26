import type { Block, Placement, SessionSlot } from "./types";

type TermPlacementContext = {
  termSlots: SessionSlot[];
  blocks: Block[];
  unscheduled: Set<string>;
};

function placementId(blockId: string, slotId: string, order: number) {
  return `placement__${blockId}__${slotId}__${order}`;
}

function rebuildPlacementIds(slot: SessionSlot) {
  slot.placements = slot.placements.map((placement, index) => ({
    ...placement,
    id: placementId(placement.blockId, slot.id, index + 1),
    slotId: slot.id,
  }));
}

function slotHasMajorBlock(slot: SessionSlot) {
  return slot.placements.some((placement) => placement.lane === "major");
}

function addPlacement(slot: SessionSlot, block: Block, lane: Placement["lane"] = "major") {
  slot.placements.push({
    id: placementId(block.id, slot.id, slot.placements.length + 1),
    blockId: block.id,
    slotId: slot.id,
    lane,
    minutesUsed: Math.min(slot.minutes || block.estimatedMinutes, block.estimatedMinutes),
    chainId: block.id,
    segmentIndex: 1,
    segmentCount: 1,
    continuesFromPrevious: false,
    continuesToNext: false,
    startTime: null,
    endTime: null,
  });
}

function insertMajorAt(termSlots: SessionSlot[], targetIndex: number, block: Block) {
  let emptyIndex = -1;
  for (let index = termSlots.length - 2; index >= targetIndex; index -= 1) {
    const slot = termSlots[index];
    if (!slot.locked && !slotHasMajorBlock(slot)) {
      emptyIndex = index;
      break;
    }
  }
  if (emptyIndex === -1) return false;

  for (let index = emptyIndex; index > targetIndex; index -= 1) {
    const source = termSlots[index - 1]!;
    const destination = termSlots[index]!;
    const majorPlacements = source.placements.filter((placement) => placement.lane === "major");
    if (majorPlacements.length === 0) continue;
    destination.placements.push(
      ...majorPlacements.map((placement, placementIndex) => ({
        ...placement,
        id: placementId(placement.blockId, destination.id, destination.placements.length + placementIndex + 1),
        slotId: destination.id,
      }))
    );
    source.placements = source.placements.filter((placement) => placement.lane !== "major");
  }

  const targetSlot = termSlots[targetIndex];
  if (!targetSlot || targetSlot.locked || slotHasMajorBlock(targetSlot)) return false;
  addPlacement(targetSlot, block, "major");
  return true;
}

function findBlockById(blocks: Block[], id: string) {
  return blocks.find((block) => block.id === id) ?? null;
}

function findPlacementIndex(termSlots: SessionSlot[], blockId: string) {
  for (let index = 0; index < termSlots.length; index += 1) {
    if (termSlots[index]?.placements.some((placement) => placement.blockId === blockId)) {
      return index;
    }
  }
  return -1;
}

function getMajorBlockId(slot: SessionSlot) {
  return slot.placements.find((placement) => placement.lane === "major")?.blockId ?? null;
}

function getBufferRemovalPriority(block: Block) {
  if (block.metadata.extraCandidateType === "review_before_exam") return 1;
  if (block.metadata.extraCandidateType === "review_before_quiz") return 2;
  if (block.subcategory === "preparation") return 3;
  return 4;
}

function coreWindowSlots(termSlots: SessionSlot[]) {
  return termSlots.slice(0, -1);
}

function createEmptySlotAt(termSlots: SessionSlot[], targetIndex: number) {
  const lastCoreIndex = Math.max(0, termSlots.length - 2);
  if (targetIndex < 0 || targetIndex > lastCoreIndex) return false;
  if (termSlots[targetIndex]?.locked) return false;
  if ((termSlots[targetIndex]?.placements.length ?? 0) === 0) return true;

  let emptyIndex = -1;
  for (let index = lastCoreIndex; index >= targetIndex; index -= 1) {
    const slot = termSlots[index];
    if (!slot || slot.locked || slot.placements.length > 0) continue;
    emptyIndex = index;
    break;
  }
  if (emptyIndex === -1) return false;

  for (let index = emptyIndex; index > targetIndex; index -= 1) {
    const source = termSlots[index - 1]!;
    const destination = termSlots[index]!;
    const majorPlacements = source.placements.filter((placement) => placement.lane === "major");
    if (majorPlacements.length === 0) continue;
    destination.placements.push(
      ...majorPlacements.map((placement, placementIndex) => ({
        ...placement,
        id: placementId(
          placement.blockId,
          destination.id,
          destination.placements.length + placementIndex + 1
        ),
        slotId: destination.id,
      }))
    );
    source.placements = source.placements.filter((placement) => placement.lane !== "major");
    rebuildPlacementIds(source);
    rebuildPlacementIds(destination);
  }

  return (termSlots[targetIndex]?.placements.length ?? 0) === 0;
}

function pickCrowdedPlacementToSplit(slot: SessionSlot, blocks: Block[]) {
  const ranked = [...slot.placements]
    .map((placement) => ({
      placement,
      block: findBlockById(blocks, placement.blockId),
    }))
    .filter((item): item is { placement: Placement; block: Block } => Boolean(item.block))
    .sort((a, b) => {
      const rank = (block: Block) => {
        if (block.type === "performance_task") return 1;
        if (block.type === "written_work") return 2;
        if (block.type === "buffer") return 3;
        if (block.type === "lesson") return 4;
        if (block.type === "exam") return 5;
        return 99;
      };
      const rankCompare = rank(a.block) - rank(b.block);
      if (rankCompare !== 0) return rankCompare;
      return b.placement.segmentIndex - a.placement.segmentIndex;
    });

  return ranked[0]?.placement ?? null;
}

function splitCrowdedSlots(termSlots: SessionSlot[], blocks: Block[]) {
  let moved = false;
  const coreSlots = coreWindowSlots(termSlots);

  for (let sourceIndex = 0; sourceIndex < coreSlots.length; sourceIndex += 1) {
    const sourceSlot = coreSlots[sourceIndex]!;
    if (sourceSlot.locked || sourceSlot.placements.length < 2) continue;

    const moving = pickCrowdedPlacementToSplit(sourceSlot, blocks);
    if (!moving) continue;
    const targetIndex = sourceIndex + 1;
    if (!createEmptySlotAt(termSlots, targetIndex)) continue;

    const targetSlot = termSlots[targetIndex]!;
    sourceSlot.placements = sourceSlot.placements.filter(
      (placement) => placement.blockId !== moving.blockId
    );
    targetSlot.placements.push({
      ...moving,
      id: placementId(moving.blockId, targetSlot.id, targetSlot.placements.length + 1),
      slotId: targetSlot.id,
    });
    rebuildPlacementIds(sourceSlot);
    rebuildPlacementIds(targetSlot);
    moved = true;
  }

  return moved;
}

function removeLowestPriorityBuffer(termSlots: SessionSlot[], blocks: Block[]) {
  const candidates = termSlots
    .flatMap((slot, slotIndex) =>
      slot.placements.map((placement, placementIndex) => ({
        slot,
        slotIndex,
        placement,
        placementIndex,
        block: findBlockById(blocks, placement.blockId),
      }))
    )
    .filter((item): item is NonNullable<typeof item> & { block: Block } => Boolean(item.block))
    .filter((item) => item.block.type === "buffer" && item.block.metadata.lowPriority !== false)
    .sort((a, b) => {
      const priorityCompare = getBufferRemovalPriority(b.block) - getBufferRemovalPriority(a.block);
      if (priorityCompare !== 0) return priorityCompare;
      if (a.slotIndex !== b.slotIndex) return b.slotIndex - a.slotIndex;
      return b.placementIndex - a.placementIndex;
    });

  const target = candidates[0] ?? null;
  if (!target) return false;

  target.slot.placements = target.slot.placements.filter(
    (placement) => placement.blockId !== target.placement.blockId
  );
  return true;
}

export function extendTermPlan(context: TermPlacementContext) {
  const { termSlots, blocks, unscheduled } = context;
  const examBlock = blocks.find((block) => block.type === "exam") ?? null;
  const extraTermSlots = Number(examBlock?.metadata.extraTermSlots ?? 0);
  if (extraTermSlots <= 0) return;

  let remaining = extraTermSlots;
  if (removeLowestPriorityBuffer(termSlots, blocks)) {
    remaining = Math.max(0, remaining - 1);
    if (examBlock) {
      examBlock.metadata.termSlots = Math.max(0, Number(examBlock.metadata.termSlots ?? 0) - 1);
      examBlock.metadata.extraTermSlots = Math.max(0, Number(examBlock.metadata.extraTermSlots ?? 0) - 1);
    }
  }
  splitCrowdedSlots(termSlots, blocks);

  const coreWindow = coreWindowSlots(termSlots);
  const lessonExtensions = blocks
    .filter((block) => block.metadata.extraCandidateType === "lesson_extension")
    .sort((a, b) => Number(b.metadata.highComplexity ?? false) - Number(a.metadata.highComplexity ?? false) || Number(a.metadata.lessonOrder ?? 0) - Number(b.metadata.lessonOrder ?? 0));
  const ptExtensions = blocks
    .filter((block) => block.metadata.extraCandidateType === "pt_extension")
    .sort((a, b) => Number(b.metadata.prioritizeReporting ?? false) - Number(a.metadata.prioritizeReporting ?? false) || Number(a.metadata.ptOrder ?? 0) - Number(b.metadata.ptOrder ?? 0));
  const quizReviews = blocks
    .filter((block) => block.metadata.extraCandidateType === "review_before_quiz")
    .sort((a, b) => {
      const quizA = blocks.find(
        (block) =>
          block.subcategory === "quiz" &&
          Number(block.metadata.quizOrder ?? 0) === Number(a.metadata.targetQuizOrder ?? 0)
      );
      const quizB = blocks.find(
        (block) =>
          block.subcategory === "quiz" &&
          Number(block.metadata.quizOrder ?? 0) === Number(b.metadata.targetQuizOrder ?? 0)
      );
      const difficultyCompare =
        Number(quizB?.metadata.quizMaxDifficulty ?? 1) - Number(quizA?.metadata.quizMaxDifficulty ?? 1);
      if (difficultyCompare !== 0) return difficultyCompare;
      return Number(b.metadata.targetQuizOrder ?? 0) - Number(a.metadata.targetQuizOrder ?? 0);
    });
  const examReview = blocks.find((block) => block.metadata.extraCandidateType === "review_before_exam") ?? null;
  const extraWW = blocks.find((block) => block.metadata.extraCandidateType === "extra_written_work") ?? null;
  const extraPT = blocks.find((block) => block.metadata.extraCandidateType === "extra_performance_task") ?? null;

  if (remaining > 0 && examReview) {
    const targetIndex = Math.max(0, coreWindow.length - 1);
    if (insertMajorAt(termSlots, targetIndex, examReview)) {
      unscheduled.delete(examReview.id);
      remaining -= 1;
    }
  }

  for (const review of quizReviews) {
    if (remaining <= 0) break;
    const quizOrder = Number(review.metadata.targetQuizOrder ?? 0);
    const quizId = blocks.find((block) => block.subcategory === "quiz" && Number(block.metadata.quizOrder ?? 0) === quizOrder)?.id;
    if (!quizId) continue;
    const quizIndex = findPlacementIndex(termSlots, quizId);
    if (quizIndex <= 0) continue;
    if (insertMajorAt(termSlots, Math.max(0, quizIndex - 1), review)) {
      unscheduled.delete(review.id);
      remaining -= 1;
    }
  }

  if (remaining > 0 && extraWW) {
    for (const slot of coreWindow) {
      if (slot.locked) continue;
      addPlacement(slot, extraWW, "minor");
      unscheduled.delete(extraWW.id);
      remaining -= 1;
      break;
    }
  }

  if (remaining > 0 && extraPT) {
    for (let index = 0; index < coreWindow.length; index += 1) {
      const slot = coreWindow[index]!;
      if (slot.locked || slotHasMajorBlock(slot)) continue;
      const previousMajorId = index > 0 ? getMajorBlockId(coreWindow[index - 1]!) : null;
      if (!previousMajorId) continue;
      const previousMajor = findBlockById(blocks, previousMajorId);
      if (previousMajor?.type !== "lesson") continue;
      addPlacement(slot, extraPT, "major");
      unscheduled.delete(extraPT.id);
      remaining -= 1;
      break;
    }
  }

  for (const extension of ptExtensions) {
    if (remaining <= 0) break;
    const ptOrder = Number(extension.metadata.ptOrder ?? 0);
    const baseBlock = blocks.find(
      (block) =>
        block.type === "performance_task" &&
        !block.metadata.extraCandidateType &&
        Number(block.metadata.ptOrder ?? 0) === ptOrder
    );
    if (!baseBlock) continue;
    const baseIndex = findPlacementIndex(termSlots, baseBlock.id);
    if (baseIndex < 0 || baseIndex >= termSlots.length - 1) continue;
    if (insertMajorAt(termSlots, baseIndex + 1, extension)) {
      unscheduled.delete(extension.id);
      remaining -= 1;
    }
  }

  for (const extension of lessonExtensions) {
    if (remaining <= 0) break;
    const lessonOrder = Number(extension.metadata.lessonOrder ?? 0);
    const baseBlock = blocks.find(
      (block) =>
        block.type === "lesson" &&
        !block.metadata.extraCandidateType &&
        Number(block.metadata.lessonOrder ?? 0) === lessonOrder
    );
    if (!baseBlock) continue;
    const baseIndex = findPlacementIndex(termSlots, baseBlock.id);
    if (baseIndex < 0 || baseIndex >= termSlots.length - 1) continue;
    if (insertMajorAt(termSlots, baseIndex + 1, extension)) {
      unscheduled.delete(extension.id);
      remaining -= 1;
    }
  }
}
