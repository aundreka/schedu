// algorithm/00_types.ts

// ======================================================
// BASIC UTILITY TYPES
// ======================================================

export type UUID = string;

// Supabase returns these as strings.
export type ISODateString = string; // YYYY-MM-DD
export type TimeString = string; // HH:mm:ss or HH:mm
export type TimestampString = string;

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type Nullable<T> = T | null;

// Useful for blocks/slots created in-memory before Supabase insert.
export type TempId = `tmp_${string}`;

export type EntityId = UUID | TempId;

// ======================================================
// DATABASE ENUM TYPES
// Keep these aligned with your SQL enum values.
// ======================================================

export const SCHOOL_TYPES = [
  'university',
  'basic_ed',
  'training_center',
] as const;

export type SchoolType = (typeof SCHOOL_TYPES)[number];

export const ACADEMIC_TERMS = [
  'quarter',
  'trimester',
  'semester',
] as const;

export type AcademicTerm = (typeof ACADEMIC_TERMS)[number];

export const ROOM_TYPES = ['lecture', 'laboratory'] as const;

export type RoomType = (typeof ROOM_TYPES)[number];

export const MEETING_TYPES = ['lecture', 'laboratory'] as const;

export type MeetingType = (typeof MEETING_TYPES)[number];

export const SESSION_CATEGORIES = [
  'lesson',
  'written_work',
  'performance_task',
  'exam',
  'buffer',
] as const;

export type SessionCategory = (typeof SESSION_CATEGORIES)[number];

export const SESSION_SUBCATEGORIES = [
  'lecture',
  'laboratory',
  'assignment',
  'seatwork',
  'quiz',
  'activity',
  'lab_report',
  'reporting',
  'project',
  'prelim',
  'midterm',
  'final',
  'review',
  'preparation',
  'orientation',
  'other',
] as const;

export type SessionSubcategory = (typeof SESSION_SUBCATEGORIES)[number];

export type LessonSubcategory = Extract<
  SessionSubcategory,
  'lecture' | 'laboratory'
>;

export type WrittenWorkSubcategory = Extract<
  SessionSubcategory,
  'assignment' | 'seatwork' | 'quiz'
>;

export type PerformanceTaskSubcategory = Extract<
  SessionSubcategory,
  'activity' | 'lab_report' | 'reporting' | 'project'
>;

export type ExamSubcategory = Extract<
  SessionSubcategory,
  'prelim' | 'midterm' | 'final'
>;

export type BufferSubcategory = Extract<
  SessionSubcategory,
  'review' | 'preparation' | 'orientation' | 'other'
>;

export const PLAN_BLACKOUT_REASONS = [
  'event',
  'exam_week',
  'holiday',
  'leave',
  'sick',
  'suspended',
  'other',
] as const;

export type PlanBlackoutReason = (typeof PLAN_BLACKOUT_REASONS)[number];

export const RECORD_STATUSES = ['draft', 'published'] as const;

export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const WEEKDAY_NAMES = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

export const PLAN_ENTRY_TYPES = [
  'recurring_class',
  'planned_item',
  'moved_item',
  'cancelled_item',
] as const;

export type PlanEntryType = (typeof PLAN_ENTRY_TYPES)[number];

export const CALENDAR_EVENT_TYPES = [
  'holiday',
  'suspension',
  'school_event',
  'exam_week',
  'other',
] as const;

export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export const PREFERRED_SESSION_TYPES = [
  'lecture',
  'laboratory',
  'mixed',
  'any',
] as const;

export type PreferredSessionType = (typeof PREFERRED_SESSION_TYPES)[number];

// ======================================================
// VALID CATEGORY/SUBCATEGORY MAP
// Matches your blocks_session_pair_check constraint.
// ======================================================

export const SUBCATEGORIES_BY_CATEGORY = {
  lesson: ['lecture', 'laboratory'],
  written_work: ['assignment', 'seatwork', 'quiz'],
  performance_task: ['activity', 'lab_report', 'reporting', 'project'],
  exam: ['prelim', 'midterm', 'final'],
  buffer: ['review', 'preparation', 'orientation', 'other'],
} as const satisfies Record<SessionCategory, readonly SessionSubcategory[]>;

