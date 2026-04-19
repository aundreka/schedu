import { Block, Placement, SessionSlot, TeacherRules, ValidationIssue } from "./types";
import { PacingPlan } from "./buildPacingPlan";

export type PlaceBlocksInput = {
  slots: SessionSlot[];
  blocks: Block[];
  pacingPlan: PacingPlan;
  teacherRules?: Pick<
    TeacherRules,
    "allowLessonWrittenWorkOverlay" | "preferLessonWrittenWorkOverlay"
  >;
};

export type PlaceBlocksResult = {
  slots: SessionSlot[];
  unscheduledBlocks: Block[];
  validationIssues: ValidationIssue[];
};

function cloneSlots(slots: SessionSlot[]): SessionSlot[] {
  return slots.map((slot) => ({
    ...slot,
    placements: slot.placements.map((placement) => ({ ...placement })),
  }));
}

function sortSlots(slots: SessionSlot[]): SessionSlot[] {
  return [...slots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;

    const startCompare = (a.startTime ?? "").localeCompare(b.startTime ?? "");
    if (startCompare !== 0) return startCompare;

    return a.id.localeCompare(b.id);
  });
}

function blockMapFrom(blocks: Block[]): Map<string, Block> {
  return new Map(blocks.map((block) => [block.id, block]));
}

function getUsedMinutes(slot: SessionSlot): number {
  return slot.placements.reduce((sum, placement) => sum + placement.minutesUsed, 0);
}

function getRemainingMinutes(slot: SessionSlot): number {
  return Math.max(0, slot.minutes - getUsedMinutes(slot));
}

function slotSupportsBlockType(slot: SessionSlot, block: Block): boolean {
  if (block.preferredSessionType === "any") return true;
  if (slot.sessionType === null) return true;
  if (slot.sessionType === "mixed") return true;
  return slot.sessionType === block.preferredSessionType;
}

function getPlacementLane(block: Block): Placement["lane"] {
  return block.overlayMode === "minor" ? "minor" : "major";
}

function getMinimumSegmentMinutes(block: Block): number {
  if (!block.splittable) {
    return block.estimatedMinutes;
  }

  return Math.max(15, Math.min(30, Math.floor(block.estimatedMinutes / 2)));
}

function getPlacementMinutesForSlot(
  slot: SessionSlot,
  block: Block,
  remainingMinutes: number,
  reservedMinutes: number = 0
): number {
  const remainingCapacity = Math.max(0, getRemainingMinutes(slot) - reservedMinutes);
  if (remainingCapacity <= 0) return 0;

  if (!block.splittable) {
    return remainingCapacity >= remainingMinutes ? remainingMinutes : 0;
  }

  if (remainingCapacity >= remainingMinutes) {
    return remainingMinutes;
  }

  const minimumSegmentMinutes = getMinimumSegmentMinutes(block);
  if (remainingCapacity < minimumSegmentMinutes) {
    return 0;
  }

  const remainder = remainingMinutes - remainingCapacity;
  if (remainder > 0 && remainder < minimumSegmentMinutes) {
    return 0;
  }

  return remainingCapacity;
}

function canPlaceBlockInSlot(
  slot: SessionSlot,
  block: Block,
  remainingMinutes: number = block.estimatedMinutes,
  reservedMinutes: number = 0
): boolean {
  if (slot.locked) return false;
  if (!slotSupportsBlockType(slot, block)) return false;

  if (block.overlayMode === "exclusive") {
    return slot.placements.length === 0;
  }

  return getPlacementMinutesForSlot(slot, block, remainingMinutes, reservedMinutes) > 0;
}

function createPlacement(block: Block, slot: SessionSlot, minutesUsed: number): Placement {
  return {
    id: `placement__${block.id}__${slot.id}__${slot.placements.length + 1}`,
    blockId: block.id,
    slotId: slot.id,
    lane: getPlacementLane(block),
    minutesUsed,
    chainId: block.id,
    startTime: null,
    endTime: null,
  };
}

