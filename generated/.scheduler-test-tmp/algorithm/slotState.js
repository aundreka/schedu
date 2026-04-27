"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.placementId = placementId;
exports.rebuildPlacementIds = rebuildPlacementIds;
exports.getUsedMinutes = getUsedMinutes;
exports.getPlacementMinutes = getPlacementMinutes;
exports.hasCapacity = hasCapacity;
exports.isLectureLike = isLectureLike;
exports.isLabLike = isLabLike;
exports.requiresLaboratorySlot = requiresLaboratorySlot;
exports.isCompatibleSlot = isCompatibleSlot;
exports.isExclusiveBlock = isExclusiveBlock;
exports.getBlocksInSlot = getBlocksInSlot;
exports.classifySlot = classifySlot;
exports.isEligibleEmptySlot = isEligibleEmptySlot;
exports.canPlaceInSlot = canPlaceInSlot;
exports.addPlacement = addPlacement;
exports.buildTermSchedulingDiagnostics = buildTermSchedulingDiagnostics;
const schedulingPolicy_1 = require("./schedulingPolicy");
function placementId(blockId, slotId, order) {
    return `placement__${blockId}__${slotId}__${order}`;
}
function rebuildPlacementIds(slot) {
    slot.placements = slot.placements.map((placement, index) => ({
        ...placement,
        id: placementId(placement.blockId, slot.id, index + 1),
        slotId: slot.id,
    }));
}
function getUsedMinutes(slot) {
    return slot.placements.reduce((sum, placement) => sum + placement.minutesUsed, 0);
}
function getPlacementMinutes(slot, block) {
    if (slot.minutes <= 0)
        return Math.max(15, block.estimatedMinutes);
    return Math.min(slot.minutes, Math.max(15, block.estimatedMinutes));
}
function hasCapacity(slot, block) {
    if (slot.minutes <= 0)
        return true;
    return getUsedMinutes(slot) + getPlacementMinutes(slot, block) <= slot.minutes;
}
function isLectureLike(slot) {
    return (slot.sessionType === "lecture" ||
        slot.sessionType === "laboratory" ||
        slot.sessionType === "mixed" ||
        slot.sessionType === "any" ||
        slot.sessionType === null);
}
function isLabLike(slot) {
    return (slot.sessionType === "laboratory" ||
        slot.sessionType === "mixed" ||
        slot.sessionType === "any" ||
        slot.sessionType === null);
}
function requiresLaboratorySlot(block) {
    return block.preferredSessionType === "laboratory";
}
function isCompatibleSlot(slot, block) {
    if (!requiresLaboratorySlot(block))
        return isLectureLike(slot);
    return isLabLike(slot);
}
function isExclusiveBlock(block) {
    return (block?.type === "exam" ||
        (block?.type === "buffer" && block.subcategory === "orientation"));
}
function getBlocksInSlot(slot, blockMap) {
    return slot.placements
        .map((placement) => blockMap.get(placement.blockId) ?? null)
        .filter((block) => Boolean(block));
}
function classifySlot(slot, blockMap) {
    if (slot.locked) {
        return "blocked";
    }
    const blocksInSlot = getBlocksInSlot(slot, blockMap);
    if (blocksInSlot.some((block) => isExclusiveBlock(block)))
        return "exclusive";
    if (blocksInSlot.length === 0)
        return "empty";
    if (slot.minutes > 0 && getUsedMinutes(slot) >= slot.minutes)
        return "full";
    return "partial";
}
function isEligibleEmptySlot(slot, blockMap) {
    return classifySlot(slot, blockMap) === "empty" && !slot.reservedFor;
}
function canPlaceInSlot(slot, block, blockMap, options = {}) {
    const state = classifySlot(slot, blockMap);
    if (state === "blocked")
        return false;
    if (options.requireEmpty && state !== "empty")
        return false;
    if (slot.reservedFor === "exam" && block.type !== "exam")
        return false;
    if (slot.reservedFor === "orientation" &&
        !(block.type === "buffer" && block.subcategory === "orientation")) {
        return false;
    }
    if (!isCompatibleSlot(slot, block))
        return false;
    const blocksInSlot = getBlocksInSlot(slot, blockMap);
    if (blocksInSlot.some((placed) => isExclusiveBlock(placed)))
        return false;
    if (isExclusiveBlock(block) && blocksInSlot.length > 0)
        return false;
    return hasCapacity(slot, block);
}
function addPlacement(slot, block) {
    const lane = block.overlayMode === "minor" ? "minor" : "major";
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
function buildTermSchedulingDiagnostics(input) {
    const blockMap = new Map(input.blocks.map((block) => [block.id, block]));
    const unscheduledRequiredBlockIds = input.unscheduledBlockIds.filter((blockId) => {
        const block = blockMap.get(blockId);
        return Boolean(block && (0, schedulingPolicy_1.isGuaranteedBlock)(block));
    });
    const droppedElasticBlockIds = input.unscheduledBlockIds.filter((blockId) => {
        const block = blockMap.get(blockId);
        return Boolean(block && (0, schedulingPolicy_1.isElasticBlock)(block));
    });
    let emptyEligibleSlotCount = 0;
    let partiallyUsedSlotCount = 0;
    for (const slot of input.slots) {
        const state = classifySlot(slot, blockMap);
        if (state === "empty")
            emptyEligibleSlotCount += 1;
        if (state === "partial")
            partiallyUsedSlotCount += 1;
    }
    return {
        termIndex: input.termIndex,
        emptyEligibleSlotCount,
        partiallyUsedSlotCount,
        missingCanonicalBlockIds: input.missingCanonicalBlockIds ?? [],
        unscheduledRequiredBlockIds,
        droppedElasticBlockIds,
        guaranteedPlacementSatisfied: unscheduledRequiredBlockIds.length === 0,
        requiresCompression: unscheduledRequiredBlockIds.length > 0 &&
            emptyEligibleSlotCount === 0 &&
            partiallyUsedSlotCount > 0,
        hasValidationErrors: Boolean(input.hasValidationErrors),
    };
}
