import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { PinchGestureHandler, State as GestureState } from "react-native-gesture-handler";
import { Radius, Spacing, Typography } from "../../../constants/fonts";
import { useAppTheme } from "../../../context/theme";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import { supabase } from "../../../lib/supabase";
import { generateSchedulePlan, type SchedulerDiagnostics } from "../../../algorithms/lessonPlanScheduler";

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
  instance_no?: number | null;
  lesson_id?: string | null;
  lesson_chapter_id?: string | null;
  lesson_estimated_minutes?: number | null;
  is_locked?: boolean | null;
  ww_subtype?: string | null;
  pt_subtype?: string | null;
  original_plan_entry_id?: string | null;
  source_plan_entry_id?: string | null;
};

type DailyTimelineEntry = PlanEntry & {
  plan_title: string;
  plan_section: string;
  plan_subject: string;
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

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const CATEGORY_STYLE: Record<string, { color: string; chipLabel: string }> = {
  lesson: { color: "#7FB6A1", chipLabel: "L" },
  review: { color: "#67B8C7", chipLabel: "RV" },
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
    review: 3,
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

function entryMeetingTypeKey(entry: PlanEntry) {
  return entry.meeting_type ?? `${entry.start_time ?? ""}|${entry.end_time ?? ""}`;
}

function entryChainKey(entry: PlanEntry) {
  return `${normalizedEntryTitle(entry.title)}|${entryMeetingTypeKey(entry)}`;
}

function getEditableEntryId(entry: PlanEntry) {
  if (isUuid(entry.source_plan_entry_id)) return entry.source_plan_entry_id ?? null;
  if (isUuid(entry.original_plan_entry_id)) return entry.original_plan_entry_id ?? null;
  if (entry.entry_type === "planned_item" && isUuid(entry.plan_entry_id)) return entry.plan_entry_id;
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
  return "";
}

function subtypesForCategory(category: string) {
  if (category === "lesson") return ["lecture", "laboratory"];
  if (category === "written_work") return ["assignment", "seatwork", "quiz"];
  if (category === "performance_task") return ["activity", "lab_report", "reporting", "project"];
  if (category === "exam") return ["prelim", "midterm", "final"];
  return [];
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

function dateDiffDays(startIso: string, endIso: string) {
  const start = parseDateFromIso(startIso).getTime();
  const end = parseDateFromIso(endIso).getTime();
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function normalizeWeekday(day: string | null | undefined): string | null {
  if (!day) return null;
  const key = day.trim().toLowerCase();
  if (WEEKDAY_INDEX[key] !== undefined) return key;
  if (key.startsWith("mon")) return "monday";
  if (key.startsWith("tue")) return "tuesday";
  if (key.startsWith("wed")) return "wednesday";
  if (key.startsWith("thu")) return "thursday";
  if (key.startsWith("fri")) return "friday";
  if (key.startsWith("sat")) return "saturday";
  if (key.startsWith("sun")) return "sunday";
  return null;
}

export default function CalendarScreen() {
  const { colors: c, scheme } = useAppTheme();
  const isDark = scheme === "dark";
  if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }

  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<LessonPlanOption[]>([]);
  const [entriesByPlan, setEntriesByPlan] = useState<Record<string, PlanEntry[]>>({});
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

      let entriesMap: Record<string, PlanEntry[]> = {};

      if (mappedPlans.length > 0) {
        const lessonPlanIds = mappedPlans.map((plan) => plan.lesson_plan_id);
        const { data: entryRows, error: entryError } = await supabase
          .from("plan_entries")
          .select(
            "plan_entry_id, lesson_plan_id, lesson_id, title, category, description, scheduled_date, start_time, end_time, meeting_type, session_category, session_subcategory, entry_type, day, room, instance_no, is_locked, ww_subtype, pt_subtype, original_plan_entry_id, lesson:lessons(chapter_id, estimated_minutes)"
          )
          .in("lesson_plan_id", lessonPlanIds)
          .order("scheduled_date", { ascending: true });
        if (entryError) throw entryError;

        for (const row of entryRows ?? []) {
          const planId = String(row.lesson_plan_id);
          const lessonRaw = row?.lesson;
          const lesson = Array.isArray(lessonRaw) ? lessonRaw[0] : lessonRaw;
          const current = entriesMap[planId] ?? [];
          current.push({
            plan_entry_id: String(row.plan_entry_id),
            lesson_plan_id: planId,
            title: String(row.title ?? "Untitled"),
            category: String(row.category ?? "planned_item"),
            description: row?.description ? String(row.description) : null,
            scheduled_date: row?.scheduled_date ? String(row.scheduled_date) : null,
            start_time: row?.start_time ? String(row.start_time) : null,
            end_time: row?.end_time ? String(row.end_time) : null,
            meeting_type: row?.meeting_type ? String(row.meeting_type) : null,
            session_category: row?.session_category ? String(row.session_category) : null,
            session_subcategory: row?.session_subcategory ? String(row.session_subcategory) : null,
            entry_type: row?.entry_type ? String(row.entry_type) : null,
            day: row?.day ? String(row.day) : null,
            room: row?.room ? String(row.room) : null,
            instance_no: typeof row?.instance_no === "number" ? Number(row.instance_no) : null,
            lesson_id: row?.lesson_id ? String(row.lesson_id) : null,
            lesson_chapter_id: lesson?.chapter_id ? String(lesson.chapter_id) : null,
            lesson_estimated_minutes:
              typeof lesson?.estimated_minutes === "number" ? Number(lesson.estimated_minutes) : null,
            is_locked: typeof row?.is_locked === "boolean" ? Boolean(row.is_locked) : null,
            ww_subtype: row?.ww_subtype ? String(row.ww_subtype) : null,
            pt_subtype: row?.pt_subtype ? String(row.pt_subtype) : null,
            original_plan_entry_id: row?.original_plan_entry_id ? String(row.original_plan_entry_id) : null,
          });
          entriesMap[planId] = current;
        }

        for (const planId of Object.keys(entriesMap)) {
          entriesMap[planId] = [...entriesMap[planId]].sort(entrySort);
        }
      }

      const blackoutMap: Record<string, string[]> = {};
      const suspendedMap: Record<string, string[]> = {};
      if (mappedPlans.length > 0) {
        const schoolIds = Array.from(new Set(mappedPlans.map((p) => p.school_id)));
        const minStart = mappedPlans.reduce((acc, p) => (p.start_date < acc ? p.start_date : acc), mappedPlans[0].start_date);
        const maxEnd = mappedPlans.reduce((acc, p) => (p.end_date > acc ? p.end_date : acc), mappedPlans[0].end_date);

        const [{ data: eventRows, error: eventError }, { data: absenceRows, error: absenceError }] = await Promise.all([
          supabase
            .from("school_calendar_events")
            .select("event_id, school_id, section_id, subject_id, event_type, blackout_reason, start_date, end_date")
            .in("school_id", schoolIds)
            .in("blackout_reason", ["event", "exam_week", "holiday", "suspended", "other"])
            .lte("start_date", maxEnd)
            .gte("end_date", minStart),
          supabase
            .from("teacher_absences")
            .select("absence_id, school_id, section_id, subject_id, absent_on, blackout_reason")
            .eq("user_id", user.id)
            .in("school_id", schoolIds)
            .gte("absent_on", minStart)
            .lte("absent_on", maxEnd),
        ]);
        if (eventError) throw eventError;
        if (absenceError) throw absenceError;

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

          for (const row of absenceRows ?? []) {
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
      setEntriesByPlan(entriesMap);
      setBlackoutsByPlan(blackoutMap);
      setSuspendedByPlan(suspendedMap);

      const defaultPlan =
        mappedPlans.find((plan) => plan.start_date <= today && plan.end_date >= today) ?? mappedPlans[0] ?? null;
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
      setEntriesByPlan({});
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

  const { refreshing, onRefresh } = usePullToRefresh(loadCalendarData);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.lesson_plan_id === selectedPlanId) ?? null,
    [plans, selectedPlanId]
  );

  const selectedPlanEntries = useMemo(
    () => (selectedPlanId ? entriesByPlan[selectedPlanId] ?? [] : []),
    [entriesByPlan, selectedPlanId]
  );
  const recurringMeetingTemplates = useMemo(
    () =>
      selectedPlanEntries
        .filter((entry) => entry.entry_type === "recurring_class" && entry.day)
        .map((entry) => ({
          day: normalizeWeekday(entry.day) ?? "",
          meeting_type: entry.meeting_type ?? null,
          start_time: entry.start_time ?? null,
          end_time: entry.end_time ?? null,
        }))
        .filter((entry) => Boolean(entry.day)),
    [selectedPlanEntries]
  );
  const selectedPlanBlackoutSet = useMemo(
    () => new Set(selectedPlanId ? blackoutsByPlan[selectedPlanId] ?? [] : []),
    [blackoutsByPlan, selectedPlanId]
  );
  const selectedPlanSuspendedSet = useMemo(
    () => new Set(selectedPlanId ? suspendedByPlan[selectedPlanId] ?? [] : []),
    [selectedPlanId, suspendedByPlan]
  );

  const scheduleResult = useMemo(() => {
    if (!selectedPlan) {
      return {
        entries: selectedPlanEntries,
        diagnostics: {
          feasible: true,
          hardViolations: 0,
          softViolations: 0,
          constraints: [],
        } satisfies SchedulerDiagnostics,
      };
    }

    return generateSchedulePlan({
      lessonPlanId: selectedPlan.lesson_plan_id,
      startDate: selectedPlan.start_date,
      endDate: selectedPlan.end_date,
      entries: selectedPlanEntries,
      blackoutDates: blackoutsByPlan[selectedPlan.lesson_plan_id] ?? [],
    });
  }, [selectedPlan, selectedPlanEntries, blackoutsByPlan]);

  const displayEntries = scheduleResult.entries;

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
    if (selectedDate < selectedPlan.start_date) {
      setSelectedDate(selectedPlan.start_date);
      setCurrentMonthDate(startOfMonth(selectedPlan.start_date));
      return;
    }
    if (selectedDate > selectedPlan.end_date) {
      setSelectedDate(selectedPlan.end_date);
      setCurrentMonthDate(startOfMonth(selectedPlan.end_date));
    }
  }, [selectedPlan, selectedDate]);

  const allPlansDailyEntries = useMemo<DailyTimelineEntry[]>(() => {
    const rows: DailyTimelineEntry[] = [];
    for (const plan of plans) {
      const planEntries = entriesByPlan[plan.lesson_plan_id] ?? [];
      const scheduled = generateSchedulePlan({
        lessonPlanId: plan.lesson_plan_id,
        startDate: plan.start_date,
        endDate: plan.end_date,
        entries: planEntries,
        blackoutDates: blackoutsByPlan[plan.lesson_plan_id] ?? [],
      }).entries;
      for (const entry of scheduled) {
        if (entry.scheduled_date !== selectedDate) continue;
        rows.push({
          ...entry,
          plan_title: plan.title,
          plan_section: plan.section_name,
          plan_subject: [plan.subject_code, plan.subject_title].filter(Boolean).join(" - "),
        });
      }
    }
    return rows.sort((a, b) => {
      const at = a.start_time ?? "99:99:99";
      const bt = b.start_time ?? "99:99:99";
      if (at !== bt) return at.localeCompare(bt);
      return a.title.localeCompare(b.title);
    });
  }, [blackoutsByPlan, entriesByPlan, plans, selectedDate]);

  const dailyTimeline = useMemo(() => {
    const baseStartHour = 7;
    const baseEndHour = 15;
    const minuteValues = allPlansDailyEntries
      .flatMap((entry) => [toMinutesFromSqlTime(entry.start_time), toMinutesFromSqlTime(entry.end_time)])
      .filter((value): value is number => typeof value === "number");
    const minMinute = minuteValues.length > 0 ? Math.min(...minuteValues) : baseStartHour * 60;
    const maxMinute = minuteValues.length > 0 ? Math.max(...minuteValues) : baseEndHour * 60;
    const startHour = Math.max(0, Math.min(baseStartHour, Math.floor(minMinute / 60) - 1));
    const endHour = Math.min(23, Math.max(baseEndHour, Math.ceil(maxMinute / 60) + 1));
    const hourHeight = 74;
    const timelineStartMin = startHour * 60;
    const totalHours = Math.max(1, endHour - startHour + 1);
    const hourMarks = Array.from({ length: totalHours + 1 }, (_, i) => startHour + i);
    const placed = allPlansDailyEntries.map((entry, idx) => {
      const fallbackStart = timelineStartMin + idx * 45;
      const startMin = toMinutesFromSqlTime(entry.start_time) ?? fallbackStart;
      const endMinRaw = toMinutesFromSqlTime(entry.end_time);
      const endMin = endMinRaw && endMinRaw > startMin ? endMinRaw : startMin + 50;
      const top = ((startMin - timelineStartMin) / 60) * hourHeight;
      const height = Math.max(56, ((endMin - startMin) / 60) * hourHeight);
      return { entry, top, height };
    });
    return {
      startHour,
      hourHeight,
      hourMarks,
      totalHeight: totalHours * hourHeight,
      placed,
    };
  }, [allPlansDailyEntries]);

  const dailyEntries = allPlansDailyEntries;
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
      review: 3,
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
            : entry.category === "lesson"
              ? (entry.meeting_type ?? "lecture")
              : "");
    setEntryEditor({
      visible: true,
      mode: "edit",
      targetEntryId: getEditableEntryId(entry),
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

    const wwSubtype = entryEditor.category === "written_work" ? selectedSubtype : null;
    const ptSubtype = entryEditor.category === "performance_task" ? selectedSubtype : null;
    const meetingType = entryEditor.category === "lesson" ? selectedSubtype : null;
    const sessionCategory = ["lesson", "written_work", "performance_task", "exam"].includes(entryEditor.category)
      ? entryEditor.category
      : null;
    const sessionSubcategory = allowedSubtypes.length > 0 ? selectedSubtype : null;
    const rangeDates: string[] = [];
    for (let cursor = startDate; cursor <= endDate; cursor = addDays(cursor, 1)) {
      rangeDates.push(cursor);
    }
    if (rangeDates.length === 0) return;
    const selectedMeetingType = entryEditor.category === "lesson" ? selectedSubtype : null;

    try {
      if (entryEditor.mode === "create") {
        const basePayload = rangeDates.map((date) => {
          const dayTimes = resolveEditorTimesForDate(date, selectedMeetingType, startTime, endTime);
          return {
            lesson_plan_id: selectedPlan.lesson_plan_id,
            entry_type: date === startDate ? "planned_item" : "moved_item",
            category: entryEditor.category,
            scheduled_date: date,
            title,
            description: entryEditor.description.trim() || null,
            start_time: dayTimes.start,
            end_time: dayTimes.end,
            meeting_type: meetingType,
            session_category: sessionCategory,
            session_subcategory: sessionSubcategory,
            is_locked: true,
            ww_subtype: wwSubtype,
            pt_subtype: ptSubtype,
          };
        });
        const { error: createError } = await supabase.from("plan_entries").insert(basePayload);
        if (createError) throw createError;

        if (entryEditor.category === "performance_task" || entryEditor.category === "exam") {
          const reviewDays = Math.max(0, Math.min(10, Number(entryEditor.reviewDays) || 0));
          if (reviewDays > 0) {
            const reviewRows: any[] = [];
            let cursor = addDays(endDate, -1);
            while (reviewRows.length < reviewDays && cursor >= selectedPlan.start_date) {
              if (!selectedPlanBlackoutSet.has(cursor)) {
                reviewRows.push({
                  lesson_plan_id: selectedPlan.lesson_plan_id,
                  entry_type: "planned_item",
                  category: "review",
                  scheduled_date: cursor,
                  title: `Review: ${title}`,
                  description: `${entryEditor.category === "exam" ? "Exam" : "Performance task"} preparation`,
                  is_locked: true,
                });
              }
              cursor = addDays(cursor, -1);
            }
            if (reviewRows.length > 0) {
              const { error: reviewError } = await supabase.from("plan_entries").insert(reviewRows);
              if (reviewError) throw reviewError;
            }
          }
        }
      } else if (entryEditor.targetEntryId) {
        const rootId = entryEditor.targetEntryId;
        const { error: deleteMovedError } = await supabase
          .from("plan_entries")
          .delete()
          .eq("lesson_plan_id", selectedPlan.lesson_plan_id)
          .eq("entry_type", "moved_item")
          .eq("original_plan_entry_id", rootId);
        if (deleteMovedError) throw deleteMovedError;

        const { error: updateError } = await supabase
          .from("plan_entries")
          .update({
            title,
            category: entryEditor.category,
            description: entryEditor.description.trim() || null,
            start_time: resolveEditorTimesForDate(startDate, selectedMeetingType, startTime, endTime).start,
            end_time: resolveEditorTimesForDate(startDate, selectedMeetingType, startTime, endTime).end,
            scheduled_date: startDate,
            meeting_type: meetingType,
            session_category: sessionCategory,
            session_subcategory: sessionSubcategory,
            is_locked: true,
            ww_subtype: wwSubtype,
            pt_subtype: ptSubtype,
          })
          .eq("plan_entry_id", rootId)
          .eq("lesson_plan_id", selectedPlan.lesson_plan_id);
        if (updateError) throw updateError;

        const movedRows = rangeDates.slice(1).map((date) => {
          const dayTimes = resolveEditorTimesForDate(date, selectedMeetingType, startTime, endTime);
          return {
            lesson_plan_id: selectedPlan.lesson_plan_id,
            entry_type: "moved_item",
            category: entryEditor.category,
            scheduled_date: date,
            title,
            description: entryEditor.description.trim() || null,
            start_time: dayTimes.start,
            end_time: dayTimes.end,
            meeting_type: meetingType,
            session_category: sessionCategory,
            session_subcategory: sessionSubcategory,
            is_locked: true,
            ww_subtype: wwSubtype,
            pt_subtype: ptSubtype,
            original_plan_entry_id: rootId,
          };
        });
        if (movedRows.length > 0) {
          const { error: movedInsertError } = await supabase.from("plan_entries").insert(movedRows);
          if (movedInsertError) throw movedInsertError;
        }
      }

      setEntryEditor((prev) => ({ ...prev, visible: false }));
      await loadCalendarData();
    } catch (error: any) {
      Alert.alert("Save failed", error?.message ?? "Could not save entry.");
    }
  }, [entryEditor, loadCalendarData, resolveEditorTimesForDate, selectedPlan, selectedPlanBlackoutSet]);

  const deleteSelectedEntry = useCallback(async () => {
    if (!selectedPlan || !entryEditor.targetEntryId) return;
    try {
      const { error } = await supabase
        .from("plan_entries")
        .delete()
        .eq("plan_entry_id", entryEditor.targetEntryId)
        .eq("lesson_plan_id", selectedPlan.lesson_plan_id);
      if (error) throw error;
      setEntryEditor((prev) => ({ ...prev, visible: false }));
      await loadCalendarData();
    } catch (deleteError: any) {
      Alert.alert("Delete failed", deleteError?.message ?? "Could not delete entry.");
    }
  }, [entryEditor.targetEntryId, loadCalendarData, selectedPlan]);

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
      }
      await loadCalendarData();
    } catch (error: any) {
      Alert.alert("Update failed", error?.message ?? "Could not update day suspension.");
    } finally {
      setSuspendMutating(false);
    }
  }, [loadCalendarData, selectedDate, selectedPlan, selectedPlanSuspendedSet, suspendMutating]);

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

  if (!selectedPlan) {
    return (
      <View style={[styles.center, { backgroundColor: screenBg }]}> 
        <Text style={[styles.emptyText, { color: c.mutedText }]}>No lesson plans yet.</Text>
      </View>
    );
  }

  return (
      <View style={[styles.page, { backgroundColor: screenBg }]}> 
        <PinchGestureHandler onHandlerStateChange={handlePinchStateChange}>
          <View style={styles.page}>
            <ScrollView
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
          <View style={styles.topBar}>
            <Pressable onPress={() => setZoomLevel((prev) => (prev === "daily" ? "monthly" : "daily"))}>
              <Text style={[styles.modeLabel, { color: c.mutedText }]}> 
                {zoomLevel === "daily" ? "Daily" : "Monthly"}
              </Text>
              <Text style={[styles.dateTitle, { color: c.text }]}> 
                {zoomLevel === "daily" ? longDateTitle(selectedDate) : monthTitle(currentMonthDate)}
              </Text>
            </Pressable>

            {zoomLevel === "monthly" ? (
              <Pressable
                style={[styles.planPill, { backgroundColor: cardBg, borderColor: c.border }]}
                onPress={() => setPlanMenuOpen(true)}
              >
                <Ionicons name="chevron-down" size={16} color={c.text} />
                <View style={styles.planPillTextWrap}>
                  <Text style={[styles.planCode, { color: c.text }]} numberOfLines={1}>
                    {selectedPlan.title}
                  </Text>
                  <Text style={[styles.planSubtitle, { color: c.mutedText }]} numberOfLines={1}>
                    {[selectedPlan.subject_code, selectedPlan.subject_title, selectedPlan.section_name].filter(Boolean).join(" - ") || "Lesson plan"}
                  </Text>
                </View>
              </Pressable>
            ) : null}
          </View>

          {zoomLevel === "monthly" && (scheduleResult.diagnostics.hardViolations > 0 || scheduleResult.diagnostics.softViolations > 0) ? (
            <View
              style={[
                styles.diagnosticCard,
                {
                  backgroundColor: scheduleResult.diagnostics.hardViolations > 0
                    ? isDark
                      ? "#3A1D1D"
                      : "#FFEDEE"
                    : isDark
                      ? "#1F2C3A"
                      : "#EEF7FF",
                  borderColor: c.border,
                },
              ]}
            >
              <Text style={[styles.diagnosticTitle, { color: c.text }]}>
                {scheduleResult.diagnostics.feasible ? "Schedule warnings" : "Schedule conflict detected"}
              </Text>
              {scheduleResult.diagnostics.constraints
                .filter((d) => !d.passed)
                .slice(0, 3)
                .map((d) => (
                  <Text key={d.code} style={[styles.diagnosticLine, { color: c.text }]}>
                    [{d.tier.toUpperCase()}] {d.message}
                  </Text>
                ))}
            </View>
          ) : null}

          {zoomLevel === "daily" ? (
            <View>
              <View style={styles.dailyActionsRow}>
                <Pressable
                  style={[styles.dailyActionBtn, { borderColor: c.border, backgroundColor: cardBg }]}
                  onPress={openCreateEditor}
                >
                  <Ionicons name="add" size={16} color={c.text} />
                  <Text style={[styles.dailyActionText, { color: c.text }]}>Add instance</Text>
                </Pressable>
                <Pressable
                  style={[styles.dailyActionBtn, { borderColor: c.border, backgroundColor: cardBg }]}
                  onPress={toggleSuspendSelectedDay}
                  disabled={suspendMutating}
                >
                  <Ionicons
                    name={selectedPlanSuspendedSet.has(selectedDate) ? "play-circle-outline" : "pause-circle-outline"}
                    size={16}
                    color={c.text}
                  />
                  <Text style={[styles.dailyActionText, { color: c.text }]}>
                    {selectedPlanSuspendedSet.has(selectedDate) ? "Unsuspend day" : "Suspend day"}
                  </Text>
                </Pressable>
              </View>

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

              {dailyEntries.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor: c.border }]}> 
                  <Text style={[styles.emptyCardText, { color: c.mutedText }]}>No instances scheduled across all plans on this day.</Text>
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
                    {dailyTimeline.placed.map(({ entry, top, height }) => (
                      <Pressable
                        key={`${entry.plan_entry_id}-${entry.scheduled_date ?? selectedDate}`}
                        style={[
                          styles.timelineCard,
                          {
                            top,
                            minHeight: height,
                            backgroundColor: cardBg,
                            borderColor: c.border,
                          },
                        ]}
                        onPress={() => {
                          setSelectedPlanId(entry.lesson_plan_id);
                          openEditEditor(entry);
                        }}
                      >
                        <View style={[styles.timelineCardAccent, { backgroundColor: getEntryColor(entry.category) }]} />
                        <View style={styles.timelineCardMain}>
                          <Text style={[styles.timelineTitle, { color: c.text }]} numberOfLines={1}>
                            {entry.plan_subject || entry.title}
                          </Text>
                          <Text style={[styles.timelineSub, { color: c.text }]} numberOfLines={1}>
                            {entry.plan_section || entry.plan_title}
                          </Text>
                          <Text style={[styles.timelineTime, { color: c.mutedText }]}>
                            {(entry.start_time ?? "").slice(0, 5) || "--:--"} - {(entry.end_time ?? "").slice(0, 5) || "--:--"}
                          </Text>
                        </View>
                        <View style={styles.timelineChipRow}>
                          <View
                            style={[
                              styles.timelineChip,
                              {
                                borderColor: getEntryColor(entry.category),
                                backgroundColor: subtleBg,
                              },
                            ]}
                          >
                            <Text style={[styles.timelineChipText, { color: c.text }]}>{getChipLabel(entry)}</Text>
                          </View>
                          {entry.session_subcategory ? (
                            <View style={[styles.timelineChip, { borderColor: c.border, backgroundColor: subtleBg }]}>
                              <Text style={[styles.timelineChipText, { color: c.mutedText }]}>
                                {entry.session_subcategory.replace("_", " ").toUpperCase()}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      </Pressable>
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
                                {entry.description || getChipLabel(entry)}
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
                {entryEditor.mode === "create" ? "Add instance" : "Edit instance"}
              </Text>
              <Text style={[styles.modalSubtitle, { color: c.mutedText }]}>
                Configure details, subtype, schedule range, and time.
              </Text>

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
                  {["lesson", "review", "written_work", "performance_task", "exam"].map((category) => (
                    <Pressable
                      key={category}
                      style={[
                        styles.entryCategoryChip,
                        {
                          borderColor: entryEditor.category === category ? c.tint : c.border,
                          backgroundColor: entryEditor.category === category ? `${c.tint}22` : "transparent",
                        },
                      ]}
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
  modeLabel: {
    ...Typography.body,
    fontSize: 14,
  },
  dateTitle: {
    ...Typography.h1,
    fontSize: 34,
    lineHeight: 38,
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
