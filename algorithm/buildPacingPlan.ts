import { Block, SessionSlot, ValidationIssue } from "./types";

export type PacingAnchor = {
  blockId: string;
  preferredSlotId: string;
  preferredDate: string;
  anchorType: "fixed" | "milestone" | "distributed";
};

export type PacingPlan = {
  majorBlockOrder: Block[];
  majorSlots: SessionSlot[];
  anchors: PacingAnchor[];
  validationIssues: ValidationIssue[];
};

export type BuildPacingPlanInput = {
  slots: SessionSlot[];
  blocks: Block[];
};

export type LessonComplexityInput = {
  title?: string | null;
  content?: string | null;
  learningObjectives?: string | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) ?? [];
}

function buildLessonAnalysisText(input: LessonComplexityInput): string {
  return [input.title, input.learningObjectives, input.content]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map(stripHtml)
    .join("\n");
}

function scoreWordCount(wordCount: number): number {
  if (wordCount >= 351) return 20;
  if (wordCount >= 181) return 15;
  if (wordCount >= 81) return 10;
  if (wordCount > 0) return 5;
  return 0;
}

function countMeaningfulSegments(text: string): number {
  if (!text.trim()) return 0;
  const normalized = text
    .replace(/[•●▪◦·]/g, "\n")
    .replace(/\b(?:and|with|plus|including)\b/gi, "|")
    .replace(/[;,/]/g, "|")
    .replace(/\n+/g, "|")
    .replace(/\b\d+\s*[\.\)]/g, "|");

  const rawSegments = normalized
    .split("|")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 4);

  let count = 0;
  for (const segment of rawSegments) {
    const words = tokenizeWords(segment);
    if (words.length >= 2 || segment.length >= 12) {
      count += 1;
    }
  }
  return count;
}

function scoreSubtopics(segmentCount: number): number {
  if (segmentCount >= 8) return 25;
  if (segmentCount >= 6) return 20;
  if (segmentCount >= 4) return 15;
  if (segmentCount >= 2) return 8;
  if (segmentCount >= 1) return 4;
  return 0;
}

function scoreTechnicalMarkers(text: string): number {
  const formulaSymbols = (text.match(/[=+\-/%^<>]/g) ?? []).length;
  const parenthesesWithVars = (text.match(/\(([a-z0-9,\s]+)\)/gi) ?? []).length;
  const acronyms = (text.match(/\b[A-Z]{2,}\b/g) ?? []).length;
  const enumeratedSteps = (text.match(/\b(step|phase|procedure|algorithm|method)\s+\d+\b/gi) ?? []).length;
  const greekOrMath = (text.match(/[α-ωΑ-ΩπΣΔ√∞≈≠≤≥]/g) ?? []).length;

  const rawScore =
    Math.min(6, formulaSymbols) +
    Math.min(3, parenthesesWithVars) +
    Math.min(2, acronyms) +
    Math.min(2, enumeratedSteps * 2) +
    Math.min(2, greekOrMath * 2);

  return clamp(rawScore, 0, 15);
}

function countKeywordHits(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((count, keyword) => count + (lower.includes(keyword) ? 1 : 0), 0);
}

function scoreCognitiveVerbs(text: string): number {
  const higherEffortKeywords = [
    "analyze",
    "compare",
    "differentiate",
    "derive",
    "solve",
    "interpret",
    "evaluate",
    "apply",
    "explain why",
    "investigate",
  ];
  const lowerEffortKeywords = [
    "define",
    "identify",
    "enumerate",
    "list",
    "recognize",
    "recall",
    "label",
    "name",
  ];

  const higherHits = countKeywordHits(text, higherEffortKeywords);
  const lowerHits = countKeywordHits(text, lowerEffortKeywords);
  const rawScore = higherHits * 5 + lowerHits * 2;
  return clamp(rawScore, 0, 25);
}

function scoreProcedureProblemSolving(text: string): number {
  const proceduralKeywords = [
    "solve",
    "compute",
    "calculate",
    "derive",
    "prove",
    "construct",
    "perform",
    "demonstrate",
    "simulate",
    "graph",
    "experiment",
  ];
  const hits = countKeywordHits(text, proceduralKeywords);
  return clamp(hits * 4, 0, 15);
}

export function deriveLessonComplexityScore(input: LessonComplexityInput): number {
  const text = buildLessonAnalysisText(input);
  if (!text) return 20;

  const wordCount = tokenizeWords(text).length;
  const subtopicCount = countMeaningfulSegments(text);
  const total =
    scoreWordCount(wordCount) +
    scoreSubtopics(subtopicCount) +
    scoreTechnicalMarkers(text) +
    scoreCognitiveVerbs(text) +
    scoreProcedureProblemSolving(text);

  return clamp(total, 0, 100);
}

