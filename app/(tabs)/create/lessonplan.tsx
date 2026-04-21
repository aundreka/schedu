import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { router, useLocalSearchParams } from "expo-router";
import { buildBlocks } from "../../../algorithm/buildBlocks";
import {
  complexityScoreToDifficulty,
  complexityScoreToEstimatedMinutes,
  deriveLessonComplexityScore,
} from "../../../algorithm/buildPacingPlan";
import { buildSlots, type RawMeetingSchedule } from "../../../algorithm/buildSlots";
import type { TeacherRules, TOCUnit } from "../../../algorithm/types";
import { Radius, Spacing, Typography } from "../../../constants/fonts";
import { useAppTheme } from "../../../context/theme";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import type { PlanBlockRow, PlanSlotRow } from "../../../lib/planning";
import { emitLessonPlanRefresh } from "../../../lib/lesson-plan-refresh";
import { supabase } from "../../../lib/supabase";

type AcademicTerm = "quarter" | "trimester" | "semester";
type RequirementKey = "written_work" | "performance_task" | "exam";
type WeekdayName = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";
type RoomType = "lecture" | "laboratory";

type InstitutionItem = {
  school_id: string;
  name: string;
};

type SubjectItem = {
  subject_id: string;
  school_id: string;
  code: string;
  title: string;
  academic_year: string | null;
  description: string | null;
  syllabus: string | null;
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
  lessons: LessonOption[];
};

type LessonOption = {
  lesson_id: string;
  chapter_id: string;
  title: string;
  sequence_no: number;
  content: string | null;
  learning_objectives: string | null;
  estimated_minutes: number | null;
  complexity_score: number | null;
};

type UnitGroup = {
  key: string;
  title: string;
  chapters: ChapterOption[];
};

type ClassInstance = {
  id: string;
  room: RoomType;
  start: string;
  end: string;
};

type DaySchedule = {
  instances: ClassInstance[];
};

type SpecialDate = {
  id: string;
  dateText: string;
  reason: string;
};

type ExamSchedule = {
  id: string;
  dateText: string;
};

type TimeTarget = {
  day: WeekdayName;
  instanceId: string;
  field: "start" | "end";
};

type DateTarget =
  | { type: "duration"; field: "start" | "end" }
  | { type: "special"; id: string }
  | { type: "exam"; id: string };

type DuplicatedPlanRow = {
  lesson_plan_id: string;
  title: string;
  academic_year: string | null;
  term: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  school_id: string;
  subject_id: string;
  section_id: string;
};

type DuplicatedSlotRow = Pick<
  PlanSlotRow,
  "series_key" | "weekday" | "start_time" | "end_time" | "meeting_type" | "room" | "slot_number"
>;

type DuplicatedBlockRow = Pick<
  PlanBlockRow,
  "session_category" | "slot_id" | "metadata"
>;

