import type { Block, Placement, PlacementResult, SessionSlot } from "./types";

export type PlaceBlocksInput = {
  slots: SessionSlot[];
  blocks: Block[];
};

type SearchPhase = "lesson" | "pt" | "ww" | "quiz" | "expand" | "compress";

type SearchState = {
  slots: SessionSlot[];
  lessonOffset: number;
  ptOffset: number;
  wwOffset: number;
  quizOffset: number;
  cycleLessonIndexes: number[];
  cursor: number;
  phase: SearchPhase;
  balanceRemaining: number;
  extraIndex: number;
};

type SearchOutcome = {
  slots: SessionSlot[];
  lessonOffset: number;
  ptOffset: number;
  wwOffset: number;
  quizOffset: number;
  balanceRemaining: number;
  score: number;
  complete: boolean;
};

function placementSignature(slot: SessionSlot) {
  return slot.placements
    .map((placement) => `${placement.lane}:${placement.blockId}`)
    .sort()
    .join(",");
}

function stateProgressScore(state: SearchState) {
  return (
    state.lessonOffset * 10_000 +
    state.quizOffset * 3_000 +
    state.ptOffset * 2_000 +
    state.wwOffset * 1_000 +
    Math.max(0, 500 - Math.abs(state.balanceRemaining) * 200) +
    countPlacedMajorSlots(state.slots) * 10 +
    countPlacedMinorBlocks(state.slots)
  );
}

function buildStateSignature(state: SearchState) {
  const cycleKey = state.cycleLessonIndexes.join(",");
  const slotKey = state.slots
    .map((slot) => `${slot.id}[${placementSignature(slot)}]`)
    .join("|");
  return [
    state.phase,
    state.lessonOffset,
    state.ptOffset,
    state.wwOffset,
    state.quizOffset,
    state.cursor,
    state.balanceRemaining,
    state.extraIndex,
    cycleKey,
    slotKey,
  ].join("::");
}

function compareSlots(a: SessionSlot, b: SessionSlot) {
  const dateCompare = a.date.localeCompare(b.date);
  if (dateCompare !== 0) return dateCompare;
  return (a.startTime ?? "").localeCompare(b.startTime ?? "");
}

function placementId(blockId: string, slotId: string, order: number) {
  return `placement__${blockId}__${slotId}__${order}`;
}

function cloneSlots(slots: SessionSlot[]) {
  return [...slots]
    .map((slot) => ({
      ...slot,
      placements: [...slot.placements],
    }))
    .sort(compareSlots);
}

function cloneState(state: SearchState): SearchState {
  return {
    ...state,
    slots: cloneSlots(state.slots),
    cycleLessonIndexes: [...state.cycleLessonIndexes],
  };
}

function rebuildPlacementIds(slot: SessionSlot) {
  slot.placements = slot.placements.map((placement, index) => ({
    ...placement,
    id: placementId(placement.blockId, slot.id, index + 1),
    slotId: slot.id,
  }));
}