export function complexityScoreToEstimatedMinutes(score: number): number {
  if (score <= 20) return 20;
  if (score <= 40) return 40;
  if (score <= 60) return 60;
  if (score <= 80) return 90;
  return 120;
}

export function complexityScoreToDifficulty(score: number): "light" | "medium" | "heavy" {
  if (score <= 40) return "light";
  if (score <= 70) return "medium";
  return "heavy";
}

function isMajorBlock(block: Block): boolean {
  return block.overlayMode === "major" || block.overlayMode === "exclusive";
}

function isOpenMajorSlot(slot: SessionSlot): boolean {
  return !slot.locked;
}

function sortSlots(slots: SessionSlot[]): SessionSlot[] {
  return [...slots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;

    const startCompare = (a.startTime ?? "").localeCompare(b.startTime ?? "");
    if (startCompare !== 0) return startCompare;

    return a.id.localeCompare(b.id);
  });
}

function blockPriority(block: Block): number {
  switch (block.type) {
    case "exam":
      return 100;
    case "performance_task":
      return 80;
    case "lesson":
      return 70;
    case "written_work":
      return block.subcategory === "quiz" ? 75 : 60;
    case "buffer":
      return block.subcategory === "review" ? 85 : 20;
    default:
      return 50;
  }
}

function topologicalSortMajorBlocks(blocks: Block[]): { ordered: Block[]; issues: ValidationIssue[] } {
  const majorBlocks = blocks.filter(isMajorBlock);
  const blockMap = new Map(majorBlocks.map((block) => [block.id, block]));
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const block of majorBlocks) {
    indegree.set(block.id, 0);
    adjacency.set(block.id, []);
  }

  for (const block of majorBlocks) {
    for (const dependencyId of block.dependencies) {
      if (!blockMap.has(dependencyId)) continue;
      adjacency.get(dependencyId)!.push(block.id);
      indegree.set(block.id, (indegree.get(block.id) ?? 0) + 1);
    }
  }

  const queue = majorBlocks
    .filter((block) => (indegree.get(block.id) ?? 0) === 0)
    .sort((a, b) => blockPriority(a) - blockPriority(b));

  const ordered: Block[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    ordered.push(current);

    for (const neighbor of adjacency.get(current.id) ?? []) {
      indegree.set(neighbor, (indegree.get(neighbor) ?? 0) - 1);
      if ((indegree.get(neighbor) ?? 0) === 0) {
        queue.push(blockMap.get(neighbor)!);
        queue.sort((a, b) => blockPriority(a) - blockPriority(b));
      }
    }
  }

  const issues: ValidationIssue[] = [];
  if (ordered.length !== majorBlocks.length) {
    const unsortedIds = majorBlocks
      .filter((block) => !ordered.some((orderedBlock) => orderedBlock.id === block.id))
      .map((block) => block.id);

    issues.push({
      code: "PACER_CYCLE_DETECTED",
      severity: "error",
      message: "Cycle detected among major blocks. Falling back to dependency-light order for some blocks.",
      relatedIds: unsortedIds,
    });

    const remaining = majorBlocks
      .filter((block) => !ordered.some((orderedBlock) => orderedBlock.id === block.id))
      .sort((a, b) => blockPriority(a) - blockPriority(b));

    ordered.push(...remaining);
  }

  return { ordered, issues };
}

function getBlockProgressRatio(index: number, total: number): number {
  if (total <= 1) return 0;
  return index / (total - 1);
}

function chooseDistributedSlotIndex(totalSlots: number, progressRatio: number): number {
  if (totalSlots <= 0) return 0;
  return Math.min(totalSlots - 1, Math.max(0, Math.round(progressRatio * (totalSlots - 1))));
}

function toDateValue(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1).getTime();
}

function findClosestSlotByDate(slots: SessionSlot[], preferredDate: string): SessionSlot | null {
  if (slots.length === 0) return null;

  let bestSlot: SessionSlot | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const preferredDateValue = toDateValue(preferredDate);

  for (const slot of slots) {
    const distance = Math.abs(toDateValue(slot.date) - preferredDateValue);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSlot = slot;
    }
  }

  return bestSlot;
}