export type SubcategoryFor<C extends SessionCategory> =
  (typeof SUBCATEGORIES_BY_CATEGORY)[C][number];

export function isValidSessionPair(
  category: SessionCategory,
  subcategory: SessionSubcategory | null | undefined,
): boolean {
  if (!subcategory) return false;

  return (SUBCATEGORIES_BY_CATEGORY[category] as readonly string[]).includes(
    subcategory,
  );
}

// ======================================================
// DATABASE ROW TYPES
// These use snake_case because Supabase rows use snake_case.
// ======================================================

export interface ChapterRow {
  chapter_id: UUID;
  public_id: string;
  subject_id: UUID;
  unit_id: UUID | null;
  title: string;
  description: string | null;
  sequence_no: number;
  status: RecordStatus;
  created_at: TimestampString;
  updated_at: TimestampString;
}

export interface LessonRow {
  lesson_id: UUID;
  public_id: string;
  chapter_id: UUID;
  title: string;
  content: string | null;
  learning_objectives: string | null;
  estimated_minutes: number | null;
  complexity_score: number | null;
  sequence_no: number;
  status: RecordStatus;
  created_at: TimestampString;
  updated_at: TimestampString;
}

export type ActivityCategory = Extract<
  SessionCategory,
  'written_work' | 'performance_task'
>;

export type WrittenWorkActivityType =
  | 'quiz'
  | 'assignment'
  | 'seatwork'
  | 'exam';

export type PerformanceTaskActivityType =
  | 'project'
  | 'lab_report'
  | 'activity'
  | 'other';

interface ActivityRowBase {
  activity_id: UUID;
  public_id: string;
  user_id: UUID;
  school_id: UUID;
  subject_id: UUID;
  title: string;
  scope_lesson_ids: UUID[];
  scope_summary: string | null;
  requirements: JsonObject;
  component_keys: string[];
  template_notes: string | null;
  template_storage_path: string | null;
  generation_notes: string | null;
  generated_text: string | null;
  generated_pdf_path: string | null;
  generated_docx_path: string | null;
  status: RecordStatus;
  created_at: TimestampString;
  updated_at: TimestampString;
}

export type ActivityRow =
  | (ActivityRowBase & {
      category: 'written_work';
      activity_type: WrittenWorkActivityType;
    })
  | (ActivityRowBase & {
      category: 'performance_task';
      activity_type: PerformanceTaskActivityType;
    });

export interface LessonPlanRow {
  lesson_plan_id: UUID;
  public_id: string;
  user_id: UUID;
  school_id: UUID;
  subject_id: UUID;
  section_id: UUID;
  title: string;
  academic_year: string | null;
  start_date: ISODateString;
  end_date: ISODateString;
  status: RecordStatus;
  notes: string | null;
  created_at: TimestampString;
  updated_at: TimestampString;
}

export interface SlotRow {
  slot_id: UUID;
  lesson_plan_id: UUID;
  title: string | null;
  slot_date: ISODateString;
  weekday: WeekdayName;
  start_time: TimeString;
  end_time: TimeString;
  meeting_type: MeetingType | null;
  slot_number: number;
  series_key: string;
  is_locked: boolean;
  created_at: TimestampString;
  updated_at: TimestampString;
}

export interface DbBlockRow {
  block_id: UUID;
  lesson_plan_id: UUID;
  slot_id: UUID | null;
  root_block_id: UUID | null;
  lesson_id: UUID | null;
  algorithm_block_key: string;
  block_key: string;
  title: string;
  description: string | null;
  session_category: SessionCategory;
  session_subcategory: SessionSubcategory | null;
  meeting_type: MeetingType | null;
  start_time: TimeString;
  end_time: TimeString;
  required: boolean;
  splittable: boolean;
  preferred_session_type: PreferredSessionType;
  dependency_keys: string[];
  order_no: number;
  is_locked: boolean;
  ww_subtype: SessionSubcategory | null;
  pt_subtype: SessionSubcategory | null;
  metadata: JsonObject;
  created_at: TimestampString;
  updated_at: TimestampString;
}

