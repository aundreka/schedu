import type { Block, Placement, SessionSlot, TermSchedulingDiagnostics } from "./types";
import { isElasticBlock, isGuaranteedBlock } from "./schedulingPolicy";

export type SlotState = "blocked" | "exclusive" | "empty" | "partial" | "full";

export function placementId(blockId: string, slotId: string, order: number) {
  return `placement__${blockId}__${slotId}__${order}`;
}

export function rebuildPlacementIds(slot: SessionSlot) {
  slot.placements = slot.placements.map((placement, index) => ({
    ...placement,
    id: placementId(placement.blockId, slot.id, index + 1),
    slotId: slot.id,
  }));
}

export function getUsedMinutes(slot: SessionSlot) {
  return slot.placements.reduce((sum, placement) => sum + placement.minutesUsed, 0);
}

export function getPlacementMinutes(slot: SessionSlot, block: Pick<Block, "estimatedMinutes">) {
  if (slot.minutes <= 0) return Math.max(15, block.estimatedMinutes);
  return Math.min(slot.minutes, Math.max(15, block.estimatedMinutes));
}

export function hasCapacity(slot: SessionSlot, block: Pick<Block, "estimatedMinutes">) {
  if (slot.minutes <= 0) return true;
  return getUsedMinutes(slot) + getPlacementMinutes(slot, block) <= slot.minutes;
}

export function isLectureLike(slot: SessionSlot) {
  return (
    slot.sessionType === "lecture" ||
    slot.sessionType === "laboratory" ||
    slot.sessionType === "mixed" ||
    slot.sessionType === "any" ||
    slot.sessionType === null
  );
}

export function isLabLike(slot: SessionSlot) {
  return (
    slot.sessionType === "laboratory" ||
    slot.sessionType === "mixed" ||
    slot.sessionType === "any" ||
    slot.sessionType === null
  );
}

export function requiresLaboratorySlot(block: Block) {
  return block.preferredSessionType === "laboratory";
}

export function isCompatibleSlot(slot: SessionSlot, block: Block) {
  if (!requiresLaboratorySlot(block)) return isLectureLike(slot);
  return isLabLike(slot);
}

export function isExclusiveBlock(block: Block | null | undefined) {
  return (
    block?.type === "exam" ||
    (block?.type === "buffer" && block.subcategory === "orientation")
  );
}

export function getBlocksInSlot(slot: SessionSlot, blockMap: Map<string, Block>) {
  return slot.placements
    .map((placement) => blockMap.get(placement.blockId) ?? null)
    .filter((block): block is Block => Boolean(block));
}

export function classifySlot(slot: SessionSlot, blockMap: Map<string, Block>): SlotState {
  if (slot.locked) {
    return "blocked";
  }

  const blocksInSlot = getBlocksInSlot(slot, blockMap);
  if (blocksInSlot.some((block) => isExclusiveBlock(block))) return "exclusive";
  if (blocksInSlot.length === 0) return "empty";
  if (slot.minutes > 0 && getUsedMinutes(slot) >= slot.minutes) return "full";
  return "partial";
}

export function isEligibleEmptySlot(slot: SessionSlot, blockMap: Map<string, Block>) {
  return classifySlot(slot, blockMap) === "empty" && !slot.reservedFor;
}

export function canPlaceInSlot(
  slot: SessionSlot,
  block: Block,
  blockMap: Map<string, Block>,
  options: { requireEmpty?: boolean } = {}
) {
  const state = classifySlot(slot, blockMap);
  if (state === "blocked") return false;
  if (options.requireEmpty && state !== "empty") return false;
  if (slot.reservedFor === "exam" && block.type !== "exam") return false;
  if (
    slot.reservedFor === "orientation" &&
    !(block.type === "buffer" && block.subcategory === "orientation")
  ) {
    return false;
  }
  if (!isCompatibleSlot(slot, block)) return false;
  const blocksInSlot = getBlocksInSlot(slot, blockMap);
  if (blocksInSlot.some((placed) => isExclusiveBlock(placed))) return false;
  if (isExclusiveBlock(block) && blocksInSlot.length > 0) return false;
  return hasCapacity(slot, block);
}

export function addPlacement(slot: SessionSlot, block: Block) {
  const lane: Placement["lane"] = block.overlayMode === "minor" ? "minor" : "major";
  slot.placements.push({
    id: placementId(block.id, slot.id, slot.placements.length + 1),
    blockId: block.id,
    slotId: slot.id,
    lane,
    minutesUsed: getPlacementMinutes(slot, block),
    chainId: block.id,
    segmentIndex: 1,
    segmentCount: 1,
    continuesFromPrevious: false,
    continuesToNext: false,
    startTime: null,
    endTime: null,
  });
  rebuildPlacementIds(slot);
}

export function buildTermSchedulingDiagnostics(input: {
  termIndex: number;
  slots: SessionSlot[];
  blocks: Block[];
  missingCanonicalBlockIds?: string[];
  unscheduledBlockIds: string[];
  hasValidationErrors?: boolean;
}): TermSchedulingDiagnostics {
  const blockMap = new Map(input.blocks.map((block) => [block.id, block]));
  const unscheduledRequiredBlockIds = input.unscheduledBlockIds.filter((blockId) => {
    const block = blockMap.get(blockId);
    return Boolean(block && isGuaranteedBlock(block));
  });
  const droppedElasticBlockIds = input.unscheduledBlockIds.filter((blockId) => {
    const block = blockMap.get(blockId);
    return Boolean(block && isElasticBlock(block));
  });

  let emptyEligibleSlotCount = 0;
  let partiallyUsedSlotCount = 0;
  for (const slot of input.slots) {
    const state = classifySlot(slot, blockMap);
    if (state === "empty") emptyEligibleSlotCount += 1;
    if (state === "partial") partiallyUsedSlotCount += 1;
  }

  return {
    termIndex: input.termIndex,
    emptyEligibleSlotCount,
    partiallyUsedSlotCount,
    missingCanonicalBlockIds: input.missingCanonicalBlockIds ?? [],
    unscheduledRequiredBlockIds,
    droppedElasticBlockIds,
    guaranteedPlacementSatisfied: unscheduledRequiredBlockIds.length === 0,
    requiresCompression:
      unscheduledRequiredBlockIds.length > 0 &&
      emptyEligibleSlotCount === 0 &&
      partiallyUsedSlotCount > 0,
    hasValidationErrors: Boolean(input.hasValidationErrors),
  };
}
