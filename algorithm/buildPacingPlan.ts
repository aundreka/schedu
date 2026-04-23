import type {
  Difficulty,
  ExamBlockTemplate,
  PacingPlan,
  SessionSlot,
  TOCUnit,
  TeacherRules,
  TermKey,
  TermLessonAllocation,
} from "./types";

export function deriveLessonComplexityScore(input: {
  title?: string | null;
  content?: string | null;
  learningObjectives?: string | null;
}) {
  const combined = `${input.title ?? ""} ${input.content ?? ""} ${input.learningObjectives ?? ""}`.trim();
  if (!combined) return 2;
  const wordCount = combined.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 120) return 5;
  if (wordCount >= 70) return 4;
  if (wordCount >= 30) return 3;
  if (wordCount >= 10) return 2;
  return 1;
}

export function complexityScoreToDifficulty(score: number): Difficulty {
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "easy";
}

export function complexityScoreToEstimatedMinutes(score: number) {
  if (score >= 5) return 120;
  if (score >= 4) return 90;
  if (score >= 3) return 75;
  if (score >= 2) return 60;
  return 45;
}

export type BuildPacingPlanInput = {
  slots: SessionSlot[];
  tocUnits: TOCUnit[];
  teacherRules: TeacherRules;
  examBlockTemplates: ExamBlockTemplate[];
  initialDelayDates?: string[];
};

const TERM_KEY_BY_COUNT: Record<number, TermKey[]> = {
  1: ["final"],
  2: ["midterm", "final"],
  3: ["prelim", "midterm", "final"],
};

function sumDifficulty(units: TOCUnit[]) {
  return units.reduce((sum, unit) => sum + difficultyWeight(unit.difficulty), 0);
}

function difficultyWeight(difficulty: Difficulty) {
  if (difficulty === "high") return 3;
  if (difficulty === "medium") return 2;
  return 1;
}

function allocateRemainderToTail(base: number[], remainder: number) {
  const next = [...base];
  for (let index = 0; index < remainder; index += 1) {
    const target = next.length - 1 - (index % next.length);
    next[target] += 1;
  }
  return next;
}

function buildTermKeys(termCount: number): TermKey[] {
  return TERM_KEY_BY_COUNT[termCount] ?? TERM_KEY_BY_COUNT[3];
}

function distributeLessonsWithoutChapters(tocUnits: TOCUnit[], termCount: number) {
  const sorted = [...tocUnits].sort((a, b) => a.order - b.order);
  const baseTarget = Math.floor(sorted.length / termCount);
  const remainder = sorted.length % termCount;
  const targets = allocateRemainderToTail(new Array(termCount).fill(baseTarget), remainder);
  const allocations: TOCUnit[][] = new Array(termCount).fill(null).map(() => []);

  let cursor = 0;
  for (let termIndex = 0; termIndex < termCount; termIndex += 1) {
    const take = targets[termIndex] ?? 0;
    allocations[termIndex] = sorted.slice(cursor, cursor + take);
    cursor += take;
  }

  return allocations;
}

