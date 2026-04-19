import { Block, SessionSubcategory, TeacherRules, TOCUnit } from "./types";

export type ExamBlockTemplate = {
  id: string;
  title: string;
  estimatedMinutes: number;
  subcategory?: Extract<SessionSubcategory, "prelim" | "midterm" | "final">;
  preferredDate?: string | null;
  required?: boolean;
};

export type BuildBlocksInput = {
  courseId: string;
  tocUnits: TOCUnit[];
  teacherRules: TeacherRules;
  examBlockTemplates?: ExamBlockTemplate[];
};

function sortTOCUnits(tocUnits: TOCUnit[]): TOCUnit[] {
  return [...tocUnits].sort((a, b) => a.order - b.order);
}

function getPreferredSessionType(unit: TOCUnit): Block["preferredSessionType"] {
  return unit.preferredSessionType ?? "any";
}

function getDifficulty(unit: TOCUnit): NonNullable<TOCUnit["difficulty"]> {
  return unit.difficulty ?? "medium";
}

function isLabPreferred(unit: TOCUnit): boolean {
  return unit.preferredSessionType === "laboratory";
}

function lessonBlockId(unitId: string): string {
  return `block__lesson__${unitId}`;
}

function writtenWorkBlockId(unitId: string, index: number): string {
  return `block__ww__${unitId}__${index}`;
}

function quizChapterBlockId(chapterId: string): string {
  return `block__quiz__chapter__${chapterId}`;
}

function quizIntervalBlockId(index: number): string {
  return `block__quiz__interval__${index}`;
}

function ptBlockId(index: number): string {
  return `block__pt__${index}`;
}

function ptPrepBlockId(index: number): string {
  return `block__pt_prep__${index}`;
}

function reviewBlockId(index: number): string {
  return `block__review__${index}`;
}

function bufferBlockId(index: number): string {
  return `block__buffer__${index}`;
}

function examBlockId(templateId: string): string {
  return `block__exam__${templateId}`;
}

function createLessonBlock(unit: TOCUnit): Block {
  const lessonSubcategory = isLabPreferred(unit) ? "laboratory" : "lecture";

  return {
    id: lessonBlockId(unit.id),
    courseId: unit.courseId,
    type: "lesson",
    subcategory: lessonSubcategory,
    title: unit.title,
    sourceTocId: unit.id,
    estimatedMinutes: unit.estimatedMinutes,
    minMinutes: Math.max(15, Math.floor(unit.estimatedMinutes * 0.75)),
    maxMinutes: Math.max(unit.estimatedMinutes, Math.ceil(unit.estimatedMinutes * 1.5)),
    required: unit.required,
    splittable: unit.estimatedMinutes > 90,
    overlayMode: "major",
    preferredSessionType: getPreferredSessionType(unit),
    dependencies: [],
    metadata: {
      chapterId: unit.chapterId ?? null,
      chapterTitle: unit.chapterTitle ?? null,
      difficulty: getDifficulty(unit),
      tocOrder: unit.order,
    },
  };
}

function getWrittenWorkSubtype(unit: TOCUnit): Extract<SessionSubcategory, "assignment" | "seatwork"> {
  const difficulty = getDifficulty(unit);
  if (difficulty === "light") return "seatwork";
  return "assignment";
}

function createWrittenWorkBlock(unit: TOCUnit, index: number, sequenceLabel?: string): Block {
  const difficulty = getDifficulty(unit);
  const subtype = getWrittenWorkSubtype(unit);
  const titleBySubtype: Record<typeof subtype, string> = {
    assignment: difficulty === "heavy" ? "Assignment / Reflection" : "Written Work",
    seatwork: "Seatwork",
  };

  const estimatedMinutes =
    difficulty === "light" ? 15 : difficulty === "heavy" ? 30 : 20;

  return {
    id: writtenWorkBlockId(unit.id, index),
    courseId: unit.courseId,
    type: "written_work",
    subcategory: subtype,
    title: `${titleBySubtype[subtype]}: ${unit.title}${sequenceLabel ? ` (${sequenceLabel})` : ""}`,
    sourceTocId: unit.id,
    estimatedMinutes,
    minMinutes: 10,
    maxMinutes: 45,
    required: unit.required,
    splittable: false,
    overlayMode: "minor",
    preferredSessionType: "any",
    dependencies: [lessonBlockId(unit.id)],
    metadata: {
      linkedLessonBlockId: lessonBlockId(unit.id),
      chapterId: unit.chapterId ?? null,
      chapterTitle: unit.chapterTitle ?? null,
      difficulty,
      sequence: index,
    },
  };
}

