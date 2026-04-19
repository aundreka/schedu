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
  title: string;
  category: string;
  entry_type: string;
  day: string | null;
  scheduled_date: string | null;
  start_time: string | null;
  end_time: string | null;
  meeting_type: string | null;
  session_category: string | null;
  session_subcategory: string | null;
  room: string | null;
  instance_no: number | null;
  description: string | null;
  lesson_title: string | null;
  ww_subtype: string | null;
  pt_subtype: string | null;
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

function inferWrittenWorkSubtype(title: string, description: string | null) {
  const text = `${title} ${description ?? ""}`.toLowerCase();
  if (text.includes("quiz")) return "quiz";
  if (text.includes("seatwork")) return "seatwork";
  return "assignment";
}

function inferPerformanceTaskSubtype(title: string, description: string | null) {
  const text = `${title} ${description ?? ""}`.toLowerCase();
  if (text.includes("project") || text.includes("preparation")) return "project";
  return "activity";
}

function normalizeEntryCategory(
  sessionCategory: string | null | undefined,
  sessionSubcategory: string | null | undefined
) {
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
  const lessonRaw = row?.lesson;
  const lesson = Array.isArray(lessonRaw) ? lessonRaw[0] : lessonRaw;
  const planEntryId = String(row?.plan_entry_id ?? "");
  const title = String(row?.title ?? "");
  const sessionCategory = row?.session_category ? String(row.session_category) : null;
  const sessionSubcategory = row?.session_subcategory ? String(row.session_subcategory) : null;
  const category = normalizeEntryCategory(sessionCategory, sessionSubcategory);
  const entryType = String(row?.entry_type ?? "planned_item");

  if (!planEntryId || !title) return null;

  return {
    plan_entry_id: planEntryId,
    title,
    category,
    entry_type: entryType,
    day: row?.day ? String(row.day) : null,
    scheduled_date: row?.scheduled_date ? String(row.scheduled_date) : null,
    start_time: row?.start_time ? String(row.start_time) : null,
    end_time: row?.end_time ? String(row.end_time) : null,
    meeting_type: row?.meeting_type ? String(row.meeting_type) : null,
    session_category: sessionCategory,
    session_subcategory: sessionSubcategory,
    room: row?.room ? String(row.room) : null,
    instance_no: typeof row?.instance_no === "number" ? Number(row.instance_no) : null,
    description: row?.description ? String(row.description) : null,
    lesson_title: lesson?.title ? String(lesson.title) : null,
    ww_subtype: row?.ww_subtype ? String(row.ww_subtype) : null,
    pt_subtype: row?.pt_subtype ? String(row.pt_subtype) : null,
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
        .from("plan_entries")
        .select(
          "plan_entry_id, title, entry_type, day, scheduled_date, start_time, end_time, meeting_type, session_category, session_subcategory, room, instance_no, description, ww_subtype, pt_subtype, lesson:lessons(title)"
        )
        .eq("lesson_plan_id", mappedPlan.lesson_plan_id)
        .order("scheduled_date", { ascending: true })
        .order("day", { ascending: true })
        .order("start_time", { ascending: true });
      if (entriesError) throw entriesError;

      const mappedEntries = (entryRows ?? [])
        .map(mapPlanEntry)
        .filter((item: PlanEntryItem | null): item is PlanEntryItem => Boolean(item));

      setEntries(mappedEntries);
      if (!isEditing) {
        setDraftEntries(
          mappedEntries
            .filter((entry) => entry.entry_type === "recurring_class")
            .map((entry) => ({ ...entry }))
        );
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
    setDraftEntries(
      entries
        .filter((entry) => entry.entry_type === "recurring_class")
        .map((entry) => ({ ...entry }))
    );
    setIsEditing(true);
  }, [entries, plan]);

  const handleCancelEdit = useCallback(() => {
    if (plan) setDraft(toPlanDraft(plan));
    setDraftEntries(
      entries
        .filter((entry) => entry.entry_type === "recurring_class")
        .map((entry) => ({ ...entry }))
    );
    setIsEditing(false);
  }, [entries, plan]);

  const setEntryField = useCallback(
    <K extends keyof PlanEntryItem>(planEntryId: string, key: K, value: PlanEntryItem[K]) => {
      setDraftEntries((prev) =>
        prev.map((entry) => (entry.plan_entry_id === planEntryId ? { ...entry, [key]: value } : entry))
      );
    },
    []
  );

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
      const entryTitle = entry.title.trim();
      const category = entry.category.trim().toLowerCase();
      const day = entry.day?.trim().toLowerCase() ?? "";
      const room = entry.room?.trim() ?? "";
      const scheduledDateRaw = entry.scheduled_date?.trim() ?? "";
      const startTimeRaw = entry.start_time?.trim() ?? "";
      const endTimeRaw = entry.end_time?.trim() ?? "";
      const startTime = startTimeRaw ? parseSqlTime(startTimeRaw) : null;
      const endTime = endTimeRaw ? parseSqlTime(endTimeRaw) : null;
      const scheduledDate = scheduledDateRaw ? scheduledDateRaw : null;

      if (!entryTitle) {
        Alert.alert("Entry title required", "Every plan entry must have a title.");
        return;
      }
      if (scheduledDate && !isIsoDate(scheduledDate)) {
        Alert.alert("Invalid entry date", "Planned entry dates must use YYYY-MM-DD.");
        return;
      }
      if (startTimeRaw && !startTime) {
        Alert.alert("Invalid start time", "Use 24-hour HH:MM (example: 13:30).");
        return;
      }
      if (endTimeRaw && !endTime) {
        Alert.alert("Invalid end time", "Use 24-hour HH:MM (example: 15:00).");
        return;
      }
      if (entry.entry_type === "recurring_class") {
        if (!DAY_OPTIONS.includes(day as (typeof DAY_OPTIONS)[number])) {
          Alert.alert("Invalid meeting day", "Recurring meetings must have a valid day.");
          return;
        }
        if (!startTime || !endTime) {
          Alert.alert("Meeting time required", "Recurring meetings must have start and end times.");
          return;
        }
      }

      normalizedEntries.push({
        ...entry,
        title: entryTitle,
        category: category || "lesson",
        day: day || null,
        meeting_type: entry.entry_type === "recurring_class" ? (room || null) : entry.meeting_type ?? null,
        session_category:
          entry.entry_type === "recurring_class"
            ? "lesson"
            : ["lesson", "written_work", "performance_task", "exam", "buffer"].includes(category)
              ? category
              : null,
        session_subcategory:
          entry.entry_type === "recurring_class"
            ? (room || null)
            : entry.session_subcategory ?? null,
        room: room || null,
        scheduled_date: scheduledDate,
        start_time: startTime,
        end_time: endTime,
        description: entry.description?.trim() || null,
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

      for (const entry of normalizedEntries) {
        const wwSubtype =
          entry.category === "written_work"
            ? inferWrittenWorkSubtype(entry.title, entry.description)
            : null;
        const ptSubtype =
          entry.category === "performance_task"
            ? inferPerformanceTaskSubtype(entry.title, entry.description)
            : null;

        const payload = {
          title: entry.title,
          day: entry.day,
          scheduled_date: entry.scheduled_date,
          start_time: entry.start_time,
          end_time: entry.end_time,
          meeting_type: entry.entry_type === "recurring_class" ? entry.room : entry.meeting_type,
          session_category: entry.session_category,
          session_subcategory: entry.session_subcategory,
          room: entry.room,
          instance_no: entry.instance_no,
          description: entry.description,
          ww_subtype: wwSubtype,
          pt_subtype: ptSubtype,
        };

        const { error: entryError } = await supabase
          .from("plan_entries")
          .update(payload)
          .eq("plan_entry_id", entry.plan_entry_id)
          .eq("lesson_plan_id", plan.lesson_plan_id);
        if (entryError) throw entryError;
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
      setEntries((prev) =>
        prev.map((entry) => {
          const updated = normalizedEntries.find((item) => item.plan_entry_id === entry.plan_entry_id);
          return updated ? { ...updated } : entry;
        })
      );
      setDraftEntries(normalizedEntries.map((entry) => ({ ...entry })));
      setIsEditing(false);
      Alert.alert("Saved", "Lesson plan and entries have been updated.");
    } catch (error: any) {
      Alert.alert("Update failed", error?.message ?? "Could not save lesson plan changes.");
    } finally {
      setSaving(false);
    }
  }, [draft, draftEntries, plan]);

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
        .filter((entry) => entry.entry_type === "recurring_class")
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
              <Pressable style={styles.backBtn} onPress={() => router.back()}>
                <Ionicons name="chevron-back" size={18} color={c.text} />
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
                      style={[styles.actionBtn, styles.actionDanger, { opacity: deleting ? 0.7 : 1 }]}
                      onPress={confirmDeletePlan}
                      disabled={deleting}
                    >
                      <Text style={styles.actionPrimaryText}>{deleting ? "Deleting..." : "Delete"}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.actionBtn, styles.actionPrimary, { opacity: deleting ? 0.7 : 1 }]}
                      onPress={handleEdit}
                      disabled={deleting}
                    >
                      <Text style={styles.actionPrimaryText}>Edit</Text>
                    </Pressable>
                  </>
                )}
              </View>
            ) : null}
          </View>

          {!plan ? (
            <View style={[styles.cardWrap, { borderColor: c.border, backgroundColor: c.card }]}> 
              <Text style={[styles.emptyText, { color: c.mutedText }]}>Plan not found.</Text>
            </View>
          ) : (
            <>
              <View style={[styles.cardWrap, { borderColor: c.border, backgroundColor: c.card }]}>
                <Text style={[styles.sectionTitle, { color: c.text }]}>Overview</Text>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: c.text }]}>Title</Text>
                  {isEditing && draft ? (
                    <TextInput
                      value={draft.title}
                      onChangeText={(value) => setDraft((prev) => (prev ? { ...prev, title: value } : prev))}
                      placeholder="Lesson plan title"
                      placeholderTextColor={c.mutedText}
                      style={[styles.formInput, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                    />
                  ) : (
                    <Text style={[styles.formValue, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}>
                      {plan.title}
                    </Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: c.text }]}>Term</Text>
                  {isEditing && draft ? (
                    <View style={styles.optionRow}>
                      {TERM_OPTIONS.map((option) => (
                        <Pressable
                          key={option}
                          style={[
                            styles.optionChip,
                            { borderColor: c.border, backgroundColor: c.card },
                            draft.term === option ? { borderColor: c.tint, backgroundColor: `${c.tint}22` } : null,
                          ]}
                          onPress={() => setDraft((prev) => (prev ? { ...prev, term: option } : prev))}
                        >
                          <Text style={[styles.optionChipText, { color: draft.term === option ? c.tint : c.text }]}>
                            {toTitleCase(option)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <Text style={[styles.formValue, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}>
                      {toTitleCase(plan.term)}
                    </Text>
                  )}
                </View>

                <View style={styles.fieldRow}>
                  <View style={[styles.fieldGroup, styles.fieldHalf]}>
                    <Text style={[styles.fieldLabel, { color: c.text }]}>Start Date</Text>
                    {isEditing && draft ? (
                      <TextInput
                        value={draft.start_date}
                        onChangeText={(value) => setDraft((prev) => (prev ? { ...prev, start_date: value } : prev))}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={c.mutedText}
                        autoCapitalize="none"
                        style={[styles.formInput, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                      />
                    ) : (
                      <Text style={[styles.formValue, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}>
                        {formatIsoDate(plan.start_date)}
                      </Text>
                    )}
                  </View>
                  <View style={[styles.fieldGroup, styles.fieldHalf]}>
                    <Text style={[styles.fieldLabel, { color: c.text }]}>End Date</Text>
                    {isEditing && draft ? (
                      <TextInput
                        value={draft.end_date}
                        onChangeText={(value) => setDraft((prev) => (prev ? { ...prev, end_date: value } : prev))}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={c.mutedText}
                        autoCapitalize="none"
                        style={[styles.formInput, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                      />
                    ) : (
                      <Text style={[styles.formValue, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}>
                        {formatIsoDate(plan.end_date)}
                      </Text>
                    )}
                  </View>
                </View>

                <View style={styles.fieldRow}>
                  <View style={[styles.fieldGroup, styles.fieldHalf]}>
                    <Text style={[styles.fieldLabel, { color: c.text }]}>Section</Text>
                    <Text style={[styles.formValue, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}>
                      {plan.section_name}
                    </Text>
                  </View>
                  <View style={[styles.fieldGroup, styles.fieldHalf]}>
                    <Text style={[styles.fieldLabel, { color: c.text }]}>Grade Level</Text>
                    <Text style={[styles.formValue, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}>
                      {plan.section_grade_level ? `Grade ${plan.section_grade_level}` : "-"}
                    </Text>
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: c.text }]}>Academic Year</Text>
                  {isEditing && draft ? (
                    <TextInput
                      value={draft.academic_year}
                      onChangeText={(value) => setDraft((prev) => (prev ? { ...prev, academic_year: value } : prev))}
                      placeholder="Academic year"
                      placeholderTextColor={c.mutedText}
                      style={[styles.formInput, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                    />
                  ) : (
                    <Text style={[styles.formValue, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}>
                      {plan.academic_year || "No academic year"}
                    </Text>
                  )}
                </View>

                <View style={styles.fieldRow}>
                  <View style={[styles.fieldGroup, styles.fieldHalf]}>
                    <Text style={[styles.fieldLabel, { color: c.text }]}>Subject Code</Text>
                    <Text style={[styles.formValue, styles.fieldStrong, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}>
                      {plan.subject_code || "-"}
                    </Text>
                  </View>
                  <View style={[styles.fieldGroup, styles.fieldHalf]}>
                    <Text style={[styles.fieldLabel, { color: c.text }]}>Status</Text>
                    <Text style={[styles.formValue, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}>
                      {toTitleCase(plan.status)}
                    </Text>
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: c.text }]}>School</Text>
                  <Text style={[styles.formValue, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}>
                    {plan.school_name}
                  </Text>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: c.text }]}>Subject</Text>
                  <Text style={[styles.formValue, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}>
                    {plan.subject_title}
                  </Text>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: c.text }]}>Notes</Text>
                  {isEditing && draft ? (
                    <TextInput
                      value={draft.notes}
                      onChangeText={(value) => setDraft((prev) => (prev ? { ...prev, notes: value } : prev))}
                      placeholder="Type notes..."
                      placeholderTextColor={c.mutedText}
                      multiline
                      style={[styles.formInput, styles.notesInput, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                    />
                  ) : (
                    <Text style={[styles.formValue, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}>
                      {plan.notes || "No notes"}
                    </Text>
                  )}
                </View>
              </View>

              <View style={[styles.cardWrap, { borderColor: c.border, backgroundColor: c.card }]}> 
                <Text style={[styles.sectionTitle, { color: c.text }]}>Weekly Meetings</Text>
                {recurringEntries.length === 0 ? (
                  <Text style={[styles.emptyText, { color: c.mutedText }]}>No recurring meetings.</Text>
                ) : (
                  recurringEntries.map((entry) => (
                    <View key={entry.plan_entry_id} style={[styles.entryItem, { borderColor: c.border }]}> 
                      {isEditing ? (
                        <>
                          <View style={styles.fieldGroupCompact}>
                            <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Title</Text>
                            <TextInput
                              value={entry.title}
                              onChangeText={(value) => setEntryField(entry.plan_entry_id, "title", value)}
                              placeholder="Meeting title"
                              placeholderTextColor={c.mutedText}
                              style={[styles.entryInput, styles.entryTitleInput, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                            />
                          </View>
                          <View style={styles.fieldGroupCompact}>
                            <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Category</Text>
                            <TextInput
                              value={entry.category}
                              onChangeText={(value) => setEntryField(entry.plan_entry_id, "category", value)}
                              placeholder="Category"
                              placeholderTextColor={c.mutedText}
                              autoCapitalize="none"
                              style={[styles.entryInput, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                            />
                          </View>
                        </>
                      ) : (
                        <View style={styles.entryTopRow}>
                          <Text style={[styles.entryTitle, { color: c.text }]}>{entry.title}</Text>
                          <Text style={[styles.entryChip, { backgroundColor: "#E7EEF5", color: "#1F2937" }]}>
                            {toTitleCase(entry.category)}
                          </Text>
                        </View>
                      )}
                      {isEditing ? (
                        <>
                          <Text style={[styles.entryFieldLabel, { color: c.mutedText }]}>Day</Text>
                          <View style={styles.entryEditRow}>
                            <View style={styles.entryDayRow}>
                              {DAY_OPTIONS.map((day) => (
                                <Pressable
                                  key={`${entry.plan_entry_id}_${day}`}
                                  style={[
                                    styles.dayChip,
                                    entry.day === day ? styles.dayChipActive : null,
                                  ]}
                                  onPress={() => setEntryField(entry.plan_entry_id, "day", day)}
                                >
                                  <Text
                                    style={[
                                      styles.dayChipText,
                                      entry.day === day ? styles.dayChipTextActive : null,
                                    ]}
                                  >
                                    {DAY_LABEL[day].slice(0, 3)}
                                  </Text>
                                </Pressable>
                              ))}
                            </View>
                          </View>
                          <View style={styles.entryEditRow}>
                            <TextInput
                              value={entry.instance_no ? String(entry.instance_no) : ""}
                              onChangeText={(value) => {
                                const parsed = Number(value);
                                setEntryField(
                                  entry.plan_entry_id,
                                  "instance_no",
                                  Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
                                );
                              }}
                              placeholder="Meeting #"
                              keyboardType="number-pad"
                              placeholderTextColor={c.mutedText}
                              style={[styles.entryInput, styles.entryHalfInput, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                            />
                            <TextInput
                              value={entry.room ?? ""}
                              onChangeText={(value) => setEntryField(entry.plan_entry_id, "room", value)}
                              placeholder="Room"
                              placeholderTextColor={c.mutedText}
                              style={[styles.entryInput, styles.entryHalfInput, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                            />
                          </View>
                          <View style={styles.entryEditRow}>
                            <TextInput
                              value={toTimeInput(entry.start_time)}
                              onChangeText={(value) => setEntryField(entry.plan_entry_id, "start_time", value)}
                              placeholder="Start HH:MM"
                              placeholderTextColor={c.mutedText}
                              autoCapitalize="none"
                              style={[styles.entryInput, styles.entryHalfInput, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                            />
                            <TextInput
                              value={toTimeInput(entry.end_time)}
                              onChangeText={(value) => setEntryField(entry.plan_entry_id, "end_time", value)}
                              placeholder="End HH:MM"
                              placeholderTextColor={c.mutedText}
                              autoCapitalize="none"
                              style={[styles.entryInput, styles.entryHalfInput, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                            />
                          </View>
                          <TextInput
                            value={entry.description ?? ""}
                            onChangeText={(value) => setEntryField(entry.plan_entry_id, "description", value)}
                            placeholder="Description"
                            placeholderTextColor={c.mutedText}
                            multiline
                            style={[styles.entryInput, styles.entryDescriptionInput, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
                          />
                        </>
                      ) : (
                        <>
                          <Text style={[styles.entryMeta, { color: c.mutedText }]}> 
                            {DAY_LABEL[entry.day ?? ""] ?? "-"}
                            {entry.instance_no ? ` • Meeting ${entry.instance_no}` : ""}
                            {entry.room ? ` • ${toTitleCase(entry.room)}` : ""}
                          </Text>
                          <Text style={[styles.entryMeta, { color: c.mutedText }]}> 
                            {[formatTime(entry.start_time), formatTime(entry.end_time)].filter(Boolean).join(" - ") || "No time"}
                          </Text>
                          {entry.description ? <Text style={[styles.entryDesc, { color: c.text }]}>{entry.description}</Text> : null}
                        </>
                      )}
                    </View>
                  ))
                )}
              </View>

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
  actionBtn: {
    height: 32,
    minWidth: 66,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
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
  backBtn: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: { ...Typography.h1 },
  cardWrap: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  sectionTitle: { ...Typography.h2 },
  fieldGroup: {
    gap: 6,
    marginTop: 4,
  },
  fieldGroupCompact: {
    gap: 4,
  },
  fieldRow: {
    flexDirection: "row",
    gap: 8,
  },
  fieldHalf: {
    flex: 1,
  },
  fieldLabel: {
    ...Typography.caption,
    fontWeight: "600",
  },
  formInput: {
    ...Typography.body,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  formValue: {
    ...Typography.body,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  optionRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  optionChip: {
    borderRadius: Radius.round,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  optionChipText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  fieldStrong: {
    ...Typography.h3,
    fontStyle: "italic",
  },
  notesInput: {
    minHeight: 84,
    textAlignVertical: "top",
  },
  emptyText: {
    ...Typography.body,
  },
  entryItem: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    gap: 4,
  },
  entryTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.sm,
  },
  entryTitle: {
    ...Typography.body,
    flex: 1,
    fontWeight: "600",
  },
  entryFieldLabel: {
    ...Typography.caption,
    fontWeight: "600",
  },
  entryInput: {
    ...Typography.body,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  entryTitleInput: {
    fontWeight: "600",
  },
  entryEditRow: {
    flexDirection: "row",
    gap: 8,
  },
  entryHalfInput: {
    flex: 1,
  },
  entryDescriptionInput: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  entryDayRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  dayChip: {
    borderRadius: Radius.round,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  dayChipActive: {
    borderColor: "#1F2937",
    backgroundColor: "#1F2937",
  },
  dayChipText: {
    ...Typography.caption,
    color: "#334155",
    fontWeight: "600",
  },
  dayChipTextActive: {
    color: "#FFFFFF",
  },
  entryChip: {
    ...Typography.caption,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.round,
    overflow: "hidden",
  },
  entryMeta: {
    ...Typography.caption,
  },
  entryDesc: {
    ...Typography.body,
    marginTop: 2,
  },
});
