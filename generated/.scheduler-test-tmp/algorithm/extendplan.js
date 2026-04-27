"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extendTermPlan = extendTermPlan;
const sequence_1 = require("./sequence");
const slotState_1 = require("./slotState");
function findPlacementIndex(termSlots, blockId) {
    for (let index = 0; index < termSlots.length; index += 1) {
        if (termSlots[index]?.placements.some((placement) => placement.blockId === blockId)) {
            return index;
        }
    }
    return -1;
}
function buildBlockMap(blocks) {
    return new Map(blocks.map((block) => [block.id, block]));
}
function pickExtensionSlotIndex(termSlots, block, blockMap, startIndex, endIndex) {
    for (let index = Math.max(0, startIndex); index <= endIndex && index < termSlots.length; index += 1) {
        if ((0, slotState_1.canPlaceInSlot)(termSlots[index], block, blockMap, { requireEmpty: true })) {
            return index;
        }
    }
    return -1;
}
function extendTermPlan(context) {
    const { termSlots, blocks, unscheduled } = context;
    const examBlock = blocks.find((block) => block.type === "exam") ?? null;
    const extraTermSlots = Number(examBlock?.metadata.extraTermSlots ?? 0);
    if (extraTermSlots <= 0)
        return;
    const blockMap = buildBlockMap(blocks);
    const coreWindowEnd = Math.max(0, termSlots.length - 1);
    let remaining = extraTermSlots;
    const lessonExtensions = blocks
        .filter((block) => block.metadata.extraCandidateType === "lesson_extension")
        .sort(sequence_1.compareBlocksByCanonicalSequence);
    const ptExtensions = blocks
        .filter((block) => block.metadata.extraCandidateType === "pt_extension")
        .sort(sequence_1.compareBlocksByCanonicalSequence);
    const quizReviews = blocks
        .filter((block) => block.metadata.extraCandidateType === "review_before_quiz")
        .sort((a, b) => Number(a.metadata.targetQuizOrder ?? 0) - Number(b.metadata.targetQuizOrder ?? 0));
    const examReview = blocks.find((block) => block.metadata.extraCandidateType === "review_before_exam") ?? null;
    const extraWW = blocks.find((block) => block.metadata.extraCandidateType === "extra_written_work") ?? null;
    const extraPT = blocks.find((block) => block.metadata.extraCandidateType === "extra_performance_task") ?? null;
    if (remaining > 0 && examReview && unscheduled.has(examReview.id)) {
        const index = pickExtensionSlotIndex(termSlots, examReview, blockMap, 0, coreWindowEnd);
        if (index >= 0) {
            (0, slotState_1.addPlacement)(termSlots[index], examReview);
            unscheduled.delete(examReview.id);
            remaining -= 1;
        }
    }
    for (const review of quizReviews) {
        if (remaining <= 0 || !unscheduled.has(review.id))
            break;
        const quizOrder = Number(review.metadata.targetQuizOrder ?? 0);
        const quizId = blocks.find((block) => block.subcategory === "quiz" &&
            (0, sequence_1.isCanonicalSequenceMatch)(block, quizOrder))?.id;
        const quizIndex = quizId ? findPlacementIndex(termSlots, quizId) : -1;
        const endIndex = quizIndex > 0 ? quizIndex - 1 : coreWindowEnd;
        const index = pickExtensionSlotIndex(termSlots, review, blockMap, 0, endIndex);
        if (index >= 0) {
            (0, slotState_1.addPlacement)(termSlots[index], review);
            unscheduled.delete(review.id);
            remaining -= 1;
        }
    }
    for (const extension of lessonExtensions) {
        if (remaining <= 0 || !unscheduled.has(extension.id))
            break;
        const lessonOrder = (0, sequence_1.getCanonicalSequenceValue)(extension);
        const baseBlock = blocks.find((block) => block.type === "lesson" &&
            !block.metadata.extraCandidateType &&
            (0, sequence_1.isCanonicalSequenceMatch)(block, lessonOrder));
        const baseIndex = baseBlock ? findPlacementIndex(termSlots, baseBlock.id) : -1;
        const index = pickExtensionSlotIndex(termSlots, extension, blockMap, Math.max(0, baseIndex + 1), coreWindowEnd);
        if (index >= 0) {
            (0, slotState_1.addPlacement)(termSlots[index], extension);
            unscheduled.delete(extension.id);
            remaining -= 1;
        }
    }
    for (const extension of ptExtensions) {
        if (remaining <= 0 || !unscheduled.has(extension.id))
            break;
        const ptOrder = (0, sequence_1.getCanonicalSequenceValue)(extension);
        const baseBlock = blocks.find((block) => block.type === "performance_task" &&
            !block.metadata.extraCandidateType &&
            (0, sequence_1.isCanonicalSequenceMatch)(block, ptOrder));
        const baseIndex = baseBlock ? findPlacementIndex(termSlots, baseBlock.id) : -1;
        const index = pickExtensionSlotIndex(termSlots, extension, blockMap, Math.max(0, baseIndex + 1), coreWindowEnd);
        if (index >= 0) {
            (0, slotState_1.addPlacement)(termSlots[index], extension);
            unscheduled.delete(extension.id);
            remaining -= 1;
        }
    }
    if (remaining > 0 && extraWW && unscheduled.has(extraWW.id)) {
        const index = pickExtensionSlotIndex(termSlots, extraWW, blockMap, 0, coreWindowEnd);
        if (index >= 0) {
            (0, slotState_1.addPlacement)(termSlots[index], extraWW);
            unscheduled.delete(extraWW.id);
            remaining -= 1;
        }
    }
    if (remaining > 0 && extraPT && unscheduled.has(extraPT.id)) {
        const index = pickExtensionSlotIndex(termSlots, extraPT, blockMap, 0, coreWindowEnd);
        if (index >= 0) {
            (0, slotState_1.addPlacement)(termSlots[index], extraPT);
            unscheduled.delete(extraPT.id);
        }
    }
}
