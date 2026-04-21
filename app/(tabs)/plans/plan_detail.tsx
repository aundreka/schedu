import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Radius, Spacing, Typography } from "../../../constants/fonts";
import { useAppTheme } from "../../../context/theme";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import { supabase } from "../../../lib/supabase";

type PlanDetail = {
  lesson_plan_id: string;
  title: string;
  academic_year: string | null;
  term: string;
  start_date: string;
  end_date: string;
  status: string;
  notes: string | null;
  school_name: string;
  subject_code: string;
  subject_title: string;
  subject_year: string | null;
  section_name: string;
  section_grade_level: string | null;
};

type PlanEntryItem = {
  plan_entry_id: string;
  day: string | null;
  start_time: string | null;
  end_time: string | null;
  meeting_type: string | null;
  room: string | null;
  instance_no: number | null;
};

type PlanDraft = {
  title: string;
  academic_year: string;
  term: string;
  start_date: string;
  end_date: string;
  notes: string;
};

const DAY_LABEL: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

const DAY_ORDER: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

const TERM_OPTIONS = ["quarter", "trimester", "semester"] as const;
const DAY_OPTIONS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function makeId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toTitleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function formatIsoDate(value: string | null) {
  if (!value) return "-";
  const [year, month, day] = value.split("-").map((n) => Number(n));
  if (!year || !month || !day) return value;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(value: string | null) {
  if (!value) return "";
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw ?? "0");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const meridiem = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function toTimeInput(value: string | null) {
  if (!value) return "";
  return value.slice(0, 5);
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

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map((n) => Number(n));
  if (!year || !month || !day) return false;
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() + 1 === month &&
    parsed.getDate() === day
  );
}

function toPlanDraft(plan: PlanDetail): PlanDraft {
  return {
    title: plan.title,
    academic_year: plan.academic_year ?? "",
    term: plan.term,
    start_date: plan.start_date,
    end_date: plan.end_date,
    notes: plan.notes ?? "",
  };
}

function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const next = new Date(year, (month ?? 1) - 1, day ?? 1);
  next.setDate(next.getDate() + days);
  const yyyy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildSlotDatesForDay(startDate: string, endDate: string, weekday: string) {
  const dates: string[] = [];
  for (let cursor = startDate; cursor <= endDate; cursor = addDays(cursor, 1)) {
    const date = new Date(`${cursor}T00:00:00`);
    const label = DAY_OPTIONS[(date.getDay() + 6) % 7];
    if (label === weekday) dates.push(cursor);
  }
  return dates;
}

function makeDraftSchedule(): PlanEntryItem {
  const key = `draft_${makeId()}`;
  return {
    plan_entry_id: key,
    day: "monday",
    start_time: "08:00:00",
    end_time: "10:00:00",
    meeting_type: "lecture",
    room: "lecture",
    instance_no: null,
  };
}

function withInstanceNumbers(entries: PlanEntryItem[]) {
  const daySlotCounts = new Map<string, number>();
  return entries.map((entry) => {
    const dayKey = entry.day ?? "";
    const nextSlotNumber = (daySlotCounts.get(dayKey) ?? 0) + 1;
    daySlotCounts.set(dayKey, nextSlotNumber);
    return { ...entry, instance_no: nextSlotNumber };
  });
}

function mapPlanDetail(row: any): PlanDetail | null {
  const subjectRaw = row?.subject;
  const subject = Array.isArray(subjectRaw) ? subjectRaw[0] : subjectRaw;
  const sectionRaw = row?.section;
  const section = Array.isArray(sectionRaw) ? sectionRaw[0] : sectionRaw;
  const schoolRaw = row?.school;
  const school = Array.isArray(schoolRaw) ? schoolRaw[0] : schoolRaw;

  const lessonPlanId = String(row?.lesson_plan_id ?? "");
  const title = String(row?.title ?? "");
  const term = String(row?.term ?? "");
  const startDate = String(row?.start_date ?? "");
  const endDate = String(row?.end_date ?? "");
  const status = String(row?.status ?? "");

  if (!lessonPlanId || !title || !term || !startDate || !endDate || !status) return null;

  return {
    lesson_plan_id: lessonPlanId,
    title,
    academic_year: row?.academic_year ? String(row.academic_year) : null,
    term,
    start_date: startDate,
    end_date: endDate,
    status,
    notes: row?.notes ? String(row.notes) : null,
    school_name: String(school?.name ?? "Unknown institution"),
    subject_code: String(subject?.code ?? ""),
    subject_title: String(subject?.title ?? "Unknown subject"),
    subject_year: subject?.year ? String(subject.year) : null,
    section_name: String(section?.name ?? "Unknown section"),
    section_grade_level: section?.grade_level ? String(section.grade_level) : null,
  };
}

