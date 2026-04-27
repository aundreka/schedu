"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCanonicalSequenceValue = getCanonicalSequenceValue;
exports.getCanonicalIdentity = getCanonicalIdentity;
exports.compareBlocksByCanonicalSequence = compareBlocksByCanonicalSequence;
exports.isCanonicalSequenceMatch = isCanonicalSequenceMatch;
exports.compareBlocksByCanonicalSequenceWithPriority = compareBlocksByCanonicalSequenceWithPriority;
function matchOrder(title, pattern) {
    return title.match(pattern)?.[1] ?? 0;
}
function getCanonicalSequenceValue(input) {
    const metadata = input.metadata ?? {};
    const title = (input.title ?? "").trim();
    if (input.type === "lesson") {
        return Number(metadata.globalLessonOrder ??
            metadata.lessonOrder ??
            matchOrder(title, /(?:^L|lesson\s*)(\d+)$/i) ??
            0);
    }
    if (input.type === "performance_task") {
        return Number(metadata.globalPtOrder ??
            metadata.ptOrder ??
            matchOrder(title, /(?:^PT|performance\s*task\s*)(\d+)/i) ??
            0);
    }
    if (input.type === "written_work" && input.subcategory === "quiz") {
        return Number(metadata.globalQuizOrder ??
            metadata.quizOrder ??
            matchOrder(title, /(?:^|:\s*)(?:Q|quiz\s*)(\d+)/i) ??
            0);
    }
    if (input.type === "written_work") {
        return Number(metadata.globalWwOrder ??
            metadata.wwOrder ??
            matchOrder(title, /(?:^WW|written\s*work\s*)(\d+)/i) ??
            0);
    }
    return 0;
}
function getCanonicalIdentity(input) {
    const metadata = input.metadata ?? {};
    const title = (input.title ?? "").trim();
    const extraCandidateType = typeof metadata.extraCandidateType === "string" ? metadata.extraCandidateType : null;
    const canonicalSequence = getCanonicalSequenceValue(input);
    if (input.type === "lesson") {
        if (extraCandidateType) {
            return canonicalSequence > 0
                ? `lesson|extra|${extraCandidateType}|${canonicalSequence}`
                : `lesson|extra|${extraCandidateType}|${input.sourceTocId ?? input.lessonId ?? title.toLowerCase()}`;
        }
        if (canonicalSequence > 0)
            return `lesson|order|${canonicalSequence}`;
        const source = input.sourceTocId ??
            input.lessonId ??
            (typeof metadata.sourceTocId === "string" ? metadata.sourceTocId : null) ??
            null;
        return source ? `lesson|source|${source}` : null;
    }
    if (input.type === "written_work" && input.subcategory === "quiz") {
        return canonicalSequence > 0 ? `quiz|${canonicalSequence}` : null;
    }
    if (input.type === "written_work") {
        if (extraCandidateType) {
            return canonicalSequence > 0
                ? `ww|extra|${extraCandidateType}|${canonicalSequence}`
                : `ww|extra|${extraCandidateType}`;
        }
        return canonicalSequence > 0 ? `ww|${canonicalSequence}` : null;
    }
    if (input.type === "performance_task") {
        if (extraCandidateType) {
            return canonicalSequence > 0
                ? `pt|extra|${extraCandidateType}|${canonicalSequence}`
                : `pt|extra|${extraCandidateType}`;
        }
        return canonicalSequence > 0 ? `pt|${canonicalSequence}` : null;
    }
    if (input.type === "exam") {
        const termKey = typeof metadata.termKey === "string" ? metadata.termKey : String(metadata.termIndex ?? "");
        return `exam|${termKey}|${input.subcategory ?? ""}`;
    }
    if (input.type === "buffer") {
        return `buffer|${String(metadata.extraCandidateType ?? input.subcategory ?? "")}|${String(metadata.targetQuizOrder ?? "")}|${String(metadata.termIndex ?? "")}`;
    }
    return null;
}
function compareBlocksByCanonicalSequence(a, b) {
    const sequenceDiff = getCanonicalSequenceValue(a) - getCanonicalSequenceValue(b);
    if (sequenceDiff !== 0)
        return sequenceDiff;
    return String(a.title ?? "").localeCompare(String(b.title ?? ""));
}
function isCanonicalSequenceMatch(block, targetSequence) {
    return getCanonicalSequenceValue(block) === targetSequence;
}
function compareBlocksByCanonicalSequenceWithPriority(a, b, priority) {
    const priorityDiff = priority(a) - priority(b);
    if (priorityDiff !== 0)
        return priorityDiff;
    return compareBlocksByCanonicalSequence(a, b);
}