// Strict app-side block row.
// Use this when you already validated category/subcategory pairs.
export type ValidBlockRow =
  | (DbBlockRow & {
      session_category: 'lesson';
      session_subcategory: LessonSubcategory;
    })
  | (DbBlockRow & {
      session_category: 'written_work';
      session_subcategory: WrittenWorkSubcategory;
    })
  | (DbBlockRow & {
      session_category: 'performance_task';
      session_subcategory: PerformanceTaskSubcategory;
    })
  | (DbBlockRow & {
      session_category: 'exam';
      session_subcategory: ExamSubcategory;
    })
  | (DbBlockRow & {
      session_category: 'buffer';
      session_subcategory: BufferSubcategory;
    });

export interface SchoolCalendarEventRow {
  event_id: UUID;
  school_id: UUID;
  section_id: UUID | null;
  subject_id: UUID | null;
  event_type: CalendarEventType;
  blackout_reason: PlanBlackoutReason;
  title: string;
  description: string | null;
  start_date: ISODateString;
  end_date: ISODateString;
  is_whole_day: boolean;
  created_by: UUID | null;
  created_at: TimestampString;
  updated_at: TimestampString;
}

export interface DelayRow {
  delay_id: UUID;
  user_id: UUID;
  school_id: UUID;
  subject_id: UUID | null;
  section_id: UUID | null;
  absent_on: ISODateString;
  blackout_reason: PlanBlackoutReason;
  reason: string | null;
  created_at: TimestampString;
}

// ======================================================
// INSERT / UPDATE TYPES
// Use these for Supabase insert/upsert/update calls.
// ======================================================

export type NewSlotRow = Omit<
  SlotRow,
  'slot_id' | 'created_at' | 'updated_at'
> & {
  slot_id?: UUID;
};

export type SlotPatch = Partial<
  Omit<SlotRow, 'slot_id' | 'created_at' | 'updated_at'>
> & {
  slot_id: UUID;
};

export type NewBlockRow = Omit<
  DbBlockRow,
  'block_id' | 'created_at' | 'updated_at'
> & {
  block_id?: UUID;
};

export type BlockPatch = Partial<
  Omit<DbBlockRow, 'block_id' | 'created_at' | 'updated_at'>
> & {
  block_id: UUID;
};

// ======================================================
// ALGORITHM INPUT TYPES
// ======================================================

export interface MeetingPattern {
  weekday: WeekdayName;
  start_time: TimeString;
  end_time: TimeString;
  meeting_type?: MeetingType | null;
  title?: string | null;
  slot_number?: number;
  series_key?: string;
}

export interface TermWindow {
  term_key: string;
  term_no: number;
  title: string;
  start_date: ISODateString;
  end_date: ISODateString;
  exam_subcategory?: ExamSubcategory;
}

export interface QuizRule {
  enabled: boolean;

  // Your preferred behavior: quiz every 2-3 lessons.
  min_lessons_per_quiz: number;
  max_lessons_per_quiz: number;

  // Example output title: Q1: L1-L3
  title_prefix?: string;
}

export interface TermRequirementCounts {
  lesson_count?: number;

  // Quizzes are part of written work, but tracked separately
  // so repopulate can build quiz scopes correctly.
  written_work_count?: number;
  quiz_count?: number;

  performance_task_count?: number;
  exam_count?: number;
  buffer_count?: number;
}

export interface TermRules {
  term_key: string;
  requirements: TermRequirementCounts;
  quiz_rule?: QuizRule;

  // Important for your repopulation rules.
  prevent_ww_pt_before_first_lesson: boolean;
  prevent_lessons_after_final_quiz: boolean;
}

export interface AlgorithmRules {
  academic_term?: AcademicTerm;
  terms: TermWindow[];
  term_rules: TermRules[];

  respect_locked_slots: boolean;
  respect_locked_blocks: boolean;

  fill_empty_slots: boolean;
  preserve_existing_exams: boolean;
  preserve_existing_locked_blocks: boolean;

  allow_buffer_blocks: boolean;
  allow_split_blocks: boolean;
}

export interface AlgorithmInput {
  lesson_plan: LessonPlanRow;