type DuplicatedContentRow = {
  content_level: string | null;
  chapter_id: string | null;
  lesson_id: string | null;
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

const MONTH_LABELS = [
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
];

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

function buildAcademicYearFallback(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return `${start.getFullYear()}-${end.getFullYear()}`;
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

function hasValidTimeRange(startValue: string, endValue: string) {
  const start = toSqlTime(startValue);
  const end = toSqlTime(endValue);
  if (!start || !end) return false;
  return end > start;
}

function rangesOverlap(startA: string, endA: string, startB: string, endB: string) {
  return startA < endB && startB < endA;
}

type ScheduleConflict = {
  day: WeekdayName;
  start: string;
  end: string;
  message: string;
};

function collectDraftRecurringSlots(input: {
  activeDays: Set<WeekdayName>;
  daySchedules: Record<WeekdayName, DaySchedule>;
}) {
  return Array.from(input.activeDays)
    .flatMap((day) =>
      input.daySchedules[day].instances
        .map((instance) => {
          const start = toSqlTime(instance.start);
          const end = toSqlTime(instance.end);
          if (!start || !end || end <= start) return null;
          return {
            day,
            start,
            end,
            room: instance.room,
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
    )
    .sort((a, b) => {
      if (a.day !== b.day) return a.day.localeCompare(b.day);
      if (a.start !== b.start) return a.start.localeCompare(b.start);
      return a.end.localeCompare(b.end);
    });
}

function findDraftScheduleOverlap(slots: ReturnType<typeof collectDraftRecurringSlots>): ScheduleConflict | null {
  for (let index = 0; index < slots.length; index += 1) {
    const current = slots[index];
    for (let nextIndex = index + 1; nextIndex < slots.length; nextIndex += 1) {
      const other = slots[nextIndex];
      if (other.day !== current.day) break;
      if (!rangesOverlap(current.start, current.end, other.start, other.end)) continue;
      return {
        day: current.day,
        start: current.start,
        end: current.end,
        message: `The ${DAY_OPTIONS.find((item) => item.key === current.day)?.label ?? current.day} schedule has overlapping class times.`,
      };
    }
  }

  return null;
}

type ExistingRecurringClass = {
  lesson_plan_id: string;
  title: string;
  start_date: string;
  end_date: string;
  day: WeekdayName;
  start_time: string;
  end_time: string;
};

function findExistingScheduleOverlap(input: {
  slots: ReturnType<typeof collectDraftRecurringSlots>;
  existingRows: ExistingRecurringClass[];
  nextPlanStart: string;
  nextPlanEnd: string;
}): ScheduleConflict | null {
  for (const slot of input.slots) {
    for (const row of input.existingRows) {
      if (row.day !== slot.day) continue;
      if (row.end_date < input.nextPlanStart || row.start_date > input.nextPlanEnd) continue;
      if (!rangesOverlap(slot.start, slot.end, row.start_time, row.end_time)) continue;
      return {
        day: slot.day,
        start: slot.start,
        end: slot.end,
        message: `${DAY_OPTIONS.find((item) => item.key === slot.day)?.label ?? slot.day} ${slot.start.slice(0, 5)}-${slot.end.slice(0, 5)} conflicts with "${row.title}".`,
      };
    }
  }

  return null;
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

function sqlTimeToDisplay(value: string | null) {
  if (!value) return "8:00 AM";
  const match = value.match(/^(\d{2}):(\d{2})/);
  if (!match) return value;
  const hours24 = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours24) || !Number.isFinite(minutes)) return value;
  const meridiem: "AM" | "PM" = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return formatDisplayTime(hours12, minutes, meridiem);
}

function parseAcademicStartYear(value: string | null) {
  if (!value) return null;
  const match = value.match(/(\d{4})\D*(\d{4})?/);
  if (!match) return null;
  const first = Number(match[1]);
  if (!Number.isFinite(first)) return null;
  return first;
}

function formatAcademicYear(startYear: number) {
  return `${startYear}-${startYear + 1}`;
}

function formatIsoDisplay(value: string) {
  const [y, m, d] = value.split("-").map((p) => Number(p));
  if (!y || !m || !d) return value;
  return `${MONTH_LABELS[m - 1]} ${String(d).padStart(2, "0")}, ${y}`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function getExamDefinition(index: number, total: number) {
  if (total <= 1) {
    return { title: "Final Exam", subcategory: "final" as const, label: "Final Exam" };
  }

  if (total === 2) {
    return index === 0
      ? { title: "Midterm Exam", subcategory: "midterm" as const, label: "Midterm Exam" }
      : { title: "Final Exam", subcategory: "final" as const, label: "Final Exam" };
  }

  if (total === 3) {
    if (index === 0) return { title: "Prelim Exam", subcategory: "prelim" as const, label: "Prelim Exam" };
    if (index === 1) return { title: "Midterm Exam", subcategory: "midterm" as const, label: "Midterm Exam" };
    return { title: "Final Exam", subcategory: "final" as const, label: "Final Exam" };
  }

  return {
    title: `Exam ${index + 1}`,
    subcategory: index === 0 ? ("prelim" as const) : index === total - 1 ? ("final" as const) : ("midterm" as const),
    label: `Exam ${index + 1}`,
  };
}

function buildTocUnitsFromSelections(
  lessonPlanId: string,
  selectedLessons: { chapter: ChapterOption; lesson: LessonOption }[],
  selectedChapters: ChapterOption[]
): TOCUnit[] {
  if (selectedLessons.length > 0) {
    return selectedLessons.map(({ chapter, lesson }, index) => {
      const computedComplexity =
        lesson.complexity_score ??
        deriveLessonComplexityScore({
          title: lesson.title,
          content: lesson.content,
          learningObjectives: lesson.learning_objectives,
        });
      const estimatedMinutes = lesson.estimated_minutes ?? complexityScoreToEstimatedMinutes(computedComplexity);

      return {
        id: lesson.lesson_id,
        courseId: lessonPlanId,
        chapterId: chapter.chapter_id,
        chapterTitle: chapter.title,
        title: `Lesson ${index + 1}: ${lesson.title}`,
        order: index + 1,
        estimatedMinutes,
        difficulty: complexityScoreToDifficulty(computedComplexity),
        preferredSessionType: "lecture",
        required: true,
      };
    });
  }

  return selectedChapters.map((chapter, index) => ({
    id: chapter.chapter_id,
    courseId: lessonPlanId,
    chapterId: chapter.chapter_id,
    chapterTitle: chapter.title,
    title: `Lesson ${index + 1}: ${chapter.title}`,
    order: index + 1,
    estimatedMinutes: 60,
    difficulty: "medium",
    preferredSessionType: "lecture",
    required: true,
  }));
}

function buildTeacherRulesFromCounts(requirementCounts: Record<RequirementKey, string>): TeacherRules {
  return {
    quizMode: "hybrid",
    quizEveryNLessons: 3,
    writtenWorkMode: "total",
    writtenWorkTarget: Math.max(1, Number(requirementCounts.written_work || "1")),
    allowLessonWrittenWorkOverlay: true,
    preferLessonWrittenWorkOverlay: true,
    performanceTaskMin: Math.max(1, Number(requirementCounts.performance_task || "1")),
    includeReviewBeforeExam: Math.max(1, Number(requirementCounts.exam || "1")) > 0,
  };
}

function buildRecurringSchedules(
  activeDays: Set<WeekdayName>,
  daySchedules: Record<WeekdayName, DaySchedule>
): RawMeetingSchedule[] {
  return Array.from(activeDays).reduce<RawMeetingSchedule[]>((acc, day) => {
    daySchedules[day].instances.forEach((slot, index) => {
        const startTime = toSqlTime(slot.start);
        const endTime = toSqlTime(slot.end);
        if (!startTime || !endTime) return;
        acc.push({
          id: slot.id,
          slotNumber: index + 1,
          dayOfWeek: DAY_OPTIONS.findIndex((item) => item.key === day) + 1,
          startTime: startTime.slice(0, 5),
          endTime: endTime.slice(0, 5),
          sessionType: slot.room,
        });
    });
    return acc;
  }, []);
}

function makeInstance(room: RoomType = "lecture", start = "8:00 AM", end = "10:00 AM"): ClassInstance {
  return { id: makeId(), room, start, end };
}

function getRoomBorderColor(room: RoomType) {
  return room === "lecture" ? "#2D7BD8" : "#D9534F";
}

export default function LessonplanScreen() {
  const { colors: c } = useAppTheme();
  const createInFlightRef = useRef(false);
  const lastAutoPlanNameRef = useRef("");
  const hydratedDuplicateIdRef = useRef("");
  const params = useLocalSearchParams<{ duplicateFromPlanId?: string | string[] }>();
  const duplicateFromPlanId = useMemo(() => {
    const value = params.duplicateFromPlanId;
    return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
  }, [params.duplicateFromPlanId]);

  if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [subjectMenuOpen, setSubjectMenuOpen] = useState(false);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const [institutionMenuOpen, setInstitutionMenuOpen] = useState(false);
  const [chapterModalOpen, setChapterModalOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [timeTarget, setTimeTarget] = useState<TimeTarget | null>(null);
  const [dateTarget, setDateTarget] = useState<DateTarget | null>(null);
  const [pickerHour, setPickerHour] = useState(8);
  const [pickerMinute, setPickerMinute] = useState(0);
  const [pickerMeridiem, setPickerMeridiem] = useState<"AM" | "PM">("AM");

  const nowYear = new Date().getFullYear();
  const [datePickerYear, setDatePickerYear] = useState(nowYear);
  const [datePickerMonth, setDatePickerMonth] = useState(1);
  const [datePickerDay, setDatePickerDay] = useState(1);

  const [institutions, setInstitutions] = useState<InstitutionItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [sections, setSections] = useState<SectionItem[]>([]);
  const [chapters, setChapters] = useState<ChapterOption[]>([]);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());
  const [selectedLessonIds, setSelectedLessonIds] = useState<Set<string>>(new Set());

  const [planName, setPlanName] = useState("");
  const [term, setTerm] = useState<AcademicTerm>("quarter");
  const [academicYearStart, setAcademicYearStart] = useState(nowYear);
  const [startDate, setStartDate] = useState(`${nowYear}-06-05`);
  const [endDate, setEndDate] = useState(`${nowYear + 1}-04-02`);
  const [extraRequirements, setExtraRequirements] = useState("");
  const [requirementCounts, setRequirementCounts] = useState<Record<RequirementKey, string>>({
    written_work: "1",
    performance_task: "1",
    exam: "1",
  });

  const [activeDays, setActiveDays] = useState<Set<WeekdayName>>(new Set());
  const [daySchedules, setDaySchedules] = useState<Record<WeekdayName, DaySchedule>>({
    monday: {
      instances: [],
    },
    tuesday: {
      instances: [],
    },
    wednesday: {
      instances: [],
    },
    thursday: {
      instances: [],
    },
    friday: {
      instances: [],
    },
    saturday: {
      instances: [],
    },
  });

  const [specialDates, setSpecialDates] = useState<SpecialDate[]>([{ id: makeId(), dateText: "", reason: "" }]);
  const [examSchedules, setExamSchedules] = useState<ExamSchedule[]>([{ id: makeId(), dateText: "" }]);

  const selectedInstitution = useMemo(
    () => institutions.find((item) => item.school_id === selectedInstitutionId) ?? null,
    [institutions, selectedInstitutionId]
  );

  const selectedSubject = useMemo(
    () => subjects.find((item) => item.subject_id === selectedSubjectId) ?? null,
    [subjects, selectedSubjectId]
  );

  const selectedSection = useMemo(
    () => sections.find((item) => item.section_id === selectedSectionId) ?? null,
    [sections, selectedSectionId]
  );

  const autoPlanName = useMemo(() => {
    if (!selectedSubject || !selectedSection) return "";
    return `${selectedSubject.code} ${selectedSubject.title} - ${selectedSection.name} Lesson Plan`;
  }, [selectedSubject, selectedSection]);

  const selectableSubjects = useMemo(() => {
    if (!selectedInstitutionId) return subjects;
    return subjects.filter((item) => item.school_id === selectedInstitutionId);
  }, [subjects, selectedInstitutionId]);

  const selectableSections = useMemo(() => {
    if (!selectedInstitutionId) return sections;
    return sections.filter((item) => item.school_id === selectedInstitutionId);
  }, [sections, selectedInstitutionId]);

  const subjectPreview = useMemo(() => {
    if (!selectedSubject) return "";
    const source = selectedSubject.description?.trim() || selectedSubject.syllabus?.trim() || "";
    if (!source) return "No subject content available yet.";
    return source;
  }, [selectedSubject]);

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

  const selectedSubjectOutline = useMemo(() => {
    return unitGroups
      .map((group) => {
        const pickedChapters = group.chapters
          .map((chapter) => {
            const chapterPicked = selectedChapterIds.has(chapter.chapter_id);
            const pickedLessons = chapter.lessons.filter((lesson) => selectedLessonIds.has(lesson.lesson_id));
            if (!chapterPicked && pickedLessons.length === 0) return null;
            return {
              chapter,
              pickedLessons,
            };
          })
          .filter((row): row is NonNullable<typeof row> => Boolean(row));

        if (pickedChapters.length === 0) return null;
        return {
          group,
          pickedChapters,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [unitGroups, selectedChapterIds, selectedLessonIds]);

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
        .select("subject:subjects(subject_id, school_id, code, title, academic_year, description, syllabus)")
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
            description: subject?.description ? String(subject.description) : null,
            syllabus: subject?.syllabus ? String(subject.syllabus) : null,
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
      let mappedInstitutions: InstitutionItem[] = [];

      if (schoolIds.length > 0) {
        const [{ data: sectionRows, error: sectionsError }, { data: schoolRows, error: schoolRowsError }] = await Promise.all([
          supabase
            .from("sections")
            .select("section_id, school_id, name, grade_level")
            .in("school_id", schoolIds)
            .order("name", { ascending: true }),
          supabase.from("schools").select("school_id, name").in("school_id", schoolIds).order("name", { ascending: true }),
        ]);
        if (sectionsError) throw sectionsError;
        if (schoolRowsError) throw schoolRowsError;

        mappedSections = (sectionRows ?? []).map((row: any) => ({
          section_id: String(row.section_id),
          school_id: String(row.school_id),
          name: String(row.name),
          grade_level: row?.grade_level ? String(row.grade_level) : null,
        }));

        mappedInstitutions = (schoolRows ?? []).map((row: any) => ({
          school_id: String(row.school_id),
          name: String(row.name),
        }));
      }

      setSubjects(mappedSubjects);
      setSections(mappedSections);
      setInstitutions(mappedInstitutions);

      setSelectedInstitutionId((prev) => {
        if (prev && mappedInstitutions.some((s) => s.school_id === prev)) return prev;
        return mappedInstitutions[0]?.school_id ?? "";
      });
    } catch (err: any) {
      Alert.alert("Unable to load lesson plan form", err?.message ?? "Please try again.");
      setSubjects([]);
      setSections([]);
      setInstitutions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChapters = useCallback(async (subjectId: string, options?: { openModal?: boolean; autoSelectAll?: boolean }) => {
    if (!subjectId) {
      setChapters([]);
      setSelectedChapterIds(new Set());
      setSelectedLessonIds(new Set());
      return;
    }

    try {
      const { data, error } = await supabase
        .from("chapters")
        .select(
          "chapter_id, title, sequence_no, unit:units(unit_id, title, sequence_no), lessons(lesson_id, chapter_id, title, sequence_no, content, learning_objectives, estimated_minutes, complexity_score)"
        )
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
        lessons: (row?.lessons ?? [])
          .map((lesson: any) => ({
            lesson_id: String(lesson.lesson_id),
            chapter_id: String(lesson.chapter_id),
            title: String(lesson.title),
            sequence_no: Number(lesson.sequence_no ?? 0),
            content: lesson?.content ? String(lesson.content) : null,
            learning_objectives: lesson?.learning_objectives ? String(lesson.learning_objectives) : null,
            estimated_minutes:
              typeof lesson?.estimated_minutes === "number" ? Number(lesson.estimated_minutes) : null,
            complexity_score:
              typeof lesson?.complexity_score === "number" ? Number(lesson.complexity_score) : null,
          }))
          .sort((a: LessonOption, b: LessonOption) => a.sequence_no - b.sequence_no),
      }));

      setChapters(mapped);
      if (options?.autoSelectAll ?? true) {
        setSelectedChapterIds(new Set(mapped.map((item) => item.chapter_id)));
        setSelectedLessonIds(new Set(mapped.flatMap((item) => item.lessons.map((lesson) => lesson.lesson_id))));
      }
      if (options?.openModal ?? true) {
        setChapterModalOpen(true);
      }
    } catch (err: any) {
      Alert.alert("Unable to load units/chapters", err?.message ?? "Please try again.");
      setChapters([]);
      setSelectedChapterIds(new Set());
      setSelectedLessonIds(new Set());
    }
  }, []);

  useEffect(() => {
    loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (loading || !duplicateFromPlanId || hydratedDuplicateIdRef.current === duplicateFromPlanId) {
      return;
    }

    let cancelled = false;

    const hydrateDuplicate = async () => {
      try {
        const [{ data: planRow, error: planError }, { data: slotRows, error: slotsError }, { data: blockRows, error: blocksError }, { data: contentRows, error: contentError }] =
          await Promise.all([
            supabase
              .from("lesson_plans")
              .select("lesson_plan_id, title, academic_year, term, start_date, end_date, notes, school_id, subject_id, section_id")
              .eq("lesson_plan_id", duplicateFromPlanId)
              .maybeSingle(),
            supabase
              .from("slots")
              .select("series_key, weekday, start_time, end_time, meeting_type, room, slot_number")
              .eq("lesson_plan_id", duplicateFromPlanId),
            supabase
              .from("blocks")
              .select("session_category, slot_id, metadata")
              .eq("lesson_plan_id", duplicateFromPlanId),
            supabase
              .from("plan_subject_content")
              .select("content_level, chapter_id, lesson_id")
              .eq("lesson_plan_id", duplicateFromPlanId),
          ]);

        if (planError) throw planError;
        if (slotsError) throw slotsError;
        if (blocksError) throw blocksError;
        if (contentError) throw contentError;
        if (!planRow) throw new Error("The source lesson plan could not be found.");

        const sourcePlan = planRow as DuplicatedPlanRow;
        const institutionExists = institutions.some((item) => item.school_id === sourcePlan.school_id);
        const subjectExists = subjects.some((item) => item.subject_id === sourcePlan.subject_id);
        const sectionExists = sections.some((item) => item.section_id === sourcePlan.section_id);

        if (!institutionExists || !subjectExists || !sectionExists) {
          throw new Error("Some source plan references are no longer available in your account.");
        }

        const sourceSlots = (slotRows ?? []) as DuplicatedSlotRow[];
        const sourceBlocks = (blockRows ?? []) as DuplicatedBlockRow[];
        const sourceContent = (contentRows ?? []) as DuplicatedContentRow[];

        const nextDaySchedules: Record<WeekdayName, DaySchedule> = {
          monday: { instances: [] },
          tuesday: { instances: [] },
          wednesday: { instances: [] },
          thursday: { instances: [] },
          friday: { instances: [] },
          saturday: { instances: [] },
        };

        const seenSeriesKeys = new Set<string>();
        for (const row of sourceSlots) {
          const dayKey = String(row.weekday ?? "").toLowerCase();
          const seriesKey = String(row.series_key ?? "");
          if (!DAY_OPTIONS.some((day) => day.key === dayKey)) continue;
          if (seriesKey && seenSeriesKeys.has(seriesKey)) continue;
          if (seriesKey) seenSeriesKeys.add(seriesKey);

          const normalizedDay = dayKey as WeekdayName;
          const room = row.room === "laboratory" || row.meeting_type === "laboratory" ? "laboratory" : "lecture";
          nextDaySchedules[normalizedDay].instances.push({
            id: makeId(),
            room,
            start: sqlTimeToDisplay(row.start_time),
            end: sqlTimeToDisplay(row.end_time),
          });
        }

        for (const day of DAY_OPTIONS) {
          nextDaySchedules[day.key].instances.sort((a, b) => {
            const startCompare = (toSqlTime(a.start) ?? "").localeCompare(toSqlTime(b.start) ?? "");
            if (startCompare !== 0) return startCompare;
            return (toSqlTime(a.end) ?? "").localeCompare(toSqlTime(b.end) ?? "");
          });
        }

        const selectedDays = new Set(
          DAY_OPTIONS.filter((day) => nextDaySchedules[day.key].instances.length > 0).map((day) => day.key)
        );

        const writtenWorkCount = sourceBlocks.filter((row) => row.session_category === "written_work").length;
        const performanceTaskCount = sourceBlocks.filter((row) => row.session_category === "performance_task").length;
        const examRows = sourceBlocks
          .filter((row) => row.session_category === "exam")
          .map((row) => ({
            scheduled_date:
              typeof row.metadata?.preferredDate === "string"
                ? String(row.metadata.preferredDate)
                : null,
          }))
          .sort((a, b) => (a.scheduled_date ?? "9999-99-99").localeCompare(b.scheduled_date ?? "9999-99-99"));

        const chapterIds = new Set(
          sourceContent
            .filter((row) => row.content_level === "chapter" && row.chapter_id)
            .map((row) => String(row.chapter_id))
        );
        const lessonIds = new Set(
          sourceContent
            .filter((row) => row.content_level === "lesson" && row.lesson_id)
            .map((row) => String(row.lesson_id))
        );

        await loadChapters(sourcePlan.subject_id, { openModal: false, autoSelectAll: false });
        if (cancelled) return;

        setSelectedInstitutionId(sourcePlan.school_id);
        setSelectedSubjectId(sourcePlan.subject_id);
        setSelectedSectionId(sourcePlan.section_id);
        setPlanName(`${sourcePlan.title} Copy`);
        lastAutoPlanNameRef.current = "";
        setTerm((sourcePlan.term === "quarter" || sourcePlan.term === "trimester" || sourcePlan.term === "semester")
          ? sourcePlan.term
          : "quarter");
        setAcademicYearStart(parseAcademicStartYear(sourcePlan.academic_year) ?? new Date(`${sourcePlan.start_date}T00:00:00`).getFullYear());
        setStartDate(sourcePlan.start_date);
        setEndDate(sourcePlan.end_date);
        setExtraRequirements(sourcePlan.notes ?? "");
        setRequirementCounts({
          written_work: String(Math.max(1, writtenWorkCount || 1)),
          performance_task: String(Math.max(1, performanceTaskCount || 1)),
          exam: String(Math.max(1, examRows.length || 1)),
        });
        setActiveDays(selectedDays);
        setDaySchedules(nextDaySchedules);
        setSelectedChapterIds(chapterIds);
        setSelectedLessonIds(lessonIds);
        setExamSchedules(
          examRows.length > 0
            ? examRows.map((row) => ({ id: makeId(), dateText: row.scheduled_date ?? "" }))
            : [{ id: makeId(), dateText: "" }]
        );
        setSpecialDates([{ id: makeId(), dateText: "", reason: "" }]);
        hydratedDuplicateIdRef.current = duplicateFromPlanId;
      } catch (err: any) {
        if (cancelled) return;
        Alert.alert("Could not duplicate lesson plan", err?.message ?? "Please try again.");
      }
    };

    void hydrateDuplicate();

    return () => {
      cancelled = true;
    };
  }, [duplicateFromPlanId, institutions, loadChapters, loading, sections, subjects]);

  useEffect(() => {
    if (!autoPlanName) return;
    setPlanName((prev) => {
      const current = prev.trim();
      if (!current || prev === lastAutoPlanNameRef.current) {
        lastAutoPlanNameRef.current = autoPlanName;
        return autoPlanName;
      }
      return prev;
    });
  }, [autoPlanName]);

  useEffect(() => {
    const examCount = Math.max(1, Number(requirementCounts.exam || "1"));
    setExamSchedules((prev) => {
      if (prev.length === examCount) return prev;

      return Array.from({ length: examCount }, (_, index) => prev[index] ?? { id: makeId(), dateText: "" });
    });
  }, [requirementCounts.exam]);

  const { refreshing, onRefresh } = usePullToRefresh(loadBase);
  const animateIn = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

  const toggleDay = (day: WeekdayName) => {
    animateIn();
    setActiveDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const setInstanceField = (day: WeekdayName, instanceId: string, field: "start" | "end", value: string) => {
    setDaySchedules((prev) => ({
      ...prev,
      [day]: {
        instances: prev[day].instances.map((item) => (item.id === instanceId ? { ...item, [field]: value } : item)),
      },
    }));
  };

  const setInstanceRoom = (day: WeekdayName, instanceId: string, room: RoomType) => {
    animateIn();
    setDaySchedules((prev) => ({
      ...prev,
      [day]: {
        instances: prev[day].instances.map((item) => (item.id === instanceId ? { ...item, room } : item)),
      },
    }));
  };

  const addInstance = (day: WeekdayName) => {
    animateIn();
    setDaySchedules((prev) => {
      const current = prev[day];
      return {
        ...prev,
        [day]: {
          instances: [...current.instances, makeInstance(current.instances.length % 2 === 0 ? "lecture" : "laboratory", "1:00 PM", "3:00 PM")],
        },
      };
    });
  };

  const removeInstance = (day: WeekdayName, instanceId: string) => {
    animateIn();
    setDaySchedules((prev) => {
      const remaining = prev[day].instances.filter((item) => item.id !== instanceId);
      return {
        ...prev,
        [day]: {
          instances: remaining.length > 0 ? remaining : [makeInstance()],
        },
      };
    });
  };

  const duplicateInstance = (day: WeekdayName, instanceId: string) => {
    animateIn();
    setDaySchedules((prev) => {
      const current = prev[day];
      const index = current.instances.findIndex((item) => item.id === instanceId);
      if (index === -1) return prev;

      const source = current.instances[index];
      const duplicated: ClassInstance = {
        ...source,
        id: makeId(),
      };

      const nextInstances = [...current.instances];
      nextInstances.splice(index + 1, 0, duplicated);

      return {
        ...prev,
        [day]: {
          instances: nextInstances,
        },
      };
    });
  };

  const openTimePicker = (target: TimeTarget) => {
    const schedule = daySchedules[target.day];
    const instance = schedule.instances.find((row) => row.id === target.instanceId);
    if (!instance) return;

    const current = parseDisplayTime(instance[target.field]);
    setPickerHour(current.hour);
    setPickerMinute(current.minute);
    setPickerMeridiem(current.meridiem);
    setTimeTarget(target);
    setTimePickerOpen(true);
  };

  const applyPickedTime = () => {
    if (!timeTarget) return;
    const value = formatDisplayTime(pickerHour, pickerMinute, pickerMeridiem);
    setInstanceField(timeTarget.day, timeTarget.instanceId, timeTarget.field, value);
    setTimePickerOpen(false);
    setTimeTarget(null);
  };

  const setRequirementCount = (key: RequirementKey, value: string) => {
    const sanitized = value.replace(/[^0-9]/g, "");
    setRequirementCounts((prev) => ({ ...prev, [key]: sanitized }));
  };

  const toggleChapter = (chapterId: string) => {
    animateIn();
    const chapter = chapters.find((row) => row.chapter_id === chapterId);
    setSelectedChapterIds((prev) => {
      const next = new Set(prev);
      const chapterWillBeSelected = !next.has(chapterId);
      if (chapterWillBeSelected) next.add(chapterId);
      else next.delete(chapterId);

      if (chapter) {
        setSelectedLessonIds((lessonPrev) => {
          const lessonNext = new Set(lessonPrev);
          for (const lesson of chapter.lessons) {
            if (chapterWillBeSelected) lessonNext.add(lesson.lesson_id);
            else lessonNext.delete(lesson.lesson_id);
          }
          return lessonNext;
        });
      }

      return next;
    });
  };

  const toggleLesson = (chapterId: string, lessonId: string) => {
    animateIn();
    const chapter = chapters.find((row) => row.chapter_id === chapterId);
    if (!chapter) return;

    setSelectedLessonIds((prev) => {
      const next = new Set(prev);
      if (next.has(lessonId)) next.delete(lessonId);
      else next.add(lessonId);

      setSelectedChapterIds((chapterPrev) => {
        const chapterNext = new Set(chapterPrev);
        const hasAnySelectedLesson = chapter.lessons.some((row) => next.has(row.lesson_id));
        if (hasAnySelectedLesson) chapterNext.add(chapterId);
        else chapterNext.delete(chapterId);
        return chapterNext;
      });

      return next;
    });
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/create");
  };

  const addSpecialDateRow = () => {
    animateIn();
    setSpecialDates((prev) => [...prev, { id: makeId(), dateText: "", reason: "" }]);
  };

  const setSpecialDateField = (id: string, field: "dateText" | "reason", value: string) => {
    setSpecialDates((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const setExamScheduleField = (id: string, value: string) => {
    setExamSchedules((prev) => prev.map((row) => (row.id === id ? { ...row, dateText: value } : row)));
  };

  const removeSpecialDateRow = (id: string) => {
    animateIn();
    setSpecialDates((prev) => prev.filter((row) => row.id !== id));
  };

  const openDatePicker = (target: DateTarget, currentValue: string) => {
    const normalized = normalizeDateInput(currentValue);
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? new Date(`${normalized}T00:00:00`) : new Date();
    const safe = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

    setDatePickerYear(safe.getFullYear());
    setDatePickerMonth(safe.getMonth() + 1);
    setDatePickerDay(safe.getDate());
    setDateTarget(target);
    setDatePickerOpen(true);
  };

  const applyPickedDate = () => {
    if (!dateTarget) return;
    const daysInMonth = getDaysInMonth(datePickerYear, datePickerMonth);
    const safeDay = Math.min(datePickerDay, daysInMonth);
    const iso = `${datePickerYear}-${String(datePickerMonth).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;

    if (dateTarget.type === "duration") {
      if (dateTarget.field === "start") setStartDate(iso);
      if (dateTarget.field === "end") setEndDate(iso);
    } else if (dateTarget.type === "exam") {
      setExamScheduleField(dateTarget.id, iso);
    } else {
      setSpecialDateField(dateTarget.id, "dateText", iso);
    }

    setDatePickerOpen(false);
    setDateTarget(null);
  };

  const handlePickInstitution = (schoolId: string) => {
    setSelectedInstitutionId(schoolId);
    setInstitutionMenuOpen(false);

    if (selectedSubject && selectedSubject.school_id !== schoolId) {
      setSelectedSubjectId("");
      setChapters([]);
      setSelectedChapterIds(new Set());
      setSelectedLessonIds(new Set());
    }
    if (selectedSection && selectedSection.school_id !== schoolId) {
      setSelectedSectionId("");
    }
  };

  const handlePickSubject = async (subjectId: string) => {
    setSelectedSubjectId(subjectId);
    setSubjectMenuOpen(false);

    const subject = subjects.find((item) => item.subject_id === subjectId);
    if (subject?.school_id) setSelectedInstitutionId(subject.school_id);

    const parsedYear = parseAcademicStartYear(subject?.academic_year ?? null);
    if (parsedYear) setAcademicYearStart(parsedYear);

    await loadChapters(subjectId);
  };

  const requirementKeys = Object.keys(REQUIREMENT_LABEL) as RequirementKey[];
  const hasRequirementCounts = requirementKeys.every((key) => {
    const parsed = Number(requirementCounts[key] || "0");
    return Number.isFinite(parsed) && parsed > 0;
  });

  const hasValidSchedule = activeDays.size > 0 && Array.from(activeDays).every((day) => {
    const schedule = daySchedules[day];
    return schedule.instances.length > 0 && schedule.instances.every((instance) => hasValidTimeRange(instance.start, instance.end));
  });

  const hasSelectedSubjectContent = selectedLessonIds.size > 0;

  const handleCreatePlan = async () => {
    if (createInFlightRef.current || saving) {
      return;
    }
    if (!selectedInstitution) {
      Alert.alert("Institution required", "Select an institution first.");
      return;
    }
    if (!selectedSubject) {
      Alert.alert("Subject required", "Select a subject first.");
      return;
    }
    if (!selectedSection) {
      Alert.alert("Section required", "Select a section first.");
      return;
    }
    if (!planName.trim()) {
      Alert.alert("Plan name required", "Enter a name for this lesson plan.");
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
    if (!hasValidSchedule) {
      Alert.alert("Schedule required", "Set valid class times for each selected day, with end time after start time.");
      return;
    }

    const draftRecurringSlots = collectDraftRecurringSlots({ activeDays, daySchedules });
    const draftConflict = findDraftScheduleOverlap(draftRecurringSlots);
    if (draftConflict) {
      Alert.alert("Schedule conflict", draftConflict.message);
      return;
    }

    if (!hasRequirementCounts) {
      Alert.alert("Requirements required", "Fill in Written Work, Performance Task, and Exam counts.");
      return;
    }
    if (!hasSelectedSubjectContent) {
      Alert.alert("Subject content required", "Select at least one lesson from the subject content picker.");
      return;
    }

    createInFlightRef.current = true;
    setSaving(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("No signed-in user found.");

      const { data: overlappingPlans, error: overlappingPlansError } = await supabase
        .from("lesson_plans")
        .select("lesson_plan_id, title, start_date, end_date")
        .eq("user_id", user.id)
        .lte("start_date", normalizedEnd)
        .gte("end_date", normalizedStart);
      if (overlappingPlansError) throw overlappingPlansError;

      const overlappingPlanIds = (overlappingPlans ?? []).map((row: any) => String(row.lesson_plan_id)).filter(Boolean);
      if (overlappingPlanIds.length > 0) {
        const titleByPlanId = new Map(
          (overlappingPlans ?? []).map((row: any) => [
            String(row.lesson_plan_id),
            {
              title: String(row.title ?? "Untitled Plan"),
              start_date: String(row.start_date),
              end_date: String(row.end_date),
            },
          ])
        );

        const { data: existingSlots, error: existingSlotsError } = await supabase
          .from("slots")
          .select("lesson_plan_id, weekday, start_time, end_time, series_key")
          .in("lesson_plan_id", overlappingPlanIds);
        if (existingSlotsError) throw existingSlotsError;

        const seenExistingSeries = new Set<string>();
        const existingRecurringRows: ExistingRecurringClass[] = (existingSlots ?? [])
          .map((row: any) => {
            const planId = String(row.lesson_plan_id ?? "");
            const meta = titleByPlanId.get(planId);
            const day = row?.weekday ? String(row.weekday).toLowerCase() : "";
            const start = row?.start_time ? String(row.start_time) : "";
            const end = row?.end_time ? String(row.end_time) : "";
            const seriesKey = String(row?.series_key ?? `${planId}_${day}_${start}_${end}`);
            if (
              !meta ||
              !DAY_OPTIONS.some((item) => item.key === day) ||
              !start ||
              !end
            ) {
              return null;
            }
            if (seenExistingSeries.has(seriesKey)) return null;
            seenExistingSeries.add(seriesKey);

            return {
              lesson_plan_id: planId,
              title: meta.title,
              start_date: meta.start_date,
              end_date: meta.end_date,
              day: day as WeekdayName,
              start_time: start,
              end_time: end,
            };
          })
          .filter((row: ExistingRecurringClass | null): row is ExistingRecurringClass => Boolean(row));

        const existingConflict = findExistingScheduleOverlap({
          slots: draftRecurringSlots,
          existingRows: existingRecurringRows,
          nextPlanStart: normalizedStart,
          nextPlanEnd: normalizedEnd,
        });
        if (existingConflict) {
          Alert.alert("Schedule conflict", existingConflict.message);
          return;
        }
      }

      const title = planName.trim();
      const yearText = formatAcademicYear(academicYearStart).trim() || buildAcademicYearFallback(normalizedStart, normalizedEnd);

      const { data: planRow, error: planError } = await supabase
        .from("lesson_plans")
        .insert({
          user_id: user.id,
          school_id: selectedInstitution.school_id,
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

      const selectedLessons = chapters
        .flatMap((chapter) =>
          chapter.lessons
            .filter((lesson) => selectedLessonIds.has(lesson.lesson_id))
            .map((lesson) => ({ chapter, lesson }))
        )
        .sort((a, b) => {
          if (a.chapter.sequence_no !== b.chapter.sequence_no) {
            return a.chapter.sequence_no - b.chapter.sequence_no;
          }
          return a.lesson.sequence_no - b.lesson.sequence_no;
        });

      const recurringSchedules = buildRecurringSchedules(activeDays, daySchedules);
      const generatedSlots = buildSlots({
        courseId: lessonPlanId,
        startDate: normalizedStart,
        endDate: normalizedEnd,
        rawMeetingSchedules: recurringSchedules,
      });

      const slotRows = generatedSlots.map((slot) => {
        const sourceSchedule = recurringSchedules.find(
          (candidate) =>
            candidate.dayOfWeek === new Date(`${slot.date}T00:00:00`).getDay() &&
            candidate.startTime === slot.startTime &&
            candidate.endTime === slot.endTime &&
            candidate.sessionType === slot.sessionType
        );
        const seriesKey = sourceSchedule?.id ?? `${slot.date}_${slot.startTime}_${slot.endTime}`;
        const weekday = DAY_OPTIONS.find((day) => {
          const dayIndex = DAY_OPTIONS.findIndex((item) => item.key === day.key) + 1;
          return dayIndex === new Date(`${slot.date}T00:00:00`).getDay();
        })?.key ?? "monday";

        return {
          slot_id: slot.id,
          lesson_plan_id: lessonPlanId,
          title: null,
          slot_date: slot.date,
          weekday,
          start_time: `${slot.startTime}:00`,
          end_time: `${slot.endTime}:00`,
          meeting_type: slot.sessionType === "lecture" || slot.sessionType === "laboratory" ? slot.sessionType : null,
          room: slot.sessionType === "lecture" || slot.sessionType === "laboratory" ? slot.sessionType : null,
          slot_number: sourceSchedule?.slotNumber ?? 1,
          series_key: seriesKey,
          is_locked: false,
        };
      });

      if (slotRows.length > 0) {
        const { error: slotsError } = await supabase.from("slots").insert(slotRows);
        if (slotsError) throw slotsError;
      }

      const tocUnits = buildTocUnitsFromSelections(lessonPlanId, selectedLessons, selectedChapters);
      const teacherRules = buildTeacherRulesFromCounts(requirementCounts);
      const examTemplates = examSchedules.map((row, index) => {
        const examDefinition = getExamDefinition(index, examSchedules.length);
        const normalizedExamDate = normalizeDateInput(row.dateText);
        return {
          id: `exam_template_${index + 1}`,
          title: examDefinition.title,
          estimatedMinutes: 90,
          subcategory: examDefinition.subcategory,
          preferredDate: /^\d{4}-\d{2}-\d{2}$/.test(normalizedExamDate) ? normalizedExamDate : null,
          required: true,
        };
      });

      const generatedBlocks = buildBlocks({
        courseId: lessonPlanId,
        tocUnits,
        teacherRules,
        examBlockTemplates: examTemplates,
      });

      const lessonDetailsById = new Map(
        selectedLessons.map(({ chapter, lesson }) => [
          lesson.lesson_id,
          {
            lessonId: lesson.lesson_id,
            description:
              lesson.learning_objectives || lesson.content ||
              (chapter.unit_title ? `${chapter.unit_title} • Chapter ${chapter.sequence_no}` : `Chapter ${chapter.sequence_no}`),
          },
        ])
      );

      const blockRows = generatedBlocks.map((block) => {
        const lessonDetails =
          typeof block.sourceTocId === "string" ? lessonDetailsById.get(block.sourceTocId) ?? null : null;
        return {
          lesson_plan_id: lessonPlanId,
          slot_id: null,
          root_block_id: null,
          lesson_id: lessonDetails?.lessonId ?? null,
          algorithm_block_key: block.id,
          block_key: block.id,
          title: block.title,
          description: lessonDetails?.description ?? null,
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
          order_no: 1,
          is_locked: false,
          ww_subtype: block.type === "written_work" ? block.subcategory : null,
          pt_subtype: block.type === "performance_task" ? block.subcategory : null,
          metadata: block.metadata ?? {},
        };
      });

      if (blockRows.length > 0) {
        const { error: blocksError } = await supabase.from("blocks").insert(blockRows);
        if (blocksError) throw blocksError;
      }

      const subjectContentRows = selectedSubjectOutline
        .flatMap((unitGroup, unitIndex) => {
          const rows: any[] = [];
          rows.push({
            lesson_plan_id: lessonPlanId,
            subject_id: selectedSubject.subject_id,
            unit_id: unitGroup.group.key !== "ungrouped" ? unitGroup.group.key : null,
            content_level: "unit",
            sequence_no: unitIndex + 1,
            selected_title: unitGroup.group.title,
            selected_content: null,
          });

          unitGroup.pickedChapters.forEach((row, chapterIndex) => {
            rows.push({
              lesson_plan_id: lessonPlanId,
              subject_id: selectedSubject.subject_id,
              unit_id: row.chapter.unit_id,
              chapter_id: row.chapter.chapter_id,
              content_level: "chapter",
              sequence_no: chapterIndex + 1,
              selected_title: `Chapter ${row.chapter.sequence_no}: ${row.chapter.title}`,
              selected_content: null,
            });

            row.pickedLessons.forEach((lesson, lessonIndex) => {
              rows.push({
                lesson_plan_id: lessonPlanId,
                subject_id: selectedSubject.subject_id,
                unit_id: row.chapter.unit_id,
                chapter_id: row.chapter.chapter_id,
                lesson_id: lesson.lesson_id,
                content_level: "lesson",
                sequence_no: lessonIndex + 1,
                selected_title: lesson.title,
                selected_content: lesson.content ?? null,
                learning_objectives: lesson.learning_objectives,
                estimated_minutes: lesson.estimated_minutes,
              });
            });
          });
          return rows;
        })
        .filter((row) => row.selected_title || row.selected_content);

      if (subjectContentRows.length > 0) {
        const { error: contentError } = await supabase.from("plan_subject_content").insert(subjectContentRows);
        if (contentError) throw contentError;
      }

      const specialEvents = specialDates
        .map((row) => ({ ...row, isoDate: normalizeDateInput(row.dateText) }))
        .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.isoDate) && row.reason.trim());

      if (specialEvents.length > 0) {
        const { error: eventsError } = await supabase.from("school_calendar_events").insert(
          specialEvents.map((row) => ({
            school_id: selectedInstitution.school_id,
            section_id: selectedSection.section_id,
            subject_id: selectedSubject.subject_id,
            event_type: "other",
            blackout_reason: "event",
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

      emitLessonPlanRefresh();
      Alert.alert("Lesson plan created", "Your lesson plan was saved.", [
        { text: "OK", onPress: () => router.push("/(tabs)/calendar") },
      ]);
    } catch (err: any) {
      Alert.alert("Could not create lesson plan", err?.message ?? "Please try again.");
    } finally {
      createInFlightRef.current = false;
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

  const filledFieldBg = c.card;
  const emptyFieldBg = c.card;
  const filledText = c.text;
  const emptyText = c.mutedText;
  const isFormComplete =
    Boolean(selectedInstitution) &&
    Boolean(selectedSubject) &&
    Boolean(selectedSection) &&
    Boolean(planName.trim()) &&
    Boolean(startDate) &&
    Boolean(endDate) &&
    hasRequirementCounts &&
    hasValidSchedule &&
    hasSelectedSubjectContent;

  return (
    <View style={[styles.page, { backgroundColor: c.background }]}> 
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}
      >
        <View style={styles.headingRow}>
          <View style={styles.headingLeft}>
            <Pressable onPress={handleBack} hitSlop={10}>
              <Ionicons name="caret-back" size={15} color={c.text} />
            </Pressable>
            <Text style={[styles.pageTitle, { color: c.text }]}>Create Lessonplan</Text>
          </View>
          <Pressable onPress={handleCreatePlan} disabled={saving || !isFormComplete} style={({ pressed }) => ({ opacity: pressed ? 0.7 : (isFormComplete ? 1 : 0.4) })}>
            {saving ? <ActivityIndicator color={c.text} /> : <Ionicons name="checkmark" size={15} color={c.text} />}
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: c.text }]}>Overview</Text>

        <TextInput
          value={planName}
          onChangeText={setPlanName}
          placeholder="Lesson Plan Name"
          placeholderTextColor="#B0B0B0"
          style={[
            styles.nameInput,
            { backgroundColor: planName.trim() ? filledFieldBg : emptyFieldBg, color: planName.trim() ? filledText : emptyText },
          ]}
        />

        <View style={styles.row3}>
          <Pressable
            style={[styles.boxField, { backgroundColor: filledFieldBg }]}
            onPress={() => {
              animateIn();
              setYearPickerOpen(true);
            }}
          >
            <Text style={[styles.fieldText, { color: filledText }]}>{formatAcademicYear(academicYearStart)}</Text>
          </Pressable>

          <Pressable
            style={[styles.boxField, { backgroundColor: filledFieldBg }]}
            onPress={() => {
              setTerm((prev) => (prev === "quarter" ? "trimester" : prev === "trimester" ? "semester" : "quarter"));
            }}
          >
            <Text style={[styles.fieldText, { color: filledText }]}>{TERM_LABEL[term]}</Text>
          </Pressable>
        </View>

        <View style={styles.dateRow}>
          <Text style={styles.fromToText}>from</Text>
          <Pressable style={[styles.datePill, { backgroundColor: startDate ? filledFieldBg : emptyFieldBg }]} onPress={() => {
            animateIn();
            openDatePicker({ type: "duration", field: "start" }, startDate);
          }}>
            <Text style={[styles.dateInput, { color: startDate ? filledText : emptyText }]}>{startDate ? formatIsoDisplay(startDate) : "Pick date"}</Text>
          </Pressable>
          <Text style={styles.fromToText}>to</Text>
          <Pressable style={[styles.datePill, { backgroundColor: endDate ? filledFieldBg : emptyFieldBg }]} onPress={() => {
            animateIn();
            openDatePicker({ type: "duration", field: "end" }, endDate);
          }}>
            <Text style={[styles.dateInput, { color: endDate ? filledText : emptyText }]}>{endDate ? formatIsoDisplay(endDate) : "Pick date"}</Text>
          </Pressable>
        </View>

        <Pressable style={[styles.boxField, { backgroundColor: selectedSubject ? filledFieldBg : emptyFieldBg }]} onPress={() => {
          animateIn();
          setSubjectMenuOpen((v) => !v);
        }}>
          <Text style={[styles.fieldText, { color: selectedSubject ? filledText : emptyText }]} numberOfLines={1}>
            {selectedSubject ? `${selectedSubject.code} - ${selectedSubject.title}` : "Subject"}
          </Text>
        </Pressable>

        {subjectMenuOpen ? (
          <View style={styles.dropdown}>
            {selectableSubjects.map((subject) => (
              <Pressable key={subject.subject_id} style={styles.dropdownItem} onPress={() => handlePickSubject(subject.subject_id)}>
                <Text style={styles.dropdownText}>{subject.code} - {subject.title}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {selectedSubject ? (
          <View style={[styles.subjectPreviewBox, { backgroundColor: filledFieldBg }]}> 
            <View style={styles.subjectPreviewHeader}>
              <Text style={styles.subjectPreviewTitle}>Subject Content - Table of Contents</Text>
              <Pressable style={styles.pickContentBtn} onPress={() => {
                animateIn();
                setChapterModalOpen(true);
              }}>
                <Ionicons name="create-outline" size={14} color={c.mutedText} />
              </Pressable>
            </View>
            {selectedSubjectOutline.length > 0 ? (
              selectedSubjectOutline.map((unitGroup, unitIndex) => (
                <View key={unitGroup.group.key} style={styles.previewUnitBlock}>
                  <View style={styles.tocRow}>
                    <Text style={styles.tocIndex}>{String(unitIndex + 1).padStart(2, "0")}</Text>
                    <Text style={styles.tocText}>{unitGroup.group.title}</Text>
                  </View>
                  {unitGroup.pickedChapters.map((row, chapterIndex) => (
                    <View key={row.chapter.chapter_id} style={styles.previewChapterBlock}>
                      <View style={styles.tocRow}>
                        <Text style={styles.tocIndex}>{`${unitIndex + 1}.${chapterIndex + 1}`}</Text>
                        <Text style={styles.tocText}>
                          {`Chapter ${row.chapter.sequence_no}: ${row.chapter.title}`}
                        </Text>
                      </View>
                      {row.pickedLessons.map((lesson, lessonIndex) => (
                        <View key={lesson.lesson_id} style={styles.previewLessonBlock}>
                          <View style={styles.tocRow}>
                            <Text style={styles.tocIndex}>{`${unitIndex + 1}.${chapterIndex + 1}.${lessonIndex + 1}`}</Text>
                            <Text style={styles.tocText}>{lesson.title}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              ))
            ) : (
              <Text style={styles.subjectPreviewText}>{subjectPreview}</Text>
            )}
          </View>
        ) : null}

        <View style={styles.row2}>
          <Pressable style={[styles.boxField, { backgroundColor: selectedInstitution ? filledFieldBg : emptyFieldBg }]} onPress={() => {
            animateIn();
            setInstitutionMenuOpen((v) => !v);
          }}>
            <Text style={[styles.fieldText, { color: selectedInstitution ? filledText : emptyText }]} numberOfLines={1}>
              {selectedInstitution ? selectedInstitution.name : "Institution"}
            </Text>
          </Pressable>

          <Pressable style={[styles.boxField, { backgroundColor: selectedSection ? filledFieldBg : emptyFieldBg }]} onPress={() => {
            animateIn();
            setSectionMenuOpen((v) => !v);
          }}>
            <Text style={[styles.fieldText, { color: selectedSection ? filledText : emptyText }]} numberOfLines={1}>
              {selectedSection ? selectedSection.name : "Section"}
            </Text>
          </Pressable>
        </View>

        {institutionMenuOpen ? (
          <View style={styles.dropdown}>
            {institutions.map((institution) => (
              <Pressable key={institution.school_id} style={styles.dropdownItem} onPress={() => handlePickInstitution(institution.school_id)}>
                <Text style={styles.dropdownText}>{institution.name}</Text>
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
                <Text style={[styles.dayChipText, { color: active ? c.card : c.mutedText }]}>{day.short}</Text>
              </Pressable>
            );
          })}
        </View>

        {DAY_OPTIONS.filter((day) => activeDays.has(day.key)).map((day) => {
          const row = daySchedules[day.key];

          return (
            <View key={day.key} style={styles.scheduleCard}>
              <View style={styles.scheduleCardHeader}>
                <Text style={styles.dayLabel}>{day.label}</Text>
                <Pressable style={styles.iconAction} onPress={() => addInstance(day.key)}>
                  <Text style={styles.plusText}>+</Text>
                </Pressable>
              </View>

              <View style={styles.slotStack}>
                {row.instances.map((instance, index) => {
                  const borderColor = getRoomBorderColor(instance.room);
                  return (
                    <View key={instance.id} style={[styles.instanceWrap, { borderColor }]}> 
                      <View style={styles.instanceHeaderRow}>
                        <Text style={styles.instanceLabel}>Slot {index + 1}</Text>
                        <View style={styles.instanceHeaderRight}>
                          <View style={styles.instanceRoomSwitch}>
                            <Pressable
                              style={({ pressed }) => [
                                styles.roomIconChip,
                                instance.room === "lecture" ? styles.roomIconChipActive : undefined,
                                instance.room === "lecture" ? styles.roomChipLecture : undefined,
                                pressed ? styles.pressScale : undefined,
                              ]}
                              onPress={() => setInstanceRoom(day.key, instance.id, "lecture")}
                            >
                              <Ionicons name="school-outline" size={14} color={instance.room === "lecture" ? "#5E6B7A" : c.mutedText} />
                              {instance.room === "lecture" ? <Text style={styles.roomChipTextActive}>Lecture</Text> : null}
                            </Pressable>
                            <Pressable
                              style={({ pressed }) => [
                                styles.roomIconChip,
                                instance.room === "laboratory" ? styles.roomIconChipActive : undefined,
                                instance.room === "laboratory" ? styles.roomChipLaboratory : undefined,
                                pressed ? styles.pressScale : undefined,
                              ]}
                              onPress={() => setInstanceRoom(day.key, instance.id, "laboratory")}
                            >
                              <Ionicons name="flask-outline" size={14} color={instance.room === "laboratory" ? "#5E6B7A" : c.mutedText} />
                              {instance.room === "laboratory" ? <Text style={styles.roomChipTextActive}>Laboratory</Text> : null}
                            </Pressable>
                          </View>
                          <View style={styles.instanceActionRow}>
                            <Pressable style={styles.removeBtn} onPress={() => duplicateInstance(day.key, instance.id)}>
                              <Ionicons name="copy-outline" size={14} color="#8A8A8A" />
                            </Pressable>
                            {row.instances.length > 1 ? (
                              <Pressable style={styles.removeBtn} onPress={() => removeInstance(day.key, instance.id)}>
                                <Ionicons name="close" size={16} color="#8A8A8A" />
                              </Pressable>
                            ) : null}
                          </View>
                        </View>
                      </View>

                      <View style={styles.timeRowCentered}>
                        <Pressable style={[styles.timeInputButton, { borderColor }]} onPress={() => openTimePicker({ day: day.key, instanceId: instance.id, field: "start" })}>
                          <Text style={styles.timeInputText}>{instance.start}</Text>
                        </Pressable>
                        <Text style={styles.toText}>to</Text>
                        <Pressable style={[styles.timeInputButton, { borderColor }]} onPress={() => openTimePicker({ day: day.key, instanceId: instance.id, field: "end" })}>
                          <Text style={styles.timeInputText}>{instance.end}</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}

        <View style={styles.divider} />

        <Text style={[styles.sectionTitle, { color: c.text }]}>Minimum Requirements</Text>
        <View style={styles.row3}>
          {(Object.keys(REQUIREMENT_LABEL) as RequirementKey[]).map((key) => {
            const countFilled = Boolean(requirementCounts[key]);
            return (
              <View key={key} style={styles.requirementPill}>
                <Text style={styles.requirementText}>{REQUIREMENT_LABEL[key]}</Text>
                <TextInput
                  value={requirementCounts[key]}
                  onChangeText={(value) => setRequirementCount(key, value)}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor="#B0B0B0"
                  style={[
                    styles.requirementCountInput,
                    { backgroundColor: countFilled ? filledFieldBg : emptyFieldBg, color: countFilled ? filledText : emptyText },
                  ]}
                />
              </View>
            );
          })}
        </View>

        {examSchedules.length > 0 ? (
          <View style={styles.examScheduleWrap}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Exam Dates</Text>
            {examSchedules.map((row, index) => {
              const examDefinition = getExamDefinition(index, examSchedules.length);
              return (
                <View key={row.id} style={styles.specialRow}>
                  <View style={[styles.examLabelBox, { backgroundColor: filledFieldBg }]}>
                    <Text style={[styles.examLabelText, { color: filledText }]}>{examDefinition.label}</Text>
                  </View>
                  <Pressable
                    style={[styles.specialDatePill, { backgroundColor: row.dateText ? filledFieldBg : emptyFieldBg }]}
                    onPress={() => openDatePicker({ type: "exam", id: row.id }, row.dateText)}
                  >
                    <Text style={[styles.dateInput, { color: row.dateText ? filledText : emptyText }]}>
                      {row.dateText ? formatIsoDisplay(row.dateText) : "Optional date"}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.divider} />

        <Text style={[styles.sectionTitle, { color: c.text }]}>Extra Requirements</Text>
        <TextInput
          value={extraRequirements}
          onChangeText={setExtraRequirements}
          placeholder="(1 Seatwork per Lesson, 1 activity per laboratory session, one long project making week, etc.)"
          placeholderTextColor="#B0B0B0"
          multiline
          style={[styles.extraBox, { backgroundColor: extraRequirements.trim() ? filledFieldBg : emptyFieldBg, color: extraRequirements.trim() ? filledText : emptyText }]}
        />

        <View style={styles.divider} />

        <Text style={[styles.sectionTitle, { color: c.text }]}>Special Dates</Text>
        {specialDates.map((row, index) => (
          <View key={row.id} style={styles.specialRow}>
            <Pressable
              style={[styles.specialDatePill, { backgroundColor: row.dateText ? filledFieldBg : emptyFieldBg }]}
              onPress={() => openDatePicker({ type: "special", id: row.id }, row.dateText)}
            >
              <Text style={[styles.dateInput, { color: row.dateText ? filledText : emptyText }]}>{row.dateText ? formatIsoDisplay(row.dateText) : "Pick date"}</Text>
            </Pressable>
            <View style={[styles.specialReasonBox, { backgroundColor: row.reason.trim() ? filledFieldBg : emptyFieldBg }]}> 
              <TextInput
                value={row.reason}
                onChangeText={(value) => setSpecialDateField(row.id, "reason", value)}
                placeholder="Reason"
                placeholderTextColor="#B0B0B0"
                style={[styles.reasonInput, { color: row.reason.trim() ? filledText : emptyText }]}
              />
            </View>
            <Pressable style={styles.iconAction} onPress={() => removeSpecialDateRow(row.id)}>
              <Ionicons name="close" size={16} color="#8A8A8A" />
            </Pressable>
            {index === specialDates.length - 1 ? (
              <Pressable style={styles.iconAction} onPress={addSpecialDateRow}>
                <Text style={styles.plusText}>+</Text>
              </Pressable>
            ) : (
              <View style={styles.iconAction} />
            )}
          </View>
        ))}
        {specialDates.length === 0 ? (
          <Pressable style={styles.addSpecialDateBtn} onPress={addSpecialDateRow}>
            <Ionicons name="add" size={14} color="#4B5563" />
            <Text style={styles.addSpecialDateText}>Add Special Date</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal visible={chapterModalOpen} transparent animationType="fade" onRequestClose={() => setChapterModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setChapterModalOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Select Units, Chapters, and Lessons</Text>
            <ScrollView style={styles.modalScroll}>
              {unitGroups.length === 0 ? (
                <Text style={styles.modalEmpty}>No units/chapters found for this subject.</Text>
              ) : (
                unitGroups.map((group) => (
                  <View key={group.key} style={styles.modalGroup}>
                    <Text style={styles.modalGroupTitle}>{group.title}</Text>
                    {group.chapters.map((chapter) => {
                      const selectedChapter = selectedChapterIds.has(chapter.chapter_id);
                      return (
                        <View key={chapter.chapter_id} style={styles.chapterWithLessons}>
                          <Pressable style={styles.modalChapterRow} onPress={() => toggleChapter(chapter.chapter_id)}>
                            <View style={[styles.selectionBox, selectedChapter ? styles.selectionBoxActive : undefined]}>
                              {selectedChapter ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : null}
                            </View>
                            <Text style={styles.modalChapterText}>Chapter {chapter.sequence_no}: {chapter.title}</Text>
                          </Pressable>
                          {chapter.lessons.map((lesson) => {
                            const selectedLesson = selectedLessonIds.has(lesson.lesson_id);
                            return (
                              <Pressable
                                key={lesson.lesson_id}
                                style={styles.modalLessonRow}
                                onPress={() => toggleLesson(chapter.chapter_id, lesson.lesson_id)}
                              >
                                <View style={[styles.selectionBoxSmall, selectedLesson ? styles.selectionBoxActive : undefined]}>
                                  {selectedLesson ? <Ionicons name="checkmark" size={11} color="#FFFFFF" /> : null}
                                </View>
                                <Text style={styles.modalLessonText}>
                                  Lesson {lesson.sequence_no}: {lesson.title}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
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
                <Picker
                  selectedValue={pickerHour}
                  onValueChange={(v) => setPickerHour(Number(v))}
                  style={styles.pickerText}
                  itemStyle={styles.pickerItem}
                >
                  {Array.from({ length: 12 }).map((_, i) => {
                    const hour = i + 1;
                    return <Picker.Item key={hour} label={`${hour}`} value={hour} />;
                  })}
                </Picker>
              </View>
              <View style={styles.timePickerCol}>
                <Picker
                  selectedValue={pickerMinute}
                  onValueChange={(v) => setPickerMinute(Number(v))}
                  style={styles.pickerText}
                  itemStyle={styles.pickerItem}
                >
                  {[0, 15, 30, 45].map((minute) => (
                    <Picker.Item key={minute} label={String(minute).padStart(2, "0")} value={minute} />
                  ))}
                </Picker>
              </View>
              <View style={styles.timePickerCol}>
                <Picker
                  selectedValue={pickerMeridiem}
                  onValueChange={(v) => setPickerMeridiem(v as "AM" | "PM")}
                  style={styles.pickerText}
                  itemStyle={styles.pickerItem}
                >
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

      <Modal
        visible={datePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setDatePickerOpen(false);
          setDateTarget(null);
        }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => {
            setDatePickerOpen(false);
            setDateTarget(null);
          }}
        >
          <Pressable style={styles.timeModalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Pick Date</Text>
            <View style={styles.timePickerRow}>
              <View style={styles.timePickerCol}>
                <Picker selectedValue={datePickerMonth} onValueChange={(v) => setDatePickerMonth(Number(v))} style={styles.pickerText} itemStyle={styles.pickerItem}>
                  {MONTH_LABELS.map((month, idx) => (
                    <Picker.Item key={month} label={month} value={idx + 1} />
                  ))}
                </Picker>
              </View>
              <View style={styles.timePickerCol}>
                <Picker
                  selectedValue={datePickerDay}
                  onValueChange={(v) => setDatePickerDay(Number(v))}
                  style={styles.pickerText}
                  itemStyle={styles.pickerItem}
                >
                  {Array.from({ length: getDaysInMonth(datePickerYear, datePickerMonth) }).map((_, i) => {
                    const day = i + 1;
                    return <Picker.Item key={day} label={String(day)} value={day} />;
                  })}
                </Picker>
              </View>
              <View style={styles.timePickerCol}>
                <Picker selectedValue={datePickerYear} onValueChange={(v) => setDatePickerYear(Number(v))} style={styles.pickerText} itemStyle={styles.pickerItem}>
                  {Array.from({ length: 16 }).map((_, i) => {
                    const year = nowYear - 5 + i;
                    return <Picker.Item key={year} label={String(year)} value={year} />;
                  })}
                </Picker>
              </View>
            </View>
            <Pressable style={styles.modalDone} onPress={applyPickedDate}>
              <Text style={styles.modalDoneText}>Set Date</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={yearPickerOpen} transparent animationType="fade" onRequestClose={() => setYearPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setYearPickerOpen(false)}>
          <Pressable style={styles.timeModalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Pick Academic Year Start</Text>
            <View style={styles.singlePickerWrap}>
              <Picker selectedValue={academicYearStart} onValueChange={(v) => setAcademicYearStart(Number(v))} style={styles.pickerText} itemStyle={styles.pickerItem}>
                {Array.from({ length: 16 }).map((_, i) => {
                  const year = nowYear - 5 + i;
                  return <Picker.Item key={year} label={`${year} (${formatAcademicYear(year)})`} value={year} />;
                })}
              </Picker>
            </View>
            <Pressable style={styles.modalDone} onPress={() => setYearPickerOpen(false)}>
              <Text style={styles.modalDoneText}>Set Year</Text>
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
    borderWidth: 1,
    borderColor: "#D8DDE3",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 10,
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
  subjectPreviewBox: {
    borderRadius: Radius.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: "#D8DDE3",
    gap: 6,
  },
  subjectPreviewTitle: {
    ...Typography.caption,
    color: "#5C5C5C",
    fontWeight: "600",
  },
  subjectPreviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickContentBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D8DDE3",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  subjectPreviewText: {
    ...Typography.body,
    color: "#1F2937",
    lineHeight: 20,
  },
  tocRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 30,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ECECEC",
  },
  tocIndex: {
    ...Typography.caption,
    color: "#6B7280",
    width: 26,
    textAlign: "right",
    fontWeight: "600",
  },
  tocText: {
    ...Typography.body,
    color: "#1F2937",
    flex: 1,
  },
  previewUnitBlock: {
    gap: 4,
  },
  previewChapterBlock: {
    marginLeft: 8,
    gap: 4,
  },
  previewLessonBlock: {
    marginLeft: 8,
    gap: 4,
  },
  dropdown: {
    borderRadius: Radius.md,
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8DDE3",
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
  },
  dropdownText: { ...Typography.body, color: "#4B5563" },
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
  dayChip: {
    flex: 1,
    minHeight: 46,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: "#D8DDE3",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  dayChipActive: { backgroundColor: "#6B7280", borderColor: "#6B7280" },
  dayChipText: { ...Typography.h3, fontWeight: "500" },
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
  requirementPill: {
    flex: 1,
    minHeight: 74,
    borderRadius: Radius.sm,
    alignItems: "stretch",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8DDE3",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  requirementText: {
    ...Typography.caption,
    fontWeight: "500",
    textAlign: "center",
    color: "#4B5563",
  },
  requirementCountInput: {
    ...Typography.body,
    textAlign: "center",
    minHeight: 32,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: "#D8DDE3",
  },
  examScheduleWrap: {
    gap: 8,
    marginTop: 10,
  },
  examLabelBox: {
    width: "42%",
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#D8DDE3",
    borderRadius: Radius.round,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  examLabelText: {
    ...Typography.caption,
    textAlign: "center",
    fontWeight: "600",
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
  specialRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  specialDatePill: {
    width: "42%",
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#D8DDE3",
    borderRadius: Radius.round,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  specialReasonBox: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.sm,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  reasonInput: {
    ...Typography.h2,
    textAlign: "center",
    fontWeight: "400",
  },
  addSpecialDateBtn: {
    minHeight: 40,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: "#D8DDE3",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  addSpecialDateText: {
    ...Typography.caption,
    color: "#4B5563",
    fontWeight: "600",
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
    borderWidth: 1,
    borderColor: "#D8DDE3",
  },
  modalTitle: { ...Typography.h2, color: "#111827", marginBottom: 8 },
  modalScroll: { maxHeight: 420 },
  modalEmpty: { ...Typography.body, color: "#777" },
  modalGroup: { marginBottom: 12, gap: 8 },
  modalGroupTitle: { ...Typography.body, color: "#454545", fontWeight: "600" },
  chapterWithLessons: { gap: 4 },
  modalChapterRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  modalChapterText: { ...Typography.body, color: "#5D5D5D", flex: 1 },
  modalLessonRow: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 24 },
  modalLessonText: { ...Typography.caption, color: "#5D5D5D", flex: 1 },
  selectionBox: {
    width: 18,
    height: 18,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#C3CBD6",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  selectionBoxSmall: {
    width: 16,
    height: 16,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#C3CBD6",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  selectionBoxActive: { borderColor: "#6B7280", backgroundColor: "#6B7280" },
  pressScale: {
    transform: [{ scale: 0.96 }],
  },
  modalDone: {
    marginTop: 8,
    minHeight: 42,
    borderRadius: Radius.md,
    backgroundColor: "#6B7280",
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
  singlePickerWrap: { minHeight: 180, justifyContent: "center" },
  pickerText: { color: "#111827" },
  pickerItem: { color: "#111827", fontSize: 18 },
});