function getTermSlots(slots: SessionSlot[]) {
  const grouped = new Map<number, SessionSlot[]>();
  for (const slot of slots) {
    const key = slot.termIndex ?? 0;
    const current = grouped.get(key) ?? [];
    current.push(slot);
    grouped.set(key, current);
  }
  return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
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

function slotHasMajorBlock(slot: SessionSlot) {
  return slot.placements.some((placement) => placement.lane === "major");
}

function getMajorPlacement(slot: SessionSlot) {
  return slot.placements.find((placement) => placement.lane === "major") ?? null;
}

function getMinorPlacements(slot: SessionSlot) {
  return slot.placements.filter((placement) => placement.lane === "minor");
}

function isLectureFriendly(slot: SessionSlot) {
  return (
    slot.sessionType === "lecture" ||
    slot.sessionType === "mixed" ||
    slot.sessionType === "any" ||
    slot.sessionType === null
  );
}

function isLabFriendly(slot: SessionSlot) {
  return slot.sessionType === "laboratory" || slot.sessionType === "mixed";
}

function findBlock<T extends Block["type"]>(
  blocks: Block[],
  type: T,
  termIndex: number,
  predicate?: (block: Block) => boolean
) {
  return blocks
    .filter((block) => block.type === type && Number(block.metadata.termIndex ?? -1) === termIndex)
    .filter((block) => (predicate ? predicate(block) : true));
}

function sortByMetadataOrder(blocks: Block[], key: string) {
  return [...blocks].sort((a, b) => {
    const aOrder = Number(a.metadata[key] ?? 0);
    const bOrder = Number(b.metadata[key] ?? 0);
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.id.localeCompare(b.id);
  });
}

function findBlockById(blocks: Block[], blockId: string) {
  return blocks.find((block) => block.id === blockId) ?? null;
}

function getMajorBlockAt(slots: SessionSlot[], index: number, blocks: Block[]) {
  const slot = slots[index];
  if (!slot) return null;
  const placement = getMajorPlacement(slot);
  return placement ? findBlockById(blocks, placement.blockId) : null;
}

function getLastLessonIndex(slots: SessionSlot[], blocks: Block[]) {
  for (let index = slots.length - 1; index >= 0; index -= 1) {
    const major = getMajorBlockAt(slots, index, blocks);
    if (major?.type === "lesson") return index;
  }
  return -1;
}

function normalizePlacementOrder(slot: SessionSlot, blocks: Block[]) {
  const rank = (placement: Placement) => {
    const block = findBlockById(blocks, placement.blockId);
    if (!block) return 99;
    if (block.type === "lesson") return 1;
    if (block.type === "written_work" && block.subcategory !== "quiz") return 2;
    if (block.type === "performance_task") return 3;
    if (block.type === "written_work" && block.subcategory === "quiz") return 4;
    if (block.type === "buffer") return 5;
    if (block.type === "exam") return 6;
    return 99;
  };

  slot.placements = [...slot.placements].sort(
    (a, b) => rank(a) - rank(b) || a.blockId.localeCompare(b.blockId)
  );
  rebuildPlacementIds(slot);
}

function countPlacedMajorSlots(slots: SessionSlot[]) {
  return slots.filter((slot) => slotHasMajorBlock(slot)).length;
}

function countPlacedMinorBlocks(slots: SessionSlot[]) {
  return slots.reduce((sum, slot) => sum + getMinorPlacements(slot).length, 0);
}

function countFreeMajorSlots(slots: SessionSlot[]) {
  return slots.filter((slot) => !slot.locked && !slotHasMajorBlock(slot)).length;
}

function freeMajorSlotIndexes(
  slots: SessionSlot[],
  startIndex: number,
  predicate: (slot: SessionSlot) => boolean
) {
  const indexes: number[] = [];
  for (let index = startIndex; index < slots.length; index += 1) {
    const slot = slots[index]!;
    if (slot.locked || slotHasMajorBlock(slot) || !predicate(slot)) continue;
    indexes.push(index);
  }
  return indexes;
}

function candidateLessonSlots(
  slots: SessionSlot[],
  startIndex: number,
  count: number,
  hasLabSlots: boolean
) {
  const all = freeMajorSlotIndexes(slots, startIndex, () => true);
  if (!hasLabSlots) return all;
  const lectureFriendly = freeMajorSlotIndexes(slots, startIndex, isLectureFriendly);
  return lectureFriendly.length >= count ? lectureFriendly : all;
}

function chooseCombinations(
  indexes: number[],
  count: number,
  startAt = 0,
  prefix: number[] = [],
  result: number[][] = []
) {
  if (prefix.length === count) {
    result.push([...prefix]);
    return result;
  }

  for (let index = startAt; index < indexes.length; index += 1) {
    prefix.push(indexes[index]!);
    chooseCombinations(indexes, count, index + 1, prefix, result);
    prefix.pop();
  }

  return result;
}

function hasWrittenWorkOnSlot(slot: SessionSlot, blocks: Block[]) {
  return getMinorPlacements(slot).some((placement) => {
    const block = findBlockById(blocks, placement.blockId);
    return block?.type === "written_work" && block.subcategory !== "quiz";
  });
}

function candidatePerformanceTaskSlots(
  slots: SessionSlot[],
  cycleLessonIndexes: number[],
  hasLabSlots: boolean
) {
  if (cycleLessonIndexes.length === 0) return [];

  for (let pairIndex = 0; pairIndex < cycleLessonIndexes.length - 1; pairIndex += 1) {
    const leftIndex = cycleLessonIndexes[pairIndex]!;
    const rightIndex = cycleLessonIndexes[pairIndex + 1]!;
    const between: number[] = [];
    for (let index = leftIndex + 1; index < rightIndex; index += 1) {
      const slot = slots[index]!;
      if (slot.locked || slotHasMajorBlock(slot)) continue;
      between.push(index);
    }
    if (between.length > 0) {
      if (!hasLabSlots) return between;
      const lab = between.filter((index) => isLabFriendly(slots[index]!));
      return lab.length > 0 ? lab : between;
    }
  }

  const fallback = freeMajorSlotIndexes(
    slots,
    Math.max(0, cycleLessonIndexes[0]! + 1),
    () => true
  );
  if (!hasLabSlots) return fallback;
  const lab = fallback.filter((index) => isLabFriendly(slots[index]!));
  return lab.length > 0 ? lab : fallback;
}

function candidateWrittenWorkSlots(
  slots: SessionSlot[],
  cycleLessonIndexes: number[],
  blocks: Block[]
) {
  return cycleLessonIndexes.filter((index) => !hasWrittenWorkOnSlot(slots[index]!, blocks));
}

function candidateQuizSlots(slots: SessionSlot[], afterIndex: number) {
  return freeMajorSlotIndexes(slots, Math.max(0, afterIndex + 1), () => true);
}

function candidateFinalQuizSlots(
  slots: SessionSlot[],
  afterIndex: number,
  reserveReviewSlot: boolean
) {
  const examIndex = Math.max(0, slots.length - 1);
  const targetIndex = Math.max(
    Math.max(0, afterIndex + 1),
    examIndex - (reserveReviewSlot ? 2 : 1)
  );
  const exact = slots[targetIndex];
  if (exact && !exact.locked && !slotHasMajorBlock(exact)) {
    return [targetIndex];
  }

  const fallback: number[] = [];
  for (let index = targetIndex - 1; index >= Math.max(0, afterIndex + 1); index -= 1) {
    const slot = slots[index]!;
    if (slot.locked || slotHasMajorBlock(slot)) continue;
    fallback.push(index);
  }
  return fallback;
}

function moveMajorPlacement(slots: SessionSlot[], fromIndex: number, toIndex: number) {
  const source = slots[fromIndex];
  const destination = slots[toIndex];
  if (!source || !destination) return false;
  const major = getMajorPlacement(source);
  if (!major || destination.locked || slotHasMajorBlock(destination)) return false;
  source.placements = source.placements.filter((placement) => placement.blockId !== major.blockId);
  destination.placements.push({
    ...major,
    id: placementId(major.blockId, destination.id, destination.placements.length + 1),
    slotId: destination.id,
  });
  rebuildPlacementIds(source);
  rebuildPlacementIds(destination);
  return true;
}

function countLessonMajors(slots: SessionSlot[], fromIndex: number, toIndex: number, blocks: Block[]) {
  let count = 0;
  for (let index = fromIndex; index <= toIndex; index += 1) {
    const block = getMajorBlockAt(slots, index, blocks);
    if (block?.type === "lesson") count += 1;
  }
  return count;
}

function getPreviousQuizIndex(slots: SessionSlot[], beforeIndex: number, blocks: Block[]) {
  for (let index = beforeIndex; index >= 0; index -= 1) {
    const block = getMajorBlockAt(slots, index, blocks);
    if (block?.subcategory === "quiz") return index;
  }
  return -1;
}

function canMoveMajorLeft(
  slots: SessionSlot[],
  sourceIndex: number,
  targetIndex: number,
  blocks: Block[],
  hasLabSlots: boolean
) {
  const sourceSlot = slots[sourceIndex]!;
  const targetSlot = slots[targetIndex]!;
  const major = getMajorPlacement(sourceSlot);
  if (!major || targetSlot.locked || slotHasMajorBlock(targetSlot)) return false;
  const block = findBlockById(blocks, major.blockId);
  if (!block) return false;

  if (block.subcategory === "quiz") {
    const previousQuizIndex = getPreviousQuizIndex(slots, targetIndex - 1, blocks);
    const requiredInterval = Number(block.metadata.lessonInterval ?? 1);
    const lessonCount = countLessonMajors(slots, previousQuizIndex + 1, targetIndex - 1, blocks);
    return lessonCount >= requiredInterval;
  }

  if (hasLabSlots && block.type === "lesson") {
    if (isLectureFriendly(targetSlot)) return true;
    for (let index = targetIndex + 1; index < sourceIndex; index += 1) {
      const candidate = slots[index]!;
      if (!candidate.locked && !slotHasMajorBlock(candidate) && isLectureFriendly(candidate)) {
        return false;
      }
    }
  }

  return true;
}

function compactTermSlotsLeft(termSlots: SessionSlot[], blocks: Block[], hasLabSlots: boolean) {
  for (let index = 0; index < termSlots.length; index += 1) {
    const targetSlot = termSlots[index]!;
    if (targetSlot.locked) continue;

    if (targetSlot.placements.length === 0) {
      for (let sourceIndex = index + 1; sourceIndex < termSlots.length; sourceIndex += 1) {
        const sourceSlot = termSlots[sourceIndex]!;
        if (sourceSlot.locked || sourceSlot.placements.length === 0) continue;

        const movableMinor = getMinorPlacements(sourceSlot).find((placement) => {
          const block = findBlockById(blocks, placement.blockId);
          return block?.type === "written_work" || block?.type === "performance_task";
        });

        if (movableMinor) {
          sourceSlot.placements = sourceSlot.placements.filter(
            (placement) => placement.blockId !== movableMinor.blockId
          );
          targetSlot.placements.push({
            ...movableMinor,
            id: placementId(movableMinor.blockId, targetSlot.id, targetSlot.placements.length + 1),
            slotId: targetSlot.id,
          });
          rebuildPlacementIds(sourceSlot);
          rebuildPlacementIds(targetSlot);
          break;
        }

        if (canMoveMajorLeft(termSlots, sourceIndex, index, blocks, hasLabSlots)) {
          moveMajorPlacement(termSlots, sourceIndex, index);
          break;
        }
      }
    } else if (!slotHasMajorBlock(targetSlot)) {
      for (let sourceIndex = index + 1; sourceIndex < termSlots.length; sourceIndex += 1) {
        const sourceSlot = termSlots[sourceIndex]!;
        if (sourceSlot.locked || !slotHasMajorBlock(sourceSlot)) continue;
        if (!canMoveMajorLeft(termSlots, sourceIndex, index, blocks, hasLabSlots)) continue;
        moveMajorPlacement(termSlots, sourceIndex, index);
        break;
      }
    }
  }
}

function ensureLastQuizAfterLessons(termSlots: SessionSlot[], blocks: Block[]) {
  let lastLessonIndex = getLastLessonIndex(termSlots, blocks);
  let quizIndexes = termSlots
    .map((slot, index) => {
      const block = getMajorBlockAt(termSlots, index, blocks);
      return block?.subcategory === "quiz" ? index : -1;
    })
    .filter((index) => index >= 0);

  let lastQuizIndex = quizIndexes.length > 0 ? quizIndexes[quizIndexes.length - 1]! : -1;

  while (lastQuizIndex >= 0 && lastLessonIndex > lastQuizIndex) {
    const candidates = candidateQuizSlots(termSlots, lastQuizIndex);
    const targetIndex = candidates[0] ?? -1;
    if (targetIndex === -1) break;
    if (!moveMajorPlacement(termSlots, lastQuizIndex, targetIndex)) break;
    lastLessonIndex = getLastLessonIndex(termSlots, blocks);
    quizIndexes = termSlots
      .map((slot, index) => {
        const block = getMajorBlockAt(termSlots, index, blocks);
        return block?.subcategory === "quiz" ? index : -1;
      })
      .filter((index) => index >= 0);
    lastQuizIndex = quizIndexes.length > 0 ? quizIndexes[quizIndexes.length - 1]! : -1;
  }
}

function ensureFinalQuizBeforeExamWindow(termSlots: SessionSlot[], blocks: Block[]) {
  const quizzes = blocks
    .filter((block) => block.subcategory === "quiz")
    .sort((a, b) => Number(a.metadata.quizOrder ?? 0) - Number(b.metadata.quizOrder ?? 0));
  const finalQuiz = quizzes[quizzes.length - 1] ?? null;
  if (!finalQuiz) return;

  const examIndex = termSlots.findIndex((_, index) => {
    const block = getMajorBlockAt(termSlots, index, blocks);
    return block?.type === "exam";
  });
  if (examIndex <= 0) return;

  const hasExamReview = blocks.some((block) => block.metadata.extraCandidateType === "review_before_exam");
  const targetIndex = Math.max(0, examIndex - (hasExamReview ? 2 : 1));
  const finalQuizIndex = findPlacementIndex(termSlots, finalQuiz.id);
  if (finalQuizIndex < 0 || finalQuizIndex === targetIndex) return;

  if (finalQuizIndex < targetIndex) {
    moveMajorPlacement(termSlots, finalQuizIndex, targetIndex);
  }
}

function findPlacementIndex(termSlots: SessionSlot[], blockId: string) {
  for (let index = 0; index < termSlots.length; index += 1) {
    if (termSlots[index]?.placements.some((placement) => placement.blockId === blockId)) {
      return index;
    }
  }
  return -1;
}

function movePlacementToSlot(
  sourceSlot: SessionSlot,
  targetSlot: SessionSlot,
  blockId: string,
  lane: Placement["lane"]
) {
  const moving = sourceSlot.placements.find((placement) => placement.blockId === blockId);
  if (!moving) return false;
  sourceSlot.placements = sourceSlot.placements.filter((placement) => placement.blockId !== blockId);
  targetSlot.placements.push({
    ...moving,
    id: placementId(blockId, targetSlot.id, targetSlot.placements.length + 1),
    slotId: targetSlot.id,
    lane,
  });
  rebuildPlacementIds(sourceSlot);
  rebuildPlacementIds(targetSlot);
  return true;
}

function insertMajorAt(slots: SessionSlot[], targetIndex: number, block: Block) {
  let emptyIndex = -1;
  for (let index = slots.length - 1; index >= targetIndex; index -= 1) {
    const slot = slots[index]!;
    if (!slot.locked && !slotHasMajorBlock(slot)) {
      emptyIndex = index;
      break;
    }
  }
  if (emptyIndex === -1) return false;

  for (let index = emptyIndex; index > targetIndex; index -= 1) {
    const source = slots[index - 1]!;
    const destination = slots[index]!;
    const major = getMajorPlacement(source);
    if (!major) continue;
    source.placements = source.placements.filter((placement) => placement.blockId !== major.blockId);
    destination.placements.push({
      ...major,
      id: placementId(major.blockId, destination.id, destination.placements.length + 1),
      slotId: destination.id,
    });
    rebuildPlacementIds(source);
    rebuildPlacementIds(destination);
  }

  const target = slots[targetIndex];
  if (!target || target.locked || slotHasMajorBlock(target)) return false;
  addPlacement(target, block, "major");
  return true;
}

function finalizeSlots(slots: SessionSlot[], blocks: Block[], hasLabSlots: boolean) {
  const next = cloneSlots(slots);
  ensureLastQuizAfterLessons(next, blocks);
  compactTermSlotsLeft(next, blocks, hasLabSlots);
  ensureFinalQuizBeforeExamWindow(next, blocks);
  next.forEach((slot) => normalizePlacementOrder(slot, blocks));
  return next;
}

function buildExpansionCandidates(blocks: Block[]) {
  const lessonExtensions = blocks
    .filter((block) => block.metadata.extraCandidateType === "lesson_extension")
    .sort(
      (a, b) =>
        Number(Boolean(b.metadata.highComplexity)) - Number(Boolean(a.metadata.highComplexity)) ||
        Number(a.metadata.lessonOrder ?? 0) - Number(b.metadata.lessonOrder ?? 0)
    );
  const ptExtensions = blocks
    .filter((block) => block.metadata.extraCandidateType === "pt_extension")
    .sort(
      (a, b) =>
        Number(Boolean(b.metadata.prioritizeReporting)) -
          Number(Boolean(a.metadata.prioritizeReporting)) ||
        Number(a.metadata.ptOrder ?? 0) - Number(b.metadata.ptOrder ?? 0)
    );
  const quizReviews = blocks
    .filter((block) => block.metadata.extraCandidateType === "review_before_quiz")
    .sort(
      (a, b) =>
        Number(b.metadata.unresolvedHardRegionCount ?? 0) -
          Number(a.metadata.unresolvedHardRegionCount ?? 0) ||
        Number(b.metadata.quizMaxDifficulty ?? 1) - Number(a.metadata.quizMaxDifficulty ?? 1) ||
        Number(b.metadata.quizAverageDifficulty ?? 1) -
          Number(a.metadata.quizAverageDifficulty ?? 1) ||
        Number(b.metadata.chapterBoundaryWeight ?? 0) -
          Number(a.metadata.chapterBoundaryWeight ?? 0) ||
        Number(b.metadata.targetQuizOrder ?? 0) - Number(a.metadata.targetQuizOrder ?? 0)
    );
  const examReview = blocks.find((block) => block.metadata.extraCandidateType === "review_before_exam");
  const extraWW = blocks.find((block) => block.metadata.extraCandidateType === "extra_written_work");
  const extraPT = blocks.find((block) => block.metadata.extraCandidateType === "extra_performance_task");

  return [
    ...(examReview ? [examReview] : []),
    ...quizReviews,
    ...ptExtensions,
    ...lessonExtensions,
    ...(extraWW ? [extraWW] : []),
    ...(extraPT ? [extraPT] : []),
  ];
}

function buildExpansionStates(
  state: SearchState,
  candidate: Block,
  termBlocks: Block[],
  coreSlots: SessionSlot[]
) {
  const nextStates: SearchState[] = [];

  if (candidate.metadata.extraCandidateType === "review_before_exam") {
    const next = cloneState(state);
    if (insertMajorAt(next.slots, Math.max(0, next.slots.length - 1), candidate)) {
      next.balanceRemaining -= 1;
      next.extraIndex += 1;
      nextStates.push(next);
    }
    return nextStates;
  }

  if (candidate.metadata.extraCandidateType === "review_before_quiz") {
    const quizOrder = Number(candidate.metadata.targetQuizOrder ?? 0);
    const quiz = termBlocks.find(
      (block) => block.subcategory === "quiz" && Number(block.metadata.quizOrder ?? 0) === quizOrder
    );
    if (!quiz) return nextStates;
    const quizIndex = findPlacementIndex(state.slots, quiz.id);
    if (quizIndex <= 0) return nextStates;
    const next = cloneState(state);
    if (insertMajorAt(next.slots, Math.max(0, quizIndex - 1), candidate)) {
      next.balanceRemaining -= 1;
      next.extraIndex += 1;
      nextStates.push(next);
    }
    return nextStates;
  }

  if (candidate.metadata.extraCandidateType === "pt_extension") {
    const ptOrder = Number(candidate.metadata.ptOrder ?? 0);
    const base = termBlocks.find(
      (block) =>
        block.type === "performance_task" &&
        !block.metadata.extraCandidateType &&
        Number(block.metadata.ptOrder ?? 0) === ptOrder
    );
    if (!base) return nextStates;
    const baseIndex = findPlacementIndex(state.slots, base.id);
    if (baseIndex < 0) return nextStates;
    const next = cloneState(state);
    if (insertMajorAt(next.slots, baseIndex + 1, candidate)) {
      next.balanceRemaining -= 1;
      next.extraIndex += 1;
      nextStates.push(next);
    }
    return nextStates;
  }

  if (candidate.metadata.extraCandidateType === "lesson_extension") {
    const lessonOrder = Number(candidate.metadata.lessonOrder ?? 0);
    const base = termBlocks.find(
      (block) =>
        block.type === "lesson" &&
        !block.metadata.extraCandidateType &&
        Number(block.metadata.lessonOrder ?? 0) === lessonOrder
    );
    if (!base) return nextStates;
    const baseIndex = findPlacementIndex(state.slots, base.id);
    if (baseIndex < 0) return nextStates;
    const next = cloneState(state);
    if (insertMajorAt(next.slots, baseIndex + 1, candidate)) {
      next.balanceRemaining -= 1;
      next.extraIndex += 1;
      nextStates.push(next);
    }
    return nextStates;
  }

  if (candidate.metadata.extraCandidateType === "extra_written_work") {
    for (let index = 0; index < coreSlots.length; index += 1) {
      const baseSlot = state.slots[index]!;
      if (baseSlot.locked) continue;
      const next = cloneState(state);
      addPlacement(next.slots[index]!, candidate, "minor");
      next.balanceRemaining -= 1;
      next.extraIndex += 1;
      nextStates.push(next);
    }
    return nextStates;
  }

  if (candidate.metadata.extraCandidateType === "extra_performance_task") {
    for (let index = 0; index < coreSlots.length; index += 1) {
      const slot = state.slots[index]!;
      if (slot.locked || slotHasMajorBlock(slot)) continue;
      const lessonsBefore = countLessonMajors(state.slots, 0, index - 1, termBlocks);
      if (lessonsBefore < 1) continue;
      const next = cloneState(state);
      addPlacement(next.slots[index]!, candidate, "major");
      next.balanceRemaining -= 1;
      next.extraIndex += 1;
      nextStates.push(next);
    }
  }

  return nextStates;
}

function buildCompressionStates(state: SearchState, termBlocks: Block[]) {
  const nextStates: SearchState[] = [];
  const lessons = termBlocks
    .filter((block) => block.type === "lesson" && !block.metadata.extraCandidateType)
    .sort((a, b) => Number(a.metadata.lessonOrder ?? 0) - Number(b.metadata.lessonOrder ?? 0));
  const writtenWorks = termBlocks
    .filter(
      (block) =>
        block.type === "written_work" &&
        block.subcategory !== "quiz" &&
        !block.metadata.extraCandidateType
    )
    .sort((a, b) => Number(a.metadata.wwOrder ?? 0) - Number(b.metadata.wwOrder ?? 0));
  const performanceTasks = termBlocks
    .filter((block) => block.type === "performance_task" && !block.metadata.extraCandidateType)
    .sort((a, b) => Number(a.metadata.ptOrder ?? 0) - Number(b.metadata.ptOrder ?? 0));

  for (const ww of writtenWorks) {
    const wwSlotIndex = findPlacementIndex(state.slots, ww.id);
    if (wwSlotIndex < 0) continue;
    for (const lesson of lessons) {
      if (Number(lesson.metadata.lessonOrder ?? 0) <= 1) continue;
      const lessonSlotIndex = findPlacementIndex(state.slots, lesson.id);
      if (lessonSlotIndex < 0 || lessonSlotIndex === wwSlotIndex) continue;
      const next = cloneState(state);
      if (
        movePlacementToSlot(
          next.slots[wwSlotIndex]!,
          next.slots[lessonSlotIndex]!,
          ww.id,
          "minor"
        )
      ) {
        next.balanceRemaining += 1;
        nextStates.push(next);
      }
    }
  }

  if (performanceTasks.length > 2) {
    for (const pt of performanceTasks) {
      const ptSlotIndex = findPlacementIndex(state.slots, pt.id);
      if (ptSlotIndex <= 0) continue;
      const next = cloneState(state);
      if (
        movePlacementToSlot(
          next.slots[ptSlotIndex]!,
          next.slots[ptSlotIndex - 1]!,
          pt.id,
          "minor"
        )
      ) {
        next.balanceRemaining += 1;
        nextStates.push(next);
      }
    }
  }

  return nextStates;
}

function evaluateOutcome(
  state: SearchState,
  lessons: Block[],
  performanceTasks: Block[],
  writtenWorks: Block[],
  quizzes: Block[],
  termBlocks: Block[],
  hasLabSlots: boolean
): SearchOutcome {
  const finalized = finalizeSlots(state.slots, termBlocks, hasLabSlots);
  const placedMajor = countPlacedMajorSlots(finalized);
  const placedMinor = countPlacedMinorBlocks(finalized);
  const complete =
    state.lessonOffset >= lessons.length &&
    state.ptOffset >= performanceTasks.length &&
    state.wwOffset >= writtenWorks.length &&
    state.quizOffset >= quizzes.length &&
    state.balanceRemaining === 0;
  const score =
    (complete ? 1_000_000 : 0) +
    state.lessonOffset * 10_000 +
    state.quizOffset * 3_000 +
    state.ptOffset * 2_000 +
    state.wwOffset * 1_000 +
    Math.max(0, 500 - Math.abs(state.balanceRemaining) * 200) +
    placedMajor * 10 +
    placedMinor;

  return {
    slots: finalized,
    lessonOffset: state.lessonOffset,
    ptOffset: state.ptOffset,
    wwOffset: state.wwOffset,
    quizOffset: state.quizOffset,
    balanceRemaining: state.balanceRemaining,
    score,
    complete,
  };
}

function pickBetterOutcome(current: SearchOutcome | null, next: SearchOutcome) {
  if (!current) return next;
  if (next.score !== current.score) return next.score > current.score ? next : current;
  const nextUsage = countPlacedMajorSlots(next.slots) + countPlacedMinorBlocks(next.slots);
  const currentUsage = countPlacedMajorSlots(current.slots) + countPlacedMinorBlocks(current.slots);
  return nextUsage > currentUsage ? next : current;
}

function searchTermPlacements(input: {
  initialState: SearchState;
  lessons: Block[];
  performanceTasks: Block[];
  writtenWorks: Block[];
  quizzes: Block[];
  termBlocks: Block[];
  hasLabSlots: boolean;
  lessonInterval: number;
  expansionCandidates: Block[];
}): SearchOutcome {
  const {
    lessons,
    performanceTasks,
    writtenWorks,
    quizzes,
    termBlocks,
    hasLabSlots,
    lessonInterval,
    expansionCandidates,
  } = input;
  const visited = new Map<string, number>();

  function recurse(state: SearchState): SearchOutcome {
    const signature = buildStateSignature(state);
    const progressScore = stateProgressScore(state);
    const bestSeenScore = visited.get(signature);
    if (bestSeenScore !== undefined && bestSeenScore >= progressScore) {
      return evaluateOutcome(
        state,
        lessons,
        performanceTasks,
        writtenWorks,
        quizzes,
        termBlocks,
        hasLabSlots
      );
    }
    visited.set(signature, progressScore);

    if (
      state.lessonOffset >= lessons.length &&
      state.ptOffset >= performanceTasks.length &&
      state.wwOffset >= writtenWorks.length &&
      state.quizOffset >= quizzes.length
    ) {
      if (state.balanceRemaining > 0) {
        return recurse({ ...state, phase: "expand" });
      }
      if (state.balanceRemaining < 0) {
        return recurse({ ...state, phase: "compress" });
      }
      return evaluateOutcome(
        state,
        lessons,
        performanceTasks,
        writtenWorks,
        quizzes,
        termBlocks,
        hasLabSlots
      );
    }

    if (countFreeMajorSlots(state.slots) === 0 && state.lessonOffset < lessons.length) {
      return evaluateOutcome(
        state,
        lessons,
        performanceTasks,
        writtenWorks,
        quizzes,
        termBlocks,
        hasLabSlots
      );
    }

    let best: SearchOutcome | null = null;

    if (state.phase === "lesson") {
      const remainingLessons = lessons.length - state.lessonOffset;
      if (remainingLessons <= 0) {
        return recurse({ ...state, phase: "pt" });
      }

      const take = Math.min(lessonInterval, remainingLessons);
      const lessonCandidates = candidateLessonSlots(state.slots, state.cursor, take, hasLabSlots);
      const lessonCombos = chooseCombinations(lessonCandidates, take);
      const seenChildStates = new Set<string>();

      for (const combo of lessonCombos) {
        const nextState = cloneState(state);
        combo.forEach((slotIndex, comboIndex) => {
          addPlacement(nextState.slots[slotIndex]!, lessons[nextState.lessonOffset + comboIndex]!, "major");
        });
        nextState.lessonOffset += take;
        nextState.cycleLessonIndexes = combo;
        nextState.cursor = (combo[combo.length - 1] ?? state.cursor) + 1;
        nextState.phase = "pt";
        const childSignature = buildStateSignature(nextState);
        if (seenChildStates.has(childSignature)) continue;
        seenChildStates.add(childSignature);
        best = pickBetterOutcome(best, recurse(nextState));
      }

      return (
        best ??
        evaluateOutcome(state, lessons, performanceTasks, writtenWorks, quizzes, termBlocks, hasLabSlots)
      );
    }

    if (state.phase === "pt") {
      if (state.ptOffset >= performanceTasks.length || state.cycleLessonIndexes.length === 0) {
        return recurse({ ...state, phase: "ww" });
      }

      const ptCandidates = candidatePerformanceTaskSlots(
        state.slots,
        state.cycleLessonIndexes,
        hasLabSlots
      );
      const seenChildStates = new Set<string>();

      best = pickBetterOutcome(best, recurse({ ...state, phase: "ww" }));
      for (const slotIndex of ptCandidates) {
        const nextState = cloneState(state);
        addPlacement(nextState.slots[slotIndex]!, performanceTasks[nextState.ptOffset]!, "major");
        nextState.ptOffset += 1;
        nextState.phase = "ww";
        const childSignature = buildStateSignature(nextState);
        if (seenChildStates.has(childSignature)) continue;
        seenChildStates.add(childSignature);
        best = pickBetterOutcome(best, recurse(nextState));
      }

      return (
        best ??
        evaluateOutcome(state, lessons, performanceTasks, writtenWorks, quizzes, termBlocks, hasLabSlots)
      );
    }

    if (state.phase === "ww") {
      if (state.wwOffset >= writtenWorks.length || state.cycleLessonIndexes.length === 0) {
        return recurse({ ...state, phase: "quiz" });
      }

      const wwCandidates = candidateWrittenWorkSlots(state.slots, state.cycleLessonIndexes, termBlocks);
      const seenChildStates = new Set<string>();

      best = pickBetterOutcome(best, recurse({ ...state, phase: "quiz" }));
      for (const slotIndex of wwCandidates) {
        const nextState = cloneState(state);
        addPlacement(nextState.slots[slotIndex]!, writtenWorks[nextState.wwOffset]!, "minor");
        nextState.wwOffset += 1;
        nextState.phase = "quiz";
        const childSignature = buildStateSignature(nextState);
        if (seenChildStates.has(childSignature)) continue;
        seenChildStates.add(childSignature);
        best = pickBetterOutcome(best, recurse(nextState));
      }

      return (
        best ??
        evaluateOutcome(state, lessons, performanceTasks, writtenWorks, quizzes, termBlocks, hasLabSlots)
      );
    }

    if (state.phase === "quiz") {
      if (state.quizOffset >= quizzes.length) {
        return recurse({
          ...state,
          phase: "lesson",
          cycleLessonIndexes: [],
        });
      }

      const isFinalQuiz = state.quizOffset === quizzes.length - 1;
      if (isFinalQuiz && state.lessonOffset < lessons.length) {
        return recurse({
          ...state,
          phase: "lesson",
          cycleLessonIndexes: [],
        });
      }

      const afterIndex =
        state.cycleLessonIndexes.length > 0
          ? state.cycleLessonIndexes[state.cycleLessonIndexes.length - 1]!
          : getLastLessonIndex(state.slots, termBlocks);
      const reserveReviewSlot =
        isFinalQuiz &&
        state.balanceRemaining > 0 &&
        termBlocks.some((block) => block.metadata.extraCandidateType === "review_before_exam");
      const quizCandidates = isFinalQuiz
        ? candidateFinalQuizSlots(state.slots, afterIndex, reserveReviewSlot)
        : candidateQuizSlots(state.slots, afterIndex);
      const seenChildStates = new Set<string>();

      for (const slotIndex of quizCandidates) {
        const nextState = cloneState(state);
        addPlacement(nextState.slots[slotIndex]!, quizzes[nextState.quizOffset]!, "major");
        nextState.quizOffset += 1;
        nextState.cursor = slotIndex + 1;
        nextState.cycleLessonIndexes = [];
        nextState.phase = "lesson";
        const childSignature = buildStateSignature(nextState);
        if (seenChildStates.has(childSignature)) continue;
        seenChildStates.add(childSignature);
        best = pickBetterOutcome(best, recurse(nextState));
      }

      return (
        best ??
        evaluateOutcome(state, lessons, performanceTasks, writtenWorks, quizzes, termBlocks, hasLabSlots)
      );
    }

    if (state.phase === "expand") {
      if (state.balanceRemaining <= 0 || state.extraIndex >= expansionCandidates.length) {
        return evaluateOutcome(
          state,
          lessons,
          performanceTasks,
          writtenWorks,
          quizzes,
          termBlocks,
          hasLabSlots
        );
      }

      best = pickBetterOutcome(
        best,
        recurse({ ...state, extraIndex: state.extraIndex + 1 })
      );

      const candidate = expansionCandidates[state.extraIndex]!;
      const states = buildExpansionStates(state, candidate, termBlocks, state.slots);
      const seenChildStates = new Set<string>();
      for (const nextState of states) {
        const childSignature = buildStateSignature(nextState);
        if (seenChildStates.has(childSignature)) continue;
        seenChildStates.add(childSignature);
        best = pickBetterOutcome(best, recurse(nextState));
      }

      return (
        best ??
        evaluateOutcome(state, lessons, performanceTasks, writtenWorks, quizzes, termBlocks, hasLabSlots)
      );
    }

    if (state.phase === "compress") {
      if (state.balanceRemaining >= 0) {
        return evaluateOutcome(
          state,
          lessons,
          performanceTasks,
          writtenWorks,
          quizzes,
          termBlocks,
          hasLabSlots
        );
      }

      const states = buildCompressionStates(state, termBlocks);
      if (states.length === 0) {
        return evaluateOutcome(
          state,
          lessons,
          performanceTasks,
          writtenWorks,
          quizzes,
          termBlocks,
          hasLabSlots
        );
      }

      const seenChildStates = new Set<string>();
      for (const nextState of states) {
        const childSignature = buildStateSignature(nextState);
        if (seenChildStates.has(childSignature)) continue;
        seenChildStates.add(childSignature);
        best = pickBetterOutcome(best, recurse(nextState));
      }

      return (
        best ??
        evaluateOutcome(state, lessons, performanceTasks, writtenWorks, quizzes, termBlocks, hasLabSlots)
      );
    }

    return evaluateOutcome(state, lessons, performanceTasks, writtenWorks, quizzes, termBlocks, hasLabSlots);
  }

  return recurse(input.initialState);
}

export function placeBlocks(input: PlaceBlocksInput): PlacementResult {
  const slots = cloneSlots(input.slots);

  for (const [, termSlotsRaw] of getTermSlots(slots)) {
    const termSlots = [...termSlotsRaw].sort(compareSlots);
    const termIndex = termSlots[0]?.termIndex ?? 0;
    if (termSlots.length === 0) continue;
    const firstSlot = termSlots[0]!;
    const secondSlot = termSlots[1] ?? null;
    const hasLabSlots = termSlots.some((slot) => isLabFriendly(slot));

    const buffers = findBlock(input.blocks, "buffer", termIndex);
    const lessons = sortByMetadataOrder(findBlock(input.blocks, "lesson", termIndex), "lessonOrder");
    const writtenWorks = sortByMetadataOrder(
      findBlock(input.blocks, "written_work", termIndex, (block) => block.subcategory !== "quiz"),
      "wwOrder"
    );
    const quizzes = sortByMetadataOrder(
      findBlock(input.blocks, "written_work", termIndex, (block) => block.subcategory === "quiz"),
      "quizOrder"
    );
    const performanceTasks = sortByMetadataOrder(
      findBlock(input.blocks, "performance_task", termIndex),
      "ptOrder"
    );
    const exams = findBlock(input.blocks, "exam", termIndex);
    const exam = exams[0] ?? null;

    const baseBuffers = buffers.filter((block) => !block.metadata.extraCandidateType);
    const baseLessons = lessons.filter((block) => !block.metadata.extraCandidateType);
    const baseWrittenWorks = writtenWorks.filter((block) => !block.metadata.extraCandidateType);
    const basePerformanceTasks = performanceTasks.filter((block) => !block.metadata.extraCandidateType);
    const orientation = baseBuffers.find((block) => block.subcategory === "orientation") ?? null;
    const firstLesson = baseLessons[0] ?? null;
    const lessonInterval = Math.max(
      1,
      Number(exam?.metadata.lessonInterval ?? quizzes[0]?.metadata.lessonInterval ?? 1)
    );
    const examSlot =
      exam && exam.subcategory === "final" && typeof exam.metadata.preferredDate === "string"
        ? termSlots.find((slot) => slot.date === exam.metadata.preferredDate) ??
          termSlots[termSlots.length - 1]!
        : termSlots[termSlots.length - 1]!;
    const coreWindow = cloneSlots(termSlots.filter((slot) => slot.id !== examSlot.id));

    if (orientation && termIndex === 0) {
      addPlacement(firstSlot, orientation, "major");
    }
    if (exam) {
      addPlacement(examSlot, exam, "major");
    }

    const workingCore = cloneSlots(coreWindow);
    let initialLessonOffset = 0;
    let cursor = 0;

    if (firstLesson) {
      if (termIndex === 0) {
        const anchorSlot = secondSlot ? workingCore.find((slot) => slot.id === secondSlot.id) ?? null : null;
        if (anchorSlot) {
          addPlacement(anchorSlot, firstLesson, "major");
          cursor = Math.max(cursor, workingCore.findIndex((slot) => slot.id === anchorSlot.id) + 1);
          initialLessonOffset = 1;
        }
      } else {
        const anchorSlot = workingCore.find((slot) => slot.id === firstSlot.id) ?? workingCore[0] ?? null;
        if (anchorSlot) {
          addPlacement(anchorSlot, firstLesson, "major");
          cursor = Math.max(cursor, workingCore.findIndex((slot) => slot.id === anchorSlot.id) + 1);
          initialLessonOffset = 1;
        }
      }
    }

    const extraTermSlots = Number(exam?.metadata.extraTermSlots ?? 0);
    const futureDelayCount = Number(exam?.metadata.futureDelayCount ?? 0);
    const balanceRemaining = extraTermSlots - futureDelayCount;
    const termBlocks = [...buffers, ...lessons, ...writtenWorks, ...quizzes, ...performanceTasks, ...exams];
    const expansionCandidates = buildExpansionCandidates(termBlocks);

    const outcome = searchTermPlacements({
      initialState: {
        slots: workingCore,
        lessonOffset: initialLessonOffset,
        ptOffset: 0,
        wwOffset: 0,
        quizOffset: 0,
        cycleLessonIndexes: [],
        cursor,
        phase: "lesson",
        balanceRemaining,
        extraIndex: 0,
      },
      lessons: baseLessons,
      performanceTasks: basePerformanceTasks,
      writtenWorks: baseWrittenWorks,
      quizzes,
      termBlocks,
      hasLabSlots,
      lessonInterval,
      expansionCandidates,
    });

    const placementsBySlotId = new Map(outcome.slots.map((slot) => [slot.id, [...slot.placements]]));
    for (const slot of termSlots) {
      if (slot.id === examSlot.id) continue;
      slot.placements = placementsBySlotId.get(slot.id) ?? [];
    }
    termSlots.forEach((slot) => normalizePlacementOrder(slot, input.blocks));
  }

  const placedBlockIds = new Set(slots.flatMap((slot) => slot.placements.map((placement) => placement.blockId)));
  const unscheduledBlockIds = input.blocks
    .filter((block) => !placedBlockIds.has(block.id))
    .map((block) => block.id);

  return {
    slots,
    unscheduledBlockIds,
  };
}
