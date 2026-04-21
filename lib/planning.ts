import type { Block, Placement, SessionCategory, SessionSlot, SessionSubcategory, SessionType } from "../algorithm/types";

export type PlanSlotRow = {
  slot_id: string;
  lesson_plan_id: string;
  title: string | null;
  slot_date: string;
  weekday: string | null;
  start_time: string | null;
  end_time: string | null;
  meeting_type: string | null;
  room: string | null;
  slot_number: number | null;
  series_key: string | null;
  is_locked: boolean | null;
};

export type PlanBlockRow = {
  block_id: string;
  lesson_plan_id: string;
  slot_id: string | null;
  root_block_id: string | null;
  algorithm_block_key: string;
  block_key: string;
  lesson_id: string | null;
  title: string;
  description: string | null;
  session_category: string | null;
  session_subcategory: string | null;
  meeting_type: string | null;
  estimated_minutes: number | null;
  min_minutes: number | null;
  max_minutes: number | null;
  required: boolean | null;
  splittable: boolean | null;
  overlay_mode: string | null;
  preferred_session_type: string | null;
  dependency_keys: string[] | null;
  order_no: number | null;
  is_locked: boolean | null;
  ww_subtype: string | null;
  pt_subtype: string | null;
  metadata: Record<string, unknown> | null;
};

export type ScheduledCalendarBlock = {
  blockId: string;
  rootBlockId: string | null;
  lessonPlanId: string;
  slotId: string;
  blockKey: string;
  algorithmBlockKey: string;
  title: string;
  description: string | null;
  category: string;
  subcategory: string | null;
  meetingType: string | null;
  startTime: string | null;
  endTime: string | null;
  scheduledDate: string;
  orderNo: number;
  isLocked: boolean;
  wwSubtype: string | null;
  ptSubtype: string | null;
  lessonId: string | null;
  metadata: Record<string, unknown>;
  slotTitle: string | null;
  slotNumber: number | null;
};

export type ScheduledCalendarSlot = {
  slotId: string;
  lessonPlanId: string;
  title: string | null;
  slotDate: string;
  weekday: string | null;
  startTime: string | null;
  endTime: string | null;
  meetingType: string | null;
  room: string | null;
  slotNumber: number | null;
  seriesKey: string | null;
  isLocked: boolean;
  blocks: ScheduledCalendarBlock[];
};

export function normalizeWeekdayValue(day: string | null | undefined): string | null {
  if (!day) return null;
  const key = day.trim().toLowerCase();
  if (key.startsWith("mon")) return "monday";
  if (key.startsWith("tue")) return "tuesday";
  if (key.startsWith("wed")) return "wednesday";
  if (key.startsWith("thu")) return "thursday";
  if (key.startsWith("fri")) return "friday";
  if (key.startsWith("sat")) return "saturday";
  if (key.startsWith("sun")) return "sunday";
  return null;
}

export function toHm(value: string | null | undefined) {
  return value ? String(value).slice(0, 5) : null;
}

export function toMinutes(start: string | null | undefined, end: string | null | undefined) {
  const startHm = toHm(start);
  const endHm = toHm(end);
  if (!startHm || !endHm) return 0;
  const [startHour, startMinute] = startHm.split(":").map(Number);
  const [endHour, endMinute] = endHm.split(":").map(Number);
  if (!Number.isFinite(startHour) || !Number.isFinite(startMinute) || !Number.isFinite(endHour) || !Number.isFinite(endMinute)) {
    return 0;
  }
  return Math.max(0, endHour * 60 + endMinute - (startHour * 60 + startMinute));
}

function toSessionType(value: string | null | undefined): SessionType | null {
  if (value === "lecture" || value === "laboratory" || value === "mixed" || value === "any") {
    return value;
  }
  return null;
}

function toOverlayMode(value: string | null | undefined): Block["overlayMode"] {
  if (value === "exclusive" || value === "major" || value === "minor") {
    return value;
  }
  return "major";
}

