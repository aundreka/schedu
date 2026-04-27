"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveLessonComplexityScore = deriveLessonComplexityScore;
exports.complexityScoreToDifficulty = complexityScoreToDifficulty;
exports.complexityScoreToEstimatedMinutes = complexityScoreToEstimatedMinutes;
exports.buildPacingPlan = buildPacingPlan;
function deriveLessonComplexityScore(input) {
    const combined = `${input.title ?? ""} ${input.content ?? ""} ${input.learningObjectives ?? ""}`.trim();
    if (!combined)
        return 2;
    const wordCount = combined.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 120)
        return 5;
    if (wordCount >= 70)
        return 4;
    if (wordCount >= 30)
        return 3;
    if (wordCount >= 10)
        return 2;
    return 1;
}
function complexityScoreToDifficulty(score) {
    if (score >= 4)
        return "high";
    if (score >= 2)
        return "medium";
    return "easy";
}
function complexityScoreToEstimatedMinutes(score) {
    if (score >= 5)
        return 120;
    if (score >= 4)
        return 90;
    if (score >= 3)
        return 75;
    if (score >= 2)
        return 60;
    return 45;
}
const TERM_KEY_BY_COUNT = {
    1: ["final"],
    2: ["midterm", "final"],
    3: ["prelim", "midterm", "final"],
};
function sumDifficulty(units) {
    return units.reduce((sum, unit) => sum + difficultyWeight(unit.difficulty), 0);
}
function difficultyWeight(difficulty) {
    if (difficulty === "high")
        return 3;
    if (difficulty === "medium")
        return 2;
    return 1;
}
function allocateRemainderToTail(base, remainder) {
    const next = [...base];
    for (let index = 0; index < remainder; index += 1) {
        const target = next.length - 1 - (index % next.length);
        next[target] += 1;
    }
    return next;
}
function buildTermKeys(termCount) {
    return TERM_KEY_BY_COUNT[termCount] ?? TERM_KEY_BY_COUNT[3];
}
function distributeLessonsWithoutChapters(tocUnits, termCount) {
    const sorted = [...tocUnits].sort((a, b) => a.order - b.order);
    const baseTarget = Math.floor(sorted.length / termCount);
    const remainder = sorted.length % termCount;
    const targets = allocateRemainderToTail(new Array(termCount).fill(baseTarget), remainder);
    const allocations = new Array(termCount).fill(null).map(() => []);
    let cursor = 0;
    for (let termIndex = 0; termIndex < termCount; termIndex += 1) {
        const take = targets[termIndex] ?? 0;
        allocations[termIndex] = sorted.slice(cursor, cursor + take);
        cursor += take;
    }
    return allocations;
}
function distributeLessonsByChapter(tocUnits, termCount) {
    const sorted = [...tocUnits].sort((a, b) => a.order - b.order);
    const hasChapterStructure = sorted.some((unit) => unit.chapterId);
    if (!hasChapterStructure) {
        return distributeLessonsWithoutChapters(sorted, termCount);
    }
    const chapterGroups = [];
    for (const unit of sorted) {
        const lastGroup = chapterGroups[chapterGroups.length - 1];
        if (!lastGroup || lastGroup[0]?.chapterId !== unit.chapterId) {
            chapterGroups.push([unit]);
        }
        else {
            lastGroup.push(unit);
        }
    }
    const baseTarget = Math.floor(sorted.length / termCount);
    const remainder = sorted.length % termCount;
    const targets = allocateRemainderToTail(new Array(termCount).fill(baseTarget), remainder);
    const allocations = new Array(termCount).fill(null).map(() => []);
    let termIndex = 0;
    for (const group of chapterGroups) {
        const current = allocations[termIndex];
        const nextTarget = targets[termIndex] ?? 0;
        const shouldAdvance = termIndex < termCount - 1 &&
            current.length > 0 &&
            current.length + group.length > nextTarget &&
            allocations.slice(termIndex + 1).reduce((sum, list) => sum + list.length, 0) < sorted.length - current.length;
        if (shouldAdvance)
            termIndex += 1;
        allocations[termIndex].push(...group);
        if (allocations[termIndex].length >= (targets[termIndex] ?? 0) && termIndex < termCount - 1) {
            termIndex += 1;
        }
    }
    const flattenedCount = allocations.reduce((sum, list) => sum + list.length, 0);
    if (flattenedCount !== sorted.length) {
        return distributeLessonsWithoutChapters(sorted, termCount);
    }
    return allocations;
}
function partitionLessonCountIntoQuizGroups(termLessons) {
    if (termLessons < 2)
        return [];
    const quizCount = Math.ceil(termLessons / 3);
    const groups = new Array(quizCount).fill(2);
    let remaining = termLessons - quizCount * 2;
    for (let index = groups.length - 1; index >= 0 && remaining > 0; index -= 1) {
        groups[index] += 1;
        remaining -= 1;
    }
    return groups;
}
function buildQuizPlan(tocUnits, termIndex, termSlots, difficulty) {
    let lessonGroups = partitionLessonCountIntoQuizGroups(tocUnits.length);
    if (termSlots < tocUnits.length + lessonGroups.length + 1 && lessonGroups.length > 1) {
        // When slot pressure is high, keep coverage explicit but prefer fewer quizzes.
        const collapsed = [];
        for (const size of lessonGroups) {
            if (collapsed.length === 0) {
                collapsed.push(size);
                continue;
            }
            const current = collapsed[collapsed.length - 1];
            if (current + size <= 3) {
                collapsed[collapsed.length - 1] = current + size;
            }
            else {
                collapsed.push(size);
            }
        }
        lessonGroups = collapsed.every((size) => size >= 2 && size <= 3) ? collapsed : lessonGroups;
    }
    if (lessonGroups.length === 0 && tocUnits.length > 0 && difficulty !== "easy") {
        lessonGroups = [tocUnits.length];
    }
    const quizCoverages = [];
    let cursor = 0;
    lessonGroups.forEach((groupSize) => {
        const coveredLessons = tocUnits.slice(cursor, cursor + groupSize);
        if (coveredLessons.length < 2 || coveredLessons.length > 3) {
            cursor += coveredLessons.length;
            return;
        }
        const lessonOrders = coveredLessons.map((_, lessonIndex) => cursor + lessonIndex + 1);
        quizCoverages.push({
            termIndex,
            lessonIds: coveredLessons.map((lesson) => lesson.id),
            lessonOrders,
            startLessonOrder: lessonOrders[0] ?? 0,
            endLessonOrder: lessonOrders[lessonOrders.length - 1] ?? 0,
            lessonCount: coveredLessons.length,
        });
        cursor += coveredLessons.length;
    });
    return {
        termQuizAmount: quizCoverages.length,
        lessonInterval: quizCoverages.length > 0
            ? Math.max(...quizCoverages.map((coverage) => coverage.lessonCount))
            : Math.max(1, Math.min(3, tocUnits.length || 1)),
        quizCoverages,
    };
}
function getTermLabel(termKey) {
    if (termKey === "prelim")
        return "Prelim";
    if (termKey === "midterm")
        return "Midterm";
    return "Final";
}
function buildPacingPlan(input) {
    const sortedSlots = [...input.slots].sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0)
            return dateCompare;
        return (a.startTime ?? "").localeCompare(b.startTime ?? "");
    });
    const initialDelayDateSet = new Set((input.initialDelayDates ?? []).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)));
    const termCount = Math.max(1, input.examBlockTemplates.length || 1);
    const termKeys = buildTermKeys(termCount);
    const lessonsByTerm = distributeLessonsByChapter(input.tocUnits, termCount);
    const totalWW = Math.max(0, input.teacherRules.minWW ?? 0);
    const totalPT = Math.max(0, input.teacherRules.minPT ?? 0);
    const wwBase = Math.floor(totalWW / termCount);
    const ptBase = Math.floor(totalPT / termCount);
    const wwCounts = allocateRemainderToTail(new Array(termCount).fill(wwBase), totalWW % termCount);
    const ptCounts = allocateRemainderToTail(new Array(termCount).fill(ptBase), totalPT % termCount);
    const slotsByTerm = new Map();
    for (const slot of sortedSlots) {
        const key = slot.termIndex ?? 0;
        const current = slotsByTerm.get(key) ?? [];
        current.push(slot);
        slotsByTerm.set(key, current);
    }
    const terms = termKeys.map((termKey, termIndex) => {
        const termSlotsRaw = [...(slotsByTerm.get(termIndex) ?? [])];
        const initialDelayCount = termSlotsRaw.filter((slot) => initialDelayDateSet.has(slot.date)).length;
        const hasOrientation = termIndex === 0 && termSlotsRaw.length > 0;
        const rawTermSlots = termSlotsRaw.length;
        const termSlots = Math.max(0, rawTermSlots - initialDelayCount - (hasOrientation ? 1 : 0));
        const tocUnits = lessonsByTerm[termIndex] ?? [];
        const averageDifficultyWeight = tocUnits.length > 0 ? sumDifficulty(tocUnits) / tocUnits.length : 2;
        const difficulty = averageDifficultyWeight >= 2.5 ? "high" : averageDifficultyWeight >= 1.5 ? "medium" : "easy";
        const { termQuizAmount, lessonInterval, quizCoverages } = buildQuizPlan(tocUnits, termIndex, termSlots, difficulty);
        const termWW = wwCounts[termIndex] ?? 0;
        const termPT = ptCounts[termIndex] ?? 0;
        const extraTermSlots = termSlots - (tocUnits.length + termWW + termPT + termQuizAmount + 1);
        const firstSlot = termSlotsRaw[0] ?? null;
        const lastSlot = termSlotsRaw[termSlotsRaw.length - 1] ?? null;
        return {
            termIndex,
            termKey,
            label: getTermLabel(termKey),
            tocUnits,
            rawTermSlots,
            initialDelayCount,
            termLessons: tocUnits.length,
            termWW,
            termPT,
            termQuizAmount,
            lessonInterval,
            quizCoverages,
            termSlots,
            extraTermSlots,
            startDate: firstSlot?.date ?? null,
            endDate: lastSlot?.date ?? null,
            examDate: input.examBlockTemplates[termIndex]?.preferredDate ?? lastSlot?.date ?? null,
            hasOrientation,
        };
    });
    const totalSlots = terms.reduce((sum, term) => sum + term.termSlots, 0);
    return {
        totalSlots,
        lessonCount: input.tocUnits.length,
        termCount,
        minWrittenWorks: totalWW,
        minPerformanceTasks: totalPT,
        terms,
    };
}