function finalizePlacementChain(placements: Placement[]): void {
  placements.forEach((placement, index) => {
    placement.segmentIndex = index + 1;
    placement.segmentCount = placements.length;
    placement.continuesFromPrevious = index > 0;
    placement.continuesToNext = index < placements.length - 1;
  });
}

function placeBlockSegment(
  slot: SessionSlot,
  block: Block,
  remainingMinutes: number,
  reservedMinutes: number = 0
): Placement | null {
  if (!canPlaceBlockInSlot(slot, block, remainingMinutes, reservedMinutes)) return null;

  const minutesUsed = getPlacementMinutesForSlot(slot, block, remainingMinutes, reservedMinutes);
  if (minutesUsed <= 0) return null;

  const placement = createPlacement(block, slot, minutesUsed);
  slot.placements.push(placement);
  return placement;
}

function attemptPlaceBlock(
  slots: SessionSlot[],
  block: Block,
  startIndex: number,
  reservedMinutesBySlotId: Map<string, number> = new Map()
): Placement[] | null {
  if (startIndex < 0 || startIndex >= slots.length) {
    return null;
  }

  const placements: Placement[] = [];
  let remainingMinutes = block.estimatedMinutes;

  for (let i = startIndex; i < slots.length && remainingMinutes > 0; i += 1) {
    const placement = placeBlockSegment(
      slots[i],
      block,
      remainingMinutes,
      reservedMinutesBySlotId.get(slots[i].id) ?? 0
    );
    if (!placement) {
      if (!block.splittable && placements.length === 0) {
        return null;
      }
      continue;
    }

    placements.push(placement);
    remainingMinutes -= placement.minutesUsed;

    if (!block.splittable) {
      break;
    }
  }

  if (remainingMinutes > 0) {
    for (const placement of placements) {
      const slot = slots.find((candidate) => candidate.id === placement.slotId);
      if (!slot) continue;
      slot.placements = slot.placements.filter((candidate) => candidate.id !== placement.id);
    }
    return null;
  }

  finalizePlacementChain(placements);
  return placements;
}

function dependenciesMet(block: Block, placedBlockIds: Set<string>): boolean {
  return block.dependencies.every((dependencyId) => placedBlockIds.has(dependencyId));
}

function isMajorBlock(block: Block): boolean {
  return block.overlayMode === "major" || block.overlayMode === "exclusive";
}

function getAnchorSlotIdMap(pacingPlan: PacingPlan): Map<string, string> {
  return new Map(pacingPlan.anchors.map((anchor) => [anchor.blockId, anchor.preferredSlotId]));
}

function findEarliestOpenSlot(
  slots: SessionSlot[],
  block: Block,
  startIndex: number = 0,
  remainingMinutes: number = block.estimatedMinutes
): SessionSlot | null {
  for (let i = Math.max(0, startIndex); i < slots.length; i += 1) {
    if (canPlaceBlockInSlot(slots[i], block, remainingMinutes)) {
      return slots[i];
    }
  }

  return null;
}

function getSlotIndexMap(slots: SessionSlot[]): Map<string, number> {
  return new Map(slots.map((slot, index) => [slot.id, index]));
}

function sortPlacementsBySlotOrder(
  placements: Placement[],
  slotIndexMap: Map<string, number>
): Placement[] {
  return [...placements].sort(
    (a, b) => (slotIndexMap.get(a.slotId) ?? Number.MAX_SAFE_INTEGER) - (slotIndexMap.get(b.slotId) ?? Number.MAX_SAFE_INTEGER)
  );
}