  chapters: ChapterRow[];
  lessons: LessonRow[];
  activities: ActivityRow[];

  existing_slots: SlotRow[];
  existing_blocks: DbBlockRow[];

  school_calendar_events: SchoolCalendarEventRow[];
  delays: DelayRow[];

  meeting_patterns: MeetingPattern[];
  rules: AlgorithmRules;
}

// ======================================================
// RUNTIME SLOT TYPES
// Used inside 01_slots, 04_place, 05_repopulate, etc.
// ======================================================

export type SlotKey = `${ISODateString}#${number}`;

export interface BlackoutInfo {
  reason: PlanBlackoutReason;
  title: string;
  source: 'school_calendar_event' | 'delay' | 'manual';
  source_id?: UUID;
}

export interface RuntimeSlot {
  slot_id?: UUID;
  temp_id: TempId;

  lesson_plan_id: UUID;

  slot_key: SlotKey;
  title: string | null;

  slot_date: ISODateString;
  weekday: WeekdayName;

  start_time: TimeString;
  end_time: TimeString;
  duration_minutes: number;

  meeting_type: MeetingType | null;
  slot_number: number;
  series_key: string;

  is_locked: boolean;
  blackout: BlackoutInfo | null;

  assigned_block_keys: string[];
}

// ======================================================
// RUNTIME BLOCK TYPES
// These allow unplaced blocks before start_time/end_time exist.
// ======================================================

export type BlockSource =
  | 'lesson'
  | 'activity'
  | 'exam'
  | 'buffer'
  | 'generated'
  | 'existing_db';

export interface BlockMetadata extends JsonObject {
  term_key?: string;
  term_no?: number;

  source?: BlockSource;
  source_activity_id?: UUID;
  source_lesson_id?: UUID;

  scope_lesson_ids?: UUID[];
  scope_summary?: string;

  quiz_no?: number;
  quiz_scope_start_label?: string;
  quiz_scope_end_label?: string;

  generated_by_algorithm?: boolean;
}

interface RuntimeBlockBase {
  block_id?: UUID;
  temp_id: TempId;

  lesson_plan_id: UUID;

  slot_id?: UUID | null;
  slot_key?: SlotKey | null;

  root_block_id?: UUID | null;
  lesson_id?: UUID | null;

  algorithm_block_key: string;
  block_key: string;

  title: string;
  description: string | null;

  session_category: SessionCategory;
  session_subcategory: SessionSubcategory;

  meeting_type: MeetingType | null;

  // Optional while unplaced.
  start_time?: TimeString;
  end_time?: TimeString;

  // Main time value used while placing/compressing.
  duration_minutes: number;

  required: boolean;
  splittable: boolean;
  preferred_session_type: PreferredSessionType;

  dependency_keys: string[];
  order_no: number;

  is_locked: boolean;

  ww_subtype: SessionSubcategory | null;
  pt_subtype: SessionSubcategory | null;

  source: BlockSource;
  metadata: BlockMetadata;
}

export type RuntimeLessonBlock = RuntimeBlockBase & {
  session_category: 'lesson';
  session_subcategory: LessonSubcategory;
  lesson_id: UUID;
  ww_subtype: null;
  pt_subtype: null;
};

export type RuntimeWrittenWorkBlock = RuntimeBlockBase & {
  session_category: 'written_work';
  session_subcategory: WrittenWorkSubcategory;
  ww_subtype: WrittenWorkSubcategory;
  pt_subtype: null;
};

export type RuntimePerformanceTaskBlock = RuntimeBlockBase & {
  session_category: 'performance_task';
  session_subcategory: PerformanceTaskSubcategory;
  ww_subtype: null;
  pt_subtype: PerformanceTaskSubcategory;
};

export type RuntimeExamBlock = RuntimeBlockBase & {
  session_category: 'exam';
  session_subcategory: ExamSubcategory;
  ww_subtype: null;
  pt_subtype: null;
};

export type RuntimeBufferBlock = RuntimeBlockBase & {
  session_category: 'buffer';
  session_subcategory: BufferSubcategory;
  ww_subtype: null;
  pt_subtype: null;
};

