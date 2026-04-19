import { LockedDateInput, SessionSlot, SessionType } from "./types";

export type RawMeetingSchedule = {
  id?: string;
  instanceNo?: number | null;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  sessionType: Exclude<SessionType, "any">;
};

export type BuildSlotsInput = {
  courseId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  rawMeetingSchedules: RawMeetingSchedule[];
  lockedDates?: LockedDateInput[];
};

function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMinutesBetween(startTime: string, endTime: string): number {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);

  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;

  if (endTotal <= startTotal) {
    throw new Error(`Invalid session time range: ${startTime} - ${endTime}`);
  }

  return endTotal - startTotal;
}

function isWeekdayScheduled(date: Date, schedules: RawMeetingSchedule[]): boolean {
  return schedules.some((schedule) => schedule.dayOfWeek === date.getDay());
}

function getDatesInRange(startDate: string, endDate: string): Date[] {
  const dates: Date[] = [];
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  for (
    let current = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    current.getTime() <= end.getTime();
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000)
  ) {
    dates.push(new Date(current));
  }

  return dates;
}

function buildLockedDateMap(lockedDates: LockedDateInput[] = []): Map<string, LockedDateInput[]> {
  const map = new Map<string, LockedDateInput[]>();

  for (const locked of lockedDates) {
    const existing = map.get(locked.date) ?? [];
    existing.push(locked);
    map.set(locked.date, existing);
  }

  return map;
}

function buildStableSlotId(courseId: string, date: string, schedule: RawMeetingSchedule): string {
  const stableSuffix =
    schedule.id ??
    `${schedule.dayOfWeek}_${schedule.instanceNo ?? 1}_${schedule.startTime}_${schedule.endTime}_${schedule.sessionType}`;

  return `${courseId}__${date}__${stableSuffix}`;
}

function shouldLockEntireDate(
  lockedEntries: LockedDateInput[]
): { locked: boolean; reason: string | null } {
  const fullDateLock = lockedEntries.find((entry) => entry.appliesToAllSlots);
  if (fullDateLock) {
    return { locked: true, reason: fullDateLock.reason };
  }

  return { locked: false, reason: null };
}

function isSlotSpecificallyLocked(
  slotId: string,
  lockedEntries: LockedDateInput[]
): { locked: boolean; reason: string | null } {
  const slotLock = lockedEntries.find((entry) => entry.slotIds?.includes(slotId));
  if (slotLock) {
    return { locked: true, reason: slotLock.reason };
  }

  return { locked: false, reason: null };
}

function sortSlots(slots: SessionSlot[]): SessionSlot[] {
  return [...slots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;

    const startA = a.startTime ?? "";
    const startB = b.startTime ?? "";
    const timeCompare = startA.localeCompare(startB);
    if (timeCompare !== 0) return timeCompare;

    return a.id.localeCompare(b.id);
  });
}

export function buildSlots(input: BuildSlotsInput): SessionSlot[] {
  const {
    courseId,
    startDate,
    endDate,
    rawMeetingSchedules,
    lockedDates = [],
  } = input;

  if (rawMeetingSchedules.length === 0) {
    return [];
  }

  const allDates = getDatesInRange(startDate, endDate);
  const lockedDateMap = buildLockedDateMap(lockedDates);
  const slots: SessionSlot[] = [];

  for (const date of allDates) {
    const dateString = formatDate(date);

    if (!isWeekdayScheduled(date, rawMeetingSchedules)) {
      continue;
    }

    const matchingSchedules = rawMeetingSchedules.filter(
      (schedule) => schedule.dayOfWeek === date.getDay()
    );
    const dateLocks = lockedDateMap.get(dateString) ?? [];
    const dateLevelLock = shouldLockEntireDate(dateLocks);

    for (const schedule of matchingSchedules) {
      const generatedSlotId = buildStableSlotId(courseId, dateString, schedule);
      const slotLevelLock = isSlotSpecificallyLocked(generatedSlotId, dateLocks);
      const finalLocked = dateLevelLock.locked || slotLevelLock.locked;
      const finalReason = dateLevelLock.reason ?? slotLevelLock.reason ?? null;

      slots.push({
        id: generatedSlotId,
        courseId,
        date: dateString,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        sessionType: schedule.sessionType,
        minutes: getMinutesBetween(schedule.startTime, schedule.endTime),
        locked: finalLocked,
        lockReason: finalReason,
        placements: [],
      });
    }
  }

  return sortSlots(slots);
}
