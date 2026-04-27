import { placeCoreBlocks } from "./placeCoreBlocks";
import { getDropPriority, isElasticBlock } from "./schedulingPolicy";
import {
  buildTermSchedulingDiagnostics,
  classifySlot,
} from "./slotState";
import type { Block, PlacementResult, SessionSlot, TermSchedulingDiagnostics } from "./types";

type TermRepairInput = {
  termSlots: SessionSlot[];
  blocks: Block[];
  missingCanonicalBlockIds?: string[];
  hasValidationErrors?: boolean;
};

export type TermRepairResult = PlacementResult & {
  diagnostics: TermSchedulingDiagnostics;
};

function cloneSlots(slots: SessionSlot[]) {
  return slots.map((slot) => ({
    ...slot,
    placements: [...slot.placements],
  }));
}

function syncSlots(target: SessionSlot[], source: SessionSlot[]) {
  const byId = new Map(source.map((slot) => [slot.id, slot]));
  target.forEach((slot) => {
    const next = byId.get(slot.id);
    slot.placements = next?.placements ? [...next.placements] : [];
  });
}

function lockForEmptyOnlyRepopulation(termSlots: SessionSlot[], blocks: Block[]) {
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  return termSlots.map((slot) => {
    const state = classifySlot(slot, blockMap);
    return {
      ...slot,
      locked: slot.locked || state !== "empty",
      lockReason:
        slot.locked || state !== "empty"
          ? slot.lockReason ?? "Reserved during empty-slot repopulation"
          : null,
    };
  });
}

function unlockForCompression(termSlots: SessionSlot[], blocks: Block[]) {
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  return termSlots.map((slot) => {
    const state = classifySlot(slot, blockMap);
    const preserveLock = slot.locked || state === "exclusive";
    return {
      ...slot,
      locked: preserveLock,
      lockReason: preserveLock ? slot.lockReason ?? "Reserved during compression" : null,
    };
  });
}

export function repopulateTermIntoEmptySlots(input: TermRepairInput): TermRepairResult {
  const workingSlots = lockForEmptyOnlyRepopulation(cloneSlots(input.termSlots), input.blocks);
  const placement = placeCoreBlocks({
    slots: workingSlots,
    blocks: input.blocks,
    requireEmptySlotsOnly: true,
  });

  return {
    ...placement,
    diagnostics: buildTermSchedulingDiagnostics({
      termIndex: Number(workingSlots[0]?.termIndex ?? 0),
      slots: placement.slots,
      blocks: input.blocks,
      missingCanonicalBlockIds: input.missingCanonicalBlockIds,
      unscheduledBlockIds: placement.unscheduledBlockIds,
      hasValidationErrors: input.hasValidationErrors,
    }),
  };
}

export function compressTermUsingCapacity(input: TermRepairInput): TermRepairResult {
  const emptyFirst = repopulateTermIntoEmptySlots(input);
  if (emptyFirst.unscheduledBlockIds.length === 0) return emptyFirst;

  const workingSlots = unlockForCompression(cloneSlots(emptyFirst.slots), input.blocks);
  let workingBlocks = [...input.blocks];
  let placement = placeCoreBlocks({
    slots: workingSlots,
    blocks: workingBlocks,
    requireEmptySlotsOnly: false,
  });

  if (placement.unscheduledBlockIds.length > 0) {
    const elasticCandidates = workingBlocks
      .filter((block) => isElasticBlock(block))
      .sort((a, b) => getDropPriority(a) - getDropPriority(b));
    for (const elasticBlock of elasticCandidates) {
      if (placement.unscheduledBlockIds.length === 0) break;
      workingBlocks = workingBlocks.filter((block) => block.id !== elasticBlock.id);
      placement = placeCoreBlocks({
        slots: unlockForCompression(cloneSlots(emptyFirst.slots), workingBlocks),
        blocks: workingBlocks,
        requireEmptySlotsOnly: false,
      });
    }
  }

  return {
    ...placement,
    diagnostics: buildTermSchedulingDiagnostics({
      termIndex: Number(workingSlots[0]?.termIndex ?? 0),
      slots: placement.slots,
      blocks: workingBlocks,
      missingCanonicalBlockIds: input.missingCanonicalBlockIds,
      unscheduledBlockIds: placement.unscheduledBlockIds,
      hasValidationErrors: input.hasValidationErrors,
    }),
  };
}

export function applyTermRepairResult(termSlots: SessionSlot[], result: PlacementResult) {
  syncSlots(termSlots, result.slots);
}
