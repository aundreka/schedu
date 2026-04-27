"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.placeBlocks = placeBlocks;
const compressplan_1 = require("./compressplan");
const extendplan_1 = require("./extendplan");
const placeCoreBlocks_1 = require("./placeCoreBlocks");
const schedulingPolicy_1 = require("./schedulingPolicy");
const sequence_1 = require("./sequence");
function compareSlots(a, b) {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0)
        return dateCompare;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
}
function placementId(blockId, slotId, order) {
    return `placement__${blockId}__${slotId}__${order}`;
}
function cloneSlots(slots) {
    return [...slots]
        .map((slot) => ({
        ...slot,
        placements: [...slot.placements],
    }))
        .sort(compareSlots);
}
function getTermSlots(slots) {
    const grouped = new Map();
    for (const slot of slots) {
        const key = slot.termIndex ?? 0;
        const current = grouped.get(key) ?? [];
        current.push(slot);
        grouped.set(key, current);
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
}
function buildBlockMap(blocks) {
    return new Map(blocks.map((block) => [block.id, block]));
}
function rebuildPlacementIds(slot) {
    slot.placements = slot.placements.map((placement, index) => ({
        ...placement,
        id: placementId(placement.blockId, slot.id, index + 1),
        slotId: slot.id,
    }));
}
function categoryRank(block) {
    if (!block)
        return 99;
    if (block.type === "lesson")
        return 1;
    if (block.type === "written_work" && block.subcategory !== "quiz")
        return 2;
    if (block.type === "performance_task")
        return 3;
    if (block.type === "written_work" && block.subcategory === "quiz")
        return 4;
    if (block.type === "buffer")
        return 5;
    if (block.type === "exam")
        return 6;
    return 99;
}
function normalizePlacementOrder(slot, blockMap) {
    slot.placements = [...slot.placements]
        .sort((a, b) => {
        const aBlock = blockMap.get(a.blockId) ?? null;
        const bBlock = blockMap.get(b.blockId) ?? null;
        const rankDiff = categoryRank(aBlock) - categoryRank(bBlock);
        if (rankDiff !== 0)
            return rankDiff;
        const sequenceDiff = (0, sequence_1.getCanonicalSequenceValue)(aBlock ?? {}) - (0, sequence_1.getCanonicalSequenceValue)(bBlock ?? {});
        if (sequenceDiff !== 0)
            return sequenceDiff;
        if (a.lane !== b.lane)
            return a.lane === "major" ? -1 : 1;
        return a.blockId.localeCompare(b.blockId);
    })
        .map((placement, index) => ({
        ...placement,
        id: placementId(placement.blockId, slot.id, index + 1),
        slotId: slot.id,
    }));
}
function getFirstScheduledOrder(slots, blockId) {
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        const placementIndex = slots[slotIndex].placements.findIndex((placement) => placement.blockId === blockId);
        if (placementIndex >= 0) {
            return { slotIndex, placementIndex };
        }
    }
    return null;
}
function comparePlacementOrder(a, b) {
    if (!a && !b)
        return 0;
    if (!a)
        return 1;
    if (!b)
        return -1;
    if (a.slotIndex !== b.slotIndex)
        return a.slotIndex - b.slotIndex;
    return a.placementIndex - b.placementIndex;
}
function validateRequiredPlacementOrder(termSlots, termBlocks) {
    const requiredGroups = [
        (block) => block.type === "lesson" && !block.metadata.extraCandidateType,
        (block) => block.type === "performance_task" && !block.metadata.extraCandidateType,
        (block) => block.type === "written_work" &&
            block.subcategory === "quiz" &&
            !block.metadata.extraCandidateType,
        (block) => block.type === "written_work" &&
            block.subcategory !== "quiz" &&
            !block.metadata.extraCandidateType,
    ];
    for (const matcher of requiredGroups) {
        const orderedBlocks = termBlocks
            .filter(matcher)
            .sort((a, b) => (0, sequence_1.compareBlocksByCanonicalSequence)(a, b));
        let previousOrder = null;
        for (const block of orderedBlocks) {
            const currentOrder = getFirstScheduledOrder(termSlots, block.id);
            if (!currentOrder)
                continue;
            if (comparePlacementOrder(previousOrder, currentOrder) > 0) {
                return false;
            }
            previousOrder = currentOrder;
        }
    }
    return true;
}
function pickRequiredPlacement(result) {
    return result;
}
function placeRequiredCoreBlocks(termSlots, termBlocks) {
    return pickRequiredPlacement((0, placeCoreBlocks_1.placeCoreBlocks)({
        slots: termSlots,
        blocks: termBlocks,
    }));
}
function pickOptionalPlacement(termSlots, termBlocks, unscheduled) {
    const examBlock = termBlocks.find((block) => block.type === "exam") ?? null;
    const extraTermSlots = Number(examBlock?.metadata.extraTermSlots ?? 0);
    const futureDelayCount = Number(examBlock?.metadata.futureDelayCount ?? 0);
    const balanceRemaining = extraTermSlots - futureDelayCount;
    if (balanceRemaining < 0) {
        (0, compressplan_1.compressTermPlan)({
            termSlots,
            blocks: termBlocks,
        });
    }
    if (extraTermSlots > 0) {
        (0, extendplan_1.extendTermPlan)({
            termSlots,
            blocks: termBlocks,
            unscheduled,
        });
    }
}
function placeOptionalExpansionBlocks(termSlots, termBlocks, unscheduled) {
    pickOptionalPlacement(termSlots, termBlocks, unscheduled);
}
function placeBlocks(input) {
    const slots = cloneSlots(input.slots);
    const blockMap = buildBlockMap(input.blocks);
    for (const [, termSlotsRaw] of getTermSlots(slots)) {
        const termSlots = [...termSlotsRaw].sort(compareSlots);
        if (termSlots.length === 0)
            continue;
        const termIndex = termSlots[0]?.termIndex ?? 0;
        const termBlocks = input.blocks.filter((block) => Number(block.metadata.termIndex ?? -1) === termIndex);
        const requiredPlacement = placeRequiredCoreBlocks(termSlots, termBlocks);
        const placedSlotsById = new Map(requiredPlacement.slots.map((slot) => [slot.id, slot]));
        for (const slot of termSlots) {
            slot.placements = placedSlotsById.get(slot.id)?.placements
                ? [...placedSlotsById.get(slot.id).placements]
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
    const placedBlockIds = new Set(slots.flatMap((slot) => slot.placements.map((placement) => placement.blockId)));
    const unscheduledBlockIds = input.blocks
        .filter((block) => !placedBlockIds.has(block.id) && (0, schedulingPolicy_1.isElasticBlock)(block))
        .map((block) => block.id);
    return {
        slots,
        unscheduledBlockIds,
    };
}
