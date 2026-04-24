import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View
} from "react-native";
import { State as GestureState, PinchGestureHandler, Swipeable } from "react-native-gesture-handler";
import { buildBlocks, type BuildBlocksInput } from "../../../algorithm/buildBlocks";
import { compressTermPlan } from "../../../algorithm/compressplan";
import { buildSlots, type RawMeetingSchedule } from "../../../algorithm/buildSlots";
import { buildPacingPlan } from "../../../algorithm/buildPacingPlan";
import { extendTermPlan } from "../../../algorithm/extendplan";
import type { Block, ExamBlockTemplate, SessionSlot, TeacherRules, TOCUnit } from "../../../algorithm/types";
import { validatePlan } from "../../../algorithm/validatePlan";
import { Radius, Spacing, Typography } from "../../../constants/fonts";
import { useAppTheme } from "../../../context/theme";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import {
  buildBlockChainKey,
  buildPlacementSeed,
  buildScheduledCalendarSlots,
  mapBlockRowsToAlgorithmBlocks,
  mapSlotRowsToAlgorithmSlots,
  normalizeWeekdayValue,
  toHm,
  type PlanBlockRow,
  type PlanSlotRow,
  type ScheduledCalendarSlot,
} from "../../../lib/planning";
import { subscribeToLessonPlanRefresh } from "../../../lib/lesson-plan-refresh";
import { supabase } from "../../../lib/supabase";

type ZoomLevel = "daily" | "monthly";

type LessonPlanOption = {
  lesson_plan_id: string;
  user_id: string;
  school_id: string;
  subject_id: string;
  section_id: string;
  title: string;
  start_date: string;
  end_date: string;
  subject_code: string;
  subject_title: string;
  section_name: string;
};

type PlanEntry = {
  plan_entry_id: string;
  lesson_plan_id: string;
  title: string;
  category: string;
  description: string | null;
  scheduled_date: string | null;
  start_time: string | null;
  end_time: string | null;
  meeting_type?: string | null;
  session_category?: string | null;
  session_subcategory?: string | null;
  entry_type?: string | null;
  day?: string | null;
  room?: string | null;
  slot_number?: number | null;
  lesson_id?: string | null;
  is_locked?: boolean | null;
  ww_subtype?: string | null;
  pt_subtype?: string | null;
  root_block_id?: string | null;
  block_key?: string | null;
  algorithm_block_key?: string | null;
  slot_id?: string | null;
  order_no?: number | null;
};

type CalendarConstraint = {
  code: string;
  tier: "hard" | "soft";
  passed: boolean;
  message: string;
};

type CalendarSchedulerDiagnostics = {
  feasible: boolean;
  hardViolations: number;
  softViolations: number;
  constraints: CalendarConstraint[];
};

type CalendarScheduleResult = {
  entries: PlanEntry[];
  slots: ScheduledCalendarSlot[];
  diagnostics: CalendarSchedulerDiagnostics;
};

type DayCell = {
  date: string;
  dayNumber: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  entries: PlanEntry[];
};

type EntryEditorMode = "create" | "edit";

type EntryEditorState = {
  visible: boolean;
  mode: EntryEditorMode;
  targetEntryId: string | null;
  lessonId: string | null;
  title: string;
  description: string;
  category: string;
  subtype: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  reviewDays: string;
};

const DAYS_SHORT = ["S", "M", "T", "W", "T", "F", "S"] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const CATEGORY_STYLE: Record<string, { color: string; chipLabel: string }> = {
  lesson: { color: "#7FB6A1", chipLabel: "L" },
  buffer: { color: "#9CA3AF", chipLabel: "BF" },
  written_work: { color: "#8E9AE6", chipLabel: "WW" },
  performance_task: { color: "#CE6E73", chipLabel: "PT" },
  exam: { color: "#D49C49", chipLabel: "EX" },
};

function toLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function makeId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function parseDateFromIso(iso: string) {
  const [y, m, d] = iso.split("-").map((part) => Number(part));
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(iso: string, days: number) {
  const date = parseDateFromIso(iso);
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

function startOfWeek(iso: string) {
  const date = parseDateFromIso(iso);
  return addDays(iso, -date.getDay());
}

function startOfMonth(iso: string) {
  const date = parseDateFromIso(iso);
  return toLocalDateString(new Date(date.getFullYear(), date.getMonth(), 1));
}

function monthTitle(iso: string) {
  const date = parseDateFromIso(iso);
  return `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

function longDateTitle(iso: string) {
  const date = parseDateFromIso(iso);
  return `${WEEKDAY_LONG[date.getDay()]}, ${MONTHS_LONG[date.getMonth()]} ${date.getDate()}`;
}

function entrySort(a: PlanEntry, b: PlanEntry) {
  const priority: Record<string, number> = {
    lesson: 0,
    written_work: 1,
    performance_task: 2,
    buffer: 3,
    exam: 4,
  };
  const pa = priority[a.category] ?? 99;
  const pb = priority[b.category] ?? 99;
  if (pa !== pb) return pa - pb;
  const aTime = a.start_time || "99:99:99";
  const bTime = b.start_time || "99:99:99";
  if (aTime !== bTime) return aTime.localeCompare(bTime);
  return a.title.localeCompare(b.title);
}

function getEntryColor(category: string) {
  return CATEGORY_STYLE[category]?.color ?? "#B6C0CC";
}

function getChipLabel(entry: PlanEntry) {
  if (entry.category === "lesson") {
    const matched = entry.title.match(/lesson\s*\d+/i);
    return matched ? matched[0].replace(/\s+/g, " ") : "L";
  }
  return CATEGORY_STYLE[entry.category]?.chipLabel ?? "PL";
}

function getDailySlotDisplayTitle(slot: ScheduledCalendarSlot) {
  const primaryBlock = slot.blocks[0] ?? null;
  if (primaryBlock?.title?.trim()) return primaryBlock.title.trim();
  if (slot.title?.trim()) return slot.title.trim();
  return `Slot ${slot.slotNumber ?? ""}`.trim();
}

function getDailySlotCardStyle(slot: ScheduledCalendarSlot, isDark: boolean, defaultCardBg: string) {
  const primaryBlock = slot.blocks[0] ?? null;
  if (primaryBlock?.category === "buffer") {
    return isDark ? "#1F2937" : "#E5E7EB";
  }
  return defaultCardBg;
}

function stripHtmlTags(value: string | null | undefined) {
  if (!value) return "";
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUuid(value: string | null | undefined) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizedEntryTitle(title: string) {
  return title
    .replace(/\s*\(part\s*\d+\s*\/\s*\d+\)\s*$/i, "")
    .replace(/\s*\(cont\.\s*\d+\s*\/\s*\d+\)\s*$/i, "")
    .trim()
    .toLowerCase();
}

function entryChainKey(entry: PlanEntry) {
  return buildBlockChainKey({
    blockKey: entry.block_key,
    algorithmBlockKey: entry.algorithm_block_key,
    lessonId: entry.lesson_id,
    category: entry.category,
    title: normalizedEntryTitle(entry.title),
  });
}

function getEditableEntryId(entry: PlanEntry) {
  if (isUuid(entry.root_block_id)) return entry.root_block_id ?? null;
  if (isUuid(entry.plan_entry_id)) return entry.plan_entry_id;
  return null;
}

function parseSqlTime(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const matched = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!matched) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  const second = Number(matched[3] ?? "0");
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function inferExamSubtype(title: string, description: string | null) {
  const text = `${title} ${description ?? ""}`.toLowerCase();
  if (text.includes("prelim")) return "prelim";
  if (text.includes("midterm")) return "midterm";
  return "final";
}

function inferPerformanceTaskSubtype(title: string, description: string | null) {
  const text = `${title} ${description ?? ""}`.toLowerCase();
  if (text.includes("lab report")) return "lab_report";
  if (text.includes("reporting")) return "reporting";
  if (text.includes("project")) return "project";
  return "activity";
}

function defaultSubtypeForCategory(category: string) {
  if (category === "lesson") return "lecture";
  if (category === "written_work") return "assignment";
  if (category === "performance_task") return "activity";
  if (category === "exam") return "final";
  if (category === "buffer") return "review";
  return "";
}

function subtypesForCategory(category: string) {
  if (category === "lesson") return ["lecture", "laboratory"];
  if (category === "written_work") return ["assignment", "seatwork", "quiz"];
  if (category === "performance_task") return ["activity", "lab_report", "reporting", "project"];
  if (category === "exam") return ["prelim", "midterm", "final"];
  if (category === "buffer") return ["review", "preparation", "other"];
  return [];
}

function buildPlanEntriesFromScheduledSlots(slots: ScheduledCalendarSlot[]): PlanEntry[] {
  return slots.flatMap((slot) =>
    slot.blocks.map((block) => ({
      plan_entry_id: block.blockId,
      lesson_plan_id: block.lessonPlanId,
      title: block.title,
      category: block.category,
      description: block.description,
      scheduled_date: block.scheduledDate,
      start_time: block.startTime ? `${block.startTime}:00` : null,
      end_time: block.endTime ? `${block.endTime}:00` : null,
      meeting_type: block.meetingType,
      session_category: block.category,
      session_subcategory: block.subcategory,
      entry_type: "planned_item",
      day: slot.weekday,
      room: slot.room,
      slot_number: slot.slotNumber,
      lesson_id: block.lessonId,
      is_locked: block.isLocked,
      ww_subtype: block.wwSubtype,
      pt_subtype: block.ptSubtype,
      root_block_id: block.rootBlockId,
      block_key: block.blockKey,
      algorithm_block_key: block.algorithmBlockKey,
      slot_id: block.slotId,
      order_no: block.orderNo,
    }))
  );
}

function toCalendarDiagnostics(issues: CalendarConstraint[]) {
  const hardViolations = issues.filter((issue) => issue.tier === "hard" && !issue.passed).length;
  const softViolations = issues.filter((issue) => issue.tier === "soft" && !issue.passed).length;
  return {
    feasible: hardViolations === 0,
    hardViolations,
    softViolations,
    constraints: issues,
  } satisfies CalendarSchedulerDiagnostics;
}

function inferSessionType(value: string | null | undefined): "lecture" | "laboratory" {
  return value === "laboratory" ? "laboratory" : "lecture";
}

function buildRecurringSchedulesFromSlotRows(slotRows: PlanSlotRow[]): RawMeetingSchedule[] {
  const unique = new Map<string, RawMeetingSchedule>();

  for (const slot of slotRows) {
    if (!slot.weekday || !slot.start_time || !slot.end_time) continue;
    if (slot.series_key?.startsWith("manual_slot__")) continue;

    const weekday = normalizeWeekdayValue(slot.weekday);
    if (!weekday) continue;
    const dayOfWeek = WEEKDAY_LONG.findIndex((label) => label.toLowerCase() === weekday);
    if (dayOfWeek < 0) continue;

    const startTime = toHm(slot.start_time);
    const endTime = toHm(slot.end_time);
    if (!startTime || !endTime) continue;

    const sessionType = inferSessionType(slot.meeting_type ?? slot.room);
    const id = slot.series_key ?? `${weekday}_${startTime}_${endTime}_${sessionType}_${slot.slot_number ?? 1}`;
    const key = `${dayOfWeek}|${startTime}|${endTime}|${sessionType}|${slot.slot_number ?? 1}|${id}`;
    if (unique.has(key)) continue;

    unique.set(key, {
      id,
      slotNumber: slot.slot_number ?? 1,
      dayOfWeek,
      startTime,
      endTime,
      sessionType,
    });
  }

  return Array.from(unique.values());
}

function inferLessonOrder(title: string, fallback: number) {
  const matched = title.match(/lesson\s+(\d+)/i);
  return matched ? Number(matched[1]) : fallback;
}

function buildTocUnitsFromBlockRows(lessonPlanId: string, blockRows: PlanBlockRow[]): TOCUnit[] {
  const requiredLessons = blockRows
    .filter((block) => block.session_category === "lesson")
    .filter((block) => Boolean(block.required))
    .filter((block) => !Boolean(block.metadata?.manual))
    .filter((block) => block.metadata?.extraCandidateType !== "lesson_extension");

  const deduped = new Map<string, TOCUnit>();

  requiredLessons.forEach((block, index) => {
    const sourceId =
      (typeof block.metadata?.sourceTocId === "string" && block.metadata.sourceTocId) ||
      block.lesson_id ||
      block.block_key ||
      block.algorithm_block_key ||
      block.block_id;
    if (deduped.has(sourceId)) return;

    const difficultyValue = block.metadata?.lessonDifficulty;
    const difficulty =
      difficultyValue === "easy" || difficultyValue === "medium" || difficultyValue === "high"
        ? difficultyValue
        : "medium";

    deduped.set(sourceId, {
      id: sourceId,
      courseId: lessonPlanId,
      chapterId: typeof block.metadata?.chapterId === "string" ? block.metadata.chapterId : null,
      chapterTitle: typeof block.metadata?.chapterTitle === "string" ? block.metadata.chapterTitle : null,
      title: block.title,
      order:
        typeof block.metadata?.lessonOrder === "number"
          ? Number(block.metadata.lessonOrder)
          : inferLessonOrder(block.title, index + 1),
      estimatedMinutes: Math.max(30, Number(block.estimated_minutes ?? 60)),
      difficulty,
      preferredSessionType: inferSessionType(block.preferred_session_type ?? block.meeting_type),
      required: true,
    });
  });

  return Array.from(deduped.values()).sort((a, b) => a.order - b.order);
}

function buildExamTemplatesFromBlockRows(blockRows: PlanBlockRow[]): ExamBlockTemplate[] {
  const templates = blockRows
    .filter((block) => block.session_category === "exam")
    .filter((block) => Boolean(block.required))
    .filter((block) => !Boolean(block.metadata?.manual))
    .map((block) => ({
      id: block.block_key || block.algorithm_block_key || block.block_id,
      title: block.title,
      estimatedMinutes: Math.max(30, Number(block.estimated_minutes ?? 90)),
      subcategory: (
        block.session_subcategory === "prelim" ||
        block.session_subcategory === "midterm" ||
        block.session_subcategory === "final"
          ? block.session_subcategory
          : inferExamSubtype(block.title, block.description ?? null)
      ) as ExamBlockTemplate["subcategory"],
      preferredDate:
        typeof block.metadata?.preferredDate === "string"
          ? block.metadata.preferredDate
          : null,
      required: true,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return templates.length > 0
    ? templates
    : [
        {
          id: "final_exam_fallback",
          title: "Final Exam",
          estimatedMinutes: 90,
          subcategory: "final",
          preferredDate: null,
          required: true,
        },
      ];
}

function buildTeacherRulesFromBlockRows(blockRows: PlanBlockRow[]): TeacherRules {
  const requiredWrittenWorks = blockRows.filter(
    (block) =>
      block.session_category === "written_work" &&
      Boolean(block.required) &&
      block.session_subcategory !== "quiz" &&
      !Boolean(block.metadata?.lowPriority)
  ).length;
  const requiredPerformanceTasks = blockRows.filter(
    (block) =>
      block.session_category === "performance_task" &&
      Boolean(block.required) &&
      !Boolean(block.metadata?.lowPriority)
  ).length;
  const requiredExams = blockRows.filter(
    (block) => block.session_category === "exam" && Boolean(block.required)
  ).length;

  return {
    quizMode: "hybrid",
    quizEveryNLessons: 3,
    writtenWorkMode: "total",
    minWW: Math.max(0, requiredWrittenWorks),
    allowLessonWrittenWorkOverlay: true,
    preferLessonWrittenWorkOverlay: true,
    minPT: Math.max(0, requiredPerformanceTasks),
    includeReviewBeforeExam: requiredExams > 0,
  };
}

function buildGeneratedSlotKey(slot: {
  date: string;
  startTime: string | null | undefined;
  endTime: string | null | undefined;
  sessionType: string | null | undefined;
  slotNumber?: number | null;
  seriesKey?: string | null;
}) {
  return [
    slot.date,
    slot.startTime ?? "",
    slot.endTime ?? "",
    slot.sessionType ?? "",
    String(slot.slotNumber ?? ""),
    slot.seriesKey ?? "",
  ].join("|");
}

function buildBlockMap(blocks: Block[]) {
  return new Map(blocks.map((block) => [block.id, block]));
}

function getMajorPlacement(slot: SessionSlot) {
  return slot.placements.find((placement) => placement.lane === "major") ?? null;
}

function rebuildSlotPlacementOrder(slot: SessionSlot, blockMap: Map<string, Block>) {
  const rank = (placement: { blockId: string; lane: "major" | "minor" }) => {
    const block = blockMap.get(placement.blockId);
    if (!block) return 99;
    if (block.type === "lesson") return 1;
    if (block.type === "written_work" && block.subcategory !== "quiz") return 2;
    if (block.type === "performance_task") return 3;
    if (block.type === "written_work" && block.subcategory === "quiz") return 4;
    if (block.type === "buffer") return 5;
    if (block.type === "exam") return 6;
    return 99;
  };

  slot.placements = [...slot.placements]
    .sort((a, b) => rank(a) - rank(b) || a.blockId.localeCompare(b.blockId))
    .map((placement, index) => ({
      ...placement,
      id: `placement__${placement.blockId}__${slot.id}__${index + 1}`,
      slotId: slot.id,
    }));
}

function makePlacementId(blockId: string, slotId: string, order: number) {
  return `placement__${blockId}__${slotId}__${order}`;
}

function addRecoveredPlacement(
  slot: SessionSlot,
  block: Block,
  lane: "major" | "minor"
) {
  slot.placements.push({
    id: makePlacementId(block.id, slot.id, slot.placements.length + 1),
    blockId: block.id,
    slotId: slot.id,
    lane,
    minutesUsed: Math.min(slot.minutes || block.estimatedMinutes, block.estimatedMinutes),
    chainId: block.id,
    segmentIndex: 1,
    segmentCount: 1,
    continuesFromPrevious: false,
    continuesToNext: false,
    startTime: null,
    endTime: null,
  });
}

function createMajorGapAt(termSlots: SessionSlot[], targetIndex: number) {
  const sortedTermSlots = [...termSlots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });
  const lastUsableIndex = Math.max(0, sortedTermSlots.length - 2);
  if (targetIndex < 0 || targetIndex > lastUsableIndex) return false;
  const targetSlot = sortedTermSlots[targetIndex];
  if (!targetSlot || targetSlot.locked) return false;
  if (!getMajorPlacement(targetSlot)) return true;

  let emptyIndex = -1;
  for (let index = lastUsableIndex; index >= targetIndex; index -= 1) {
    const slot = sortedTermSlots[index];
    if (!slot || slot.locked || getMajorPlacement(slot)) continue;
    emptyIndex = index;
    break;
  }
  if (emptyIndex === -1) return false;

  for (let index = emptyIndex; index > targetIndex; index -= 1) {
    swapMajorPlacements(sortedTermSlots, index - 1, index);
  }

  return !getMajorPlacement(sortedTermSlots[targetIndex]!);
}

function recoverMissingRequiredBlocks(termSlots: SessionSlot[], termBlocks: Block[]) {
  const sortedTermSlots = [...termSlots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });
  const blockMap = buildBlockMap(termBlocks);
  const placedIds = new Set(sortedTermSlots.flatMap((slot) => slot.placements.map((placement) => placement.blockId)));
  const examIndex = sortedTermSlots.findIndex((slot) => {
    const major = getMajorPlacement(slot);
    const block = major ? blockMap.get(major.blockId) ?? null : null;
    return block?.type === "exam";
  });
  const lastUsableIndex = examIndex >= 0 ? examIndex - 1 : sortedTermSlots.length - 1;

  const findAnchorSlotIndex = (preferredOrderKey: string, preferredOrder: number) => {
    const exact = sortedTermSlots.findIndex((slot) =>
      slot.placements.some((placement) => {
        const block = blockMap.get(placement.blockId);
        return Number(block?.metadata[preferredOrderKey] ?? -1) === preferredOrder;
      })
    );
    if (exact >= 0) return exact;

    const lessonIndex = sortedTermSlots.findIndex((slot) => {
      const major = getMajorPlacement(slot);
      const block = major ? blockMap.get(major.blockId) ?? null : null;
      return block?.type === "lesson" && Number(block.metadata.lessonOrder ?? -1) >= preferredOrder;
    });
    if (lessonIndex >= 0) return lessonIndex;

    for (let index = 0; index <= lastUsableIndex; index += 1) {
      const slot = sortedTermSlots[index]!;
      const major = getMajorPlacement(slot);
      const block = major ? blockMap.get(major.blockId) ?? null : null;
      if (!slot.locked && block?.type !== "exam") return index;
    }

    return Math.max(0, lastUsableIndex);
  };

  const placeMinorFallback = (block: Block, preferredIndex: number) => {
    const boundedIndex = Math.max(0, Math.min(preferredIndex, lastUsableIndex));
    for (let offset = 0; offset <= lastUsableIndex; offset += 1) {
      const leftIndex = boundedIndex - offset;
      const rightIndex = boundedIndex + offset;
      const candidates = [leftIndex, rightIndex].filter(
        (index, candidateIndex, arr) =>
          index >= 0 &&
          index <= lastUsableIndex &&
          arr.indexOf(index) === candidateIndex
      );
      for (const index of candidates) {
        const slot = sortedTermSlots[index]!;
        if (slot.locked) continue;
        const major = getMajorPlacement(slot);
        const majorBlock = major ? blockMap.get(major.blockId) ?? null : null;
        if (majorBlock?.type === "exam") continue;
        addRecoveredPlacement(slot, block, "minor");
        placedIds.add(block.id);
        return true;
      }
    }
    return false;
  };

  const placeMajorBlock = (
    block: Block,
    preferredIndex: number,
    allowMinorFallback = false
  ) => {
    if (placedIds.has(block.id)) return;
    const boundedIndex = Math.max(0, Math.min(preferredIndex, lastUsableIndex));
    if (createMajorGapAt(sortedTermSlots, boundedIndex)) {
      addRecoveredPlacement(sortedTermSlots[boundedIndex]!, block, "major");
      placedIds.add(block.id);
      return;
    }

    for (let index = 0; index <= lastUsableIndex; index += 1) {
      const slot = sortedTermSlots[index]!;
      if (slot.locked || getMajorPlacement(slot)) continue;
      addRecoveredPlacement(slot, block, "major");
      placedIds.add(block.id);
      return;
    }

    if (allowMinorFallback) {
      placeMinorFallback(block, boundedIndex);
    }
  };

  const placeMinorBlock = (block: Block, preferredIndex: number) => {
    if (placedIds.has(block.id)) return;
    placeMinorFallback(block, preferredIndex);
  };

  const missingLessons = termBlocks
    .filter((block) => block.type === "lesson" && !block.metadata.extraCandidateType && !placedIds.has(block.id))
    .sort((a, b) => Number(a.metadata.lessonOrder ?? 0) - Number(b.metadata.lessonOrder ?? 0));
  for (const block of missingLessons) {
    const targetIndex = findAnchorSlotIndex("lessonOrder", Number(block.metadata.lessonOrder ?? 0));
    placeMajorBlock(block, targetIndex);
  }

  const missingPerformanceTasks = termBlocks
    .filter(
      (block) =>
        block.type === "performance_task" &&
        !block.metadata.extraCandidateType &&
        !placedIds.has(block.id)
    )
    .sort((a, b) => Number(a.metadata.ptOrder ?? 0) - Number(b.metadata.ptOrder ?? 0));
  for (const block of missingPerformanceTasks) {
    const targetIndex = findAnchorSlotIndex("ptOrder", Number(block.metadata.ptOrder ?? 0));
    placeMajorBlock(block, targetIndex, true);
  }

  const missingWrittenWorks = termBlocks
    .filter(
      (block) =>
        block.type === "written_work" &&
        block.subcategory !== "quiz" &&
        !block.metadata.extraCandidateType &&
        !placedIds.has(block.id)
    )
    .sort((a, b) => Number(a.metadata.wwOrder ?? 0) - Number(b.metadata.wwOrder ?? 0));
  for (const block of missingWrittenWorks) {
    const targetIndex = findAnchorSlotIndex("wwOrder", Number(block.metadata.wwOrder ?? 0));
    placeMinorBlock(block, targetIndex);
  }

  const missingQuizzes = termBlocks
    .filter(
      (block) =>
        block.type === "written_work" &&
        block.subcategory === "quiz" &&
        !placedIds.has(block.id)
    )
    .sort((a, b) => Number(a.metadata.quizOrder ?? 0) - Number(b.metadata.quizOrder ?? 0));
  const finalQuizId =
    termBlocks
      .filter((block) => block.type === "written_work" && block.subcategory === "quiz")
      .sort((a, b) => Number(b.metadata.quizOrder ?? 0) - Number(a.metadata.quizOrder ?? 0))[0]?.id ??
    null;
  for (const block of missingQuizzes) {
    const targetIndex = findAnchorSlotIndex("quizOrder", Number(block.metadata.quizOrder ?? 0));
    placeMajorBlock(block, targetIndex, block.id !== finalQuizId);
  }

  sortedTermSlots.forEach((slot) => rebuildSlotPlacementOrder(slot, blockMap));
}

function swapMajorPlacements(termSlots: SessionSlot[], fromIndex: number, toIndex: number) {
  const fromSlot = termSlots[fromIndex];
  const toSlot = termSlots[toIndex];
  if (!fromSlot || !toSlot) return false;
  const fromMajor = getMajorPlacement(fromSlot);
  const toMajor = getMajorPlacement(toSlot);
  if (!fromMajor) return false;

  fromSlot.placements = fromSlot.placements.filter((placement) => placement.blockId !== fromMajor.blockId);
  if (toMajor) {
    toSlot.placements = toSlot.placements.filter((placement) => placement.blockId !== toMajor.blockId);
    fromSlot.placements.push({
      ...toMajor,
      slotId: fromSlot.id,
      id: `placement__${toMajor.blockId}__${fromSlot.id}__${fromSlot.placements.length + 1}`,
    });
  }
  toSlot.placements.push({
    ...fromMajor,
    slotId: toSlot.id,
    id: `placement__${fromMajor.blockId}__${toSlot.id}__${toSlot.placements.length + 1}`,
  });
  return true;
}

function normalizeTermPlacements(termSlots: SessionSlot[], termBlocks: Block[]) {
  const sortedTermSlots = [...termSlots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });
  const blockMap = buildBlockMap(termBlocks);

  const reorderMajorsByKey = (matcher: (block: Block) => boolean, orderKey: string) => {
    const indexes = sortedTermSlots
      .map((slot, index) => {
        const major = getMajorPlacement(slot);
        const block = major ? blockMap.get(major.blockId) ?? null : null;
        return block && matcher(block) ? index : -1;
      })
      .filter((index) => index >= 0);
    const blocks = indexes
      .map((index) => {
        const major = getMajorPlacement(sortedTermSlots[index]!);
        return major ? blockMap.get(major.blockId) ?? null : null;
      })
      .filter((block): block is Block => Boolean(block))
      .sort((a, b) => Number(a.metadata[orderKey] ?? 0) - Number(b.metadata[orderKey] ?? 0));

    indexes.forEach((slotIndex, blockIndex) => {
      const targetBlock = blocks[blockIndex];
      if (!targetBlock) return;
      const currentIndex = sortedTermSlots.findIndex(
        (slot) => getMajorPlacement(slot)?.blockId === targetBlock.id
      );
      if (currentIndex >= 0 && currentIndex !== slotIndex) {
        swapMajorPlacements(sortedTermSlots, currentIndex, slotIndex);
      }
    });
  };

  const reorderMinorByKey = (matcher: (block: Block) => boolean, orderKey: string) => {
    const carriers = sortedTermSlots
      .map((slot) => ({
        slot,
        placements: slot.placements.filter((placement) => {
          const block = blockMap.get(placement.blockId);
          return block ? matcher(block) : false;
        }),
      }))
      .filter((entry) => entry.placements.length > 0);
    const orderedBlocks = carriers
      .flatMap((entry) => entry.placements.map((placement) => blockMap.get(placement.blockId) ?? null))
      .filter((block): block is Block => Boolean(block))
      .sort((a, b) => Number(a.metadata[orderKey] ?? 0) - Number(b.metadata[orderKey] ?? 0));

    let cursor = 0;
    for (const carrier of carriers) {
      carrier.slot.placements = carrier.slot.placements.filter((placement) => {
        const block = blockMap.get(placement.blockId);
        return block ? !matcher(block) : true;
      });
      for (let index = 0; index < carrier.placements.length; index += 1) {
        const block = orderedBlocks[cursor];
        if (!block) continue;
        carrier.slot.placements.push({
          id: `placement__${block.id}__${carrier.slot.id}__${carrier.slot.placements.length + 1}`,
          blockId: block.id,
          slotId: carrier.slot.id,
          lane: "minor",
          minutesUsed: Math.min(carrier.slot.minutes || block.estimatedMinutes, block.estimatedMinutes),
          chainId: block.id,
          segmentIndex: 1,
          segmentCount: 1,
          continuesFromPrevious: false,
          continuesToNext: false,
          startTime: null,
          endTime: null,
        });
        cursor += 1;
      }
    }
  };

  reorderMajorsByKey((block) => block.type === "lesson", "lessonOrder");
  reorderMajorsByKey((block) => block.type === "performance_task" && !block.metadata.extraCandidateType, "ptOrder");
  reorderMajorsByKey((block) => block.type === "written_work" && block.subcategory === "quiz", "quizOrder");
  reorderMinorByKey((block) => block.type === "written_work" && block.subcategory !== "quiz", "wwOrder");

  const examIndex = sortedTermSlots.findIndex((slot) => {
    const major = getMajorPlacement(slot);
    const block = major ? blockMap.get(major.blockId) ?? null : null;
    return block?.type === "exam";
  });
  const examReviewIndex = sortedTermSlots.findIndex((slot) => {
    const major = getMajorPlacement(slot);
    const block = major ? blockMap.get(major.blockId) ?? null : null;
    return block?.metadata.extraCandidateType === "review_before_exam";
  });
  const quizBlocks = termBlocks
    .filter((block) => block.type === "written_work" && block.subcategory === "quiz")
    .sort((a, b) => Number(a.metadata.quizOrder ?? 0) - Number(b.metadata.quizOrder ?? 0));
  const finalQuiz = quizBlocks[quizBlocks.length - 1] ?? null;

  if (examIndex > 0 && finalQuiz) {
    const targetQuizIndex = examReviewIndex === examIndex - 1 ? examIndex - 2 : examIndex - 1;
    const currentQuizIndex = sortedTermSlots.findIndex(
      (slot) => getMajorPlacement(slot)?.blockId === finalQuiz.id
    );
    if (targetQuizIndex >= 0 && currentQuizIndex >= 0 && currentQuizIndex !== targetQuizIndex) {
      swapMajorPlacements(sortedTermSlots, currentQuizIndex, targetQuizIndex);
    }
  }

  sortedTermSlots.forEach((slot) => rebuildSlotPlacementOrder(slot, blockMap));
}

function validateAdjustedTerm(termSlots: SessionSlot[], termBlocks: Block[]) {
  const sortedTermSlots = [...termSlots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });
  const blockMap = buildBlockMap(termBlocks);
  const examBlock = termBlocks.find((block) => block.type === "exam") ?? null;
  if (!examBlock) return;

  const placedIds = new Set(sortedTermSlots.flatMap((slot) => slot.placements.map((placement) => placement.blockId)));
  const placedLessons = termBlocks.filter((block) => block.type === "lesson" && !block.metadata.extraCandidateType && placedIds.has(block.id)).length;
  const placedWW = termBlocks.filter((block) => block.type === "written_work" && block.subcategory !== "quiz" && !block.metadata.extraCandidateType && placedIds.has(block.id)).length;
  const placedPT = termBlocks.filter((block) => block.type === "performance_task" && !block.metadata.extraCandidateType && placedIds.has(block.id)).length;
  const placedQuiz = termBlocks.filter((block) => block.type === "written_work" && block.subcategory === "quiz" && placedIds.has(block.id)).length;

  const expectedLessons = Number(examBlock.metadata.termLessons ?? 0);
  const expectedWW = Number(examBlock.metadata.termWW ?? 0);
  const expectedPT = Number(examBlock.metadata.termPT ?? 0);
  const expectedQuiz = Number(examBlock.metadata.termQuizAmount ?? 0);

  if (
    placedLessons !== expectedLessons ||
    placedWW !== expectedWW ||
    placedPT !== expectedPT ||
    placedQuiz !== expectedQuiz
  ) {
    const missingParts: string[] = [];
    if (placedLessons !== expectedLessons) {
      missingParts.push(`lessons ${placedLessons}/${expectedLessons}`);
    }
    if (placedWW !== expectedWW) {
      missingParts.push(`written works ${placedWW}/${expectedWW}`);
    }
    if (placedPT !== expectedPT) {
      missingParts.push(`performance tasks ${placedPT}/${expectedPT}`);
    }
    if (placedQuiz !== expectedQuiz) {
      missingParts.push(`quizzes ${placedQuiz}/${expectedQuiz}`);
    }
    throw new Error(
      `Term requirements are no longer fully scheduled after this adjustment (${missingParts.join(", ")}).`
    );
  }

  const placedBlocks = sortedTermSlots
    .flatMap((slot) =>
      slot.placements.map((placement) => ({
        slot,
        placement,
        block: blockMap.get(placement.blockId) ?? null,
      }))
    )
    .filter(
      (item): item is { slot: SessionSlot; placement: SessionSlot["placements"][number]; block: Block } =>
        Boolean(item.block)
    );
  const majorBlocks = sortedTermSlots
    .map((slot) => {
      const major = getMajorPlacement(slot);
      return major ? blockMap.get(major.blockId) ?? null : null;
    })
    .filter((block): block is Block => Boolean(block));
  const lessonsInOrder = majorBlocks
    .filter((block) => block.type === "lesson")
    .every((block, index, list) => index === 0 || Number(list[index - 1]!.metadata.lessonOrder ?? 0) <= Number(block.metadata.lessonOrder ?? 0));
  const ptInOrder = majorBlocks
    .filter((block) => block.type === "performance_task" && !block.metadata.extraCandidateType)
    .every((block, index, list) => index === 0 || Number(list[index - 1]!.metadata.ptOrder ?? 0) <= Number(block.metadata.ptOrder ?? 0));
  const quizInOrder = majorBlocks
    .filter((block) => block.type === "written_work" && block.subcategory === "quiz")
    .every((block, index, list) => index === 0 || Number(list[index - 1]!.metadata.quizOrder ?? 0) <= Number(block.metadata.quizOrder ?? 0));
  const wwInOrder = placedBlocks
    .map((item) => item.block)
    .filter((block) => block.type === "written_work" && block.subcategory !== "quiz" && !block.metadata.extraCandidateType)
    .every((block, index, list) => index === 0 || Number(list[index - 1]!.metadata.wwOrder ?? 0) <= Number(block.metadata.wwOrder ?? 0));
  const ptPlacedInOrder = placedBlocks
    .map((item) => item.block)
    .filter((block) => block.type === "performance_task" && !block.metadata.extraCandidateType)
    .every((block, index, list) => index === 0 || Number(list[index - 1]!.metadata.ptOrder ?? 0) <= Number(block.metadata.ptOrder ?? 0));

  const examIndex = sortedTermSlots.findIndex((slot) => {
    const major = getMajorPlacement(slot);
    const block = major ? blockMap.get(major.blockId) ?? null : null;
    return block?.type === "exam";
  });
  const examReviewIndex = sortedTermSlots.findIndex((slot) => {
    const major = getMajorPlacement(slot);
    const block = major ? blockMap.get(major.blockId) ?? null : null;
    return block?.metadata.extraCandidateType === "review_before_exam";
  });
  const finalQuizIndex = sortedTermSlots.findIndex((slot) => {
    const major = getMajorPlacement(slot);
    return major?.blockId === termBlocks
      .filter((block) => block.type === "written_work" && block.subcategory === "quiz")
      .sort((a, b) => Number(b.metadata.quizOrder ?? 0) - Number(a.metadata.quizOrder ?? 0))[0]?.id;
  });
  const expectedFinalQuizIndex = examIndex >= 0
    ? (examReviewIndex === examIndex - 1 ? examIndex - 2 : examIndex - 1)
    : -1;
  const hasLessonAfterFinalQuiz =
    finalQuizIndex >= 0 &&
    sortedTermSlots
      .slice(finalQuizIndex + 1, examIndex >= 0 ? examIndex : undefined)
      .some((slot) => {
        const major = getMajorPlacement(slot);
        const block = major ? blockMap.get(major.blockId) ?? null : null;
        return block?.type === "lesson";
      });

  if (!lessonsInOrder || !ptInOrder || !ptPlacedInOrder || !quizInOrder || !wwInOrder) {
    throw new Error("Term block ordering became invalid after this adjustment.");
  }
  if (expectedFinalQuizIndex >= 0 && finalQuizIndex !== expectedFinalQuizIndex) {
    throw new Error("Final quiz placement is invalid for this term.");
  }
  if (hasLessonAfterFinalQuiz) {
    throw new Error("Lessons cannot appear after the final quiz in a term.");
  }
}

function collectPlacedCoreBlockIds(termSlots: SessionSlot[], termBlocks: Block[]) {
  const placedIds = new Set(termSlots.flatMap((slot) => slot.placements.map((placement) => placement.blockId)));

  return {
    lessons: new Set(
      termBlocks
        .filter((block) => block.type === "lesson" && !block.metadata.extraCandidateType)
        .map((block) => block.id)
        .filter((id) => placedIds.has(id))
    ),
    writtenWorks: new Set(
      termBlocks
        .filter(
          (block) =>
            block.type === "written_work" &&
            block.subcategory !== "quiz" &&
            !block.metadata.extraCandidateType
        )
        .map((block) => block.id)
        .filter((id) => placedIds.has(id))
    ),
    performanceTasks: new Set(
      termBlocks
        .filter((block) => block.type === "performance_task" && !block.metadata.extraCandidateType)
        .map((block) => block.id)
        .filter((id) => placedIds.has(id))
    ),
    quizzes: new Set(
      termBlocks
        .filter((block) => block.type === "written_work" && block.subcategory === "quiz")
        .map((block) => block.id)
        .filter((id) => placedIds.has(id))
    ),
  };
}

function diffPlacedCoreBlockIds(
  before: ReturnType<typeof collectPlacedCoreBlockIds>,
  after: ReturnType<typeof collectPlacedCoreBlockIds>
) {
  const missingLessons = Array.from(before.lessons).filter((id) => !after.lessons.has(id));
  const missingWrittenWorks = Array.from(before.writtenWorks).filter((id) => !after.writtenWorks.has(id));
  const missingPerformanceTasks = Array.from(before.performanceTasks).filter((id) => !after.performanceTasks.has(id));
  const missingQuizzes = Array.from(before.quizzes).filter((id) => !after.quizzes.has(id));

  return {
    missingLessons,
    missingWrittenWorks,
    missingPerformanceTasks,
    missingQuizzes,
    hasMissing:
      missingLessons.length > 0 ||
      missingWrittenWorks.length > 0 ||
      missingPerformanceTasks.length > 0 ||
      missingQuizzes.length > 0,
  };
}

function formatMissingCoreBlockIds(diff: ReturnType<typeof diffPlacedCoreBlockIds>) {
  const parts: string[] = [];
  if (diff.missingLessons.length > 0) {
    parts.push(`L: ${diff.missingLessons.join(", ")}`);
  }
  if (diff.missingWrittenWorks.length > 0) {
    parts.push(`WW: ${diff.missingWrittenWorks.join(", ")}`);
  }
  if (diff.missingPerformanceTasks.length > 0) {
    parts.push(`PT: ${diff.missingPerformanceTasks.join(", ")}`);
  }
  if (diff.missingQuizzes.length > 0) {
    parts.push(`Q: ${diff.missingQuizzes.join(", ")}`);
  }
  return parts.join(" | ");
}

function ensureTermBlockInventory(termBlocks: Block[]) {
  const examBlock = termBlocks.find((block) => block.type === "exam") ?? null;
  if (!examBlock) return;

  const availableLessons = termBlocks.filter(
    (block) => block.type === "lesson" && !block.metadata.extraCandidateType
  ).length;
  const availableWW = termBlocks.filter(
    (block) =>
      block.type === "written_work" &&
      block.subcategory !== "quiz" &&
      !block.metadata.extraCandidateType
  ).length;
  const availablePT = termBlocks.filter(
    (block) => block.type === "performance_task" && !block.metadata.extraCandidateType
  ).length;
  const availableQuiz = termBlocks.filter(
    (block) => block.type === "written_work" && block.subcategory === "quiz"
  ).length;

  const expectedLessons = Number(examBlock.metadata.termLessons ?? 0);
  const expectedWW = Number(examBlock.metadata.termWW ?? 0);
  const expectedPT = Number(examBlock.metadata.termPT ?? 0);
  const expectedQuiz = Number(examBlock.metadata.termQuizAmount ?? 0);

  const missingParts: string[] = [];
  if (availableLessons < expectedLessons) {
    missingParts.push(`lessons ${availableLessons}/${expectedLessons}`);
  }
  if (availableWW < expectedWW) {
    missingParts.push(`written works ${availableWW}/${expectedWW}`);
  }
  if (availablePT < expectedPT) {
    missingParts.push(`performance tasks ${availablePT}/${expectedPT}`);
  }
  if (availableQuiz < expectedQuiz) {
    missingParts.push(`quizzes ${availableQuiz}/${expectedQuiz}`);
  }

  if (missingParts.length > 0) {
    throw new Error(
      `Repopulate cannot restore deleted required blocks. Missing inventory: ${missingParts.join(", ")}.`
    );
  }
}

function summarizeRequiredBlockCounts(blocks: Block[]) {
  return {
    lesson: blocks.filter((block) => block.type === "lesson" && block.required && !Boolean(block.metadata.lowPriority)).length,
    writtenWork: blocks.filter(
      (block) => block.type === "written_work" && block.subcategory !== "quiz" && block.required && !Boolean(block.metadata.lowPriority)
    ).length,
    performanceTask: blocks.filter(
      (block) => block.type === "performance_task" && block.required && !Boolean(block.metadata.lowPriority)
    ).length,
    exam: blocks.filter((block) => block.type === "exam" && block.required).length,
  };
}

function buildCalendarAlgorithmSlots(input: {
  planStartDate: string;
  planEndDate: string;
  lessonPlanId: string;
  slots: PlanSlotRow[];
  blackoutDates: string[];
  examBlockTemplates: ExamBlockTemplate[];
}): SessionSlot[] {
  const recurringSchedules = buildRecurringSchedulesFromSlotRows(input.slots);
  const rebuiltSlots =
    recurringSchedules.length > 0
      ? buildSlots({
          courseId: input.lessonPlanId,
          startDate: input.planStartDate,
          endDate: input.planEndDate,
          rawMeetingSchedules: recurringSchedules,
          holidays: input.blackoutDates,
          termBoundaryDates: input.examBlockTemplates
            .map((template) => template.preferredDate)
            .filter((value): value is string => Boolean(value)),
        })
      : [];

  const sourceSlotRowById = new Map(input.slots.map((slot) => [slot.slot_id, slot]));
  const rebuiltSlotByKey = new Map(
    rebuiltSlots.map((slot) => [
      buildGeneratedSlotKey({
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        sessionType: slot.sessionType,
        slotNumber: slot.slotNumber ?? null,
        seriesKey: slot.seriesKey ?? null,
      }),
      slot,
    ])
  );

  return mapSlotRowsToAlgorithmSlots(
    input.slots.map((slot) => ({
      ...slot,
      is_locked: slot.is_locked || input.blackoutDates.includes(slot.slot_date),
    }))
  ).map((slot) => {
    const source = sourceSlotRowById.get(slot.id);
    const matched = source
      ? rebuiltSlotByKey.get(
          buildGeneratedSlotKey({
            date: slot.date,
            startTime: slot.startTime,
            endTime: slot.endTime,
            sessionType: slot.sessionType,
            slotNumber: source.slot_number ?? null,
            seriesKey: source.series_key ?? null,
          })
        )
      : null;

    return matched
      ? {
          ...slot,
          weekday: matched.weekday,
          termIndex: matched.termIndex,
          termKey: matched.termKey,
          termLabel: matched.termLabel,
          termSlotIndex: matched.termSlotIndex,
          isTermStart: matched.isTermStart,
          isTermEnd: matched.isTermEnd,
          reservedFor: matched.reservedFor,
          slotNumber: matched.slotNumber,
          seriesKey: matched.seriesKey,
        }
      : slot;
  });
}

function schedulePlanEntries(input: {
  planStartDate: string;
  planEndDate: string;
  lessonPlanId: string;
  slots: PlanSlotRow[];
  blocks: PlanBlockRow[];
  blackoutDates: string[];
}): CalendarScheduleResult {
  const activeSlotRows = input.slots.filter((slot) => !input.blackoutDates.includes(slot.slot_date));
  const activeSlotIdSet = new Set(activeSlotRows.map((slot) => slot.slot_id));
  const scheduledSlots = buildScheduledCalendarSlots(
    activeSlotRows,
    input.blocks.filter((block) => Boolean(block.slot_id) && activeSlotIdSet.has(block.slot_id ?? ""))
  );
  const scheduledEntries = buildPlanEntriesFromScheduledSlots(scheduledSlots).sort(entrySort);

  if (input.slots.length === 0) {
    return {
      entries: scheduledEntries,
      slots: scheduledSlots,
      diagnostics: toCalendarDiagnostics([]),
    };
  }

  const tocUnits = buildTocUnitsFromBlockRows(input.lessonPlanId, input.blocks);
  const examBlockTemplates = buildExamTemplatesFromBlockRows(input.blocks);
  const teacherRules = buildTeacherRulesFromBlockRows(input.blocks);
  const expectedBlocks = buildBlocks({
    courseId: input.lessonPlanId,
    tocUnits,
    teacherRules,
    examBlockTemplates,
    initialDelayDates: input.blackoutDates,
  } satisfies BuildBlocksInput);
  const algorithmSlots = buildCalendarAlgorithmSlots({
    planStartDate: input.planStartDate,
    planEndDate: input.planEndDate,
    lessonPlanId: input.lessonPlanId,
    slots: input.slots,
    blackoutDates: input.blackoutDates,
    examBlockTemplates,
  });
  const rebuiltSlots = algorithmSlots.filter((slot) => typeof slot.termIndex === "number");

  const algorithmBlocks = mapBlockRowsToAlgorithmBlocks(input.blocks);
  const placementSeed = buildPlacementSeed(
    input.slots,
    input.blocks.filter((block) => Boolean(block.slot_id))
  );
  const seededSlots = algorithmSlots.map((slot) => ({
    ...slot,
    placements: placementSeed[slot.id] ?? [],
  }));
  const pacingPlan = buildPacingPlan({
    slots: rebuiltSlots,
    tocUnits,
    teacherRules,
    examBlockTemplates,
    initialDelayDates: input.blackoutDates,
  });

  const validationSlotIdSet = new Set(
    seededSlots.filter((slot) => typeof slot.termIndex === "number").map((slot) => slot.id)
  );
  const validationSlots: SessionSlot[] = seededSlots.filter((slot) => validationSlotIdSet.has(slot.id));
  const validationBlocks = algorithmBlocks.filter((block) => {
    const sourceRow = input.blocks.find((row) => row.block_id === block.id);
    return !sourceRow?.slot_id || validationSlotIdSet.has(sourceRow.slot_id);
  });

  const validationResult = validatePlan({
    slots: validationSlots,
    blocks: validationBlocks,
    tocUnits,
    expectedHolidayDates: input.blackoutDates,
    expectedExamDates: examBlockTemplates
      .map((template) => template.preferredDate)
      .filter((value): value is string => Boolean(value)),
    expectedTermCount: Math.max(1, examBlockTemplates.length || 1),
    expectedDelayCount: pacingPlan.terms.reduce((sum, term) => sum + term.initialDelayCount, 0),
  });

  const actualCounts = summarizeRequiredBlockCounts(validationBlocks);
  const expectedCounts = summarizeRequiredBlockCounts(expectedBlocks);
  const constraints: CalendarConstraint[] = validationResult.validationIssues.map((issue) => ({
    code: issue.code,
    tier: issue.severity === "error" ? "hard" : "soft",
    passed: false,
    message: issue.message,
  }));

  if (
    actualCounts.lesson !== expectedCounts.lesson ||
    actualCounts.writtenWork !== expectedCounts.writtenWork ||
    actualCounts.performanceTask !== expectedCounts.performanceTask ||
    actualCounts.exam !== expectedCounts.exam
  ) {
    constraints.push({
      code: "CALENDAR_ALGORITHM_DRIFT",
      tier: "soft",
      passed: false,
      message:
        `Stored blocks no longer match the rebuilt algorithm output ` +
        `(L ${actualCounts.lesson}/${expectedCounts.lesson}, ` +
        `WW ${actualCounts.writtenWork}/${expectedCounts.writtenWork}, ` +
        `PT ${actualCounts.performanceTask}/${expectedCounts.performanceTask}, ` +
        `EX ${actualCounts.exam}/${expectedCounts.exam}).`,
    });
  }

  return {
    entries: scheduledEntries,
    slots: scheduledSlots,
    diagnostics: toCalendarDiagnostics(constraints),
  };
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map((part) => Number(part));
  if (!y || !m || !d) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}

function toMinutesFromSqlTime(value: string | null | undefined) {
  if (!value) return null;
  const parts = value.split(":").map((n) => Number(n));
  if (!Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  return parts[0] * 60 + parts[1];
}

export default function CalendarScreen() {
  const { colors: c, scheme } = useAppTheme();
  const isDark = scheme === "dark";
  if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }

  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<LessonPlanOption[]>([]);
  const [slotsByPlan, setSlotsByPlan] = useState<Record<string, PlanSlotRow[]>>({});
  const [blocksByPlan, setBlocksByPlan] = useState<Record<string, PlanBlockRow[]>>({});
  const [blackoutsByPlan, setBlackoutsByPlan] = useState<Record<string, string[]>>({});
  const [suspendedByPlan, setSuspendedByPlan] = useState<Record<string, string[]>>({});
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(toLocalDateString());
  const [currentMonthDate, setCurrentMonthDate] = useState<string>(startOfMonth(toLocalDateString()));
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("monthly");
  const [suspendMutating, setSuspendMutating] = useState(false);
  const [entryEditor, setEntryEditor] = useState<EntryEditorState>({
    visible: false,
    mode: "create",
    targetEntryId: null,
    lessonId: null,
    title: "",
    description: "",
    category: "lesson",
    subtype: "lecture",
    startDate: toLocalDateString(),
    endDate: toLocalDateString(),
    startTime: "",
    endTime: "",
    reviewDays: "1",
  });
  const [monthCellLayouts, setMonthCellLayouts] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const dailyBlockSwipeablesRef = useRef<Record<string, Swipeable | null>>({});
  const openDailyBlockSwipeKeyRef = useRef<string | null>(null);

  const loadCalendarData = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("No signed-in user found.");

      const today = toLocalDateString();

      const { data: planRows, error: planError } = await supabase
        .from("lesson_plans")
        .select(
          "lesson_plan_id, user_id, school_id, subject_id, section_id, title, start_date, end_date, subject:subjects(code, title), section:sections(name)"
        )
        .eq("user_id", user.id)
        .order("start_date", { ascending: false });
      if (planError) throw planError;

      const mappedPlans: LessonPlanOption[] = (planRows ?? []).map((row: any) => {
        const subjectRaw = row?.subject;
        const subject = Array.isArray(subjectRaw) ? subjectRaw[0] : subjectRaw;
        const sectionRaw = row?.section;
        const section = Array.isArray(sectionRaw) ? sectionRaw[0] : sectionRaw;

        return {
          lesson_plan_id: String(row.lesson_plan_id),
          user_id: String(row.user_id),
          school_id: String(row.school_id),
          subject_id: String(row.subject_id),
          section_id: String(row.section_id),
          title: String(row.title ?? "Untitled Plan"),
          start_date: String(row.start_date),
          end_date: String(row.end_date),
          subject_code: String(subject?.code ?? ""),
          subject_title: String(subject?.title ?? ""),
          section_name: String(section?.name ?? ""),
        };
      });

      const slotsMap: Record<string, PlanSlotRow[]> = {};
      const blocksMap: Record<string, PlanBlockRow[]> = {};

      if (mappedPlans.length > 0) {
        const lessonPlanIds = mappedPlans.map((plan) => plan.lesson_plan_id);
        const [{ data: slotRows, error: slotsError }, { data: blockRows, error: blocksError }] = await Promise.all([
          supabase
            .from("slots")
            .select("slot_id, lesson_plan_id, title, slot_date, weekday, start_time, end_time, meeting_type, room, slot_number, series_key, is_locked")
            .in("lesson_plan_id", lessonPlanIds)
            .order("slot_date", { ascending: true })
            .order("start_time", { ascending: true }),
          supabase
            .from("blocks")
            .select("block_id, lesson_plan_id, slot_id, root_block_id, lesson_id, algorithm_block_key, block_key, title, description, session_category, session_subcategory, meeting_type, estimated_minutes, min_minutes, max_minutes, required, splittable, overlay_mode, preferred_session_type, dependency_keys, order_no, is_locked, ww_subtype, pt_subtype, metadata")
            .in("lesson_plan_id", lessonPlanIds)
            .order("created_at", { ascending: true }),
        ]);

        if (slotsError) {
          console.warn("[calendar] Unable to load slots", slotsError.message);
        } else {
          for (const row of slotRows ?? []) {
            const planId = String(row.lesson_plan_id);
            const current = slotsMap[planId] ?? [];
            current.push({
              slot_id: String(row.slot_id),
              lesson_plan_id: planId,
              title: row?.title ? String(row.title) : null,
              slot_date: String(row.slot_date),
              weekday: row?.weekday ? String(row.weekday) : null,
              start_time: row?.start_time ? String(row.start_time) : null,
              end_time: row?.end_time ? String(row.end_time) : null,
              meeting_type: row?.meeting_type ? String(row.meeting_type) : null,
              room: row?.room ? String(row.room) : null,
              slot_number: typeof row?.slot_number === "number" ? Number(row.slot_number) : null,
              series_key: row?.series_key ? String(row.series_key) : null,
              is_locked: typeof row?.is_locked === "boolean" ? Boolean(row.is_locked) : null,
            });
            slotsMap[planId] = current;
          }
        }

        if (blocksError) {
          console.warn("[calendar] Unable to load blocks", blocksError.message);
        } else {
          for (const row of blockRows ?? []) {
            const planId = String(row.lesson_plan_id);
            const current = blocksMap[planId] ?? [];
            current.push({
              block_id: String(row.block_id),
              lesson_plan_id: planId,
              slot_id: row?.slot_id ? String(row.slot_id) : null,
              root_block_id: row?.root_block_id ? String(row.root_block_id) : null,
              lesson_id: row?.lesson_id ? String(row.lesson_id) : null,
              algorithm_block_key: String(row.algorithm_block_key ?? ""),
              block_key: String(row.block_key ?? row.algorithm_block_key ?? row.block_id),
              title: String(row.title ?? "Untitled"),
              description: row?.description ? String(row.description) : null,
              session_category: row?.session_category ? String(row.session_category) : null,
              session_subcategory: row?.session_subcategory ? String(row.session_subcategory) : null,
              meeting_type: row?.meeting_type ? String(row.meeting_type) : null,
              estimated_minutes: typeof row?.estimated_minutes === "number" ? Number(row.estimated_minutes) : null,
              min_minutes: typeof row?.min_minutes === "number" ? Number(row.min_minutes) : null,
              max_minutes: typeof row?.max_minutes === "number" ? Number(row.max_minutes) : null,
              required: typeof row?.required === "boolean" ? Boolean(row.required) : null,
              splittable: typeof row?.splittable === "boolean" ? Boolean(row.splittable) : null,
              overlay_mode: row?.overlay_mode ? String(row.overlay_mode) : null,
              preferred_session_type: row?.preferred_session_type ? String(row.preferred_session_type) : null,
              dependency_keys: Array.isArray(row?.dependency_keys) ? row.dependency_keys.map((value: unknown) => String(value)) : [],
              order_no: typeof row?.order_no === "number" ? Number(row.order_no) : null,
              is_locked: typeof row?.is_locked === "boolean" ? Boolean(row.is_locked) : null,
              ww_subtype: row?.ww_subtype ? String(row.ww_subtype) : null,
              pt_subtype: row?.pt_subtype ? String(row.pt_subtype) : null,
              metadata: row?.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {},
            });
            blocksMap[planId] = current;
          }
        }
      }

      const blackoutMap: Record<string, string[]> = {};
      const suspendedMap: Record<string, string[]> = {};
      if (mappedPlans.length > 0) {
        const schoolIds = Array.from(new Set(mappedPlans.map((p) => p.school_id)));
        const minStart = mappedPlans.reduce((acc, p) => (p.start_date < acc ? p.start_date : acc), mappedPlans[0].start_date);
        const maxEnd = mappedPlans.reduce((acc, p) => (p.end_date > acc ? p.end_date : acc), mappedPlans[0].end_date);

        const [{ data: eventRows, error: eventError }, { data: delayRows, error: delayError }] = await Promise.all([
          supabase
            .from("school_calendar_events")
            .select("event_id, school_id, section_id, subject_id, event_type, blackout_reason, start_date, end_date")
            .in("school_id", schoolIds)
            .in("blackout_reason", ["event", "exam_week", "holiday", "suspended", "other"])
            .lte("start_date", maxEnd)
            .gte("end_date", minStart),
          supabase
            .from("delays")
            .select("delay_id, school_id, section_id, subject_id, absent_on, blackout_reason")
            .eq("user_id", user.id)
            .in("school_id", schoolIds)
            .gte("absent_on", minStart)
            .lte("absent_on", maxEnd),
        ]);

        if (eventError) {
          console.warn("[calendar] Unable to load school calendar events", eventError.message);
        }
        if (delayError) {
          console.warn("[calendar] Unable to load delays", delayError.message);
        }

        const expandRange = (start: string, end: string) => {
          const days: string[] = [];
          let cursor = start;
          while (cursor <= end) {
            days.push(cursor);
            cursor = addDays(cursor, 1);
          }
          return days;
        };

        for (const plan of mappedPlans) {
          const blackoutSet = new Set<string>();
          const suspendedSet = new Set<string>();

          for (const row of eventRows ?? []) {
            const sameSchool = String(row.school_id) === plan.school_id;
            const sameSection = !row?.section_id || String(row.section_id) === plan.section_id;
            const sameSubject = !row?.subject_id || String(row.subject_id) === plan.subject_id;
            if (!(sameSchool && sameSection && sameSubject)) continue;
            const days = expandRange(String(row.start_date), String(row.end_date));
            days.forEach((d) => blackoutSet.add(d));
            if (String(row?.event_type ?? "") === "suspension" || String(row?.blackout_reason ?? "") === "suspended") {
              days.forEach((d) => suspendedSet.add(d));
            }
          }

          for (const row of delayRows ?? []) {
            const sameSchool = String(row.school_id) === plan.school_id;
            const sameSection = !row?.section_id || String(row.section_id) === plan.section_id;
            const sameSubject = !row?.subject_id || String(row.subject_id) === plan.subject_id;
            if (!(sameSchool && sameSection && sameSubject)) continue;
            const date = String(row.absent_on);
            blackoutSet.add(date);
          }

          blackoutMap[plan.lesson_plan_id] = Array.from(blackoutSet).sort();
          suspendedMap[plan.lesson_plan_id] = Array.from(suspendedSet).sort();
        }
      }

      setPlans(mappedPlans);
      setSlotsByPlan(slotsMap);
      setBlocksByPlan(blocksMap);
      setBlackoutsByPlan(blackoutMap);
      setSuspendedByPlan(suspendedMap);

      const currentPlan =
        mappedPlans.find((plan) => plan.start_date <= today && plan.end_date >= today) ?? null;

      const soonestUpcomingPlan =
        currentPlan
          ? null
          : mappedPlans
              .map((plan) => {
                const scheduledEntries = schedulePlanEntries({
                  planStartDate: plan.start_date,
                  planEndDate: plan.end_date,
                  lessonPlanId: plan.lesson_plan_id,
                  slots: slotsMap[plan.lesson_plan_id] ?? [],
                  blocks: blocksMap[plan.lesson_plan_id] ?? [],
                  blackoutDates: blackoutMap[plan.lesson_plan_id] ?? [],
                }).entries;

                const nextDate =
                  scheduledEntries
                    .map((entry) => entry.scheduled_date)
                    .filter((date): date is string => typeof date === "string")
                    .filter((date) => date >= today)
                    .sort()[0] ?? null;

                return { plan, nextDate };
              })
              .filter((item): item is { plan: LessonPlanOption; nextDate: string } => Boolean(item.nextDate))
              .sort((a, b) => {
                const dateCompare = a.nextDate.localeCompare(b.nextDate);
                if (dateCompare !== 0) return dateCompare;
                return a.plan.start_date.localeCompare(b.plan.start_date);
              })[0]?.plan ?? null;

      const defaultPlan = currentPlan ?? soonestUpcomingPlan ?? mappedPlans[0] ?? null;
      const defaultPlanId = defaultPlan?.lesson_plan_id ?? "";
      setSelectedPlanId((prev) => (prev && mappedPlans.some((plan) => plan.lesson_plan_id === prev) ? prev : defaultPlanId));

      if (defaultPlan) {
        setSelectedDate((current) => {
          if (defaultPlan.start_date <= current && defaultPlan.end_date >= current) {
            return current;
          }
          setCurrentMonthDate(startOfMonth(defaultPlan.start_date));
          return defaultPlan.start_date;
        });
      }
    } catch {
      setPlans([]);
      setSlotsByPlan({});
      setBlocksByPlan({});
      setBlackoutsByPlan({});
      setSuspendedByPlan({});
      setSelectedPlanId("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCalendarData();
  }, [loadCalendarData]);

  useEffect(() => {
    return subscribeToLessonPlanRefresh(() => {
      loadCalendarData();
    });
  }, [loadCalendarData]);

  const { refreshing, onRefresh } = usePullToRefresh(loadCalendarData);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.lesson_plan_id === selectedPlanId) ?? null,
    [plans, selectedPlanId]
  );

  const selectedPlanSlots = useMemo(
    () => (selectedPlanId ? slotsByPlan[selectedPlanId] ?? [] : []),
    [selectedPlanId, slotsByPlan]
  );
  const selectedPlanBlocks = useMemo(
    () => (selectedPlanId ? blocksByPlan[selectedPlanId] ?? [] : []),
    [blocksByPlan, selectedPlanId]
  );
  const recurringMeetingTemplates = useMemo(
    () =>
      selectedPlanSlots
        .reduce<{ day: string; meeting_type: string | null; start_time: string | null; end_time: string | null }[]>(
          (acc, slot) => {
            const day = normalizeWeekdayValue(slot.weekday) ?? "";
            if (!day || acc.some((item) => `${item.day}|${item.meeting_type ?? ""}|${item.start_time ?? ""}|${item.end_time ?? ""}` === `${day}|${slot.meeting_type ?? ""}|${slot.start_time ?? ""}|${slot.end_time ?? ""}`)) {
              return acc;
            }
            acc.push({
              day,
              meeting_type: slot.meeting_type ?? null,
              start_time: slot.start_time ?? null,
              end_time: slot.end_time ?? null,
            });
            return acc;
          },
          []
        ),
    [selectedPlanSlots]
  );
  const selectedPlanBlackoutSet = useMemo(
    () => new Set(selectedPlanId ? blackoutsByPlan[selectedPlanId] ?? [] : []),
    [blackoutsByPlan, selectedPlanId]
  );
  const selectedPlanSuspendedSet = useMemo(
    () => new Set(selectedPlanId ? suspendedByPlan[selectedPlanId] ?? [] : []),
    [selectedPlanId, suspendedByPlan]
  );
  const selectedDateAlgorithmSlots = useMemo(() => {
    if (!selectedPlan) return [] as SessionSlot[];
    const autoBlockRows = selectedPlanBlocks.filter((block) => !Boolean(block.metadata?.manual));
    const examTemplates = buildExamTemplatesFromBlockRows(autoBlockRows);
    return buildCalendarAlgorithmSlots({
      planStartDate: selectedPlan.start_date,
      planEndDate: selectedPlan.end_date,
      lessonPlanId: selectedPlan.lesson_plan_id,
      slots: selectedPlanSlots,
      blackoutDates: [],
      examBlockTemplates: examTemplates,
    });
  }, [selectedPlan, selectedPlanBlocks, selectedPlanSlots]);
  const repopulatableDates = useMemo(() => {
    if (!selectedPlan) return new Set<string>();

    const algorithmSlotsByDate = new Map<string, SessionSlot[]>();
    for (const slot of selectedDateAlgorithmSlots) {
      const current = algorithmSlotsByDate.get(slot.date) ?? [];
      current.push(slot);
      algorithmSlotsByDate.set(slot.date, current);
    }

    const slotRowsByDate = new Map<string, PlanSlotRow[]>();
    for (const slot of selectedPlanSlots) {
      const current = slotRowsByDate.get(slot.slot_date) ?? [];
      current.push(slot);
      slotRowsByDate.set(slot.slot_date, current);
    }

    const dates = new Set<string>();
    for (const [date, dateSlots] of Array.from(slotRowsByDate.entries())) {
      const termIndex =
        algorithmSlotsByDate.get(date)?.find((slot) => typeof slot.termIndex === "number")?.termIndex ?? null;
      if (termIndex === null) continue;

      if (selectedPlanSuspendedSet.has(date)) continue;

      const hasOpenSelectedDateSlot = dateSlots.some((slot) => {
        const slotBlocks = selectedPlanBlocks.filter(
          (block) => block.slot_id === slot.slot_id && !Boolean(block.metadata?.manual)
        );
        return slotBlocks.length === 0 || slotBlocks.every((block) => block.overlay_mode === "minor");
      });
      const hasUnscheduledAutoBlockInTerm = selectedPlanBlocks.some(
        (block) =>
          !Boolean(block.metadata?.manual) &&
          !block.slot_id &&
          Number(block.metadata?.termIndex ?? -1) === termIndex
      );

      if (!hasOpenSelectedDateSlot && !hasUnscheduledAutoBlockInTerm) continue;

      const examBlock = selectedPlanBlocks.find(
        (block) =>
          block.session_category === "exam" &&
          Number(block.metadata?.termIndex ?? -1) === termIndex
      );
      const repopulatedDates = Array.isArray(examBlock?.metadata?.repopulatedDates)
        ? examBlock?.metadata?.repopulatedDates.filter((value): value is string => typeof value === "string")
        : [];
      if (!repopulatedDates.includes(date)) {
        dates.add(date);
      }
    }

    return dates;
  }, [selectedDateAlgorithmSlots, selectedPlan, selectedPlanBlocks, selectedPlanSlots, selectedPlanSuspendedSet]);
  const monthlyRepopulationTargetDate = useMemo(() => {
    const currentMonth = parseDateFromIso(currentMonthDate).getMonth();
    const dates = Array.from(repopulatableDates).filter((date) => parseDateFromIso(date).getMonth() === currentMonth).sort();
    return dates[0] ?? null;
  }, [currentMonthDate, repopulatableDates]);
  const repopulationTargetDate = zoomLevel === "monthly"
    ? (repopulatableDates.has(selectedDate) ? selectedDate : monthlyRepopulationTargetDate)
    : (repopulatableDates.has(selectedDate) ? selectedDate : null);
  const canTriggerRepopulation = Boolean(repopulationTargetDate);

  const scheduleResult = useMemo(() => {
    if (!selectedPlan) {
      return {
        entries: [],
        slots: [],
        diagnostics: {
          feasible: true,
          hardViolations: 0,
          softViolations: 0,
          constraints: [],
        } satisfies CalendarSchedulerDiagnostics,
      };
    }

    return schedulePlanEntries({
      planStartDate: selectedPlan.start_date,
      planEndDate: selectedPlan.end_date,
      lessonPlanId: selectedPlan.lesson_plan_id,
      slots: selectedPlanSlots,
      blocks: selectedPlanBlocks,
      blackoutDates: blackoutsByPlan[selectedPlan.lesson_plan_id] ?? [],
    });
  }, [blackoutsByPlan, selectedPlan, selectedPlanBlocks, selectedPlanSlots]);
  const displayEntries = useMemo(() => scheduleResult.entries, [scheduleResult.entries]);

  const entriesByDate = useMemo(() => {
    const map: Record<string, PlanEntry[]> = {};
    for (const entry of displayEntries) {
      if (!entry.scheduled_date) continue;
      const key = entry.scheduled_date;
      const existing = map[key] ?? [];
      existing.push(entry);
      map[key] = existing;
    }

    for (const dateKey of Object.keys(map)) {
      map[dateKey] = map[dateKey].sort(entrySort);
    }

    return map;
  }, [displayEntries]);

  useEffect(() => {
    if (!selectedPlan) return;
    if (zoomLevel !== "monthly") return;
    if (selectedDate < selectedPlan.start_date) {
      setSelectedDate(selectedPlan.start_date);
      setCurrentMonthDate(startOfMonth(selectedPlan.start_date));
      return;
    }
    if (selectedDate > selectedPlan.end_date) {
      setSelectedDate(selectedPlan.end_date);
      setCurrentMonthDate(startOfMonth(selectedPlan.end_date));
    }
  }, [selectedPlan, selectedDate, zoomLevel]);

  const dailySlots = useMemo(() => {
    return scheduleResult.slots.filter((slot) => slot.slotDate === selectedDate);
  }, [scheduleResult.slots, selectedDate]);

  const dailyTimeline = useMemo(() => {
    const baseStartHour = 7;
    const baseEndHour = 15;
    const minuteValues = dailySlots
      .flatMap((slot) => [toMinutesFromSqlTime(slot.startTime), toMinutesFromSqlTime(slot.endTime)])
      .filter((value): value is number => typeof value === "number");
    const minMinute = minuteValues.length > 0 ? Math.min(...minuteValues) : baseStartHour * 60;
    const maxMinute = minuteValues.length > 0 ? Math.max(...minuteValues) : baseEndHour * 60;
    const startHour = Math.max(0, Math.min(baseStartHour, Math.floor(minMinute / 60) - 1));
    const endHour = Math.min(23, Math.max(baseEndHour, Math.ceil(maxMinute / 60) + 1));
    const hourHeight = 74;
    const timelineStartMin = startHour * 60;
    const totalHours = Math.max(1, endHour - startHour + 1);
    const hourMarks = Array.from({ length: totalHours + 1 }, (_, i) => startHour + i);
    const placed = dailySlots.map((slot, idx) => {
      const fallbackStart = timelineStartMin + idx * 45;
      const startMin = toMinutesFromSqlTime(slot.startTime) ?? fallbackStart;
      const endMinRaw = toMinutesFromSqlTime(slot.endTime);
      const endMin = endMinRaw && endMinRaw > startMin ? endMinRaw : startMin + 50;
      const top = ((startMin - timelineStartMin) / 60) * hourHeight;
      const height = Math.max(56, ((endMin - startMin) / 60) * hourHeight);
      return { slot, top, height };
    });
    return {
      startHour,
      hourHeight,
      hourMarks,
      totalHeight: totalHours * hourHeight,
      placed,
    };
  }, [dailySlots]);
  const datePickerOptions = useMemo(() => {
    if (plans.length === 0) return [];
    const minStart = plans.reduce((acc, plan) => (plan.start_date < acc ? plan.start_date : acc), plans[0].start_date);
    const maxEnd = plans.reduce((acc, plan) => (plan.end_date > acc ? plan.end_date : acc), plans[0].end_date);
    const dates: string[] = [];
    for (let cursor = minStart; cursor <= maxEnd; cursor = addDays(cursor, 1)) {
      dates.push(cursor);
    }
    if (isIsoDate(entryEditor.startDate) && !dates.includes(entryEditor.startDate)) dates.push(entryEditor.startDate);
    if (isIsoDate(entryEditor.endDate) && !dates.includes(entryEditor.endDate)) dates.push(entryEditor.endDate);
    return dates.sort();
  }, [entryEditor.endDate, entryEditor.startDate, plans]);
  const timePickerOptions = useMemo(() => {
    const options: string[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      for (let minute = 0; minute < 60; minute += 15) {
        options.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
      }
    }
    const parsedStart = parseSqlTime(entryEditor.startTime);
    const parsedEnd = parseSqlTime(entryEditor.endTime);
    const startValue = parsedStart ? parsedStart.slice(0, 5) : "";
    const endValue = parsedEnd ? parsedEnd.slice(0, 5) : "";
    if (startValue && !options.includes(startValue)) options.push(startValue);
    if (endValue && !options.includes(endValue)) options.push(endValue);
    return options.sort();
  }, [entryEditor.endTime, entryEditor.startTime]);
  const weekDays = useMemo(() => {
    const weekStart = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index);
      const d = parseDateFromIso(date);
      return {
        date,
        label: DAYS_SHORT[d.getDay()],
        dayNumber: d.getDate(),
        isSelected: date === selectedDate,
      };
    });
  }, [selectedDate]);

  const monthCells = useMemo<DayCell[]>(() => {
    const firstDay = parseDateFromIso(currentMonthDate);
    const month = firstDay.getMonth();
    const startGridDate = addDays(currentMonthDate, -firstDay.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const date = addDays(startGridDate, index);
      const dateObj = parseDateFromIso(date);
      return {
        date,
        dayNumber: dateObj.getDate(),
        inMonth: dateObj.getMonth() === month,
        isToday: date === toLocalDateString(),
        isSelected: date === selectedDate,
        entries: entriesByDate[date] ?? [],
      };
    });
  }, [currentMonthDate, entriesByDate, selectedDate]);

  const monthCellWidth = useMemo(() => {
    const values = Object.values(monthCellLayouts);
    if (values.length === 0) return 44;
    return values[0].w;
  }, [monthCellLayouts]);

  const monthlyLaneMeta = useMemo(() => {
    const laneByStartKey: Record<string, number> = {};
    const maxLaneByRow: Record<number, number> = {};
    const priority: Record<string, number> = {
      lesson: 0,
      written_work: 1,
      performance_task: 2,
      buffer: 3,
      exam: 4,
    };

    for (let row = 0; row < 6; row += 1) {
      const items: { startDate: string; planEntryId: string; startCol: number; endCol: number; priority: number }[] = [];
      for (let col = 0; col < 7; col += 1) {
        const cell = monthCells[row * 7 + col];
        if (!cell) continue;
        for (const entry of cell.entries) {
          const key = entryChainKey(entry);
          const prevDay = addDays(cell.date, -1);
          const hasPrev = (entriesByDate[prevDay] ?? []).some((item) => entryChainKey(item) === key);
          if (hasPrev) continue;

          const maxSpanInRow = 7 - col;
          let spanDays = 1;
          while (spanDays < maxSpanInRow) {
            const checkDate = addDays(cell.date, spanDays);
            const hasChain = (entriesByDate[checkDate] ?? []).some((item) => entryChainKey(item) === key);
            if (!hasChain) break;
            spanDays += 1;
          }

          items.push({
            startDate: cell.date,
            planEntryId: entry.plan_entry_id,
            startCol: col,
            endCol: Math.min(6, col + spanDays - 1),
            priority: priority[entry.category] ?? 99,
          });
        }
      }

      items.sort((a, b) => {
        if (a.startCol !== b.startCol) return a.startCol - b.startCol;
        return a.priority - b.priority;
      });

      const laneEndCols: number[] = [];
      for (const item of items) {
        let lane = 0;
        while (lane < laneEndCols.length && item.startCol <= laneEndCols[lane]) lane += 1;
        laneEndCols[lane] = item.endCol;
        laneByStartKey[`${item.startDate}|${item.planEntryId}`] = lane;
      }
      maxLaneByRow[row] = Math.max(0, laneEndCols.length - 1);
    }

    return { laneByStartKey, maxLaneByRow };
  }, [entriesByDate, monthCells]);

  const openCreateEditor = useCallback(() => {
    setEntryEditor({
      visible: true,
      mode: "create",
      targetEntryId: null,
      lessonId: null,
      title: "",
      description: "",
      category: "lesson",
      subtype: "lecture",
      startDate: selectedDate,
      endDate: selectedDate,
      startTime: "",
      endTime: "",
      reviewDays: "1",
    });
  }, [selectedDate]);

  const openEditEditor = useCallback((entry: PlanEntry) => {
    const subtype =
      entry.session_subcategory ??
      (entry.category === "written_work"
        ? (entry.ww_subtype ?? "assignment")
        : entry.category === "performance_task"
          ? (entry.pt_subtype ?? inferPerformanceTaskSubtype(entry.title, entry.description ?? null))
          : entry.category === "exam"
            ? inferExamSubtype(entry.title, entry.description ?? null)
            : entry.category === "buffer"
              ? "review"
            : entry.category === "lesson"
              ? (entry.meeting_type ?? "lecture")
              : "");
    setEntryEditor({
      visible: true,
      mode: "edit",
      targetEntryId: getEditableEntryId(entry),
      lessonId: entry.lesson_id ?? null,
      title: entry.title,
      description: entry.description ?? "",
      category: entry.category,
      subtype,
      startDate: entry.scheduled_date ?? selectedDate,
      endDate: entry.scheduled_date ?? selectedDate,
      startTime: (entry.start_time ?? "").slice(0, 5),
      endTime: (entry.end_time ?? "").slice(0, 5),
      reviewDays: "1",
    });
  }, [selectedDate]);

  const resolveEditorTimesForDate = useCallback(
    (dateIso: string, meetingType: string | null, fallbackStart: string | null, fallbackEnd: string | null) => {
      const weekday = WEEKDAY_LONG[parseDateFromIso(dateIso).getDay()].toLowerCase();
      const exactTemplate = recurringMeetingTemplates.find(
        (tpl) => tpl.day === weekday && (meetingType ? tpl.meeting_type === meetingType : true)
      );
      const fallbackTemplate = recurringMeetingTemplates.find((tpl) => tpl.day === weekday);
      const template = exactTemplate ?? fallbackTemplate ?? null;
      const byTemplateStart = template?.start_time ? String(template.start_time).slice(0, 8) : null;
      const byTemplateEnd = template?.end_time ? String(template.end_time).slice(0, 8) : null;
      return {
        start: byTemplateStart ?? fallbackStart,
        end: byTemplateEnd ?? fallbackEnd,
      };
    },
    [recurringMeetingTemplates]
  );

  const entryEditorDailyPreviewSummary = useMemo(() => {
    const startDate = entryEditor.startDate.trim();
    const endDate = entryEditor.endDate.trim();
    if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate) return "";
    const meetingType = entryEditor.category === "lesson" ? entryEditor.subtype.trim() || null : null;
    const startFallback = entryEditor.startTime.trim() ? parseSqlTime(entryEditor.startTime.trim()) : null;
    const endFallback = entryEditor.endTime.trim() ? parseSqlTime(entryEditor.endTime.trim()) : null;
    const byWeekday = new Map<string, string>();
    for (let cursor = startDate; cursor <= endDate; cursor = addDays(cursor, 1)) {
      const dayName = WEEKDAY_LONG[parseDateFromIso(cursor).getDay()];
      const resolved = resolveEditorTimesForDate(cursor, meetingType, startFallback, endFallback);
      const label = `${resolved.start ? resolved.start.slice(0, 5) : "--:--"}-${resolved.end ? resolved.end.slice(0, 5) : "--:--"}`;
      if (!byWeekday.has(dayName)) byWeekday.set(dayName, label);
    }
    return Array.from(byWeekday.entries())
      .map(([day, time]) => `${day.slice(0, 3)} ${time}`)
      .join(", ");
  }, [entryEditor.category, entryEditor.endDate, entryEditor.endTime, entryEditor.startDate, entryEditor.startTime, entryEditor.subtype, resolveEditorTimesForDate]);

  const cleanupEmptyManualSlots = useCallback(async () => {
    if (!selectedPlan) return;
    const { data: manualSlots, error: manualSlotsError } = await supabase
      .from("slots")
      .select("slot_id")
      .eq("lesson_plan_id", selectedPlan.lesson_plan_id)
      .like("series_key", "manual_slot__%");
    if (manualSlotsError) throw manualSlotsError;

    const slotIds = (manualSlots ?? []).map((row: any) => String(row.slot_id));
    if (slotIds.length === 0) return;

    const { data: slotUsageRows, error: slotUsageError } = await supabase
      .from("blocks")
      .select("slot_id")
      .in("slot_id", slotIds);
    if (slotUsageError) throw slotUsageError;

    const usedSlotIds = new Set((slotUsageRows ?? []).map((row: any) => String(row.slot_id)));
    const orphanSlotIds = slotIds.filter((slotId) => !usedSlotIds.has(slotId));
    if (orphanSlotIds.length === 0) return;

    const { error: deleteSlotsError } = await supabase.from("slots").delete().in("slot_id", orphanSlotIds);
    if (deleteSlotsError) throw deleteSlotsError;
  }, [selectedPlan]);

  const saveEntryEditor = useCallback(async () => {
    if (!selectedPlan) return;

    const title = entryEditor.title.trim();
    if (!title) {
      Alert.alert("Title required", "Enter a title.");
      return;
    }
    const startTime = entryEditor.startTime.trim() ? parseSqlTime(entryEditor.startTime.trim()) : null;
    const endTime = entryEditor.endTime.trim() ? parseSqlTime(entryEditor.endTime.trim()) : null;
    if (entryEditor.startTime.trim() && !startTime) {
      Alert.alert("Invalid start time", "Use HH:MM (24-hour).");
      return;
    }
    if (entryEditor.endTime.trim() && !endTime) {
      Alert.alert("Invalid end time", "Use HH:MM (24-hour).");
      return;
    }
    if (startTime && endTime && endTime <= startTime) {
      Alert.alert("Invalid time range", "End time must be after start time.");
      return;
    }
    const startDate = entryEditor.startDate.trim();
    const endDate = entryEditor.endDate.trim();
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      Alert.alert("Invalid date", "Use YYYY-MM-DD for start and end date.");
      return;
    }
    if (endDate < startDate) {
      Alert.alert("Invalid date range", "End date must be on or after start date.");
      return;
    }
    if (startDate < selectedPlan.start_date || endDate > selectedPlan.end_date) {
      Alert.alert("Date out of plan", "Date range must be within lesson plan duration.");
      return;
    }

    const allowedSubtypes = subtypesForCategory(entryEditor.category);
    const selectedSubtype = entryEditor.subtype.trim();
    if (allowedSubtypes.length > 0 && !allowedSubtypes.includes(selectedSubtype)) {
      Alert.alert("Subtype required", "Select a valid subtype.");
      return;
    }

    const effectiveCategory = entryEditor.lessonId ? "lesson" : entryEditor.category;
    const wwSubtype = effectiveCategory === "written_work" ? selectedSubtype : null;
    const ptSubtype = effectiveCategory === "performance_task" ? selectedSubtype : null;
    const meetingType = effectiveCategory === "lesson" ? selectedSubtype : null;
    const sessionCategory = ["lesson", "written_work", "performance_task", "exam", "buffer"].includes(effectiveCategory)
      ? effectiveCategory
      : null;
    const sessionSubcategory = allowedSubtypes.length > 0 ? selectedSubtype : null;
    const rangeDates: string[] = [];
    for (let cursor = startDate; cursor <= endDate; cursor = addDays(cursor, 1)) {
      rangeDates.push(cursor);
    }
    if (rangeDates.length === 0) return;
    const selectedMeetingType = effectiveCategory === "lesson" ? selectedSubtype : null;

    const chooseExistingSlotForDate = (date: string) => {
      const dayTimes = resolveEditorTimesForDate(date, selectedMeetingType, startTime, endTime);
      const matchingDateSlots = selectedPlanSlots.filter((slot) => slot.slot_date === date);
      const sameTypeSlots = selectedMeetingType
        ? matchingDateSlots.filter((slot) => slot.meeting_type === selectedMeetingType || slot.room === selectedMeetingType)
        : matchingDateSlots;
      const exact = sameTypeSlots.find(
        (slot) =>
          toHm(slot.start_time) === dayTimes.start?.slice(0, 5) &&
          toHm(slot.end_time) === dayTimes.end?.slice(0, 5)
      );
      return exact ?? null;
    };

    try {
      const availableSlots = [...selectedPlanSlots];
      const ensureSlotForDate = async (date: string) => {
        const dayTimes = resolveEditorTimesForDate(date, selectedMeetingType, startTime, endTime);
        const existingExact = chooseExistingSlotForDate(date);
        if (existingExact) return existingExact;

        const matchingDateSlots = availableSlots.filter((slot) => slot.slot_date === date);
        const sameTypeSlots = selectedMeetingType
          ? matchingDateSlots.filter((slot) => slot.meeting_type === selectedMeetingType || slot.room === selectedMeetingType)
          : matchingDateSlots;
        if (!dayTimes.start || !dayTimes.end) {
          return sameTypeSlots[0] ?? matchingDateSlots[0] ?? null;
        }

        const nextSlotNumber =
          matchingDateSlots.reduce((max, slot) => Math.max(max, Number(slot.slot_number ?? 0)), 0) + 1;
        const slotPayload = {
          lesson_plan_id: selectedPlan.lesson_plan_id,
          title: selectedMeetingType ? `${selectedMeetingType[0].toUpperCase()}${selectedMeetingType.slice(1)} session` : "Manual session",
          slot_date: date,
          weekday: WEEKDAY_LONG[parseDateFromIso(date).getDay()].toLowerCase(),
          start_time: dayTimes.start,
          end_time: dayTimes.end,
          meeting_type: selectedMeetingType,
          room: null,
          slot_number: nextSlotNumber,
          series_key: `manual_slot__${makeId()}`,
          is_locked: true,
        };
        const { data: createdSlot, error: createSlotError } = await supabase
          .from("slots")
          .insert(slotPayload)
          .select("slot_id, lesson_plan_id, title, slot_date, weekday, start_time, end_time, meeting_type, room, slot_number, series_key, is_locked")
          .single();
        if (createSlotError) throw createSlotError;

        const normalizedSlot: PlanSlotRow = {
          slot_id: String(createdSlot.slot_id),
          lesson_plan_id: String(createdSlot.lesson_plan_id),
          title: createdSlot?.title ? String(createdSlot.title) : null,
          slot_date: String(createdSlot.slot_date),
          weekday: createdSlot?.weekday ? String(createdSlot.weekday) : null,
          start_time: createdSlot?.start_time ? String(createdSlot.start_time) : null,
          end_time: createdSlot?.end_time ? String(createdSlot.end_time) : null,
          meeting_type: createdSlot?.meeting_type ? String(createdSlot.meeting_type) : null,
          room: createdSlot?.room ? String(createdSlot.room) : null,
          slot_number: typeof createdSlot?.slot_number === "number" ? Number(createdSlot.slot_number) : null,
          series_key: createdSlot?.series_key ? String(createdSlot.series_key) : null,
          is_locked: typeof createdSlot?.is_locked === "boolean" ? Boolean(createdSlot.is_locked) : null,
        };
        availableSlots.push(normalizedSlot);
        return normalizedSlot;
      };

      const chosenSlots: { date: string; slot: PlanSlotRow }[] = [];
      for (const date of rangeDates) {
        const slot = await ensureSlotForDate(date);
        if (!slot) {
          Alert.alert("No slot available", `No slot exists on ${date} for this block.`);
          return;
        }
        chosenSlots.push({ date, slot });
      }

      const buildBlockPayload = (date: string, slotId: string, blockKey: string, algorithmBlockKey: string, rootBlockId: string | null, orderNo: number) => {
        const dayTimes = resolveEditorTimesForDate(date, selectedMeetingType, startTime, endTime);
        const estimatedMinutes =
          dayTimes.start && dayTimes.end
            ? Math.max(15, ((toMinutesFromSqlTime(dayTimes.end) ?? 0) - (toMinutesFromSqlTime(dayTimes.start) ?? 0)) || 60)
            : 60;
        return {
          lesson_plan_id: selectedPlan.lesson_plan_id,
          slot_id: slotId,
          root_block_id: rootBlockId,
          lesson_id: entryEditor.lessonId,
          algorithm_block_key: algorithmBlockKey,
          block_key: blockKey,
          title,
          description: entryEditor.description.trim() || null,
          session_category: sessionCategory,
          session_subcategory: sessionSubcategory,
          meeting_type: meetingType,
          estimated_minutes: estimatedMinutes,
          min_minutes: null,
          max_minutes: null,
          required: true,
          splittable: false,
          overlay_mode: sessionCategory === "written_work" && sessionSubcategory !== "quiz" ? "minor" : "major",
          preferred_session_type: meetingType ?? "any",
          dependency_keys: [],
          order_no: orderNo,
          is_locked: true,
          ww_subtype: wwSubtype,
          pt_subtype: ptSubtype,
          metadata: {
            preferredDate: date,
            manual: true,
            resolvedStart: dayTimes.start,
            resolvedEnd: dayTimes.end,
          },
        };
      };

      if (entryEditor.mode === "create") {
        const blockKey = makeId();
        const firstSlot = chosenSlots[0]!.slot!;
        const firstPayload = buildBlockPayload(
          startDate,
          firstSlot.slot_id,
          blockKey,
          `manual__${blockKey}__1`,
          null,
          (selectedPlanBlocks.filter((block) => block.slot_id === firstSlot.slot_id).length || 0) + 1
        );
        const { data: createdBlock, error: createError } = await supabase
          .from("blocks")
          .insert(firstPayload)
          .select("block_id")
          .single();
        if (createError) throw createError;

        const rootBlockId = String(createdBlock.block_id);
        const extraPayload = chosenSlots.slice(1).map(({ date, slot }, index) =>
          buildBlockPayload(
            date,
            slot!.slot_id,
            blockKey,
            `manual__${blockKey}__${index + 2}`,
            rootBlockId,
            (selectedPlanBlocks.filter((block) => block.slot_id === slot!.slot_id).length || 0) + index + 1
          )
        );
        if (extraPayload.length > 0) {
          const { error: extraError } = await supabase.from("blocks").insert(extraPayload);
          if (extraError) throw extraError;
        }

        if (effectiveCategory === "performance_task" || effectiveCategory === "exam") {
          const reviewDays = Math.max(0, Math.min(10, Number(entryEditor.reviewDays) || 0));
          if (reviewDays > 0) {
            const reviewRows: any[] = [];
            let cursor = addDays(endDate, -1);
            while (reviewRows.length < reviewDays && cursor >= selectedPlan.start_date) {
              const slot = await ensureSlotForDate(cursor);
              if (!selectedPlanBlackoutSet.has(cursor) && slot) {
                reviewRows.push({
                  lesson_plan_id: selectedPlan.lesson_plan_id,
                  slot_id: slot.slot_id,
                  root_block_id: null,
                  lesson_id: null,
                  algorithm_block_key: `manual__review__${makeId()}`,
                  block_key: makeId(),
                  title: `Review: ${title}`,
                  description: `${effectiveCategory === "exam" ? "Exam" : "Performance task"} preparation`,
                  session_category: "buffer",
                  session_subcategory: "review",
                  meeting_type: null,
                  estimated_minutes: 45,
                  required: true,
                  splittable: false,
                  overlay_mode: "major",
                  preferred_session_type: "lecture",
                  dependency_keys: [],
                  order_no: (selectedPlanBlocks.filter((block) => block.slot_id === slot.slot_id).length || 0) + reviewRows.length + 1,
                  is_locked: true,
                  metadata: { preferredDate: cursor, manual: true },
                });
              }
              cursor = addDays(cursor, -1);
            }
            if (reviewRows.length > 0) {
              const { error: reviewError } = await supabase.from("blocks").insert(reviewRows);
              if (reviewError) throw reviewError;
            }
          }
        }
      } else if (entryEditor.targetEntryId) {
        const rootId = entryEditor.targetEntryId;
        const existingRoot = selectedPlanBlocks.find((block) => block.block_id === rootId) ?? null;
        const blockKey = existingRoot?.block_key ?? makeId();

        const { error: deleteMovedError } = await supabase
          .from("blocks")
          .delete()
          .eq("lesson_plan_id", selectedPlan.lesson_plan_id)
          .eq("root_block_id", rootId);
        if (deleteMovedError) throw deleteMovedError;

        const firstSlot = chosenSlots[0]?.slot;
        const updatePayload = buildBlockPayload(
          startDate,
          firstSlot!.slot_id,
          blockKey,
          existingRoot?.algorithm_block_key ?? `manual__${blockKey}__root`,
          null,
          (selectedPlanBlocks.filter((block) => block.slot_id === firstSlot!.slot_id && block.block_id !== rootId).length || 0) + 1
        );
        const { error: updateError } = await supabase
          .from("blocks")
          .update(updatePayload)
          .eq("block_id", rootId)
          .eq("lesson_plan_id", selectedPlan.lesson_plan_id);
        if (updateError) throw updateError;

        const movedRows = chosenSlots.slice(1).map(({ date, slot }, index) =>
          buildBlockPayload(
            date,
            slot!.slot_id,
            blockKey,
            `manual__${blockKey}__${index + 2}`,
            rootId,
            (selectedPlanBlocks.filter((block) => block.slot_id === slot!.slot_id && block.block_id !== rootId).length || 0) + index + 1
          )
        );
        if (movedRows.length > 0) {
          const { error: movedInsertError } = await supabase.from("blocks").insert(movedRows);
          if (movedInsertError) throw movedInsertError;
        }
      }

      setEntryEditor((prev) => ({ ...prev, visible: false }));
      await cleanupEmptyManualSlots();
      await loadCalendarData();
    } catch (error: any) {
      Alert.alert("Save failed", error?.message ?? "Could not save entry.");
    }
  }, [cleanupEmptyManualSlots, entryEditor, loadCalendarData, resolveEditorTimesForDate, selectedPlan, selectedPlanBlackoutSet, selectedPlanBlocks, selectedPlanSlots]);

  const deleteSelectedEntry = useCallback(async () => {
    if (!selectedPlan || !entryEditor.targetEntryId) return;
    try {
      const rootId = entryEditor.targetEntryId;
      const { error: cloneDeleteError } = await supabase
        .from("blocks")
        .delete()
        .eq("lesson_plan_id", selectedPlan.lesson_plan_id)
        .eq("root_block_id", rootId);
      if (cloneDeleteError) throw cloneDeleteError;

      const { error } = await supabase
        .from("blocks")
        .delete()
        .eq("block_id", rootId)
        .eq("lesson_plan_id", selectedPlan.lesson_plan_id);
      if (error) throw error;
      setEntryEditor((prev) => ({ ...prev, visible: false }));
      await cleanupEmptyManualSlots();
      await loadCalendarData();
    } catch (deleteError: any) {
      Alert.alert("Delete failed", deleteError?.message ?? "Could not delete entry.");
    }
  }, [cleanupEmptyManualSlots, entryEditor.targetEntryId, loadCalendarData, selectedPlan]);

  const deleteCalendarEntry = useCallback(async (entry: PlanEntry) => {
    if (!selectedPlan) return;
    const rootId = getEditableEntryId(entry);
    if (!rootId) return;

    try {
      const { error: cloneDeleteError } = await supabase
        .from("blocks")
        .delete()
        .eq("lesson_plan_id", selectedPlan.lesson_plan_id)
        .eq("root_block_id", rootId);
      if (cloneDeleteError) throw cloneDeleteError;

      const { error } = await supabase
        .from("blocks")
        .delete()
        .eq("block_id", rootId)
        .eq("lesson_plan_id", selectedPlan.lesson_plan_id);
      if (error) throw error;
      await cleanupEmptyManualSlots();
      await loadCalendarData();
    } catch (deleteError: any) {
      Alert.alert("Delete failed", deleteError?.message ?? "Could not delete entry.");
    }
  }, [cleanupEmptyManualSlots, loadCalendarData, selectedPlan]);

  const applySuspensionCompression = useCallback(async () => {
    if (!selectedPlan) return;

    const autoBlockRows = selectedPlanBlocks.filter((block) => !Boolean(block.metadata?.manual));
    const manualBlocksOnDate = selectedPlanBlocks.filter(
      (block) => Boolean(block.metadata?.manual) && block.slot_id && selectedPlanSlots.some((slot) => slot.slot_id === block.slot_id && slot.slot_date === selectedDate)
    );
    if (autoBlockRows.length === 0 && manualBlocksOnDate.length === 0) return;

    const examTemplates = buildExamTemplatesFromBlockRows(autoBlockRows);
    const algorithmSlots = buildCalendarAlgorithmSlots({
      planStartDate: selectedPlan.start_date,
      planEndDate: selectedPlan.end_date,
      lessonPlanId: selectedPlan.lesson_plan_id,
      slots: selectedPlanSlots,
      blackoutDates: [],
      examBlockTemplates: examTemplates,
    }).filter((slot) => typeof slot.termIndex === "number");
    const placementSeed = buildPlacementSeed(
      selectedPlanSlots,
      autoBlockRows.filter((block) => Boolean(block.slot_id))
    );
    const seededSlots = algorithmSlots.map((slot) => ({
      ...slot,
      locked: slot.locked || slot.date === selectedDate,
      lockReason: slot.date === selectedDate ? "Suspended day" : slot.lockReason,
      placements: placementSeed[slot.id] ? [...placementSeed[slot.id]!] : [],
    }));
    const affectedTermIndex =
      seededSlots.find((slot) => slot.date === selectedDate && typeof slot.termIndex === "number")?.termIndex ?? null;
    if (affectedTermIndex === null) return;

    const algorithmBlocks = mapBlockRowsToAlgorithmBlocks(autoBlockRows).map((block) => {
      if (block.type !== "exam" || Number(block.metadata.termIndex ?? -1) !== affectedTermIndex) {
        return block;
      }

      const suspendedDates = Array.isArray(block.metadata.suspendedDates)
        ? block.metadata.suspendedDates.filter((value): value is string => typeof value === "string")
        : [];
      const repopulatedDates = Array.isArray(block.metadata.repopulatedDates)
        ? block.metadata.repopulatedDates.filter((value): value is string => typeof value === "string")
        : [];
      if (suspendedDates.includes(selectedDate)) return block;

      return {
        ...block,
        metadata: {
          ...block.metadata,
          rawTermSlots: Math.max(0, Number(block.metadata.rawTermSlots ?? 0) - 1),
          termSlots: Math.max(0, Number(block.metadata.termSlots ?? 0) - 1),
          extraTermSlots: Number(block.metadata.extraTermSlots ?? 0) - 1,
          suspendedDates: [...suspendedDates, selectedDate],
          repopulatedDates: repopulatedDates.filter((value) => value !== selectedDate),
        },
      };
    });
    const termSlots = seededSlots.filter((slot) => slot.termIndex === affectedTermIndex);
    const termBlocks = algorithmBlocks.filter((block) => Number(block.metadata.termIndex ?? -1) === affectedTermIndex);
    compressTermPlan({
      termSlots,
      blocks: termBlocks,
    });

    for (const slot of termSlots) {
      if (slot.date !== selectedDate) continue;
      slot.placements = [];
    }

    normalizeTermPlacements(termSlots, termBlocks);
    validateAdjustedTerm(termSlots, termBlocks);

    const placementByBlockId = new Map(
      seededSlots.flatMap((slot) =>
        slot.placements.map((placement, index) => [
          placement.blockId,
          {
            slotId: slot.id,
            orderNo: index + 1,
          },
        ] as const)
      )
    );
    const updatedMetadataByBlockId = new Map(algorithmBlocks.map((block) => [block.id, block.metadata]));

    const suspendedSlotRows = selectedPlanSlots.filter((slot) => slot.slot_date === selectedDate);
    if (suspendedSlotRows.length > 0) {
      const suspendedSlotResults = await Promise.all(
        suspendedSlotRows.map((slot) =>
          supabase
            .from("slots")
            .update({
              is_locked: true,
            })
            .eq("slot_id", slot.slot_id)
            .eq("lesson_plan_id", selectedPlan.lesson_plan_id)
        )
      );
      const suspendedSlotError = suspendedSlotResults.find((result) => result.error)?.error;
      if (suspendedSlotError) throw suspendedSlotError;
    }

    const autoUpdateResults = await Promise.all(
      autoBlockRows.map((row) => {
        const placement = placementByBlockId.get(row.block_id) ?? null;
        const nextMetadata = updatedMetadataByBlockId.get(row.block_id) ?? row.metadata ?? {};
        const fallbackOrderNo = typeof row.order_no === "number" && Number.isFinite(row.order_no) ? row.order_no : 1;
        return supabase
          .from("blocks")
          .update({
            slot_id: placement?.slotId ?? null,
            order_no: placement?.orderNo ?? fallbackOrderNo,
            metadata: nextMetadata,
          })
          .eq("block_id", row.block_id)
          .eq("lesson_plan_id", selectedPlan.lesson_plan_id);
      })
    );
    const autoUpdateError = autoUpdateResults.find((result) => result.error)?.error;
    if (autoUpdateError) throw autoUpdateError;

    if (manualBlocksOnDate.length > 0) {
      const manualUpdateResults = await Promise.all(
        manualBlocksOnDate.map((row) =>
          supabase
            .from("blocks")
            .update({
              slot_id: null,
              order_no: typeof row.order_no === "number" && Number.isFinite(row.order_no) ? row.order_no : 1,
            })
            .eq("block_id", row.block_id)
            .eq("lesson_plan_id", selectedPlan.lesson_plan_id)
        )
      );
      const manualUpdateError = manualUpdateResults.find((result) => result.error)?.error;
      if (manualUpdateError) throw manualUpdateError;
    }
  }, [selectedDate, selectedPlan, selectedPlanBlocks, selectedPlanSlots]);

  const applyRepopulation = useCallback(async () => {
    if (!selectedPlan) return;
    try {
      const targetDate = repopulationTargetDate;
      if (!targetDate) {
        Alert.alert("Lessonplan is fully populated", "No active empty slots are available to repopulate.");
        return;
      }

      const autoBlockRows = selectedPlanBlocks.filter((block) => !Boolean(block.metadata?.manual));
      if (autoBlockRows.length === 0) return;

      const examTemplates = buildExamTemplatesFromBlockRows(autoBlockRows);
      const algorithmSlots = buildCalendarAlgorithmSlots({
        planStartDate: selectedPlan.start_date,
        planEndDate: selectedPlan.end_date,
        lessonPlanId: selectedPlan.lesson_plan_id,
        slots: selectedPlanSlots,
        blackoutDates: [],
        examBlockTemplates: examTemplates,
      }).filter((slot) => typeof slot.termIndex === "number");
      const placementSeed = buildPlacementSeed(
        selectedPlanSlots,
        autoBlockRows.filter((block) => Boolean(block.slot_id))
      );
      const seededSlots = algorithmSlots.map((slot) => ({
        ...slot,
        locked: slot.locked,
        lockReason: slot.lockReason,
        placements: placementSeed[slot.id] ? [...placementSeed[slot.id]!] : [],
      }));
      const affectedTermIndex =
        seededSlots.find((slot) => slot.date === targetDate && typeof slot.termIndex === "number")?.termIndex ?? null;
      if (affectedTermIndex === null) return;

      const algorithmBlocks = mapBlockRowsToAlgorithmBlocks(autoBlockRows).map((block) => {
        if (block.type !== "exam" || Number(block.metadata.termIndex ?? -1) !== affectedTermIndex) {
          return block;
        }

        const suspendedDates = Array.isArray(block.metadata.suspendedDates)
          ? block.metadata.suspendedDates.filter((value): value is string => typeof value === "string")
          : [];
        const repopulatedDates = Array.isArray(block.metadata.repopulatedDates)
          ? block.metadata.repopulatedDates.filter((value): value is string => typeof value === "string")
          : [];
        const alreadyRepopulated = repopulatedDates.includes(targetDate);

        return {
          ...block,
          metadata: {
            ...block.metadata,
            suspendedDates,
            termSlots: Math.max(
              0,
              Number(block.metadata.termSlots ?? 0) + (alreadyRepopulated ? 0 : 1)
            ),
            extraTermSlots: Number(block.metadata.extraTermSlots ?? 0) + (alreadyRepopulated ? 0 : 1),
            repopulatedDates: alreadyRepopulated ? repopulatedDates : [...repopulatedDates, targetDate],
          },
        };
      });

      const termSlots = seededSlots.filter((slot) => slot.termIndex === affectedTermIndex);
      const termBlocks = algorithmBlocks.filter((block) => Number(block.metadata.termIndex ?? -1) === affectedTermIndex);
      ensureTermBlockInventory(termBlocks);
      const preflightPlaced = collectPlacedCoreBlockIds(termSlots, termBlocks);
      const unscheduled = new Set(
        autoBlockRows.filter((row) => !row.slot_id).map((row) => row.block_id)
      );

      extendTermPlan({
        termSlots,
        blocks: termBlocks,
        unscheduled,
      });
      const postExtendPlaced = collectPlacedCoreBlockIds(termSlots, termBlocks);
      const extendDiff = diffPlacedCoreBlockIds(preflightPlaced, postExtendPlaced);
      if (extendDiff.hasMissing) {
        throw new Error(
          `Repopulate lost required blocks during extendTermPlan (${formatMissingCoreBlockIds(extendDiff)}).`
        );
      }

      recoverMissingRequiredBlocks(termSlots, termBlocks);
      const postRecoveryPlaced = collectPlacedCoreBlockIds(termSlots, termBlocks);
      const recoveryDiff = diffPlacedCoreBlockIds(preflightPlaced, postRecoveryPlaced);
      if (recoveryDiff.hasMissing) {
        throw new Error(
          `Repopulate could not recover required blocks (${formatMissingCoreBlockIds(recoveryDiff)}).`
        );
      }

      normalizeTermPlacements(termSlots, termBlocks);
      const postNormalizePlaced = collectPlacedCoreBlockIds(termSlots, termBlocks);
      const normalizeDiff = diffPlacedCoreBlockIds(postRecoveryPlaced, postNormalizePlaced);
      if (normalizeDiff.hasMissing) {
        throw new Error(
          `Repopulate lost required blocks during normalizeTermPlacements (${formatMissingCoreBlockIds(normalizeDiff)}).`
        );
      }
      validateAdjustedTerm(termSlots, termBlocks);

      const placementByBlockId = new Map(
        seededSlots.flatMap((slot) =>
          slot.placements.map((placement, index) => [
            placement.blockId,
            {
              slotId: slot.id,
              orderNo: index + 1,
            },
          ] as const)
        )
      );
      const updatedMetadataByBlockId = new Map(algorithmBlocks.map((block) => [block.id, block.metadata]));

      const autoUpdateResults = await Promise.all(
        autoBlockRows.map((row) => {
          const placement = placementByBlockId.get(row.block_id) ?? null;
          const nextMetadata = updatedMetadataByBlockId.get(row.block_id) ?? row.metadata ?? {};
          const fallbackOrderNo = typeof row.order_no === "number" && Number.isFinite(row.order_no) ? row.order_no : 1;
          return supabase
            .from("blocks")
            .update({
              slot_id: placement?.slotId ?? null,
              order_no: placement?.orderNo ?? fallbackOrderNo,
              metadata: nextMetadata,
            })
            .eq("block_id", row.block_id)
            .eq("lesson_plan_id", selectedPlan.lesson_plan_id);
        })
      );
      const autoUpdateError = autoUpdateResults.find((result) => result.error)?.error;
      if (autoUpdateError) throw autoUpdateError;
    } catch (error: any) {
      Alert.alert("Repopulate failed", error?.message ?? "Could not repopulate this term.");
    }
  }, [repopulationTargetDate, selectedPlan, selectedPlanBlocks, selectedPlanSlots]);

  const toggleSuspendSelectedDay = useCallback(async () => {
    if (!selectedPlan || suspendMutating) return;
    const isSuspended = selectedPlanSuspendedSet.has(selectedDate);
    setSuspendMutating(true);
    try {
      if (isSuspended) {
        const { error } = await supabase
          .from("school_calendar_events")
          .delete()
          .eq("school_id", selectedPlan.school_id)
          .eq("section_id", selectedPlan.section_id)
          .eq("subject_id", selectedPlan.subject_id)
          .eq("event_type", "suspension")
          .eq("blackout_reason", "suspended")
          .eq("start_date", selectedDate)
          .eq("end_date", selectedDate);
        if (error) throw error;
      } else {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error("No signed-in user found.");

        const { error } = await supabase.from("school_calendar_events").insert({
          school_id: selectedPlan.school_id,
          section_id: selectedPlan.section_id,
          subject_id: selectedPlan.subject_id,
          event_type: "suspension",
          blackout_reason: "suspended",
          title: "Class suspended",
          description: "Suspended from daily calendar.",
          start_date: selectedDate,
          end_date: selectedDate,
          is_whole_day: true,
          created_by: user.id,
        });
        if (error) throw error;

        await applySuspensionCompression();
      }
      await loadCalendarData();
    } catch (error: any) {
      Alert.alert("Update failed", error?.message ?? "Could not update day suspension.");
    } finally {
      setSuspendMutating(false);
    }
  }, [applySuspensionCompression, loadCalendarData, selectedDate, selectedPlan, selectedPlanSuspendedSet, suspendMutating]);

  const handlePinchStateChange = useCallback(
    (event: any) => {
      const state = event?.nativeEvent?.state;
      const scale = Number(event?.nativeEvent?.scale ?? 1);
      if (state !== GestureState.END) return;
      if (zoomLevel === "monthly" && scale > 1.06) {
        setZoomLevel("daily");
        return;
      }
      if (zoomLevel === "daily" && scale < 0.94) {
        setZoomLevel("monthly");
      }
    },
    [zoomLevel]
  );

  const shiftMonth = (offset: number) => {
    const date = parseDateFromIso(currentMonthDate);
    const next = new Date(date.getFullYear(), date.getMonth() + offset, 1);
    setCurrentMonthDate(toLocalDateString(next));
  };

  const screenBg = isDark ? c.background : "#F5F6F7";
  const cardBg = isDark ? c.card : "#FFFFFF";
  const subtleBg = isDark ? "#121C28" : "#F1F5F9";

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: screenBg }]}> 
        <ActivityIndicator color={c.tint} />
      </View>
    );
  }

  return (
      <View style={[styles.page, { backgroundColor: screenBg }]}> 
        <PinchGestureHandler enabled={zoomLevel === "monthly"} onHandlerStateChange={handlePinchStateChange}>
          <View style={styles.page}>
            <ScrollView
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
          <View style={styles.topBar}>
            <Pressable
              style={styles.topBarTitleWrap}
              onPress={() => setZoomLevel((prev) => (prev === "daily" ? "monthly" : "daily"))}
            >
              <Text style={[styles.modeLabel, { color: c.mutedText }]}> 
                {zoomLevel === "daily" ? "Daily" : "Monthly"}
              </Text>
              <Text style={[styles.dateTitle, { color: c.text }]} numberOfLines={1}> 
                {zoomLevel === "daily" ? longDateTitle(selectedDate) : monthTitle(currentMonthDate)}
              </Text>
            </Pressable>

            {zoomLevel === "monthly" ? (
              <Pressable
                style={[styles.planPill, { backgroundColor: cardBg, borderColor: c.border }]}
                onPress={() => setPlanMenuOpen(true)}
                disabled={plans.length === 0}
              >
                <Ionicons name="chevron-down" size={16} color={c.text} />
                <View style={styles.planPillTextWrap}>
                  <Text style={[styles.planCode, { color: c.text }]} numberOfLines={1}>
                    {selectedPlan?.title ?? "No lesson plan"}
                  </Text>
                  <Text style={[styles.planSubtitle, { color: c.mutedText }]} numberOfLines={1}>
                    {selectedPlan
                      ? ([selectedPlan.subject_code, selectedPlan.subject_title, selectedPlan.section_name].filter(Boolean).join(" - ") || "Lesson plan")
                      : "Your calendar is empty for now"}
                  </Text>
                </View>
              </Pressable>
            ) : null}

            {selectedPlan && (zoomLevel === "daily" || zoomLevel === "monthly") ? (
              <View style={styles.topRightIconRow}>
                {zoomLevel === "monthly" ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.iconOnlyActionBtn,
                      (!canTriggerRepopulation || suspendMutating) ? styles.iconOnlyActionBtnDisabled : undefined,
                      pressed ? styles.iconOnlyActionBtnPressed : undefined,
                    ]}
                    onPress={applyRepopulation}
                    disabled={suspendMutating}
                    accessibilityLabel="Repopulate plan"
                  >
                    <Ionicons name="sparkles-outline" size={18} color={c.text} />
                  </Pressable>
                ) : null}
                {zoomLevel === "daily" ? (
                <Pressable
                  style={styles.iconOnlyActionBtn}
                  onPress={openCreateEditor}
                  accessibilityLabel="Add block"
                >
                  <Ionicons name="add" size={18} color={c.text} />
                </Pressable>
                ) : null}
                {zoomLevel === "daily" ? (
                <Pressable
                  style={styles.iconOnlyActionBtn}
                  onPress={toggleSuspendSelectedDay}
                  disabled={suspendMutating}
                  accessibilityLabel={selectedPlanSuspendedSet.has(selectedDate) ? "Unsuspend day" : "Suspend day"}
                >
                  <Ionicons
                    name={selectedPlanSuspendedSet.has(selectedDate) ? "play-circle-outline" : "pause-circle-outline"}
                    size={18}
                    color={c.text}
                  />
                </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>

          {zoomLevel === "daily" ? (
            <View>
              {selectedPlanSuspendedSet.has(selectedDate) ? (
                <View
                  style={[
                    styles.suspendedBanner,
                    {
                      backgroundColor: isDark ? "#3A1D1D" : "#FFEDEE",
                      borderColor: c.border,
                      borderWidth: 1,
                    },
                  ]}
                >
                  <Ionicons name="alert-circle-outline" size={14} color={isDark ? "#FFC5C5" : "#A52424"} />
                  <Text style={[styles.suspendedBannerText, { color: c.text }]}>
                    This day is marked as suspended for the selected plan.
                  </Text>
                </View>
              ) : null}

              <View style={styles.weekStrip}>
                {weekDays.map((day) => (
                  <Pressable
                    key={day.date}
                    style={styles.weekDayItem}
                    onPress={() => {
                      setSelectedDate(day.date);
                      setCurrentMonthDate(startOfMonth(day.date));
                    }}
                  >
                    <Text style={[styles.weekDayLabel, { color: c.mutedText }]}>{day.label}</Text>
                    <View
                      style={[
                        styles.weekDayCircle,
                        { backgroundColor: day.isSelected ? c.tint : "transparent" },
                      ]}
                    >
                      <Text style={[styles.weekDayNum, { color: day.isSelected ? "#FFFFFF" : c.text }]}>
                        {day.dayNumber}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>

              {dailySlots.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor: c.border }]}> 
                  <Text style={[styles.emptyCardText, { color: c.mutedText }]}>No slots or blocks scheduled for this day.</Text>
                </View>
              ) : (
                <View style={styles.timelineShell}>
                  <View style={[styles.timelineGrid, { height: dailyTimeline.totalHeight }]}>
                    {dailyTimeline.hourMarks.map((hour, idx) => (
                      <View
                        key={`hour-${hour}-${idx}`}
                        style={[styles.timelineHourRow, { top: idx * dailyTimeline.hourHeight }]}
                      >
                        <Text style={[styles.timelineHourLabel, { color: c.mutedText }]}>
                          {hour % 12 === 0 ? 12 : hour % 12}
                        </Text>
                        <View style={[styles.timelineHourLine, { backgroundColor: c.border }]} />
                      </View>
                    ))}
                    {dailyTimeline.placed.map(({ slot, top, height }) => (
                      <View
                        key={`${slot.slotId}-${slot.slotDate}`}
                        style={[
                          styles.timelineCard,
                          {
                            top,
                            minHeight: height,
                            backgroundColor: getDailySlotCardStyle(slot, isDark, cardBg),
                            borderColor: c.border,
                          },
                        ]}
                      >
                        <View style={[styles.timelineCardAccent, { backgroundColor: slot.blocks[0] ? getEntryColor(slot.blocks[0].category) : c.border }]} />
                        <View style={styles.timelineCardMain}>
                          <Text style={[styles.timelineTitle, { color: c.text }]} numberOfLines={1}>
                            {getDailySlotDisplayTitle(slot)}
                          </Text>
                          <Text style={[styles.timelineSub, { color: c.text }]} numberOfLines={1}>
                            {selectedPlan?.section_name ?? "No lesson plan"}
                          </Text>
                          <Text style={[styles.timelineTime, { color: c.mutedText }]}>
                            {(slot.startTime ?? "").slice(0, 5) || "--:--"} - {(slot.endTime ?? "").slice(0, 5) || "--:--"}
                          </Text>
                        </View>
                        <View style={styles.dailySlotBlocksWrap}>
                          {slot.blocks.map((block) => {
                            const dailyBlockSwipeKey = `${block.blockId}-${block.scheduledDate}`;
                            const entry: PlanEntry = {
                              plan_entry_id: block.blockId,
                              lesson_plan_id: block.lessonPlanId,
                              title: block.title,
                              category: block.category,
                              description: block.description,
                              scheduled_date: block.scheduledDate,
                              start_time: block.startTime ? `${block.startTime}:00` : null,
                              end_time: block.endTime ? `${block.endTime}:00` : null,
                              meeting_type: block.meetingType,
                              session_category: block.category,
                              session_subcategory: block.subcategory,
                              entry_type: "planned_item",
                              day: slot.weekday,
                              room: slot.room,
                              slot_number: slot.slotNumber,
                              lesson_id: block.lessonId,
                              is_locked: block.isLocked,
                              ww_subtype: block.wwSubtype,
                              pt_subtype: block.ptSubtype,
                              root_block_id: block.rootBlockId,
                              block_key: block.blockKey,
                              algorithm_block_key: block.algorithmBlockKey,
                              slot_id: block.slotId,
                              order_no: block.orderNo,
                            };

                            return (
                              <Swipeable
                                key={dailyBlockSwipeKey}
                                ref={(instance) => {
                                  dailyBlockSwipeablesRef.current[dailyBlockSwipeKey] = instance;
                                }}
                                friction={2}
                                rightThreshold={32}
                                overshootRight={false}
                                containerStyle={styles.dailyBlockSwipe}
                                onSwipeableWillOpen={() => {
                                  const openKey = openDailyBlockSwipeKeyRef.current;
                                  if (openKey && openKey !== dailyBlockSwipeKey) {
                                    dailyBlockSwipeablesRef.current[openKey]?.close();
                                  }
                                  openDailyBlockSwipeKeyRef.current = dailyBlockSwipeKey;
                                }}
                                onSwipeableWillClose={() => {
                                  if (openDailyBlockSwipeKeyRef.current === dailyBlockSwipeKey) {
                                    openDailyBlockSwipeKeyRef.current = null;
                                  }
                                }}
                                renderRightActions={() => (
                                  <Pressable
                                    style={styles.dailyBlockDeleteAction}
                                    onPress={() => {
                                      dailyBlockSwipeablesRef.current[dailyBlockSwipeKey]?.close();
                                      deleteCalendarEntry(entry);
                                    }}
                                  >
                                    <Ionicons name="trash-outline" size={16} color="#FFFFFF" />
                                    <Text style={styles.dailyBlockDeleteText}>Delete</Text>
                                  </Pressable>
                                )}
                              >
                                <Pressable
                                  style={[
                                    styles.dailyBlockChip,
                                    {
                                      borderColor: getEntryColor(block.category),
                                      backgroundColor: subtleBg,
                                    },
                                  ]}
                                  onPress={() => openEditEditor(entry)}
                                >
                                  <Text style={[styles.dailyBlockChipTitle, { color: c.text }]} numberOfLines={1}>
                                    {block.title}
                                  </Text>
                                  <Text style={[styles.dailyBlockChipMeta, { color: c.mutedText }]} numberOfLines={1}>
                                    {getChipLabel(entry)}
                                    {block.subcategory ? ` • ${block.subcategory.replace(/_/g, " ")}` : ""}
                                  </Text>
                                </Pressable>
                              </Swipeable>
                            );
                          })}
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          ) : (
            <View>
              <View style={styles.monthNavRow}>
                <Pressable style={styles.navBtn} onPress={() => shiftMonth(-1)}>
                  <Ionicons name="chevron-back" size={18} color={c.text} />
                </Pressable>
                <Pressable style={styles.navBtn} onPress={() => shiftMonth(1)}>
                  <Ionicons name="chevron-forward" size={18} color={c.text} />
                </Pressable>
              </View>

              <View style={styles.weekLabelRow}>
                {DAYS_SHORT.map((label, index) => (
                  <Text key={`${label}-${index}`} style={[styles.weekHeaderLabel, { color: c.mutedText }]}>
                    {label}
                  </Text>
                ))}
              </View>

              <View style={styles.monthGrid}>
                {monthCells.map((cell, cellIndex) => (
                  <Pressable
                    key={cell.date}
                    style={[
                      styles.monthCell,
                      {
                        backgroundColor: selectedPlanBlackoutSet.has(cell.date)
                          ? (isDark ? "#6A707A" : "#C9CED4")
                          : "transparent",
                        borderColor: "transparent",
                        opacity: selectedPlanBlackoutSet.has(cell.date) ? 1 : 1,
                        minHeight: Math.max(92, 38 + (((monthlyLaneMeta.maxLaneByRow[Math.floor(cellIndex / 7)] ?? 0) + 1) * 24)),
                      },
                    ]}
                    onPress={() => {
                      setSelectedDate(cell.date);
                      setCurrentMonthDate(startOfMonth(cell.date));
                      setZoomLevel("daily");
                    }}
                    onLayout={(event) => {
                      const { x, y, width, height } = event.nativeEvent.layout;
                      setMonthCellLayouts((prev) => ({ ...prev, [cell.date]: { x, y, w: width, h: height } }));
                    }}
                  >
                    <View
                      style={[
                        styles.dayBadge,
                        {
                          backgroundColor: cell.isToday ? c.tint : "transparent",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayBadgeText,
                          {
                            color: cell.isToday ? "#FFFFFF" : cell.inMonth ? c.text : c.mutedText,
                            opacity: cell.inMonth ? 1 : 0.45,
                          },
                        ]}
                      >
                        {cell.dayNumber}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.detailItemsWrap,
                        { minHeight: Math.max(24, (((monthlyLaneMeta.maxLaneByRow[Math.floor(cellIndex / 7)] ?? 0) + 1) * 24)) },
                      ]}
                    >
                      {(() => {
                        const chainStarts = cell.entries.filter((entry) => {
                          const key = entryChainKey(entry);
                          const prevDay = addDays(cell.date, -1);
                          return !(entriesByDate[prevDay] ?? []).some((item) => entryChainKey(item) === key);
                        });

                        const cap = 4;
                        const picked: PlanEntry[] = [];
                        const requiredBuckets = ["lesson", "written_work", "performance_task"] as const;
                        for (const bucket of requiredBuckets) {
                          const found = chainStarts.find((entry) => entry.category === bucket);
                          if (found) picked.push(found);
                        }
                        for (const entry of chainStarts) {
                          if (picked.length >= cap) break;
                          if (picked.some((row) => row.plan_entry_id === entry.plan_entry_id)) continue;
                          picked.push(entry);
                        }
                        return picked;
                      })().map((entry) => {
                          const key = entryChainKey(entry);

                          const rowDayIndex = parseDateFromIso(cell.date).getDay();
                          const maxSpanInRow = 7 - rowDayIndex;
                          let spanDays = 1;
                          while (spanDays < maxSpanInRow) {
                            const checkDate = addDays(cell.date, spanDays);
                            const hasChain = (entriesByDate[checkDate] ?? []).some((item) => entryChainKey(item) === key);
                            if (!hasChain) break;
                            spanDays += 1;
                          }

                          const startDate = cell.date;
                          const lane = monthlyLaneMeta.laneByStartKey[`${startDate}|${entry.plan_entry_id}`] ?? 0;
                          const displayWidth = Math.max(monthCellWidth - 10, spanDays * monthCellWidth - 8);

                          return (
                            <Pressable
                              key={entry.plan_entry_id}
                              style={[
                                styles.detailItem,
                                {
                                  backgroundColor: getEntryColor(entry.category),
                                  width: displayWidth,
                                  borderTopLeftRadius: 6,
                                  borderBottomLeftRadius: 6,
                                  borderTopRightRadius: 6,
                                  borderBottomRightRadius: 6,
                                  top: lane * 24,
                                },
                              ]}
                              onPress={() => {
                                setSelectedDate(cell.date);
                                setCurrentMonthDate(startOfMonth(cell.date));
                                setZoomLevel("daily");
                              }}
                            >
                              <Text style={styles.detailItemTitle} numberOfLines={1}>
                                {entry.title}
                              </Text>
                              <Text style={styles.detailItemSub} numberOfLines={1}>
                                {stripHtmlTags(entry.description) || getChipLabel(entry)}
                              </Text>
                            </Pressable>
                          );
                        })}
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
            </ScrollView>
          </View>
        </PinchGestureHandler>

        <Modal
          transparent
          visible={entryEditor.visible}
          animationType="fade"
          onRequestClose={() => setEntryEditor((prev) => ({ ...prev, visible: false }))}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setEntryEditor((prev) => ({ ...prev, visible: false }))}>
            <Pressable style={[styles.planModal, { backgroundColor: cardBg, borderColor: c.border }]} onPress={() => null}>
              <Text style={[styles.modalTitle, { color: c.text }]}>
                {entryEditor.mode === "create" ? "Add block" : "Edit block"}
              </Text>
              <Text style={[styles.modalSubtitle, { color: c.mutedText }]}>
                Configure details, subtype, schedule range, and time.
              </Text>
              {entryEditor.lessonId ? (
                <Text style={[styles.entryPreviewSummary, { color: c.mutedText }]}>
                  This lesson total now comes from its scheduled calendar blocks.
                </Text>
              ) : null}

              <View style={styles.editorSection}>
                <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Title</Text>
                <TextInput
                  value={entryEditor.title}
                  onChangeText={(value) => setEntryEditor((prev) => ({ ...prev, title: value }))}
                  placeholder="Entry title"
                  placeholderTextColor={c.mutedText}
                  style={[styles.entryInput, { color: c.text, borderColor: c.border, backgroundColor: subtleBg }]}
                />
              </View>

              <View style={styles.editorSection}>
                <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Description</Text>
                <TextInput
                  value={entryEditor.description}
                  onChangeText={(value) => setEntryEditor((prev) => ({ ...prev, description: value }))}
                  placeholder="Optional description"
                  placeholderTextColor={c.mutedText}
                  style={[styles.entryInput, { color: c.text, borderColor: c.border, backgroundColor: subtleBg }]}
                />
              </View>

              <View style={styles.editorSection}>
                <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Category</Text>
                <View style={styles.entryCategoryRow}>
                  {["lesson", "buffer", "written_work", "performance_task", "exam"].map((category) => (
                    <Pressable
                      key={category}
                      style={[
                        styles.entryCategoryChip,
                        {
                          borderColor: entryEditor.category === category ? c.tint : c.border,
                          backgroundColor: entryEditor.category === category ? `${c.tint}22` : "transparent",
                          opacity: entryEditor.lessonId && category !== "lesson" ? 0.45 : 1,
                        },
                      ]}
                      disabled={Boolean(entryEditor.lessonId)}
                      onPress={() =>
                        setEntryEditor((prev) => ({
                          ...prev,
                          category,
                          subtype: defaultSubtypeForCategory(category),
                        }))
                      }
                    >
                      <Text style={[styles.entryCategoryText, { color: c.text }]}>{category.replace("_", " ")}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {subtypesForCategory(entryEditor.category).length > 0 ? (
                <View style={styles.editorSection}>
                  <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Subtype</Text>
                  <View style={styles.entryCategoryRow}>
                    {subtypesForCategory(entryEditor.category).map((subtype) => (
                      <Pressable
                        key={subtype}
                        style={[
                          styles.entryCategoryChip,
                          {
                            borderColor: entryEditor.subtype === subtype ? c.tint : c.border,
                            backgroundColor: entryEditor.subtype === subtype ? `${c.tint}22` : "transparent",
                          },
                        ]}
                        onPress={() => setEntryEditor((prev) => ({ ...prev, subtype }))}
                      >
                        <Text style={[styles.entryCategoryText, { color: c.text }]}>{subtype.replace("_", " ")}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.editorSection}>
                <View style={styles.entryTimeRow}>
                  <View style={styles.entryTimeCell}>
                    <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Start date</Text>
                    <View style={[styles.entryPickerWrap, { borderColor: c.border, backgroundColor: subtleBg }]}>
                      <Picker
                        selectedValue={entryEditor.startDate}
                        onValueChange={(value) => setEntryEditor((prev) => ({ ...prev, startDate: String(value) }))}
                        style={[styles.entryPicker, { color: c.text }]}
                        itemStyle={[styles.entryPickerItem, { color: c.text }]}
                        dropdownIconColor={c.text}
                      >
                        {datePickerOptions.map((date) => (
                          <Picker.Item key={`start-${date}`} label={date} value={date} />
                        ))}
                      </Picker>
                    </View>
                  </View>
                  <View style={styles.entryTimeCell}>
                    <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>End date</Text>
                    <View style={[styles.entryPickerWrap, { borderColor: c.border, backgroundColor: subtleBg }]}>
                      <Picker
                        selectedValue={entryEditor.endDate}
                        onValueChange={(value) => setEntryEditor((prev) => ({ ...prev, endDate: String(value) }))}
                        style={[styles.entryPicker, { color: c.text }]}
                        itemStyle={[styles.entryPickerItem, { color: c.text }]}
                        dropdownIconColor={c.text}
                      >
                        {datePickerOptions.map((date) => (
                          <Picker.Item key={`end-${date}`} label={date} value={date} />
                        ))}
                      </Picker>
                    </View>
                  </View>
                </View>
                {entryEditorDailyPreviewSummary ? (
                  <Text style={[styles.entryPreviewSummary, { color: c.mutedText }]}>
                    {entryEditorDailyPreviewSummary}
                  </Text>
                ) : null}
              </View>

              <View style={styles.editorSection}>
                <View style={styles.entryTimeRow}>
                  <View style={styles.entryTimeCell}>
                    <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Start (HH:MM)</Text>
                    <View style={[styles.entryPickerWrap, { borderColor: c.border, backgroundColor: subtleBg }]}>
                      <Picker
                        selectedValue={entryEditor.startTime}
                        onValueChange={(value) => setEntryEditor((prev) => ({ ...prev, startTime: String(value) }))}
                        style={[styles.entryPicker, { color: c.text }]}
                        itemStyle={[styles.entryPickerItem, { color: c.text }]}
                        dropdownIconColor={c.text}
                      >
                        <Picker.Item label="No time" value="" />
                        {timePickerOptions.map((time) => (
                          <Picker.Item key={`start-time-${time}`} label={time} value={time} />
                        ))}
                      </Picker>
                    </View>
                  </View>
                  <View style={styles.entryTimeCell}>
                    <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>End (HH:MM)</Text>
                    <View style={[styles.entryPickerWrap, { borderColor: c.border, backgroundColor: subtleBg }]}>
                      <Picker
                        selectedValue={entryEditor.endTime}
                        onValueChange={(value) => setEntryEditor((prev) => ({ ...prev, endTime: String(value) }))}
                        style={[styles.entryPicker, { color: c.text }]}
                        itemStyle={[styles.entryPickerItem, { color: c.text }]}
                        dropdownIconColor={c.text}
                      >
                        <Picker.Item label="No time" value="" />
                        {timePickerOptions.map((time) => (
                          <Picker.Item key={`end-time-${time}`} label={time} value={time} />
                        ))}
                      </Picker>
                    </View>
                  </View>
                </View>
              </View>

              {entryEditor.mode === "create" && (entryEditor.category === "performance_task" || entryEditor.category === "exam") ? (
                <>
                  <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Review days before due date</Text>
                  <TextInput
                    value={entryEditor.reviewDays}
                    onChangeText={(value) => setEntryEditor((prev) => ({ ...prev, reviewDays: value.replace(/[^\d]/g, "") }))}
                    placeholder="1"
                    placeholderTextColor={c.mutedText}
                    keyboardType="numeric"
                    style={[styles.entryInput, { color: c.text, borderColor: c.border, backgroundColor: subtleBg }]}
                  />
                </>
              ) : null}

              <View style={styles.editorActionsRow}>
                {entryEditor.mode === "edit" ? (
                  <Pressable style={[styles.editorBtn, styles.editorBtnDanger]} onPress={deleteSelectedEntry}>
                    <Text style={styles.editorBtnDangerText}>Delete</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[styles.editorBtn, { borderColor: c.border, backgroundColor: cardBg }]}
                  onPress={() => setEntryEditor((prev) => ({ ...prev, visible: false }))}
                >
                  <Text style={[styles.editorBtnText, { color: c.text }]}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.editorBtn, styles.editorBtnPrimary]} onPress={saveEntryEditor}>
                  <Text style={styles.editorBtnPrimaryText}>Save</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        <Modal
          transparent
          visible={planMenuOpen}
          animationType="fade"
          onRequestClose={() => setPlanMenuOpen(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setPlanMenuOpen(false)}>
            <View style={[styles.planModal, { backgroundColor: cardBg, borderColor: c.border }]}> 
              <Text style={[styles.modalTitle, { color: c.text }]}>Select lesson plan</Text>
              <ScrollView style={styles.planList}>
                {plans.length === 0 ? (
                  <Text style={[styles.emptyText, { color: c.mutedText }]}>No lesson plans yet.</Text>
                ) : null}
                {plans.map((plan) => {
                  const isSelected = plan.lesson_plan_id === selectedPlanId;
                  return (
                    <Pressable
                      key={plan.lesson_plan_id}
                      style={[
                        styles.planRow,
                        {
                          backgroundColor: isSelected ? (isDark ? "#1A2B22" : "#E8F9EE") : "transparent",
                          borderColor: c.border,
                        },
                      ]}
                      onPress={() => {
                        setSelectedPlanId(plan.lesson_plan_id);
                        setSelectedDate(plan.start_date);
                        setCurrentMonthDate(startOfMonth(plan.start_date));
                        setPlanMenuOpen(false);
                      }}
                    >
                      <Text style={[styles.planRowTitle, { color: c.text }]} numberOfLines={1}>
                        {plan.title}
                      </Text>
                      <Text style={[styles.planRowSub, { color: c.mutedText }]} numberOfLines={1}>
                        {[plan.subject_code, plan.subject_title, plan.section_name].filter(Boolean).join(" - ") || "Section"} | {plan.start_date} to {plan.end_date}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>

      </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxxl,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: {
    ...Typography.body,
    fontSize: 15,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  topBarTitleWrap: {
    flex: 1,
    minWidth: 0,
    paddingRight: Spacing.xs,
  },
  modeLabel: {
    ...Typography.body,
    fontSize: 14,
  },
  dateTitle: {
    ...Typography.h1,
    fontSize: 24,
    lineHeight: 28,
    marginTop: 2,
  },
  planPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 150,
    maxWidth: 210,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  planPillTextWrap: { flex: 1 },
  planCode: {
    ...Typography.h3,
    fontSize: 15,
    lineHeight: 18,
    fontStyle: "italic",
  },
  planSubtitle: {
    ...Typography.caption,
    fontSize: 12,
  },
  topRightIconRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    flexShrink: 0,
  },
  iconOnlyActionBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  iconOnlyActionBtnDisabled: {
    opacity: 0.4,
  },
  iconOnlyActionBtnPressed: {
    opacity: 0.65,
  },
  weekStrip: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  dailyActionsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  dailyActionBtn: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dailyActionText: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
  },
  suspendedBanner: {
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 7,
    marginBottom: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  suspendedBannerText: {
    ...Typography.caption,
    fontSize: 11,
    flex: 1,
  },
  weekDayItem: {
    alignItems: "center",
    width: "14.2%",
  },
  weekDayLabel: {
    ...Typography.caption,
    fontSize: 12,
    marginBottom: 6,
  },
  weekDayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  weekDayNum: {
    ...Typography.body,
    fontSize: 20,
  },
  dailyList: { gap: Spacing.sm },
  dailyRow: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingLeft: 0,
    paddingRight: Spacing.md,
    paddingVertical: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
  },
  dailyColorBar: {
    width: 5,
    alignSelf: "stretch",
    marginRight: 10,
  },
  dailyMain: {
    flex: 1,
    paddingRight: 8,
  },
  dailyTitle: {
    ...Typography.h2,
    fontSize: 22,
    lineHeight: 24,
    fontStyle: "italic",
  },
  dailySub: {
    ...Typography.body,
    fontSize: 17,
    lineHeight: 20,
    marginTop: 2,
  },
  entryChip: {
    borderWidth: 1,
    borderRadius: Radius.round,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 54,
    alignItems: "center",
  },
  entryChipText: {
    ...Typography.body,
    fontSize: 16,
  },
  divider: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: "center",
  },
  emptyCardText: {
    ...Typography.body,
    fontSize: 15,
  },
  timelineShell: {
    borderRadius: Radius.lg,
    overflow: "hidden",
  },
  timelineGrid: {
    position: "relative",
    paddingLeft: 28,
  },
  timelineHourRow: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  timelineHourLabel: {
    width: 24,
    textAlign: "right",
    ...Typography.caption,
    fontSize: 12,
    marginRight: 6,
  },
  timelineHourLine: {
    flex: 1,
    height: 1,
    opacity: 0.7,
  },
  timelineCard: {
    position: "absolute",
    left: 34,
    right: 4,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: "row",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  timelineCardAccent: {
    width: 5,
    alignSelf: "stretch",
  },
  timelineCardMain: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  timelineTitle: {
    ...Typography.h2,
    fontSize: 18,
    lineHeight: 20,
    fontStyle: "italic",
  },
  timelineSub: {
    ...Typography.body,
    fontSize: 13,
    lineHeight: 16,
    marginTop: 1,
  },
  timelineTime: {
    ...Typography.caption,
    fontSize: 11,
    marginTop: 4,
  },
  dailySlotBlocksWrap: {
    width: 148,
    paddingTop: 10,
    paddingBottom: 10,
    paddingRight: 10,
    gap: 6,
  },
  dailyBlockSwipe: {
    borderRadius: 10,
    overflow: "hidden",
  },
  dailyBlockChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  dailyBlockDeleteAction: {
    width: 92,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#C94B4B",
    paddingHorizontal: 12,
  },
  dailyBlockDeleteText: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
    marginTop: 2,
  },
  dailyBlockChipTitle: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "700",
  },
  dailyBlockChipMeta: {
    ...Typography.caption,
    fontSize: 10,
    marginTop: 2,
  },
  timelineChipRow: {
    paddingRight: 10,
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  timelineChip: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 54,
    alignItems: "center",
  },
  timelineChipText: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
  },
  diagnosticCard: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.md,
    gap: 4,
  },
  diagnosticTitle: {
    ...Typography.body,
    fontSize: 14,
    fontWeight: "700",
  },
  diagnosticLine: {
    ...Typography.caption,
    fontSize: 12,
  },
  monthNavRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: Spacing.sm,
    gap: 4,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  weekLabelRow: {
    flexDirection: "row",
    marginBottom: Spacing.sm,
  },
  weekHeaderLabel: {
    width: `${100 / 7}%`,
    textAlign: "center",
    ...Typography.caption,
    fontSize: 12,
  },
  monthGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  monthCell: {
    width: `${100 / 7}%`,
    minHeight: 92,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 4,
    overflow: "visible",
    zIndex: 0,
  },
  dayBadge: {
    alignSelf: "center",
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    marginBottom: 4,
  },
  dayBadgeText: {
    ...Typography.body,
    fontSize: 17,
  },
  detailItemsWrap: {
    position: "relative",
    zIndex: 3,
    elevation: 3,
  },
  detailItem: {
    position: "absolute",
    left: 0,
    borderRadius: Radius.sm,
    paddingHorizontal: 4,
    paddingVertical: 3,
    zIndex: 4,
    elevation: 4,
  },
  detailItemChainLeft: {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    marginLeft: -2,
  },
  detailItemChainRight: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    marginRight: -2,
  },
  detailItemTitle: {
    ...Typography.caption,
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 11,
    lineHeight: 12,
  },
  detailItemSub: {
    ...Typography.caption,
    color: "#FFFFFF",
    fontSize: 10,
    lineHeight: 11,
    marginTop: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.32)",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  planModal: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    maxHeight: "82%",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  modalTitle: {
    ...Typography.h2,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "700",
  },
  modalSubtitle: {
    ...Typography.caption,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
    marginBottom: Spacing.md,
  },
  editorSection: {
    marginBottom: Spacing.sm,
  },
  planList: {
    maxHeight: 360,
  },
  planRow: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  planRowTitle: {
    ...Typography.body,
    fontSize: 14,
    fontWeight: "600",
  },
  planRowSub: {
    ...Typography.caption,
    fontSize: 12,
    marginTop: 3,
  },
  entryFieldLabel: {
    ...Typography.caption,
    fontSize: 11,
    letterSpacing: 0.2,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  entryInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Typography.body,
    fontSize: 14,
    fontWeight: "500",
  },
  entryPickerWrap: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    minHeight: 44,
    justifyContent: "center",
  },
  entryPicker: {
    width: "100%",
    height: 44,
    opacity: 1,
  },
  entryPickerItem: {
    fontSize: 16,
    fontWeight: "500",
  },
  entryCategoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  entryCategoryChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minHeight: 32,
    justifyContent: "center",
  },
  entryCategoryText: {
    ...Typography.caption,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  entryTimeRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  entryTimeCell: {
    flex: 1,
  },
  entryPreviewSummary: {
    ...Typography.caption,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  editorActionsRow: {
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(148,163,184,0.24)",
  },
  editorBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minWidth: 84,
    alignItems: "center",
  },
  editorBtnPrimary: {
    borderColor: "#111827",
    backgroundColor: "#111827",
  },
  editorBtnDanger: {
    borderColor: "#DC2626",
    backgroundColor: "#FFF5F5",
  },
  editorBtnText: {
    ...Typography.caption,
    fontSize: 13,
    fontWeight: "600",
  },
  editorBtnPrimaryText: {
    ...Typography.caption,
    fontSize: 13,
    color: "#FFFFFF",
    fontWeight: "700",
  },
  editorBtnDangerText: {
    ...Typography.caption,
    fontSize: 13,
    color: "#DC2626",
    fontWeight: "700",
  },
});