function distributeLessonsByChapter(tocUnits: TOCUnit[], termCount: number) {
  const sorted = [...tocUnits].sort((a, b) => a.order - b.order);
  const hasChapterStructure = sorted.some((unit) => unit.chapterId);
  if (!hasChapterStructure) {
    return distributeLessonsWithoutChapters(sorted, termCount);
  }

  const chapterGroups: TOCUnit[][] = [];
  for (const unit of sorted) {
    const lastGroup = chapterGroups[chapterGroups.length - 1];
    if (!lastGroup || lastGroup[0]?.chapterId !== unit.chapterId) {
      chapterGroups.push([unit]);
    } else {
      lastGroup.push(unit);
    }
  }

  const baseTarget = Math.floor(sorted.length / termCount);
  const remainder = sorted.length % termCount;
  const targets = allocateRemainderToTail(new Array(termCount).fill(baseTarget), remainder);
  const allocations: TOCUnit[][] = new Array(termCount).fill(null).map(() => []);

  let termIndex = 0;
  for (const group of chapterGroups) {
    const current = allocations[termIndex];
    const nextTarget = targets[termIndex] ?? 0;
    const shouldAdvance =
      termIndex < termCount - 1 &&
      current.length > 0 &&
      current.length + group.length > nextTarget &&
      allocations.slice(termIndex + 1).reduce((sum, list) => sum + list.length, 0) < sorted.length - current.length;

    if (shouldAdvance) termIndex += 1;
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

function buildQuizPlan(termLessons: number, termSlots: number, difficulty: Difficulty) {
  let termQuizAmount = 0;
  let lessonInterval = 1;

  if (termLessons > 5) {
    termQuizAmount = Math.floor(termLessons / 3);
    lessonInterval = 3;
  } else if (termLessons > 3) {
    termQuizAmount = Math.floor(termLessons / 2);
    lessonInterval = 2;
  } else if (termLessons < 4) {
    if (difficulty === "easy") {
      termQuizAmount = Math.min(2, Math.max(1, Math.floor(termLessons / 2) || 1));
      lessonInterval = 2;
    } else {
      termQuizAmount = Math.max(1, Math.floor(termLessons));
      lessonInterval = 1;
    }
  }

  if (termSlots < termLessons + 3) {
    termQuizAmount = Math.min(termQuizAmount, 1);
  }

  return {
    termQuizAmount,
    lessonInterval: Math.max(1, lessonInterval),
  };
}

function getTermLabel(termKey: TermKey) {
  if (termKey === "prelim") return "Prelim";
  if (termKey === "midterm") return "Midterm";
  return "Final";
}

export function buildPacingPlan(input: BuildPacingPlanInput): PacingPlan {
  const sortedSlots = [...input.slots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });

  const initialDelayDateSet = new Set(
    (input.initialDelayDates ?? []).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
  );
  const termCount = Math.max(1, input.examBlockTemplates.length || 1);
  const termKeys = buildTermKeys(termCount);
  const lessonsByTerm = distributeLessonsByChapter(input.tocUnits, termCount);

  const totalWW = Math.max(0, input.teacherRules.minWW ?? 0);
  const totalPT = Math.max(0, input.teacherRules.minPT ?? 0);
  const wwBase = Math.floor(totalWW / termCount);
  const ptBase = Math.floor(totalPT / termCount);
  const wwCounts = allocateRemainderToTail(new Array(termCount).fill(wwBase), totalWW % termCount);
  const ptCounts = allocateRemainderToTail(new Array(termCount).fill(ptBase), totalPT % termCount);

  const slotsByTerm = new Map<number, SessionSlot[]>();
  for (const slot of sortedSlots) {
    const key = slot.termIndex ?? 0;
    const current = slotsByTerm.get(key) ?? [];
    current.push(slot);
    slotsByTerm.set(key, current);
  }

  const terms: TermLessonAllocation[] = termKeys.map((termKey, termIndex) => {
    const termSlotsRaw = [...(slotsByTerm.get(termIndex) ?? [])];
    const initialDelayCount = termSlotsRaw.filter((slot) => initialDelayDateSet.has(slot.date)).length;
    const hasOrientation = termIndex === 0 && termSlotsRaw.length > 0;
    const rawTermSlots = termSlotsRaw.length;
    const termSlots = Math.max(0, rawTermSlots - initialDelayCount - (hasOrientation ? 1 : 0));
    const tocUnits = lessonsByTerm[termIndex] ?? [];
    const averageDifficultyWeight =
      tocUnits.length > 0 ? sumDifficulty(tocUnits) / tocUnits.length : 2;
    const difficulty: Difficulty =
      averageDifficultyWeight >= 2.5 ? "high" : averageDifficultyWeight >= 1.5 ? "medium" : "easy";
    const { termQuizAmount, lessonInterval } = buildQuizPlan(tocUnits.length, termSlots, difficulty);
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