export type RuntimeBlock =
  | RuntimeLessonBlock
  | RuntimeWrittenWorkBlock
  | RuntimePerformanceTaskBlock
  | RuntimeExamBlock
  | RuntimeBufferBlock;

// ======================================================
// PLACEMENT / ORDERING TYPES
// ======================================================

export interface BlockPlacement {
  block_key: string;
  algorithm_block_key: string;

  slot_key: SlotKey;
  slot_id?: UUID;

  start_time: TimeString;
  end_time: TimeString;
  order_no: number;

  reason?: string;
}

export interface OrderedSlot {
  slot: RuntimeSlot;
  blocks: RuntimeBlock[];
}

export interface TermBlockGroup {
  term: TermWindow;
  slots: RuntimeSlot[];
  blocks: RuntimeBlock[];

  lesson_blocks: RuntimeLessonBlock[];
  written_work_blocks: RuntimeWrittenWorkBlock[];
  quiz_blocks: RuntimeWrittenWorkBlock[];
  performance_task_blocks: RuntimePerformanceTaskBlock[];
  exam_blocks: RuntimeExamBlock[];
  buffer_blocks: RuntimeBufferBlock[];
}

export interface QuizScope {
  quiz_no: number;
  title: string;

  term_key: string;

  lesson_ids: UUID[];
  first_lesson_id: UUID;
  last_lesson_id: UUID;

  first_lesson_label: string;
  last_lesson_label: string;
}

// ======================================================
// ALGORITHM MUTATION TYPES
// What your create/place/repopulate/compress/order pipeline can return.
// ======================================================

export type AlgorithmMutation =
  | {
      type: 'insert_slot';
      slot: NewSlotRow;
    }
  | {
      type: 'update_slot';
      slot_id: UUID;
      patch: Omit<SlotPatch, 'slot_id'>;
    }
  | {
      type: 'delete_slot';
      slot_id: UUID;
    }
  | {
      type: 'insert_block';
      block: NewBlockRow;
    }
  | {
      type: 'update_block';
      block_id: UUID;
      patch: Omit<BlockPatch, 'block_id'>;
    }
  | {
      type: 'delete_block';
      block_id: UUID;
    };

export type AlgorithmWarningSeverity = 'info' | 'warning' | 'error';

export type AlgorithmWarningCode =
  | 'NO_AVAILABLE_SLOT'
  | 'INSUFFICIENT_SLOTS'
  | 'BLOCK_TOO_LONG'
  | 'LOCKED_BLOCK_CONFLICT'
  | 'LOCKED_SLOT_CONFLICT'
  | 'BLACKOUT_CONFLICT'
  | 'MISSING_REQUIREMENT'
  | 'INVALID_SESSION_PAIR'
  | 'UNPLACED_BLOCK'
  | 'TERM_RULE_VIOLATION'
  | 'UNKNOWN';

export interface AlgorithmWarning {
  code: AlgorithmWarningCode;
  severity: AlgorithmWarningSeverity;
  message: string;

  term_key?: string;
  slot_key?: SlotKey;
  block_key?: string;
  lesson_id?: UUID;
}

export interface AlgorithmMetrics {
  total_slots: number;
  usable_slots: number;
  blackout_slots: number;

  total_blocks: number;
  placed_blocks: number;
  unplaced_blocks: number;

  lesson_count: number;
  written_work_count: number;
  quiz_count: number;
  performance_task_count: number;
  exam_count: number;
  buffer_count: number;
}

export interface AlgorithmResult {
  slots: RuntimeSlot[];
  blocks: RuntimeBlock[];

  ordered_slots: OrderedSlot[];

  mutations: AlgorithmMutation[];
  warnings: AlgorithmWarning[];
  metrics: AlgorithmMetrics;
}

// ======================================================
// MODULE PARAM TYPES
// For your files:
// 01_slots.ts, 02_blocks.ts, 03_create.ts, etc.
// ======================================================

export interface CreateSlotsParams {
  lesson_plan: LessonPlanRow;
  meeting_patterns: MeetingPattern[];
  school_calendar_events: SchoolCalendarEventRow[];
  delays: DelayRow[];
  existing_slots?: SlotRow[];
  rules: AlgorithmRules;
}