export function normalizeBlockCategory(
  sessionCategory: string | null | undefined,
  sessionSubcategory: string | null | undefined
): string {
  const normalizedCategory = (sessionCategory ?? "").trim().toLowerCase();
  const normalizedSubcategory = (sessionSubcategory ?? "").trim().toLowerCase();

  if (
    normalizedCategory === "lesson" ||
    normalizedCategory === "written_work" ||
    normalizedCategory === "performance_task" ||
    normalizedCategory === "exam" ||
    normalizedCategory === "buffer"
  ) {
    return normalizedCategory;
  }

  if (normalizedSubcategory === "review" || normalizedSubcategory === "preparation") {
    return "buffer";
  }

  return "lesson";
}

function toSessionCategory(value: string | null | undefined): SessionCategory {
  const normalized = normalizeBlockCategory(value, null);
  return normalized as SessionCategory;
}

function toSessionSubcategory(value: string | null | undefined, category: SessionCategory): SessionSubcategory {
  const normalized = (value ?? "").trim().toLowerCase();
  const allowed: Record<SessionCategory, SessionSubcategory[]> = {
    lesson: ["lecture", "laboratory"],
    written_work: ["assignment", "seatwork", "quiz"],
    performance_task: ["activity", "lab_report", "reporting", "project"],
    exam: ["prelim", "midterm", "final"],
    buffer: ["review", "preparation", "other"],
  };
  return allowed[category].includes(normalized as SessionSubcategory)
    ? (normalized as SessionSubcategory)
    : allowed[category][0];
}

export function mapSlotRowsToAlgorithmSlots(slotRows: PlanSlotRow[]): SessionSlot[] {
  return slotRows
    .map((slot) => ({
      id: slot.slot_id,
      courseId: slot.lesson_plan_id,
      date: slot.slot_date,
      startTime: toHm(slot.start_time),
      endTime: toHm(slot.end_time),
      sessionType: toSessionType(slot.meeting_type ?? slot.room),
      minutes: toMinutes(slot.start_time, slot.end_time),
      locked: Boolean(slot.is_locked),
      lockReason: Boolean(slot.is_locked) ? "Locked slot" : null,
      placements: [] as Placement[],
    }))
    .sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      const timeCompare = (a.startTime ?? "").localeCompare(b.startTime ?? "");
      if (timeCompare !== 0) return timeCompare;
      return a.id.localeCompare(b.id);
    });
}

export function mapBlockRowsToAlgorithmBlocks(blockRows: PlanBlockRow[]): Block[] {
  return blockRows.map((row) => {
    const category = toSessionCategory(row.session_category);
    const preferredSessionType = toSessionType(row.preferred_session_type) ?? "any";
    const metadata = row.metadata ?? {};
    return {
      id: row.block_id,
      courseId: row.lesson_plan_id,
      type: category,
      subcategory: toSessionSubcategory(row.session_subcategory, category),
      title: row.title,
      sourceTocId: typeof metadata.sourceTocId === "string" ? metadata.sourceTocId : row.lesson_id,
      estimatedMinutes: Math.max(15, Number(row.estimated_minutes ?? 60)),
      minMinutes: row.min_minutes ?? undefined,
      maxMinutes: row.max_minutes ?? undefined,
      required: Boolean(row.required),
      splittable: Boolean(row.splittable),
      overlayMode: toOverlayMode(row.overlay_mode),
      preferredSessionType,
      dependencies: row.dependency_keys ?? [],
      metadata,
    };
  });
}

