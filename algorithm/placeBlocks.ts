import { compressTermPlan } from "./compressplan";
import { extendTermPlan } from "./extendplan";
import { placeCoreBlocks } from "./placeCoreBlocks";
import { isElasticBlock } from "./schedulingPolicy";
import {
  compareBlocksByCanonicalSequence,
  getCanonicalSequenceValue,
} from "./sequence";
import type { Block, PlacementResult, SessionSlot } from "./types";

export type PlaceBlocksInput = {
  slots: SessionSlot[];
  blocks: Block[];
};

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

function buildBlockMap(blocks: Block[]) {
  return new Map(blocks.map((block) => [block.id, block]));
}

function rebuildPlacementIds(slot: SessionSlot) {
  slot.placements = slot.placements.map((placement, index) => ({
    ...placement,
    id: placementId(placement.blockId, slot.id, index + 1),
    slotId: slot.id,
  }));
}

function categoryRank(block: Block | null) {
  if (!block) return 99;
  if (block.type === "lesson") return 1;
  if (block.type === "written_work" && block.subcategory !== "quiz") return 2;
  if (block.type === "performance_task") return 3;
  if (block.type === "written_work" && block.subcategory === "quiz") return 4;
  if (block.type === "buffer") return 5;
  if (block.type === "exam") return 6;
  return 99;
}

function normalizePlacementOrder(slot: SessionSlot, blockMap: Map<string, Block>) {
  slot.placements = [...slot.placements]
    .sort((a, b) => {
      const aBlock = blockMap.get(a.blockId) ?? null;
      const bBlock = blockMap.get(b.blockId) ?? null;
      const rankDiff = categoryRank(aBlock) - categoryRank(bBlock);
      if (rankDiff !== 0) return rankDiff;
      const sequenceDiff =
        getCanonicalSequenceValue(aBlock ?? {}) - getCanonicalSequenceValue(bBlock ?? {});
      if (sequenceDiff !== 0) return sequenceDiff;
      if (a.lane !== b.lane) return a.lane === "major" ? -1 : 1;
      return a.blockId.localeCompare(b.blockId);
    })
    .map((placement, index) => ({
      ...placement,
      id: placementId(placement.blockId, slot.id, index + 1),
      slotId: slot.id,
    }));
}

function getFirstScheduledOrder(
  slots: SessionSlot[],
  blockId: string
): { slotIndex: number; placementIndex: number } | null {
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const placementIndex = slots[slotIndex]!.placements.findIndex(
      (placement) => placement.blockId === blockId
    );
    if (placementIndex >= 0) {
      return { slotIndex, placementIndex };
    }
  }
  return null;
}

function comparePlacementOrder(
  a: { slotIndex: number; placementIndex: number } | null,
  b: { slotIndex: number; placementIndex: number } | null
) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
  return a.placementIndex - b.placementIndex;
}

function validateRequiredPlacementOrder(termSlots: SessionSlot[], termBlocks: Block[]) {
  const requiredGroups: Array<(block: Block) => boolean> = [
    (block) => block.type === "lesson" && !block.metadata.extraCandidateType,
    (block) => block.type === "performance_task" && !block.metadata.extraCandidateType,
    (block) =>
      block.type === "written_work" &&
      block.subcategory === "quiz" &&
      !block.metadata.extraCandidateType,
    (block) =>
      block.type === "written_work" &&
      block.subcategory !== "quiz" &&
      !block.metadata.extraCandidateType,
  ];

  for (const matcher of requiredGroups) {
    const orderedBlocks = termBlocks
      .filter(matcher)
      .sort((a, b) => compareBlocksByCanonicalSequence(a, b));
    let previousOrder: { slotIndex: number; placementIndex: number } | null = null;
    for (const block of orderedBlocks) {
      const currentOrder = getFirstScheduledOrder(termSlots, block.id);
      if (!currentOrder) continue;
      if (comparePlacementOrder(previousOrder, currentOrder) > 0) {
        return false;
      }
      previousOrder = currentOrder;
    }
  }

  return true;
}

function pickRequiredPlacement(result: PlacementResult) {
  return result;
}

function placeRequiredCoreBlocks(termSlots: SessionSlot[], termBlocks: Block[]) {
  return pickRequiredPlacement(
    placeCoreBlocks({
      slots: termSlots,
      blocks: termBlocks,
    })
  );
}

function pickOptionalPlacement(termSlots: SessionSlot[], termBlocks: Block[], unscheduled: Set<string>) {
  const examBlock = termBlocks.find((block) => block.type === "exam") ?? null;
  const extraTermSlots = Number(examBlock?.metadata.extraTermSlots ?? 0);
  const futureDelayCount = Number(examBlock?.metadata.futureDelayCount ?? 0);
  const balanceRemaining = extraTermSlots - futureDelayCount;

  if (balanceRemaining < 0) {
    compressTermPlan({
      termSlots,
      blocks: termBlocks,
    });
  }

  if (extraTermSlots > 0) {
    extendTermPlan({
      termSlots,
      blocks: termBlocks,
      unscheduled,
    });
  }
}

function placeOptionalExpansionBlocks(
  termSlots: SessionSlot[],
  termBlocks: Block[],
  unscheduled: Set<string>
) {
  pickOptionalPlacement(termSlots, termBlocks, unscheduled);
}

export function placeBlocks(input: PlaceBlocksInput): PlacementResult {
  const slots = cloneSlots(input.slots);
  const blockMap = buildBlockMap(input.blocks);

  for (const [, termSlotsRaw] of getTermSlots(slots)) {
    const termSlots = [...termSlotsRaw].sort(compareSlots);
    if (termSlots.length === 0) continue;
    const termIndex = termSlots[0]?.termIndex ?? 0;
    const termBlocks = input.blocks.filter(
      (block) => Number(block.metadata.termIndex ?? -1) === termIndex
    );

    const requiredPlacement = placeRequiredCoreBlocks(termSlots, termBlocks);
    const placedSlotsById = new Map(
      requiredPlacement.slots.map((slot) => [slot.id, slot])
    );

    for (const slot of termSlots) {
      slot.placements = placedSlotsById.get(slot.id)?.placements
        ? [...placedSlotsById.get(slot.id)!.placements]
        : [];
      rebuildPlacementIds(slot);
    }

    const unscheduled = new Set(requiredPlacement.unscheduledBlockIds);
    placeOptionalExpansionBlocks(termSlots, termBlocks, unscheduled);

    termSlots.forEach((slot) => normalizePlacementOrder(slot, blockMap));

    if (!validateRequiredPlacementOrder(termSlots, termBlocks)) {
      termSlots.forEach((slot) => normalizePlacementOrder(slot, blockMap));
    }
  }

  const placedBlockIds = new Set(
    slots.flatMap((slot) => slot.placements.map((placement) => placement.blockId))
  );
  const unscheduledBlockIds = input.blocks
    .filter((block) => !placedBlockIds.has(block.id) && isElasticBlock(block))
    .map((block) => block.id);

  return {
    slots,
    unscheduledBlockIds,
  };
}