function findBestMinorSlot(
  slots: SessionSlot[],
  block: Block,
  placementsByBlockId: Map<string, Placement[]>,
  slotIndexMap: Map<string, number>,
  teacherRules: Pick<
    TeacherRules,
    "allowLessonWrittenWorkOverlay" | "preferLessonWrittenWorkOverlay"
  >
): SessionSlot | null {
  const dependencyPlacements = block.dependencies
    .flatMap((dependencyId) => placementsByBlockId.get(dependencyId) ?? []);

  const dependencySlotIndices = dependencyPlacements
    .map((placement) => slotIndexMap.get(placement.slotId))
    .filter((index): index is number => index !== undefined);

  const preferredStartIndex =
    dependencySlotIndices.length > 0 ? Math.max(...dependencySlotIndices) : 0;

  const linkedLessonBlockId = block.metadata?.linkedLessonBlockId;
  const isWrittenWork = block.type === "written_work";

  if (typeof linkedLessonBlockId === "string") {
    const linkedPlacements = placementsByBlockId.get(linkedLessonBlockId) ?? [];
    const linkedPlacement = isWrittenWork
      ? linkedPlacements[linkedPlacements.length - 1]
      : linkedPlacements[0];
    if (linkedPlacement) {
      const linkedSlotIndex = slotIndexMap.get(linkedPlacement.slotId);
      if (linkedSlotIndex !== undefined) {
        const sameSlot = slots[linkedSlotIndex];
        const nextSlot = slots[linkedSlotIndex + 1];

        if (isWrittenWork && teacherRules.allowLessonWrittenWorkOverlay) {
          if (teacherRules.preferLessonWrittenWorkOverlay && canPlaceBlockInSlot(sameSlot, block)) {
            return sameSlot;
          }

          if (nextSlot && canPlaceBlockInSlot(nextSlot, block)) {
            return nextSlot;
          }

          if (!teacherRules.preferLessonWrittenWorkOverlay && canPlaceBlockInSlot(sameSlot, block)) {
            return sameSlot;
          }
        } else if (canPlaceBlockInSlot(sameSlot, block)) {
          return sameSlot;
        } else if (nextSlot && canPlaceBlockInSlot(nextSlot, block)) {
          return nextSlot;
        }
      }
    }
  }

  return findEarliestOpenSlot(slots, block, preferredStartIndex);
}

function buildDependentReservationMap(
  block: Block,
  startIndex: number,
  slots: SessionSlot[],
  blocks: Block[],
  placementsByBlockId: Map<string, Placement[]>,
  anchorSlotIdByBlockId: Map<string, string>,
  slotIndexMap: Map<string, number>
): Map<string, number> {
  const reservations = new Map<string, number>();
  const unresolvedDependents = blocks.filter(
    (candidate) =>
      candidate.dependencies.includes(block.id) &&
      !placementsByBlockId.has(candidate.id)
  );

  for (const dependent of unresolvedDependents) {
    if (dependent.overlayMode === "minor" && dependent.subcategory === "preparation") {
      const startSlot = slots[startIndex];
      if (startSlot) {
        reservations.set(
          startSlot.id,
          (reservations.get(startSlot.id) ?? 0) + dependent.estimatedMinutes
        );
      }
      continue;
    }

    if (!isMajorBlock(dependent)) {
      continue;
    }

    const anchorSlotId = anchorSlotIdByBlockId.get(dependent.id);
    const anchorSlotIndex = anchorSlotId ? slotIndexMap.get(anchorSlotId) : undefined;
    if (anchorSlotIndex === undefined || anchorSlotIndex < startIndex) {
      continue;
    }

    const compatibleSlotIndices: number[] = [];
    let cumulativeCapacity = 0;

    for (let i = anchorSlotIndex; i < slots.length && cumulativeCapacity < dependent.estimatedMinutes; i += 1) {
      if (!slotSupportsBlockType(slots[i], dependent) || slots[i].locked) {
        continue;
      }

      compatibleSlotIndices.push(i);
      cumulativeCapacity += slots[i].minutes;
    }

    if (compatibleSlotIndices.length === 0) {
      continue;
    }

    let remainingReservation = dependent.estimatedMinutes;
    for (let i = 0; i < compatibleSlotIndices.length; i += 1) {
      const slot = slots[compatibleSlotIndices[i]];
      const slotsLeft = compatibleSlotIndices.length - i;
      const reserved = Math.min(slot.minutes, Math.ceil(remainingReservation / slotsLeft));
      reservations.set(slot.id, (reservations.get(slot.id) ?? 0) + reserved);
      remainingReservation -= reserved;
    }
  }

  return reservations;
}