export function buildPlacementSeed(
  slotRows: PlanSlotRow[],
  blockRows: PlanBlockRow[]
): Record<string, Placement[]> {
  const slotById = new Map(slotRows.map((slot) => [slot.slot_id, slot]));
  const grouped = new Map<string, PlanBlockRow[]>();

  for (const block of blockRows) {
    if (!block.slot_id || !slotById.has(block.slot_id)) continue;
    const existing = grouped.get(block.slot_id) ?? [];
    existing.push(block);
    grouped.set(block.slot_id, existing);
  }

  const placementsBySlotId: Record<string, Placement[]> = {};

  for (const [slotId, rows] of grouped.entries()) {
    const placements = [...rows]
      .sort((a, b) => (a.order_no ?? 999) - (b.order_no ?? 999) || a.title.localeCompare(b.title))
      .map((row, index) => ({
        id: `placement__${row.block_id}__${slotId}__${index + 1}`,
        blockId: row.block_id,
        slotId,
        lane: row.overlay_mode === "minor" ? "minor" : "major",
        minutesUsed: Math.max(15, Number(row.estimated_minutes ?? 60)),
        chainId: row.block_key,
        segmentIndex: 1,
        segmentCount: 1,
        continuesFromPrevious: false,
        continuesToNext: false,
        startTime: null,
        endTime: null,
      } satisfies Placement));

    placementsBySlotId[slotId] = placements;
  }

  return placementsBySlotId;
}

export function buildScheduledCalendarSlots(
  slotRows: PlanSlotRow[],
  blockRows: PlanBlockRow[]
): ScheduledCalendarSlot[] {
  const blocksBySlotId = new Map<string, ScheduledCalendarBlock[]>();

  for (const row of blockRows) {
    if (!row.slot_id) continue;
    const existing = blocksBySlotId.get(row.slot_id) ?? [];
    existing.push({
      blockId: row.block_id,
      rootBlockId: row.root_block_id,
      lessonPlanId: row.lesson_plan_id,
      slotId: row.slot_id,
      blockKey: row.block_key,
      algorithmBlockKey: row.algorithm_block_key,
      title: row.title,
      description: row.description,
      category: normalizeBlockCategory(row.session_category, row.session_subcategory),
      subcategory: row.session_subcategory,
      meetingType: row.meeting_type,
      startTime: null,
      endTime: null,
      scheduledDate: "",
      orderNo: row.order_no ?? 1,
      isLocked: Boolean(row.is_locked),
      wwSubtype: row.ww_subtype,
      ptSubtype: row.pt_subtype,
      lessonId: row.lesson_id,
      metadata: row.metadata ?? {},
      slotTitle: null,
      slotNumber: null,
    });
    blocksBySlotId.set(row.slot_id, existing);
  }

  return slotRows
    .map((slot) => {
      const blocks = (blocksBySlotId.get(slot.slot_id) ?? [])
        .map((block) => ({
          ...block,
          startTime: toHm(slot.start_time),
          endTime: toHm(slot.end_time),
          scheduledDate: slot.slot_date,
          slotTitle: slot.title,
          slotNumber: slot.slot_number,
        }))
        .sort((a, b) => a.orderNo - b.orderNo || a.title.localeCompare(b.title));

      return {
        slotId: slot.slot_id,
        lessonPlanId: slot.lesson_plan_id,
        title: slot.title,
        slotDate: slot.slot_date,
        weekday: normalizeWeekdayValue(slot.weekday),
        startTime: toHm(slot.start_time),
        endTime: toHm(slot.end_time),
        meetingType: slot.meeting_type,
        room: slot.room,
        slotNumber: slot.slot_number,
        seriesKey: slot.series_key,
        isLocked: Boolean(slot.is_locked),
        blocks,
      } satisfies ScheduledCalendarSlot;
    })
    .sort((a, b) => {
      const dateCompare = a.slotDate.localeCompare(b.slotDate);
      if (dateCompare !== 0) return dateCompare;
      const timeCompare = (a.startTime ?? "").localeCompare(b.startTime ?? "");
      if (timeCompare !== 0) return timeCompare;
      return a.slotId.localeCompare(b.slotId);
    });
}

export function buildBlockChainKey(block: {
  blockKey?: string | null;
  algorithmBlockKey?: string | null;
  lessonId?: string | null;
  category: string;
  title: string;
}) {
  return (
    block.blockKey ??
    block.algorithmBlockKey ??
    block.lessonId ??
    `${block.category}|${block.title.trim().toLowerCase()}`
  );
}
