import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { router } from "expo-router";
import { Radius, Spacing, Typography } from "../constants/fonts";
import { useAppTheme } from "../context/theme";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { supabase } from "../lib/supabase";

type AcademicTerm = "quarter" | "trimester" | "semester";
type RequirementKey = "written_work" | "performance_task" | "exam";
type WeekdayName = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";
type RoomType = "lecture" | "laboratory";

type SubjectItem = {
  subject_id: string;
  school_id: string;
  code: string;
  title: string;
  academic_year: string | null;
};

type SectionItem = {
  section_id: string;
  school_id: string;
  name: string;
  grade_level: string | null;
};

type ChapterOption = {
  chapter_id: string;
  title: string;
  sequence_no: number;
  unit_id: string | null;
  unit_title: string | null;
  unit_sequence_no: number | null;
};

type UnitGroup = {
  key: string;
  title: string;
  chapters: ChapterOption[];
};

type ScheduleSlot = {
  start: string;
  end: string;
};

type DaySchedule = {
  first: ScheduleSlot;
  second: ScheduleSlot | null;
  room: RoomType;
};

type SpecialDate = {
  id: string;
  dateText: string;
  reason: string;
};

type TimeTarget = {
  day: WeekdayName;
  slot: "first" | "second";
  field: "start" | "end";
};

const TERM_LABEL: Record<AcademicTerm, string> = {
  quarter: "Quarter",
  trimester: "Trimester",
  semester: "Semester",
};

const REQUIREMENT_LABEL: Record<RequirementKey, string> = {
  written_work: "Written Work",
  performance_task: "Performance Task",
  exam: "Exam",
};

const DAY_OPTIONS: { key: WeekdayName; short: string; label: string }[] = [
  { key: "monday", short: "Mon", label: "Monday" },
  { key: "tuesday", short: "Tue", label: "Tuesday" },
  { key: "wednesday", short: "Wed", label: "Wednesday" },
  { key: "thursday", short: "Thu", label: "Thursday" },
  { key: "friday", short: "Fri", label: "Friday" },
  { key: "saturday", short: "Sat", label: "Saturday" },
];

function toLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function plusDays(baseDate: string, days: number) {
  const date = new Date(`${baseDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

function makeId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function buildAcademicYearFallback(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return `${start.getFullYear()} - ${end.getFullYear()}`;
}

function normalizeDateInput(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return toLocalDateString(parsed);
  }
  return value;
}

function toSqlTime(value: string) {
  const raw = value.trim().toUpperCase();
  const ampm = raw.endsWith("AM") ? "AM" : raw.endsWith("PM") ? "PM" : null;
  const core = ampm ? raw.slice(0, -2).trim() : raw;
  const [hPart, mPart] = core.split(":");
  const hours = Number(hPart);
  const mins = Number(mPart ?? "0");
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;

  let hour24 = hours;
  if (ampm) {
    if (hours < 1 || hours > 12) return null;
    if (ampm === "AM") hour24 = hours === 12 ? 0 : hours;
    if (ampm === "PM") hour24 = hours === 12 ? 12 : hours + 12;
  }

  return `${String(hour24).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;
}

function parseDisplayTime(value: string) {
  const raw = value.trim().toUpperCase();
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (!match) return { hour: 8, minute: 0, meridiem: "AM" as const };
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3] as "AM" | "PM";
  return {
    hour: hour >= 1 && hour <= 12 ? hour : 8,
    minute: [0, 15, 30, 45].includes(minute) ? minute : 0,
    meridiem,
  };
}

function formatDisplayTime(hour: number, minute: number, meridiem: "AM" | "PM") {
  return `${hour}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

export default function LessonplanScreen() {
  const { colors: c } = useAppTheme();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [subjectMenuOpen, setSubjectMenuOpen] = useState(false);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const [chapterModalOpen, setChapterModalOpen] = useState(false);
  const [roomMenuDay, setRoomMenuDay] = useState<WeekdayName | null>(null);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [timeTarget, setTimeTarget] = useState<TimeTarget | null>(null);
  const [pickerHour, setPickerHour] = useState(8);
  const [pickerMinute, setPickerMinute] = useState(0);
  const [pickerMeridiem, setPickerMeridiem] = useState<"AM" | "PM">("AM");

  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [sections, setSections] = useState<SectionItem[]>([]);
  const [chapters, setChapters] = useState<ChapterOption[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());

  const [term, setTerm] = useState<AcademicTerm>("quarter");
  const [academicYear, setAcademicYear] = useState("2025 - 2026");
  const [startDate, setStartDate] = useState("June 05 2025");
  const [endDate, setEndDate] = useState("April 2 2026");
  const [extraRequirements, setExtraRequirements] = useState("");
  const [activeRequirements, setActiveRequirements] = useState<Set<RequirementKey>>(new Set(["performance_task"]));
  const [requirementCounts, setRequirementCounts] = useState<Record<RequirementKey, string>>({
    written_work: "1",
    performance_task: "1",
    exam: "1",
  });
  const [durationActive, setDurationActive] = useState(true);

  const [activeDays, setActiveDays] = useState<Set<WeekdayName>>(new Set(["monday", "wednesday"]));
  const [daySchedules, setDaySchedules] = useState<Record<WeekdayName, DaySchedule>>({
    monday: {
      first: { start: "8:00 AM", end: "10:00 AM" },
      second: { start: "1:00 PM", end: "3:00 PM" },
      room: "lecture",
    },
    tuesday: {
      first: { start: "8:00 AM", end: "10:00 AM" },
      second: null,
      room: "lecture",
    },
    wednesday: {
      first: { start: "8:00 AM", end: "10:00 AM" },
      second: null,
      room: "lecture",
    },
    thursday: {
      first: { start: "8:00 AM", end: "10:00 AM" },
      second: null,
      room: "lecture",
    },
    friday: {
      first: { start: "8:00 AM", end: "10:00 AM" },
      second: null,
      room: "lecture",
    },
    saturday: {
      first: { start: "8:00 AM", end: "10:00 AM" },
      second: null,
      room: "lecture",
    },
  });

  const [specialDates, setSpecialDates] = useState<SpecialDate[]>([
    { id: makeId(), dateText: "June 05 2025", reason: "" },
  ]);

  const selectedSubject = useMemo(
    () => subjects.find((item) => item.subject_id === selectedSubjectId) ?? null,
    [subjects, selectedSubjectId]
  );

  const selectedSection = useMemo(
    () => sections.find((item) => item.section_id === selectedSectionId) ?? null,
    [sections, selectedSectionId]
  );

  const selectableSections = useMemo(() => {
    if (!selectedSubject?.school_id) return sections;
    return sections.filter((item) => item.school_id === selectedSubject.school_id);
  }, [sections, selectedSubject?.school_id]);

  const unitGroups = useMemo<UnitGroup[]>(() => {
    const byKey = new Map<string, UnitGroup>();
    for (const chapter of chapters) {
      const key = chapter.unit_id ?? "ungrouped";
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          title:
            chapter.unit_id !== null
              ? `Unit ${chapter.unit_sequence_no ?? "-"}: ${chapter.unit_title ?? "Untitled Unit"}`
              : "Ungrouped",
          chapters: [],
        });
      }
      byKey.get(key)?.chapters.push(chapter);
    }

    return Array.from(byKey.values()).map((group) => ({
      ...group,
      chapters: [...group.chapters].sort((a, b) => a.sequence_no - b.sequence_no),
    }));
  }, [chapters]);

  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("No signed-in user found.");

      const { data: userSubjects, error: subjectsError } = await supabase
        .from("user_subjects")
        .select("subject:subjects(subject_id, school_id, code, title, academic_year)")
        .eq("user_id", user.id);
      if (subjectsError) throw subjectsError;

      const mappedSubjects: SubjectItem[] = (userSubjects ?? [])
        .map((row: any) => {
          const subjectRaw = row?.subject;
          const subject = Array.isArray(subjectRaw) ? subjectRaw[0] : subjectRaw;
          if (!subject?.subject_id || !subject?.title || !subject?.code || !subject?.school_id) return null;
          return {
            subject_id: String(subject.subject_id),
            school_id: String(subject.school_id),
            code: String(subject.code),
            title: String(subject.title),
            academic_year: subject?.academic_year ? String(subject.academic_year) : null,
          } satisfies SubjectItem;
        })
        .filter((item: SubjectItem | null): item is SubjectItem => Boolean(item))
        .sort((a, b) => `${a.code} ${a.title}`.localeCompare(`${b.code} ${b.title}`));

      const { data: userSchools, error: schoolsError } = await supabase
        .from("user_schools")
        .select("school_id")
        .eq("user_id", user.id);
      if (schoolsError) throw schoolsError;

      const schoolIds = (userSchools ?? []).map((row: any) => String(row.school_id)).filter(Boolean);
      let mappedSections: SectionItem[] = [];
      if (schoolIds.length > 0) {
        const { data: sectionRows, error: sectionsError } = await supabase
          .from("sections")
          .select("section_id, school_id, name, grade_level")
          .in("school_id", schoolIds)
          .order("name", { ascending: true });
        if (sectionsError) throw sectionsError;

        mappedSections = (sectionRows ?? []).map((row: any) => ({
          section_id: String(row.section_id),
          school_id: String(row.school_id),
          name: String(row.name),
          grade_level: row?.grade_level ? String(row.grade_level) : null,
        }));
      }

      setSubjects(mappedSubjects);
      setSections(mappedSections);
    } catch (err: any) {
      Alert.alert("Unable to load lesson plan form", err?.message ?? "Please try again.");
      setSubjects([]);
      setSections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChapters = useCallback(async (subjectId: string) => {
    if (!subjectId) {
      setChapters([]);
      setSelectedChapterIds(new Set());
      return;
    }

    try {
      const { data, error } = await supabase
        .from("chapters")
        .select("chapter_id, title, sequence_no, unit:units(unit_id, title, sequence_no)")
        .eq("subject_id", subjectId)
        .order("sequence_no", { ascending: true });
      if (error) throw error;

      const mapped: ChapterOption[] = (data ?? []).map((row: any) => ({
        chapter_id: String(row.chapter_id),
        title: String(row.title),
        sequence_no: Number(row.sequence_no ?? 0),
        unit_id: row?.unit?.unit_id ? String(row.unit.unit_id) : null,
        unit_title: row?.unit?.title ? String(row.unit.title) : null,
        unit_sequence_no: typeof row?.unit?.sequence_no === "number" ? Number(row.unit.sequence_no) : null,
      }));

      setChapters(mapped);
      setSelectedChapterIds(new Set(mapped.map((item) => item.chapter_id)));
      setChapterModalOpen(true);
    } catch (err: any) {
      Alert.alert("Unable to load units/chapters", err?.message ?? "Please try again.");
      setChapters([]);
      setSelectedChapterIds(new Set());
    }
  }, []);

  useEffect(() => {
    loadBase();
  }, [loadBase]);

  const { refreshing, onRefresh } = usePullToRefresh(loadBase);

  const toggleDay = (day: WeekdayName) => {
    setActiveDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
    if (roomMenuDay === day) setRoomMenuDay(null);
  };

  const setSlotValue = (day: WeekdayName, which: "first" | "second", field: "start" | "end", value: string) => {
    setDaySchedules((prev) => {
      const daySchedule = prev[day];
      if (!daySchedule) return prev;
      if (which === "first") {
        return {
          ...prev,
          [day]: {
            ...daySchedule,
            first: { ...daySchedule.first, [field]: value },
          },
        };
      }
      if (!daySchedule.second) return prev;
      return {
        ...prev,
        [day]: {
          ...daySchedule,
          second: { ...daySchedule.second, [field]: value },
        },
      };
    });
  };

  const toggleSecondSlot = (day: WeekdayName) => {
    setDaySchedules((prev) => {
      const current = prev[day];
      if (!current) return prev;
      if (current.second) return prev;
      return {
        ...prev,
        [day]: {
          ...current,
          second: { start: "1:00 PM", end: "3:00 PM" },
        },
      };
    });
    setRoomMenuDay(day);
  };

  const setRoom = (day: WeekdayName, room: RoomType) => {
    setDaySchedules((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        room,
      },
    }));
    setRoomMenuDay(null);
  };

  const openTimePicker = (target: TimeTarget) => {
    const schedule = daySchedules[target.day];
    const slot = target.slot === "first" ? schedule.first : schedule.second;
    if (!slot) return;
    const current = parseDisplayTime(slot[target.field]);
    setPickerHour(current.hour);
    setPickerMinute(current.minute);
    setPickerMeridiem(current.meridiem);
    setTimeTarget(target);
    setTimePickerOpen(true);
  };

  const applyPickedTime = () => {
    if (!timeTarget) return;
    const value = formatDisplayTime(pickerHour, pickerMinute, pickerMeridiem);
    setSlotValue(timeTarget.day, timeTarget.slot, timeTarget.field, value);
    setTimePickerOpen(false);
    setTimeTarget(null);
  };

  const removeSecondSlot = (day: WeekdayName) => {
    setDaySchedules((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        second: null,
      },
    }));
    if (roomMenuDay === day) setRoomMenuDay(null);
  };

  const toggleRequirement = (key: RequirementKey) => {
    setActiveRequirements((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setRequirementCount = (key: RequirementKey, value: string) => {
    const sanitized = value.replace(/[^0-9]/g, "");
    setRequirementCounts((prev) => ({ ...prev, [key]: sanitized }));
  };

  const toggleChapter = (chapterId: string) => {
    setSelectedChapterIds((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const addSpecialDateRow = () => {
    setSpecialDates((prev) => [...prev, { id: makeId(), dateText: "", reason: "" }]);
  };

  const setSpecialDateField = (id: string, field: "dateText" | "reason", value: string) => {
    setSpecialDates((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const handlePickSubject = async (subjectId: string) => {
    setSelectedSubjectId(subjectId);
    setSubjectMenuOpen(false);
    const subject = subjects.find((item) => item.subject_id === subjectId);
    if (subject?.academic_year) setAcademicYear(subject.academic_year);
    await loadChapters(subjectId);
  };

  const handleCreatePlan = async () => {
    if (!selectedSubject) {
      Alert.alert("Subject required", "Select a subject first.");
      return;
    }
    if (!selectedSection) {
      Alert.alert("Section required", "Select a section first.");
      return;
    }

    const normalizedStart = normalizeDateInput(startDate);
    const normalizedEnd = normalizeDateInput(endDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedStart) || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedEnd)) {
      Alert.alert("Invalid dates", "Use a valid date for start/end.");
      return;
    }
    if (normalizedEnd < normalizedStart) {
      Alert.alert("Invalid range", "End date must be after start date.");
      return;
    }

    setSaving(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("No signed-in user found.");

      const title = `${selectedSubject.code} ${selectedSubject.title} Lesson Plan`;
      const yearText = academicYear.trim() || buildAcademicYearFallback(normalizedStart, normalizedEnd);

      const { data: planRow, error: planError } = await supabase
        .from("lesson_plans")
        .insert({
          user_id: user.id,
          school_id: selectedSubject.school_id,
          subject_id: selectedSubject.subject_id,
          section_id: selectedSection.section_id,
          title,
          academic_year: yearText,
          term,
          start_date: normalizedStart,
          end_date: normalizedEnd,
          notes: extraRequirements.trim() || null,
          status: "draft",
        })
        .select("lesson_plan_id")
        .single();
      if (planError) throw planError;

      const lessonPlanId = String((planRow as { lesson_plan_id: string }).lesson_plan_id);

      const selectedChapters = chapters
        .filter((item) => selectedChapterIds.has(item.chapter_id))
        .sort((a, b) => a.sequence_no - b.sequence_no);

      const lessonRows = selectedChapters.map((chapter, index) => ({
        lesson_plan_id: lessonPlanId,
        entry_type: "planned_item",
        category: "lesson",
        scheduled_date: plusDays(normalizedStart, index * 7),
        title: `Lesson ${index + 1}: ${chapter.title}`,
        description: chapter.unit_title ? `${chapter.unit_title} • Chapter ${chapter.sequence_no}` : `Chapter ${chapter.sequence_no}`,
      }));

      const recurringRows = Array.from(activeDays)
        .map((day) => {
          const row = daySchedules[day];
          if (!row) return [];
          const firstStart = toSqlTime(row.first.start);
          const firstEnd = toSqlTime(row.first.end);
          if (!firstStart || !firstEnd) return [];

          const result: any[] = [
            {
              lesson_plan_id: lessonPlanId,
              entry_type: "recurring_class",
              category: "lesson",
              day,
              start_time: firstStart,
              end_time: firstEnd,
              room: row.room,
              title: `${DAY_OPTIONS.find((item) => item.key === day)?.label ?? day} Class`,
            },
          ];

          if (row.second) {
            const secondStart = toSqlTime(row.second.start);
            const secondEnd = toSqlTime(row.second.end);
            if (!secondStart || !secondEnd) return result;
            result.push({
              lesson_plan_id: lessonPlanId,
              entry_type: "recurring_class",
              category: "lesson",
              day,
              start_time: secondStart,
              end_time: secondEnd,
              room: row.room,
              title: `${DAY_OPTIONS.find((item) => item.key === day)?.label ?? day} Class`,
            });
          }

          return result;
        })
        .flat();

      const requirementRows = Array.from(activeRequirements).map((category) => {
        const parsedCount = Number(requirementCounts[category] || "0");
        const count = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 1;
        return {
          lesson_plan_id: lessonPlanId,
          entry_type: "planned_item",
          category,
          scheduled_date: normalizedEnd,
          title: REQUIREMENT_LABEL[category],
          description: `Count: ${count}`,
        };
      });

      const entryPayload = [...lessonRows, ...recurringRows, ...requirementRows];
      if (entryPayload.length > 0) {
        const { error: entriesError } = await supabase.from("plan_entries").insert(entryPayload);
        if (entriesError) throw entriesError;
      }

      const specialEvents = specialDates
        .map((row) => ({ ...row, isoDate: normalizeDateInput(row.dateText) }))
        .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.isoDate) && row.reason.trim());

      if (specialEvents.length > 0) {
        const { error: eventsError } = await supabase.from("school_calendar_events").insert(
          specialEvents.map((row) => ({
            school_id: selectedSubject.school_id,
            section_id: selectedSection.section_id,
            subject_id: selectedSubject.subject_id,
            event_type: "other",
            title: row.reason.trim(),
            description: row.reason.trim(),
            start_date: row.isoDate,
            end_date: row.isoDate,
            is_whole_day: true,
            created_by: user.id,
          }))
        );
        if (eventsError) throw eventsError;
      }

      Alert.alert("Lesson plan created", "Your lesson plan was saved.", [
        { text: "OK", onPress: () => router.push("/calendar") },
      ]);
    } catch (err: any) {
      Alert.alert("Could not create lesson plan", err?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator size="large" color={c.tint} />
      </View>
    );
  }

  return (
    <View style={[styles.page, { backgroundColor: c.background }]}> 
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}
      >
        <View style={styles.headingRow}>
          <View style={styles.headingLeft}>
            <Ionicons name="caret-back" size={15} color={c.text} />
            <Text style={[styles.pageTitle, { color: c.text }]}>Create Lessonplan</Text>
          </View>
          <Pressable onPress={handleCreatePlan} disabled={saving}>
            {saving ? <ActivityIndicator color={c.text} /> : <Ionicons name="checkmark" size={38} color={c.text} />}
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: c.text }]}>Overview</Text>

        <View style={styles.row3}>
          <View style={[styles.boxField, { backgroundColor: "#F5F5F5" }]}>
            <TextInput
              value={academicYear}
              onChangeText={setAcademicYear}
              placeholder="Academic Year"
              placeholderTextColor="#B0B0B0"
              style={styles.fieldText}
            />
          </View>

          <Pressable style={[styles.boxField, { backgroundColor: "#F5F5F5" }]} onPress={() => {
            setTerm((prev) => (prev === "quarter" ? "trimester" : prev === "trimester" ? "semester" : "quarter"));
          }}>
            <Text style={styles.fieldText}>{TERM_LABEL[term]}</Text>
          </Pressable>

          <Pressable
            style={[styles.boxField, { backgroundColor: durationActive ? "#868686" : "#F5F5F5" }]}
            onPress={() => setDurationActive(true)}
          >
            <Text style={[styles.fieldText, { color: durationActive ? "#FFFFFF" : "#B0B0B0" }]}>Duration</Text>
          </Pressable>
        </View>

        <View style={styles.dateRow}>
          <Text style={styles.fromToText}>from</Text>
          <View style={styles.datePill}>
            <TextInput
              value={startDate}
              onChangeText={setStartDate}
              placeholder="June 05 2025"
              placeholderTextColor="#8D8D8D"
              style={styles.dateInput}
            />
          </View>
          <Text style={styles.fromToText}>to</Text>
          <View style={styles.datePill}>
            <TextInput
              value={endDate}
              onChangeText={setEndDate}
              placeholder="April 2 2026"
              placeholderTextColor="#8D8D8D"
              style={styles.dateInput}
            />
          </View>
        </View>

        <View style={styles.row2}>
          <Pressable style={[styles.boxField, { backgroundColor: "#F5F5F5" }]} onPress={() => setSubjectMenuOpen((v) => !v)}>
            <Text style={styles.fieldText} numberOfLines={1}>
              {selectedSubject ? `${selectedSubject.code} - ${selectedSubject.title}` : "Subject"}
            </Text>
          </Pressable>
          <Pressable style={[styles.boxField, { backgroundColor: "#F5F5F5" }]} onPress={() => setSectionMenuOpen((v) => !v)}>
            <Text style={styles.fieldText} numberOfLines={1}>
              {selectedSection ? selectedSection.name : "Section"}
            </Text>
          </Pressable>
        </View>

        {subjectMenuOpen ? (
          <View style={styles.dropdown}>
            {subjects.map((subject) => (
              <Pressable key={subject.subject_id} style={styles.dropdownItem} onPress={() => handlePickSubject(subject.subject_id)}>
                <Text style={styles.dropdownText}>{subject.code} - {subject.title}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {sectionMenuOpen ? (
          <View style={styles.dropdown}>
            {selectableSections.map((section) => (
              <Pressable
                key={section.section_id}
                style={styles.dropdownItem}
                onPress={() => {
                  setSelectedSectionId(section.section_id);
                  setSectionMenuOpen(false);
                }}
              >
                <Text style={styles.dropdownText}>{section.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Pressable style={styles.scheduleBar}>
          <Text style={styles.scheduleBarText}>Schedule</Text>
        </Pressable>

        <View style={styles.dayChipRow}>
          {DAY_OPTIONS.map((day) => {
            const active = activeDays.has(day.key);
            return (
              <Pressable
                key={day.key}
                style={[styles.dayChip, active ? styles.dayChipActive : undefined]}
                onPress={() => toggleDay(day.key)}
              >
                <Text style={styles.dayChipText}>{day.short}</Text>
              </Pressable>
            );
          })}
        </View>

        {DAY_OPTIONS.filter((day) => activeDays.has(day.key)).map((day) => {
          const row = daySchedules[day.key];
          const hasSecond = Boolean(row.second);

          return (
            <View key={day.key} style={styles.scheduleCard}>
              <View style={styles.scheduleCardHeader}>
                <Text style={styles.dayLabel}>{day.label}</Text>
                <View style={styles.scheduleActions}>
                  {!hasSecond ? (
                    <Pressable style={styles.iconAction} onPress={() => toggleSecondSlot(day.key)}>
                      <Text style={styles.plusText}>+</Text>
                    </Pressable>
                  ) : null}
                  {hasSecond ? (
                    <Pressable style={styles.iconAction} onPress={() => removeSecondSlot(day.key)}>
                      <Ionicons name="close" size={18} color="#A8A8A8" />
                    </Pressable>
                  ) : null}
                </View>
              </View>

              <View style={[styles.slotStack, !hasSecond ? styles.slotStackCentered : undefined]}>
                <View style={[styles.timeSlotBlue, !hasSecond ? styles.timeSlotSingle : undefined]}>
                  <Pressable style={styles.timeInputButton} onPress={() => openTimePicker({ day: day.key, slot: "first", field: "start" })}>
                    <Text style={styles.timeInputText}>{row.first.start}</Text>
                  </Pressable>
                  <Text style={styles.toText}>to</Text>
                  <Pressable style={styles.timeInputButton} onPress={() => openTimePicker({ day: day.key, slot: "first", field: "end" })}>
                    <Text style={styles.timeInputText}>{row.first.end}</Text>
                  </Pressable>
                </View>

                {hasSecond ? (
                  <View style={styles.secondSlotWrap}>
                    <Text style={styles.andText}>and</Text>
                    <View style={styles.timeSlotRed}>
                      <Pressable
                        style={styles.timeInputButton}
                        onPress={() => openTimePicker({ day: day.key, slot: "second", field: "start" })}
                      >
                        <Text style={styles.timeInputText}>{row.second?.start ?? ""}</Text>
                      </Pressable>
                      <Text style={styles.toText}>to</Text>
                      <Pressable
                        style={styles.timeInputButton}
                        onPress={() => openTimePicker({ day: day.key, slot: "second", field: "end" })}
                      >
                        <Text style={styles.timeInputText}>{row.second?.end ?? ""}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>

              {hasSecond ? (
                <>
                  <Pressable style={styles.roomToggle} onPress={() => setRoomMenuDay((prev) => (prev === day.key ? null : day.key))}>
                    <Text style={styles.roomToggleText}>{row.room === "lecture" ? "Lecture" : "Laboratory"}</Text>
                  </Pressable>
                  {roomMenuDay === day.key ? (
                    <View style={styles.roomMenu}>
                      <Pressable
                        style={[styles.roomItem, row.room === "lecture" ? styles.roomItemActive : undefined]}
                        onPress={() => setRoom(day.key, "lecture")}
                      >
                        <Text style={styles.roomItemText}>Lecture</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.roomItem, row.room === "laboratory" ? styles.roomItemActive : undefined]}
                        onPress={() => setRoom(day.key, "laboratory")}
                      >
                        <Text style={styles.roomItemText}>Laboratory</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          );
        })}

        <View style={styles.divider} />

        <Text style={[styles.sectionTitle, { color: c.text }]}>Minimum Requirements</Text>
        <View style={styles.row3}>
          {(Object.keys(REQUIREMENT_LABEL) as RequirementKey[]).map((key) => {
            const active = activeRequirements.has(key);
            return (
              <View key={key} style={[styles.requirementPill, active ? styles.requirementPillActive : undefined]}>
                <Pressable style={styles.requirementToggle} onPress={() => toggleRequirement(key)}>
                  <Text style={styles.requirementText}>{REQUIREMENT_LABEL[key]}</Text>
                </Pressable>
                <TextInput
                  value={requirementCounts[key]}
                  onChangeText={(value) => setRequirementCount(key, value)}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor="#B0B0B0"
                  style={styles.requirementCountInput}
                />
              </View>
            );
          })}
        </View>

        <View style={styles.divider} />

        <Text style={[styles.sectionTitle, { color: c.text }]}>Extra Requirements</Text>
        <TextInput
          value={extraRequirements}
          onChangeText={setExtraRequirements}
          placeholder="(1 Seatwork per Lesson, 1 activity per laboratory session, one long project making week, etc.)"
          placeholderTextColor="#B0B0B0"
          multiline
          style={styles.extraBox}
        />

        <View style={styles.divider} />

        <Text style={[styles.sectionTitle, { color: c.text }]}>Special Dates (Optional)</Text>
        {specialDates.map((row, index) => (
          <View key={row.id} style={styles.specialRow}>
            <View style={styles.specialDatePill}>
              <TextInput
                value={row.dateText}
                onChangeText={(value) => setSpecialDateField(row.id, "dateText", value)}
                placeholder="June 05 2025"
                placeholderTextColor="#8D8D8D"
                style={styles.dateInput}
              />
            </View>
            <View style={styles.specialReasonBox}>
              <TextInput
                value={row.reason}
                onChangeText={(value) => setSpecialDateField(row.id, "reason", value)}
                placeholder="Reason"
                placeholderTextColor="#B0B0B0"
                style={styles.reasonInput}
              />
            </View>
            {index === specialDates.length - 1 ? (
              <Pressable style={styles.iconAction} onPress={addSpecialDateRow}>
                <Text style={styles.plusText}>+</Text>
              </Pressable>
            ) : (
              <View style={styles.iconAction} />
            )}
          </View>
        ))}
      </ScrollView>

      <Modal visible={chapterModalOpen} transparent animationType="fade" onRequestClose={() => setChapterModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setChapterModalOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Select Units and Chapters</Text>
            <ScrollView style={styles.modalScroll}>
              {unitGroups.length === 0 ? (
                <Text style={styles.modalEmpty}>No units/chapters found for this subject.</Text>
              ) : (
                unitGroups.map((group) => (
                  <View key={group.key} style={styles.modalGroup}>
                    <Text style={styles.modalGroupTitle}>{group.title}</Text>
                    {group.chapters.map((chapter) => {
                      const selected = selectedChapterIds.has(chapter.chapter_id);
                      return (
                        <Pressable
                          key={chapter.chapter_id}
                          style={styles.modalChapterRow}
                          onPress={() => toggleChapter(chapter.chapter_id)}
                        >
                          <Ionicons name={selected ? "checkbox" : "square-outline"} size={20} color={selected ? "#1D84E8" : "#9A9A9A"} />
                          <Text style={styles.modalChapterText}>Chapter {chapter.sequence_no}: {chapter.title}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ))
              )}
            </ScrollView>
            <Pressable style={styles.modalDone} onPress={() => setChapterModalOpen(false)}>
              <Text style={styles.modalDoneText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={timePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setTimePickerOpen(false);
          setTimeTarget(null);
        }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => {
            setTimePickerOpen(false);
            setTimeTarget(null);
          }}
        >
          <Pressable style={styles.timeModalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Select Time</Text>
            <View style={styles.timePickerRow}>
              <View style={styles.timePickerCol}>
                <Picker selectedValue={pickerHour} onValueChange={(v) => setPickerHour(Number(v))}>
                  {Array.from({ length: 12 }).map((_, i) => {
                    const hour = i + 1;
                    return <Picker.Item key={hour} label={`${hour}`} value={hour} />;
                  })}
                </Picker>
              </View>
              <View style={styles.timePickerCol}>
                <Picker selectedValue={pickerMinute} onValueChange={(v) => setPickerMinute(Number(v))}>
                  {[0, 15, 30, 45].map((minute) => (
                    <Picker.Item key={minute} label={String(minute).padStart(2, "0")} value={minute} />
                  ))}
                </Picker>
              </View>
              <View style={styles.timePickerCol}>
                <Picker selectedValue={pickerMeridiem} onValueChange={(v) => setPickerMeridiem(v as "AM" | "PM")}>
                  <Picker.Item label="AM" value="AM" />
                  <Picker.Item label="PM" value="PM" />
                </Picker>
              </View>
            </View>
            <Pressable style={styles.modalDone} onPress={applyPickedTime}>
              <Text style={styles.modalDoneText}>Set Time</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  pageTitle: { ...Typography.h1 },
  sectionTitle: { ...Typography.h2 },
  row3: { flexDirection: "row", gap: 8 },
  row2: { flexDirection: "row", gap: 8 },
  boxField: {
    flex: 1,
    minHeight: 48,
    borderRadius: Radius.sm,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 10,
  },
  fieldText: {
    ...Typography.body,
    color: "#A7A7A7",
    textAlign: "center",
    width: "100%",
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
    borderColor: "#D3D3D3",
    borderRadius: Radius.round,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  dateInput: {
    ...Typography.caption,
    textAlign: "center",
    color: "#7C7C7C",
    paddingVertical: 0,
  },
  dropdown: {
    borderRadius: Radius.md,
    overflow: "hidden",
    backgroundColor: "#F7F7F7",
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#DFDFDF",
  },
  dropdownText: { ...Typography.body, color: "#6A6A6A" },
  scheduleBar: {
    minHeight: 48,
    borderRadius: Radius.sm,
    backgroundColor: "#888888",
    alignItems: "center",
    justifyContent: "center",
  },
  scheduleBarText: { ...Typography.h2, color: "#FFFFFF", fontWeight: "500" },
  dayChipRow: { flexDirection: "row", gap: 8 },
  dayChip: {
    flex: 1,
    minHeight: 46,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: "#D1D1D1",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F5F5F5",
  },
  dayChipActive: { backgroundColor: "#D6D6D6", borderColor: "#D6D6D6" },
  dayChipText: { ...Typography.h3, color: "#B0B0B0", fontWeight: "500" },
  scheduleCard: {
    backgroundColor: "#F7F7F7",
    borderRadius: Radius.md,
    padding: 10,
    gap: 8,
  },
  scheduleCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  scheduleActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  dayLabel: { ...Typography.body, color: "#7A7A7A", fontWeight: "600" },
  slotStack: { gap: 8 },
  slotStackCentered: { alignItems: "center" },
  timeSlotBlue: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#5B98E8",
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    minHeight: 52,
    alignSelf: "stretch",
  },
  timeSlotSingle: {
    width: "78%",
    alignSelf: "center",
  },
  timeSlotRed: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#E49A9A",
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    minHeight: 52,
    alignSelf: "stretch",
  },
  timeInputButton: {
    ...Typography.caption,
    borderWidth: 1,
    borderColor: "#D2D2D2",
    borderRadius: Radius.round,
    minHeight: 34,
    minWidth: 92,
    paddingHorizontal: 8,
    backgroundColor: "#F4F4F4",
    alignItems: "center",
    justifyContent: "center",
  },
  timeInputText: { ...Typography.caption, color: "#7C7C7C" },
  toText: { ...Typography.caption, color: "#808080", marginHorizontal: 4 },
  secondSlotWrap: { gap: 5 },
  andText: { ...Typography.caption, color: "#6F6F6F", textAlign: "center" },
  iconAction: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  plusText: { ...Typography.h2, color: "#A8A8A8", fontWeight: "600" },
  roomToggle: {
    minHeight: 42,
    borderRadius: Radius.sm,
    backgroundColor: "#EFEFEF",
    alignItems: "center",
    justifyContent: "center",
  },
  roomToggleText: { ...Typography.body, color: "#7D7D7D" },
  roomMenu: {
    borderRadius: Radius.sm,
    overflow: "hidden",
    backgroundColor: "#EFEFEF",
  },
  roomItem: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EFEFEF",
  },
  roomItemActive: { backgroundColor: "#F6F6F6" },
  roomItemText: { ...Typography.body, color: "#7D7D7D" },
  divider: {
    height: 1,
    backgroundColor: "#D0D0D0",
    marginTop: 4,
    marginBottom: 6,
  },
  requirementPill: {
    flex: 1,
    minHeight: 74,
    borderRadius: Radius.sm,
    alignItems: "stretch",
    justifyContent: "center",
    backgroundColor: "#F5F5F5",
    borderWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  requirementPillActive: {
    borderWidth: 2,
    borderColor: "#1D84E8",
  },
  requirementToggle: { alignItems: "center", justifyContent: "center", paddingBottom: 4 },
  requirementText: {
    ...Typography.body,
    color: "#B0B0B0",
    fontWeight: "500",
    textAlign: "center",
  },
  requirementCountInput: {
    ...Typography.body,
    color: "#6C6C6C",
    textAlign: "center",
    minHeight: 32,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: "#D8D8D8",
    backgroundColor: "#FAFAFA",
  },
  extraBox: {
    minHeight: 170,
    borderRadius: Radius.sm,
    backgroundColor: "#F5F5F5",
    paddingHorizontal: 10,
    paddingVertical: 10,
    ...Typography.body,
    color: "#A8A8A8",
    textAlignVertical: "top",
    fontStyle: "italic",
    fontWeight: "400",
  },
  specialRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  specialDatePill: {
    width: "42%",
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#D1D1D1",
    borderRadius: Radius.round,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  specialReasonBox: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.sm,
    backgroundColor: "#F5F5F5",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  reasonInput: {
    ...Typography.h2,
    color: "#A8A8A8",
    textAlign: "center",
    fontWeight: "400",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: Radius.lg,
    maxHeight: "80%",
    padding: 14,
  },
  modalTitle: { ...Typography.h2, color: "#111827", marginBottom: 8 },
  modalScroll: { maxHeight: 420 },
  modalEmpty: { ...Typography.body, color: "#777" },
  modalGroup: { marginBottom: 12, gap: 8 },
  modalGroupTitle: { ...Typography.body, color: "#454545", fontWeight: "600" },
  modalChapterRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  modalChapterText: { ...Typography.body, color: "#5D5D5D", flex: 1 },
  modalDone: {
    marginTop: 8,
    minHeight: 42,
    borderRadius: Radius.md,
    backgroundColor: "#868686",
    alignItems: "center",
    justifyContent: "center",
  },
  modalDoneText: { ...Typography.h3, color: "#fff" },
  timeModalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: Radius.lg,
    padding: 14,
  },
  timePickerRow: { flexDirection: "row", gap: 8 },
  timePickerCol: { flex: 1, minHeight: 160, justifyContent: "center" },
});