function buildBufferBlock(courseId: string, index: number, minutes: number): Block {
  return {
    id: `block__buffer__${index}`,
    courseId,
    type: "buffer",
    subcategory: "other",
    title: `Buffer / Catch-up ${index}`,
    estimatedMinutes: Math.max(30, Math.min(90, minutes)),
    minMinutes: 30,
    maxMinutes: Math.max(30, minutes),
    required: false,
    splittable: false,
    overlayMode: "major",
    preferredSessionType: "any",
    dependencies: [],
    metadata: {
      generatedBy: "placeBlocks",
      bufferNumber: index,
    },
  };
}

function compactStandaloneMinorPlacements(
  slots: SessionSlot[],
  blockMap: Map<string, Block>
): void {
  for (let i = 1; i < slots.length; i += 1) {
    const slot = slots[i];
    const previousSlot = slots[i - 1];

    const slotHasOnlyMinorPlacements =
      slot.placements.length > 0 &&
      slot.placements.every((placement) => placement.lane === "minor");

    if (!slotHasOnlyMinorPlacements) {
      continue;
    }

    for (const placement of [...slot.placements]) {
      const block = blockMap.get(placement.blockId);
      if (!block) continue;

      if (canPlaceBlockInSlot(previousSlot, block, placement.minutesUsed)) {
        previousSlot.placements.push({
          ...placement,
          slotId: previousSlot.id,
          id: `placement__${placement.blockId}__${previousSlot.id}__${previousSlot.placements.length + 1}`,
        });

        slot.placements = slot.placements.filter((p) => p.id !== placement.id);
      }
    }
  }
}

function rebalanceSplittableMajorPlacements(
  slots: SessionSlot[],
  blocks: Block[],
  placementsByBlockId: Map<string, Placement[]>,
  slotIndexMap: Map<string, number>,
  blockedBlockIds: Set<string> = new Set()
): void {
  const blockMap = new Map(blocks.map((block) => [block.id, block]));

  for (const [blockId, originalPlacements] of placementsByBlockId.entries()) {
    const block = blockMap.get(blockId);
    if (!block || !block.splittable || !isMajorBlock(block) || blockedBlockIds.has(blockId)) {
      continue;
    }

    let placements = sortPlacementsBySlotOrder(originalPlacements, slotIndexMap);
    let moved = true;

    while (moved && placements.length > 0) {
      moved = false;

      const lastPlacement = placements[placements.length - 1];
      const lastSlotIndex = slotIndexMap.get(lastPlacement.slotId);
      if (lastSlotIndex === undefined) {
        break;
      }

      const nextSlot = slots[lastSlotIndex + 1];
      if (!nextSlot || !slotSupportsBlockType(nextSlot, block) || nextSlot.locked) {
        break;
      }

      const nextSlotCapacity = getRemainingMinutes(nextSlot);
      if (nextSlotCapacity < getMinimumSegmentMinutes(block)) {
        break;
      }

      const donor = placements.find((placement) => placement.minutesUsed > getMinimumSegmentMinutes(block));
      if (!donor) {
        break;
      }

      const donorExcess = donor.minutesUsed - getMinimumSegmentMinutes(block);
      const shiftMinutes = Math.min(nextSlotCapacity, donorExcess);

      if (shiftMinutes < getMinimumSegmentMinutes(block)) {
        break;
      }

      donor.minutesUsed -= shiftMinutes;
      const newPlacement = createPlacement(block, nextSlot, shiftMinutes);
      nextSlot.placements.push(newPlacement);
      placements = sortPlacementsBySlotOrder([...placements, newPlacement], slotIndexMap);
      finalizePlacementChain(placements);
      placementsByBlockId.set(blockId, placements);
      moved = true;
    }
  }
}

