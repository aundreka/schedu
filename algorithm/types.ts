export type SessionType = "lecture" | "laboratory" | "any";

export type Complexity = number; // 1 (easy) to 10 (hard)

export type OverlayMode = "exclusive" | "major" | "minor";

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
  | "other";

export type PlacementLane = "major" | "minor";

export type ValidationSeverity = "info" | "warning" | "error";

export interface SessionSlot {
  id: string;
  courseId: string;
  date: string; // YYYY-MM-DD
  startTime: string | null; // HH:mm
  endTime: string | null; // HH:mm
  sessionType: SessionType | null;
  minutes: number;
  locked: boolean;
  lockReason?: string | null;
  placements: Placement[];
}

export interface Lesson {
  id: string;
  courseId: string;
  chapterId?: string | null;
  chapterTitle?: string | null;
  title: string;
  order: number;
  estimatedMinutes: number;
  complexity?: Complexity;
  preferredSessionType?: SessionType;
  required: boolean;
}

export interface Block {
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
  overlayMode: OverlayMode;
  order: number;
  preferredSessionType: SessionType;
  dependencies: string[]; // block ids that must be scheduled before this block
  metadata?: Record<string, unknown>;
}

export interface Placement {
  id: string;
  blockId: string;
  slotId: string;
  lane: PlacementLane;
  minutesUsed: number;
  chainId?: string | null;
  segmentIndex?: number;
  segmentCount?: number;
  continuesFromPrevious?: boolean;
  continuesToNext?: boolean;
  startTime?: string | null;
  endTime?: string | null;
}

export interface CourseInfo {
  id: string;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export interface TeacherRules {
  quizMode: "per_chapter" | "every_n_lessons" | "hybrid";
  quizEveryNLessons?: number;
  writtenWorkMode: "total" | "per_lesson";
  minWW: number;
  allowLessonWrittenWorkOverlay: boolean;
  preferLessonWrittenWorkOverlay: boolean;
  minPT: number;
  includeReviewBeforeExam: boolean;
}

export interface LockedDateInput {
  date: string; // YYYY-MM-DD
  reason: string;
  appliesToAllSlots?: boolean;
  slotIds?: string[];
}

export interface LessonPlanInput {
  course: CourseInfo;
  sessionSlots: SessionSlot[];
  Lesson: Lesson[];
  teacherRules: TeacherRules;
  lockedDates?: LockedDateInput[];
}

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  relatedIds?: string[];
}

export interface LessonPlanSummary {
  totalLessons: number;
  scheduledLessons: number;
  totalPerformanceTasks: number;
  totalWrittenWorks: number;
  emptySlots: number;
  utilizationRate: number; // 0 to 1
}

export interface LessonPlanResult {
  slots: SessionSlot[];
  blocks: Block[];
  unscheduledBlocks: Block[];
  validations: ValidationIssue[];
  summary: LessonPlanSummary;
}
