import { buildPacingPlan } from "./buildPacingPlan";
import type {
  Block,
  ExamBlockTemplate,
  PacingPlan,
  SessionSlot,
  SessionSubcategory,
  TeacherRules,
  TOCUnit,
} from "./types";

export type BuildBlocksInput = {
  courseId: string;
  tocUnits: TOCUnit[];
  teacherRules: TeacherRules;
  examBlockTemplates: ExamBlockTemplate[];
  slots?: SessionSlot[];
  initialDelayDates?: string[];
};

const PT_SUBCATEGORIES: Extract<SessionSubcategory, "activity" | "lab_report" | "reporting">[] = [
  "activity",
  "lab_report",
  "reporting",
];

const WW_SUBCATEGORIES: Extract<SessionSubcategory, "assignment" | "seatwork">[] = [
  "assignment",
  "seatwork",
];

function difficultyWeight(difficulty: TOCUnit["difficulty"]) {
  if (difficulty === "high") return 3;
  if (difficulty === "medium") return 2;
  return 1;
}

function makeId(prefix: string, ...parts: (string | number)[]) {
  return [prefix, ...parts].join("__").replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function groupSlotsByTerm(slots: SessionSlot[]) {
  const grouped = new Map<number, SessionSlot[]>();
  for (const slot of slots) {
    const key = slot.termIndex ?? 0;
    const current = grouped.get(key) ?? [];
    current.push(slot);
    grouped.set(key, current);
  }
  return grouped;
}

function countLabShare(termSlots: SessionSlot[]) {
  if (termSlots.length === 0) return 0;
  const labLike = termSlots.filter(
    (slot) => slot.sessionType === "laboratory" || slot.sessionType === "mixed"
  ).length;
  return labLike / termSlots.length;
}

function buildChapterEndingLessonOrders(tocUnits: TOCUnit[]) {
  const endingOrders = new Set<number>();
  for (let index = 0; index < tocUnits.length; index += 1) {
    const current = tocUnits[index]!;
    const next = tocUnits[index + 1];
    if (!next || next.chapterId !== current.chapterId) {
      endingOrders.add(index + 1);
    }
  }
  return endingOrders;
}

function pickBalancedPerformanceTaskSubtype(input: {
  counts: Record<string, number>;
  termSlots: SessionSlot[];
  termLessons: TOCUnit[];
  ptOrder: number;
  chapterEndingOrders: Set<number>;
}): Extract<SessionSubcategory, "activity" | "lab_report" | "reporting"> {
  const { counts, termSlots, termLessons, ptOrder, chapterEndingOrders } = input;
  const labShare = countLabShare(termSlots);
  const anchorIndex =
    termLessons.length === 0
      ? 0
      : Math.min(
          termLessons.length - 1,
          Math.max(0, Math.floor(((ptOrder - 0.5) / Math.max(1, counts.__targetTotal ?? 1)) * termLessons.length))
        );
  const anchorLesson = termLessons[anchorIndex] ?? null;
  const anchorDifficulty = difficultyWeight(anchorLesson?.difficulty ?? "medium");
  const anchorOrder = anchorIndex + 1;
  const nearChapterEnd = chapterEndingOrders.has(anchorOrder) || chapterEndingOrders.has(anchorOrder + 1);

  let best = PT_SUBCATEGORIES[0]!;
  let bestScore = -Infinity;
  for (const subtype of PT_SUBCATEGORIES) {
    const countPenalty = counts[subtype] ?? 0;
    let score = -countPenalty * 10;
    if (subtype === "lab_report") score += labShare * 8 + (anchorLesson?.preferredSessionType === "laboratory" ? 5 : 0);
    if (subtype === "reporting") score += (anchorDifficulty >= 3 ? 7 : 0) + (nearChapterEnd ? 4 : 0);
    if (subtype === "activity") score += anchorDifficulty <= 2 ? 3 : 0;
    if (score > bestScore) {
      best = subtype;
      bestScore = score;
    }
  }

  counts[best] = (counts[best] ?? 0) + 1;
  return best;
}

function pickBalancedWrittenWorkSubtype(input: {
  counts: Record<string, number>;
  termLessons: TOCUnit[];
  wwOrder: number;
}): Extract<SessionSubcategory, "assignment" | "seatwork"> {
  const { counts, termLessons, wwOrder } = input;
  const anchorIndex =
    termLessons.length === 0
      ? 0
      : Math.min(
          termLessons.length - 1,
          Math.max(0, Math.floor(((wwOrder - 0.5) / Math.max(1, counts.__targetTotal ?? 1)) * termLessons.length))
        );
  const anchorLesson = termLessons[anchorIndex] ?? null;
  const anchorDifficulty = difficultyWeight(anchorLesson?.difficulty ?? "medium");

  let best = WW_SUBCATEGORIES[0]!;
  let bestScore = -Infinity;
  for (const subtype of WW_SUBCATEGORIES) {
    const countPenalty = counts[subtype] ?? 0;
    let score = -countPenalty * 10;
    if (subtype === "assignment") score += anchorDifficulty >= 2 ? 4 : 0;
    if (subtype === "seatwork") score += anchorDifficulty <= 2 ? 4 : 0;
    if (score > bestScore) {
      best = subtype;
      bestScore = score;
    }
  }

  counts[best] = (counts[best] ?? 0) + 1;
  return best;
}

function buildQuizCoverage(termLessons: TOCUnit[], lessonInterval: number, quizOrder: number, quizCount: number) {
  const endOrder =
    quizOrder === quizCount
      ? termLessons.length
      : Math.min(termLessons.length, lessonInterval * quizOrder);
  const startOrder =
    quizOrder === 1 ? 1 : Math.min(endOrder, Math.max(1, lessonInterval * (quizOrder - 1) + 1));
  const coveredLessons = termLessons.slice(startOrder - 1, endOrder);
  const weights = coveredLessons.map((lesson) => difficultyWeight(lesson.difficulty));
  const maxComplexity = weights.length > 0 ? Math.max(...weights) : 1;
  const averageComplexity =
    weights.length > 0 ? weights.reduce((sum, value) => sum + value, 0) / weights.length : 1;
  const sameDifficulty = weights.every((value) => value === weights[0]);
  const endsChapter =
    coveredLessons.length > 0 &&
    (() => {
      const last = coveredLessons[coveredLessons.length - 1]!;
      const next = termLessons[endOrder] ?? null;
      return !next || next.chapterId !== last.chapterId;
    })();
  const unresolvedHardRegionCount = termLessons
    .slice(endOrder)
    .filter((lesson) => difficultyWeight(lesson.difficulty) >= 3).length;
  const chapterBoundaryWeight = sameDifficulty && endsChapter ? 1 : 0;

  return {
    startOrder,
    endOrder,
    coveredLessons,
    maxComplexity,
    averageComplexity,
    unresolvedHardRegionCount,
    chapterBoundaryWeight,
  };
}

function toPacingPlan(input: BuildBlocksInput): PacingPlan {
  return buildPacingPlan({
    slots: input.slots ?? [],
    tocUnits: input.tocUnits,
    teacherRules: input.teacherRules,
    examBlockTemplates: input.examBlockTemplates,
    initialDelayDates: input.initialDelayDates,
  });
}

export function buildBlocks(input: BuildBlocksInput): Block[] {
  const pacingPlan = toPacingPlan(input);
  const blocks: Block[] = [];
  const slotsByTerm = groupSlotsByTerm(input.slots ?? []);
  let globalLessonOrder = 0;
  let globalPtOrder = 0;
  let globalWwOrder = 0;
  let globalQuizOrder = 0;

  for (const term of pacingPlan.terms) {
    const termPrefix = `${term.termKey}_${term.termIndex + 1}`;
    const termSlots = slotsByTerm.get(term.termIndex) ?? [];
    const chapterEndingOrders = buildChapterEndingLessonOrders(term.tocUnits);
    const ptSubtypeCounts: Record<string, number> = { __targetTotal: term.termPT };
    const nonQuizWrittenWorkCount = Math.max(0, term.termWW - term.termQuizAmount);
    const wwSubtypeCounts: Record<string, number> = { __targetTotal: nonQuizWrittenWorkCount };
    const termWwOffset = globalWwOrder;

    if (term.hasOrientation) {
      blocks.push({
        id: makeId("buffer", input.courseId, termPrefix, "orientation"),
        courseId: input.courseId,
        type: "buffer",
        subcategory: "orientation",
        title: "Orientation",
        estimatedMinutes: 60,
        required: true,
        splittable: false,
        overlayMode: "exclusive",
        preferredSessionType: "any",
        dependencies: [],
        metadata: {
          termIndex: term.termIndex,
          termKey: term.termKey,
          anchoredSlot: "term_start",
          lowPriority: false,
        },
      });
    }

    term.tocUnits.forEach((lesson, lessonIndex) => {
      const lessonOrder = lessonIndex + 1;
      const globalOrder = globalLessonOrder + lessonIndex + 1;
      blocks.push({
        id: makeId("lesson", input.courseId, termPrefix, lesson.id),
        courseId: input.courseId,
        type: "lesson",
        subcategory: lesson.preferredSessionType === "laboratory" ? "laboratory" : "lecture",
        title: `L${globalOrder}`,
        sourceTocId: lesson.id,
        estimatedMinutes: Math.max(30, lesson.estimatedMinutes),
        required: lesson.required,
        splittable: false,
        overlayMode: "major",
        preferredSessionType: lesson.preferredSessionType,
        dependencies: [],
        metadata: {
          termIndex: term.termIndex,
          termKey: term.termKey,
          lessonOrder,
          globalLessonOrder: globalOrder,
          lessonTitle: lesson.title,
          lessonDifficulty: lesson.difficulty,
          lessonInterval: term.lessonInterval,
          highComplexity: lesson.difficulty === "high",
          isFirstLessonOfTerm: lessonOrder === 1,
          anchoredSlot:
            lessonOrder === 1
              ? term.termIndex === 0
                ? "first_term_second_slot"
                : "term_start"
              : null,
        },
      });
    });
    globalLessonOrder += term.tocUnits.length;

    for (let index = 0; index < term.termPT; index += 1) {
      const ptOrder = globalPtOrder + index + 1;
      const subcategory = pickBalancedPerformanceTaskSubtype({
        counts: ptSubtypeCounts,
        termSlots,
        termLessons: term.tocUnits,
        ptOrder: index + 1,
        chapterEndingOrders,
      });
      blocks.push({
        id: makeId("pt", input.courseId, termPrefix, index + 1),
        courseId: input.courseId,
        type: "performance_task",
        subcategory,
        title: `PT${ptOrder}`,
        estimatedMinutes: 60,
        required: true,
        splittable: false,
        overlayMode: "major",
        preferredSessionType: subcategory === "lab_report" ? "laboratory" : "any",
        dependencies: [],
        metadata: {
          termIndex: term.termIndex,
          termKey: term.termKey,
          ptOrder,
          lowPriority: false,
        },
      });
    }
    globalPtOrder += term.termPT;

    for (let index = 0; index < nonQuizWrittenWorkCount; index += 1) {
      const wwOrder = termWwOffset + index + 1;
      const subcategory = pickBalancedWrittenWorkSubtype({
        counts: wwSubtypeCounts,
        termLessons: term.tocUnits,
        wwOrder: index + 1,
      });
      blocks.push({
        id: makeId("ww", input.courseId, termPrefix, index + 1),
        courseId: input.courseId,
        type: "written_work",
        subcategory,
        title: `WW${wwOrder}`,
        estimatedMinutes: 30,
        required: true,
        splittable: false,
        overlayMode: "minor",
        preferredSessionType: "any",
        dependencies: [],
        metadata: {
          termIndex: term.termIndex,
          termKey: term.termKey,
          wwOrder,
          lowPriority: false,
        },
      });
    }
    globalWwOrder += term.termWW;

    for (let index = 0; index < term.termQuizAmount; index += 1) {
      const quizOrder = globalQuizOrder + index + 1;
      const wwOrder = termWwOffset + nonQuizWrittenWorkCount + index + 1;
      const coverage = buildQuizCoverage(
        term.tocUnits,
        term.lessonInterval,
        index + 1,
        term.termQuizAmount
      );

      blocks.push({
        id: makeId("quiz", input.courseId, termPrefix, index + 1),
        courseId: input.courseId,
        type: "written_work",
        subcategory: "quiz",
        title: `Q${quizOrder}`,
        estimatedMinutes: 30,
        required: true,
        splittable: false,
        overlayMode: "major",
        preferredSessionType: "any",
        dependencies: [],
        metadata: {
          termIndex: term.termIndex,
          termKey: term.termKey,
          globalWwOrder: wwOrder,
          quizOrder,
          termQuizOrder: index + 1,
          afterLessonOrder: coverage.endOrder,
          lessonInterval: term.lessonInterval,
          coveredLessonStartOrder: coverage.startOrder,
          coveredLessonEndOrder: coverage.endOrder,
          coveredLessonOrders: coverage.coveredLessons.map((_, coveredIndex) => coverage.startOrder + coveredIndex),
          coveredLessonIds: coverage.coveredLessons.map((lesson) => lesson.id),
          quizMaxDifficulty: coverage.maxComplexity,
          quizAverageDifficulty: coverage.averageComplexity,
          unresolvedHardRegionCount: coverage.unresolvedHardRegionCount,
          chapterBoundaryWeight: coverage.chapterBoundaryWeight,
          lowPriority: false,
        },
        });
      }
      globalQuizOrder += term.termQuizAmount;

      if (term.extraTermSlots > 0) {
      blocks.push({
        id: makeId("buffer", input.courseId, termPrefix, "review_before_exam"),
        courseId: input.courseId,
        type: "buffer",
        subcategory: "review",
        title: `${term.label} Review`,
        estimatedMinutes: 30,
        required: false,
        splittable: false,
        overlayMode: "major",
        preferredSessionType: "any",
        dependencies: [],
        metadata: {
          termIndex: term.termIndex,
          termKey: term.termKey,
          extraCandidateType: "review_before_exam",
          lowPriority: true,
        },
      });

      for (let quizIndex = 0; quizIndex < term.termQuizAmount; quizIndex += 1) {
        const targetQuizOrder = globalQuizOrder - term.termQuizAmount + quizIndex + 1;
        const linkedQuizCoverage = buildQuizCoverage(
          term.tocUnits,
          term.lessonInterval,
          quizIndex + 1,
          term.termQuizAmount
        );
        blocks.push({
          id: makeId("buffer", input.courseId, termPrefix, "review_before_quiz", quizIndex + 1),
          courseId: input.courseId,
          type: "buffer",
          subcategory: "review",
          title: `Q${targetQuizOrder} Review`,
          estimatedMinutes: 30,
          required: false,
          splittable: false,
          overlayMode: "major",
          preferredSessionType: "any",
          dependencies: [],
          metadata: {
            termIndex: term.termIndex,
            termKey: term.termKey,
            extraCandidateType: "review_before_quiz",
            targetQuizOrder,
            quizMaxDifficulty: linkedQuizCoverage.maxComplexity,
            quizAverageDifficulty: linkedQuizCoverage.averageComplexity,
            unresolvedHardRegionCount: linkedQuizCoverage.unresolvedHardRegionCount,
            chapterBoundaryWeight: linkedQuizCoverage.chapterBoundaryWeight,
            lowPriority: true,
          },
        });
      }

      term.tocUnits.forEach((lesson, lessonIndex) => {
        blocks.push({
          id: makeId("lesson_extension", input.courseId, termPrefix, lesson.id),
          courseId: input.courseId,
          type: "lesson",
          subcategory: lesson.preferredSessionType === "laboratory" ? "laboratory" : "lecture",
          title: `L${globalLessonOrder - term.tocUnits.length + lessonIndex + 1} Extension`,
          sourceTocId: lesson.id,
          estimatedMinutes: Math.max(15, Math.floor(Math.max(30, lesson.estimatedMinutes) / 2)),
          required: false,
          splittable: false,
          overlayMode: "major",
          preferredSessionType: lesson.preferredSessionType,
          dependencies: [],
          metadata: {
            termIndex: term.termIndex,
            termKey: term.termKey,
            extraCandidateType: "lesson_extension",
            lessonOrder: lessonIndex + 1,
            globalLessonOrder: globalLessonOrder - term.tocUnits.length + lessonIndex + 1,
            highComplexity: lesson.difficulty === "high",
            lowPriority: true,
          },
        });
      });

      for (let index = 0; index < term.termPT; index += 1) {
        const ptOrder = globalPtOrder - term.termPT + index + 1;
        const subcategory = pickBalancedPerformanceTaskSubtype({
          counts: { activity: 0, lab_report: 0, reporting: 0, __targetTotal: Math.max(1, term.termPT) },
          termSlots,
          termLessons: term.tocUnits,
          ptOrder: index + 1,
          chapterEndingOrders,
        });
        blocks.push({
          id: makeId("pt_extension", input.courseId, termPrefix, index + 1),
          courseId: input.courseId,
          type: "performance_task",
          subcategory,
          title: `PT${ptOrder} Extension`,
          estimatedMinutes: 30,
          required: false,
          splittable: false,
          overlayMode: "major",
          preferredSessionType: subcategory === "lab_report" ? "laboratory" : "any",
          dependencies: [],
          metadata: {
            termIndex: term.termIndex,
            termKey: term.termKey,
            extraCandidateType: "pt_extension",
            ptOrder,
            prioritizeReporting: subcategory === "reporting",
            lowPriority: true,
          },
        });
      }

      blocks.push({
        id: makeId("ww_extra", input.courseId, termPrefix, "extra"),
        courseId: input.courseId,
        type: "written_work",
        subcategory: pickBalancedWrittenWorkSubtype({
          counts: { assignment: 0, seatwork: 0, __targetTotal: 1 },
          termLessons: term.tocUnits,
          wwOrder: Math.max(1, term.termWW + 1),
        }),
        title: "Additional Written Work",
        estimatedMinutes: 30,
        required: false,
        splittable: false,
        overlayMode: "minor",
        preferredSessionType: "any",
        dependencies: [],
        metadata: {
          termIndex: term.termIndex,
          termKey: term.termKey,
          extraCandidateType: "extra_written_work",
          lowPriority: true,
        },
      });

      blocks.push({
        id: makeId("pt_extra", input.courseId, termPrefix, "extra"),
        courseId: input.courseId,
        type: "performance_task",
        subcategory: pickBalancedPerformanceTaskSubtype({
          counts: { activity: 0, lab_report: 0, reporting: 0, __targetTotal: 1 },
          termSlots,
          termLessons: term.tocUnits,
          ptOrder: Math.max(1, term.termPT + 1),
          chapterEndingOrders,
        }),
        title: "Additional Performance Task",
        estimatedMinutes: 45,
        required: false,
        splittable: false,
        overlayMode: "major",
        preferredSessionType: "any",
        dependencies: [],
        metadata: {
          termIndex: term.termIndex,
          termKey: term.termKey,
          extraCandidateType: "extra_performance_task",
          lowPriority: true,
        },
      });
    }

    const examTemplate = input.examBlockTemplates[term.termIndex] ?? input.examBlockTemplates[input.examBlockTemplates.length - 1];
    if (examTemplate) {
      blocks.push({
        id: makeId("exam", input.courseId, termPrefix, examTemplate.id),
        courseId: input.courseId,
        type: "exam",
        subcategory: examTemplate.subcategory,
        title: examTemplate.title,
        estimatedMinutes: examTemplate.estimatedMinutes,
        required: examTemplate.required,
        splittable: false,
        overlayMode: "exclusive",
        preferredSessionType: "any",
        dependencies: [],
        metadata: {
          termIndex: term.termIndex,
          termKey: term.termKey,
          anchoredSlot:
            examTemplate.subcategory === "final" && examTemplate.preferredDate
              ? "preferred_date"
              : "term_end",
          preferredDate: examTemplate.preferredDate ?? null,
          rawTermSlots: term.rawTermSlots,
          initialDelayCount: term.initialDelayCount,
          termSlots: term.termSlots,
          extraTermSlots: term.extraTermSlots,
          futureDelayCount: 0,
          lessonInterval: term.lessonInterval,
          termLessons: term.termLessons,
          termPT: term.termPT,
          termWW: term.termWW,
          termQuizAmount: term.termQuizAmount,
          lowPriority: false,
        },
      });
    }
  }

  return blocks;
}