export function placeBlocks(input: PlaceBlocksInput): PlaceBlocksResult {
  const slots = sortSlots(cloneSlots(input.slots));
  const blockMap = blockMapFrom(input.blocks);
  const anchorSlotIdByBlockId = getAnchorSlotIdMap(input.pacingPlan);
  const slotIndexMap = getSlotIndexMap(slots);
  const teacherRules = {
    allowLessonWrittenWorkOverlay: input.teacherRules?.allowLessonWrittenWorkOverlay ?? true,
    preferLessonWrittenWorkOverlay: input.teacherRules?.preferLessonWrittenWorkOverlay ?? true,
  };

  const placementsByBlockId = new Map<string, Placement[]>();
  const placedBlockIds = new Set<string>();
  const validationIssues: ValidationIssue[] = [...input.pacingPlan.validationIssues];

  const pendingMajorBlocks = [...input.pacingPlan.majorBlockOrder.filter(isMajorBlock)];
  const pendingMinorBlocks = input.blocks.filter((block) => !isMajorBlock(block));
  let progressMade = true;

  while ((pendingMajorBlocks.length > 0 || pendingMinorBlocks.length > 0) && progressMade) {
    progressMade = false;

    for (let i = 0; i < pendingMajorBlocks.length; ) {
      const block = pendingMajorBlocks[i];

      if (!dependenciesMet(block, placedBlockIds)) {
        i += 1;
        continue;
      }

      const anchoredSlotId = anchorSlotIdByBlockId.get(block.id);
      const anchoredSlotIndex = anchoredSlotId ? slotIndexMap.get(anchoredSlotId) : undefined;
      let placed = false;

      if (anchoredSlotIndex !== undefined) {
        const reservations = buildDependentReservationMap(
          block,
          anchoredSlotIndex,
          slots,
          input.blocks,
          placementsByBlockId,
          anchorSlotIdByBlockId,
          slotIndexMap
        );
        const placements = attemptPlaceBlock(slots, block, anchoredSlotIndex, reservations);
        if (placements) {
          placementsByBlockId.set(block.id, placements);
          placedBlockIds.add(block.id);
          pendingMajorBlocks.splice(i, 1);
          progressMade = true;
          placed = true;
          continue;
        }
      }

      const fallbackStartIndex = anchoredSlotIndex ?? 0;
      for (let startIndex = fallbackStartIndex; startIndex < slots.length; startIndex += 1) {
        const reservations = buildDependentReservationMap(
          block,
          startIndex,
          slots,
          input.blocks,
          placementsByBlockId,
          anchorSlotIdByBlockId,
          slotIndexMap
        );
        const placements = attemptPlaceBlock(slots, block, startIndex, reservations);
        if (!placements) {
          continue;
        }

        placementsByBlockId.set(block.id, placements);
        placedBlockIds.add(block.id);
        pendingMajorBlocks.splice(i, 1);
        progressMade = true;
        placed = true;

        validationIssues.push({
          code: "PLACE_MAJOR_FALLBACK_USED",
          severity: "info",
          message: `Major block "${block.title}" was placed in a fallback slot instead of its preferred anchor.`,
          relatedIds: [block.id, placements[0]?.slotId ?? slots[startIndex].id],
        });
        break;
      }

      if (!placed) {
        i += 1;
      }
    }

    for (let i = 0; i < pendingMinorBlocks.length; ) {
      const block = pendingMinorBlocks[i];

      if (!dependenciesMet(block, placedBlockIds)) {
        i += 1;
        continue;
      }

      const bestSlot = findBestMinorSlot(
        slots,
        block,
        placementsByBlockId,
        slotIndexMap,
        teacherRules
      );

      let placed = false;

      if (bestSlot) {
        const bestSlotIndex = slotIndexMap.get(bestSlot.id);
        const placements =
          bestSlotIndex !== undefined ? attemptPlaceBlock(slots, block, bestSlotIndex) : null;
        if (placements) {
          placementsByBlockId.set(block.id, placements);
          placedBlockIds.add(block.id);
          pendingMinorBlocks.splice(i, 1);
          progressMade = true;
          placed = true;
          continue;
        }
      }

      for (let startIndex = 0; startIndex < slots.length; startIndex += 1) {
        const fallbackPlacements = attemptPlaceBlock(slots, block, startIndex);
        if (!fallbackPlacements) {
          continue;
        }

        placementsByBlockId.set(block.id, fallbackPlacements);
        placedBlockIds.add(block.id);
        pendingMinorBlocks.splice(i, 1);
        progressMade = true;
        placed = true;
        break;
      }

      if (!placed) {
        i += 1;
      }
    }
  }

  for (const remainingMajor of pendingMajorBlocks) {
    validationIssues.push({
      code: dependenciesMet(remainingMajor, placedBlockIds)
        ? "PLACE_MAJOR_FAILED"
        : "PLACE_MAJOR_DEPENDENCIES_UNMET",
      severity: dependenciesMet(remainingMajor, placedBlockIds) ? "error" : "warning",
      message: dependenciesMet(remainingMajor, placedBlockIds)
        ? `Major block "${remainingMajor.title}" could not be placed.`
        : `Major block "${remainingMajor.title}" is still waiting on unmet dependencies.`,
      relatedIds: [remainingMajor.id, ...remainingMajor.dependencies],
    });
  }

  for (const remainingMinor of pendingMinorBlocks) {
    validationIssues.push({
      code: dependenciesMet(remainingMinor, placedBlockIds)
        ? "PLACE_MINOR_FAILED"
        : "PLACE_MINOR_DEPENDENCIES_UNMET",
      severity: "warning",
      message: dependenciesMet(remainingMinor, placedBlockIds)
        ? `Minor block "${remainingMinor.title}" could not be placed.`
        : `Minor block "${remainingMinor.title}" is still waiting on unmet dependencies.`,
      relatedIds: [remainingMinor.id, ...remainingMinor.dependencies],
    });
  }

  compactStandaloneMinorPlacements(slots, blockMap);

  let bufferIndex = 1;
  for (const slot of slots) {
    if (slot.locked) continue;
    if (slot.placements.length > 0) continue;

    const courseId =
      input.blocks[0]?.courseId ??
      input.pacingPlan.majorBlockOrder[0]?.courseId ??
      slot.courseId;

    const bufferBlock = buildBufferBlock(courseId, bufferIndex, slot.minutes);
    blockMap.set(bufferBlock.id, bufferBlock);

    const slotIndex = slotIndexMap.get(slot.id);
    const placements = slotIndex !== undefined ? attemptPlaceBlock(slots, bufferBlock, slotIndex) : null;
    if (placements) {
      placementsByBlockId.set(bufferBlock.id, placements);
      placedBlockIds.add(bufferBlock.id);
      bufferIndex += 1;
    }
  }

  const unscheduledBlocks = input.blocks.filter((block) => !placedBlockIds.has(block.id));

  if (unscheduledBlocks.length > 0) {
    validationIssues.push({
      code: "PLACE_UNSCHEDULED_BLOCKS_REMAIN",
      severity: "warning",
      message: "Some blocks remain unscheduled after placement.",
      relatedIds: unscheduledBlocks.map((block) => block.id),
    });
  }

  return {
    slots,
    unscheduledBlocks,
    validationIssues,
  };
}