export interface BuildBlocksParams {
  lesson_plan: LessonPlanRow;
  lessons: LessonRow[];
  activities: ActivityRow[];
  existing_blocks?: DbBlockRow[];
  rules: AlgorithmRules;
}

export interface CreateAlgorithmParams {
  input: AlgorithmInput;
}

export interface PlaceBlocksParams {
  slots: RuntimeSlot[];
  blocks: RuntimeBlock[];
  rules: AlgorithmRules;
}

export interface RepopulateParams {
  slots: RuntimeSlot[];
  blocks: RuntimeBlock[];
  lessons: LessonRow[];
  activities: ActivityRow[];
  rules: AlgorithmRules;
}

export interface CompressParams {
  slots: RuntimeSlot[];
  blocks: RuntimeBlock[];
  rules: AlgorithmRules;
}

export interface OrderParams {
  slots: RuntimeSlot[];
  blocks: RuntimeBlock[];
  rules: AlgorithmRules;
}

// ======================================================
// TYPE GUARDS
// Helpful for filtering blocks.
// ======================================================

export function isLessonBlock(
  block: RuntimeBlock,
): block is RuntimeLessonBlock {
  return block.session_category === 'lesson';
}

export function isWrittenWorkBlock(
  block: RuntimeBlock,
): block is RuntimeWrittenWorkBlock {
  return block.session_category === 'written_work';
}

export function isQuizBlock(
  block: RuntimeBlock,
): block is RuntimeWrittenWorkBlock & { session_subcategory: 'quiz' } {
  return (
    block.session_category === 'written_work' &&
    block.session_subcategory === 'quiz'
  );
}

export function isPerformanceTaskBlock(
  block: RuntimeBlock,
): block is RuntimePerformanceTaskBlock {
  return block.session_category === 'performance_task';
}

export function isExamBlock(block: RuntimeBlock): block is RuntimeExamBlock {
  return block.session_category === 'exam';
}

export function isBufferBlock(
  block: RuntimeBlock,
): block is RuntimeBufferBlock {
  return block.session_category === 'buffer';
}

export function isPlacedBlock(block: RuntimeBlock): boolean {
  return Boolean(block.slot_key && block.start_time && block.end_time);
}

export function isUsableSlot(slot: RuntimeSlot): boolean {
  return !slot.blackout && !slot.is_locked;
}

// ======================================================
// CONVERTERS TO DATABASE INSERT ROWS
// ======================================================

export function runtimeSlotToNewSlotRow(slot: RuntimeSlot): NewSlotRow {
  return {
    lesson_plan_id: slot.lesson_plan_id,
    title: slot.title,
    slot_date: slot.slot_date,
    weekday: slot.weekday,
    start_time: slot.start_time,
    end_time: slot.end_time,
    meeting_type: slot.meeting_type,
    slot_number: slot.slot_number,
    series_key: slot.series_key,
    is_locked: slot.is_locked,
  };
}

export function runtimeBlockToNewBlockRow(block: RuntimeBlock): NewBlockRow {
  if (!block.start_time || !block.end_time) {
    throw new Error(
      `Cannot convert unplaced block "${block.block_key}" to DB row. Missing start_time or end_time.`,
    );
  }

  return {
    lesson_plan_id: block.lesson_plan_id,
    slot_id: block.slot_id ?? null,
    root_block_id: block.root_block_id ?? null,
    lesson_id: block.lesson_id ?? null,
    algorithm_block_key: block.algorithm_block_key,
    block_key: block.block_key,
    title: block.title,
    description: block.description,
    session_category: block.session_category,
    session_subcategory: block.session_subcategory,
    meeting_type: block.meeting_type,
    start_time: block.start_time,
    end_time: block.end_time,
    required: block.required,
    splittable: block.splittable,
    preferred_session_type: block.preferred_session_type,
    dependency_keys: block.dependency_keys,
    order_no: block.order_no,
    is_locked: block.is_locked,
    ww_subtype: block.ww_subtype,
    pt_subtype: block.pt_subtype,
    metadata: block.metadata,
  };
}