function createWrittenWorkBlocks(
  units: TOCUnit[],
  teacherRules: TeacherRules
): Block[] {
  const target = Math.max(0, teacherRules.writtenWorkTarget);
  if (target === 0 || units.length === 0) {
    return [];
  }

  if (teacherRules.writtenWorkMode === "per_lesson") {
    return units.flatMap((unit) =>
      Array.from({ length: target }, (_, index) =>
        createWrittenWorkBlock(unit, index + 1, target > 1 ? String(index + 1) : undefined)
      )
    );
  }

  return Array.from({ length: target }, (_, index) => {
    const ratio = target === 1 ? 0 : index / (target - 1);
    const unitIndex = Math.min(
      units.length - 1,
      Math.max(0, Math.round(ratio * (units.length - 1)))
    );
    const unit = units[unitIndex];
    return createWrittenWorkBlock(unit, index + 1, `Plan ${index + 1}`);
  });
}

function groupUnitsByChapter(units: TOCUnit[]): Map<string, TOCUnit[]> {
  const chapterMap = new Map<string, TOCUnit[]>();

  for (const unit of units) {
    const key = unit.chapterId ?? `chapterless__${unit.id}`;
    const existing = chapterMap.get(key) ?? [];
    existing.push(unit);
    chapterMap.set(key, existing);
  }

  return chapterMap;
}

