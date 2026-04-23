export type SessionCategory =
  | "lesson"
  | "written_work"
  | "performance_task"
  | "exam"
  | "buffer";

export type SessionSubcategory =
  | "lecture"
  | "laboratory"
  | "assignment"
  | "seatwork"
  | "quiz"
  | "activity"
  | "lab_report"
  | "reporting"
  | "project"
  | "prelim"
  | "midterm"
  | "final"
  | "review"
  | "preparation"
  | "orientation"
  | "other";

export type SessionType = "lecture" | "laboratory" | "mixed" | "any";
export type Difficulty = "easy" | "medium" | "high";
export type WeekdayName =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type BlockOverlayMode = "exclusive" | "major" | "minor";

export type Placement = {
  id: string;
  blockId: string;
  slotId: string;
  lane: "major" | "minor";
  minutesUsed: number;
  chainId: string;
  segmentIndex: number;
  segmentCount: number;
  continuesFromPrevious: boolean;
  continuesToNext: boolean;
  startTime: string | null;
  endTime: string | null;
};

export type SessionSlot = {
  id: string;
  courseId: string;
  date: string;
  weekday?: WeekdayName | null;
  startTime: string | null;
  endTime: string | null;
  sessionType: SessionType | null;
  minutes: number;
  locked: boolean;
  lockReason: string | null;
  slotNumber?: number;
  seriesKey?: string | null;
  termIndex?: number;
  termKey?: string;
  termLabel?: string;
  termSlotIndex?: number;
  isTermStart?: boolean;
  isTermEnd?: boolean;
  reservedFor?: "orientation" | "lesson" | "exam" | null;
  placements: Placement[];
};

export type TOCUnit = {
  id: string;
  courseId: string;
  chapterId?: string | null;
  chapterTitle?: string | null;
  title: string;
  order: number;
  estimatedMinutes: number;
  difficulty: Difficulty;
  preferredSessionType: SessionType;
  required: boolean;
};

export type TeacherRules = {
  quizMode?: "none" | "hybrid" | "strict";
  quizEveryNLessons?: number;
  writtenWorkMode?: "total" | "per_term";
  minWW?: number;
  allowLessonWrittenWorkOverlay?: boolean;
  preferLessonWrittenWorkOverlay?: boolean;
  minPT?: number;
  includeReviewBeforeExam?: boolean;
  delays?: number;
};

export type ExamBlockTemplate = {
  id: string;
  title: string;
  estimatedMinutes: number;
  subcategory: Extract<SessionSubcategory, "prelim" | "midterm" | "final">;
  preferredDate?: string | null;
  required: boolean;
};

export type TermKey = "prelim" | "midterm" | "final";

export type TermLessonAllocation = {
  termIndex: number;
  termKey: TermKey;
  label: string;
  tocUnits: TOCUnit[];
  rawTermSlots: number;
  initialDelayCount: number;
  termLessons: number;
  termWW: number;
  termPT: number;
  termQuizAmount: number;
  lessonInterval: number;
  termSlots: number;
  extraTermSlots: number;
  startDate: string | null;
  endDate: string | null;
  examDate: string | null;
  hasOrientation: boolean;
};

export type PacingPlan = {
  totalSlots: number;
  lessonCount: number;
  termCount: number;
  minWrittenWorks: number;
  minPerformanceTasks: number;
  terms: TermLessonAllocation[];
};

export type Block = {
  id: string;
  courseId: string;
  type: SessionCategory;
  subcategory: SessionSubcategory;
  title: string;
  sourceTocId?: string | null;
  estimatedMinutes: number;
  minMinutes?: number;
  maxMinutes?: number;
  required: boolean;
  splittable: boolean;
  overlayMode: BlockOverlayMode;
  preferredSessionType: SessionType;
  dependencies: string[];
  metadata: Record<string, unknown>;
};

export type ValidationIssue = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  relatedIds: string[];
};

export type PlacementResult = {
  slots: SessionSlot[];
  unscheduledBlockIds: string[];
};
