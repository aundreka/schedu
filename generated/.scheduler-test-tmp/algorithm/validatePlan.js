"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePlan = validatePlan;
function sortSlots(slots) {
    return [...slots].sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0)
            return dateCompare;
        const timeCompare = (a.startTime ?? "").localeCompare(b.startTime ?? "");
        if (timeCompare !== 0)
            return timeCompare;
        return a.id.localeCompare(b.id);
    });
}
function getUsedMinutes(slot) {
    return slot.placements.reduce((sum, placement) => sum + placement.minutesUsed, 0);
}
function getUtilizationRatio(slot) {
    if (slot.minutes <= 0)
        return 0;
    return getUsedMinutes(slot) / slot.minutes;
}
function buildBlockMap(blocks) {
    return new Map(blocks.map((block) => [block.id, block]));
}
function getPlacedBlockIds(slots) {
    return new Set(slots.flatMap((slot) => slot.placements.map((placement) => placement.blockId)));
}
function isRequiredLessonTOCUnit(unit) {
    return unit.required;
}
function isMeaningfulMajorInstructionSlot(slot, blockMap) {
    return slot.placements.some((placement) => {
        if (placement.lane !== "major")
            return false;
        const block = blockMap.get(placement.blockId);
        if (!block)
            return false;
        return (block.type === "lesson" ||
            (block.type === "written_work" && block.subcategory === "quiz") ||
            block.type === "performance_task" ||
            (block.type === "buffer" && (block.subcategory === "review" || block.subcategory === "orientation")) ||
            block.type === "exam");
    });
}
function getLongestEmptyOpenSlotRun(slots, blockMap) {
    let longest = 0;
    let current = 0;
    for (const slot of slots) {
        if (slot.locked) {
            current = 0;
            continue;
        }
        if (!isMeaningfulMajorInstructionSlot(slot, blockMap)) {
            current += 1;
            if (current > longest)
                longest = current;
        }
        else {
            current = 0;
        }
    }
    return longest;
}
function getRequiredLessonCoverage(tocUnits, blocks, placedBlockIds) {
    const requiredLessonUnits = tocUnits.filter(isRequiredLessonTOCUnit);
    const lessonBlocks = blocks.filter((block) => block.type === "lesson" && block.required && Boolean(block.sourceTocId));
    const generatedLessonSourceIds = new Set(lessonBlocks.map((block) => block.sourceTocId).filter(Boolean));
    const scheduledLessonSourceIds = new Set(lessonBlocks
        .filter((block) => placedBlockIds.has(block.id))
        .map((block) => block.sourceTocId)
        .filter(Boolean));
    const unscheduledRequiredLessonIds = requiredLessonUnits
        .filter((unit) => !scheduledLessonSourceIds.has(unit.id))
        .map((unit) => unit.id);
    return {
        totalRequiredLessons: requiredLessonUnits.length,
        generatedRequiredLessonBlocks: generatedLessonSourceIds.size,
        scheduledRequiredLessonBlocks: scheduledLessonSourceIds.size,
        unscheduledRequiredLessonIds,
    };
}
function countScheduledBlocksByType(blocks, placedBlockIds, type) {
    const matching = blocks.filter((block) => block.type === type && block.required);
    return {
        totalRequired: matching.length,
        scheduledRequired: matching.filter((block) => placedBlockIds.has(block.id)).length,
    };
}
function getMajorBlock(slot, blockMap) {
    const majorPlacement = slot.placements.find((placement) => placement.lane === "major");
    return majorPlacement ? blockMap.get(majorPlacement.blockId) ?? null : null;
}
function groupSlotsByTerm(slots) {
    const grouped = new Map();
    for (const slot of slots) {
        const key = slot.termIndex ?? 0;
        const current = grouped.get(key) ?? [];
        current.push(slot);
        grouped.set(key, current);
    }
    return Array.from(grouped.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([termIndex, termSlots]) => ({
        termIndex,
        slots: sortSlots(termSlots),
    }));
}
function validateTermShape(groupedTerms, blockMap, issues) {
    let orientationSatisfied = true;
    let lessonBeforeFinalQuizSatisfied = true;
    let compressionSignals = 0;
    let expansionSignals = 0;
    for (const term of groupedTerms) {
        const slots = term.slots;
        if (slots.length === 0)
            continue;
        let termCompressionSignals = 0;
        let termExpansionSignals = 0;
        const firstSlot = slots[0];
        const secondSlot = slots[1] ?? null;
        const lastSlot = slots[slots.length - 1];
        const firstMajor = getMajorBlock(firstSlot, blockMap);
        const secondMajor = secondSlot ? getMajorBlock(secondSlot, blockMap) : null;
        const lastMajor = getMajorBlock(lastSlot, blockMap);
        const examBlock = slots
            .map((slot) => getMajorBlock(slot, blockMap))
            .find((block) => block?.type === "exam") ?? null;
        const examAtLastSlot = lastMajor?.type === "exam";
        const examAnchoredToPreferredDate = examBlock?.type === "exam" &&
            examBlock.subcategory === "final" &&
            examBlock.metadata.anchoredSlot === "preferred_date";
        if (!examBlock) {
            issues.push({
                code: "VALIDATE_TERM_MISSING_EXAM",
                severity: "error",
                message: `Term ${term.termIndex + 1} is missing its exam block.`,
                relatedIds: slots.map((slot) => slot.id),
            });
        }
        else if (!examAtLastSlot && !examAnchoredToPreferredDate) {
            issues.push({
                code: "VALIDATE_TERM_MISSING_EXAM_AT_END",
                severity: "error",
                message: `Term ${term.termIndex + 1} does not end with an exam block.`,
                relatedIds: [lastSlot.id],
            });
        }
        if (term.termIndex === 0) {
            const hasOrientation = firstMajor?.type === "buffer" && firstMajor.subcategory === "orientation";
            const hasAnchoredFirstLesson = secondMajor?.type === "lesson" ||
                (slots.length === 1 && firstMajor?.type === "lesson");
            if (!hasOrientation || !hasAnchoredFirstLesson) {
                orientationSatisfied = false;
                issues.push({
                    code: "VALIDATE_FIRST_TERM_ORIENTATION_SEQUENCE",
                    severity: "error",
                    message: "The first term must start with orientation followed by the first lesson.",
                    relatedIds: [firstSlot.id, ...(secondSlot ? [secondSlot.id] : [])],
                });
            }
        }
        else {
            const firstLesson = getMajorBlock(firstSlot, blockMap);
            if (firstLesson?.type !== "lesson") {
                orientationSatisfied = false;
                issues.push({
                    code: "VALIDATE_TERM_START_FIRST_LESSON",
                    severity: "error",
                    message: `Term ${term.termIndex + 1} must begin with the first lesson of that term.`,
                    relatedIds: [firstSlot.id],
                });
            }
        }
        let finalQuizIndex = -1;
        let lastLessonIndex = -1;
        for (let index = 0; index < slots.length; index += 1) {
            const major = getMajorBlock(slots[index], blockMap);
            if (major?.type === "lesson")
                lastLessonIndex = index;
            if (major?.subcategory === "quiz")
                finalQuizIndex = index;
            const minorBlocks = slots[index].placements
                .map((placement) => blockMap.get(placement.blockId))
                .filter((block) => Boolean(block))
                .filter((block) => block.type === "written_work" || block.type === "performance_task");
            if (minorBlocks.some((block) => block.type === "written_work") &&
                major?.type === "lesson") {
                compressionSignals += 1;
                termCompressionSignals += 1;
            }
            if ((major?.metadata.lowPriority ?? false) ||
                minorBlocks.some((block) => Boolean(block.metadata.lowPriority))) {
                expansionSignals += 1;
                termExpansionSignals += 1;
            }
        }
        if (finalQuizIndex >= 0 && lastLessonIndex > finalQuizIndex) {
            lessonBeforeFinalQuizSatisfied = false;
            issues.push({
                code: "VALIDATE_LESSON_AFTER_FINAL_QUIZ",
                severity: "error",
                message: `Term ${term.termIndex + 1} has lessons after its final quiz.`,
                relatedIds: slots
                    .slice(finalQuizIndex, lastLessonIndex + 1)
                    .map((slot) => slot.id),
            });
        }
        const extraTermSlots = Number(examBlock?.metadata.extraTermSlots ?? 0);
        const futureDelayCount = Number(examBlock?.metadata.futureDelayCount ?? 0);
        if (extraTermSlots > 0 && termExpansionSignals === 0) {
            issues.push({
                code: "VALIDATE_EXPECTED_EXPANSION_NOT_FOUND",
                severity: "warning",
                message: `Term ${term.termIndex + 1} had spare slots but no low-priority expansion signals were found.`,
                relatedIds: slots.map((slot) => slot.id),
            });
        }
        if (extraTermSlots - futureDelayCount < 0 && termCompressionSignals === 0) {
            issues.push({
                code: "VALIDATE_EXPECTED_COMPRESSION_NOT_FOUND",
                severity: "warning",
                message: `Term ${term.termIndex + 1} appears compressed but no compression signal was found.`,
                relatedIds: slots.map((slot) => slot.id),
            });
        }
    }
    return {
        orientationSatisfied,
        lessonBeforeFinalQuizSatisfied,
        compressionSignals,
        expansionSignals,
    };
}
function validateExpectedTermStructure(groupedTerms, blocks, issues, expectedTermCount) {
    const examBlocks = blocks
        .filter((block) => block.type === "exam")
        .sort((a, b) => Number(a.metadata.termIndex ?? 0) - Number(b.metadata.termIndex ?? 0));
    const termCount = groupedTerms.length;
    const examCount = examBlocks.length;
    const expectedCount = expectedTermCount ?? (examCount || termCount);
    if (termCount !== expectedCount) {
        issues.push({
            code: "VALIDATE_TERM_COUNT_MISMATCH",
            severity: "error",
            message: `Expected ${expectedCount} term partitions but found ${termCount}.`,
            relatedIds: groupedTerms.flatMap((term) => term.slots.map((slot) => slot.id)),
        });
    }
    const examSubcategories = examBlocks.map((block) => block.subcategory);
    if (expectedCount === 2 &&
        examSubcategories.length === 2 &&
        (examSubcategories[0] !== "midterm" || examSubcategories[1] !== "final")) {
        issues.push({
            code: "VALIDATE_TWO_TERM_EXAM_ORDER",
            severity: "error",
            message: "Two-term plans must use midterm then final exam ordering.",
            relatedIds: examBlocks.map((block) => block.id),
        });
    }
    if (expectedCount === 3 &&
        examSubcategories.length === 3 &&
        (examSubcategories[0] !== "prelim" ||
            examSubcategories[1] !== "midterm" ||
            examSubcategories[2] !== "final")) {
        issues.push({
            code: "VALIDATE_THREE_TERM_EXAM_ORDER",
            severity: "error",
            message: "Three-term plans must use prelim, midterm, then final exam ordering.",
            relatedIds: examBlocks.map((block) => block.id),
        });
    }
    return {
        termCount,
        examCount,
    };
}
function validateExpectedDates(sortedSlots, blockMap, issues, expectedHolidayDates, expectedExamDates) {
    let holidayViolations = 0;
    const holidaySet = new Set(expectedHolidayDates ?? []);
    if (holidaySet.size > 0) {
        const violatingSlots = sortedSlots.filter((slot) => holidaySet.has(slot.date));
        holidayViolations = violatingSlots.length;
        if (violatingSlots.length > 0) {
            issues.push({
                code: "VALIDATE_HOLIDAY_SLOT_PRESENT",
                severity: "error",
                message: "Slots were generated on expected holiday dates.",
                relatedIds: violatingSlots.map((slot) => slot.id),
            });
        }
    }
    const examDates = expectedExamDates ?? [];
    for (const examDate of examDates) {
        const slotOnDate = sortedSlots.filter((slot) => slot.date === examDate);
        const hasExamOnDate = slotOnDate.some((slot) => {
            const major = getMajorBlock(slot, blockMap);
            return major?.type === "exam";
        });
        if (!hasExamOnDate) {
            issues.push({
                code: "VALIDATE_EXPECTED_EXAM_DATE_MISSING",
                severity: "error",
                message: `No exam block was found on expected exam date ${examDate}.`,
                relatedIds: slotOnDate.map((slot) => slot.id),
            });
        }
    }
    return {
        holidayViolations,
    };
}
function validateExpectedDelays(blocks, issues, expectedDelayCount) {
    if (expectedDelayCount === undefined)
        return;
    const totalFutureDelays = blocks
        .filter((block) => block.type === "exam")
        .reduce((sum, block) => sum + Number(block.metadata.futureDelayCount ?? 0), 0);
    if (totalFutureDelays > expectedDelayCount) {
        issues.push({
            code: "VALIDATE_DELAY_COUNT_OVERFLOW",
            severity: "warning",
            message: "Future delay metadata exceeds the expected delay count passed to validation.",
            relatedIds: blocks.filter((block) => block.type === "exam").map((block) => block.id),
        });
    }
}
function validateExactTermSlots(groupedTerms, blockMap, issues) {
    for (const term of groupedTerms) {
        const examBlock = term.slots
            .map((slot) => getMajorBlock(slot, blockMap))
            .find((block) => block?.type === "exam");
        if (!examBlock)
            continue;
        const rawTermSlotsFromMetadata = Number(examBlock.metadata.rawTermSlots ?? NaN);
        const initialDelayCount = Number(examBlock.metadata.initialDelayCount ?? 0);
        const termSlotsFromMetadata = Number(examBlock.metadata.termSlots ?? NaN);
        const actualRawTermSlots = term.slots.length;
        const orientationAdjustment = term.termIndex === 0 &&
            (() => {
                const firstBlock = getMajorBlock(term.slots[0], blockMap);
                return firstBlock?.type === "buffer" && firstBlock.subcategory === "orientation";
            })()
            ? 1
            : 0;
        const computedTermSlots = actualRawTermSlots - initialDelayCount - orientationAdjustment;
        if (Number.isFinite(rawTermSlotsFromMetadata) &&
            rawTermSlotsFromMetadata !== actualRawTermSlots) {
            issues.push({
                code: "VALIDATE_RAW_TERM_SLOT_COUNT_MISMATCH",
                severity: "error",
                message: `Term ${term.termIndex + 1} raw slot count does not match exam metadata.`,
                relatedIds: term.slots.map((slot) => slot.id),
            });
        }
        if (Number.isFinite(termSlotsFromMetadata) &&
            termSlotsFromMetadata !== computedTermSlots) {
            issues.push({
                code: "VALIDATE_TERM_SLOT_COUNT_MISMATCH",
                severity: "error",
                message: `Term ${term.termIndex + 1} termSlots must equal raw term slots minus initial delays${orientationAdjustment ? " and orientation" : ""}.`,
                relatedIds: term.slots.map((slot) => slot.id),
            });
        }
    }
}
function expectedBlockTitle(block) {
    if (block.type === "lesson") {
        const order = Number(block.metadata.globalLessonOrder ?? block.metadata.lessonOrder ?? NaN);
        return Number.isFinite(order) && order > 0 ? `L${order}` : null;
    }
    if (block.type === "written_work" && block.subcategory !== "quiz") {
        const order = Number(block.metadata.wwOrder ?? NaN);
        return Number.isFinite(order) && order > 0 ? `WW${order}` : null;
    }
    if (block.type === "performance_task") {
        const order = Number(block.metadata.ptOrder ?? NaN);
        return Number.isFinite(order) && order > 0 ? `PT${order}` : null;
    }
    if (block.type === "written_work" && block.subcategory === "quiz") {
        const order = Number(block.metadata.quizOrder ?? NaN);
        return Number.isFinite(order) && order > 0 ? `Q${order}` : null;
    }
    return null;
}
function validateBlockTitlesAndOrder(blocks, issues) {
    const orderChecks = [
        {
            code: "VALIDATE_LESSON_TITLE_ORDER",
            type: "lesson",
            matcher: (block) => block.type === "lesson" && !block.metadata.extraCandidateType,
            orderKey: "globalLessonOrder",
            label: "lesson",
        },
        {
            code: "VALIDATE_WW_TITLE_ORDER",
            type: "written_work",
            matcher: (block) => block.type === "written_work" &&
                block.subcategory !== "quiz" &&
                !block.metadata.extraCandidateType,
            orderKey: "wwOrder",
            label: "written work",
        },
        {
            code: "VALIDATE_PT_TITLE_ORDER",
            type: "performance_task",
            matcher: (block) => block.type === "performance_task" && !block.metadata.extraCandidateType,
            orderKey: "ptOrder",
            label: "performance task",
        },
        {
            code: "VALIDATE_QUIZ_TITLE_ORDER",
            type: "written_work",
            matcher: (block) => block.type === "written_work" && block.subcategory === "quiz",
            orderKey: "quizOrder",
            label: "quiz",
        },
    ];
    for (const check of orderChecks) {
        const matching = blocks
            .filter(check.matcher)
            .sort((a, b) => Number(a.metadata[check.orderKey] ?? 0) - Number(b.metadata[check.orderKey] ?? 0) ||
            a.id.localeCompare(b.id));
        for (let index = 0; index < matching.length; index += 1) {
            const block = matching[index];
            const expectedOrder = index + 1;
            const actualOrder = Number(block.metadata[check.orderKey] ?? 0);
            if (actualOrder !== expectedOrder) {
                issues.push({
                    code: check.code,
                    severity: "error",
                    message: `Global ${check.label} ordering must be sequential across terms.`,
                    relatedIds: [block.id],
                });
            }
            const expectedTitle = expectedBlockTitle(block);
            if (expectedTitle && block.title.trim() !== expectedTitle) {
                issues.push({
                    code: `${check.code}_TITLE`,
                    severity: "error",
                    message: `${check.label} titles must use acronym numbering like ${expectedTitle}.`,
                    relatedIds: [block.id],
                });
            }
        }
    }
}
function validatePlan(input) {
    const { slots, blocks, tocUnits, emptyGapThreshold = 4, underutilizedSlotThreshold = 0.5, expectedHolidayDates, expectedExamDates, expectedTermCount, expectedDelayCount, } = input;
    const sortedSlots = sortSlots(slots);
    const blockMap = buildBlockMap(blocks);
    const placedBlockIds = getPlacedBlockIds(sortedSlots);
    const groupedTerms = groupSlotsByTerm(sortedSlots);
    const totalSlots = sortedSlots.length;
    const lockedSlots = sortedSlots.filter((slot) => slot.locked).length;
    const openSlots = totalSlots - lockedSlots;
    const emptyOpenSlots = sortedSlots.filter((slot) => !slot.locked && slot.placements.length === 0).length;
    const underutilizedOpenSlots = sortedSlots.filter((slot) => !slot.locked &&
        slot.placements.length > 0 &&
        getUtilizationRatio(slot) < underutilizedSlotThreshold).length;
    const totalMinutes = sortedSlots.reduce((sum, slot) => sum + slot.minutes, 0);
    const usedMinutes = sortedSlots.reduce((sum, slot) => sum + getUsedMinutes(slot), 0);
    const utilizationRate = totalMinutes > 0 ? usedMinutes / totalMinutes : 0;
    const longestEmptyOpenSlotRun = getLongestEmptyOpenSlotRun(sortedSlots, blockMap);
    const lessonCoverage = getRequiredLessonCoverage(tocUnits, blocks, placedBlockIds);
    const ptCounts = countScheduledBlocksByType(blocks, placedBlockIds, "performance_task");
    const wwCounts = countScheduledBlocksByType(blocks, placedBlockIds, "written_work");
    const validationIssues = [];
    if (lessonCoverage.generatedRequiredLessonBlocks < lessonCoverage.totalRequiredLessons) {
        validationIssues.push({
            code: "VALIDATE_MISSING_GENERATED_LESSON_BLOCKS",
            severity: "error",
            message: "Not every required TOC lesson was converted into a lesson block.",
            relatedIds: lessonCoverage.unscheduledRequiredLessonIds,
        });
    }
    if (lessonCoverage.unscheduledRequiredLessonIds.length > 0) {
        validationIssues.push({
            code: "VALIDATE_UNSCHEDULED_REQUIRED_LESSONS",
            severity: "error",
            message: "Some required lessons from the table of contents were not scheduled.",
            relatedIds: lessonCoverage.unscheduledRequiredLessonIds,
        });
    }
    if (ptCounts.scheduledRequired < ptCounts.totalRequired) {
        validationIssues.push({
            code: "VALIDATE_UNSCHEDULED_REQUIRED_PTS",
            severity: "warning",
            message: "Some required performance tasks were not scheduled.",
            relatedIds: blocks
                .filter((block) => block.type === "performance_task" &&
                block.required &&
                !placedBlockIds.has(block.id))
                .map((block) => block.id),
        });
    }
    if (wwCounts.scheduledRequired < wwCounts.totalRequired) {
        validationIssues.push({
            code: "VALIDATE_UNSCHEDULED_REQUIRED_WW",
            severity: "warning",
            message: "Some required written work blocks were not scheduled.",
            relatedIds: blocks
                .filter((block) => block.type === "written_work" &&
                block.required &&
                !placedBlockIds.has(block.id))
                .map((block) => block.id),
        });
    }
    if (emptyOpenSlots > 0) {
        validationIssues.push({
            code: "VALIDATE_EMPTY_OPEN_SLOTS",
            severity: emptyOpenSlots > Math.max(1, Math.floor(openSlots * 0.1)) ? "warning" : "info",
            message: "There are open slots with no placements.",
            relatedIds: sortedSlots
                .filter((slot) => !slot.locked && slot.placements.length === 0)
                .map((slot) => slot.id),
        });
    }
    if (underutilizedOpenSlots > Math.max(1, Math.floor(openSlots * 0.15))) {
        validationIssues.push({
            code: "VALIDATE_UNDERUTILIZED_OPEN_SLOTS",
            severity: "info",
            message: "There are several placed slots with low utilization.",
            relatedIds: sortedSlots
                .filter((slot) => !slot.locked &&
                slot.placements.length > 0 &&
                getUtilizationRatio(slot) < underutilizedSlotThreshold)
                .map((slot) => slot.id),
        });
    }
    if (longestEmptyOpenSlotRun >= emptyGapThreshold) {
        validationIssues.push({
            code: "VALIDATE_LONG_EMPTY_SLOT_RUN",
            severity: "warning",
            message: "There is a long run of empty open instructional slots.",
            relatedIds: sortedSlots
                .filter((slot) => !slot.locked && slot.placements.length === 0)
                .map((slot) => slot.id),
        });
    }
    const { termCount, examCount } = validateExpectedTermStructure(groupedTerms, blocks, validationIssues, expectedTermCount);
    const { orientationSatisfied, lessonBeforeFinalQuizSatisfied, compressionSignals, expansionSignals, } = validateTermShape(groupedTerms, blockMap, validationIssues);
    const { holidayViolations } = validateExpectedDates(sortedSlots, blockMap, validationIssues, expectedHolidayDates, expectedExamDates);
    validateExpectedDelays(blocks, validationIssues, expectedDelayCount);
    validateExactTermSlots(groupedTerms, blockMap, validationIssues);
    validateBlockTitlesAndOrder(blocks, validationIssues);
    return {
        validationIssues,
        metrics: {
            totalSlots,
            openSlots,
            lockedSlots,
            emptyOpenSlots,
            underutilizedOpenSlots,
            totalRequiredLessons: lessonCoverage.totalRequiredLessons,
            generatedRequiredLessonBlocks: lessonCoverage.generatedRequiredLessonBlocks,
            scheduledRequiredLessonBlocks: lessonCoverage.scheduledRequiredLessonBlocks,
            unscheduledRequiredLessonIds: lessonCoverage.unscheduledRequiredLessonIds,
            totalRequiredPerformanceTasks: ptCounts.totalRequired,
            scheduledRequiredPerformanceTasks: ptCounts.scheduledRequired,
            totalRequiredWrittenWorks: wwCounts.totalRequired,
            scheduledRequiredWrittenWorks: wwCounts.scheduledRequired,
            utilizationRate,
            longestEmptyOpenSlotRun,
            termCount,
            examCount,
            orientationSatisfied,
            lessonBeforeFinalQuizSatisfied,
            holidayViolations,
            compressionSignals,
            expansionSignals,
        },
    };
}
