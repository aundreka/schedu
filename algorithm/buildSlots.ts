import type { SessionSlot, SessionType, WeekdayName } from "./types";

export type RawMeetingSchedule = {
  id: string;
  slotNumber?: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  sessionType: Extract<SessionType, "lecture" | "laboratory">;
};

export type SlotBlackout =
  | string
  | {
      startDate: string;
      endDate?: string | null;
    };

export type BuildSlotsInput = {
  courseId: string;
  startDate: string;
  endDate: string;
  rawMeetingSchedules: RawMeetingSchedule[];
  holidays?: SlotBlackout[];
  termBoundaryDates?: string[];
};

const DAY_NAMES: WeekdayName[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function makeId(prefix: string, ...parts: Array<string | number>) {
  return [prefix, ...parts].join("__").replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(value: string) {
  return new Date(`${value}T00:00:00`);
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function compareSlots(a: SessionSlot, b: SessionSlot) {
  const dateCompare = a.date.localeCompare(b.date);
  if (dateCompare !== 0) return dateCompare;
  const startCompare = (a.startTime ?? "").localeCompare(b.startTime ?? "");
  if (startCompare !== 0) return startCompare;
  return a.id.localeCompare(b.id);
}

function buildHolidaySet(blackouts: SlotBlackout[]) {
  const keys = new Set<string>();

  for (const blackout of blackouts) {
    const startDate = typeof blackout === "string" ? blackout : blackout.startDate;
    const endDate = typeof blackout === "string" ? blackout : blackout.endDate ?? blackout.startDate;
    if (!startDate || !endDate) continue;
    let cursor = fromDateKey(startDate);
    const end = fromDateKey(endDate);
    while (cursor <= end) {
      keys.add(toDateKey(cursor));
      cursor = addDays(cursor, 1);
    }
  }

  return keys;
}

function buildTermLabels(count: number) {
  if (count <= 1) return ["final"];
  if (count === 2) return ["midterm", "final"];
  return ["prelim", "midterm", "final"];
}

export function buildSlots(input: BuildSlotsInput): SessionSlot[] {
  const holidaySet = buildHolidaySet(input.holidays ?? []);
  const sortedSchedules = [...input.rawMeetingSchedules].sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.endTime.localeCompare(b.endTime);
  });

  const generated: SessionSlot[] = [];
  const start = fromDateKey(input.startDate);
  const end = fromDateKey(input.endDate);

  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const dateKey = toDateKey(cursor);
    if (holidaySet.has(dateKey)) continue;

    const dayOfWeek = cursor.getDay();
    const weekday = DAY_NAMES[dayOfWeek];

    for (const schedule of sortedSchedules) {
      if (schedule.dayOfWeek !== dayOfWeek) continue;
      const slotNumber = schedule.slotNumber ?? 1;
      generated.push({
        id: makeId("slot", input.courseId, dateKey, slotNumber, schedule.startTime),
        courseId: input.courseId,
        date: dateKey,
        weekday,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        sessionType: schedule.sessionType,
        minutes: Math.max(0, toMinutes(schedule.startTime, schedule.endTime)),
        locked: false,
        lockReason: null,
        slotNumber,
        seriesKey: schedule.id,
        reservedFor: null,
        placements: [],
      });
    }
  }

  const slots = generated.sort(compareSlots);
  const boundaryDates = Array.from(new Set((input.termBoundaryDates ?? []).filter(Boolean))).sort();
  const termLabels = buildTermLabels(boundaryDates.length || 1);

  if (slots.length === 0) return slots;

  let termIndex = 0;
  let termSlotIndex = 0;

  for (const slot of slots) {
    while (termIndex < boundaryDates.length - 1 && slot.date > boundaryDates[termIndex]) {
      termIndex += 1;
      termSlotIndex = 0;
    }

    termSlotIndex += 1;
    const label = termLabels[Math.min(termIndex, termLabels.length - 1)] ?? `term_${termIndex + 1}`;

    slot.termIndex = termIndex;
    slot.termKey = label;
    slot.termLabel = label[0].toUpperCase() + label.slice(1);
    slot.termSlotIndex = termSlotIndex;
    slot.isTermStart = termSlotIndex === 1;
  }

  const grouped = new Map<number, SessionSlot[]>();
  for (const slot of slots) {
    const key = slot.termIndex ?? 0;
    const current = grouped.get(key) ?? [];
    current.push(slot);
    grouped.set(key, current);
  }

  for (const [groupIndex, groupSlots] of Array.from(grouped.entries())) {
    const first = groupSlots[0];
    const last = groupSlots[groupSlots.length - 1];
    const isFinalTerm = groupIndex === grouped.size - 1;
    const finalBoundaryDate = boundaryDates[boundaryDates.length - 1] ?? null;
    const examReservedSlot =
      isFinalTerm && finalBoundaryDate
        ? groupSlots.find((slot) => slot.date === finalBoundaryDate) ?? last
        : last;
    if (first) {
      if (groupIndex === 0) {
        first.reservedFor = "orientation";
      } else {
        first.reservedFor = "lesson";
      }
    }
    if (groupIndex === 0 && groupSlots[1]) {
      groupSlots[1].reservedFor = "lesson";
    }
    if (last) {
      last.isTermEnd = true;
    }
    if (examReservedSlot) {
      examReservedSlot.reservedFor = "exam";
    }
  }

  return slots;
}

function toMinutes(startTime: string, endTime: string) {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  if (!Number.isFinite(startHour) || !Number.isFinite(startMinute) || !Number.isFinite(endHour) || !Number.isFinite(endMinute)) {
    return 0;
  }
  return endHour * 60 + endMinute - (startHour * 60 + startMinute);
}
