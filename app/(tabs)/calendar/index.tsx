import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Alert,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  LayoutAnimation,
  type ViewStyle,
  View
} from "react-native";
import { State as GestureState, PinchGestureHandler } from "react-native-gesture-handler";
import { buildBlocks, type BuildBlocksInput } from "../../../algorithm/buildBlocks";
import {
  applyTermRepairResult,
  compressTermUsingCapacity,
  repopulateTermIntoEmptySlots,
} from "../../../algorithm/repopulateplan";
import { classifySlot } from "../../../algorithm/slotState";
import { buildSlots, type RawMeetingSchedule } from "../../../algorithm/buildSlots";
import { buildPacingPlan } from "../../../algorithm/buildPacingPlan";
import { extendTermPlan } from "../../../algorithm/extendplan";
import {
  compareBlocksByCanonicalSequence,
  getCanonicalIdentity as getAlgorithmCanonicalIdentity,
  getCanonicalSequenceValue as getAlgorithmCanonicalSequenceValue,
} from "../../../algorithm/sequence";
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
  toMinutes,
  type ScheduledCalendarBlock,
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
  subtitle?: string | null;
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
  metadata?: Record<string, unknown> | null;
};

function compareEntriesChronologically(a: PlanEntry, b: PlanEntry) {
  const aDate = a.scheduled_date || "9999-99-99";
  const bDate = b.scheduled_date || "9999-99-99";
  if (aDate !== bDate) return aDate.localeCompare(bDate);
  const aTime = a.start_time || "99:99:99";
  const bTime = b.start_time || "99:99:99";
  if (aTime !== bTime) return aTime.localeCompare(bTime);
  const aSlot = Number(a.slot_number ?? 0);
  const bSlot = Number(b.slot_number ?? 0);
  if (aSlot !== bSlot) return aSlot - bSlot;
  const aOrder = Number(a.order_no ?? 0);
  const bOrder = Number(b.order_no ?? 0);
  if (aOrder !== bOrder) return aOrder - bOrder;
  return a.plan_entry_id.localeCompare(b.plan_entry_id);
}

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
  customSubtype: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  reviewDays: string;
  quizScopeStartLessonId: string | null;
  quizScopeEndLessonId: string | null;
};

type LessonScopeOption = {
  lessonId: string;
  lessonOrder: number;
  label: string;
  termIndex: number;
};

type DailyPlacedBlock = {
  slot: ScheduledCalendarSlot;
  block: ScheduledCalendarBlock;
  top: number;
  height: number;
  stackIndex: number;
};

type DailyTimeEditState = {
  blockId: string;
  startMinutes: number;
  endMinutes: number;
};

type CreateDropdownField = "category" | "subtype" | "startTime" | "endTime" | null;

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

const DAILY_BLOCK_RADIUS = 12;
const DAILY_BLOCK_DELETE_WIDTH = 92;
const DAILY_BLOCK_OPEN_THRESHOLD = 40;

type DailyBlockSwipeRowProps = {
  swipeKey: string;
  onDelete: () => void;
  onRowOpen: (swipeKey: string) => void;
  onRowClose: (swipeKey: string) => void;
  registerCloser: (swipeKey: string, closer: (() => void) | null) => void;
  containerStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
  children: React.ReactNode;
};

function DailyBlockSwipeRow({
  swipeKey,
  onDelete,
  onRowOpen,
  onRowClose,
  registerCloser,
  containerStyle,
  disabled = false,
  children,
}: DailyBlockSwipeRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const offsetRef = useRef(0);
  const isOpenRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);

  const animateTo = useCallback(
    (toValue: number, after?: () => void) => {
      Animated.spring(translateX, {
        toValue,
        useNativeDriver: true,
        bounciness: 0,
        speed: 22,
      }).start(() => {
        offsetRef.current = toValue;
        isOpenRef.current = toValue !== 0;
        setIsOpen(toValue !== 0);
        after?.();
      });
    },
    [translateX]
  );

  const closeRow = useCallback(() => {
    animateTo(0, () => onRowClose(swipeKey));
  }, [animateTo, onRowClose, swipeKey]);

  const openRow = useCallback(() => {
    onRowOpen(swipeKey);
    animateTo(-DAILY_BLOCK_DELETE_WIDTH);
  }, [animateTo, onRowOpen, swipeKey]);

  useEffect(() => {
    registerCloser(swipeKey, closeRow);
    return () => registerCloser(swipeKey, null);
  }, [closeRow, registerCloser, swipeKey]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gestureState) =>
        !disabled && Math.abs(gestureState.dx) > 8 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
      onPanResponderMove: (_evt, gestureState) => {
        const nextValue = Math.max(
          -DAILY_BLOCK_DELETE_WIDTH,
          Math.min(0, offsetRef.current + gestureState.dx)
        );
        translateX.setValue(nextValue);
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const nextValue = offsetRef.current + gestureState.dx;
        if (nextValue <= -DAILY_BLOCK_OPEN_THRESHOLD || gestureState.vx < -0.35) {
          openRow();
          return;
        }
        closeRow();
      },
      onPanResponderTerminate: () => {
        if (isOpenRef.current) {
          openRow();
          return;
        }
        closeRow();
      },
    })
  ).current;

  return (
    <View style={[styles.dailyBlockSwipe, containerStyle]}>
      <Pressable
        style={styles.dailyBlockDeleteAction}
        onPress={() => {
          closeRow();
          onDelete();
        }}
      >
        <Ionicons name="trash-outline" size={16} color="#FFFFFF" />
        <Text style={styles.dailyBlockDeleteText}>Delete</Text>
      </Pressable>
      <Animated.View
        style={[
          styles.dailyBlockSwipeContent,
          {
            transform: [{ translateX }],
          },
        ]}
        pointerEvents={isOpen ? "box-none" : "auto"}
      >
        <View style={styles.dailyBlockSwipeGestureSurface} {...panResponder.panHandlers}>
          {children}
        </View>
      </Animated.View>
    </View>
  );
}

type DailyTimeAdjustableCardProps = {
  active: boolean;
  startMinutes: number;
  endMinutes: number;
  hourHeight: number;
  onActivate: () => void;
  onChange: (startMinutes: number, endMinutes: number) => void;
  onCommit: (startMinutes: number, endMinutes: number) => void;
  onPress: () => void;
  children: React.ReactNode;
};

function DailyTimeAdjustableCard({
  active,
  startMinutes,
  endMinutes,
  hourHeight,
  onActivate,
  onChange,
  onCommit,
  onPress,
  children,
}: DailyTimeAdjustableCardProps) {
  const startRef = useRef({ startMinutes, endMinutes });

  useEffect(() => {
    startRef.current = { startMinutes, endMinutes };
  }, [endMinutes, startMinutes]);

  const dragResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gestureState) => active && Math.abs(gestureState.dy) > 4,
      onPanResponderGrant: () => {
        startRef.current = { startMinutes, endMinutes };
      },
      onPanResponderMove: (_evt, gestureState) => {
        const deltaMinutes = snapMinutesToHalfHour((gestureState.dy / hourHeight) * 60);
        onChange(startRef.current.startMinutes + deltaMinutes, startRef.current.endMinutes + deltaMinutes);
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const deltaMinutes = snapMinutesToHalfHour((gestureState.dy / hourHeight) * 60);
        onCommit(startRef.current.startMinutes + deltaMinutes, startRef.current.endMinutes + deltaMinutes);
      },
    })
  ).current;

  const topResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gestureState) => active && Math.abs(gestureState.dy) > 4,
      onPanResponderGrant: () => {
        startRef.current = { startMinutes, endMinutes };
      },
      onPanResponderMove: (_evt, gestureState) => {
        const deltaMinutes = snapMinutesToHalfHour((gestureState.dy / hourHeight) * 60);
        onChange(startRef.current.startMinutes + deltaMinutes, startRef.current.endMinutes);
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const deltaMinutes = snapMinutesToHalfHour((gestureState.dy / hourHeight) * 60);
        onCommit(startRef.current.startMinutes + deltaMinutes, startRef.current.endMinutes);
      },
    })
  ).current;

  const bottomResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gestureState) => active && Math.abs(gestureState.dy) > 4,
      onPanResponderGrant: () => {
        startRef.current = { startMinutes, endMinutes };
      },
      onPanResponderMove: (_evt, gestureState) => {
        const deltaMinutes = snapMinutesToHalfHour((gestureState.dy / hourHeight) * 60);
        onChange(startRef.current.startMinutes, startRef.current.endMinutes + deltaMinutes);
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const deltaMinutes = snapMinutesToHalfHour((gestureState.dy / hourHeight) * 60);
        onCommit(startRef.current.startMinutes, startRef.current.endMinutes + deltaMinutes);
      },
    })
  ).current;

  return (
    <View style={styles.dailyTimeAdjustWrap}>
      {active ? <View style={styles.dailyTimeDragSurface} {...dragResponder.panHandlers} /> : null}
      <Pressable
        style={styles.dailyTimePressable}
        onLongPress={onActivate}
        delayLongPress={220}
        onPress={onPress}
      >
        {children}
      </Pressable>
      {active ? <View style={styles.dailyTimeResizeHandleTop} {...topResponder.panHandlers} /> : null}
      {active ? <View style={styles.dailyTimeResizeHandleBottom} {...bottomResponder.panHandlers} /> : null}
    </View>
  );
}

function toLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplayTime(value: string | null | undefined) {
  const normalized = value ? value.slice(0, 5) : "";
  const matched = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return "--:--";
  const hour = Number(matched[1]);
  const minute = matched[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${suffix}`;
}

function formatDisplayTimeRange(start: string | null | undefined, end: string | null | undefined) {
  return `${formatDisplayTime(start)} - ${formatDisplayTime(end)}`;
}

function minutesToHm(value: number) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, value));
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function snapMinutesToHalfHour(value: number) {
  return Math.round(value / 30) * 30;
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
  const aTime = a.start_time || "99:99:99";
  const bTime = b.start_time || "99:99:99";
  if (aTime !== bTime) return aTime.localeCompare(bTime);
  const rankDiff =
    getDailyBlockOrderRank({
      category: a.category,
      subcategory: a.session_subcategory,
      orderNo: a.order_no,
      title: a.title,
    }) -
    getDailyBlockOrderRank({
      category: b.category,
      subcategory: b.session_subcategory,
      orderNo: b.order_no,
      title: b.title,
    });
  if (rankDiff !== 0) return rankDiff;
  const orderDiff = Number(a.order_no ?? 0) - Number(b.order_no ?? 0);
  if (orderDiff !== 0) return orderDiff;
  return a.title.localeCompare(b.title);
}

function getEntryColor(category: string) {
  return CATEGORY_STYLE[category]?.color ?? "#B6C0CC";
}

function getDailyBlockOrderRank(block: {
  category?: string | null;
  subcategory?: string | null;
  orderNo?: number | null;
  title?: string | null;
}) {
  if (block.category === "buffer") return -1;
  if (block.category === "lesson") return 0;
  if (block.category === "exam") return 1;
  if (block.category === "written_work" && block.subcategory === "quiz") return 2;
  if (block.category === "written_work") return 3;
  if (block.category === "performance_task") return 4;
  return 9;
}

function getCanonicalSequenceValue(input: {
  category?: string | null;
  type?: string | null;
  subcategory?: string | null;
  metadata?: Record<string, unknown> | null;
  title?: string | null;
}) {
  return getAlgorithmCanonicalSequenceValue({
    type: input.category ?? input.type,
    subcategory: input.subcategory,
    metadata: input.metadata,
    title: input.title,
  });
}

function getChipLabel(entry: PlanEntry) {
  if (entry.category === "lesson") {
    const matched = entry.title.match(/lesson\s*\d+/i);
    return matched ? matched[0].replace(/\s+/g, " ") : "L";
  }
  return CATEGORY_STYLE[entry.category]?.chipLabel ?? "PL";
}

function getDailyMetaLabel(entry: PlanEntry) {
  if (entry.category === "lesson") return "";
  if (entry.category === "written_work" && entry.session_subcategory === "quiz") {
    return entry.subtitle?.trim() || "Quiz";
  }
  return formatEditorChoiceLabel(entry.category || "");
}

function getDailyPrimaryLabel(entry: PlanEntry) {
  if (entry.category === "lesson") {
    const lessonOrder = Number(entry.metadata?.globalLessonOrder ?? entry.metadata?.lessonOrder ?? 0);
    return lessonOrder > 0 ? `Lesson ${lessonOrder}: ${entry.title}` : entry.title;
  }
  const orderMatch = entry.title.match(/(\d+)\s*$/);
  const order = orderMatch?.[1] ?? "";
  const subtypeSource = entry.session_subcategory ?? entry.ww_subtype ?? entry.pt_subtype ?? "";
  const subtype = formatEditorChoiceLabel(subtypeSource);
  return order && subtype ? `${subtype} ${order}` : subtype || entry.title;
}

function getDailySlotCardStyle(slot: ScheduledCalendarSlot, isDark: boolean, defaultCardBg: string) {
  const primaryBlock = slot.blocks[0] ?? null;
  if (primaryBlock?.category === "buffer") {
    return isDark ? "#1F2937" : "#E5E7EB";
  }
  return defaultCardBg;
}

function buildAutoBlockIdentity(input: {
  category?: string | null;
  subcategory?: string | null;
  lessonId?: string | null;
  sourceTocId?: string | null;
  metadata?: Record<string, unknown> | null;
  title?: string | null;
}) {
  return getAlgorithmCanonicalIdentity({
    type: input.category,
    subcategory: input.subcategory,
    lessonId: input.lessonId,
    sourceTocId: input.sourceTocId,
    metadata: input.metadata,
    title: input.title,
  });
}

function getWrittenWorkSubtypeCode(subcategory?: string | null) {
  if (subcategory === "quiz") return "Q";
  if (subcategory === "seatwork") return "SW";
  return "AS";
}

function getPerformanceTaskSubtypeCode(subcategory?: string | null) {
  if (subcategory === "lab_report") return "LR";
  if (subcategory === "reporting") return "REP";
  if (subcategory === "project") return "PROJ";
  return "ACT";
}

function getQuizScopeLabel(metadata?: Record<string, unknown> | null) {
  const source = metadata ?? {};
  const start = Number(source.coveredLessonStartOrder ?? source.coveredLessonStart ?? 0);
  const end = Number(source.coveredLessonEndOrder ?? source.coveredLessonEnd ?? 0);
  if (!(start > 0) || !(end > 0)) return null;
  return start === end ? `Lesson ${start}` : `Lessons ${start}-${end}`;
}

function getDisplayLabelsForBlockLike(input: {
  title: string;
  category?: string | null;
  subcategory?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const metadata = input.metadata ?? {};
  if (input.category === "lesson") {
    const lessonOrder = Number(metadata.globalLessonOrder ?? metadata.lessonOrder ?? 0);
    const lessonTitle =
      typeof metadata.lessonTitle === "string" && metadata.lessonTitle.trim()
        ? metadata.lessonTitle.trim()
        : input.title.trim();
    return { title: lessonTitle, subtitle: lessonOrder > 0 ? `L${lessonOrder}` : null as string | null };
  }
  if (input.category === "written_work" && input.subcategory === "quiz") {
    const quizOrder = Number(metadata.globalQuizOrder ?? metadata.quizOrder ?? 0);
    if (quizOrder > 0) return { title: `Q${quizOrder}`, subtitle: getQuizScopeLabel(metadata) };
  }
  if (input.category === "written_work") {
    const wwOrder = Number(metadata.globalWwOrder ?? metadata.wwOrder ?? 0);
    if (wwOrder > 0) {
      return { title: `${getWrittenWorkSubtypeCode(input.subcategory)}${wwOrder}`, subtitle: `WW${wwOrder}` };
    }
  }
  if (input.category === "performance_task") {
    const ptOrder = Number(metadata.globalPtOrder ?? metadata.ptOrder ?? 0);
    if (ptOrder > 0) {
      return { title: `${getPerformanceTaskSubtypeCode(input.subcategory)}${ptOrder}`, subtitle: `PT${ptOrder}` };
    }
  }
  const canonical = getCanonicalAutoBlockTitle({
    category: input.category,
    subcategory: input.subcategory,
    metadata: input.metadata,
    fallbackTitle: input.title,
  }).trim();
  return { title: canonical || input.title.trim(), subtitle: null as string | null };
}

function applyEntryDisplayOrders(entries: PlanEntry[]) {
  const chronologicalEntries = [...entries].sort(compareEntriesChronologically);
  const writtenSubtypeCounts = new Map<string, number>();
  const performanceSubtypeCounts = new Map<string, number>();
  let writtenCount = 0;
  let performanceCount = 0;
  const relabeledByKey = new Map<string, PlanEntry>();

  for (const entry of chronologicalEntries) {
    if (entry.category === "written_work") {
      if (entry.session_subcategory === "quiz") {
        const code = getWrittenWorkSubtypeCode(entry.session_subcategory ?? entry.ww_subtype ?? "quiz");
        const subtypeCount = (writtenSubtypeCounts.get(code) ?? 0) + 1;
        writtenSubtypeCounts.set(code, subtypeCount);
        writtenCount += 1;
        relabeledByKey.set(`${entry.plan_entry_id}|${entry.scheduled_date ?? ""}`, {
          ...entry,
          title: `${code}${subtypeCount}`,
          subtitle: getQuizScopeLabel(entry.metadata) ?? entry.subtitle ?? null,
        });
        continue;
      }
      const code = getWrittenWorkSubtypeCode(entry.session_subcategory ?? entry.ww_subtype ?? "assignment");
      const subtypeCount = (writtenSubtypeCounts.get(code) ?? 0) + 1;
      writtenSubtypeCounts.set(code, subtypeCount);
      writtenCount += 1;
      relabeledByKey.set(`${entry.plan_entry_id}|${entry.scheduled_date ?? ""}`, {
        ...entry,
        title: `${code}${subtypeCount}`,
        subtitle: `WW${writtenCount}`,
      });
      continue;
    }

    if (entry.category === "performance_task") {
      const code = getPerformanceTaskSubtypeCode(
        entry.session_subcategory ?? entry.pt_subtype ?? inferPerformanceTaskSubtype(entry.title, entry.description ?? null)
      );
      const subtypeCount = (performanceSubtypeCounts.get(code) ?? 0) + 1;
      performanceSubtypeCounts.set(code, subtypeCount);
      performanceCount += 1;
      relabeledByKey.set(`${entry.plan_entry_id}|${entry.scheduled_date ?? ""}`, {
        ...entry,
        title: `${code}${subtypeCount}`,
        subtitle: `PT${performanceCount}`,
      });
      continue;
    }

    relabeledByKey.set(`${entry.plan_entry_id}|${entry.scheduled_date ?? ""}`, entry);
  }

  return entries.map((entry) => relabeledByKey.get(`${entry.plan_entry_id}|${entry.scheduled_date ?? ""}`) ?? entry);
}

function getCanonicalAutoBlockTitle(input: {
  category?: string | null;
  subcategory?: string | null;
  metadata?: Record<string, unknown> | null;
  fallbackTitle: string;
}) {
  const metadata = input.metadata ?? {};
  const extraCandidateType =
    typeof metadata.extraCandidateType === "string" ? metadata.extraCandidateType : null;
  if (input.category === "lesson") {
    const globalOrder = Number(metadata.globalLessonOrder ?? metadata.lessonOrder ?? 0);
    if (extraCandidateType === "lesson_extension") {
      return globalOrder > 0 ? `L${globalOrder} Extension` : input.fallbackTitle;
    }
    return globalOrder > 0 ? `L${globalOrder}` : input.fallbackTitle;
  }
  if (input.category === "written_work" && input.subcategory === "quiz") {
    const quizOrder = Number(metadata.globalQuizOrder ?? metadata.quizOrder ?? 0);
    const start = Number(metadata.coveredLessonStartOrder ?? metadata.coveredLessonStart ?? 0);
    const end = Number(metadata.coveredLessonEndOrder ?? metadata.coveredLessonEnd ?? 0);

    if (quizOrder > 0 && start > 0 && end > 0) {
      return start === end
        ? `Q${quizOrder}: Lesson ${start}`
        : `Q${quizOrder}: Lessons ${start}-${end}`;
    }

    return quizOrder > 0 ? `Q${quizOrder}` : input.fallbackTitle;
  }
  if (input.category === "written_work") {
    const wwOrder = Number(metadata.globalWwOrder ?? metadata.wwOrder ?? 0);
    if (extraCandidateType === "extra_written_work") {
      return "Additional Written Work";
    }
    return wwOrder > 0
      ? `WW${wwOrder}: ${getWrittenWorkSubtypeCode(input.subcategory)}${wwOrder}`
      : input.fallbackTitle;
  }
  if (input.category === "performance_task") {
    const ptOrder = Number(metadata.globalPtOrder ?? metadata.ptOrder ?? 0);
    if (extraCandidateType === "pt_extension") {
      return ptOrder > 0 ? `PT${ptOrder} Extension` : input.fallbackTitle;
    }
    if (extraCandidateType === "extra_performance_task") {
      return "Additional Performance Task";
    }
    return ptOrder > 0
      ? `PT${ptOrder}: ${getPerformanceTaskSubtypeCode(input.subcategory)}${ptOrder}`
      : input.fallbackTitle;
  }
  if (input.category === "buffer") {
    if (metadata.extraCandidateType === "review_before_quiz") {
      const quizOrder = Number(metadata.targetQuizOrder ?? 0);
      return quizOrder > 0 ? `Q${quizOrder} Review` : input.fallbackTitle;
    }
    if (metadata.extraCandidateType === "review_before_exam") {
      const termKey = typeof metadata.termKey === "string" ? metadata.termKey : null;
      return termKey ? `${termKey[0].toUpperCase()}${termKey.slice(1)} Review` : input.fallbackTitle;
    }
    if (input.subcategory === "orientation") return "Orientation";
  }
  return input.fallbackTitle;
}

function getMonthlyPreviewTitle(entry: PlanEntry) {
  if (entry.category === "lesson") {
    return entry.subtitle?.trim() || "Lesson";
  }
  return entry.title.trim();
}

function getTermRequirementOffsets(blockRows: PlanBlockRow[]) {
  const examsByTerm = new Map<number, PlanBlockRow>();
  for (const block of blockRows) {
    if (block.session_category !== "exam") continue;
    const termIndex = Number(block.metadata?.termIndex ?? -1);
    if (termIndex < 0) continue;
    if (!examsByTerm.has(termIndex)) examsByTerm.set(termIndex, block);
  }

  let lessonOffset = 0;
  let wwOffset = 0;
  let ptOffset = 0;
  let quizOffset = 0;
  const offsets = new Map<number, { lesson: number; ww: number; pt: number; quiz: number }>();
  const termIndexes = Array.from(examsByTerm.keys()).sort((a, b) => a - b);
  for (const termIndex of termIndexes) {
    offsets.set(termIndex, {
      lesson: lessonOffset,
      ww: wwOffset,
      pt: ptOffset,
      quiz: quizOffset,
    });
    const exam = examsByTerm.get(termIndex)!;
    lessonOffset += Number(exam.metadata?.termLessons ?? 0);
    wwOffset += Number(exam.metadata?.termWW ?? 0);
    ptOffset += Number(exam.metadata?.termPT ?? 0);
    quizOffset += Number(exam.metadata?.termQuizAmount ?? 0);
  }
  return offsets;
}

function getNormalizedGlobalOrder(input: {
  rawOrder: unknown;
  rawGlobalOrder: unknown;
  offset: number;
  termExpectedCount: number;
  termIndex: number;
}) {
  const explicitGlobal = Number(input.rawGlobalOrder ?? 0);
  if (explicitGlobal > 0) return explicitGlobal;

  const rawOrder = Number(input.rawOrder ?? 0);
  if (!(rawOrder > 0)) return 0;
  if (input.termIndex <= 0) return rawOrder;
  if (rawOrder > input.termExpectedCount) return rawOrder;
  return input.offset + rawOrder;
}

function canonicalizeLoadedPlanBlocks(blockRows: PlanBlockRow[]) {
  const examsByTerm = new Map<number, PlanBlockRow>();
  for (const block of blockRows) {
    if (block.session_category !== "exam") continue;
    const termIndex = Number(block.metadata?.termIndex ?? -1);
    if (termIndex < 0) continue;
    if (!examsByTerm.has(termIndex)) examsByTerm.set(termIndex, block);
  }
  const offsets = getTermRequirementOffsets(blockRows);
  return blockRows.map((row) => {
    if (Boolean(row.metadata?.manual)) return row;
    const metadata = { ...(row.metadata ?? {}) };
    const termIndex = Number(metadata.termIndex ?? -1);
    const termOffsets = offsets.get(termIndex) ?? { lesson: 0, ww: 0, pt: 0, quiz: 0 };
    const exam = examsByTerm.get(termIndex) ?? null;
    const expectedLessons = Number(exam?.metadata?.termLessons ?? 0);
    const expectedWW = Number(exam?.metadata?.termWW ?? 0);
    const expectedPT = Number(exam?.metadata?.termPT ?? 0);
    const expectedQuiz = Number(exam?.metadata?.termQuizAmount ?? 0);

    if (row.session_category === "lesson") {
      const normalizedOrder = getNormalizedGlobalOrder({
        rawOrder: metadata.lessonOrder,
        rawGlobalOrder: metadata.globalLessonOrder,
        offset: termOffsets.lesson,
        termExpectedCount: expectedLessons,
        termIndex,
      });
      if (normalizedOrder > 0) {
        metadata.globalLessonOrder = normalizedOrder;
      }
    }
    if (row.session_category === "written_work" && row.session_subcategory !== "quiz") {
      const normalizedOrder = getNormalizedGlobalOrder({
        rawOrder: metadata.wwOrder,
        rawGlobalOrder: metadata.globalWwOrder,
        offset: termOffsets.ww,
        termExpectedCount: expectedWW,
        termIndex,
      });
      if (normalizedOrder > 0) {
        metadata.wwOrder = normalizedOrder;
        metadata.globalWwOrder = normalizedOrder;
      }
    }
    if (row.session_category === "performance_task") {
      const normalizedOrder = getNormalizedGlobalOrder({
        rawOrder: metadata.ptOrder,
        rawGlobalOrder: metadata.globalPtOrder,
        offset: termOffsets.pt,
        termExpectedCount: expectedPT,
        termIndex,
      });
      if (normalizedOrder > 0) {
        metadata.ptOrder = normalizedOrder;
        metadata.globalPtOrder = normalizedOrder;
      }
    }
    if (row.session_category === "written_work" && row.session_subcategory === "quiz") {
      const normalizedOrder = getNormalizedGlobalOrder({
        rawOrder: metadata.quizOrder,
        rawGlobalOrder: metadata.globalQuizOrder,
        offset: termOffsets.quiz,
        termExpectedCount: expectedQuiz,
        termIndex,
      });
      if (normalizedOrder > 0) {
        metadata.quizOrder = normalizedOrder;
        metadata.globalQuizOrder = normalizedOrder;
        const localQuizOrder =
          Number(metadata.termQuizOrder ?? 0) > 0 ? Number(metadata.termQuizOrder ?? 0) : normalizedOrder - termOffsets.quiz;
        metadata.globalWwOrder =
          termOffsets.ww + Math.max(0, expectedWW - expectedQuiz) + Math.max(1, localQuizOrder);
      }
    }

    return {
      ...row,
      title: getCanonicalAutoBlockTitle({
        category: row.session_category,
        subcategory: row.session_subcategory,
        metadata,
        fallbackTitle: row.title,
      }),
      metadata,
    };
  });
}

function getDisplayTitleForBlockLike(input: {
  title: string;
  category?: string | null;
  subcategory?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  return getDisplayLabelsForBlockLike(input).title;
}

function getDisplaySubtitleForBlockLike(input: {
  title: string;
  category?: string | null;
  subcategory?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  return getDisplayLabelsForBlockLike(input).subtitle;
}

function getDailyDisplayTitleForBlockLike(input: {
  title: string;
  category?: string | null;
  subcategory?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  return getDisplayTitleForBlockLike(input).trim() || input.title.trim();
}

function getLibraryRouteForEntry(entry: PlanEntry, subjectId?: string | null) {
  const metadataSourceLessonId =
    typeof entry.metadata?.sourceTocId === "string" && isUuid(entry.metadata.sourceTocId)
      ? entry.metadata.sourceTocId
      : null;
  const lessonId = entry.lesson_id ?? metadataSourceLessonId;

  if (entry.category === "lesson" && lessonId) {
    return {
      pathname: "/library/lesson_detail" as const,
      params: {
        lessonId,
        ...(subjectId ? { subjectId } : {}),
      },
    };
  }
  if (entry.category === "written_work") {
    return {
      pathname: "/library/ww_detail" as const,
      params: {
        planEntryId: entry.plan_entry_id,
        ...(subjectId ? { subjectId } : {}),
      },
    };
  }
  if (entry.category === "exam") {
    return {
      pathname: "/library/ww_detail" as const,
      params: {
        planEntryId: entry.plan_entry_id,
        ...(subjectId ? { subjectId } : {}),
      },
    };
  }
  if (entry.category === "performance_task") {
    return {
      pathname: "/library/pt_detail" as const,
      params: {
        planEntryId: entry.plan_entry_id,
        ...(subjectId ? { subjectId } : {}),
      },
    };
  }
  return null;
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
  if (category === "buffer") return ["review", "preparation", "orientation", "other"];
  return [];
}

function createModeSubtypesForCategory(category: string) {
  const base = subtypesForCategory(category);
  if (base.length === 0) return [];
  if (base.includes("other")) return base;
  return [...base, "other"];
}

function formatEditorChoiceLabel(value: string) {
  if (!value) return "";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getStoredSubtypeForCreate(category: string, subtype: string) {
  if (subtype !== "other") return subtype;
  if (category === "lesson") return "lecture";
  if (category === "written_work") return "assignment";
  if (category === "performance_task") return "activity";
  if (category === "exam") return "final";
  if (category === "buffer") return "other";
  return "";
}

function buildPlanEntriesFromScheduledSlots(slots: ScheduledCalendarSlot[]): PlanEntry[] {
  return slots.flatMap((slot) =>
    slot.blocks.map((block) => ({
      ...getDisplayLabelsForBlockLike({
        title: block.title,
        category: block.category,
        subcategory: block.subcategory,
        metadata: block.metadata,
      }),
      plan_entry_id: block.blockId,
      lesson_plan_id: block.lessonPlanId,
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
      metadata: block.metadata,
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

function getSlotCapacityMinutes(slot: Pick<PlanSlotRow, "start_time" | "end_time">) {
  return toMinutes(slot.start_time, slot.end_time);
}

function getPlannedMinutesForSlot(slotId: string, blockRows: PlanBlockRow[]) {
  return blockRows
    .filter((block) => block.slot_id === slotId)
    .reduce((sum, block) => sum + Math.max(15, Number(block.estimated_minutes ?? 0)), 0);
}

function slotHasRemainingCapacity(slot: PlanSlotRow, blockRows: PlanBlockRow[]) {
  const capacity = getSlotCapacityMinutes(slot);
  if (capacity <= 0) return true;
  return getPlannedMinutesForSlot(slot.slot_id, blockRows) < capacity;
}

function classifyPlanSlotState(
  slot: PlanSlotRow,
  blockRows: PlanBlockRow[],
  algorithmSlot?: SessionSlot | null
) {
  const fallbackAlgorithmSlot = mapSlotRowsToAlgorithmSlots([slot])[0];
  if (!fallbackAlgorithmSlot) return "blocked" as const;
  const slotSeed = buildPlacementSeed([slot], blockRows)[slot.slot_id] ?? [];
  const blockMap = new Map(
    mapBlockRowsToAlgorithmBlocks(blockRows).map((block) => [block.id, block] as const)
  );
  return classifySlot(
    {
      ...(algorithmSlot ?? fallbackAlgorithmSlot),
      locked: Boolean(slot.is_locked),
      placements: [...slotSeed],
    },
    blockMap
  );
}

function isEligibleEmptyPlanSlot(
  slot: PlanSlotRow,
  blockRows: PlanBlockRow[],
  algorithmSlot?: SessionSlot | null
) {
  return classifyPlanSlotState(slot, blockRows, algorithmSlot) === "empty";
}

function getQuizCoverageFromMetadata(
  metadata: Record<string, unknown> | null | undefined
) {
  const source = metadata ?? {};
  const coveredLessonIds = Array.isArray(source.coveredLessonIds)
    ? source.coveredLessonIds.filter((value): value is string => typeof value === "string")
    : [];
  const coveredLessonOrders = Array.isArray(source.coveredLessonOrders)
    ? source.coveredLessonOrders
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const startOrder = Number(source.coveredLessonStartOrder ?? 0);
  const endOrder = Number(source.coveredLessonEndOrder ?? 0);
  const lessonCount = Number(source.coveredLessonCount ?? coveredLessonOrders.length);
  if (coveredLessonIds.length === 0 || coveredLessonOrders.length === 0 || startOrder <= 0 || endOrder <= 0) {
    return null;
  }
  return {
    coveredLessonIds,
    coveredLessonOrders,
    startOrder,
    endOrder,
    lessonCount,
  };
}

function buildQuizCoverageMetadataFromLessons(input: {
  lessons: LessonScopeOption[];
  existingMetadata?: Record<string, unknown> | null;
  globalQuizOrder: number;
  termQuizOrder: number;
  globalWwOrder: number;
}) {
  const { lessons, existingMetadata, globalQuizOrder, termQuizOrder, globalWwOrder } = input;
  const firstLesson = lessons[0] ?? null;
  const lastLesson = lessons[lessons.length - 1] ?? null;
  return {
    ...(existingMetadata ?? {}),
    quizOrder: globalQuizOrder,
    globalQuizOrder,
    termQuizOrder,
    globalWwOrder,
    coveredLessonIds: lessons.map((lesson) => lesson.lessonId),
    coveredLessonOrders: lessons.map((lesson) => lesson.lessonOrder),
    coveredLessonStartOrder: firstLesson?.lessonOrder ?? 0,
    coveredLessonEndOrder: lastLesson?.lessonOrder ?? 0,
    coveredLessonCount: lessons.length,
    afterLessonOrder: lastLesson?.lessonOrder ?? 0,
  };
}

function splitLessonOptionsIntoContiguousRanges(lessons: LessonScopeOption[]) {
  if (lessons.length === 0) return [] as LessonScopeOption[][];
  const sorted = [...lessons].sort((a, b) => a.lessonOrder - b.lessonOrder);
  const ranges: LessonScopeOption[][] = [];
  let current: LessonScopeOption[] = [sorted[0]!];

  for (let index = 1; index < sorted.length; index += 1) {
    const lesson = sorted[index]!;
    const previous = current[current.length - 1]!;
    if (lesson.lessonOrder === previous.lessonOrder + 1) {
      current.push(lesson);
      continue;
    }
    ranges.push(current);
    current = [lesson];
  }

  ranges.push(current);
  return ranges;
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
    const lessonOrder =
      getCanonicalSequenceValue({
        category: "lesson",
        metadata: block.metadata,
        title: block.title,
      }) || inferLessonOrder(block.title, index + 1);
    const resolvedSourceTocId =
      typeof block.metadata?.sourceTocId === "string" && block.metadata.sourceTocId.trim()
        ? block.metadata.sourceTocId.trim()
        : null;
    const resolvedLessonTitle =
      typeof block.metadata?.lessonTitle === "string" && block.metadata.lessonTitle.trim()
        ? block.metadata.lessonTitle.trim()
        : block.title.trim();
    const sourceId =
      resolvedSourceTocId ||
      block.lesson_id ||
      (lessonOrder > 0 ? `lesson_order_${lessonOrder}` : null) ||
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
      title: resolvedLessonTitle,
      order: lessonOrder,
      estimatedMinutes: Math.max(30, Number(block.estimated_minutes ?? 60)),
      difficulty,
      preferredSessionType: inferSessionType(block.preferred_session_type ?? block.meeting_type),
      required: true,
    });
  });

  return Array.from(deduped.values()).sort((a, b) => a.order - b.order);
}

function dedupeCurrentTermBlocks(blocks: Block[]) {
  const blockRank = (block: Block) => {
    let score = 0;
    if (block.sourceTocId) score += 4;
    if (typeof block.metadata.globalLessonOrder === "number" || typeof block.metadata.lessonOrder === "number") score += 2;
    if (block.type === "exam") score += 1;
    return score;
  };

  const kept: Block[] = [];
  const seen = new Map<string, Block>();

  for (const block of blocks) {
    if (Boolean(block.metadata.extraCandidateType)) {
      kept.push(block);
      continue;
    }
    const identity = buildAutoBlockIdentity({
      category: block.type,
      subcategory: block.subcategory,
      sourceTocId: block.sourceTocId ?? null,
      metadata: block.metadata,
      title: block.title,
    });
    if (!identity) {
      kept.push(block);
      continue;
    }
    const existing = seen.get(identity) ?? null;
    if (!existing) {
      seen.set(identity, block);
      kept.push(block);
      continue;
    }
    if (blockRank(block) > blockRank(existing)) {
      const existingIndex = kept.findIndex((candidate) => candidate.id === existing.id);
      if (existingIndex >= 0) kept[existingIndex] = block;
      seen.set(identity, block);
    }
  }

  return kept;
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

function comparePlanSlotRows(a: PlanSlotRow, b: PlanSlotRow) {
  const dateCompare = a.slot_date.localeCompare(b.slot_date);
  if (dateCompare !== 0) return dateCompare;
  const timeCompare = (toHm(a.start_time) ?? "").localeCompare(toHm(b.start_time) ?? "");
  if (timeCompare !== 0) return timeCompare;
  const slotNumberCompare = Number(a.slot_number ?? 0) - Number(b.slot_number ?? 0);
  if (slotNumberCompare !== 0) return slotNumberCompare;
  return a.slot_id.localeCompare(b.slot_id);
}

function isSeriesCategoryMatch(block: PlanBlockRow, category: string) {
  if (Boolean(block.metadata?.extraCandidateType)) return false;
  if (category === "lesson") return block.session_category === "lesson";
  if (category === "written_work") {
    return block.session_category === "written_work" && block.session_subcategory !== "quiz";
  }
  if (category === "performance_task") return block.session_category === "performance_task";
  if (category === "exam") return block.session_category === "exam";
  return false;
}

function buildRenumberedSeriesMetadata(input: {
  block: Pick<PlanBlockRow, "metadata" | "session_category">;
  category: string;
  sequence: number;
  termOffsets: Map<number, { lesson: number; ww: number; pt: number; quiz: number }>;
}) {
  const metadata = { ...(input.block.metadata ?? {}) };
  const termIndex = Number(metadata.termIndex ?? -1);
  const termOffset = input.termOffsets.get(termIndex) ?? { lesson: 0, ww: 0, pt: 0, quiz: 0 };

  if (input.category === "lesson") {
    metadata.globalLessonOrder = input.sequence;
    if (termIndex >= 0) {
      metadata.lessonOrder = Math.max(1, input.sequence - termOffset.lesson);
    }
  } else if (input.category === "written_work") {
    metadata.globalWwOrder = input.sequence;
    metadata.wwOrder = input.sequence;
  } else if (input.category === "performance_task") {
    metadata.globalPtOrder = input.sequence;
    metadata.ptOrder = input.sequence;
  }

  return metadata;
}

function getAutomaticCreateCategoryTitle(input: {
  category: string;
  sequence: number;
  termKey?: string | null;
}) {
  if (input.category === "lesson") return `L${input.sequence}`;
  if (input.category === "written_work") return `WW${input.sequence}`;
  if (input.category === "performance_task") return `PT${input.sequence}`;
  if (input.category === "exam") {
    if (input.termKey === "prelim") return "Prelim Exam";
    if (input.termKey === "midterm") return "Midterm Exam";
    return "Final Exam";
  }
  return "Untitled";
}

function buildBlockMap(blocks: Block[]) {
  return new Map(blocks.map((block) => [block.id, block]));
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
    .sort((a, b) => {
      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) return rankDiff;
      const aBlock = blockMap.get(a.blockId) ?? null;
      const bBlock = blockMap.get(b.blockId) ?? null;
      const sequenceDiff =
        getCanonicalSequenceValue({
          category: aBlock?.type,
          subcategory: aBlock?.subcategory,
          metadata: aBlock?.metadata,
          title: aBlock?.title,
        }) -
        getCanonicalSequenceValue({
          category: bBlock?.type,
          subcategory: bBlock?.subcategory,
          metadata: bBlock?.metadata,
          title: bBlock?.title,
        });
      if (sequenceDiff !== 0) return sequenceDiff;
      return a.blockId.localeCompare(b.blockId);
    })
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

function getMissingRequiredBlockIds(termSlots: SessionSlot[], termBlocks: Block[]) {
  const placedIds = new Set(termSlots.flatMap((slot) => slot.placements.map((placement) => placement.blockId)));
  return termBlocks
    .filter((block) => {
      if (!block.required) return false;
      if (block.type === "exam") return false;
      if (block.metadata.extraCandidateType) return false;
      return !placedIds.has(block.id);
    })
    .map((block) => block.id);
}

function comparePlacementOrder(
  a: { slotIndex: number; placementIndex: number } | null,
  b: { slotIndex: number; placementIndex: number } | null
) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
  return a.placementIndex - b.placementIndex;
}

function buildFirstPlacementOrderMap(termSlots: SessionSlot[]) {
  const sortedTermSlots = [...termSlots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });
  const firstPlacementOrderByBlockId = new Map<string, { slotIndex: number; placementIndex: number }>();
  sortedTermSlots.forEach((slot, slotIndex) => {
    slot.placements.forEach((placement, placementIndex) => {
      if (!firstPlacementOrderByBlockId.has(placement.blockId)) {
        firstPlacementOrderByBlockId.set(placement.blockId, { slotIndex, placementIndex });
      }
    });
  });
  return firstPlacementOrderByBlockId;
}

function getValidationBlockKey(block: Block) {
  return (
    buildAutoBlockIdentity({
      category: block.type,
      subcategory: block.subcategory,
      sourceTocId: block.sourceTocId ?? null,
      metadata: block.metadata,
      title: block.title,
    }) ?? block.id
  );
}

function buildFirstPlacementOrderMapByValidationKey(termSlots: SessionSlot[], termBlocks: Block[]) {
  const sortedTermSlots = [...termSlots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });
  const blockMap = buildBlockMap(termBlocks);
  const firstPlacementOrderByValidationKey = new Map<string, { slotIndex: number; placementIndex: number }>();
  sortedTermSlots.forEach((slot, slotIndex) => {
    slot.placements.forEach((placement, placementIndex) => {
      const block = blockMap.get(placement.blockId) ?? null;
      if (!block) return;
      const key = getValidationBlockKey(block);
      if (!firstPlacementOrderByValidationKey.has(key)) {
        firstPlacementOrderByValidationKey.set(key, { slotIndex, placementIndex });
      }
    });
  });
  return firstPlacementOrderByValidationKey;
}

function applyLegacyRequiredBlockRecoveryFallback(termSlots: SessionSlot[], termBlocks: Block[]) {
  const sortedTermSlots = [...termSlots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });
  const blockMap = buildBlockMap(termBlocks);
  const placedIds = new Set(sortedTermSlots.flatMap((slot) => slot.placements.map((placement) => placement.blockId)));
  const examIndex = sortedTermSlots.findIndex((slot) =>
    slot.placements.some((placement) => {
      const block = blockMap.get(placement.blockId) ?? null;
      return block?.type === "exam";
    })
  );
  const firstPlacementOrderByBlockId = buildFirstPlacementOrderMap(sortedTermSlots);
  const candidateSlotIndexes = sortedTermSlots
    .map((slot, index) => {
      if (slot.locked) return -1;
      if (examIndex >= 0 && index > examIndex) return -1;
      if (
        slot.placements.some((placement) => {
          const block = blockMap.get(placement.blockId) ?? null;
          return block?.type === "exam";
        })
      ) {
        return -1;
      }
      return index;
    })
    .filter((index) => index >= 0);
  if (candidateSlotIndexes.length === 0) return;

  const findPreferredSlotIndex = (block: Block) => {
    const orderedPeers = termBlocks
      .filter(
        (candidate) =>
          candidate.id !== block.id &&
          candidate.type === block.type &&
          candidate.subcategory === block.subcategory &&
          !candidate.metadata.extraCandidateType
      )
      .sort((a, b) => compareBlocksByCanonicalSequence(a, b));
    const previousPeer = [...orderedPeers]
      .reverse()
      .find(
        (candidate) =>
          getCanonicalSequenceValue(candidate) < getCanonicalSequenceValue(block) &&
          firstPlacementOrderByBlockId.has(candidate.id)
      );
    if (previousPeer) {
      return firstPlacementOrderByBlockId.get(previousPeer.id)?.slotIndex ?? candidateSlotIndexes[0]!;
    }
    return candidateSlotIndexes[0]!;
  };

  const placeBlockInNearestSlot = (block: Block, preferredIndex: number) => {
    if (placedIds.has(block.id)) return;
    const orderedCandidateIndexes = [...candidateSlotIndexes].sort((a, b) => {
      const distanceDiff = Math.abs(a - preferredIndex) - Math.abs(b - preferredIndex);
      if (distanceDiff !== 0) return distanceDiff;
      return a - b;
    });
    const targetIndex = orderedCandidateIndexes[0];
    if (typeof targetIndex !== "number") return;
    addRecoveredPlacement(
      sortedTermSlots[targetIndex]!,
      block,
      block.type === "exam" ? "major" : "minor"
    );
    placedIds.add(block.id);
    if (!firstPlacementOrderByBlockId.has(block.id)) {
      firstPlacementOrderByBlockId.set(block.id, {
        slotIndex: targetIndex,
        placementIndex: sortedTermSlots[targetIndex]!.placements.length - 1,
      });
    }
  };

  const missingRequiredBlocks = termBlocks
    .filter((block) => block.required && !block.metadata.extraCandidateType && !placedIds.has(block.id))
    .filter((block) => block.type !== "exam")
    .sort((a, b) => {
      const categoryRank = (candidate: Block) => {
        if (candidate.type === "buffer" && candidate.subcategory === "orientation") return 0;
        if (candidate.type === "lesson") return 1;
        if (candidate.type === "performance_task") return 2;
        if (candidate.type === "written_work" && candidate.subcategory === "quiz") return 3;
        if (candidate.type === "written_work") return 4;
        if (candidate.type === "buffer") return 5;
        return 99;
      };
      const rankDiff = categoryRank(a) - categoryRank(b);
      if (rankDiff !== 0) return rankDiff;
      return compareBlocksByCanonicalSequence(a, b);
    });
  missingRequiredBlocks.forEach((block) => {
    placeBlockInNearestSlot(block, findPreferredSlotIndex(block));
  });

  sortedTermSlots.forEach((slot) => rebuildSlotPlacementOrder(slot, blockMap));
}

function normalizeTermPlacements(termSlots: SessionSlot[], termBlocks: Block[]) {
  const sortedTermSlots = [...termSlots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });
  const blockMap = buildBlockMap(termBlocks);

  const reorderPlacementsByFirstAppearance = (matcher: (block: Block) => boolean) => {
    const orderedBlocks = termBlocks
      .filter((block) => matcher(block))
      .sort((a, b) => compareBlocksByCanonicalSequence(a, b));
    const positions = sortedTermSlots.flatMap((slot) =>
      slot.placements
        .map((placement, placementIndex) => ({
          slot,
          placementIndex,
          block: blockMap.get(placement.blockId) ?? null,
        }))
        .filter(
          (entry): entry is { slot: SessionSlot; placementIndex: number; block: Block } =>
            Boolean(entry.block && matcher(entry.block))
        )
    );
    const count = Math.min(orderedBlocks.length, positions.length);
    for (let index = 0; index < count; index += 1) {
      const targetBlock = orderedBlocks[index]!;
      const targetPosition = positions[index]!;
      const existingPlacement = targetPosition.slot.placements[targetPosition.placementIndex];
      if (!existingPlacement) continue;
      targetPosition.slot.placements[targetPosition.placementIndex] = {
        ...existingPlacement,
        blockId: targetBlock.id,
        chainId: targetBlock.id,
      };
    }
  };

  reorderPlacementsByFirstAppearance(
    (block) => block.type === "lesson" && !block.metadata.extraCandidateType
  );
  reorderPlacementsByFirstAppearance(
    (block) => block.type === "performance_task" && !block.metadata.extraCandidateType
  );
  reorderPlacementsByFirstAppearance(
    (block) => block.type === "written_work" && block.subcategory === "quiz" && !block.metadata.extraCandidateType
  );
  reorderPlacementsByFirstAppearance(
    (block) => block.type === "written_work" && block.subcategory !== "quiz" && !block.metadata.extraCandidateType
  );

  const orderedLessonsAndQuizzes = termBlocks
    .filter(
      (block) =>
        !block.metadata.extraCandidateType &&
        (block.type === "lesson" ||
          (block.type === "written_work" && block.subcategory === "quiz"))
    )
    .sort((a, b) => {
      const categoryDiff =
        Number(a.type === "written_work" && a.subcategory === "quiz") -
        Number(b.type === "written_work" && b.subcategory === "quiz");
      if (categoryDiff !== 0) return categoryDiff;
      return compareBlocksByCanonicalSequence(a, b);
    });
  const lessonAndQuizPositions = sortedTermSlots.flatMap((slot) =>
    slot.placements
      .map((placement, placementIndex) => ({
        slot,
        placementIndex,
        block: blockMap.get(placement.blockId) ?? null,
      }))
      .filter(
        (entry): entry is { slot: SessionSlot; placementIndex: number; block: Block } =>
          Boolean(
            entry.block &&
              !entry.block.metadata.extraCandidateType &&
              (entry.block.type === "lesson" ||
                (entry.block.type === "written_work" && entry.block.subcategory === "quiz"))
          )
      )
  );
  const lessonAndQuizCount = Math.min(orderedLessonsAndQuizzes.length, lessonAndQuizPositions.length);
  for (let index = 0; index < lessonAndQuizCount; index += 1) {
    const targetBlock = orderedLessonsAndQuizzes[index]!;
    const targetPosition = lessonAndQuizPositions[index]!;
    const existingPlacement = targetPosition.slot.placements[targetPosition.placementIndex];
    if (!existingPlacement) continue;
    targetPosition.slot.placements[targetPosition.placementIndex] = {
      ...existingPlacement,
      blockId: targetBlock.id,
      chainId: targetBlock.id,
    };
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
  const validationBlocks = dedupeCurrentTermBlocks(termBlocks);
  const examBlock = validationBlocks.find((block) => block.type === "exam") ?? null;
  if (!examBlock) return;

  const placedValidationKeys = new Set(
    sortedTermSlots.flatMap((slot) =>
      slot.placements.flatMap((placement) => {
        const block = blockMap.get(placement.blockId) ?? null;
        return block ? [getValidationBlockKey(block)] : [];
      })
    )
  );
  const placedLessons = validationBlocks.filter(
    (block) =>
      block.type === "lesson" &&
      !block.metadata.extraCandidateType &&
      placedValidationKeys.has(getValidationBlockKey(block))
  ).length;
    const placedWW = validationBlocks.filter(
      (block) =>
        block.type === "written_work" &&
        !block.metadata.extraCandidateType &&
        placedValidationKeys.has(getValidationBlockKey(block))
    ).length;

    const placedPT = validationBlocks.filter(
      (block) =>
        block.type === "performance_task" &&
        !block.metadata.extraCandidateType &&
        placedValidationKeys.has(getValidationBlockKey(block))
    ).length;

  const expectedLessons = Number(examBlock.metadata.termLessons ?? 0);
  const expectedWW = Number(examBlock.metadata.termWW ?? 0);
  const expectedPT = Number(examBlock.metadata.termPT ?? 0);

  if (
    placedLessons < expectedLessons ||
    placedWW < expectedWW ||
    placedPT < expectedPT 
  ) {
    const missingParts: string[] = [];
    if (placedLessons < expectedLessons) {
      missingParts.push(`lessons ${placedLessons}/${expectedLessons}`);
    }
    if (placedWW < expectedWW) {
      missingParts.push(`written works ${placedWW}/${expectedWW}`);
    }
    if (placedPT < expectedPT) {
      missingParts.push(`performance tasks ${placedPT}/${expectedPT}`);
    }
    throw new Error(
  `Term requirements are incomplete after this adjustment (${missingParts.join(", ")}).`
    );
  }

  const firstPlacementOrderByValidationKey = buildFirstPlacementOrderMapByValidationKey(sortedTermSlots, termBlocks);
  const examPlacement = sortedTermSlots.findIndex((slot) =>
    slot.placements.some((placement) => {
      const block = blockMap.get(placement.blockId) ?? null;
      return block?.type === "exam" && placement.lane === "major";
    })
  );
  if (examPlacement < 0) {
    throw new Error("Exam must remain scheduled as a major block.");
  }

  const hasRequiredAfterExam = sortedTermSlots.slice(examPlacement + 1).some((slot) =>
    slot.placements.some((placement) => {
      const block = blockMap.get(placement.blockId) ?? null;
      return Boolean(block?.required) && block?.type !== "exam" && !block?.metadata.extraCandidateType;
    })
  );
  if (hasRequiredAfterExam) {
    throw new Error("Required blocks cannot appear after the exam slot in a term.");
  }

  const assertOrderedByFirstAppearance = (
    matcher: (block: Block) => boolean,
    label: string
  ) => {
    const orderedBlocks = validationBlocks
      .filter((block) => matcher(block))
      .sort((a, b) => compareBlocksByCanonicalSequence(a, b));
    let previous: { slotIndex: number; placementIndex: number } | null = null;
    let previousBlock: Block | null = null;
    for (const block of orderedBlocks) {
      const current = firstPlacementOrderByValidationKey.get(getValidationBlockKey(block)) ?? null;
      if (!current) {
        throw new Error(`Required ${label} block is not scheduled.`);
      }
      if (comparePlacementOrder(previous, current) > 0) {
        const previousOrder = previousBlock
          ? getCanonicalSequenceValue(previousBlock)
          : null;
        const currentOrder = getCanonicalSequenceValue(block);
        throw new Error(
          `Required ${label} ordering became invalid after this adjustment: ` +
            `${previousBlock?.title ?? previousBlock?.id ?? "previous"} ` +
            `(order ${previousOrder ?? "?"}, slot ${previous?.slotIndex ?? "?"}) appears after ` +
            `${block.title || block.id} (order ${currentOrder}, slot ${current.slotIndex}).`
        );
      }
      previous = current;
      previousBlock = block;
    }
  };

  assertOrderedByFirstAppearance(
    (block) => block.type === "lesson" && !block.metadata.extraCandidateType,
    "lesson"
  );
  assertOrderedByFirstAppearance(
    (block) => block.type === "performance_task" && !block.metadata.extraCandidateType,
    "performance task"
  );
  assertOrderedByFirstAppearance(
    (block) => block.type === "written_work" && block.subcategory === "quiz",
    "quiz"
  );
  assertOrderedByFirstAppearance(
    (block) => block.type === "written_work" && block.subcategory !== "quiz" && !block.metadata.extraCandidateType,
    "written work"
  );

  const lessonBlocks = validationBlocks
    .filter((block) => block.type === "lesson" && !block.metadata.extraCandidateType)
    .sort((a, b) => compareBlocksByCanonicalSequence(a, b));
  const firstLessonPlacement = lessonBlocks.length > 0
    ? (firstPlacementOrderByValidationKey.get(getValidationBlockKey(lessonBlocks[0]!)) ?? null)
    : null;
  const nonLessonLeadingBlocks = validationBlocks
    .filter(
      (block) =>
        (block.type === "performance_task" ||
          block.type === "written_work") &&
        !block.metadata.extraCandidateType
    )
    .map((block) => firstPlacementOrderByValidationKey.get(getValidationBlockKey(block)) ?? null)
    .filter((value): value is { slotIndex: number; placementIndex: number } => Boolean(value))
    .some((placement) => comparePlacementOrder(placement, firstLessonPlacement) < 0);
  if (firstLessonPlacement && nonLessonLeadingBlocks) {
    throw new Error("Written work and performance tasks cannot appear before the first lesson in a term.");
  }

  const finalQuiz = validationBlocks
    .filter((block) => block.type === "written_work" && block.subcategory === "quiz" && !block.metadata.extraCandidateType)
    .sort((a, b) => compareBlocksByCanonicalSequence(a, b))
    .at(-1) ?? null;
  const finalQuizPlacement = finalQuiz
    ? (firstPlacementOrderByValidationKey.get(getValidationBlockKey(finalQuiz)) ?? null)
    : null;
  const lastLessonPlacement = lessonBlocks
    .map((block) => firstPlacementOrderByValidationKey.get(getValidationBlockKey(block)) ?? null)
    .filter((value): value is { slotIndex: number; placementIndex: number } => Boolean(value))
    .at(-1) ?? null;
  if (finalQuizPlacement && lastLessonPlacement && comparePlacementOrder(finalQuizPlacement, lastLessonPlacement) <= 0) {
    throw new Error("Final quiz must appear after all lesson blocks in a term.");
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

function summarizeBlockRowCounts(blocks: PlanBlockRow[]) {
  return {
    lesson: blocks.filter((block) => block.session_category === "lesson" && Boolean(block.required) && !Boolean(block.metadata?.extraCandidateType)).length,
    writtenWork: blocks.filter(
      (block) =>
        block.session_category === "written_work" &&
        Boolean(block.required) &&
        !Boolean(block.metadata?.extraCandidateType)
    ).length,
    performanceTask: blocks.filter(
      (block) =>
        block.session_category === "performance_task" &&
        Boolean(block.required) &&
        !Boolean(block.metadata?.extraCandidateType)
    ).length,
    quiz: blocks.filter(
      (block) =>
        block.session_category === "written_work" &&
        block.session_subcategory === "quiz" &&
        Boolean(block.required) &&
        !Boolean(block.metadata?.extraCandidateType)
    ).length,
    exam: blocks.filter((block) => block.session_category === "exam" && Boolean(block.required)).length,
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
function repairTermAfterRepopulation(termSlots: SessionSlot[], termBlocks: Block[]) {
  const sortedSlots = [...termSlots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });

  const blockMap = buildBlockMap(termBlocks);
  const termIndex = Number(sortedSlots[0]?.termIndex ?? 0);
  const firstSlot = sortedSlots[0];
  if (!firstSlot) return;

  const isRequiredRealBlock = (block: Block | null | undefined) =>
    Boolean(block?.required && !block.metadata.extraCandidateType);

  const isLesson = (block: Block | null | undefined) =>
    block?.type === "lesson" && !block.metadata.extraCandidateType;

  const isOrientation = (block: Block | null | undefined) =>
    block?.type === "buffer" && block.subcategory === "orientation";

  const isAssessment = (block: Block | null | undefined) =>
    Boolean(
      block &&
        !block.metadata.extraCandidateType &&
        (block.type === "written_work" || block.type === "performance_task")
    );

  const isExam = (block: Block | null | undefined) => block?.type === "exam";

  const examIndex = sortedSlots.findIndex((slot) =>
    slot.placements.some((p) => isExam(blockMap.get(p.blockId)))
  );

  const lastAllowedIndex = examIndex >= 0 ? examIndex - 1 : sortedSlots.length - 1;

  const removeBlockEverywhere = (blockId: string) => {
    for (const slot of sortedSlots) {
      slot.placements = slot.placements.filter((p) => p.blockId !== blockId);
    }
  };

  const makePlacement = (block: Block, slot: SessionSlot, lane: "major" | "minor") => ({
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

  /**
   * 1. Collect first-slot invalid blocks BEFORE clearing first slot.
   */
  const displaced: { block: Block; lane: "major" | "minor" }[] = [];

  for (const placement of firstSlot.placements) {
    const block = blockMap.get(placement.blockId);
    if (!block) continue;

    if (isAssessment(block)) {
      displaced.push({
        block,
        lane: block.type === "exam" ? "major" : "minor"
      });
    }
  }

  /**
   * 2. First slot rule.
   * First term = orientation only.
   * Later terms = first lesson only.
   */
  const requiredFirstBlock =
    termIndex === 0
      ? termBlocks.find((block) => isOrientation(block)) ?? null
      : termBlocks
          .filter((block) => isLesson(block))
          .sort((a, b) => compareBlocksByCanonicalSequence(a, b))[0] ?? null;

  if (requiredFirstBlock) {
    removeBlockEverywhere(requiredFirstBlock.id);
    firstSlot.placements = [makePlacement(requiredFirstBlock, firstSlot, "major")];
  }

  /**
   * 3. Build the required block list.
   */
  const placedIds = new Set(
    sortedSlots.flatMap((slot) => slot.placements.map((p) => p.blockId))
  );

  const requiredUnplaced = termBlocks
    .filter((block) => isRequiredRealBlock(block))
    .filter((block) => block.type !== "exam")
    .filter((block) => !placedIds.has(block.id))
    .sort((a, b) => compareBlocksByCanonicalSequence(a, b));

  for (const block of requiredUnplaced) {
    displaced.push({
      block,
      lane: block.type === "exam" ? "major" : "minor"
    });
  }

  /**
   * 4. Place displaced blocks.
   * Priority:
   * - use empty major slots first
   * - minor written works may overlay lessons
   * - if no empty slot remains, controlled overflow is allowed after lesson 1
   */
const findAnyValidSlot = (startIndex: number) =>
  sortedSlots.find((slot, index) => {
    if (index < startIndex) return false;
    if (index > lastAllowedIndex) return false;
    if (slot.locked) return false;

    const blocks = slot.placements
      .map((p) => blockMap.get(p.blockId))
      .filter((b): b is Block => Boolean(b));

    if (blocks.some((block) => isExam(block))) return false;
    if (blocks.some((block) => isOrientation(block))) return false;

    return blocks.length < 4;
  }) ?? null;



  const findControlledOverflowSlot = (startIndex: number) =>
    sortedSlots.find((slot, index) => {
      if (index < startIndex) return false;
      if (index > lastAllowedIndex) return false;
      if (slot.locked) return false;

      const blocks = slot.placements
        .map((p) => blockMap.get(p.blockId))
        .filter((b): b is Block => Boolean(b));

      if (blocks.some((block) => isExam(block))) return false;
      if (blocks.some((block) => isOrientation(block))) return false;

      return blocks.length < 4;
    }) ?? null;

  for (const item of displaced) {
    removeBlockEverywhere(item.block.id);

const startIndex = termIndex === 0 ? 1 : 0;
const target = findAnyValidSlot(startIndex);
if (!target) continue;

target.placements.push(makePlacement(item.block, target, "minor"));
    placedIds.add(item.block.id);
  }

  sortedSlots.forEach((slot) => rebuildSlotPlacementOrder(slot, blockMap));
}
function enforceNoAssessmentsBeforeFirstLesson(termSlots: SessionSlot[], termBlocks: Block[]) {
  const sortedSlots = [...termSlots].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });

  const blockMap = buildBlockMap(termBlocks);

  const firstLessonIndex = sortedSlots.findIndex((slot) =>
    slot.placements.some((placement) => {
      const block = blockMap.get(placement.blockId);
      return block?.type === "lesson" && !block.metadata.extraCandidateType;
    })
  );

  if (firstLessonIndex < 0) return;

  const examIndex = sortedSlots.findIndex((slot) =>
    slot.placements.some((placement) => blockMap.get(placement.blockId)?.type === "exam")
  );

  const misplaced: SessionSlot["placements"] = [];

  sortedSlots.forEach((slot, slotIndex) => {
    slot.placements = slot.placements.filter((placement, placementIndex) => {
      const block = blockMap.get(placement.blockId);
      if (!block) return true;

      const isAssessment =
        !block.metadata.extraCandidateType &&
        (block.type === "written_work" || block.type === "performance_task");

      if (!isAssessment) return true;

      const appearsBeforeFirstLesson =
        slotIndex < firstLessonIndex ||
        (slotIndex === firstLessonIndex &&
          placementIndex <
            slot.placements.findIndex((p) => {
              const candidate = blockMap.get(p.blockId);
              return candidate?.type === "lesson" && !candidate.metadata.extraCandidateType;
            }));

      if (!appearsBeforeFirstLesson) return true;

      misplaced.push(placement);
      return false;
    });
  });

  for (const placement of misplaced) {
    const block = blockMap.get(placement.blockId);
    if (!block) continue;

    const targetSlot = sortedSlots.find((slot, index) => {
      if (index < firstLessonIndex) return false;
      if (examIndex >= 0 && index >= examIndex) return false;
      if (slot.locked) return false;

      if (block.overlayMode === "minor") {
        return slot.placements.some((p) => {
          const placedBlock = blockMap.get(p.blockId);
          return placedBlock?.type === "lesson";
        });
      }

      return !slot.placements.some((p) => {
        const placedBlock = blockMap.get(p.blockId);
        return placedBlock && placedBlock.overlayMode !== "minor";
      });
    });

    if (!targetSlot) continue;

    targetSlot.placements.push({
      ...placement,
      slotId: targetSlot.id,
      id: makePlacementId(placement.blockId, targetSlot.id, targetSlot.placements.length + 1),
    });
  }

  sortedSlots.forEach((slot) => rebuildSlotPlacementOrder(slot, blockMap));
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
  const scheduledEntries = applyEntryDisplayOrders(buildPlanEntriesFromScheduledSlots(scheduledSlots).sort(entrySort));

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
  const expectedBlocks = buildBlocks({
  courseId: input.lessonPlanId,
  tocUnits,
  teacherRules,
  examBlockTemplates,
  slots: algorithmSlots,
  initialDelayDates: input.blackoutDates,
} satisfies BuildBlocksInput);
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
  const [repopulateMutating, setRepopulateMutating] = useState(false);
  const [suspensionPickerVisible, setSuspensionPickerVisible] = useState(false);
  const [suspensionSelectedPlanIds, setSuspensionSelectedPlanIds] = useState<string[]>([]);
  const [entryEditor, setEntryEditor] = useState<EntryEditorState>({
    visible: false,
    mode: "create",
    targetEntryId: null,
    lessonId: null,
    title: "",
    description: "",
    category: "",
    subtype: "",
    customSubtype: "",
    startDate: toLocalDateString(),
    endDate: toLocalDateString(),
    startTime: "",
    endTime: "",
    reviewDays: "1",
    quizScopeStartLessonId: null,
    quizScopeEndLessonId: null,
  });
  const createSubtypeReveal = useRef(new Animated.Value(0)).current;
  const createTimeReveal = useRef(new Animated.Value(0)).current;
  const [monthCellLayouts, setMonthCellLayouts] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const [dailyTimeEdit, setDailyTimeEdit] = useState<DailyTimeEditState | null>(null);
  const [createDropdownOpen, setCreateDropdownOpen] = useState<CreateDropdownField>(null);
  const dailyBlockSwipeClosersRef = useRef<Record<string, (() => void) | null>>({});
  const openDailyBlockSwipeKeyRef = useRef<string | null>(null);
  const showCreateSubtypeSection = entryEditor.visible && entryEditor.mode === "create" && Boolean(entryEditor.category);
  const showCreateTimeSection = showCreateSubtypeSection && Boolean(entryEditor.subtype);

  useEffect(() => {
    Animated.timing(createSubtypeReveal, {
      toValue: showCreateSubtypeSection ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [createSubtypeReveal, showCreateSubtypeSection]);

  useEffect(() => {
    Animated.timing(createTimeReveal, {
      toValue: showCreateTimeSection ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [createTimeReveal, showCreateTimeSection]);

  useEffect(() => {
    if (!entryEditor.visible || entryEditor.mode !== "create") {
      setCreateDropdownOpen(null);
      return;
    }
    if (!showCreateSubtypeSection && createDropdownOpen === "subtype") {
      setCreateDropdownOpen(null);
      return;
    }
    if (!showCreateTimeSection && (createDropdownOpen === "startTime" || createDropdownOpen === "endTime")) {
      setCreateDropdownOpen(null);
    }
  }, [createDropdownOpen, entryEditor.mode, entryEditor.visible, showCreateSubtypeSection, showCreateTimeSection]);

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
        const [
          { data: slotRows, error: slotsError },
          { data: blockRows, error: blocksError },
          { data: planContentRows, error: planContentError },
        ] = await Promise.all([
          supabase
            .from("slots")
            .select("slot_id, lesson_plan_id, title, slot_date, weekday, start_time, end_time, meeting_type, room, slot_number, series_key, is_locked")
            .in("lesson_plan_id", lessonPlanIds)
            .order("slot_date", { ascending: true })
            .order("start_time", { ascending: true }),
          supabase
            .from("blocks")
            .select("block_id, lesson_plan_id, slot_id, root_block_id, lesson_id, algorithm_block_key, block_key, title, description, session_category, session_subcategory, meeting_type, estimated_minutes, min_minutes, max_minutes, required, splittable, overlay_mode, preferred_session_type, dependency_keys, order_no, is_locked, ww_subtype, pt_subtype, metadata, lesson:lessons(title)")
            .in("lesson_plan_id", lessonPlanIds)
            .order("created_at", { ascending: true }),
          supabase
            .from("plan_subject_content")
            .select("lesson_plan_id, lesson_id, lesson:lessons(lesson_id, title, sequence_no, chapter:chapters(sequence_no))")
            .in("lesson_plan_id", lessonPlanIds)
            .eq("content_level", "lesson"),
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
          const normalizedBlockRows = blockRows ?? [];
          const lessonCatalogByPlanId = new Map<string, { lesson_id: string; title: string; chapterSequence: number; lessonSequence: number }[]>();
          if (planContentError) {
            console.warn("[calendar] Unable to load plan lesson content", planContentError.message);
          } else {
            for (const row of planContentRows ?? []) {
              if (!row?.lesson_plan_id || !row?.lesson_id) continue;
              const lessonRaw = row?.lesson;
              const lesson = Array.isArray(lessonRaw) ? lessonRaw[0] : lessonRaw;
              const chapterRaw = lesson?.chapter;
              const chapter = Array.isArray(chapterRaw) ? chapterRaw[0] : chapterRaw;
              const current = lessonCatalogByPlanId.get(String(row.lesson_plan_id)) ?? [];
              current.push({
                lesson_id: String(row.lesson_id),
                title: lesson?.title ? String(lesson.title) : "Untitled Lesson",
                chapterSequence: typeof chapter?.sequence_no === "number" ? Number(chapter.sequence_no) : Number.MAX_SAFE_INTEGER,
                lessonSequence: typeof lesson?.sequence_no === "number" ? Number(lesson.sequence_no) : Number.MAX_SAFE_INTEGER,
              });
              lessonCatalogByPlanId.set(String(row.lesson_plan_id), current);
            }
            for (const [planId, lessons] of lessonCatalogByPlanId.entries()) {
              lessonCatalogByPlanId.set(
                planId,
                [...lessons].sort((a, b) => {
                  if (a.chapterSequence !== b.chapterSequence) return a.chapterSequence - b.chapterSequence;
                  if (a.lessonSequence !== b.lessonSequence) return a.lessonSequence - b.lessonSequence;
                  return a.lesson_id.localeCompare(b.lesson_id);
                })
              );
            }
          }
          const lessonIdsToHydrate = Array.from(
            new Set(
              normalizedBlockRows
                .map((row) => {
                  const metadata =
                    row?.metadata && typeof row.metadata === "object"
                      ? (row.metadata as Record<string, unknown>)
                      : null;
                  const sourceTocId =
                    typeof metadata?.sourceTocId === "string" && isUuid(metadata.sourceTocId)
                      ? metadata.sourceTocId
                      : null;
                  return row?.lesson_id ? String(row.lesson_id) : sourceTocId;
                })
                .filter((value): value is string => Boolean(value))
            )
          );
          const lessonTitleById = new Map<string, string>();
          if (lessonIdsToHydrate.length > 0) {
            const { data: lessonRows, error: lessonsError } = await supabase
              .from("lessons")
              .select("lesson_id, title")
              .in("lesson_id", lessonIdsToHydrate);
            if (lessonsError) {
              console.warn("[calendar] Unable to hydrate lesson titles", lessonsError.message);
            } else {
              for (const lessonRow of lessonRows ?? []) {
                if (!lessonRow?.lesson_id) continue;
                lessonTitleById.set(
                  String(lessonRow.lesson_id),
                  lessonRow?.title ? String(lessonRow.title) : "Untitled Lesson"
                );
              }
            }
          }

          for (const row of normalizedBlockRows) {
            const planId = String(row.lesson_plan_id);
            const current = blocksMap[planId] ?? [];
            const lessonRaw = row?.lesson;
            const lesson = Array.isArray(lessonRaw) ? lessonRaw[0] : lessonRaw;
            const metadata =
              row?.metadata && typeof row.metadata === "object"
                ? (row.metadata as Record<string, unknown>)
                : {};
            const sourceTocId =
              typeof metadata.sourceTocId === "string" && isUuid(metadata.sourceTocId)
                ? metadata.sourceTocId
                : null;
            const blockLessonOrder = Number(metadata.globalLessonOrder ?? metadata.lessonOrder ?? 0);
            const lessonCatalog = lessonCatalogByPlanId.get(planId) ?? [];
            const orderedLessonMatch =
              row?.session_category === "lesson" && blockLessonOrder > 0
                ? (lessonCatalog[blockLessonOrder - 1] ?? null)
                : null;
            const resolvedLessonId = row?.lesson_id
              ? String(row.lesson_id)
              : sourceTocId ?? orderedLessonMatch?.lesson_id ?? null;
            const resolvedLessonTitle =
              lesson?.title
                ? String(lesson.title)
                : resolvedLessonId
                  ? (lessonTitleById.get(resolvedLessonId) ?? orderedLessonMatch?.title ?? null)
                  : null;
            current.push({
              block_id: String(row.block_id),
              lesson_plan_id: planId,
              slot_id: row?.slot_id ? String(row.slot_id) : null,
              root_block_id: row?.root_block_id ? String(row.root_block_id) : null,
              lesson_id: resolvedLessonId,
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
              metadata: {
                ...metadata,
                ...(resolvedLessonId ? { sourceTocId: resolvedLessonId } : {}),
                ...(resolvedLessonTitle ? { lessonTitle: resolvedLessonTitle } : {}),
              },
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

      const canonicalBlocksMap = Object.fromEntries(
        Object.entries(blocksMap).map(([planId, rows]) => [planId, canonicalizeLoadedPlanBlocks(rows)])
      );

      setPlans(mappedPlans);
      setSlotsByPlan(slotsMap);
      setBlocksByPlan(canonicalBlocksMap);
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
                  blocks: canonicalBlocksMap[plan.lesson_plan_id] ?? [],
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
  const suspendablePlansOnSelectedDate = useMemo(
    () =>
      plans.filter((plan) => {
        const planSlots = slotsByPlan[plan.lesson_plan_id] ?? [];
        const planBlocks = blocksByPlan[plan.lesson_plan_id] ?? [];
        const hasSlotOnDate = planSlots.some((slot) => slot.slot_date === selectedDate);
        const hasBlockOnDate = planBlocks.some((block) => {
          if (!block.slot_id) return false;
          return planSlots.some((slot) => slot.slot_id === block.slot_id && slot.slot_date === selectedDate);
        });
        return hasSlotOnDate || hasBlockOnDate;
      }),
    [blocksByPlan, plans, selectedDate, slotsByPlan]
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
  const quizScopeLessonOptions = useMemo(() => {
    if (!selectedPlan) return [] as LessonScopeOption[];

    const targetDate = isIsoDate(entryEditor.startDate) ? entryEditor.startDate : selectedDate;
    const targetTermIndex =
      selectedDateAlgorithmSlots.find((slot) => slot.date === targetDate)?.termIndex ??
      selectedDateAlgorithmSlots.find((slot) => slot.date === selectedDate)?.termIndex ??
      -1;
    if (targetTermIndex < 0) return [];

    return selectedPlanBlocks
      .filter((block) => block.session_category === "lesson" && !Boolean(block.metadata?.manual))
      .filter((block) => Number(block.metadata?.termIndex ?? -1) === targetTermIndex)
      .map((block) => {
        const lessonId =
          (typeof block.metadata?.sourceTocId === "string" && block.metadata.sourceTocId) ||
          block.lesson_id ||
          block.block_id;
        const lessonOrder = Number(block.metadata?.lessonOrder ?? block.metadata?.globalLessonOrder ?? 0);
        const lessonTitle =
          typeof block.metadata?.lessonTitle === "string" && block.metadata.lessonTitle.trim()
            ? block.metadata.lessonTitle.trim()
            : block.title;
        return {
          lessonId,
          lessonOrder,
          termIndex: targetTermIndex,
          label: lessonOrder > 0 ? `L${lessonOrder} - ${lessonTitle}` : lessonTitle,
        };
      })
      .sort((a, b) => a.lessonOrder - b.lessonOrder);
  }, [entryEditor.startDate, selectedDate, selectedDateAlgorithmSlots, selectedPlan, selectedPlanBlocks]);
  const fetchPlanBlockRows = useCallback(async () => {
    if (!selectedPlan) return [] as PlanBlockRow[];
    const { data, error } = await supabase
      .from("blocks")
      .select("block_id, lesson_plan_id, slot_id, root_block_id, algorithm_block_key, block_key, lesson_id, title, description, session_category, session_subcategory, meeting_type, estimated_minutes, min_minutes, max_minutes, required, splittable, overlay_mode, preferred_session_type, dependency_keys, order_no, is_locked, ww_subtype, pt_subtype, metadata")
      .eq("lesson_plan_id", selectedPlan.lesson_plan_id)
      .order("order_no", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      block_id: String(row.block_id),
      lesson_plan_id: String(row.lesson_plan_id),
      slot_id: row?.slot_id ? String(row.slot_id) : null,
      root_block_id: row?.root_block_id ? String(row.root_block_id) : null,
      algorithm_block_key: String(row.algorithm_block_key),
      block_key: String(row.block_key),
      lesson_id: row?.lesson_id ? String(row.lesson_id) : null,
      title: String(row.title),
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
      dependency_keys: Array.isArray(row?.dependency_keys) ? row.dependency_keys.map(String) : [],
      order_no: typeof row?.order_no === "number" ? Number(row.order_no) : null,
      is_locked: typeof row?.is_locked === "boolean" ? Boolean(row.is_locked) : null,
      ww_subtype: row?.ww_subtype ? String(row.ww_subtype) : null,
      pt_subtype: row?.pt_subtype ? String(row.pt_subtype) : null,
      metadata: row?.metadata && typeof row.metadata === "object" ? row.metadata : {},
    })) satisfies PlanBlockRow[];
  }, [selectedPlan]);
  const fetchPlanSlotRows = useCallback(async () => {
    if (!selectedPlan) return [] as PlanSlotRow[];
    const { data, error } = await supabase
      .from("slots")
      .select("slot_id, lesson_plan_id, title, slot_date, weekday, start_time, end_time, meeting_type, room, slot_number, series_key, is_locked")
      .eq("lesson_plan_id", selectedPlan.lesson_plan_id)
      .order("slot_date", { ascending: true })
      .order("start_time", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      slot_id: String(row.slot_id),
      lesson_plan_id: String(row.lesson_plan_id),
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
    })) satisfies PlanSlotRow[];
  }, [selectedPlan]);
  const assertNoOverlappingManualQuizScope = useCallback((input: {
    termIndex: number;
    startLessonId: string | null;
    endLessonId: string | null;
    excludeBlockId?: string | null;
  }) => {
    const startIndex = quizScopeLessonOptions.findIndex((lesson) => lesson.lessonId === input.startLessonId);
    const endIndex = quizScopeLessonOptions.findIndex((lesson) => lesson.lessonId === input.endLessonId);
    if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
      throw new Error("Pick a valid quiz lesson scope.");
    }
    const selectedOrders = new Set(
      quizScopeLessonOptions.slice(startIndex, endIndex + 1).map((lesson) => lesson.lessonOrder)
    );
    const conflictingManualQuiz = selectedPlanBlocks.find((block) => {
      if (block.block_id === input.excludeBlockId || block.root_block_id === input.excludeBlockId) return false;
      if (!Boolean(block.metadata?.manual)) return false;
      if (block.session_category !== "written_work" || block.session_subcategory !== "quiz") return false;
      if (Number(block.metadata?.termIndex ?? -1) !== input.termIndex) return false;
      const coverage = getQuizCoverageFromMetadata(block.metadata);
      if (!coverage) return false;
      return coverage.coveredLessonOrders.some((order) => selectedOrders.has(order));
    });
    if (conflictingManualQuiz) {
      throw new Error("Manual quiz scopes cannot overlap within the same term.");
    }
  }, [quizScopeLessonOptions, selectedPlanBlocks]);
  const reconcileTermQuizScopes = useCallback(async (termIndex: number) => {
    if (!selectedPlan) return;

    const blockRows = await fetchPlanBlockRows();
    const lessonOptions = blockRows
      .filter((block) => block.session_category === "lesson" && !Boolean(block.metadata?.extraCandidateType))
      .filter((block) => Number(block.metadata?.termIndex ?? -1) === termIndex)
      .map((block) => {
        const lessonId =
          (typeof block.metadata?.sourceTocId === "string" && block.metadata.sourceTocId) ||
          block.lesson_id ||
          block.block_id;
        const lessonOrder = Number(block.metadata?.lessonOrder ?? block.metadata?.globalLessonOrder ?? 0);
        const lessonTitle =
          typeof block.metadata?.lessonTitle === "string" && block.metadata.lessonTitle.trim()
            ? block.metadata.lessonTitle.trim()
            : block.title;
        return {
          lessonId,
          lessonOrder,
          label: lessonOrder > 0 ? `L${lessonOrder} - ${lessonTitle}` : lessonTitle,
          termIndex,
        } satisfies LessonScopeOption;
      })
      .sort((a, b) => a.lessonOrder - b.lessonOrder);
    if (lessonOptions.length === 0) return;

    const quizzesInTerm = blockRows
      .filter((block) => block.session_category === "written_work" && block.session_subcategory === "quiz")
      .filter((block) => Number(block.metadata?.termIndex ?? -1) === termIndex);
    const manualQuizzes = quizzesInTerm
      .filter((block) => Boolean(block.metadata?.manual))
      .map((block) => ({
        row: block,
        coverage: getQuizCoverageFromMetadata(block.metadata),
      }))
      .filter((entry): entry is { row: PlanBlockRow; coverage: NonNullable<ReturnType<typeof getQuizCoverageFromMetadata>> } => Boolean(entry.coverage))
      .sort((a, b) => a.coverage.startOrder - b.coverage.startOrder || a.coverage.endOrder - b.coverage.endOrder);

    const manuallyCoveredOrders = new Set<number>();
    for (const quiz of manualQuizzes) {
      for (const order of quiz.coverage.coveredLessonOrders) {
        if (manuallyCoveredOrders.has(order)) {
          throw new Error("Manual quiz scopes cannot overlap within the same term.");
        }
        manuallyCoveredOrders.add(order);
      }
    }

    const uncoveredLessons = lessonOptions.filter((lesson) => !manuallyCoveredOrders.has(lesson.lessonOrder));
    const uncoveredRanges = splitLessonOptionsIntoContiguousRanges(uncoveredLessons);
    const autoQuizRows = quizzesInTerm
      .filter((block) => !Boolean(block.metadata?.manual))
      .sort((a, b) => Number(a.metadata?.quizOrder ?? 0) - Number(b.metadata?.quizOrder ?? 0) || a.block_id.localeCompare(b.block_id));

    const examRows = blockRows
      .filter((block) => block.session_category === "exam")
      .sort((a, b) => Number(a.metadata?.termIndex ?? -1) - Number(b.metadata?.termIndex ?? -1));
    const quizCountByTerm = new Map<number, number>();
    for (const examRow of examRows) {
      quizCountByTerm.set(
        Number(examRow.metadata?.termIndex ?? -1),
        examRow.session_category === "exam"
          ? blockRows.filter(
              (block) =>
                block.session_category === "written_work" &&
                block.session_subcategory === "quiz" &&
                Number(block.metadata?.termIndex ?? -1) === Number(examRow.metadata?.termIndex ?? -1)
            ).length
          : 0
      );
    }
    quizCountByTerm.set(termIndex, manualQuizzes.length + uncoveredRanges.length);
    const globalQuizOffset = Array.from(quizCountByTerm.entries())
      .filter(([currentTermIndex]) => currentTermIndex >= 0 && currentTermIndex < termIndex)
      .sort((a, b) => a[0] - b[0])
      .reduce((sum, [, count]) => sum + count, 0);
    const nonQuizWwCountInTerm = blockRows.filter(
      (block) =>
        block.session_category === "written_work" &&
        block.session_subcategory !== "quiz" &&
        Number(block.metadata?.termIndex ?? -1) === termIndex
    ).length;
    const wwOffset = examRows
      .filter((block) => Number(block.metadata?.termIndex ?? -1) < termIndex)
      .reduce((sum, block) => sum + Number(block.metadata?.termWW ?? 0), 0);

    const autoRowBySegment = uncoveredRanges.map((range, index) => ({
      range,
      row: autoQuizRows[index] ?? null,
    }));
    const extraAutoRows = autoQuizRows.slice(uncoveredRanges.length);
    if (extraAutoRows.length > 0) {
      const { error } = await supabase
        .from("blocks")
        .delete()
        .in("block_id", extraAutoRows.map((row) => row.block_id));
      if (error) throw error;
    }

    const orderedManualAndAuto = [
      ...manualQuizzes.map((quiz) => ({
        row: quiz.row,
        lessons: lessonOptions.filter((lesson) => quiz.coverage.coveredLessonOrders.includes(lesson.lessonOrder)),
        manual: true,
      })),
      ...autoRowBySegment.map((entry) => ({
        row: entry.row,
        lessons: entry.range,
        manual: false,
      })),
    ].sort((a, b) => {
      const aStart = a.lessons[0]?.lessonOrder ?? Number.MAX_SAFE_INTEGER;
      const bStart = b.lessons[0]?.lessonOrder ?? Number.MAX_SAFE_INTEGER;
      if (aStart !== bStart) return aStart - bStart;
      return Number(b.manual) - Number(a.manual);
    });

    const updates: Array<PromiseLike<{ error: any }>> = [];
    const createdRows: any[] = [];
    orderedManualAndAuto.forEach((entry, index) => {
      const globalQuizOrder = globalQuizOffset + index + 1;
      const termQuizOrder = index + 1;
      const globalWwOrder = wwOffset + nonQuizWwCountInTerm + termQuizOrder;
      const nextMetadata = buildQuizCoverageMetadataFromLessons({
        lessons: entry.lessons,
        existingMetadata: entry.row?.metadata ?? {},
        globalQuizOrder,
        termQuizOrder,
        globalWwOrder,
      });
      const nextTitle = getCanonicalAutoBlockTitle({
        category: "written_work",
        subcategory: "quiz",
        metadata: nextMetadata,
        fallbackTitle: `Q${globalQuizOrder}`,
      });

      if (entry.row) {
        updates.push(
          supabase
            .from("blocks")
            .update({
              title: nextTitle,
              metadata: nextMetadata,
            })
            .eq("block_id", entry.row.block_id)
            .eq("lesson_plan_id", selectedPlan.lesson_plan_id)
        );
        return;
      }

      createdRows.push({
        lesson_plan_id: selectedPlan.lesson_plan_id,
        slot_id: null,
        root_block_id: null,
        lesson_id: null,
        algorithm_block_key: `quiz__term_${termIndex}__${makeId()}`,
        block_key: makeId(),
        title: nextTitle,
        description: null,
        session_category: "written_work",
        session_subcategory: "quiz",
        meeting_type: null,
        estimated_minutes: 30,
        min_minutes: null,
        max_minutes: null,
        required: true,
        splittable: false,
        overlay_mode: "major",
        preferred_session_type: "any",
        dependency_keys: [],
        order_no: 1,
        is_locked: false,
        ww_subtype: "quiz",
        pt_subtype: null,
        metadata: {
          ...nextMetadata,
          termIndex,
          termKey:
            typeof examRows.find((row) => Number(row.metadata?.termIndex ?? -1) === termIndex)?.metadata?.termKey === "string"
              ? examRows.find((row) => Number(row.metadata?.termIndex ?? -1) === termIndex)?.metadata?.termKey
              : "final",
        },
      });
    });

    if (createdRows.length > 0) {
      const { error } = await supabase.from("blocks").insert(createdRows);
      if (error) throw error;
    }

    const updateResults = await Promise.all(updates);
    const updateError = updateResults.find((result: any) => result?.error)?.error;
    if (updateError) throw updateError;

    const examRow = examRows.find((row) => Number(row.metadata?.termIndex ?? -1) === termIndex) ?? null;
    if (examRow) {
      const { error } = await supabase
        .from("blocks")
        .update({
          metadata: {
            ...(examRow.metadata ?? {}),
            termQuizAmount: orderedManualAndAuto.length,
          },
        })
        .eq("block_id", examRow.block_id)
        .eq("lesson_plan_id", selectedPlan.lesson_plan_id);
      if (error) throw error;
    }
  }, [fetchPlanBlockRows, selectedPlan]);
  const rescheduleAutoBlocksForTerm = useCallback(async (termIndex: number) => {
    if (!selectedPlan) return;

    const blockRows = await fetchPlanBlockRows();
    const slotRows = await fetchPlanSlotRows();
    const autoBlockRows = blockRows.filter((block) => !Boolean(block.metadata?.manual));
    const manualBlockRows = blockRows.filter((block) => Boolean(block.metadata?.manual));
    const examTemplates = buildExamTemplatesFromBlockRows(autoBlockRows);
    const algorithmSlots = buildCalendarAlgorithmSlots({
      planStartDate: selectedPlan.start_date,
      planEndDate: selectedPlan.end_date,
      lessonPlanId: selectedPlan.lesson_plan_id,
      slots: slotRows,
      blackoutDates: [],
      examBlockTemplates: examTemplates,
    }).filter((slot) => typeof slot.termIndex === "number");

    const termSlots = algorithmSlots.filter((slot) => slot.termIndex === termIndex);
    const termBlocks = mapBlockRowsToAlgorithmBlocks(
      autoBlockRows.filter((block) => Number(block.metadata?.termIndex ?? -1) === termIndex)
    );
    const manualSlotIds = new Set(
      manualBlockRows
        .filter(
          (block) => block.slot_id && Number(block.metadata?.termIndex ?? -1) === termIndex
        )
        .map((block) => String(block.slot_id))
    );
    const placeResult = compressTermUsingCapacity({
      termSlots: termSlots.map((slot) => ({
        ...slot,
        locked: slot.locked || manualSlotIds.has(slot.id),
        lockReason:
          slot.locked || manualSlotIds.has(slot.id)
            ? slot.lockReason ?? "Manual block constraint"
            : slot.lockReason,
      })),
      blocks: termBlocks,
    });
    applyTermRepairResult(termSlots, placeResult);
    normalizeTermPlacements(termSlots, termBlocks);

    const placementByBlockId = new Map(
      termSlots.flatMap((slot) =>
        slot.placements.map((placement, index) => [
          placement.blockId,
          { slotId: slot.id, orderNo: index + 1 },
        ] as const)
      )
    );

    const updateResults = await Promise.all(
      autoBlockRows
        .filter((block) => Number(block.metadata?.termIndex ?? -1) === termIndex)
        .map((row) => {
          const placement = placementByBlockId.get(row.block_id) ?? null;
          return supabase
            .from("blocks")
            .update({
              slot_id: placement?.slotId ?? null,
              order_no:
                placement?.orderNo ??
                (typeof row.order_no === "number" && Number.isFinite(row.order_no) ? row.order_no : 1),
            })
            .eq("block_id", row.block_id)
            .eq("lesson_plan_id", selectedPlan.lesson_plan_id);
        })
    );
    const updateError = updateResults.find((result) => result.error)?.error;
    if (updateError) throw updateError;
  }, [fetchPlanBlockRows, fetchPlanSlotRows, selectedPlan]);
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

    const validation = validatePlan({
      slots: selectedDateAlgorithmSlots,
      blocks: mapBlockRowsToAlgorithmBlocks(
        selectedPlanBlocks.filter((block) => !Boolean(block.metadata?.manual))
      ),
      tocUnits: buildTocUnitsFromBlockRows(
        selectedPlan.lesson_plan_id,
        selectedPlanBlocks.filter((block) => !Boolean(block.metadata?.manual))
      ),
    });
    const diagnosticsByTermIndex = new Map(
      validation.termDiagnostics.map((diagnostic) => [diagnostic.termIndex, diagnostic])
    );

    const dates = new Set<string>();
    for (const [date, dateSlots] of Array.from(slotRowsByDate.entries())) {
      const termIndex =
        algorithmSlotsByDate.get(date)?.find((slot) => typeof slot.termIndex === "number")?.termIndex ?? null;
      if (termIndex === null) continue;

      if (selectedPlanSuspendedSet.has(date)) continue;

      const hasEmptySelectedDateSlot = dateSlots.some((slot) => {
        const slotBlocks = selectedPlanBlocks.filter((block) => block.slot_id === slot.slot_id);
        return isEligibleEmptyPlanSlot(
          slot,
          slotBlocks,
          algorithmSlotsByDate.get(date)?.find((candidate) => candidate.id === slot.slot_id) ?? null
        );
      });
      const hasOverloadedSelectedDateSlot = dateSlots.some((slot) => {
        const slotBlocks = selectedPlanBlocks.filter(
          (block) => block.slot_id === slot.slot_id && !Boolean(block.metadata?.manual)
        );
        const capacity = getSlotCapacityMinutes(slot);
        return capacity > 0 && getPlannedMinutesForSlot(slot.slot_id, slotBlocks) > capacity;
      });
      const hasUnscheduledAutoBlockInTerm = selectedPlanBlocks.some(
        (block) =>
          !Boolean(block.metadata?.manual) &&
          !block.slot_id &&
          Number(block.metadata?.termIndex ?? -1) === termIndex
      );
      const termDiagnostics = diagnosticsByTermIndex.get(termIndex) ?? null;
      const hasTermValidationError = Boolean(termDiagnostics?.hasValidationErrors);

      if (
        !hasEmptySelectedDateSlot &&
        !hasUnscheduledAutoBlockInTerm &&
        !hasOverloadedSelectedDateSlot &&
        !hasTermValidationError
      ) {
        continue;
      }

      dates.add(date);
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
  const displayEntryByKey = useMemo(() => {
    const map = new Map<string, PlanEntry>();
    for (const entry of displayEntries) {
      if (!entry.scheduled_date) continue;
      map.set(`${entry.plan_entry_id}|${entry.scheduled_date}`, entry);
    }
    return map;
  }, [displayEntries]);

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
    const baseEndHour = 21;
    const minuteValues = dailySlots
      .flatMap((slot) => slot.blocks.flatMap((block) => [toMinutesFromSqlTime(block.startTime), toMinutesFromSqlTime(block.endTime)]))
      .filter((value): value is number => typeof value === "number");
    const minMinute = minuteValues.length > 0 ? Math.min(...minuteValues) : baseStartHour * 60;
    const maxMinute = minuteValues.length > 0 ? Math.max(...minuteValues) : baseEndHour * 60;
    const startHour = Math.max(0, Math.min(baseStartHour, Math.floor(minMinute / 60) - 1));
    const endHour = Math.min(23, Math.max(baseEndHour, Math.ceil(maxMinute / 60) + 1));
    const hourHeight = 74;
    const timelineStartMin = startHour * 60;
    const totalHours = Math.max(1, endHour - startHour + 1);
    const hourMarks = Array.from({ length: totalHours + 1 }, (_, i) => startHour + i);
    const rowGap = 8;
    const minRowHeight = 56;
    const placed: DailyPlacedBlock[] = [];
    let maxBottom = totalHours * hourHeight;

    dailySlots.forEach((slot, slotIndex) => {
      const orderedBlocks = [...slot.blocks].sort((a, b) => {
        const rankDiff =
          getDailyBlockOrderRank({
            category: a.category,
            subcategory: a.subcategory,
            orderNo: a.orderNo,
            title: a.title,
          }) -
          getDailyBlockOrderRank({
            category: b.category,
            subcategory: b.subcategory,
            orderNo: b.orderNo,
            title: b.title,
          });
        if (rankDiff !== 0) return rankDiff;
        const orderDiff = Number(a.orderNo ?? 0) - Number(b.orderNo ?? 0);
        if (orderDiff !== 0) return orderDiff;
        return a.title.localeCompare(b.title);
      });

      const fallbackStart = timelineStartMin + slotIndex * 45;
      const slotStartMin =
        toMinutesFromSqlTime(slot.startTime) ??
        toMinutesFromSqlTime(orderedBlocks[0]?.startTime) ??
        fallbackStart;
      const slotEndRaw =
        toMinutesFromSqlTime(slot.endTime) ??
        orderedBlocks
          .map((block) => toMinutesFromSqlTime(block.endTime))
          .filter((value): value is number => typeof value === "number")
          .reduce((latest, value) => Math.max(latest, value), 0);
      const slotEndMin = slotEndRaw && slotEndRaw > slotStartMin ? slotEndRaw : slotStartMin + 50;
      const slotTop = ((slotStartMin - timelineStartMin) / 60) * hourHeight;
      const slotHeight = Math.max(minRowHeight, ((slotEndMin - slotStartMin) / 60) * hourHeight);
      const distributedRowHeight = Math.max(
        minRowHeight,
        Math.floor((slotHeight - rowGap * Math.max(0, orderedBlocks.length - 1)) / Math.max(1, orderedBlocks.length))
      );

      orderedBlocks.forEach((block, blockIndex) => {
        const top = slotTop + blockIndex * (distributedRowHeight + rowGap);
        const height = distributedRowHeight;
        placed.push({ slot, block, top, height, stackIndex: blockIndex });
        maxBottom = Math.max(maxBottom, top + height);
      });
    });

    return {
      startHour,
      hourHeight,
      hourMarks,
      totalHeight: Math.max(totalHours * hourHeight, maxBottom + rowGap),
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

  const createEntrySeedTimes = useMemo(() => {
    const selectedDaySlots = [...selectedPlanSlots]
      .filter((slot) => slot.slot_date === selectedDate)
      .sort(comparePlanSlotRows);
    if (selectedDaySlots.length === 0) {
      return { startTime: "", endTime: "" };
    }

    const openSlot =
      selectedDaySlots.find((slot) => {
        return slotHasRemainingCapacity(
          slot,
          selectedPlanBlocks.filter((block) => block.slot_id === slot.slot_id)
        );
      }) ?? null;
    const slotStart = toHm(openSlot?.start_time);
    const slotEnd = toHm(openSlot?.end_time);
    if (!openSlot || !slotStart || !slotEnd) return { startTime: "", endTime: "" };
    return { startTime: slotStart, endTime: slotEnd };
  }, [selectedDate, selectedPlanBlocks, selectedPlanSlots]);

  const openCreateEditor = useCallback(() => {
    setEntryEditor({
      visible: true,
      mode: "create",
      targetEntryId: null,
      lessonId: null,
      title: "",
      description: "",
      category: "",
      subtype: "",
      customSubtype: "",
      startDate: selectedDate,
      endDate: selectedDate,
      startTime: createEntrySeedTimes.startTime,
      endTime: createEntrySeedTimes.endTime,
      reviewDays: "1",
      quizScopeStartLessonId: null,
      quizScopeEndLessonId: null,
    });
  }, [createEntrySeedTimes.endTime, createEntrySeedTimes.startTime, selectedDate]);

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
    const coveredLessonIds = Array.isArray(entry.metadata?.coveredLessonIds)
      ? entry.metadata.coveredLessonIds.filter((value): value is string => typeof value === "string")
      : [];
    setEntryEditor({
      visible: true,
      mode: "edit",
      targetEntryId: getEditableEntryId(entry),
      lessonId: entry.lesson_id ?? null,
      title: entry.title,
      description: entry.description ?? "",
      category: entry.category,
      subtype,
      customSubtype: "",
      startDate: entry.scheduled_date ?? selectedDate,
      endDate: entry.scheduled_date ?? selectedDate,
      startTime: (entry.start_time ?? "").slice(0, 5),
      endTime: (entry.end_time ?? "").slice(0, 5),
      reviewDays: "1",
      quizScopeStartLessonId: coveredLessonIds[0] ?? null,
      quizScopeEndLessonId: coveredLessonIds.at(-1) ?? null,
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

  const getBlockDeletionWarning = useCallback((targetBlockIds: string[]) => {
    if (!selectedPlan || targetBlockIds.length === 0) return null;

    const targetIdSet = new Set(targetBlockIds);
    const targetBlocks = selectedPlanBlocks.filter((block) => targetIdSet.has(block.block_id));
    if (targetBlocks.length === 0) return null;

    const impactedTermIndexes = new Set(
      targetBlocks
        .map((block) => Number(block.metadata?.termIndex ?? -1))
        .filter((value) => value >= 0)
    );

    for (const termIndex of impactedTermIndexes) {
      const termBlocks = selectedPlanBlocks.filter(
        (block) => Number(block.metadata?.termIndex ?? -1) === termIndex
      );
      const examBlock = termBlocks.find((block) => block.session_category === "exam") ?? null;
      if (!examBlock) continue;

      const remaining = termBlocks.filter((block) => !targetIdSet.has(block.block_id));
      const counts = summarizeBlockRowCounts(remaining);
      const expectedLessons = Number(examBlock.metadata?.termLessons ?? 0);
      const expectedWW = Number(examBlock.metadata?.termWW ?? 0);
      const expectedPT = Number(examBlock.metadata?.termPT ?? 0);
      const expectedExam = 1;

      const violations: string[] = [];
      if (counts.lesson < expectedLessons) violations.push(`lessons ${counts.lesson}/${expectedLessons}`);
      if (counts.writtenWork < expectedWW) violations.push(`written works ${counts.writtenWork}/${expectedWW}`);
      if (counts.performanceTask < expectedPT) violations.push(`performance tasks ${counts.performanceTask}/${expectedPT}`);
      if (counts.exam < expectedExam) violations.push(`exams ${counts.exam}/${expectedExam}`);

      if (violations.length > 0) {
        return `This block is part of the lesson plan requirements. Deleting it would change the term requirements (${violations.join(", ")}).`;
      }
    }

    return null;
  }, [selectedPlan, selectedPlanBlocks]);

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

    if (entryEditor.mode === "create") {
      const createCategory = ["lesson", "written_work", "performance_task", "exam", "buffer"].includes(entryEditor.category)
        ? entryEditor.category
        : "lesson";
      const selectedSubtype = entryEditor.subtype.trim();
      if (!selectedSubtype) {
        Alert.alert("Subcategory required", "Select a subcategory for the block.");
        return;
      }
      const storedSubtype = getStoredSubtypeForCreate(createCategory, selectedSubtype);
      if (!storedSubtype) {
        Alert.alert("Subtype required", "Select a valid subcategory.");
        return;
      }
      const customLabel = entryEditor.customSubtype.trim();
      if (selectedSubtype === "other" && !customLabel) {
        Alert.alert("Custom label required", "Enter a label for the Other subcategory.");
        return;
      }

      const buildManualQuizScopeMetadata = (baseMetadata: Record<string, unknown>) => {
        if (!(createCategory === "written_work" && storedSubtype === "quiz")) {
          return baseMetadata;
        }
        const startLessonId = entryEditor.quizScopeStartLessonId;
        const endLessonId = entryEditor.quizScopeEndLessonId;
        const startIndex = quizScopeLessonOptions.findIndex((lesson) => lesson.lessonId === startLessonId);
        const endIndex = quizScopeLessonOptions.findIndex((lesson) => lesson.lessonId === endLessonId);
        if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
          throw new Error("Pick a valid quiz lesson scope.");
        }
        const coveredLessons = quizScopeLessonOptions.slice(startIndex, endIndex + 1);
        if (coveredLessons.length < 1) {
          throw new Error("Quiz scope must cover at least 1 lesson.");
        }
        return {
          ...baseMetadata,
          coveredLessonIds: coveredLessons.map((lesson) => lesson.lessonId),
          coveredLessonOrders: coveredLessons.map((lesson) => lesson.lessonOrder),
          coveredLessonStartOrder: coveredLessons[0]!.lessonOrder,
          coveredLessonEndOrder: coveredLessons[coveredLessons.length - 1]!.lessonOrder,
          coveredLessonCount: coveredLessons.length,
          afterLessonOrder: coveredLessons[coveredLessons.length - 1]!.lessonOrder,
        };
      };

      try {
        const parsedStart = entryEditor.startTime.trim() ? parseSqlTime(entryEditor.startTime.trim()) : null;
        const parsedEnd = entryEditor.endTime.trim() ? parseSqlTime(entryEditor.endTime.trim()) : null;
        if (!parsedStart || !parsedEnd || parsedEnd <= parsedStart) {
          Alert.alert("Time required", "Choose a valid start and end time for the block.");
          return;
        }

        const selectedDaySlots = [...selectedPlanSlots]
          .filter((slot) => slot.slot_date === selectedDate)
          .sort(comparePlanSlotRows);
        let targetSlot =
          selectedDaySlots.find(
            (slot) =>
              toHm(slot.start_time) === parsedStart.slice(0, 5) &&
              toHm(slot.end_time) === parsedEnd.slice(0, 5)
          ) ?? null;

        if (!targetSlot) {
          const nextSlotNumber =
            selectedDaySlots.reduce((max, slot) => Math.max(max, Number(slot.slot_number ?? 0)), 0) + 1;
          const { data: createdSlot, error: createSlotError } = await supabase
            .from("slots")
            .insert({
              lesson_plan_id: selectedPlan.lesson_plan_id,
              title: "Manual session",
              slot_date: selectedDate,
              weekday: WEEKDAY_LONG[parseDateFromIso(selectedDate).getDay()].toLowerCase(),
              start_time: parsedStart,
              end_time: parsedEnd,
              meeting_type: createCategory === "lesson" ? "lecture" : null,
              room: null,
              slot_number: nextSlotNumber,
              series_key: `manual_slot__${makeId()}`,
              is_locked: true,
            })
            .select("slot_id, lesson_plan_id, title, slot_date, weekday, start_time, end_time, meeting_type, room, slot_number, series_key, is_locked")
            .single();
          if (createSlotError) throw createSlotError;

          targetSlot = {
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
        }

        const slotRowsForOrdering = [...selectedPlanSlots, targetSlot].sort(comparePlanSlotRows);
        const algorithmSlotsForCreate = buildCalendarAlgorithmSlots({
          planStartDate: selectedPlan.start_date,
          planEndDate: selectedPlan.end_date,
          lessonPlanId: selectedPlan.lesson_plan_id,
          slots: slotRowsForOrdering,
          blackoutDates: [],
          examBlockTemplates: buildExamTemplatesFromBlockRows(selectedPlanBlocks.filter((block) => !Boolean(block.metadata?.manual))),
        });
        const algorithmSlot = algorithmSlotsForCreate.find((slot) => slot.id === targetSlot.slot_id) ?? null;
        const termKey =
          algorithmSlot?.termKey === "prelim" || algorithmSlot?.termKey === "midterm" || algorithmSlot?.termKey === "final"
            ? algorithmSlot.termKey
            : "final";
        const algorithmTermIndex = Number(algorithmSlot?.termIndex ?? -1);
        if (createCategory === "written_work" && storedSubtype === "quiz" && algorithmTermIndex >= 0) {
          assertNoOverlappingManualQuizScope({
            termIndex: algorithmTermIndex,
            startLessonId: entryEditor.quizScopeStartLessonId,
            endLessonId: entryEditor.quizScopeEndLessonId,
            excludeBlockId: entryEditor.targetEntryId,
          });
        }

        const slotPositionById = new Map(slotRowsForOrdering.map((slot, index) => [slot.slot_id, index]));
        const targetSlotPosition = slotPositionById.get(targetSlot.slot_id) ?? Number.MAX_SAFE_INTEGER;
        const targetOrderNo =
          selectedPlanBlocks.filter((block) => block.slot_id === targetSlot.slot_id).length + 1;
        const termOffsets = getTermRequirementOffsets(selectedPlanBlocks);
        const seriesBlocks = selectedPlanBlocks
          .filter((block) => isSeriesCategoryMatch(block, createCategory))
          .sort((a, b) => {
            const aSlotPosition = a.slot_id ? (slotPositionById.get(a.slot_id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
            const bSlotPosition = b.slot_id ? (slotPositionById.get(b.slot_id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
            if (aSlotPosition !== bSlotPosition) return aSlotPosition - bSlotPosition;
            return Number(a.order_no ?? 0) - Number(b.order_no ?? 0);
          });
        const insertionIndex = seriesBlocks.findIndex((block) => {
          const blockSlotPosition = block.slot_id
            ? (slotPositionById.get(block.slot_id) ?? Number.MAX_SAFE_INTEGER)
            : Number.MAX_SAFE_INTEGER;
          if (blockSlotPosition > targetSlotPosition) return true;
          if (blockSlotPosition < targetSlotPosition) return false;
          return Number(block.order_no ?? 0) >= targetOrderNo;
        });
        const sequence = insertionIndex >= 0 ? insertionIndex + 1 : seriesBlocks.length + 1;

        if (createCategory !== "exam") {
          const shiftedBlocks = seriesBlocks.slice(sequence - 1);
          const shiftResults = await Promise.all(
            shiftedBlocks.map((block, index) => {
              const nextSequence = sequence + index + 1;
              const nextMetadata = buildRenumberedSeriesMetadata({
                block,
                category: createCategory,
                sequence: nextSequence,
                termOffsets,
              });
              return supabase
                .from("blocks")
                .update({
                  title: getAutomaticCreateCategoryTitle({
                    category: createCategory,
                    sequence: nextSequence,
                    termKey: Number(nextMetadata.termIndex ?? -1) >= 0
                      ? (typeof nextMetadata.termKey === "string" ? nextMetadata.termKey : termKey)
                      : termKey,
                  }),
                  metadata: nextMetadata,
                })
                .eq("block_id", block.block_id)
                .eq("lesson_plan_id", selectedPlan.lesson_plan_id);
            })
          );
          const shiftError = shiftResults.find((result) => result.error)?.error;
          if (shiftError) throw shiftError;
        }

        const defaultGeneratedTitle =
          createCategory === "buffer"
            ? formatEditorChoiceLabel(storedSubtype)
            : getAutomaticCreateCategoryTitle({ category: createCategory, sequence, termKey });
        const createdTitle = selectedSubtype === "other" ? customLabel : defaultGeneratedTitle;

        const createdMetadata =
          createCategory === "exam"
            ? {
                preferredDate: selectedDate,
                manual: true,
                termIndex: Number(algorithmSlot?.termIndex ?? -1),
                termKey,
                resolvedStart: parsedStart,
                resolvedEnd: parsedEnd,
                manualLabel: selectedSubtype === "other" ? customLabel : null,
              }
            : {
                ...buildRenumberedSeriesMetadata({
                  block: { metadata: { termIndex: Number(algorithmSlot?.termIndex ?? -1), termKey }, session_category: createCategory },
                  category: createCategory,
                  sequence,
                  termOffsets,
                }),
                preferredDate: selectedDate,
                manual: true,
                resolvedStart: parsedStart,
                resolvedEnd: parsedEnd,
                manualLabel: selectedSubtype === "other" ? customLabel : null,
              };
        const scopedMetadata = buildManualQuizScopeMetadata(createdMetadata);

        const { error: createError } = await supabase
          .from("blocks")
          .insert({
            lesson_plan_id: selectedPlan.lesson_plan_id,
            slot_id: targetSlot.slot_id,
            root_block_id: null,
            lesson_id: null,
            algorithm_block_key: `manual__${createCategory}__${makeId()}`,
            block_key: makeId(),
            title: createdTitle,
            description: null,
            session_category: createCategory,
            session_subcategory:
              createCategory === "exam"
                ? storedSubtype
                : storedSubtype,
            meeting_type: createCategory === "lesson" ? storedSubtype : null,
            estimated_minutes: Math.max(
              15,
              ((toMinutesFromSqlTime(parsedEnd) ?? 0) - (toMinutesFromSqlTime(parsedStart) ?? 0)) || 60
            ),
            min_minutes: null,
            max_minutes: null,
            required: true,
            splittable: false,
            overlay_mode: "major",
            preferred_session_type: createCategory === "lesson" ? storedSubtype : "any",
            dependency_keys: [],
            order_no: targetOrderNo,
            is_locked: true,
            ww_subtype: createCategory === "written_work" ? storedSubtype : null,
            pt_subtype: createCategory === "performance_task" ? storedSubtype : null,
            metadata: scopedMetadata,
          });
        if (createError) throw createError;

        setEntryEditor((prev) => ({ ...prev, visible: false }));
        await loadCalendarData();
        return;
      } catch (error: any) {
        Alert.alert("Save failed", error?.message ?? "Could not save entry.");
        return;
      }
    }

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
    const buildManualQuizScopeMetadata = (baseMetadata: Record<string, unknown>) => {
      if (!(effectiveCategory === "written_work" && sessionSubcategory === "quiz")) {
        return baseMetadata;
      }
      const startLessonId = entryEditor.quizScopeStartLessonId;
      const endLessonId = entryEditor.quizScopeEndLessonId;
      const startIndex = quizScopeLessonOptions.findIndex((lesson) => lesson.lessonId === startLessonId);
      const endIndex = quizScopeLessonOptions.findIndex((lesson) => lesson.lessonId === endLessonId);
      if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
        throw new Error("Pick a valid quiz lesson scope.");
      }
      const coveredLessons = quizScopeLessonOptions.slice(startIndex, endIndex + 1);
      if (coveredLessons.length < 1) {
        throw new Error("Quiz scope must cover at least 1 lesson.");
      }
      return {
        ...baseMetadata,
        coveredLessonIds: coveredLessons.map((lesson) => lesson.lessonId),
        coveredLessonOrders: coveredLessons.map((lesson) => lesson.lessonOrder),
        coveredLessonStartOrder: coveredLessons[0]!.lessonOrder,
        coveredLessonEndOrder: coveredLessons[coveredLessons.length - 1]!.lessonOrder,
        coveredLessonCount: coveredLessons.length,
        afterLessonOrder: coveredLessons[coveredLessons.length - 1]!.lessonOrder,
      };
    };

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
          overlay_mode: "major",
          preferred_session_type: meetingType ?? "any",
          dependency_keys: [],
          order_no: orderNo,
          is_locked: true,
          ww_subtype: wwSubtype,
          pt_subtype: ptSubtype,
          metadata: buildManualQuizScopeMetadata({
            preferredDate: date,
            manual: true,
            resolvedStart: dayTimes.start,
            resolvedEnd: dayTimes.end,
          }),
        };
      };

      if (!entryEditor.targetEntryId) {
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

      const affectedTermIndex =
        effectiveCategory === "written_work" && sessionSubcategory === "quiz"
          ? (
              quizScopeLessonOptions.find((lesson) => lesson.lessonId === entryEditor.quizScopeStartLessonId)?.termIndex ??
              quizScopeLessonOptions[0]?.termIndex ??
              -1
            )
          : -1;
      if (
        effectiveCategory === "written_work" &&
        sessionSubcategory === "quiz" &&
        affectedTermIndex >= 0
      ) {
        await reconcileTermQuizScopes(affectedTermIndex);
        await rescheduleAutoBlocksForTerm(affectedTermIndex);
      }

      setEntryEditor((prev) => ({ ...prev, visible: false }));
      await cleanupEmptyManualSlots();
      await loadCalendarData();
    } catch (error: any) {
      Alert.alert("Save failed", error?.message ?? "Could not save entry.");
    }
  }, [assertNoOverlappingManualQuizScope, cleanupEmptyManualSlots, entryEditor, loadCalendarData, reconcileTermQuizScopes, resolveEditorTimesForDate, rescheduleAutoBlocksForTerm, selectedDate, selectedPlan, selectedPlanBlackoutSet, selectedPlanBlocks, selectedPlanSlots]);

  const deleteSelectedEntry = useCallback(async () => {
    if (!selectedPlan || !entryEditor.targetEntryId) return;
    const rootId = entryEditor.targetEntryId;
    const rootBlock = selectedPlanBlocks.find((block) => block.block_id === rootId) ?? null;
    const targetBlocks = selectedPlanBlocks
      .filter((block) => block.block_id === rootId || block.root_block_id === rootId)
      .map((block) => block.block_id);
    const warning = getBlockDeletionWarning(targetBlocks);
    if (warning) {
      Alert.alert("Delete warning", warning);
    }
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
      const affectedTermIndex = Number(rootBlock?.metadata?.termIndex ?? -1);
      if (
        rootBlock?.session_category === "written_work" &&
        rootBlock?.session_subcategory === "quiz" &&
        affectedTermIndex >= 0
      ) {
        await reconcileTermQuizScopes(affectedTermIndex);
        await rescheduleAutoBlocksForTerm(affectedTermIndex);
      }
      setEntryEditor((prev) => ({ ...prev, visible: false }));
      await cleanupEmptyManualSlots();
      await loadCalendarData();
    } catch (deleteError: any) {
      Alert.alert("Delete failed", deleteError?.message ?? "Could not delete entry.");
    }
  }, [cleanupEmptyManualSlots, entryEditor.targetEntryId, getBlockDeletionWarning, loadCalendarData, reconcileTermQuizScopes, rescheduleAutoBlocksForTerm, selectedPlan, selectedPlanBlocks]);

  const deleteCalendarEntry = useCallback(async (entry: PlanEntry) => {
    if (!selectedPlan) return;
    const warning = getBlockDeletionWarning([entry.plan_entry_id]);
    if (warning) {
      Alert.alert("Delete warning", warning);
    }

    try {
      const { error } = await supabase
        .from("blocks")
        .delete()
        .eq("lesson_plan_id", selectedPlan.lesson_plan_id)
        .eq("block_id", entry.plan_entry_id);
      if (error) throw error;
      const affectedTermIndex = Number(entry.metadata?.termIndex ?? -1);
      if (entry.category === "written_work" && entry.session_subcategory === "quiz" && affectedTermIndex >= 0) {
        await reconcileTermQuizScopes(affectedTermIndex);
        await rescheduleAutoBlocksForTerm(affectedTermIndex);
      }
      await loadCalendarData();
    } catch (deleteError: any) {
      Alert.alert("Delete failed", deleteError?.message ?? "Could not delete entry.");
    }
  }, [getBlockDeletionWarning, loadCalendarData, reconcileTermQuizScopes, rescheduleAutoBlocksForTerm, selectedPlan]);

  const saveBlockTimeAdjustment = useCallback(async (blockId: string, startMinutes: number, endMinutes: number) => {
    if (!selectedPlan) return;
    const nextStart = minutesToHm(snapMinutesToHalfHour(startMinutes));
    const nextEnd = minutesToHm(Math.max(snapMinutesToHalfHour(endMinutes), snapMinutesToHalfHour(startMinutes) + 30));
    try {
      const targetBlock = selectedPlanBlocks.find((block) => block.block_id === blockId) ?? null;
      if (!targetBlock) return;
      const nextMetadata = {
        ...(targetBlock.metadata ?? {}),
        resolvedStart: nextStart,
        resolvedEnd: nextEnd,
      };
      const estimatedMinutes = Math.max(30, (toMinutesFromSqlTime(nextEnd) ?? 0) - (toMinutesFromSqlTime(nextStart) ?? 0));
      const { error } = await supabase
        .from("blocks")
        .update({
          estimated_minutes: estimatedMinutes,
          metadata: nextMetadata,
        })
        .eq("block_id", blockId)
        .eq("lesson_plan_id", selectedPlan.lesson_plan_id);
      if (error) throw error;
      setDailyTimeEdit(null);
      await loadCalendarData();
    } catch (error: any) {
      Alert.alert("Update failed", error?.message ?? "Could not update block time.");
    }
  }, [loadCalendarData, selectedPlan, selectedPlanBlocks]);

  const applySuspensionRecoveryForPlan = useCallback(async (planId: string, suspendedDate: string) => {
    const plan = plans.find((candidate) => candidate.lesson_plan_id === planId) ?? null;
    if (!plan) return;

    const planSlots = slotsByPlan[planId] ?? [];
    const planBlocks = blocksByPlan[planId] ?? [];
    const autoBlockRows = planBlocks.filter((block) => !Boolean(block.metadata?.manual));
    if (planSlots.length === 0 || planBlocks.length === 0 || autoBlockRows.length === 0) return;

    const tocUnits = buildTocUnitsFromBlockRows(plan.lesson_plan_id, autoBlockRows);
    const teacherRules = buildTeacherRulesFromBlockRows(autoBlockRows);
    const examTemplates = buildExamTemplatesFromBlockRows(autoBlockRows);
    const algorithmSlots = buildCalendarAlgorithmSlots({
      planStartDate: plan.start_date,
      planEndDate: plan.end_date,
      lessonPlanId: plan.lesson_plan_id,
      slots: planSlots,
      blackoutDates: [],
      examBlockTemplates: examTemplates,
    }).filter((slot) => typeof slot.termIndex === "number");
    const affectedTermIndex =
      algorithmSlots.find((slot) => slot.date === suspendedDate && typeof slot.termIndex === "number")?.termIndex ?? null;
    if (affectedTermIndex === null) return;

    const expectedBlocks = buildBlocks({
      courseId: plan.lesson_plan_id,
      tocUnits,
      teacherRules,
      examBlockTemplates: examTemplates,
      slots: algorithmSlots,
      initialDelayDates: [],
    } satisfies BuildBlocksInput);
    const currentAutoBlocks = mapBlockRowsToAlgorithmBlocks(autoBlockRows);
    const currentAutoIdentitySet = new Set(
      currentAutoBlocks
        .map((block) =>
          buildAutoBlockIdentity({
            category: block.type,
            subcategory: block.subcategory,
            sourceTocId: block.sourceTocId ?? null,
            metadata: block.metadata,
            title: block.title,
          })
        )
        .filter((value): value is string => Boolean(value))
    );
    const missingAutoBlocks = expectedBlocks.filter((block) => {
      if (Number(block.metadata.termIndex ?? -1) !== affectedTermIndex) return false;
      const identity = buildAutoBlockIdentity({
        category: block.type,
        subcategory: block.subcategory,
        sourceTocId: block.sourceTocId ?? null,
        metadata: block.metadata,
        title: block.title,
      });
      return Boolean(identity && !currentAutoIdentitySet.has(identity));
    });

    const allBlocks = [...mapBlockRowsToAlgorithmBlocks(planBlocks), ...missingAutoBlocks].map((block) => {
      const isInAffectedTerm = Number(block.metadata.termIndex ?? -1) === affectedTermIndex;
      if (!isInAffectedTerm) return block;
      const isManual = Boolean(planBlocks.find((row) => row.block_id === block.id)?.metadata?.manual);
      return {
        ...block,
        metadata: {
          ...block.metadata,
          ...(isManual ? { manualPlacementPolicy: block.metadata.manualPlacementPolicy ?? "movable" } : {}),
        },
      };
    });

    const placementSeed = buildPlacementSeed(
      planSlots,
      planBlocks.filter((block) => Boolean(block.slot_id))
    );
    const seededSlots = algorithmSlots.map((slot) => ({
      ...slot,
      locked: slot.locked || slot.date === suspendedDate,
      lockReason: slot.date === suspendedDate ? "Suspended day" : slot.lockReason,
      placements: placementSeed[slot.id] ? [...placementSeed[slot.id]!] : [],
    }));
    const termSlots = seededSlots.filter((slot) => slot.termIndex === affectedTermIndex);
    const termBlocks = allBlocks.filter((block) => Number(block.metadata.termIndex ?? -1) === affectedTermIndex);

    const blockRowById = new Map(planBlocks.map((row) => [row.block_id, row]));
    const displacedBlockIds = new Set<string>();
    for (const slot of termSlots) {
      if (slot.date < suspendedDate) continue;
      for (const placement of slot.placements) displacedBlockIds.add(placement.blockId);
      slot.placements = [];
    }

    const updatedTermBlocks = termBlocks.map((block) => {
      const originalRow = blockRowById.get(block.id) ?? null;
      const isDisplaced = displacedBlockIds.has(block.id);
      if (!isDisplaced) return block;
      return {
        ...block,
        metadata: {
          ...block.metadata,
          lastRecoveryReason: "suspension",
          lastRecoveryDate: suspendedDate,
          displacedFromSlotId: originalRow?.slot_id ?? null,
        },
      };
    }).map((block) => {
      if (block.type !== "exam") return block;
      if (Number(block.metadata.termIndex ?? -1) !== affectedTermIndex) return block;
      const suspendedDates = Array.isArray(block.metadata.suspendedDates)
        ? block.metadata.suspendedDates.filter((value): value is string => typeof value === "string")
        : [];
      if (suspendedDates.includes(suspendedDate)) return block;
      const repopulatedDates = Array.isArray(block.metadata.repopulatedDates)
        ? block.metadata.repopulatedDates.filter((value): value is string => typeof value === "string")
        : [];
      return {
        ...block,
        metadata: {
          ...block.metadata,
          rawTermSlots: Math.max(0, Number(block.metadata.rawTermSlots ?? 0) - 1),
          termSlots: Math.max(0, Number(block.metadata.termSlots ?? 0) - 1),
          extraTermSlots: Number(block.metadata.extraTermSlots ?? 0) - 1,
          suspendedDates: [...suspendedDates, suspendedDate],
          repopulatedDates: repopulatedDates.filter((value) => value !== suspendedDate),
        },
      };
    });

    const placementResult = compressTermUsingCapacity({
      termSlots,
      blocks: updatedTermBlocks,
      missingCanonicalBlockIds: missingAutoBlocks.map((block) => block.id),
    });
    applyTermRepairResult(termSlots, placementResult);
    normalizeTermPlacements(termSlots, updatedTermBlocks);
    validateAdjustedTerm(termSlots, updatedTermBlocks);

    const placementByBlockId = new Map(
      seededSlots.flatMap((slot) =>
        slot.placements.map((placement, index) => [
          placement.blockId,
          { slotId: slot.id, orderNo: index + 1 },
        ] as const)
      )
    );
    const updatedMetadataByBlockId = new Map(updatedTermBlocks.map((block) => [block.id, block.metadata]));
    const droppedElasticBlockIdSet = new Set(placementResult.unscheduledBlockIds);

    const suspendedSlotRows = planSlots.filter((slot) => slot.slot_date === suspendedDate);
    if (suspendedSlotRows.length > 0) {
      const suspendedSlotResults = await Promise.all(
        suspendedSlotRows.map((slot) =>
          supabase
            .from("slots")
            .update({ is_locked: true })
            .eq("slot_id", slot.slot_id)
            .eq("lesson_plan_id", plan.lesson_plan_id)
        )
      );
      const suspendedSlotError = suspendedSlotResults.find((result) => result.error)?.error;
      if (suspendedSlotError) throw suspendedSlotError;
    }

    const missingPayload = missingAutoBlocks
      .filter((block) => !droppedElasticBlockIdSet.has(block.id))
      .map((block) => {
      const placement = placementByBlockId.get(block.id) ?? null;
      return {
        lesson_plan_id: plan.lesson_plan_id,
        slot_id: placement?.slotId ?? null,
        root_block_id: null,
        lesson_id: isUuid(block.sourceTocId) ? block.sourceTocId : null,
        algorithm_block_key: block.id,
        block_key: block.id,
        title: getCanonicalAutoBlockTitle({
          category: block.type,
          subcategory: block.subcategory,
          metadata: block.metadata,
          fallbackTitle: block.title,
        }),
        description: null,
        session_category: block.type,
        session_subcategory: block.subcategory,
        meeting_type:
          block.preferredSessionType === "lecture" || block.preferredSessionType === "laboratory"
            ? block.preferredSessionType
            : null,
        estimated_minutes: block.estimatedMinutes,
        min_minutes: block.minMinutes ?? null,
        max_minutes: block.maxMinutes ?? null,
        required: block.required,
        splittable: block.splittable,
        overlay_mode: block.overlayMode,
        preferred_session_type: block.preferredSessionType,
        dependency_keys: block.dependencies,
        order_no: placement?.orderNo ?? 1,
        is_locked: false,
        ww_subtype: block.type === "written_work" ? block.subcategory : null,
        pt_subtype: block.type === "performance_task" ? block.subcategory : null,
        metadata: updatedMetadataByBlockId.get(block.id) ?? block.metadata ?? {},
      };
    });
    if (missingPayload.length > 0) {
      const { error: insertMissingError } = await supabase
        .from("blocks")
        .upsert(missingPayload, { onConflict: "lesson_plan_id,algorithm_block_key" });
      if (insertMissingError) throw insertMissingError;
    }

    if (droppedElasticBlockIdSet.size > 0) {
      const { error: deleteDroppedError } = await supabase
        .from("blocks")
        .delete()
        .eq("lesson_plan_id", plan.lesson_plan_id)
        .in("block_id", Array.from(droppedElasticBlockIdSet));
      if (deleteDroppedError) throw deleteDroppedError;
    }

    const updateResults = await Promise.all(
      planBlocks
        .filter((row) => !droppedElasticBlockIdSet.has(row.block_id))
        .map((row) => {
        const placement = placementByBlockId.get(row.block_id) ?? null;
        const nextMetadata = updatedMetadataByBlockId.get(row.block_id) ?? row.metadata ?? {};
        const fallbackOrderNo =
          typeof row.order_no === "number" && Number.isFinite(row.order_no) ? row.order_no : 1;
        const isManual = Boolean(row.metadata?.manual);
        return supabase
          .from("blocks")
          .update({
            slot_id: placement?.slotId ?? null,
            order_no: placement?.orderNo ?? fallbackOrderNo,
            title: isManual
              ? row.title
              : getCanonicalAutoBlockTitle({
                  category: row.session_category,
                  subcategory: row.session_subcategory,
                  metadata: nextMetadata,
                  fallbackTitle: row.title,
                }),
            metadata: nextMetadata,
          })
          .eq("block_id", row.block_id)
          .eq("lesson_plan_id", plan.lesson_plan_id);
      })
    );
    const updateError = updateResults.find((result) => result.error)?.error;
    if (updateError) throw updateError;
  }, [blocksByPlan, plans, slotsByPlan]);

  const applyRepopulation = useCallback(async () => {
    if (!selectedPlan || repopulateMutating) return;
    setRepopulateMutating(true);
    try {
      if (repopulatableDates.size === 0) {
        Alert.alert("This lessonplan is full");
        return;
      }

      const autoBlockRows = selectedPlanBlocks.filter((block) => !Boolean(block.metadata?.manual));
      if (autoBlockRows.length === 0) return;

      const examTemplates = buildExamTemplatesFromBlockRows(autoBlockRows);
      const tocUnits = buildTocUnitsFromBlockRows(selectedPlan.lesson_plan_id, autoBlockRows);
      const teacherRules = buildTeacherRulesFromBlockRows(autoBlockRows);
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

      const algorithmSlotById = new Map(algorithmSlots.map((slot) => [slot.id, slot]));
      const emptyActiveSlotRows = selectedPlanSlots.filter((slot) => {
        if (selectedPlanSuspendedSet.has(slot.slot_date)) return false;
        const algorithmSlot = algorithmSlotById.get(slot.slot_id);
        if (!algorithmSlot || typeof algorithmSlot.termIndex !== "number") return false;
        const slotBlocks = selectedPlanBlocks.filter((block) => block.slot_id === slot.slot_id);
        return isEligibleEmptyPlanSlot(slot, slotBlocks, algorithmSlot);
      });
      const emptySlotRowsByTerm = new Map<number, PlanSlotRow[]>();
      for (const slot of emptyActiveSlotRows) {
        const termIndex = algorithmSlotById.get(slot.slot_id)?.termIndex;
        if (typeof termIndex !== "number") continue;
        const current = emptySlotRowsByTerm.get(termIndex) ?? [];
        current.push(slot);
        emptySlotRowsByTerm.set(termIndex, current);
      }
      const currentValidation = validatePlan({
        slots: seededSlots,
        blocks: mapBlockRowsToAlgorithmBlocks(autoBlockRows),
        tocUnits,
      });
      const validationTermIndexes = currentValidation.termDiagnostics
        .filter((diagnostic) => diagnostic.hasValidationErrors)
        .map((diagnostic) => diagnostic.termIndex);
      const termIndexesToRepopulate = Array.from(
        new Set([
          ...Array.from(emptySlotRowsByTerm.keys()),
          ...validationTermIndexes,
          ...autoBlockRows
            .filter((block) => !block.slot_id)
            .map((block) => Number(block.metadata?.termIndex ?? -1))
            .filter((value) => value >= 0),
          ...selectedPlanSlots
            .filter((slot) => {
              const slotBlocks = autoBlockRows.filter((block) => block.slot_id === slot.slot_id);
              const capacity = getSlotCapacityMinutes(slot);
              return capacity > 0 && getPlannedMinutesForSlot(slot.slot_id, slotBlocks) > capacity;
            })
            .map((slot) => Number(algorithmSlotById.get(slot.slot_id)?.termIndex ?? -1))
            .filter((value) => value >= 0),
        ])
      ).sort((a, b) => a - b);
      if (termIndexesToRepopulate.length === 0) {
        Alert.alert("This lessonplan is full");
        return;
      }

      const algorithmBlocks = mapBlockRowsToAlgorithmBlocks(autoBlockRows).map((block) => {
        const termIndex = Number(block.metadata.termIndex ?? -1);
        if (block.type !== "exam" || !termIndexesToRepopulate.includes(termIndex)) {
          return block;
        }

        const suspendedDates = Array.isArray(block.metadata.suspendedDates)
          ? block.metadata.suspendedDates.filter((value): value is string => typeof value === "string")
          : [];
        const repopulatedDates = Array.isArray(block.metadata.repopulatedDates)
          ? block.metadata.repopulatedDates.filter((value): value is string => typeof value === "string")
          : [];
        const repopulatedSlotKeys = Array.isArray(block.metadata.repopulatedSlotKeys)
          ? block.metadata.repopulatedSlotKeys.filter((value): value is string => typeof value === "string")
          : [];
        const emptySlotRows = emptySlotRowsByTerm.get(termIndex) ?? [];
        const emptySlotKeys = emptySlotRows.map((slot) =>
          buildGeneratedSlotKey({
            date: slot.slot_date,
            startTime: toHm(slot.start_time),
            endTime: toHm(slot.end_time),
            sessionType: slot.meeting_type ?? slot.room,
            slotNumber: slot.slot_number,
            seriesKey: slot.series_key,
          })
        );
        const newSlotKeys = emptySlotKeys.filter((key) => !repopulatedSlotKeys.includes(key));
        const repopulatedDateSet = new Set(repopulatedDates);
        emptySlotRows.forEach((slot) => repopulatedDateSet.add(slot.slot_date));

        return {
          ...block,
          metadata: {
            ...block.metadata,
            suspendedDates,
            termSlots: Math.max(
              0,
              Number(block.metadata.termSlots ?? 0) + newSlotKeys.length
            ),
            extraTermSlots: Number(block.metadata.extraTermSlots ?? 0) + newSlotKeys.length,
            repopulatedDates: Array.from(repopulatedDateSet).sort(),
            repopulatedSlotKeys: [...repopulatedSlotKeys, ...newSlotKeys],
          },
        };
      });
     const expectedBlocks = buildBlocks({
        courseId: selectedPlan.lesson_plan_id,
        tocUnits,
        teacherRules,
        examBlockTemplates: algorithmBlocks
          .filter((block) => block.type === "exam")
          .map((block) => ({
            id: block.id,
            title: block.title,
            estimatedMinutes: block.estimatedMinutes,
            subcategory: block.subcategory as ExamBlockTemplate["subcategory"],
            preferredDate:
              typeof block.metadata.preferredDate === "string"
                ? block.metadata.preferredDate
                : null,
            required: true,
          })),
        slots: algorithmSlots,
        initialDelayDates: [],
      } satisfies BuildBlocksInput);
      const updatedMetadataByBlockId = new Map(algorithmBlocks.map((block) => [block.id, block.metadata]));
      const missingBlocksToInsert: Block[] = [];
      const droppedElasticBlockIdSet = new Set<string>();

      for (const termIndex of termIndexesToRepopulate) {
        const termSlots = seededSlots.filter((slot) => slot.termIndex === termIndex);
        if (termSlots.length === 0) continue;

        const currentTermBlocks = dedupeCurrentTermBlocks(
          algorithmBlocks.filter((block) => Number(block.metadata.termIndex ?? -1) === termIndex)
        );
        const expectedTermBlocks = expectedBlocks
          .filter((block) => Number(block.metadata.termIndex ?? -1) === termIndex)
          .sort((a, b) => {
            const categoryRank = (candidate: Block) => {
              if (candidate.type === "buffer") return 0;
              if (candidate.type === "lesson") return 1;
              if (candidate.type === "performance_task") return 2;
              if (candidate.type === "written_work" && candidate.subcategory === "quiz") return 3;
              if (candidate.type === "written_work") return 4;
              if (candidate.type === "exam") return 5;
              return 99;
            };
            const rankDiff = categoryRank(a) - categoryRank(b);
            if (rankDiff !== 0) return rankDiff;
            return (
              getCanonicalSequenceValue({
                category: a.type,
                subcategory: a.subcategory,
                metadata: a.metadata,
                title: a.title,
              }) -
              getCanonicalSequenceValue({
                category: b.type,
                subcategory: b.subcategory,
                metadata: b.metadata,
                title: b.title,
              })
            );
          });
        const currentIdentitySet = new Set(
          currentTermBlocks
            .map((block) =>
              buildAutoBlockIdentity({
                category: block.type,
                subcategory: block.subcategory,
                sourceTocId: block.sourceTocId ?? null,
                metadata: block.metadata,
                title: block.title,
              })
            )
            .filter((value): value is string => Boolean(value))
        );
        const missingExpectedTermBlocks = expectedTermBlocks.filter((block) => {
          const identity = buildAutoBlockIdentity({
            category: block.type,
            subcategory: block.subcategory,
            sourceTocId: block.sourceTocId ?? null,
            metadata: block.metadata,
            title: block.title,
          });
          if (!identity) return false;
          return !currentIdentitySet.has(identity);
        });
        const missingRequiredTermBlocks = missingExpectedTermBlocks;
        const manualSlotIds = new Set(
          selectedPlanBlocks
            .filter(
              (block) =>
                Boolean(block.metadata?.manual) &&
                block.slot_id &&
                Number(block.metadata?.termIndex ?? -1) === termIndex
            )
            .map((block) => String(block.slot_id))
        );
        const currentTermDiagnostic = currentValidation.termDiagnostics.find(
          (diagnostic) => diagnostic.termIndex === termIndex
        ) ?? null;
        const shouldRebuildFromScratch = Boolean(
          currentTermDiagnostic?.hasValidationErrors || currentTermDiagnostic?.requiresCompression
        );
        const seededTermSlots = termSlots.map((slot) => ({
          ...slot,
          locked: slot.locked || manualSlotIds.has(slot.id),
          lockReason:
            slot.locked || manualSlotIds.has(slot.id)
              ? slot.lockReason ?? "Manual block constraint"
              : slot.lockReason,
          placements: shouldRebuildFromScratch
            ? []
            : slot.placements.filter((placement) =>
                currentTermBlocks.some((block) => block.id === placement.blockId)
              ),
        }));
        const termBlocks = [...currentTermBlocks, ...missingRequiredTermBlocks];
        const shouldCompress = Boolean(currentTermDiagnostic?.requiresCompression || currentTermDiagnostic?.hasValidationErrors);
        const placeResult = shouldCompress
          ? compressTermUsingCapacity({
              termSlots: seededTermSlots,
              blocks: termBlocks,
              missingCanonicalBlockIds: missingRequiredTermBlocks.map((block) => block.id),
            })
          : repopulateTermIntoEmptySlots({
              termSlots: seededTermSlots,
              blocks: termBlocks,
              missingCanonicalBlockIds: missingRequiredTermBlocks.map((block) => block.id),
            });
        applyTermRepairResult(termSlots, placeResult);
        placeResult.unscheduledBlockIds.forEach((blockId) => droppedElasticBlockIdSet.add(blockId));

        extendTermPlan({
          termSlots,
          blocks: termBlocks,
          unscheduled: new Set(placeResult.unscheduledBlockIds),
        });
        normalizeTermPlacements(termSlots, termBlocks);
        termBlocks.forEach((block) => {
          updatedMetadataByBlockId.set(block.id, block.metadata);
        });
        missingBlocksToInsert.push(...missingRequiredTermBlocks);
      }
      
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
      const uniqueMissingBlocks = missingBlocksToInsert.filter(
        (block, index, list) =>
          !droppedElasticBlockIdSet.has(block.id) &&
          list.findIndex((candidate) => candidate.id === block.id) === index
      );

      if (uniqueMissingBlocks.length > 0) {
        const missingPayload = uniqueMissingBlocks.map((block) => {
          const placement = placementByBlockId.get(block.id) ?? null;
          return {
            lesson_plan_id: selectedPlan.lesson_plan_id,
            slot_id: placement?.slotId ?? null,
            root_block_id: null,
            lesson_id: isUuid(block.sourceTocId) ? block.sourceTocId : null,
            algorithm_block_key: block.id,
            block_key: block.id,
            title: getCanonicalAutoBlockTitle({
              category: block.type,
              subcategory: block.subcategory,
              metadata: block.metadata,
              fallbackTitle: block.title,
            }),
            description: null,
            session_category: block.type,
            session_subcategory: block.subcategory,
            meeting_type:
              block.preferredSessionType === "lecture" || block.preferredSessionType === "laboratory"
                ? block.preferredSessionType
                : null,
            estimated_minutes: block.estimatedMinutes,
            min_minutes: block.minMinutes ?? null,
            max_minutes: block.maxMinutes ?? null,
            required: block.required,
            splittable: block.splittable,
            overlay_mode: block.overlayMode,
            preferred_session_type: block.preferredSessionType,
            dependency_keys: block.dependencies,
            order_no: placement?.orderNo ?? 1,
            is_locked: false,
            ww_subtype: block.type === "written_work" ? block.subcategory : null,
            pt_subtype: block.type === "performance_task" ? block.subcategory : null,
            metadata: block.metadata ?? {},
          };
        });
        const { error: insertMissingError } = await supabase
          .from("blocks")
          .upsert(missingPayload, { onConflict: "lesson_plan_id,algorithm_block_key" });
        if (insertMissingError) throw insertMissingError;
      }

      if (droppedElasticBlockIdSet.size > 0) {
        const { error: deleteDroppedError } = await supabase
          .from("blocks")
          .delete()
          .eq("lesson_plan_id", selectedPlan.lesson_plan_id)
          .in("block_id", Array.from(droppedElasticBlockIdSet));
        if (deleteDroppedError) throw deleteDroppedError;
      }

      const autoUpdateResults = await Promise.all(
        autoBlockRows
          .filter((row) => !droppedElasticBlockIdSet.has(row.block_id))
          .map((row) => {
          const placement = placementByBlockId.get(row.block_id) ?? null;
          const nextMetadata = updatedMetadataByBlockId.get(row.block_id) ?? row.metadata ?? {};
          const fallbackOrderNo = typeof row.order_no === "number" && Number.isFinite(row.order_no) ? row.order_no : 1;
          return supabase
            .from("blocks")
            .update({
              slot_id: placement?.slotId ?? null,
              order_no: placement?.orderNo ?? fallbackOrderNo,
              title: getCanonicalAutoBlockTitle({
                category: row.session_category,
                subcategory: row.session_subcategory,
                metadata: nextMetadata,
                fallbackTitle: row.title,
              }),
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
    } finally {
      setRepopulateMutating(false);
    }
  }, [repopulateMutating, repopulatableDates, selectedPlan, selectedPlanBlocks, selectedPlanSlots, selectedPlanSuspendedSet]);

  const suspendPlansForSelectedDay = useCallback(async (targetPlanIds: string[]) => {
    const targetPlans = targetPlanIds
      .map((planId) => plans.find((plan) => plan.lesson_plan_id === planId) ?? null)
      .filter((plan): plan is LessonPlanOption => Boolean(plan));
    if (targetPlans.length === 0) return;

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error("No signed-in user found.");

    const uniqueTargets = Array.from(
      new Map(
        targetPlans.map((plan) => [
          `${plan.school_id}|${plan.section_id}|${plan.subject_id}`,
          plan,
        ])
      ).values()
    );

    const deleteExistingResults = await Promise.all(
      uniqueTargets.map((plan) =>
        supabase
          .from("school_calendar_events")
          .delete()
          .eq("school_id", plan.school_id)
          .eq("section_id", plan.section_id)
          .eq("subject_id", plan.subject_id)
          .eq("event_type", "suspension")
          .eq("blackout_reason", "suspended")
          .eq("start_date", selectedDate)
          .eq("end_date", selectedDate)
      )
    );
    const deleteExistingError = deleteExistingResults.find((result) => result.error)?.error;
    if (deleteExistingError) throw deleteExistingError;

    const insertResults = await Promise.all(
      uniqueTargets.map((plan) =>
        supabase.from("school_calendar_events").insert({
          school_id: plan.school_id,
          section_id: plan.section_id,
          subject_id: plan.subject_id,
          event_type: "suspension",
          blackout_reason: "suspended",
          title: "Class suspended",
          description: "Suspended from daily calendar.",
          start_date: selectedDate,
          end_date: selectedDate,
          is_whole_day: true,
          created_by: user.id,
        })
      )
    );
    const insertError = insertResults.find((result) => result.error)?.error;
    if (insertError) throw insertError;

    for (const planId of targetPlanIds) {
      await applySuspensionRecoveryForPlan(planId, selectedDate);
    }
  }, [applySuspensionRecoveryForPlan, plans, selectedDate]);

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
        const suspendableIds = suspendablePlansOnSelectedDate.map((plan) => plan.lesson_plan_id);
        if (suspendableIds.length === 0) {
          throw new Error("No plans found on the selected day.");
        }
        if (suspendableIds.length === 1) {
          await suspendPlansForSelectedDay(suspendableIds);
        } else {
          setSuspensionSelectedPlanIds([selectedPlan.lesson_plan_id]);
          setSuspensionPickerVisible(true);
          setSuspendMutating(false);
          return;
        }
      }
      await loadCalendarData();
    } catch (error: any) {
      Alert.alert("Update failed", error?.message ?? "Could not update day suspension.");
    } finally {
      setSuspendMutating(false);
    }
  }, [loadCalendarData, selectedDate, selectedPlan, selectedPlanSuspendedSet, suspendMutating, suspendPlansForSelectedDay, suspendablePlansOnSelectedDate]);

  const confirmSuspendAllPlansForDay = useCallback(async () => {
    if (suspendMutating) return;
    setSuspendMutating(true);
    try {
      await suspendPlansForSelectedDay(
        suspendablePlansOnSelectedDate.map((plan) => plan.lesson_plan_id)
      );
      setSuspensionPickerVisible(false);
      await loadCalendarData();
    } catch (error: any) {
      Alert.alert("Update failed", error?.message ?? "Could not suspend the selected day.");
    } finally {
      setSuspendMutating(false);
    }
  }, [loadCalendarData, suspendMutating, suspendPlansForSelectedDay, suspendablePlansOnSelectedDate]);

  const confirmSuspendSelectedPlansForDay = useCallback(async () => {
    if (suspendMutating) return;
    if (suspensionSelectedPlanIds.length === 0) {
      Alert.alert("Select a plan", "Choose at least one lesson plan to suspend on this day.");
      return;
    }
    setSuspendMutating(true);
    try {
      await suspendPlansForSelectedDay(suspensionSelectedPlanIds);
      setSuspensionPickerVisible(false);
      await loadCalendarData();
    } catch (error: any) {
      Alert.alert("Update failed", error?.message ?? "Could not suspend the selected plans.");
    } finally {
      setSuspendMutating(false);
    }
  }, [loadCalendarData, suspendMutating, suspendPlansForSelectedDay, suspensionSelectedPlanIds]);

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
                      (!canTriggerRepopulation || suspendMutating || repopulateMutating) ? styles.iconOnlyActionBtnDisabled : undefined,
                      pressed ? styles.iconOnlyActionBtnPressed : undefined,
                    ]}
                    onPress={applyRepopulation}
                    disabled={suspendMutating || repopulateMutating}
                    accessibilityLabel="Repopulate plan"
                  >
                    {repopulateMutating ? (
                      <ActivityIndicator size="small" color={c.text} />
                    ) : (
                      <Ionicons name="sparkles-outline" size={18} color={c.text} />
                    )}
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
                  <Text style={[styles.emptyCardText, { color: c.mutedText }]}>Nothing scheduled for today.</Text>
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
                    {dailyTimeline.placed.map(({ slot, block, top, height, stackIndex }) => {
                      const displayEntry = displayEntryByKey.get(`${block.blockId}|${slot.slotDate}`) ?? null;
                      const fallbackEntry: PlanEntry = {
                        plan_entry_id: block.blockId,
                        lesson_plan_id: block.lessonPlanId,
                        title: getDailyDisplayTitleForBlockLike({
                          title: block.title,
                          category: block.category,
                          subcategory: block.subcategory,
                          metadata: block.metadata,
                        }),
                        subtitle: getDisplaySubtitleForBlockLike({
                          title: block.title,
                          category: block.category,
                          subcategory: block.subcategory,
                          metadata: block.metadata,
                        }),
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
                        metadata: block.metadata,
                      };
                      const labelSource = displayEntry ?? fallbackEntry;
                      const dailyLabel = getDailyPrimaryLabel(labelSource);
                      const entry: PlanEntry = {
                        ...fallbackEntry,
                        title: labelSource.title,
                        subtitle: displayEntry?.subtitle ?? null,
                      };
                      const dailySubtitle = getDailyMetaLabel(labelSource);
                      const libraryRoute = getLibraryRouteForEntry(entry, selectedPlan?.subject_id);
                      const swipeKey = `${block.blockId}-${block.scheduledDate}`;
                      const fallbackStartMinutes =
                        toMinutesFromSqlTime(slot.startTime) ??
                        toMinutesFromSqlTime(block.startTime) ??
                        Math.round((top / dailyTimeline.hourHeight) * 60 + (dailyTimeline.startHour * 60));
                      const fallbackEndMinutes = Math.max(
                        (toMinutesFromSqlTime(slot.endTime) ?? 0) > fallbackStartMinutes
                          ? (toMinutesFromSqlTime(slot.endTime) as number)
                          : fallbackStartMinutes + 30,
                        toMinutesFromSqlTime(block.endTime) ?? fallbackStartMinutes + 30
                      );
                      const baseStartMinutes = toMinutesFromSqlTime(block.startTime) ?? fallbackStartMinutes;
                      const baseEndMinutes = toMinutesFromSqlTime(block.endTime) ?? fallbackEndMinutes;
                      const isEditingTime = dailyTimeEdit?.blockId === block.blockId;
                      const activeStartMinutes = isEditingTime ? (dailyTimeEdit?.startMinutes ?? baseStartMinutes) : baseStartMinutes;
                      const activeEndMinutes = isEditingTime ? (dailyTimeEdit?.endMinutes ?? baseEndMinutes) : baseEndMinutes;
                      const adjustedTop = isEditingTime
                        ? ((activeStartMinutes - (dailyTimeline.startHour * 60)) / 60) * dailyTimeline.hourHeight
                        : top;
                      const adjustedHeight = isEditingTime
                        ? Math.max(56, ((activeEndMinutes - activeStartMinutes) / 60) * dailyTimeline.hourHeight)
                        : height;

                      return (
                      <View
                        key={`${block.blockId}-${slot.slotDate}`}
                        style={[
                          styles.timelineBlockRow,
                          {
                            top: adjustedTop,
                            height: adjustedHeight,
                            zIndex: Math.max(1, 20 - stackIndex),
                          },
                        ]}
                      >
                        <DailyBlockSwipeRow
                          key={swipeKey}
                          swipeKey={swipeKey}
                          disabled={isEditingTime}
                          onDelete={() => deleteCalendarEntry(entry)}
                          onRowOpen={(openedKey) => {
                            const openKey = openDailyBlockSwipeKeyRef.current;
                            if (openKey && openKey !== openedKey) {
                              dailyBlockSwipeClosersRef.current[openKey]?.();
                            }
                            openDailyBlockSwipeKeyRef.current = openedKey;
                          }}
                          onRowClose={(closedKey) => {
                            if (openDailyBlockSwipeKeyRef.current === closedKey) {
                              openDailyBlockSwipeKeyRef.current = null;
                            }
                          }}
                          registerCloser={(registeredKey, closer) => {
                            if (closer) {
                              dailyBlockSwipeClosersRef.current[registeredKey] = closer;
                              return;
                            }
                            delete dailyBlockSwipeClosersRef.current[registeredKey];
                          }}
                        >
                          <DailyTimeAdjustableCard
                            active={isEditingTime}
                            startMinutes={activeStartMinutes}
                            endMinutes={activeEndMinutes}
                            hourHeight={dailyTimeline.hourHeight}
                            onActivate={() => {
                              setDailyTimeEdit({
                                blockId: block.blockId,
                                startMinutes: baseStartMinutes,
                                endMinutes: Math.max(baseStartMinutes + 30, baseEndMinutes),
                              });
                            }}
                            onChange={(nextStart, nextEnd) => {
                              const boundedStart = Math.max(dailyTimeline.startHour * 60, snapMinutesToHalfHour(nextStart));
                              const boundedEnd = Math.max(boundedStart + 30, snapMinutesToHalfHour(nextEnd));
                              setDailyTimeEdit({
                                blockId: block.blockId,
                                startMinutes: boundedStart,
                                endMinutes: boundedEnd,
                              });
                            }}
                            onCommit={(nextStart, nextEnd) => {
                              const boundedStart = Math.max(dailyTimeline.startHour * 60, snapMinutesToHalfHour(nextStart));
                              const boundedEnd = Math.max(boundedStart + 30, snapMinutesToHalfHour(nextEnd));
                              saveBlockTimeAdjustment(block.blockId, boundedStart, boundedEnd);
                            }}
                            onPress={() => {
                              if (isEditingTime) {
                                setDailyTimeEdit(null);
                                return;
                              }
                              if (libraryRoute) {
                                router.push(libraryRoute);
                              }
                            }}
                          >
                            <View
                              style={[
                                styles.timelineCard,
                                {
                                  backgroundColor: getDailySlotCardStyle(slot, isDark, cardBg),
                                  borderColor: isEditingTime ? c.tint : c.border,
                                },
                              ]}
                            >
                                <View
                                  style={[
                                    styles.timelineCardAccent,
                                    { backgroundColor: getEntryColor(block.category) },
                                  ]}
                                />
                                <View style={styles.timelineCardMain}>
                                  <View style={styles.timelineCardCenter}>
                                    <Text style={[styles.timelineDailyTitle, { color: c.text }]} numberOfLines={2}>
                                      {dailyLabel}
                                    </Text>
                                    {dailySubtitle ? (
                                      <Text style={[styles.timelineDailySubtitle, { color: c.mutedText }]} numberOfLines={1}>
                                        {dailySubtitle}
                                      </Text>
                                    ) : null}
                                    {libraryRoute && adjustedHeight >= 110 ? (
                                      <Pressable
                                        style={styles.timelineCardLibraryLink}
                                        onPress={() => {
                                          router.push(libraryRoute);
                                        }}
                                      >
                                        <Text style={[styles.timelineCardLibraryText, { color: c.mutedText }]} numberOfLines={1}>
                                          Open details
                                        </Text>
                                      </Pressable>
                                    ) : null}
                                  </View>
                                </View>
                            </View>
                          </DailyTimeAdjustableCard>
                        </DailyBlockSwipeRow>
                      </View>
                      );
                    })}
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

                        return chainStarts.slice(0, 4);
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
                                {getMonthlyPreviewTitle(entry)}
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
          onRequestClose={() => {
            setCreateDropdownOpen(null);
            setEntryEditor((prev) => ({ ...prev, visible: false }));
          }}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              setCreateDropdownOpen(null);
              setEntryEditor((prev) => ({ ...prev, visible: false }));
            }}
          >
            <Pressable style={[styles.planModal, { backgroundColor: cardBg, borderColor: c.border }]} onPress={() => null}>
              <Text style={[styles.modalTitle, { color: c.text }]}>
                {entryEditor.mode === "create" ? "Add block" : "Edit block"}
              </Text>
              {entryEditor.mode === "edit" ? (
                <Text style={[styles.modalSubtitle, { color: c.mutedText }]}>
                  Configure details, subtype, schedule range, and time.
                </Text>
              ) : null}
              {entryEditor.lessonId ? (
                <Text style={[styles.entryPreviewSummary, { color: c.mutedText }]}>
                  This lesson total now comes from its scheduled calendar blocks.
                </Text>
              ) : null}

              {entryEditor.mode === "edit" ? (
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
              ) : null}

              {entryEditor.mode === "create" ? (
                <View style={styles.editorSection}>
                  <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Category</Text>
                  <View style={styles.createDropdownWrap}>
                    <Pressable
                      style={[styles.createDropdownField, { backgroundColor: "#7ED957" }]}
                      onPress={() =>
                        setCreateDropdownOpen((prev) => (prev === "category" ? null : "category"))
                      }
                    >
                      <Text style={styles.createDropdownFieldText}>
                        {entryEditor.category ? formatEditorChoiceLabel(entryEditor.category) : "Select Category"}
                      </Text>
                      <Ionicons
                        name={createDropdownOpen === "category" ? "chevron-up" : "chevron-down"}
                        size={18}
                        color="#FFFFFF"
                        style={styles.createDropdownIcon}
                      />
                    </Pressable>
                    {createDropdownOpen === "category" ? (
                      <View style={[styles.createDropdownMenu, { backgroundColor: cardBg, borderColor: c.border }]}>
                        {["lesson", "written_work", "performance_task", "exam", "buffer"].map((category) => (
                          <Pressable
                            key={category}
                            style={styles.createDropdownItem}
                            onPress={() => {
                              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                              setEntryEditor((prev) => ({
                                ...prev,
                                category,
                                subtype: "",
                                customSubtype: "",
                                startTime: createEntrySeedTimes.startTime,
                                endTime: createEntrySeedTimes.endTime,
                                quizScopeStartLessonId: null,
                                quizScopeEndLessonId: null,
                              }));
                              setCreateDropdownOpen(null);
                            }}
                          >
                            <Text style={[styles.createDropdownItemText, { color: c.text }]}>
                              {formatEditorChoiceLabel(category)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {entryEditor.mode === "edit" ? (
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
              ) : null}

              {entryEditor.mode === "create" && showCreateSubtypeSection ? (
                <Animated.View
                  style={[
                    styles.editorSection,
                    {
                      opacity: createSubtypeReveal,
                      transform: [
                        {
                          translateY: createSubtypeReveal.interpolate({
                            inputRange: [0, 1],
                            outputRange: [12, 0],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Subcategory</Text>
                  <View style={styles.createDropdownWrap}>
                    <Pressable
                      style={[styles.createDropdownField, { backgroundColor: "#FF914D" }]}
                      onPress={() =>
                        setCreateDropdownOpen((prev) => (prev === "subtype" ? null : "subtype"))
                      }
                    >
                      <Text style={styles.createDropdownFieldText}>
                        {entryEditor.subtype ? formatEditorChoiceLabel(entryEditor.subtype) : "Select Subcategory"}
                      </Text>
                      <Ionicons
                        name={createDropdownOpen === "subtype" ? "chevron-up" : "chevron-down"}
                        size={18}
                        color="#FFFFFF"
                        style={styles.createDropdownIcon}
                      />
                    </Pressable>
                    {createDropdownOpen === "subtype" ? (
                      <View style={[styles.createDropdownMenu, { backgroundColor: cardBg, borderColor: c.border }]}>
                        {createModeSubtypesForCategory(entryEditor.category).map((subtype) => (
                          <Pressable
                            key={subtype}
                            style={styles.createDropdownItem}
                            onPress={() => {
                              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                              setEntryEditor((prev) => ({
                                ...prev,
                                subtype,
                                customSubtype: subtype === "other" ? prev.customSubtype : "",
                                quizScopeStartLessonId: subtype === "quiz" ? prev.quizScopeStartLessonId : null,
                                quizScopeEndLessonId: subtype === "quiz" ? prev.quizScopeEndLessonId : null,
                              }));
                              setCreateDropdownOpen(null);
                            }}
                          >
                            <Text style={[styles.createDropdownItemText, { color: c.text }]}>
                              {formatEditorChoiceLabel(subtype)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  {entryEditor.subtype === "other" ? (
                    <TextInput
                      value={entryEditor.customSubtype}
                      onChangeText={(value) => setEntryEditor((prev) => ({ ...prev, customSubtype: value }))}
                      placeholder="Specify label"
                      placeholderTextColor={c.mutedText}
                      style={[styles.createOtherInput, { color: c.text, borderColor: c.border, backgroundColor: subtleBg }]}
                    />
                  ) : null}
                </Animated.View>
              ) : null}

              {entryEditor.mode === "edit" ? (
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
                          customSubtype: "",
                          quizScopeStartLessonId: null,
                          quizScopeEndLessonId: null,
                        }))
                      }
                    >
                      <Text style={[styles.entryCategoryText, { color: c.text }]}>{category.replace("_", " ")}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              ) : null}

              {entryEditor.mode === "edit" && subtypesForCategory(entryEditor.category).length > 0 ? (
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
                        onPress={() =>
                          setEntryEditor((prev) => ({
                            ...prev,
                            subtype,
                            quizScopeStartLessonId: subtype === "quiz" ? prev.quizScopeStartLessonId : null,
                            quizScopeEndLessonId: subtype === "quiz" ? prev.quizScopeEndLessonId : null,
                          }))
                        }
                      >
                        <Text style={[styles.entryCategoryText, { color: c.text }]}>{subtype.replace("_", " ")}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              {(entryEditor.category === "written_work" && entryEditor.subtype === "quiz") ? (
                <View style={styles.editorSection}>
                  <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Quiz lesson scope</Text>
                  <View style={styles.entryTimeRow}>
                    <View style={styles.entryTimeCell}>
                      <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Start lesson</Text>
                      <View style={[styles.entryPickerWrap, { borderColor: c.border, backgroundColor: subtleBg }]}>
                        <Picker
                          selectedValue={entryEditor.quizScopeStartLessonId ?? ""}
                          onValueChange={(value) => setEntryEditor((prev) => ({ ...prev, quizScopeStartLessonId: String(value || "") || null }))}
                          style={[styles.entryPicker, { color: c.text }]}
                          itemStyle={[styles.entryPickerItem, { color: c.text }]}
                          dropdownIconColor={c.text}
                        >
                          <Picker.Item label="Select lesson" value="" />
                          {quizScopeLessonOptions.map((lesson) => (
                            <Picker.Item key={`quiz-scope-start-${lesson.lessonId}`} label={lesson.label} value={lesson.lessonId} />
                          ))}
                        </Picker>
                      </View>
                    </View>
                    <View style={styles.entryTimeCell}>
                      <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>End lesson</Text>
                      <View style={[styles.entryPickerWrap, { borderColor: c.border, backgroundColor: subtleBg }]}>
                        <Picker
                          selectedValue={entryEditor.quizScopeEndLessonId ?? ""}
                          onValueChange={(value) => setEntryEditor((prev) => ({ ...prev, quizScopeEndLessonId: String(value || "") || null }))}
                          style={[styles.entryPicker, { color: c.text }]}
                          itemStyle={[styles.entryPickerItem, { color: c.text }]}
                          dropdownIconColor={c.text}
                        >
                          <Picker.Item label="Select lesson" value="" />
                          {quizScopeLessonOptions.map((lesson) => (
                            <Picker.Item key={`quiz-scope-end-${lesson.lessonId}`} label={lesson.label} value={lesson.lessonId} />
                          ))}
                        </Picker>
                      </View>
                    </View>
                  </View>
                  <Text style={[styles.entryPreviewSummary, { color: c.mutedText }]}>
                    Choose 1 or more contiguous lessons in the same term.
                  </Text>
                </View>
              ) : null}

              {entryEditor.mode === "edit" ? (
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
              ) : null}

              {entryEditor.mode === "create" ? (
                showCreateTimeSection ? (
                  <Animated.View
                    style={[
                      styles.editorSection,
                      {
                        opacity: createTimeReveal,
                        transform: [
                          {
                            translateY: createTimeReveal.interpolate({
                              inputRange: [0, 1],
                              outputRange: [12, 0],
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    <View style={styles.entryTimeRow}>
                      <View style={styles.entryTimeCell}>
                        <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Start Time</Text>
                        <View style={styles.createDropdownWrap}>
                          <Pressable
                            style={[styles.createDropdownField, styles.createTimeField, { backgroundColor: "#B3B3B6" }]}
                            onPress={() =>
                              setCreateDropdownOpen((prev) => (prev === "startTime" ? null : "startTime"))
                            }
                          >
                            <Text style={styles.createDropdownFieldText}>
                              {entryEditor.startTime || "--:--"}
                            </Text>
                            <Ionicons
                              name={createDropdownOpen === "startTime" ? "chevron-up" : "chevron-down"}
                              size={18}
                              color="#FFFFFF"
                              style={styles.createDropdownIcon}
                            />
                          </Pressable>
                          {createDropdownOpen === "startTime" ? (
                            <ScrollView style={[styles.createDropdownMenu, styles.createTimeDropdownMenu, { backgroundColor: cardBg, borderColor: c.border }]}>
                              <Pressable
                                style={styles.createDropdownItem}
                                onPress={() => {
                                  setEntryEditor((prev) => ({ ...prev, startTime: "" }));
                                  setCreateDropdownOpen(null);
                                }}
                              >
                                <Text style={[styles.createDropdownItemText, { color: c.text }]}>--:--</Text>
                              </Pressable>
                              {timePickerOptions.map((time) => (
                                <Pressable
                                  key={`start-time-${time}`}
                                  style={styles.createDropdownItem}
                                  onPress={() => {
                                    setEntryEditor((prev) => ({ ...prev, startTime: time }));
                                    setCreateDropdownOpen(null);
                                  }}
                                >
                                  <Text style={[styles.createDropdownItemText, { color: c.text }]}>{time}</Text>
                                </Pressable>
                              ))}
                            </ScrollView>
                          ) : null}
                        </View>
                      </View>
                      <View style={styles.entryTimeCell}>
                        <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>End Time</Text>
                        <View style={styles.createDropdownWrap}>
                          <Pressable
                            style={[styles.createDropdownField, styles.createTimeField, { backgroundColor: "#B3B3B6" }]}
                            onPress={() =>
                              setCreateDropdownOpen((prev) => (prev === "endTime" ? null : "endTime"))
                            }
                          >
                            <Text style={styles.createDropdownFieldText}>
                              {entryEditor.endTime || "--:--"}
                            </Text>
                            <Ionicons
                              name={createDropdownOpen === "endTime" ? "chevron-up" : "chevron-down"}
                              size={18}
                              color="#FFFFFF"
                              style={styles.createDropdownIcon}
                            />
                          </Pressable>
                          {createDropdownOpen === "endTime" ? (
                            <ScrollView style={[styles.createDropdownMenu, styles.createTimeDropdownMenu, { backgroundColor: cardBg, borderColor: c.border }]}>
                              <Pressable
                                style={styles.createDropdownItem}
                                onPress={() => {
                                  setEntryEditor((prev) => ({ ...prev, endTime: "" }));
                                  setCreateDropdownOpen(null);
                                }}
                              >
                                <Text style={[styles.createDropdownItemText, { color: c.text }]}>--:--</Text>
                              </Pressable>
                              {timePickerOptions.map((time) => (
                                <Pressable
                                  key={`end-time-${time}`}
                                  style={styles.createDropdownItem}
                                  onPress={() => {
                                    setEntryEditor((prev) => ({ ...prev, endTime: time }));
                                    setCreateDropdownOpen(null);
                                  }}
                                >
                                  <Text style={[styles.createDropdownItemText, { color: c.text }]}>{time}</Text>
                                </Pressable>
                              ))}
                            </ScrollView>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  </Animated.View>
                ) : null
              ) : (
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
              )}

              {entryEditor.mode === "edit" && (entryEditor.category === "performance_task" || entryEditor.category === "exam") ? (
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

        <Modal
          transparent
          visible={suspensionPickerVisible}
          animationType="fade"
          onRequestClose={() => setSuspensionPickerVisible(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setSuspensionPickerVisible(false)}>
            <Pressable style={[styles.planModal, { backgroundColor: cardBg, borderColor: c.border }]} onPress={() => {}}>
              <Text style={[styles.modalTitle, { color: c.text }]}>Suspend this day</Text>
              <Text style={[styles.suspensionModalText, { color: c.mutedText }]}>
                Choose whether to suspend all plans on {selectedDate} or only selected plans.
              </Text>
              <View style={styles.suspensionActionRow}>
                <Pressable
                  style={[styles.editorBtn, { borderColor: c.border, backgroundColor: cardBg }]}
                  onPress={() => setSuspensionPickerVisible(false)}
                >
                  <Text style={[styles.editorBtnText, { color: c.text }]}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.editorBtn, styles.editorBtnPrimary]} onPress={confirmSuspendAllPlansForDay}>
                  <Text style={styles.editorBtnPrimaryText}>All Plans</Text>
                </Pressable>
              </View>
              <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Selected plans only</Text>
              <ScrollView style={styles.planList}>
                {suspendablePlansOnSelectedDate.map((plan) => {
                  const isSelected = suspensionSelectedPlanIds.includes(plan.lesson_plan_id);
                  return (
                    <Pressable
                      key={`suspend-${plan.lesson_plan_id}`}
                      style={[
                        styles.planRow,
                        styles.suspensionPlanRow,
                        {
                          backgroundColor: isSelected ? (isDark ? "#1A2B22" : "#E8F9EE") : "transparent",
                          borderColor: c.border,
                        },
                      ]}
                      onPress={() =>
                        setSuspensionSelectedPlanIds((prev) =>
                          prev.includes(plan.lesson_plan_id)
                            ? prev.filter((value) => value !== plan.lesson_plan_id)
                            : [...prev, plan.lesson_plan_id]
                        )
                      }
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.planRowTitle, { color: c.text }]} numberOfLines={1}>
                          {plan.title}
                        </Text>
                        <Text style={[styles.planRowSub, { color: c.mutedText }]} numberOfLines={1}>
                          {[plan.subject_code, plan.subject_title, plan.section_name].filter(Boolean).join(" - ") || "Section"}
                        </Text>
                      </View>
                      <Ionicons
                        name={isSelected ? "checkbox" : "square-outline"}
                        size={22}
                        color={isSelected ? c.tint : c.mutedText}
                      />
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Pressable style={[styles.editorBtn, styles.editorBtnPrimary]} onPress={confirmSuspendSelectedPlansForDay}>
                <Text style={styles.editorBtnPrimaryText}>Suspend Selected Plans</Text>
              </Pressable>
            </Pressable>
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
  timelineBlockRow: {
    position: "absolute",
    left: 34,
    right: 4,
    flexDirection: "column",
    gap: 8,
  },
  timelineCard: {
    flex: 1,
    height: "100%",
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
    justifyContent: "center",
  },
  timelineCardCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 6,
  },
  timelineDailyTitle: {
    ...Typography.body,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  timelineDailySubtitle: {
    ...Typography.caption,
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center",
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
  timelineTimeCentered: {
    marginTop: 0,
    textAlign: "center",
  },
  timelineCardLibraryLink: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  timelineCardLibraryText: {
    ...Typography.caption,
    fontSize: 10,
    fontWeight: "600",
  },
  dailyBlockSwipe: {
    width: "100%",
    flex: 1,
    borderRadius: DAILY_BLOCK_RADIUS,
    overflow: "hidden",
  },
  dailyBlockSwipeContent: {
    flex: 1,
    height: "100%",
    position: "relative",
    zIndex: 1,
  },
  dailyBlockSwipeGestureSurface: {
    flex: 1,
    height: "100%",
  },
  dailyTimeAdjustWrap: {
    flex: 1,
    height: "100%",
  },
  dailyTimePressable: {
    flex: 1,
    height: "100%",
  },
  dailyTimeDragSurface: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
  },
  dailyTimeResizeHandleTop: {
    position: "absolute",
    left: 12,
    right: 12,
    top: -6,
    height: 14,
    borderRadius: 999,
    backgroundColor: "#0EA5E9",
    zIndex: 4,
    opacity: 0.85,
  },
  dailyTimeResizeHandleBottom: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: -6,
    height: 14,
    borderRadius: 999,
    backgroundColor: "#0EA5E9",
    zIndex: 4,
    opacity: 0.85,
  },
  dailyBlockChip: {
    borderWidth: 1,
    borderRadius: DAILY_BLOCK_RADIUS,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  dailyBlockChipRail: {
    width: 112,
    paddingTop: 10,
    paddingBottom: 10,
    paddingRight: 10,
    justifyContent: "flex-start",
  },
  dailyBlockLibraryChip: {
    minHeight: 34,
    minWidth: 62,
    justifyContent: "center",
  },
  dailyBlockDeleteAction: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 92,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#C94B4B",
    paddingHorizontal: 12,
    borderTopRightRadius: DAILY_BLOCK_RADIUS,
    borderBottomRightRadius: DAILY_BLOCK_RADIUS,
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
  suspensionModalText: {
    ...Typography.body,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  suspensionActionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  suspensionPlanRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
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
    height: Platform.OS === "ios" ? 68 : 44,
    justifyContent: "center",
  },
  entryPicker: {
    width: "100%",
    height: Platform.OS === "ios" ? 140 : 44,
    marginVertical: Platform.OS === "ios" ? -36 : 0,
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
  createStageLabel: {
    ...Typography.body,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 12,
  },
  createStageStack: {
    gap: 12,
  },
  createStageChoice: {
    minHeight: 94,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  createStageChoiceText: {
    ...Typography.h2,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "800",
    textAlign: "center",
  },
  createOtherInput: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Typography.body,
    fontSize: 14,
    fontWeight: "500",
  },
  createDropdownWrap: {
    position: "relative",
    zIndex: 20,
  },
  createDropdownField: {
    minHeight: 94,
    borderRadius: 32,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  createTimeField: {
    minHeight: 92,
    borderRadius: 28,
  },
  createDropdownFieldText: {
    ...Typography.h2,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
  },
  createDropdownIcon: {
    position: "absolute",
    right: 18,
    top: "50%",
    marginTop: -9,
  },
  createDropdownMenu: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
  },
  createTimeDropdownMenu: {
    maxHeight: 220,
  },
  createDropdownItem: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.16)",
  },
  createDropdownItemText: {
    ...Typography.body,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  createCompactPickerWrap: {
    minHeight: 44,
    height: 44,
  },
  createCompactPicker: {
    height: 44,
    marginVertical: 0,
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