function findSlotForBlock(
  block: Block,
  candidateSlots: SessionSlot[],
  progressRatio: number
): SessionSlot | null {
  if (candidateSlots.length === 0) {
    return null;
  }

  const typedSlots = candidateSlots.filter((slot) => {
    if (block.preferredSessionType === "any") return true;
    if (slot.sessionType === null) return true;
    if (slot.sessionType === "mixed") return true;
    return slot.sessionType === block.preferredSessionType;
  });

  const usableSlots = typedSlots.length > 0 ? typedSlots : candidateSlots;
  const preferredDate =
    typeof block.metadata?.preferredDate === "string" ? block.metadata.preferredDate : null;

  if (preferredDate) {
    return findClosestSlotByDate(usableSlots, preferredDate);
  }

  if (block.type === "exam" || (block.type === "buffer" && block.subcategory === "review")) {
    const distributedIndex = chooseDistributedSlotIndex(usableSlots.length, progressRatio);
    return usableSlots[distributedIndex] ?? usableSlots[usableSlots.length - 1] ?? null;
  }

  const distributedIndex = chooseDistributedSlotIndex(usableSlots.length, progressRatio);
  return usableSlots[distributedIndex] ?? usableSlots[0] ?? null;
}

function ensureReviewBeforeExamAnchors(
  anchors: PacingAnchor[],
  orderedBlocks: Block[],
  majorSlots: SessionSlot[]
): PacingAnchor[] {
  const anchorByBlockId = new Map(anchors.map((anchor) => [anchor.blockId, anchor]));
  const slotIndexById = new Map(majorSlots.map((slot, index) => [slot.id, index]));
  const updatedAnchors = [...anchors];

  for (const examBlock of orderedBlocks.filter((block) => block.type === "exam")) {
    const examAnchor = anchorByBlockId.get(examBlock.id);
    if (!examAnchor) continue;

    const examIndex = slotIndexById.get(examAnchor.preferredSlotId);
    if (examIndex === undefined) continue;

    const possibleReviewBlocks = orderedBlocks.filter(
      (block) =>
        block.type === "buffer" &&
        block.subcategory === "review" &&
        block.metadata?.targetExamTemplateId === examBlock.metadata?.examTemplateId
    );

    for (const reviewBlock of possibleReviewBlocks) {
      const currentReviewAnchor = anchorByBlockId.get(reviewBlock.id);
      const targetReviewIndex = Math.max(0, examIndex - 1);
      const targetSlot = majorSlots[targetReviewIndex];

      if (!targetSlot) continue;

      const updatedAnchor: PacingAnchor = {
        blockId: reviewBlock.id,
        preferredSlotId: targetSlot.id,
        preferredDate: targetSlot.date,
        anchorType: "fixed",
      };

      if (currentReviewAnchor) {
        const idx = updatedAnchors.findIndex((anchor) => anchor.blockId === reviewBlock.id);
        if (idx >= 0) updatedAnchors[idx] = updatedAnchor;
      } else {
        updatedAnchors.push(updatedAnchor);
      }
    }
  }

  return updatedAnchors;
}

export function buildPacingPlan(input: BuildPacingPlanInput): PacingPlan {
  const sortedSlots = sortSlots(input.slots);
  const majorSlots = sortedSlots.filter(isOpenMajorSlot);

  const { ordered, issues } = topologicalSortMajorBlocks(input.blocks);

  const anchors: PacingAnchor[] = [];

  ordered.forEach((block, index) => {
    const ratio = getBlockProgressRatio(index, ordered.length);
    const chosenSlot = findSlotForBlock(block, majorSlots, ratio);

    if (!chosenSlot) {
      return;
    }

    anchors.push({
      blockId: block.id,
      preferredSlotId: chosenSlot.id,
      preferredDate: chosenSlot.date,
      anchorType:
        block.type === "exam" || (block.type === "buffer" && block.subcategory === "review")
          ? "fixed"
          : "distributed",
    });
  });

  const anchorsWithReviews = ensureReviewBeforeExamAnchors(anchors, ordered, majorSlots);

  const anchoredBlockIds = new Set(anchorsWithReviews.map((anchor) => anchor.blockId));
  const unanchoredMajorBlocks = ordered.filter((block) => !anchoredBlockIds.has(block.id));

  const validationIssues: ValidationIssue[] = [...issues];

  if (majorSlots.length === 0) {
    validationIssues.push({
      code: "PACER_NO_OPEN_MAJOR_SLOTS",
      severity: "error",
      message: "No open major slots available for pacing.",
    });
  }

  if (unanchoredMajorBlocks.length > 0) {
    validationIssues.push({
      code: "PACER_UNANCHORED_MAJOR_BLOCKS",
      severity: "warning",
      message: "Some major blocks could not be assigned a preferred pacing anchor.",
      relatedIds: unanchoredMajorBlocks.map((block) => block.id),
    });
  }

  return {
    majorBlockOrder: ordered,
    majorSlots,
    anchors: anchorsWithReviews,
    validationIssues,
  };
}
