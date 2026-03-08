import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Radius, Spacing, Typography } from "../../../constants/fonts";
import { useAppTheme } from "../../../context/theme";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import { supabase } from "../../../lib/supabase";

type SubjectDetail = {
  subject_id: string;
  code: string;
  title: string;
  year: string | null;
  academic_year: string | null;
  school_name: string;
  subject_image: string | null;
  subject_image_signed_url: string | null;
};

type Chapter = {
  chapter_id: string;
  title: string;
  sequence_no: number;
  unit_id: string | null;
  unit_title: string | null;
  unit_sequence_no: number | null;
  lessons: Lesson[];
};

type Lesson = {
  lesson_id: string;
  chapter_id: string;
  title: string;
  sequence_no: number;
};

type PlanEntryCategory = "written_work" | "performance_task";

type PlanItem = {
  plan_entry_id: string;
  category: PlanEntryCategory;
  title: string;
};

type LessonPlanSummary = {
  lesson_plan_id: string;
  academic_year: string | null;
  start_date: string;
  end_date: string;
};

type UnitGroup = {
  key: string;
  unit_id: string | null;
  unit_title: string | null;
  unit_sequence_no: number | null;
  chapters: Chapter[];
};

type StructureEditorMode =
  | { type: "unit"; unitId: string }
  | { type: "chapter"; chapterId: string }
  | { type: "lesson"; lessonId: string }
  | { type: "add_lesson"; chapterId: string };

function toLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isHttpUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://");
}

function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

