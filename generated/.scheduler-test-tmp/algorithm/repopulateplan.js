"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.repopulateTermIntoEmptySlots = repopulateTermIntoEmptySlots;
exports.compressTermUsingCapacity = compressTermUsingCapacity;
exports.applyTermRepairResult = applyTermRepairResult;
const placeCoreBlocks_1 = require("./placeCoreBlocks");
const schedulingPolicy_1 = require("./schedulingPolicy");
const slotState_1 = require("./slotState");
function cloneSlots(slots) {
    return slots.map((slot) => ({
        ...slot,
        placements: [...slot.placements],
    }));
}
function syncSlots(target, source) {
    const byId = new Map(source.map((slot) => [slot.id, slot]));
    target.forEach((slot) => {
        const next = byId.get(slot.id);
        slot.placements = next?.placements ? [...next.placements] : [];
    });
}
function lockForEmptyOnlyRepopulation(termSlots, blocks) {
    const blockMap = new Map(blocks.map((block) => [block.id, block]));
    return termSlots.map((slot) => {
        const state = (0, slotState_1.classifySlot)(slot, blockMap);
        return {
            ...slot,
            locked: slot.locked || state !== "empty",
            lockReason: slot.locked || state !== "empty"
                ? slot.lockReason ?? "Reserved during empty-slot repopulation"
                : null,
        };
    });
}
function unlockForCompression(termSlots, blocks) {
    const blockMap = new Map(blocks.map((block) => [block.id, block]));
    return termSlots.map((slot) => {
        const state = (0, slotState_1.classifySlot)(slot, blockMap);
        const preserveLock = slot.locked || state === "exclusive";
        return {
            ...slot,
            locked: preserveLock,
            lockReason: preserveLock ? slot.lockReason ?? "Reserved during compression" : null,
        };
    });
}
function repopulateTermIntoEmptySlots(input) {
    const workingSlots = lockForEmptyOnlyRepopulation(cloneSlots(input.termSlots), input.blocks);
    const placement = (0, placeCoreBlocks_1.placeCoreBlocks)({
        slots: workingSlots,
        blocks: input.blocks,
        requireEmptySlotsOnly: true,
    });
    return {
        ...placement,
        diagnostics: (0, slotState_1.buildTermSchedulingDiagnostics)({
            termIndex: Number(workingSlots[0]?.termIndex ?? 0),
            slots: placement.slots,
            blocks: input.blocks,
            missingCanonicalBlockIds: input.missingCanonicalBlockIds,
            unscheduledBlockIds: placement.unscheduledBlockIds,
            hasValidationErrors: input.hasValidationErrors,
        }),
    };
}
function compressTermUsingCapacity(input) {
    const emptyFirst = repopulateTermIntoEmptySlots(input);
    if (emptyFirst.unscheduledBlockIds.length === 0)
        return emptyFirst;
    const workingSlots = unlockForCompression(cloneSlots(emptyFirst.slots), input.blocks);
    let workingBlocks = [...input.blocks];
    let placement = (0, placeCoreBlocks_1.placeCoreBlocks)({
        slots: workingSlots,
        blocks: workingBlocks,
        requireEmptySlotsOnly: false,
    });
    if (placement.unscheduledBlockIds.length > 0) {
        const elasticCandidates = workingBlocks
            .filter((block) => (0, schedulingPolicy_1.isElasticBlock)(block))
            .sort((a, b) => (0, schedulingPolicy_1.getDropPriority)(a) - (0, schedulingPolicy_1.getDropPriority)(b));
        for (const elasticBlock of elasticCandidates) {
            if (placement.unscheduledBlockIds.length === 0)
                break;
            workingBlocks = workingBlocks.filter((block) => block.id !== elasticBlock.id);
            placement = (0, placeCoreBlocks_1.placeCoreBlocks)({
                slots: unlockForCompression(cloneSlots(emptyFirst.slots), workingBlocks),
                blocks: workingBlocks,
                requireEmptySlotsOnly: false,
            });
        }
    }
    return {
        ...placement,
        diagnostics: (0, slotState_1.buildTermSchedulingDiagnostics)({
            termIndex: Number(workingSlots[0]?.termIndex ?? 0),
            slots: placement.slots,
            blocks: workingBlocks,
            missingCanonicalBlockIds: input.missingCanonicalBlockIds,
            unscheduledBlockIds: placement.unscheduledBlockIds,
            hasValidationErrors: input.hasValidationErrors,
        }),
    };
}
function applyTermRepairResult(termSlots, result) {
    syncSlots(termSlots, result.slots);
}