function createChapterQuizBlock(courseId: string, chapterId: string, units: TOCUnit[]): Block {
  const ordered = [...units].sort((a, b) => a.order - b.order);
  const chapterTitle =
    ordered[0]?.chapterTitle ??
    (chapterId.startsWith("chapterless__") ? "Standalone Topic" : `Chapter ${chapterId}`);

  return {
    id: quizChapterBlockId(chapterId),
    courseId,
    type: "written_work",
    subcategory: "quiz",
    title: `Quiz: ${chapterTitle}`,
    estimatedMinutes: 30,
    minMinutes: 15,
    maxMinutes: 60,
    required: true,
    splittable: false,
    overlayMode: "major",
    preferredSessionType: "lecture",
    dependencies: ordered.map((unit) => lessonBlockId(unit.id)),
    metadata: {
      chapterId,
      chapterTitle,
      basedOn: "chapter_completion",
      lessonCount: ordered.length,
    },
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

function createIntervalQuizBlocks(
  courseId: string,
  units: TOCUnit[],
  teacherRules: TeacherRules
): Block[] {
  if (teacherRules.quizMode === "per_chapter") {
    return [];
  }

  const interval = Math.max(1, teacherRules.quizEveryNLessons ?? 3);
  const chunks = chunkArray(units, interval);

  return chunks.map((chunk, index) => {
    const start = chunk[0];
    const end = chunk[chunk.length - 1];

    return {
      id: quizIntervalBlockId(index + 1),
      courseId,
      type: "written_work",
      subcategory: "quiz",
      title: `Quiz: Lessons ${start.order}-${end.order}`,
      estimatedMinutes: 30,
      minMinutes: 15,
      maxMinutes: 60,
      required: true,
      splittable: false,
      overlayMode: "major",
      preferredSessionType: "lecture",
      dependencies: chunk.map((unit) => lessonBlockId(unit.id)),
      metadata: {
        basedOn: "lesson_interval",
        interval,
        lessonOrders: chunk.map((unit) => unit.order),
        sourceLessonIds: chunk.map((unit) => unit.id),
      },
    };
  });
}

function pickPerformanceTaskAnchorUnits(units: TOCUnit[], performanceTaskMin: number): TOCUnit[] {
  if (units.length === 0 || performanceTaskMin <= 0) return [];

  const anchors: TOCUnit[] = [];
  for (let i = 1; i <= performanceTaskMin; i += 1) {
    const ratio = i / (performanceTaskMin + 1);
    const index = Math.min(units.length - 1, Math.max(0, Math.round(ratio * (units.length - 1))));
    anchors.push(units[index]);
  }

  return anchors;
}

function createPerformanceTaskBlocks(courseId: string, units: TOCUnit[], performanceTaskMin: number): Block[] {
  const anchorUnits = pickPerformanceTaskAnchorUnits(units, performanceTaskMin);
  const blocks: Block[] = [];

  anchorUnits.forEach((unit, index) => {
    const taskNumber = index + 1;
    const difficulty = getDifficulty(unit);
    const prepMinutes = difficulty === "heavy" ? 45 : difficulty === "light" ? 20 : 30;
    const ptMinutes = difficulty === "heavy" ? 120 : difficulty === "light" ? 45 : 90;
    const linkedLessonId = lessonBlockId(unit.id);

    blocks.push({
      id: ptPrepBlockId(taskNumber),
      courseId,
      type: "buffer",
      subcategory: "preparation",
      title: `PT Prep ${taskNumber}: ${unit.title}`,
      sourceTocId: unit.id,
      estimatedMinutes: prepMinutes,
      minMinutes: 15,
      maxMinutes: 60,
      required: true,
      splittable: false,
      overlayMode: "minor",
      preferredSessionType: "any",
      dependencies: [linkedLessonId],
      metadata: {
        linkedLessonBlockId: linkedLessonId,
        performanceTaskNumber: taskNumber,
        chapterId: unit.chapterId ?? null,
      },
    });

    blocks.push({
      id: ptBlockId(taskNumber),
      courseId,
      type: "performance_task",
      subcategory: getPreferredSessionType(unit) === "laboratory" ? "lab_report" : "activity",
      title: `Performance Task ${taskNumber}: ${unit.title}`,
      sourceTocId: unit.id,
      estimatedMinutes: ptMinutes,
      minMinutes: Math.max(30, Math.floor(ptMinutes * 0.75)),
      maxMinutes: Math.max(ptMinutes, Math.ceil(ptMinutes * 1.5)),
      required: true,
      splittable: ptMinutes > 90,
      overlayMode: "major",
      preferredSessionType: getPreferredSessionType(unit),
      dependencies: [linkedLessonId, ptPrepBlockId(taskNumber)],
      metadata: {
        linkedLessonBlockId: linkedLessonId,
        performanceTaskNumber: taskNumber,
        chapterId: unit.chapterId ?? null,
        chapterTitle: unit.chapterTitle ?? null,
      },
    });
  });

  return blocks;
}

function buildCumulativeExamDependencies(
  units: TOCUnit[],
  examTemplates: ExamBlockTemplate[]
): string[][] {
  if (examTemplates.length === 0) {
    return [];
  }

  const totalLessons = units.length;
  const totalExams = examTemplates.length;
  const baseChunk = Math.floor(totalLessons / totalExams);
  const remainder = totalLessons % totalExams;

  const dependencyGroups: string[][] = [];
  let cursor = 0;

  for (let examIndex = 0; examIndex < totalExams; examIndex += 1) {
    const chunkSize = baseChunk + (examIndex < remainder ? 1 : 0);
    cursor += chunkSize;
    dependencyGroups.push(units.slice(0, cursor).map((unit) => lessonBlockId(unit.id)));
  }

  return dependencyGroups;
}

function createReviewAndPreparationBlocks(
  courseId: string,
  examTemplates: ExamBlockTemplate[],
  includeReviewBeforeExam: boolean,
  examDependencies: string[][]
): Block[] {
  if (!includeReviewBeforeExam || examTemplates.length === 0) {
    return [];
  }

  const blocks: Block[] = [];

  examTemplates.forEach((exam, index) => {
    const number = index + 1;
    const reviewId = reviewBlockId(number);
    const dependencies = examDependencies[index] ?? [];

    blocks.push({
      id: reviewId,
      courseId,
      type: "buffer",
      subcategory: "review",
      title: `Review for ${exam.title}`,
      estimatedMinutes: 45,
      minMinutes: 20,
      maxMinutes: 90,
      required: true,
      splittable: false,
      overlayMode: "major",
      preferredSessionType: "lecture",
      dependencies,
      metadata: {
        targetExamTemplateId: exam.id,
        reviewNumber: number,
      },
    });

    blocks.push({
      id: bufferBlockId(number),
      courseId,
      type: "buffer",
      subcategory: "preparation",
      title: `Preparation for ${exam.title}`,
      estimatedMinutes: 20,
      minMinutes: 10,
      maxMinutes: 45,
      required: false,
      splittable: false,
      overlayMode: "minor",
      preferredSessionType: "any",
      dependencies: [reviewId],
      metadata: {
        targetExamTemplateId: exam.id,
        bufferNumber: number,
      },
    });
  });

  return blocks;
}

function createExamBlocks(
  courseId: string,
  examTemplates: ExamBlockTemplate[],
  examDependencies: string[][]
): Block[] {
  return examTemplates.map((exam, index) => ({
    id: examBlockId(exam.id),
    courseId,
    type: "exam",
    subcategory: exam.subcategory ?? "final",
    title: exam.title,
    estimatedMinutes: exam.estimatedMinutes,
    minMinutes: Math.max(30, Math.floor(exam.estimatedMinutes * 0.9)),
    maxMinutes: exam.estimatedMinutes,
    required: exam.required ?? true,
    splittable: false,
    overlayMode: "exclusive",
    preferredSessionType: "lecture",
    dependencies: examDependencies[index] ?? [],
    metadata: {
      examTemplateId: exam.id,
      preferredDate: exam.preferredDate ?? null,
      examIndex: index,
      examCount: examTemplates.length,
    },
  }));
}

function dedupeQuizBlocks(quizzes: Block[]): Block[] {
  const seen = new Set<string>();
  const result: Block[] = [];

  for (const quiz of quizzes) {
    const key = JSON.stringify({
      dependencies: [...quiz.dependencies].sort(),
      title: quiz.title,
    });

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(quiz);
  }

  return result;
}

export function buildBlocks(input: BuildBlocksInput): Block[] {
  const { courseId, tocUnits, teacherRules, examBlockTemplates = [] } = input;

  const orderedUnits = sortTOCUnits(tocUnits).filter((unit) => unit.required);

  const lessonBlocks = orderedUnits.map(createLessonBlock);
  const writtenWorkBlocks = createWrittenWorkBlocks(orderedUnits, teacherRules);

  const chapterQuizBlocks =
    teacherRules.quizMode === "every_n_lessons"
      ? []
      : Array.from(groupUnitsByChapter(orderedUnits).entries()).map(([chapterId, units]) =>
          createChapterQuizBlock(courseId, chapterId, units)
        );

  const intervalQuizBlocks =
    teacherRules.quizMode === "per_chapter"
      ? []
      : createIntervalQuizBlocks(courseId, orderedUnits, teacherRules);

  const quizBlocks =
    teacherRules.quizMode === "hybrid"
      ? dedupeQuizBlocks([...chapterQuizBlocks, ...intervalQuizBlocks])
      : teacherRules.quizMode === "per_chapter"
        ? chapterQuizBlocks
        : intervalQuizBlocks;

  const performanceTaskBlocks = createPerformanceTaskBlocks(
    courseId,
    orderedUnits,
    Math.max(0, teacherRules.performanceTaskMin)
  );

  const examDependencies = buildCumulativeExamDependencies(orderedUnits, examBlockTemplates);
  const reviewAndPreparationBlocks = createReviewAndPreparationBlocks(
    courseId,
    examBlockTemplates,
    teacherRules.includeReviewBeforeExam,
    examDependencies
  );

  const examBlocks = createExamBlocks(courseId, examBlockTemplates, examDependencies);

  return [
    ...lessonBlocks,
    ...writtenWorkBlocks,
    ...quizBlocks,
    ...performanceTaskBlocks,
    ...reviewAndPreparationBlocks,
    ...examBlocks,
  ];
}