function mapPlanEntry(row: any): PlanEntryItem | null {
  const planEntryId = String(row?.series_key ?? "");
  const meetingType = row?.meeting_type ? String(row.meeting_type) : row?.room ? String(row.room) : null;

  if (!planEntryId) return null;

  return {
    plan_entry_id: planEntryId,
    day: row?.weekday ? String(row.weekday) : null,
    start_time: row?.start_time ? String(row.start_time) : null,
    end_time: row?.end_time ? String(row.end_time) : null,
    meeting_type: meetingType,
    room: row?.room ? String(row.room) : null,
    instance_no: typeof row?.slot_number === "number" ? Number(row.slot_number) : null,
  };
}

export default function PlanDetailScreen() {
  const { lessonPlanId } = useLocalSearchParams<{ lessonPlanId?: string | string[] }>();
  const planId = useMemo(
    () => (Array.isArray(lessonPlanId) ? lessonPlanId[0] : lessonPlanId) ?? "",
    [lessonPlanId]
  );

  const { colors: c } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [entries, setEntries] = useState<PlanEntryItem[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [draftEntries, setDraftEntries] = useState<PlanEntryItem[]>([]);

  const loadPlanDetail = useCallback(async () => {
    if (!planId) {
      setPlan(null);
      setEntries([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("No signed-in user found.");

      const { data: planRow, error: planError } = await supabase
        .from("lesson_plans")
        .select(
          "lesson_plan_id, title, academic_year, term, start_date, end_date, status, notes, school:schools(name), subject:subjects(code, title, year), section:sections(name, grade_level)"
        )
        .eq("lesson_plan_id", planId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (planError) throw planError;

      const mappedPlan = mapPlanDetail(planRow);
      setPlan(mappedPlan);
      if (!isEditing) {
        setDraft(mappedPlan ? toPlanDraft(mappedPlan) : null);
      }

      if (!mappedPlan) {
        setEntries([]);
        return;
      }

      const { data: entryRows, error: entriesError } = await supabase
        .from("slots")
        .select(
          "slot_id, title, weekday, slot_date, start_time, end_time, meeting_type, room, slot_number, series_key"
        )
        .eq("lesson_plan_id", mappedPlan.lesson_plan_id)
        .order("slot_date", { ascending: true })
        .order("start_time", { ascending: true });
      if (entriesError) throw entriesError;

      const seenSeriesKeys = new Set<string>();
      const mappedEntries = (entryRows ?? [])
        .filter((row: any) => {
          const seriesKey = String(row?.series_key ?? "");
          if (!seriesKey || seenSeriesKeys.has(seriesKey)) return false;
          seenSeriesKeys.add(seriesKey);
          return true;
        })
        .map(mapPlanEntry)
        .filter((item: PlanEntryItem | null): item is PlanEntryItem => Boolean(item));

      const numberedEntries = withInstanceNumbers(mappedEntries);
      setEntries(numberedEntries);
      if (!isEditing) {
        setDraftEntries(numberedEntries.map((entry) => ({ ...entry })));
      }
    } catch {
      setPlan(null);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [isEditing, planId]);

  useEffect(() => {
    loadPlanDetail();
  }, [loadPlanDetail]);

  const { refreshing, onRefresh } = usePullToRefresh(loadPlanDetail);

  const handleEdit = useCallback(() => {
    if (!plan) return;
    setDraft(toPlanDraft(plan));
    setDraftEntries(withInstanceNumbers(entries.map((entry) => ({ ...entry }))));
    setIsEditing(true);
  }, [entries, plan]);

  const handleDuplicate = useCallback(() => {
    if (!plan) return;
    router.push({
      pathname: "/(tabs)/create/lessonplan",
      params: { duplicateFromPlanId: plan.lesson_plan_id },
    });
  }, [plan]);

  const handleCancelEdit = useCallback(() => {
    if (plan) setDraft(toPlanDraft(plan));
    setDraftEntries(withInstanceNumbers(entries.map((entry) => ({ ...entry }))));
    setIsEditing(false);
  }, [entries, plan]);

  const setEntryField = useCallback(
    <K extends keyof PlanEntryItem>(planEntryId: string, key: K, value: PlanEntryItem[K]) => {
      setDraftEntries((prev) =>
        withInstanceNumbers(
          prev.map((entry) => (entry.plan_entry_id === planEntryId ? { ...entry, [key]: value } : entry))
        )
      );
    },
    []
  );

  const addDraftSchedule = useCallback((day: (typeof DAY_OPTIONS)[number] = "monday") => {
    setDraftEntries((prev) => withInstanceNumbers([...prev, { ...makeDraftSchedule(), day }]));
  }, []);

  const duplicateDraftSchedule = useCallback((planEntryId: string) => {
    setDraftEntries((prev) => {
      const index = prev.findIndex((entry) => entry.plan_entry_id === planEntryId);
      if (index === -1) return prev;
      const source = prev[index];
      const next = [...prev];
      next.splice(index + 1, 0, {
        ...source,
        plan_entry_id: `draft_${makeId()}`,
        instance_no: null,
      });
      return withInstanceNumbers(next);
    });
  }, []);

  const removeDraftSchedule = useCallback((planEntryId: string) => {
    setDraftEntries((prev) => withInstanceNumbers(prev.filter((entry) => entry.plan_entry_id !== planEntryId)));
  }, []);

  const toggleDraftDay = useCallback((day: (typeof DAY_OPTIONS)[number]) => {
    setDraftEntries((prev) => {
      const hasDay = prev.some((entry) => entry.day === day);
      if (hasDay) {
        return withInstanceNumbers(prev.filter((entry) => entry.day !== day));
      }
      return withInstanceNumbers([...prev, { ...makeDraftSchedule(), day }]);
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!plan || !draft) return;

    const title = draft.title.trim();
    const term = draft.term.trim().toLowerCase();
    const startDate = draft.start_date.trim();
    const endDate = draft.end_date.trim();
    const academicYear = draft.academic_year.trim();
    const notes = draft.notes.trim();

    if (!title) {
      Alert.alert("Title required", "Enter a lesson plan title.");
      return;
    }
    if (!TERM_OPTIONS.includes(term as (typeof TERM_OPTIONS)[number])) {
      Alert.alert("Invalid term", "Select Quarter, Trimester, or Semester.");
      return;
    }
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      Alert.alert("Invalid dates", "Use YYYY-MM-DD for start and end dates.");
      return;
    }
    if (endDate < startDate) {
      Alert.alert("Invalid range", "End date must be on or after start date.");
      return;
    }

    const normalizedEntries: PlanEntryItem[] = [];
    for (const entry of draftEntries) {
      const day = entry.day?.trim().toLowerCase() ?? "";
      const room = entry.room?.trim() ?? "";
      const startTimeRaw = entry.start_time?.trim() ?? "";
      const endTimeRaw = entry.end_time?.trim() ?? "";
      const startTime = startTimeRaw ? parseSqlTime(startTimeRaw) : null;
      const endTime = endTimeRaw ? parseSqlTime(endTimeRaw) : null;

      if (startTimeRaw && !startTime) {
        Alert.alert("Invalid start time", "Use 24-hour HH:MM (example: 13:30).");
        return;
      }
      if (endTimeRaw && !endTime) {
        Alert.alert("Invalid end time", "Use 24-hour HH:MM (example: 15:00).");
        return;
      }
      if (!DAY_OPTIONS.includes(day as (typeof DAY_OPTIONS)[number])) {
        Alert.alert("Invalid meeting day", "Recurring meetings must have a valid day.");
        return;
      }
      if (!startTime || !endTime) {
        Alert.alert("Slot time required", "Recurring slots must have start and end times.");
        return;
      }

      normalizedEntries.push({
        ...entry,
        day: day || null,
        meeting_type: room || null,
        room: room || null,
        start_time: startTime,
        end_time: endTime,
        instance_no: null,
      });
    }

    setSaving(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("No signed-in user found.");

      const { error: updateError } = await supabase
        .from("lesson_plans")
        .update({
          title,
          academic_year: academicYear || null,
          term,
          start_date: startDate,
          end_date: endDate,
          notes: notes || null,
        })
        .eq("lesson_plan_id", plan.lesson_plan_id)
        .eq("user_id", user.id);
      if (updateError) throw updateError;

      const existingSeriesKeys = new Set(entries.map((entry) => entry.plan_entry_id));
      const nextSeriesKeys = new Set(normalizedEntries.map((entry) => entry.plan_entry_id));
      const removedSeriesKeys = Array.from(existingSeriesKeys).filter((seriesKey) => !nextSeriesKeys.has(seriesKey));

      if (removedSeriesKeys.length > 0) {
        const { error: deleteRemovedError } = await supabase
          .from("slots")
          .delete()
          .eq("lesson_plan_id", plan.lesson_plan_id)
          .in("series_key", removedSeriesKeys);
        if (deleteRemovedError) throw deleteRemovedError;
      }

      const slotDatesBySeriesKey = new Map<string, string[]>();
      for (const entry of normalizedEntries) {
        const slotDates = buildSlotDatesForDay(startDate, endDate, entry.day ?? "");
        if (slotDates.length === 0) {
          Alert.alert("Schedule day out of range", `No ${entry.day ?? "selected"} dates fall within the current plan range.`);
          return;
        }
        slotDatesBySeriesKey.set(entry.plan_entry_id, slotDates);
      }

      const daySlotCounts = new Map<string, number>();
      for (const entry of normalizedEntries) {
        const { error: deleteSeriesError } = await supabase
          .from("slots")
          .delete()
          .eq("lesson_plan_id", plan.lesson_plan_id)
          .eq("series_key", entry.plan_entry_id);
        if (deleteSeriesError) throw deleteSeriesError;

        const dayKey = entry.day ?? "";
        const nextSlotNumber = (daySlotCounts.get(dayKey) ?? 0) + 1;
        daySlotCounts.set(dayKey, nextSlotNumber);

        const slotDates = slotDatesBySeriesKey.get(entry.plan_entry_id) ?? [];
        const slotRows = slotDates.map((slotDate) => ({
          lesson_plan_id: plan.lesson_plan_id,
          title: null,
          slot_date: slotDate,
          weekday: entry.day,
          start_time: entry.start_time,
          end_time: entry.end_time,
          meeting_type: entry.room,
          room: entry.room,
          slot_number: nextSlotNumber,
          series_key: entry.plan_entry_id,
          is_locked: false,
        }));

        const { error: insertSeriesError } = await supabase.from("slots").insert(slotRows);
        if (insertSeriesError) throw insertSeriesError;
      }

      setPlan((prev) =>
        prev
          ? {
              ...prev,
              title,
              academic_year: academicYear || null,
              term,
              start_date: startDate,
              end_date: endDate,
              notes: notes || null,
            }
          : prev
      );
      const numberedEntries = withInstanceNumbers(normalizedEntries);
      setEntries(numberedEntries.map((entry) => ({ ...entry })));
      setDraftEntries(numberedEntries.map((entry) => ({ ...entry })));
      setIsEditing(false);
      Alert.alert("Saved", "Lesson plan and schedule have been updated.");
    } catch (error: any) {
      Alert.alert("Update failed", error?.message ?? "Could not save lesson plan changes.");
    } finally {
      setSaving(false);
    }
  }, [draft, draftEntries, entries, plan]);

  const handleDeletePlan = useCallback(async () => {
    if (!plan || deleting) return;
    setDeleting(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("No signed-in user found.");

      const { error } = await supabase
        .from("lesson_plans")
        .delete()
        .eq("lesson_plan_id", plan.lesson_plan_id)
        .eq("user_id", user.id);
      if (error) throw error;

      Alert.alert("Plan deleted", "The lesson plan has been removed.");
      router.replace("/plans");
    } catch (err: any) {
      Alert.alert("Could not delete plan", err?.message ?? "Please try again.");
    } finally {
      setDeleting(false);
    }
  }, [deleting, plan]);

  const confirmDeletePlan = useCallback(() => {
    if (!plan || deleting || saving) return;
    Alert.alert(
      "Delete lesson plan?",
      "This permanently deletes the lesson plan and its entries.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void handleDeletePlan();
          },
        },
      ]
    );
  }, [deleting, handleDeletePlan, plan, saving]);

  const recurringEntries = useMemo(
    () =>
      (isEditing ? draftEntries : entries)
        .sort((a, b) => {
          const dayA = DAY_ORDER[a.day ?? ""] ?? 99;
          const dayB = DAY_ORDER[b.day ?? ""] ?? 99;
          if (dayA !== dayB) return dayA - dayB;
          const instanceA = a.instance_no ?? 99;
          const instanceB = b.instance_no ?? 99;
          if (instanceA !== instanceB) return instanceA - instanceB;
          return (a.start_time ?? "99:99:99").localeCompare(b.start_time ?? "99:99:99");
        }),
    [draftEntries, entries, isEditing]
  );
  const visibleDays = useMemo(
    () =>
      DAY_OPTIONS.filter((day) => recurringEntries.some((entry) => entry.day === day)),
    [recurringEntries]
  );

  const filledFieldBg = c.card;
  const emptyFieldBg = c.card;
  const filledText = c.text;
  const emptyFieldText = c.mutedText;

  return (
    <View style={[styles.page, { backgroundColor: c.background }]}> 
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.tint} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}
        >
          <View style={styles.headingRow}>
            <View style={styles.headingLeft}>
              <Pressable onPress={() => router.back()} hitSlop={10}>
                <Ionicons name="caret-back" size={15} color={c.text} />
              </Pressable>
              <Text style={[styles.pageTitle, { color: c.text }]}>Plan Details</Text>
            </View>
            {plan ? (
              <View style={styles.headerActions}>
                {isEditing ? (
                  <>
                    <Pressable
                      style={[styles.actionBtn, styles.actionNeutral, { borderColor: c.border }]}
                      onPress={handleCancelEdit}
                      disabled={saving}
                    >
                      <Text style={[styles.actionText, { color: c.text }]}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.actionBtn, styles.actionPrimary, { opacity: saving ? 0.7 : 1 }]}
                      onPress={handleSave}
                      disabled={saving}
                    >
                      <Text style={styles.actionPrimaryText}>{saving ? "Saving..." : "Save"}</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable
                      style={[styles.actionIconBtn, styles.actionDanger, { opacity: deleting ? 0.7 : 1 }]}
                      onPress={confirmDeletePlan}
                      disabled={deleting}
                      accessibilityRole="button"
                      accessibilityLabel="Delete lesson plan"
                    >
                      <Ionicons name="trash-outline" size={16} color="#FFFFFF" />
                    </Pressable>
                    <Pressable
                      style={[styles.actionIconBtn, styles.actionNeutral, { borderColor: c.border, opacity: deleting ? 0.7 : 1 }]}
                      onPress={handleDuplicate}
                      disabled={deleting}
                      accessibilityRole="button"
                      accessibilityLabel="Duplicate lesson plan"
                    >
                      <Ionicons name="copy-outline" size={16} color={c.text} />
                    </Pressable>
                    <Pressable
                      style={[styles.actionIconBtn, styles.actionPrimary, { opacity: deleting ? 0.7 : 1 }]}
                      onPress={handleEdit}
                      disabled={deleting}
                      accessibilityRole="button"
                      accessibilityLabel="Edit lesson plan"
                    >
                      <Ionicons name="create-outline" size={16} color="#FFFFFF" />
                    </Pressable>
                  </>
                )}
              </View>
            ) : null}
          </View>

          {!plan ? (
            <View style={[styles.emptyState, { borderColor: c.border, backgroundColor: c.card }]}> 
              <Text style={[styles.emptyText, { color: c.mutedText }]}>Plan not found.</Text>
            </View>
          ) : (
            <>
              <Text style={[styles.sectionTitle, { color: c.text }]}>Overview</Text>

              <TextInput
                value={draft?.title ?? ""}
                onChangeText={(value) => setDraft((prev) => (prev ? { ...prev, title: value } : prev))}
                editable={isEditing}
                placeholder="Lesson Plan Name"
                placeholderTextColor="#B0B0B0"
                style={[
                  styles.nameInput,
                  {
                    backgroundColor: (draft?.title ?? "").trim() ? filledFieldBg : emptyFieldBg,
                    color: (draft?.title ?? "").trim() ? filledText : emptyFieldText,
                  },
                ]}
              />

              <View style={styles.row2}>
                <View style={[styles.boxField, { backgroundColor: filledFieldBg }]}>
                  {isEditing ? (
                    <TextInput
                      value={draft?.academic_year ?? ""}
                      onChangeText={(value) => setDraft((prev) => (prev ? { ...prev, academic_year: value } : prev))}
                      editable={isEditing}
                      placeholder="Academic Year"
                      placeholderTextColor="#B0B0B0"
                      style={[styles.boxFieldInput, { color: (draft?.academic_year ?? "").trim() ? filledText : emptyFieldText }]}
                    />
                  ) : (
                    <Text style={[styles.fieldText, { color: filledText }]}>{plan.academic_year || "Academic Year"}</Text>
                  )}
                </View>

                <View style={[styles.boxField, { backgroundColor: filledFieldBg }]}>
                  {isEditing ? (
                    <Pressable onPress={() => setDraft((prev) => (prev ? { ...prev, term: prev.term === "quarter" ? "trimester" : prev.term === "trimester" ? "semester" : "quarter" } : prev))}>
                      <Text style={[styles.fieldText, { color: filledText }]}>{TERM_OPTIONS.includes((draft?.term ?? "") as (typeof TERM_OPTIONS)[number]) ? toTitleCase(draft?.term ?? "") : "Term"}</Text>
                    </Pressable>
                  ) : (
                    <Text style={[styles.fieldText, { color: filledText }]}>{toTitleCase(plan.term)}</Text>
                  )}
                </View>
              </View>

              <View style={styles.dateRow}>
                <Text style={styles.fromToText}>from</Text>
                <View style={[styles.datePill, { backgroundColor: filledFieldBg }]}>
                  {isEditing ? (
                    <TextInput
                      value={draft?.start_date ?? ""}
                      onChangeText={(value) => setDraft((prev) => (prev ? { ...prev, start_date: value } : prev))}
                      editable={isEditing}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#B0B0B0"
                      autoCapitalize="none"
                      style={[styles.dateInputEditable, { color: (draft?.start_date ?? "").trim() ? filledText : emptyFieldText }]}
                    />
                  ) : (
                    <Text style={[styles.dateInput, { color: filledText }]}>{formatIsoDate(plan.start_date)}</Text>
                  )}
                </View>
                <Text style={styles.fromToText}>to</Text>
                <View style={[styles.datePill, { backgroundColor: filledFieldBg }]}>
                  {isEditing ? (
                    <TextInput
                      value={draft?.end_date ?? ""}
                      onChangeText={(value) => setDraft((prev) => (prev ? { ...prev, end_date: value } : prev))}
                      editable={isEditing}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#B0B0B0"
                      autoCapitalize="none"
                      style={[styles.dateInputEditable, { color: (draft?.end_date ?? "").trim() ? filledText : emptyFieldText }]}
                    />
                  ) : (
                    <Text style={[styles.dateInput, { color: filledText }]}>{formatIsoDate(plan.end_date)}</Text>
                  )}
                </View>
              </View>

              <View style={styles.row2}>
                <View style={[styles.boxField, { backgroundColor: filledFieldBg }]}>
                  <Text style={[styles.fieldText, { color: filledText }]} numberOfLines={1}>
                    {plan.subject_code ? `${plan.subject_code} - ${plan.subject_title}` : plan.subject_title}
                  </Text>
                </View>

                <View style={[styles.boxField, { backgroundColor: filledFieldBg }]}>
                  <Text style={[styles.fieldText, { color: filledText }]} numberOfLines={1}>
                    {plan.section_name}
                  </Text>
                </View>
              </View>

              <View style={styles.row2}>
                <View style={[styles.boxField, { backgroundColor: filledFieldBg }]}>
                  <Text style={[styles.fieldText, { color: filledText }]} numberOfLines={1}>
                    {plan.school_name}
                  </Text>
                </View>

                <View style={[styles.boxField, { backgroundColor: filledFieldBg }]}>
                  <Text style={[styles.fieldText, { color: filledText }]} numberOfLines={1}>
                    {plan.section_grade_level ? `Grade ${plan.section_grade_level}` : toTitleCase(plan.status)}
                  </Text>
                </View>
              </View>

              <Pressable style={styles.scheduleBar}>
                <Text style={styles.scheduleBarText}>Schedule</Text>
              </Pressable>

              <View style={styles.dayChipRow}>
                {DAY_OPTIONS.map((day) => {
                  const active = recurringEntries.some((entry) => entry.day === day);
                  return isEditing ? (
                    <Pressable
                      key={day}
                      style={[styles.dayChipPill, active ? styles.dayChipPillActive : undefined]}
                      onPress={() => toggleDraftDay(day)}
                    >
                      <Text style={[styles.dayChipPillText, { color: active ? c.card : c.mutedText }]}>{DAY_LABEL[day].slice(0, 3)}</Text>
                    </Pressable>
                  ) : (
                    <View
                      key={day}
                      style={[styles.dayChipPill, active ? styles.dayChipPillActive : undefined]}
                    >
                      <Text style={[styles.dayChipPillText, { color: active ? c.card : c.mutedText }]}>{DAY_LABEL[day].slice(0, 3)}</Text>
                    </View>
                  );
                })}
              </View>

              {visibleDays.map((day) => {
                const rows = recurringEntries.filter((entry) => entry.day === day);

                return (
                  <View key={day} style={styles.scheduleCard}>
                    <View style={styles.scheduleCardHeader}>
                      <Text style={styles.dayLabel}>{DAY_LABEL[day]}</Text>
                      {isEditing ? (
                        <Pressable style={styles.iconAction} onPress={() => addDraftSchedule(day)}>
                          <Text style={styles.plusText}>+</Text>
                        </Pressable>
                      ) : (
                        <View style={styles.iconAction} />
                      )}
                    </View>

                    <View style={styles.slotStack}>
                      {rows.map((entry) => {
                        const borderColor = entry.room === "laboratory" ? "#D9534F" : "#2D7BD8";
                        return (
                          <View key={entry.plan_entry_id} style={[styles.instanceWrap, { borderColor }]}>
                            <View style={styles.instanceHeaderRow}>
                              <Text style={styles.instanceLabel}>Slot {entry.instance_no ?? 1}</Text>
                              <View style={styles.instanceHeaderRight}>
                                <View style={styles.instanceRoomSwitch}>
                                  {(["lecture", "laboratory"] as const).map((roomOption) => {
                                    const selected = (entry.room ?? "lecture") === roomOption;
                                    return (
                                      <Pressable
                                        key={`${entry.plan_entry_id}_${roomOption}`}
                                        disabled={!isEditing}
                                        style={({ pressed }) => [
                                          styles.roomIconChip,
                                          selected ? styles.roomIconChipActive : undefined,
                                          roomOption === "lecture" ? styles.roomChipLecture : styles.roomChipLaboratory,
                                          isEditing && pressed ? styles.pressScale : undefined,
                                        ]}
                                        onPress={() => setEntryField(entry.plan_entry_id, "room", roomOption)}
                                      >
                                        <Ionicons
                                          name={roomOption === "lecture" ? "school-outline" : "flask-outline"}
                                          size={14}
                                          color={selected ? "#5E6B7A" : c.mutedText}
                                        />
                                        {selected ? <Text style={styles.roomChipTextActive}>{toTitleCase(roomOption)}</Text> : null}
                                      </Pressable>
                                    );
                                  })}
                                </View>
                                {isEditing ? (
                                  <View style={styles.instanceActionRow}>
                                    <Pressable style={styles.removeBtn} onPress={() => duplicateDraftSchedule(entry.plan_entry_id)}>
                                      <Ionicons name="copy-outline" size={14} color="#8A8A8A" />
                                    </Pressable>
                                    {rows.length > 1 ? (
                                      <Pressable style={styles.removeBtn} onPress={() => removeDraftSchedule(entry.plan_entry_id)}>
                                        <Ionicons name="close" size={16} color="#8A8A8A" />
                                      </Pressable>
                                    ) : null}
                                  </View>
                                ) : null}
                              </View>
                            </View>

                            <View style={styles.timeRowCentered}>
                              {isEditing ? (
                                <>
                                  <TextInput
                                    value={toTimeInput(entry.start_time)}
                                    onChangeText={(value) => setEntryField(entry.plan_entry_id, "start_time", value)}
                                    placeholder="Start HH:MM"
                                    placeholderTextColor="#B0B0B0"
                                    autoCapitalize="none"
                                    style={[styles.timeInputEditable, { borderColor, color: c.text }]}
                                  />
                                  <Text style={styles.toText}>to</Text>
                                  <TextInput
                                    value={toTimeInput(entry.end_time)}
                                    onChangeText={(value) => setEntryField(entry.plan_entry_id, "end_time", value)}
                                    placeholder="End HH:MM"
                                    placeholderTextColor="#B0B0B0"
                                    autoCapitalize="none"
                                    style={[styles.timeInputEditable, { borderColor, color: c.text }]}
                                  />
                                </>
                              ) : (
                                <>
                                  <View style={[styles.timeInputButton, { borderColor }]}>
                                    <Text style={styles.timeInputText}>{formatTime(entry.start_time)}</Text>
                                  </View>
                                  <Text style={styles.toText}>to</Text>
                                  <View style={[styles.timeInputButton, { borderColor }]}>
                                    <Text style={styles.timeInputText}>{formatTime(entry.end_time)}</Text>
                                  </View>
                                </>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}

              {recurringEntries.length === 0 ? (
                <Text style={[styles.emptyText, { color: c.mutedText }]}>No schedule yet.</Text>
              ) : null}

              <View style={styles.divider} />

              <Text style={[styles.sectionTitle, { color: c.text }]}>Extra Requirements</Text>
              <TextInput
                value={draft?.notes ?? ""}
                onChangeText={(value) => setDraft((prev) => (prev ? { ...prev, notes: value } : prev))}
                editable={isEditing}
                placeholder="Type notes..."
                placeholderTextColor="#B0B0B0"
                multiline
                style={[
                  styles.extraBox,
                  {
                    backgroundColor: (draft?.notes ?? "").trim() ? filledFieldBg : emptyFieldBg,
                    color: (draft?.notes ?? "").trim() ? filledText : emptyFieldText,
                  },
                ]}
              />
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: 80,
    gap: Spacing.md,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  headingLeft: { flexDirection: "row", alignItems: "center", gap: 3 },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  emptyState: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
  },
  actionBtn: {
    height: 32,
    minWidth: 66,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  actionIconBtn: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  actionPrimary: {
    backgroundColor: "#1F2937",
    borderColor: "#1F2937",
  },
  actionDanger: {
    backgroundColor: "#B42318",
    borderColor: "#B42318",
  },
  actionNeutral: {
    backgroundColor: "#FFFFFF",
  },
  actionText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  actionPrimaryText: {
    ...Typography.caption,
    color: "#FFFFFF",
    fontWeight: "700",
  },
  pageTitle: { ...Typography.h1 },
  sectionTitle: { ...Typography.h2 },
  row2: { flexDirection: "row", gap: 8 },
  boxField: {
    flex: 1,
    minHeight: 48,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: "#D8DDE3",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 10,
  },
  boxFieldInput: {
    ...Typography.body,
    textAlign: "center",
    width: "100%",
  },
  fieldText: {
    ...Typography.body,
    textAlign: "center",
    width: "100%",
  },
  nameInput: {
    ...Typography.body,
    minHeight: 48,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: "#D8DDE3",
    paddingHorizontal: 12,
    textAlign: "center",
  },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  fromToText: {
    ...Typography.caption,
    color: "#7E7E7E",
    width: 30,
    textAlign: "center",
  },
  datePill: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#D8DDE3",
    borderRadius: Radius.round,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  dateInput: {
    ...Typography.caption,
    textAlign: "center",
    paddingVertical: 0,
  },
  dateInputEditable: {
    ...Typography.caption,
    textAlign: "center",
    paddingVertical: 0,
  },
  notesInput: {
    minHeight: 84,
    textAlignVertical: "top",
  },
  emptyText: {
    ...Typography.body,
  },
  scheduleBar: {
    minHeight: 48,
    borderRadius: Radius.sm,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8DDE3",
    alignItems: "center",
    justifyContent: "center",
  },
  scheduleBarText: { ...Typography.h2, color: "#4B5563", fontWeight: "500" },
  dayChipRow: { flexDirection: "row", gap: 8 },
  dayChipPill: {
    flex: 1,
    minHeight: 46,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: "#D8DDE3",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  dayChipPillActive: { backgroundColor: "#6B7280", borderColor: "#6B7280" },
  dayChipPillText: { ...Typography.h3, fontWeight: "500" },
  scheduleCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8DDE3",
    borderRadius: Radius.md,
    padding: 10,
    gap: 8,
  },
  scheduleCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dayLabel: { ...Typography.body, color: "#7A7A7A", fontWeight: "600" },
  slotStack: { gap: 8 },
  instanceWrap: {
    borderWidth: 2,
    borderRadius: Radius.sm,
    backgroundColor: "#FFFFFF",
    padding: 8,
    gap: 8,
  },
  instanceHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  instanceLabel: { ...Typography.caption, color: "#5F5F5F", fontWeight: "600" },
  instanceHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  instanceActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  instanceRoomSwitch: {
    flexDirection: "row",
    gap: 6,
  },
  roomIconChip: {
    minHeight: 28,
    minWidth: 28,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: "#D8DDE3",
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
    backgroundColor: "#FFFFFF",
  },
  roomIconChipActive: {
    minWidth: 108,
    paddingHorizontal: 10,
  },
  roomChipLecture: { borderColor: "#C5CCD6", backgroundColor: "#F7FAFC" },
  roomChipLaboratory: { borderColor: "#C5CCD6", backgroundColor: "#F7FAFC" },
  roomChipTextActive: {
    ...Typography.caption,
    color: "#6B7280",
    fontWeight: "600",
  },
  pressScale: {
    transform: [{ scale: 0.96 }],
  },
  timeRowCentered: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  timeInputButton: {
    minHeight: 36,
    minWidth: 105,
    borderWidth: 1,
    borderRadius: Radius.round,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  timeInputEditable: {
    ...Typography.caption,
    minHeight: 36,
    minWidth: 105,
    borderWidth: 1,
    borderRadius: Radius.round,
    backgroundColor: "#FFFFFF",
    textAlign: "center",
    paddingHorizontal: 12,
  },
  timeInputText: { ...Typography.caption, color: "#1F2937", textAlign: "center" },
  toText: { ...Typography.caption, color: "#666666" },
  removeBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D8DDE3",
    alignItems: "center",
    justifyContent: "center",
  },
  iconAction: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  plusText: { ...Typography.h2, color: "#6B7280", fontWeight: "600" },
  divider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginTop: 4,
    marginBottom: 6,
  },
  extraBox: {
    minHeight: 170,
    borderRadius: Radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 10,
    ...Typography.body,
    textAlignVertical: "top",
    fontStyle: "italic",
    fontWeight: "400",
  },
});