function guessExtension(mimeType?: string | null) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function guessMimeType(uri: string) {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function readUriAsArrayBuffer(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function uploadUriAsset(params: {
  uri: string;
  userId: string;
  fileName: string;
  mimeType: string;
  folder: string;
}) {
  const { uri, userId, fileName, mimeType, folder } = params;
  const safeName = sanitizeFileName(fileName);
  const path = `users/${userId}/subjects/${folder}_${Date.now()}_${safeName}`;
  const body = await readUriAsArrayBuffer(uri);
  const { error } = await supabase.storage.from("uploads").upload(path, body, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw error;
  return path;
}

async function resolveSubjectImageSignedUrl(subjectImage: string | null) {
  if (!subjectImage) return null;
  if (isHttpUrl(subjectImage)) return subjectImage;
  const { data: signed, error: signedErr } = await supabase.storage
    .from("uploads")
    .createSignedUrl(subjectImage, 60 * 60);
  if (!signedErr && signed?.signedUrl) return signed.signedUrl;
  return null;
}

function normalizeSubjectRow(row: any): SubjectDetail | null {
  const subjectRaw = row?.subject;
  const subject = Array.isArray(subjectRaw) ? subjectRaw[0] : subjectRaw;
  const schoolRaw = subject?.school;
  const school = Array.isArray(schoolRaw) ? schoolRaw[0] : schoolRaw;

  if (!subject?.subject_id || !subject?.code || !subject?.title) return null;

  return {
    subject_id: String(subject.subject_id),
    code: String(subject.code),
    title: String(subject.title),
    year: subject?.year ? String(subject.year) : null,
    academic_year: subject?.academic_year ? String(subject.academic_year) : null,
    school_name: String(school?.name ?? "Unknown School"),
    subject_image: subject?.subject_image ? String(subject.subject_image) : null,
    subject_image_signed_url: null,
  };
}

export default function SubjectDetailScreen() {
  const { colors: c, scheme } = useAppTheme();
  const params = useLocalSearchParams<{ subjectId?: string | string[] }>();
  const subjectId = useMemo(() => {
    const raw = params.subjectId;
    if (!raw) return "";
    return Array.isArray(raw) ? String(raw[0] ?? "") : String(raw);
  }, [params.subjectId]);

  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState<SubjectDetail | null>(null);
  const [academicYear, setAcademicYear] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [openChapters, setOpenChapters] = useState<Set<string>>(new Set());
  const [writtenWorks, setWrittenWorks] = useState<PlanItem[]>([]);
  const [performanceTasks, setPerformanceTasks] = useState<PlanItem[]>([]);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editYear, setEditYear] = useState("");
  const [editImageUri, setEditImageUri] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingSubject, setDeletingSubject] = useState(false);
  const [showSubjectMenu, setShowSubjectMenu] = useState(false);
  const [openUnitMenuId, setOpenUnitMenuId] = useState<string | null>(null);
  const [openChapterMenuId, setOpenChapterMenuId] = useState<string | null>(null);
  const [openLessonMenuId, setOpenLessonMenuId] = useState<string | null>(null);
  const [structureEditorMode, setStructureEditorMode] = useState<StructureEditorMode | null>(null);
  const [structureEditTitle, setStructureEditTitle] = useState("");
  const [savingStructureEdit, setSavingStructureEdit] = useState(false);

  const loadSubjectDetail = useCallback(async () => {
    if (!subjectId) {
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

      const { data: subjectRow, error: subjectError } = await supabase
        .from("user_subjects")
        .select(
          "subject:subjects(subject_id, code, title, year, academic_year, subject_image, school:schools(name))"
        )
        .eq("user_id", user.id)
        .eq("subject_id", subjectId)
        .maybeSingle();
      if (subjectError) throw subjectError;

      const normalizedSubject = normalizeSubjectRow(subjectRow);
      if (!normalizedSubject) {
        setSubject(null);
        setAcademicYear(null);
        setChapters([]);
        setOpenChapters(new Set());
        setWrittenWorks([]);
        setPerformanceTasks([]);
        return;
      }

      normalizedSubject.subject_image_signed_url = await resolveSubjectImageSignedUrl(
        normalizedSubject.subject_image
      );

      const { data: planRows, error: plansError } = await supabase
        .from("lesson_plans")
        .select("lesson_plan_id, academic_year, start_date, end_date")
        .eq("user_id", user.id)
        .eq("subject_id", subjectId)
        .order("start_date", { ascending: false });
      if (plansError) throw plansError;

      const plans: LessonPlanSummary[] = (planRows ?? []).map((row: any) => ({
        lesson_plan_id: String(row.lesson_plan_id),
        academic_year: row.academic_year ? String(row.academic_year) : null,
        start_date: String(row.start_date),
        end_date: String(row.end_date),
      }));

      const today = toLocalDateString();
      const selectedPlan =
        plans.find((plan) => plan.start_date <= today && plan.end_date >= today) ?? plans[0] ?? null;

      setAcademicYear(selectedPlan?.academic_year ?? normalizedSubject.academic_year ?? null);

        const { data: chapterRows, error: chaptersError } = await supabase
          .from("chapters")
          .select("chapter_id, title, sequence_no, unit:units(unit_id, title, sequence_no)")
          .eq("subject_id", subjectId)
          .order("sequence_no", { ascending: true });
        if (chaptersError) throw chaptersError;

        const chapterBase: Chapter[] = (chapterRows ?? []).map((row: any) => ({
          unit_id: row?.unit?.unit_id ? String(row.unit.unit_id) : null,
          unit_title: row?.unit?.title ? String(row.unit.title) : null,
          unit_sequence_no:
            typeof row?.unit?.sequence_no === "number" ? Number(row.unit.sequence_no) : null,
          chapter_id: String(row.chapter_id),
          title: String(row.title),
          sequence_no: Number(row.sequence_no ?? 0),
          lessons: [],
        }));

      if (chapterBase.length > 0) {
        const chapterIds = chapterBase.map((item) => item.chapter_id);
        const { data: lessonRows, error: lessonsError } = await supabase
          .from("lessons")
          .select("lesson_id, chapter_id, title, sequence_no")
          .in("chapter_id", chapterIds)
          .order("sequence_no", { ascending: true });
        if (lessonsError) throw lessonsError;

        const lessonsByChapter = new Map<string, Lesson[]>();
        for (const row of lessonRows ?? []) {
          const lesson: Lesson = {
            lesson_id: String(row.lesson_id),
            chapter_id: String(row.chapter_id),
            title: String(row.title),
            sequence_no: Number(row.sequence_no ?? 0),
          };
          const existing = lessonsByChapter.get(lesson.chapter_id) ?? [];
          existing.push(lesson);
          lessonsByChapter.set(lesson.chapter_id, existing);
        }

        for (const chapter of chapterBase) {
          chapter.lessons = lessonsByChapter.get(chapter.chapter_id) ?? [];
        }
      }

      let written: PlanItem[] = [];
      let performance: PlanItem[] = [];

      if (selectedPlan?.lesson_plan_id) {
        const { data: entryRows, error: entriesError } = await supabase
          .from("plan_entries")
          .select("plan_entry_id, category, title")
          .eq("lesson_plan_id", selectedPlan.lesson_plan_id)
          .in("category", ["written_work", "performance_task"])
          .order("created_at", { ascending: true });
        if (entriesError) throw entriesError;

        for (const row of entryRows ?? []) {
          const category = String(row.category) as PlanEntryCategory;
          const item: PlanItem = {
            plan_entry_id: String(row.plan_entry_id),
            category,
            title: String(row.title ?? "Untitled"),
          };
          if (category === "written_work") written.push(item);
          if (category === "performance_task") performance.push(item);
        }
      }

      setSubject(normalizedSubject);
      setChapters(chapterBase);
      setOpenChapters(new Set(chapterBase[0] ? [chapterBase[0].chapter_id] : []));
      setWrittenWorks(written);
      setPerformanceTasks(performance);
      setOpenUnitMenuId(null);
      setOpenChapterMenuId(null);
      setOpenLessonMenuId(null);
      setStructureEditorMode(null);
      setStructureEditTitle("");
      setShowSubjectMenu(false);
    } catch {
      setSubject(null);
      setAcademicYear(null);
      setChapters([]);
      setOpenChapters(new Set());
      setWrittenWorks([]);
      setPerformanceTasks([]);
      setOpenUnitMenuId(null);
      setOpenChapterMenuId(null);
      setOpenLessonMenuId(null);
      setStructureEditorMode(null);
      setStructureEditTitle("");
      setShowSubjectMenu(false);
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    loadSubjectDetail();
  }, [loadSubjectDetail]);

  const { refreshing, onRefresh } = usePullToRefresh(loadSubjectDetail);

  useEffect(() => {
    if (!subject) return;
    setEditTitle(subject.title);
    setEditCode(subject.code);
    setEditYear(subject.year ?? "");
    setEditImageUri(null);
  }, [subject]);

  const pageBg = useMemo(() => (scheme === "dark" ? c.background : "#F5F6F7"), [c.background, scheme]);
  const cardBg = useMemo(() => (scheme === "dark" ? c.card : "#FFFFFF"), [c.card, scheme]);
  const lessonRowA = useMemo(() => (scheme === "dark" ? "#1B2A2A" : "#E7F0EC"), [scheme]);
  const lessonRowB = useMemo(() => (scheme === "dark" ? "#223534" : "#DCE9E4"), [scheme]);
  const unitHeaderBg = useMemo(() => (scheme === "dark" ? "#1E3C35" : "#D8ECE6"), [scheme]);
  const editImagePreview = editImageUri || subject?.subject_image_signed_url || null;
  const groupedChapters = useMemo<UnitGroup[]>(() => {
    const groups = new Map<string, UnitGroup>();
    for (const chapter of chapters) {
      const key = chapter.unit_id ?? `__no_unit__${chapter.chapter_id}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          unit_id: chapter.unit_id,
          unit_title: chapter.unit_title,
          unit_sequence_no: chapter.unit_sequence_no,
          chapters: [],
        });
      }
      groups.get(key)?.chapters.push(chapter);
    }

    return Array.from(groups.values()).sort((a, b) => {
      if (a.unit_id && b.unit_id) {
        return (a.unit_sequence_no ?? 0) - (b.unit_sequence_no ?? 0);
      }
      if (a.unit_id && !b.unit_id) return -1;
      if (!a.unit_id && b.unit_id) return 1;
      return (a.chapters[0]?.sequence_no ?? 0) - (b.chapters[0]?.sequence_no ?? 0);
    });
  }, [chapters]);

  const toggleChapter = (chapterId: string) => {
    setShowSubjectMenu(false);
    setOpenUnitMenuId(null);
    setOpenChapterMenuId(null);
    setOpenLessonMenuId(null);
    setOpenChapters((current) => {
      const next = new Set(current);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const openEditForm = () => {
    if (!subject) return;
    setShowSubjectMenu(false);
    setStructureEditorMode(null);
    setStructureEditTitle("");
    setOpenUnitMenuId(null);
    setOpenChapterMenuId(null);
    setOpenLessonMenuId(null);
    setEditTitle(subject.title);
    setEditCode(subject.code);
    setEditYear(subject.year ?? "");
    setEditImageUri(null);
    setShowEditForm(true);
  };

  const startUnitEdit = (unitId: string, currentTitle: string | null) => {
    setShowEditForm(false);
    setShowSubjectMenu(false);
    setOpenChapterMenuId(null);
    setOpenLessonMenuId(null);
    setOpenUnitMenuId(null);
    setStructureEditorMode({ type: "unit", unitId });
    setStructureEditTitle((currentTitle ?? "").trim());
  };

  const startChapterEdit = (chapterId: string, currentTitle: string) => {
    setShowEditForm(false);
    setShowSubjectMenu(false);
    setOpenUnitMenuId(null);
    setOpenLessonMenuId(null);
    setOpenChapterMenuId(null);
    setStructureEditorMode({ type: "chapter", chapterId });
    setStructureEditTitle(currentTitle.trim());
  };

  const startLessonEdit = (lessonId: string, currentTitle: string) => {
    setShowEditForm(false);
    setShowSubjectMenu(false);
    setOpenUnitMenuId(null);
    setOpenChapterMenuId(null);
    setOpenLessonMenuId(null);
    setStructureEditorMode({ type: "lesson", lessonId });
    setStructureEditTitle(currentTitle.trim());
  };

  const startAddLesson = (chapterId: string) => {
    setShowEditForm(false);
    setShowSubjectMenu(false);
    setOpenUnitMenuId(null);
    setOpenChapterMenuId(null);
    setOpenLessonMenuId(null);
    setStructureEditorMode({ type: "add_lesson", chapterId });
    setStructureEditTitle("");
    setOpenChapters((current) => {
      const next = new Set(current);
      next.add(chapterId);
      return next;
    });
  };

  const cancelStructureEdit = () => {
    setStructureEditorMode(null);
    setStructureEditTitle("");
    setSavingStructureEdit(false);
  };

  const handleSaveStructureEdit = async () => {
    if (!structureEditorMode || !subject || savingStructureEdit) return;
    const normalizedTitle = structureEditTitle.trim();
    if (!normalizedTitle) {
      Alert.alert("Missing name", "Please enter a name.");
      return;
    }

    setSavingStructureEdit(true);
    try {
      if (structureEditorMode.type === "unit") {
        const { error } = await supabase
          .from("units")
          .update({ title: normalizedTitle })
          .eq("unit_id", structureEditorMode.unitId)
          .eq("subject_id", subject.subject_id);
        if (error) throw error;
      } else if (structureEditorMode.type === "chapter") {
        const { error } = await supabase
          .from("chapters")
          .update({ title: normalizedTitle })
          .eq("chapter_id", structureEditorMode.chapterId)
          .eq("subject_id", subject.subject_id);
        if (error) throw error;
      } else if (structureEditorMode.type === "lesson") {
        const { error } = await supabase
          .from("lessons")
          .update({ title: normalizedTitle })
          .eq("lesson_id", structureEditorMode.lessonId);
        if (error) throw error;
      } else {
        const chapter = chapters.find((item) => item.chapter_id === structureEditorMode.chapterId);
        const nextSequence =
          (chapter?.lessons ?? []).reduce((maxValue, lesson) => Math.max(maxValue, lesson.sequence_no), 0) + 1;
        const { error } = await supabase.from("lessons").insert({
          chapter_id: structureEditorMode.chapterId,
          title: normalizedTitle,
          sequence_no: nextSequence,
        });
        if (error) throw error;
      }

      cancelStructureEdit();
      await loadSubjectDetail();
    } catch (err: any) {
      Alert.alert("Could not save", err?.message ?? "Please try again.");
    } finally {
      setSavingStructureEdit(false);
    }
  };

  const confirmDeleteUnit = (unitId: string) => {
    setOpenUnitMenuId(null);
    Alert.alert("Delete unit?", "Chapters in this unit will remain but be removed from the unit.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const { error } = await supabase.from("units").delete().eq("unit_id", unitId);
            if (error) throw error;
            if (structureEditorMode?.type === "unit" && structureEditorMode.unitId === unitId) {
              cancelStructureEdit();
            }
            await loadSubjectDetail();
          } catch (err: any) {
            Alert.alert("Could not delete unit", err?.message ?? "Please try again.");
          }
        },
      },
    ]);
  };

  const confirmDeleteChapter = (chapterId: string) => {
    setOpenChapterMenuId(null);
    Alert.alert("Delete chapter?", "All lessons inside this chapter will also be deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const { error } = await supabase.from("chapters").delete().eq("chapter_id", chapterId);
            if (error) throw error;
            if (structureEditorMode?.type === "chapter" && structureEditorMode.chapterId === chapterId) {
              cancelStructureEdit();
            }
            if (structureEditorMode?.type === "add_lesson" && structureEditorMode.chapterId === chapterId) {
              cancelStructureEdit();
            }
            await loadSubjectDetail();
          } catch (err: any) {
            Alert.alert("Could not delete chapter", err?.message ?? "Please try again.");
          }
        },
      },
    ]);
  };

  const confirmDeleteLesson = (lessonId: string) => {
    setOpenLessonMenuId(null);
    Alert.alert("Delete lesson?", "This lesson will be permanently removed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const { error } = await supabase.from("lessons").delete().eq("lesson_id", lessonId);
            if (error) throw error;
            if (structureEditorMode?.type === "lesson" && structureEditorMode.lessonId === lessonId) {
              cancelStructureEdit();
            }
            await loadSubjectDetail();
          } catch (err: any) {
            Alert.alert("Could not delete lesson", err?.message ?? "Please try again.");
          }
        },
      },
    ]);
  };

  const pickEditImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to update subject image.");
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });
    if (res.canceled) return;

    setEditImageUri(res.assets[0]?.uri ?? null);
  };

  const handleSaveSubjectEdit = async () => {
    if (!subject) return;

    const normalizedTitle = editTitle.trim();
    const normalizedCode = editCode.trim();
    const normalizedYear = editYear.trim();

    if (!normalizedTitle) {
      Alert.alert("Missing title", "Subject title is required.");
      return;
    }
    if (!normalizedCode) {
      Alert.alert("Missing code", "Subject code is required.");
      return;
    }

    setSavingEdit(true);
    try {
      let subjectImagePath: string | null = subject.subject_image;

      if (editImageUri) {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error("No signed-in user found.");

        const mimeType = guessMimeType(editImageUri);
        const ext = guessExtension(mimeType);
        subjectImagePath = await uploadUriAsset({
          uri: editImageUri,
          userId: user.id,
          fileName: `subject_cover_${Date.now()}.${ext}`,
          mimeType,
          folder: "cover",
        });
      }

      const { error } = await supabase
        .from("subjects")
        .update({
          title: normalizedTitle,
          code: normalizedCode,
          year: normalizedYear || null,
          subject_image: subjectImagePath,
        })
        .eq("subject_id", subject.subject_id);
      if (error) throw error;

      const signedUrl = await resolveSubjectImageSignedUrl(subjectImagePath);
      setSubject((prev) =>
        prev
          ? {
              ...prev,
              title: normalizedTitle,
              code: normalizedCode,
              year: normalizedYear || null,
              subject_image: subjectImagePath,
              subject_image_signed_url: signedUrl,
            }
          : prev
      );
      setShowEditForm(false);
      setEditImageUri(null);
      Alert.alert("Subject updated", "Subject details were saved.");
    } catch (err: any) {
      if (String(err?.message || "").toLowerCase().includes("subjects_school_id_code_key")) {
        Alert.alert("Duplicate code", "This code already exists for this institution.");
      } else {
        Alert.alert("Could not update subject", err?.message ?? "Please try again.");
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDeleteSubject = () => {
    if (!subject || deletingSubject) return;
    setShowSubjectMenu(false);
    Alert.alert(
      "Delete subject?",
      "This permanently deletes the subject and related chapters, lessons, and plans.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: handleDeleteSubject,
        },
      ]
    );
  };

  const handleDeleteSubject = async () => {
    if (!subject) return;
    setDeletingSubject(true);
    try {
      const { error } = await supabase.from("subjects").delete().eq("subject_id", subject.subject_id);
      if (error) throw error;
      Alert.alert("Subject deleted", "The subject has been removed.");
      router.replace("/library");
    } catch (err: any) {
      Alert.alert("Could not delete subject", err?.message ?? "Please try again.");
    } finally {
      setDeletingSubject(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: pageBg }]}> 
        <ActivityIndicator color={c.tint} />
      </View>
    );
  }

  if (!subject) {
    return (
      <View style={[styles.center, { backgroundColor: pageBg }]}> 
        <Text style={[styles.emptyText, { color: c.mutedText }]}>Subject not found.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.page, { backgroundColor: pageBg }]}> 
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}
      >
        <Text style={[styles.metaText, { color: c.mutedText }]}>A.Y. {academicYear ?? "N/A"}</Text>

        <View style={styles.subjectRow}>
          <Text style={[styles.subjectTitle, { color: c.text }]} numberOfLines={1}>
            <Text style={styles.subjectCode}>{subject.code}</Text>
            {" - "}
            {subject.title}
          </Text>
          <View style={styles.menuWrap}>
            <Pressable
              style={styles.menuBtn}
              onPress={() => {
                setOpenUnitMenuId(null);
                setOpenChapterMenuId(null);
                setOpenLessonMenuId(null);
                setShowSubjectMenu((v) => !v);
              }}
              disabled={savingEdit || deletingSubject}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={c.text} />
            </Pressable>

            {showSubjectMenu ? (
              <View style={[styles.subjectMenu, { backgroundColor: cardBg, borderColor: c.border }]}>
                <Pressable
                  style={styles.subjectMenuItem}
                  onPress={openEditForm}
                  disabled={savingEdit || deletingSubject}
                >
                  <Ionicons name="create-outline" size={16} color={c.text} />
                  <Text style={[styles.subjectMenuText, { color: c.text }]}>Edit Subject</Text>
                </Pressable>

                <Pressable
                  style={styles.subjectMenuItem}
                  onPress={confirmDeleteSubject}
                  disabled={savingEdit || deletingSubject}
                >
                  <Ionicons name="trash-outline" size={16} color="#D64545" />
                  <Text style={[styles.subjectMenuText, { color: "#D64545" }]}>Delete Subject</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        {showEditForm ? (
          <View style={[styles.editCard, { backgroundColor: cardBg, borderColor: c.border }]}>
            <Text style={[styles.editLabel, { color: c.text }]}>Title</Text>
            <TextInput
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Subject title"
              placeholderTextColor={c.mutedText}
              style={[styles.editInput, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
            />

            <Text style={[styles.editLabel, { color: c.text }]}>Code</Text>
            <TextInput
              value={editCode}
              onChangeText={setEditCode}
              placeholder="Subject code"
              placeholderTextColor={c.mutedText}
              style={[styles.editInput, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
            />

            <Text style={[styles.editLabel, { color: c.text }]}>Grade Level</Text>
            <TextInput
              value={editYear}
              onChangeText={setEditYear}
              placeholder="Grade level (optional)"
              placeholderTextColor={c.mutedText}
              style={[styles.editInput, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
            />

            <Text style={[styles.editLabel, { color: c.text }]}>Image</Text>
            <Pressable
              onPress={pickEditImage}
              style={[styles.editImagePicker, { borderColor: c.border, backgroundColor: c.background }]}
            >
              {editImagePreview ? (
                <Image source={{ uri: editImagePreview }} style={styles.editImagePreview} resizeMode="cover" />
              ) : (
                <View style={styles.editImagePlaceholder}>
                  <Ionicons name="image-outline" size={18} color={c.mutedText} />
                  <Text style={[styles.editImagePlaceholderText, { color: c.mutedText }]}>Choose image</Text>
                </View>
              )}
            </Pressable>

            <View style={styles.editFooter}>
              <Pressable
                onPress={() => {
                  if (!subject) return;
                  setEditTitle(subject.title);
                  setEditCode(subject.code);
                  setEditYear(subject.year ?? "");
                  setEditImageUri(null);
                  setShowEditForm(false);
                }}
                disabled={savingEdit}
                style={[
                  styles.cancelBtn,
                  { borderColor: c.border, backgroundColor: c.background, opacity: savingEdit ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.cancelBtnText, { color: c.text }]}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleSaveSubjectEdit}
                disabled={savingEdit}
                style={[styles.saveBtn, { backgroundColor: c.text, opacity: savingEdit ? 0.6 : 1 }]}
              >
                <Text style={[styles.saveBtnText, { color: pageBg }]}>
                  {savingEdit ? "Saving..." : "Save Changes"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {structureEditorMode ? (
          <View style={[styles.editCard, { backgroundColor: cardBg, borderColor: c.border }]}>
            <Text style={[styles.editLabel, { color: c.text }]}>
              {structureEditorMode.type === "unit"
                ? "Edit unit name"
                : structureEditorMode.type === "chapter"
                  ? "Edit chapter name"
                  : structureEditorMode.type === "lesson"
                    ? "Edit lesson name"
                    : "Add new lesson"}
            </Text>
            <TextInput
              value={structureEditTitle}
              onChangeText={setStructureEditTitle}
              placeholder={
                structureEditorMode.type === "add_lesson"
                  ? "Lesson title"
                  : structureEditorMode.type === "unit"
                    ? "Unit title"
                    : structureEditorMode.type === "chapter"
                      ? "Chapter title"
                      : "Lesson title"
              }
              placeholderTextColor={c.mutedText}
              style={[styles.editInput, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
            />

            <View style={styles.editFooter}>
              <Pressable
                onPress={cancelStructureEdit}
                disabled={savingStructureEdit}
                style={[
                  styles.cancelBtn,
                  {
                    borderColor: c.border,
                    backgroundColor: c.background,
                    opacity: savingStructureEdit ? 0.6 : 1,
                  },
                ]}
              >
                <Text style={[styles.cancelBtnText, { color: c.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveStructureEdit}
                disabled={savingStructureEdit}
                style={[styles.saveBtn, { backgroundColor: c.text, opacity: savingStructureEdit ? 0.6 : 1 }]}
              >
                <Text style={[styles.saveBtnText, { color: pageBg }]}>
                  {savingStructureEdit
                    ? "Saving..."
                    : structureEditorMode.type === "add_lesson"
                      ? "Add Lesson"
                      : "Save Changes"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={[styles.heroCard, { backgroundColor: c.border }]}> 
          {subject.subject_image_signed_url ? (
            <Image source={{ uri: subject.subject_image_signed_url }} style={styles.heroImage} resizeMode="cover" />
          ) : (
            <View style={styles.heroFallback}>
              <Ionicons name="image-outline" size={52} color={c.mutedText} />
              <Text style={[styles.fallbackText, { color: c.mutedText }]}>{subject.school_name}</Text>
            </View>
          )}
        </View>

        <View style={styles.chapterList}>
          {groupedChapters.map((group) => {
            return (
              <View key={group.key} style={styles.unitGroup}>
                {group.unit_id ? (
                  <View style={[styles.unitHeader, { backgroundColor: unitHeaderBg }]}>
                    <Text style={[styles.unitTitle, { color: c.text }]} numberOfLines={1}>
                      <Text style={styles.chapterStrong}>
                        Unit {group.unit_sequence_no ?? ""}
                      </Text>
                      {group.unit_title ? ` - ${group.unit_title}` : ""}
                    </Text>
                    <View style={styles.rowMenuWrap}>
                      <Pressable
                        style={styles.menuBtn}
                        onPress={() => {
                          setShowSubjectMenu(false);
                          setOpenChapterMenuId(null);
                          setOpenLessonMenuId(null);
                          setOpenUnitMenuId((current) => (current === group.unit_id ? null : group.unit_id));
                        }}
                      >
                        <Ionicons name="ellipsis-horizontal" size={18} color={c.text} />
                      </Pressable>
                      {openUnitMenuId === group.unit_id ? (
                        <View style={[styles.inlineMenu, { backgroundColor: cardBg, borderColor: c.border }]}>
                          <Pressable
                            style={styles.subjectMenuItem}
                            onPress={() => startUnitEdit(group.unit_id!, group.unit_title)}
                          >
                            <Ionicons name="create-outline" size={16} color={c.text} />
                            <Text style={[styles.subjectMenuText, { color: c.text }]}>Edit Unit</Text>
                          </Pressable>
                          <Pressable
                            style={styles.subjectMenuItem}
                            onPress={() => confirmDeleteUnit(group.unit_id!)}
                          >
                            <Ionicons name="trash-outline" size={16} color="#D64545" />
                            <Text style={[styles.subjectMenuText, { color: "#D64545" }]}>Delete Unit</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ) : null}

                {group.chapters.map((chapter) => {
                  const isOpen = openChapters.has(chapter.chapter_id);
                  return (
                    <View
                      key={chapter.chapter_id}
                      style={[styles.chapterCard, { backgroundColor: cardBg, borderColor: c.border }]}
                    >
                      <View style={styles.chapterHeader}>
                        <View style={styles.chapterTitleWrap}>
                          <Pressable
                            style={styles.chapterToggle}
                            onPress={() => toggleChapter(chapter.chapter_id)}
                          >
                            <Text style={[styles.chapterTitle, { color: c.text }]} numberOfLines={1}>
                              <Text style={styles.chapterStrong}>Chapter {chapter.sequence_no}</Text>
                              {" - "}
                              {chapter.title}
                            </Text>
                            <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={16} color={c.text} />
                          </Pressable>
                        </View>
                        <View style={styles.rowMenuWrap}>
                          <Pressable
                            style={styles.menuBtn}
                            onPress={() => {
                              setShowSubjectMenu(false);
                              setOpenUnitMenuId(null);
                              setOpenLessonMenuId(null);
                              setOpenChapterMenuId((current) =>
                                current === chapter.chapter_id ? null : chapter.chapter_id
                              );
                            }}
                          >
                            <Ionicons name="ellipsis-horizontal" size={18} color={c.text} />
                          </Pressable>
                          {openChapterMenuId === chapter.chapter_id ? (
                            <View style={[styles.inlineMenu, { backgroundColor: cardBg, borderColor: c.border }]}>
                              <Pressable
                                style={styles.subjectMenuItem}
                                onPress={() => startAddLesson(chapter.chapter_id)}
                              >
                                <Ionicons name="add-outline" size={16} color={c.text} />
                                <Text style={[styles.subjectMenuText, { color: c.text }]}>Add Lesson</Text>
                              </Pressable>
                              <Pressable
                                style={styles.subjectMenuItem}
                                onPress={() => startChapterEdit(chapter.chapter_id, chapter.title)}
                              >
                                <Ionicons name="create-outline" size={16} color={c.text} />
                                <Text style={[styles.subjectMenuText, { color: c.text }]}>Edit Chapter</Text>
                              </Pressable>
                              <Pressable
                                style={styles.subjectMenuItem}
                                onPress={() => confirmDeleteChapter(chapter.chapter_id)}
                              >
                                <Ionicons name="trash-outline" size={16} color="#D64545" />
                                <Text style={[styles.subjectMenuText, { color: "#D64545" }]}>Delete Chapter</Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                      </View>

                      {isOpen ? (
                        chapter.lessons.length > 0 ? (
                          <View style={styles.lessonList}>
                            {chapter.lessons.map((lesson, lessonIndex) => (
                              <View
                                key={lesson.lesson_id}
                                style={[
                                  styles.lessonRow,
                                  { backgroundColor: lessonIndex % 2 === 0 ? lessonRowA : lessonRowB },
                                ]}
                              >
                                <View style={styles.lessonRowContent}>
                                  <Text style={[styles.lessonText, { color: c.text }]} numberOfLines={1}>
                                    <Text style={styles.lessonStrong}>Lesson {lesson.sequence_no}:</Text>
                                    {" "}
                                    {lesson.title}
                                  </Text>
                                  <View style={styles.rowMenuWrap}>
                                    <Pressable
                                      style={styles.menuBtn}
                                      onPress={() => {
                                        setShowSubjectMenu(false);
                                        setOpenUnitMenuId(null);
                                        setOpenChapterMenuId(null);
                                        setOpenLessonMenuId((current) =>
                                          current === lesson.lesson_id ? null : lesson.lesson_id
                                        );
                                      }}
                                    >
                                      <Ionicons name="ellipsis-horizontal" size={17} color={c.text} />
                                    </Pressable>
                                    {openLessonMenuId === lesson.lesson_id ? (
                                      <View
                                        style={[styles.inlineMenu, { backgroundColor: cardBg, borderColor: c.border }]}
                                      >
                                        <Pressable
                                          style={styles.subjectMenuItem}
                                          onPress={() => startLessonEdit(lesson.lesson_id, lesson.title)}
                                        >
                                          <Ionicons name="create-outline" size={16} color={c.text} />
                                          <Text style={[styles.subjectMenuText, { color: c.text }]}>Edit Lesson</Text>
                                        </Pressable>
                                        <Pressable
                                          style={styles.subjectMenuItem}
                                          onPress={() => confirmDeleteLesson(lesson.lesson_id)}
                                        >
                                          <Ionicons name="trash-outline" size={16} color="#D64545" />
                                          <Text style={[styles.subjectMenuText, { color: "#D64545" }]}>
                                            Delete Lesson
                                          </Text>
                                        </Pressable>
                                      </View>
                                    ) : null}
                                  </View>
                                </View>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Text style={[styles.chapterEmpty, { color: c.mutedText }]}>
                            No lessons for this chapter.
                          </Text>
                        )
                      ) : null}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>

        <View style={[styles.divider, { borderColor: c.border }]}> 
          <View style={[styles.dividerDot, { backgroundColor: c.border }]}> 
            <Ionicons name="chevron-down" size={12} color={c.mutedText} />
          </View>
        </View>

        <View style={styles.planGrid}>
          <View style={[styles.planCol, { backgroundColor: cardBg, borderColor: c.border }]}> 
            <View style={styles.planHeader}>
              <Text style={[styles.planTitle, { color: c.text }]}>Written Work</Text>
              <Ionicons name="add" size={18} color={c.text} />
            </View>
            {writtenWorks.length > 0 ? (
              writtenWorks.map((item) => (
                <View key={item.plan_entry_id} style={[styles.planItem, { backgroundColor: c.background }]}> 
                  <Text style={[styles.planItemText, { color: c.text }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={[styles.planEmpty, { color: c.mutedText }]}>No written work yet.</Text>
            )}
          </View>

          <View style={[styles.planCol, { backgroundColor: cardBg, borderColor: c.border }]}> 
            <View style={styles.planHeader}>
              <Text style={[styles.planTitle, { color: c.text }]}>Performance Task</Text>
              <Ionicons name="add" size={18} color={c.text} />
            </View>
            {performanceTasks.length > 0 ? (
              performanceTasks.map((item) => (
                <View key={item.plan_entry_id} style={[styles.planItemPink, { backgroundColor: scheme === "dark" ? "#4A2E33" : "#F0D7D8" }]}> 
                  <Text style={[styles.planItemText, { color: c.text }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={[styles.planEmpty, { color: c.mutedText }]}>No performance tasks yet.</Text>
            )}
          </View>
        </View>

      </ScrollView>
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  emptyText: {
    ...Typography.h3,
    textAlign: "center",
  },
  metaText: {
    ...Typography.h3,
    marginBottom: 2,
  },
  subjectRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  menuBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  menuWrap: {
    position: "relative",
  },
  subjectMenu: {
    position: "absolute",
    right: 0,
    top: 34,
    borderWidth: 1,
    borderRadius: Radius.md,
    minWidth: 164,
    overflow: "hidden",
    zIndex: 20,
    elevation: 4,
  },
  subjectMenuItem: {
    minHeight: 40,
    paddingHorizontal: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  subjectMenuText: {
    ...Typography.body,
    fontWeight: "600",
  },
  subjectTitle: {
    ...Typography.h2,
    flex: 1,
  },
  subjectCode: {
    fontWeight: "700",
  },
  heroCard: {
    borderRadius: Radius.lg,
    overflow: "hidden",
    height: 180,
    marginBottom: Spacing.lg,
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  heroFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  fallbackText: {
    ...Typography.body,
    textAlign: "center",
  },
  chapterList: {
    gap: Spacing.sm,
  },
  unitGroup: {
    gap: Spacing.xs,
  },
  unitHeader: {
    borderWidth: 0,
    borderRadius: Radius.md,
    minHeight: 42,
    justifyContent: "space-between",
    alignItems: "center",
    flexDirection: "row",
    paddingHorizontal: Spacing.md,
  },
  unitTitle: {
    ...Typography.h3,
  },
  chapterCard: {
    borderWidth: 1,
    borderRadius: Radius.md,
    overflow: "visible",
  },
  chapterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: Spacing.md,
  },
  chapterTitleWrap: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  chapterToggle: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chapterTitle: {
    ...Typography.h3,
    flex: 1,
  },
  rowMenuWrap: {
    position: "relative",
  },
  inlineMenu: {
    position: "absolute",
    right: 0,
    top: 30,
    borderWidth: 1,
    borderRadius: Radius.md,
    minWidth: 164,
    overflow: "hidden",
    zIndex: 30,
    elevation: 4,
  },
  chapterStrong: {
    fontWeight: "700",
  },
  lessonList: {
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  lessonRow: {
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    marginTop: 1,
  },
  lessonRowContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  lessonText: {
    ...Typography.h3,
    flex: 1,
  },
  lessonStrong: {
    fontWeight: "700",
  },
  chapterEmpty: {
    ...Typography.body,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  divider: {
    borderTopWidth: 1,
    marginTop: Spacing.lg,
    marginBottom: Spacing.lg,
    alignItems: "center",
  },
  dividerDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginTop: -11,
    alignItems: "center",
    justifyContent: "center",
  },
  planGrid: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  planCol: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    minHeight: 180,
  },
  planHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  planTitle: {
    ...Typography.h3,
    fontWeight: "700",
  },
  planItem: {
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    minHeight: 34,
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  planItemPink: {
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    minHeight: 34,
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  planItemText: {
    ...Typography.body,
  },
  planEmpty: {
    ...Typography.body,
    marginTop: Spacing.xs,
  },
  editCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  editLabel: {
    ...Typography.caption,
    marginBottom: 6,
  },
  editInput: {
    ...Typography.body,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  editImagePicker: {
    borderRadius: Radius.sm,
    borderWidth: 1,
    overflow: "hidden",
    minHeight: 120,
    marginBottom: Spacing.md,
    justifyContent: "center",
    alignItems: "center",
  },
  editImagePreview: {
    width: "100%",
    height: 120,
  },
  editImagePlaceholder: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  editImagePlaceholderText: {
    ...Typography.body,
  },
  editFooter: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: {
    ...Typography.body,
    fontWeight: "700",
  },
  saveBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    ...Typography.body,
    fontWeight: "700",
  },
});
