import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../../../context/theme";
import {
  type ActivityCategory,
  type ActivityType,
  type PickedAsset,
  type ScopeLesson,
  type SubjectOption,
  PERFORMANCE_TASK_COMPONENTS,
  PERFORMANCE_TASK_TYPES,
  WRITTEN_WORK_COMPONENTS,
  WRITTEN_WORK_TYPES,
  buildScopeSummary,
  createActivityDocx,
  createActivityPdf,
  getActivityTypeLabel,
  getCategoryLabel,
  guessMimeType,
  readTemplateText,
  shareLocalFile,
  uploadUriAsset,
} from "../../../lib/activity-utils";
import { supabase } from "../../../lib/supabase";

type PickerKind = "category" | "type" | "subject" | "scope" | null;
type ScreenStep = "details" | "components";

type ActivityRow = {
  activity_id: string;
};

function toRomanNumeral(value: number) {
  const numerals: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let remaining = value;
  let result = "";
  for (const [amount, token] of numerals) {
    while (remaining >= amount) {
      result += token;
      remaining -= amount;
    }
  }
  return result;
}

function roundUpToNearestFive(value: number) {
  return Math.ceil(value / 5) * 5;
}

function extractLessonScopeLabel(scopeLessons: ScopeLesson[]) {
  if (scopeLessons.length === 0) return "Lesson Scope";
  const sequenceNos = scopeLessons
    .map((lesson) => lesson.lessonSequence)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (sequenceNos.length === 0) return "Lesson Scope";
  if (sequenceNos.length === 1) return `Lesson ${sequenceNos[0]}`;
  return `Lesson ${sequenceNos[0]}-${sequenceNos[sequenceNos.length - 1]}`;
}

function distributeWrittenWorkCounts(totalItems: number, componentCount: number) {
  if (componentCount <= 0) return [];
  if (totalItems <= 0) return new Array(componentCount).fill(0);

  if (componentCount === 1) return [totalItems];

  const idealFirst = Math.ceil(totalItems / componentCount);
  const firstCount = Math.min(totalItems, roundUpToNearestFive(idealFirst));
  const remaining = Math.max(0, totalItems - firstCount);
  const result = [firstCount];

  const remainingSlots = componentCount - 1;
  for (let index = 0; index < remainingSlots; index += 1) {
    const slotsLeft = remainingSlots - index;
    const distributedSoFar = result.reduce((sum, item) => sum + item, 0);
    const left = Math.max(0, totalItems - distributedSoFar);
    const next = slotsLeft <= 1 ? left : Math.floor(left / slotsLeft);
    result.push(next);
  }

  const correction = totalItems - result.reduce((sum, item) => sum + item, 0);
  if (correction !== 0) {
    result[result.length - 1] += correction;
  }

  return result;
}

function truncateContent(text: string | null, limit = 2200) {
  const value = String(text ?? "").trim();
  if (!value) return "";
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function getDefaultType(category: ActivityCategory | null): ActivityType | "" {
  if (category === "written_work") return "quiz";
  if (category === "performance_task") return "project";
  return "";
}

function getDefaultComponents(category: ActivityCategory | null) {
  if (category === "written_work") return ["multiple_choice", "enumeration"];
  if (category === "performance_task") return ["instructions", "rubric", "grading_sheet"];
  return [] as string[];
}

export default function ActivitiesScreen() {
  const { colors: c } = useAppTheme();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [userId, setUserId] = useState("");
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [scopeLessons, setScopeLessons] = useState<ScopeLesson[]>([]);
  const [activityId, setActivityId] = useState("");

  const [screenStep, setScreenStep] = useState<ScreenStep>("details");
  const [category, setCategory] = useState<ActivityCategory | null>(null);
  const [activityType, setActivityType] = useState<ActivityType | "">("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedScopeIds, setSelectedScopeIds] = useState<string[]>([]);
  const [numberOfItems, setNumberOfItems] = useState("");
  const [requirementsText, setRequirementsText] = useState("");
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [templateAsset, setTemplateAsset] = useState<PickedAsset | null>(null);
  const [templateStoragePath, setTemplateStoragePath] = useState<string | null>(null);
  const [componentItemCounts, setComponentItemCounts] = useState<Record<string, string>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [editingSectionKey, setEditingSectionKey] = useState<string | null>(null);
  const [generatedText, setGeneratedText] = useState("");
  const [pdfUri, setPdfUri] = useState("");
  const [docxUri, setDocxUri] = useState("");
  const [generatedPdfStoragePath, setGeneratedPdfStoragePath] = useState<string | null>(null);
  const [generatedDocxStoragePath, setGeneratedDocxStoragePath] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState<PickerKind>(null);

  const selectedSubject = useMemo(
    () => subjects.find((item) => item.subject_id === selectedSubjectId) ?? null,
    [selectedSubjectId, subjects]
  );

  const selectedScopeLessons = useMemo(
    () => scopeLessons.filter((lesson) => selectedScopeIds.includes(lesson.lesson_id)),
    [scopeLessons, selectedScopeIds]
  );

  const activityTypeOptions = useMemo(
    () => (category === "performance_task" ? PERFORMANCE_TASK_TYPES : WRITTEN_WORK_TYPES),
    [category]
  );

  const componentOptions = useMemo(
    () => (category === "performance_task" ? PERFORMANCE_TASK_COMPONENTS : WRITTEN_WORK_COMPONENTS),
    [category]
  );

  const selectedComponentItems = useMemo(
    () => componentOptions.filter((item) => selectedComponents.includes(item.key)),
    [componentOptions, selectedComponents]
  );

  const previewSections = useMemo(() => {
    if (selectedComponentItems.length > 0) return selectedComponentItems;
    return componentOptions.slice(0, 3);
  }, [componentOptions, selectedComponentItems]);

  const scopeLabel = useMemo(() => buildScopeSummary(selectedScopeLessons), [selectedScopeLessons]);
  const subjectLabel = selectedSubject ? `${selectedSubject.code} - ${selectedSubject.title}` : "Subject";
  const computedTitle = useMemo(() => {
    const typeLabel = getActivityTypeLabel(activityType);
    const subjectPart = selectedSubject?.code || "Activity";
    return `${subjectPart} ${typeLabel}`.trim();
  }, [activityType, selectedSubject?.code]);

  const previewHeaderTitle = useMemo(() => {
    const typeLabel = getActivityTypeLabel(activityType) || "Activity";
    return `${typeLabel} - ${extractLessonScopeLabel(selectedScopeLessons)}`;
  }, [activityType, selectedScopeLessons]);

  const totalWrittenWorkItems = useMemo(() => {
    const parsed = Number(numberOfItems || 0);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }, [numberOfItems]);

  const loadLessons = useCallback(async (subjectId: string) => {
    if (!subjectId) {
      setScopeLessons([]);
      return;
    }

    const { data, error } = await supabase
      .from("chapters")
      .select("chapter_id, title, sequence_no, lessons(lesson_id, title, content, sequence_no)")
      .eq("subject_id", subjectId)
      .order("sequence_no", { ascending: true });
    if (error) throw error;

    const flattened = (data ?? []).flatMap((chapter: any) =>
      (chapter?.lessons ?? [])
        .map((lesson: any) => ({
          lesson_id: String(lesson.lesson_id),
          title: String(lesson.title ?? `Lesson ${lesson.sequence_no ?? ""}`),
          content: lesson.content ? String(lesson.content) : null,
          chapterTitle: String(chapter.title ?? "Chapter"),
          chapterSequence: Number(chapter.sequence_no ?? 0),
          lessonSequence: Number(lesson.sequence_no ?? 0),
        }))
        .sort((a: ScopeLesson, b: ScopeLesson) => a.lessonSequence - b.lessonSequence)
    );

    setScopeLessons(flattened);
    setSelectedScopeIds((current) =>
      current.filter((lessonId) => flattened.some((item) => item.lesson_id === lessonId))
    );
  }, []);

  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("No signed-in user found.");
      setUserId(user.id);

      const { data, error } = await supabase
        .from("user_subjects")
        .select("subject:subjects(subject_id, school_id, code, title)")
        .eq("user_id", user.id);
      if (error) throw error;

      const mappedSubjects = (data ?? [])
        .map((row: any) => {
          const subjectRaw = row?.subject;
          const subject = Array.isArray(subjectRaw) ? subjectRaw[0] : subjectRaw;
          if (!subject?.subject_id || !subject?.school_id || !subject?.code || !subject?.title) return null;
          return {
            subject_id: String(subject.subject_id),
            school_id: String(subject.school_id),
            code: String(subject.code),
            title: String(subject.title),
          } satisfies SubjectOption;
        })
        .filter((item: SubjectOption | null): item is SubjectOption => Boolean(item))
        .sort((a, b) => `${a.code} ${a.title}`.localeCompare(`${b.code} ${b.title}`));

      setSubjects(mappedSubjects);

      const nextSubjectId =
        selectedSubjectId && mappedSubjects.some((item) => item.subject_id === selectedSubjectId)
          ? selectedSubjectId
          : "";
      setSelectedSubjectId(nextSubjectId);

      if (nextSubjectId) {
        await loadLessons(nextSubjectId);
      } else {
        setScopeLessons([]);
      }
    } catch (err: any) {
      Alert.alert("Unable to load activity form", err?.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [loadLessons, selectedSubjectId]);

  useEffect(() => {
    if (!category) {
      setActivityType("");
      setSelectedComponents([]);
      return;
    }

    setActivityType((current) => {
      const nextDefault = getDefaultType(category);
      const allowed = new Set(activityTypeOptions.map((item) => item.key));
      return current && allowed.has(current) ? current : nextDefault;
    });

    setSelectedComponents((current) => {
      const allowedKeys = new Set(componentOptions.map((item) => item.key));
      const filtered = current.filter((item) => allowedKeys.has(item));
      return filtered.length > 0 ? filtered : getDefaultComponents(category);
    });
  }, [activityTypeOptions, category, componentOptions]);

  useEffect(() => {
    if (selectedComponents.length === 0) {
      setComponentItemCounts({});
      setCollapsedSections({});
      return;
    }

    if (category === "written_work") {
      const distributed = distributeWrittenWorkCounts(totalWrittenWorkItems, selectedComponents.length);
      setComponentItemCounts(
        Object.fromEntries(selectedComponents.map((key, index) => [key, String(distributed[index] ?? 0)]))
      );
      return;
    }

    setComponentItemCounts(Object.fromEntries(selectedComponents.map((key) => [key, "1"])));
  }, [category, selectedComponents, totalWrittenWorkItems]);

  useEffect(() => {
    if (selectedComponents.length === 0) return;
    setCollapsedSections(Object.fromEntries(selectedComponents.map((key) => [key, true])));
  }, [selectedComponents]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadBase();
    } finally {
      setRefreshing(false);
    }
  }

  function toggleComponent(componentKey: string) {
    setSelectedComponents((current) =>
      current.includes(componentKey)
        ? current.filter((item) => item !== componentKey)
        : [...current, componentKey]
    );
  }

  function toggleScope(lessonId: string) {
    setSelectedScopeIds((current) =>
      current.includes(lessonId) ? current.filter((item) => item !== lessonId) : [...current, lessonId]
    );
  }

  function toggleSectionCollapse(componentKey: string) {
    setCollapsedSections((current) => ({
      ...current,
      [componentKey]: !current[componentKey],
    }));
  }

  async function pickTemplateFile() {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
      ],
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    setTemplateAsset({
      uri: asset.uri,
      name: asset.name,
      mimeType: guessMimeType(asset.name, asset.mimeType),
    });
    setTemplateStoragePath(null);
  }

  async function ensureTemplateReady() {
    if (!userId || !templateAsset) {
      return {
        storagePath: templateStoragePath,
        extractedText: "",
      };
    }

    if (templateStoragePath) {
      return {
        storagePath: templateStoragePath,
        extractedText: "",
      };
    }

    const result = await readTemplateText({
      asset: templateAsset,
      userId,
    });
    setTemplateStoragePath(result.storagePath);
    return result;
  }

  function validateForComponentsStep() {
    if (!category) {
      Alert.alert("Category required", "Choose whether this is Written Work or Performance Task.");
      return false;
    }
    if (!activityType) {
      Alert.alert("Activity type required", "Choose the activity type.");
      return false;
    }
    if (!selectedSubject) {
      Alert.alert("Subject required", "Choose a subject first.");
      return false;
    }
    if (selectedScopeLessons.length === 0) {
      Alert.alert("Scope required", "Select at least one lesson for the scope.");
      return false;
    }
    if (category === "written_work" && !Number(numberOfItems)) {
      Alert.alert("No. of Items required", "Enter the number of items to generate.");
      return false;
    }
    return true;
  }

  function validateForGenerate() {
    if (!validateForComponentsStep()) return false;
    if (selectedComponents.length === 0) {
      Alert.alert("Components required", "Select at least one component.");
      return false;
    }
    return true;
  }

  async function persistActivity(params?: {
    templateStoragePathOverride?: string | null;
    generatedTextOverride?: string;
    generatedPdfPath?: string | null;
    generatedDocxPath?: string | null;
  }) {
    if (!userId) throw new Error("You must be signed in.");
    if (!selectedSubject) throw new Error("A subject is required.");

    const payload = {
      user_id: userId,
      school_id: selectedSubject.school_id,
      subject_id: selectedSubject.subject_id,
      title: computedTitle,
      category,
      activity_type: activityType || null,
      scope_lesson_ids: selectedScopeIds,
      scope_summary: selectedScopeLessons.map((lesson) => lesson.title).join(", "),
      requirements:
        category === "written_work"
          ? {
              number_of_items: Number(numberOfItems || 0),
              instructions: requirementsText.trim() || null,
              component_item_counts: componentItemCounts,
            }
          : {
              instructions: requirementsText.trim() || null,
              component_item_counts: componentItemCounts,
            },
      component_keys: selectedComponents,
      template_notes: null,
      template_storage_path: params?.templateStoragePathOverride ?? templateStoragePath,
      generation_notes: requirementsText.trim() || null,
      generated_text: params?.generatedTextOverride ?? (generatedText || null),
      generated_pdf_path: params?.generatedPdfPath ?? generatedPdfStoragePath,
      generated_docx_path: params?.generatedDocxPath ?? generatedDocxStoragePath,
      status: "draft",
    };

    if (activityId) {
      const { data, error } = await supabase
        .from("activities")
        .update(payload)
        .eq("activity_id", activityId)
        .select("activity_id")
        .single();
      if (error) throw error;
      return data as ActivityRow;
    }

    const { data, error } = await supabase
      .from("activities")
      .insert(payload)
      .select("activity_id")
      .single();
    if (error) throw error;
    setActivityId(String(data.activity_id));
    return data as ActivityRow;
  }

  async function handleSaveDraft() {
    if (!selectedSubject || !category) {
      Alert.alert("Missing details", "Pick a category and subject before saving a draft.");
      return;
    }

    setSavingDraft(true);
    try {
      const templateResult = await ensureTemplateReady();
      await persistActivity({
        templateStoragePathOverride: templateResult.storagePath,
      });
      Alert.alert("Draft saved", "The activity draft has been stored in the database.");
    } catch (err: any) {
      Alert.alert("Could not save draft", err?.message ?? "Please try again.");
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleGenerate() {
    if (!validateForGenerate()) return;

    setGenerating(true);
    try {
      const templateResult = await ensureTemplateReady();
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) throw sessionErr;
      const session = sessionData?.session;
      if (!session?.access_token) throw new Error("You must be signed in.");

      const selectedComponentLabels = componentOptions
        .filter((item) => selectedComponents.includes(item.key))
        .map((item) => item.label);

      const { data, error } = await supabase.functions.invoke("generate-activity", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: {
          title: computedTitle,
          category,
          activityType,
          subject: {
            code: selectedSubject?.code,
            title: selectedSubject?.title,
          },
          scopeLessons: selectedScopeLessons.map((lesson) => ({
            title: lesson.title,
            chapterTitle: lesson.chapterTitle,
            content: truncateContent(lesson.content),
          })),
          requirements:
            category === "written_work"
              ? {
                  numberOfItems: Number(numberOfItems || 0),
                  instructions: requirementsText.trim() || null,
                  componentItemCounts,
                }
              : {
                  instructions: requirementsText.trim() || null,
                  componentItemCounts,
                },
          components: selectedComponentLabels,
          templateText: templateResult.extractedText,
          templateFileName: templateAsset?.name ?? null,
          additionalInstructions: requirementsText.trim() || null,
        },
      });

      if (error) {
        const response = (error as any)?.context as Response | undefined;
        const detailPayload = response
          ? await response.json().catch(async () => ({ raw: await response.text().catch(() => "") }))
          : null;
        throw new Error(
          String(detailPayload?.details || detailPayload?.error || error.message || "Generation failed.")
        );
      }

      const text = String(data?.text ?? "").trim();
      if (!text) throw new Error("The generator returned an empty activity.");

      setGeneratedText(text);

      const scopeSummary = selectedScopeLessons.map((lesson) => lesson.title).join(", ");
      const pdfPath = await createActivityPdf({
        title: computedTitle,
        subjectLabel,
        typeLabel: getActivityTypeLabel(activityType),
        scopeSummary,
        text,
      });
      const docxPath = await createActivityDocx({
        title: computedTitle,
        subjectLabel,
        typeLabel: getActivityTypeLabel(activityType),
        scopeSummary,
        text,
      });

      setPdfUri(pdfPath);
      setDocxUri(docxPath);

      const uploadedPdfPath = await uploadUriAsset({
        uri: pdfPath,
        userId,
        fileName: `${computedTitle}.pdf`,
        mimeType: "application/pdf",
        folder: "generated_pdf",
      });
      const uploadedDocxPath = await uploadUriAsset({
        uri: docxPath,
        userId,
        fileName: `${computedTitle}.docx`,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        folder: "generated_docx",
      });
      setGeneratedPdfStoragePath(uploadedPdfPath);
      setGeneratedDocxStoragePath(uploadedDocxPath);

      await persistActivity({
        templateStoragePathOverride: templateResult.storagePath,
        generatedTextOverride: text,
        generatedPdfPath: uploadedPdfPath,
        generatedDocxPath: uploadedDocxPath,
      });

      Alert.alert("Activity generated", "The AI-generated document was saved and exported to PDF and DOCX.");
    } catch (err: any) {
      Alert.alert("Could not generate activity", err?.message ?? "Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownload(kind: "pdf" | "docx") {
    try {
      if (!generatedText.trim()) {
        Alert.alert("Nothing to download", "Generate the activity first.");
        return;
      }

      let path = kind === "pdf" ? pdfUri : docxUri;
      if (!path) {
        const scopeSummary = selectedScopeLessons.map((lesson) => lesson.title).join(", ");
        path =
          kind === "pdf"
            ? await createActivityPdf({
                title: computedTitle,
                subjectLabel,
                typeLabel: getActivityTypeLabel(activityType),
                scopeSummary,
                text: generatedText,
              })
            : await createActivityDocx({
                title: computedTitle,
                subjectLabel,
                typeLabel: getActivityTypeLabel(activityType),
                scopeSummary,
                text: generatedText,
              });

        if (kind === "pdf") setPdfUri(path);
        else setDocxUri(path);
      }

      await shareLocalFile(path);
    } catch (err: any) {
      Alert.alert("Download failed", err?.message ?? "Please try again.");
    }
  }

  const previewLines = useMemo(() => {
    return previewSections.flatMap((item, index) => {
      const roman = toRomanNumeral(index + 1);
      const count = Math.max(0, Number(componentItemCounts[item.key] || 0));

      if (category === "written_work") {
        if (item.key === "enumeration") {
          const lines = [`${roman}. ${item.label}`];
          const safeCount = count || 10;
          const groupCount = Math.max(1, Math.ceil(safeCount / 5));
          for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
            const letter = String.fromCharCode(65 + groupIndex);
            lines.push(`${letter}. Sample Question`);
            const start = groupIndex * 5 + 1;
            const end = Math.min(safeCount, start + 4);
            for (let itemNo = start; itemNo <= end; itemNo += 1) lines.push(`${itemNo}. ________`);
          }
          return lines;
        }

        if (item.key === "multiple_choice") {
          const safeCount = count || 5;
          const lines = [`${roman}. ${item.label}`];
          for (let itemNo = 1; itemNo <= safeCount; itemNo += 1) {
            lines.push(`${itemNo}. Sample Question`);
            lines.push("a. Sample Answer    b. Sample Answer    c. Sample Answer");
          }
          return lines;
        }

        if (item.key === "identification") {
          const safeCount = count || 5;
          return [
            `${roman}. ${item.label}`,
            ...Array.from({ length: safeCount }, (_, lineIndex) => `${lineIndex + 1}. ____________`),
          ];
        }

        if (item.key === "true_false") {
          const safeCount = count || 5;
          return [
            `${roman}. ${item.label}`,
            ...Array.from({ length: safeCount }, (_, lineIndex) => `${lineIndex + 1}. Sample statement  True / False`),
          ];
        }

        if (item.key === "matching_type") {
          const safeCount = count || 5;
          return [
            `${roman}. ${item.label}`,
            ...Array.from({ length: safeCount }, (_, lineIndex) => `${lineIndex + 1}. MATCHING_ROW`),
          ];
        }

        if (item.key === "essay") {
          return [
            `${roman}. ${item.label}`,
            "1. Sample essay prompt",
            "   ________________________________________________",
            "   ________________________________________________",
            "   ________________________________________________",
            "   ________________________________________________",
            "   ________________________________________________",
          ];
        }
      }

      return [
        `${roman}. ${item.label}`,
        "A. Section heading",
        "1. Sample placeholder content",
        "2. Sample placeholder content",
      ];
    });
  }, [category, componentItemCounts, previewSections]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator size="large" color={c.tint} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.page, { backgroundColor: c.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.screenWrap}>
        <View style={styles.topRow}>
          <Pressable
            style={styles.topLeft}
            onPress={() => {
              if (screenStep === "components") {
                setScreenStep("details");
                return;
              }
              router.back();
            }}
          >
            <Ionicons name="chevron-back" size={16} color="#111111" />
            <Text style={styles.title}>{screenStep === "details" ? "Create Activity" : "Components"}</Text>
          </Pressable>

          <Pressable style={styles.iconButton} onPress={handleSaveDraft} disabled={savingDraft || generating}>
            {savingDraft ? (
              <ActivityIndicator size="small" color="#111111" />
            ) : (
              <Ionicons name="checkmark" size={28} color="#111111" />
            )}
          </Pressable>
        </View>

        {screenStep === "details" ? (
          <ScrollView
            contentContainerStyle={[styles.detailsContent, { paddingBottom: 24 + insets.bottom }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}
          >
            <View style={styles.centeredSections}>
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionLabel}>Overview</Text>
                <View style={styles.fieldGrid}>
                  <Pressable
                    style={[styles.fieldBox, category ? styles.activeFieldBox : styles.disabledFieldBox]}
                    onPress={() => setPickerOpen("category")}
                  >
                    <Text style={[styles.fieldText, category ? styles.activeFieldText : styles.disabledFieldText]}>
                      {getCategoryLabel(category)}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[styles.fieldBox, activityType ? styles.activeFieldBox : styles.disabledFieldBox]}
                    onPress={() => category && setPickerOpen("type")}
                  >
                    <Text
                      style={[styles.fieldText, activityType ? styles.activeFieldText : styles.disabledFieldText]}
                    >
                      {activityType ? getActivityTypeLabel(activityType) : "Activity Type"}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[styles.fieldBox, selectedSubject ? styles.activeFieldBox : styles.disabledFieldBox]}
                    onPress={() => setPickerOpen("subject")}
                  >
                    <Text
                      style={[styles.fieldText, selectedSubject ? styles.activeFieldText : styles.disabledFieldText]}
                      numberOfLines={1}
                    >
                      {subjectLabel}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[styles.fieldBox, selectedScopeLessons.length ? styles.activeFieldBox : styles.disabledFieldBox]}
                    onPress={() => selectedSubject && setPickerOpen("scope")}
                  >
                    <Text
                      style={[
                        styles.fieldText,
                        selectedScopeLessons.length ? styles.activeFieldText : styles.disabledFieldText,
                      ]}
                      numberOfLines={1}
                    >
                      {scopeLabel}
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.sectionBlock}>
                <Text style={styles.sectionLabel}>Requirements</Text>
                {category === "written_work" ? (
                  <TextInput
                    value={numberOfItems}
                    onChangeText={setNumberOfItems}
                    keyboardType="number-pad"
                    placeholder="No. of Items"
                    placeholderTextColor="#BCBCBC"
                    style={[styles.inputField, styles.fullField, styles.compactInput]}
                  />
                ) : null}

                <TextInput
                  value={requirementsText}
                  onChangeText={setRequirementsText}
                  placeholder={
                    category === "performance_task"
                      ? "Leave blank for default creation, or describe the task, output, grading focus, and instructions."
                      : "Leave blank for default creation, or describe the coverage, difficulty, directions, and answer rules."
                  }
                  placeholderTextColor="#BCBCBC"
                  style={[styles.inputField, styles.fullField, styles.requirementsInput]}
                  multiline
                  numberOfLines={6}
                  maxLength={700}
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.sectionBlock}>
                <Text style={styles.sectionLabel}>Template</Text>
                <Pressable style={styles.uploadButton} onPress={pickTemplateFile}>
                  <Ionicons name="document-attach-outline" size={17} color="#111111" />
                  <Text style={styles.uploadButtonText}>
                    {templateAsset ? templateAsset.name : "Upload template file (optional)"}
                  </Text>
                </Pressable>
                <Text style={styles.helperText}>
                  Optional. Upload a template only if you want the generated document to follow an existing format.
                </Text>
              </View>

              <Pressable
                style={styles.proceedButton}
                onPress={() => {
                  if (!validateForComponentsStep()) return;
                  setScreenStep("components");
                }}
              >
                <Text style={styles.proceedButtonText}>Proceed</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <View style={[styles.componentsScreen, { paddingBottom: 16 + insets.bottom }]}>
            <Text style={styles.sectionLabel}>Components</Text>
            <View style={styles.componentWrap}>
              {componentOptions.map((item) => {
                const selected = selectedComponents.includes(item.key);
                return (
                  <Pressable
                    key={item.key}
                    style={[
                      styles.chip,
                      selected && styles.selectedChip,
                      selected && category === "written_work" && styles.yellowChip,
                      selected && category === "performance_task" && styles.blueChip,
                    ]}
                    onPress={() => toggleComponent(item.key)}
                  >
                    <Text style={styles.chipText}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.canvasWrap}>
              <Text style={styles.canvasTitle}>Live Preview</Text>
              <View style={styles.canvasSheet}>
                <Text style={styles.canvasDocTitle}>{previewHeaderTitle}</Text>
                <Text style={styles.canvasMetaCentered}>{subjectLabel}</Text>
                <View style={styles.canvasDivider} />
                {previewSections.map((item, index) => {
                  const roman = toRomanNumeral(index + 1);
                  const sectionLines = (() => {
                    const all = previewLines;
                    const heading = `${roman}. ${item.label}`;
                    const start = all.findIndex((line) => line === heading);
                    if (start === -1) return [];
                    const nextHeadingIndex = all.findIndex(
                      (line, i) => i > start && /^[IVXLCDM]+\./.test(line)
                    );
                    return all.slice(start + 1, nextHeadingIndex === -1 ? undefined : nextHeadingIndex);
                  })();
                  const isCollapsed = collapsedSections[item.key] ?? false;
                  const countValue = componentItemCounts[item.key] ?? "";

                  return (
                    <View key={item.key} style={styles.documentSection}>
                      <Pressable style={styles.documentSectionHeader} onPress={() => toggleSectionCollapse(item.key)}>
                        <Text style={styles.canvasSectionTitle}>{`${roman}. ${item.label}`}</Text>
                        <View style={styles.documentSectionActions}>
                          <Pressable
                            style={styles.editBadge}
                            onPress={() =>
                              setEditingSectionKey((current) => (current === item.key ? null : item.key))
                            }
                          >
                            <Text style={styles.editBadgeText}>Edit</Text>
                          </Pressable>
                          <Ionicons
                            name={isCollapsed ? "chevron-down" : "chevron-up"}
                            size={16}
                            color="#555555"
                          />
                        </View>
                      </Pressable>

                      {editingSectionKey === item.key ? (
                        <View style={styles.inlineEditorRow}>
                          <Text style={styles.inlineEditorLabel}>
                            {category === "written_work" ? "No. of items" : "No. of sections"}
                          </Text>
                          <TextInput
                            value={countValue}
                            onChangeText={(value) =>
                              setComponentItemCounts((current) => ({
                                ...current,
                                [item.key]: value.replace(/[^0-9]/g, ""),
                              }))
                            }
                            keyboardType="number-pad"
                            style={styles.inlineEditorInput}
                            placeholder="0"
                            placeholderTextColor="#BCBCBC"
                          />
                        </View>
                      ) : null}

                      {!isCollapsed ? (
                        <View style={styles.documentSectionBody}>
                          {item.key === "matching_type" ? (
                            <View style={styles.matchingTable}>
                              <View style={styles.matchingHeaderRow}>
                                <Text style={styles.matchingHeaderCell}>Column A</Text>
                                <Text style={styles.matchingHeaderCell}>Column B</Text>
                              </View>
                              {Array.from({ length: Math.max(1, Number(countValue || 0) || 5) }, (_, rowIndex) => (
                                <View key={`${item.key}-match-${rowIndex}`} style={styles.matchingBodyRow}>
                                  <Text style={styles.matchingCell}>{`${rowIndex + 1}. ____________`}</Text>
                                  <Text style={styles.matchingCell}>{`${String.fromCharCode(65 + rowIndex)}. Sample Choice`}</Text>
                                </View>
                              ))}
                            </View>
                          ) : (
                            sectionLines.map((line, lineIndex) => (
                              <Text
                                key={`${item.key}-${lineIndex}-${line}`}
                                style={[
                                  styles.canvasPlaceholder,
                                  /^[A-Z]\./.test(line) && styles.canvasSubheading,
                                  /^[a-z]\./.test(line) && styles.canvasChoiceInline,
                                  /^\d+\./.test(line) && styles.canvasIndented,
                                  /^   /.test(line) && styles.canvasDeepIndented,
                                ]}
                              >
                                {line}
                              </Text>
                            ))
                          )}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>

            <Pressable
              style={[styles.generateButton, (generating || savingDraft) && styles.disabledButton]}
              onPress={handleGenerate}
              disabled={generating || savingDraft}
            >
              {generating ? (
                <ActivityIndicator size="small" color="#111111" />
              ) : (
                <Text style={styles.generateButtonText}>{`Create ${getActivityTypeLabel(activityType)}`}</Text>
              )}
            </Pressable>
          </View>
        )}

        {generatedText ? (
          <View style={styles.generatedFooter}>
            <View style={styles.previewActions}>
              <Pressable style={styles.exportButton} onPress={() => handleDownload("docx")}>
                <Text style={styles.exportButtonText}>Download DOCX</Text>
              </Pressable>
              <Pressable style={styles.exportButton} onPress={() => handleDownload("pdf")}>
                <Text style={styles.exportButtonText}>Download PDF</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      <Modal transparent visible={pickerOpen !== null} animationType="fade" onRequestClose={() => setPickerOpen(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(null)}>
          <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
            {pickerOpen === "category" ? (
              <>
                <Text style={styles.modalTitle}>Select category</Text>
                <Pressable
                  style={styles.modalOption}
                  onPress={() => {
                    setCategory("written_work");
                    setPickerOpen(null);
                  }}
                >
                  <Text style={styles.modalOptionText}>Written Work</Text>
                </Pressable>
                <Pressable
                  style={styles.modalOption}
                  onPress={() => {
                    setCategory("performance_task");
                    setPickerOpen(null);
                  }}
                >
                  <Text style={styles.modalOptionText}>Performance Task</Text>
                </Pressable>
              </>
            ) : null}

            {pickerOpen === "type" ? (
              <>
                <Text style={styles.modalTitle}>Select activity type</Text>
                {activityTypeOptions.map((item) => (
                  <Pressable
                    key={item.key}
                    style={styles.modalOption}
                    onPress={() => {
                      setActivityType(item.key);
                      setPickerOpen(null);
                    }}
                  >
                    <Text style={styles.modalOptionText}>{item.label}</Text>
                  </Pressable>
                ))}
              </>
            ) : null}

            {pickerOpen === "subject" ? (
              <>
                <Text style={styles.modalTitle}>Select subject</Text>
                <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                  {subjects.map((item) => (
                    <Pressable
                      key={item.subject_id}
                      style={styles.modalOption}
                      onPress={async () => {
                        try {
                          setSelectedSubjectId(item.subject_id);
                          setSelectedScopeIds([]);
                          await loadLessons(item.subject_id);
                          setPickerOpen(null);
                        } catch (err: any) {
                          Alert.alert("Unable to load lessons", err?.message ?? "Please try again.");
                        }
                      }}
                    >
                      <Text style={styles.modalOptionText}>{`${item.code} - ${item.title}`}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {pickerOpen === "scope" ? (
              <>
                <Text style={styles.modalTitle}>Select lesson scope</Text>
                <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                  {scopeLessons.length === 0 ? (
                    <Text style={styles.modalEmpty}>No lessons found for this subject.</Text>
                  ) : (
                    scopeLessons.map((lesson) => {
                      const selected = selectedScopeIds.includes(lesson.lesson_id);
                      return (
                        <Pressable
                          key={lesson.lesson_id}
                          style={[styles.modalOption, selected && styles.modalOptionSelected]}
                          onPress={() => toggleScope(lesson.lesson_id)}
                        >
                          <View style={styles.scopeRow}>
                            <Text style={styles.modalOptionText}>{`${lesson.chapterTitle} • ${lesson.title}`}</Text>
                            {selected ? <Ionicons name="checkmark" size={18} color="#111111" /> : null}
                          </View>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
                <Pressable style={styles.doneButton} onPress={() => setPickerOpen(null)}>
                  <Text style={styles.doneButtonText}>Done</Text>
                </Pressable>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  screenWrap: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  topLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111111",
  },
  iconButton: {
    padding: 2,
    minWidth: 30,
    alignItems: "center",
  },
  detailsContent: {
    flexGrow: 1,
  },
  centeredSections: {
    flexGrow: 1,
    justifyContent: "center",
    gap: 18,
  },
  sectionBlock: {
    gap: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "400",
    color: "#111111",
  },
  fieldGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  fieldBox: {
    width: "48.8%",
    minHeight: 40,
    borderRadius: 1,
    borderWidth: 1.2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  activeFieldBox: {
    backgroundColor: "#FFFFFF",
    borderColor: "#222222",
  },
  disabledFieldBox: {
    width: "48.8%",
    minHeight: 40,
    borderRadius: 1,
    backgroundColor: "#FAFAFA",
    borderWidth: 1,
    borderColor: "#FAFAFA",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  fieldText: {
    fontSize: 13,
    fontWeight: "400",
    textAlign: "center",
  },
  activeFieldText: {
    color: "#111111",
  },
  disabledFieldText: {
    color: "#BCBCBC",
  },
  inputField: {
    minHeight: 42,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: "#E7E7E7",
    backgroundColor: "#FAFAFA",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: "#111111",
    textAlignVertical: "top",
  },
  fullField: {
    width: "100%",
  },
  compactInput: {
    minHeight: 42,
  },
  requirementsInput: {
    minHeight: 126,
    maxHeight: 176,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 17,
    color: "#6A6A6A",
  },
  uploadButton: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D9D9D9",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  uploadButtonText: {
    flex: 1,
    fontSize: 13,
    color: "#111111",
  },
  proceedButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  proceedButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  componentsScreen: {
    flex: 1,
  },
  componentWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  chip: {
    minHeight: 38,
    borderRadius: 9,
    borderWidth: 1.2,
    borderColor: "#222222",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  selectedChip: {
    borderColor: "#111111",
  },
  yellowChip: {
    backgroundColor: "#FFF17D",
  },
  blueChip: {
    backgroundColor: "#AFCBED",
  },
  chipText: {
    fontSize: 12,
    fontWeight: "400",
    color: "#111111",
  },
  canvasWrap: {
    flex: 1,
    marginTop: 14,
    marginBottom: 14,
  },
  canvasTitle: {
    fontSize: 13,
    color: "#111111",
    marginBottom: 8,
  },
  canvasSheet: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#E7E7E7",
    paddingHorizontal: 18,
    paddingVertical: 18,
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  canvasDocTitle: {
    fontSize: 14,
    fontFamily: "Times New Roman",
    fontWeight: "700",
    color: "#111111",
    textAlign: "center",
    letterSpacing: 0.2,
  },
  canvasMeta: {
    fontSize: 11,
    color: "#666666",
    marginTop: 2,
  },
  canvasMetaCentered: {
    fontSize: 11,
    fontFamily: "Times New Roman",
    color: "#666666",
    marginTop: 2,
    textAlign: "center",
  },
  canvasDivider: {
    height: 1,
    backgroundColor: "#E5E5E5",
    marginVertical: 12,
  },
  documentSection: {
    marginBottom: 12,
  },
  documentSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  documentSectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  editBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "#D9D9D9",
    borderRadius: 999,
    backgroundColor: "#FAFAFA",
  },
  editBadgeText: {
    fontSize: 11,
    color: "#444444",
    fontWeight: "600",
  },
  inlineEditorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 8,
    marginBottom: 6,
  },
  inlineEditorLabel: {
    flex: 1,
    fontSize: 11,
    color: "#666666",
  },
  inlineEditorInput: {
    width: 72,
    minHeight: 32,
    borderWidth: 1,
    borderColor: "#D9D9D9",
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    fontSize: 12,
    color: "#111111",
    textAlign: "center",
  },
  documentSectionBody: {
    marginTop: 4,
  },
  canvasSection: {
    marginBottom: 10,
  },
  canvasSectionTitle: {
    fontSize: 12,
    fontFamily: "Times New Roman",
    fontWeight: "700",
    color: "#111111",
    marginBottom: 2,
  },
  canvasPlaceholder: {
    fontSize: 11,
    fontFamily: "Times New Roman",
    lineHeight: 17,
    color: "#222222",
    marginBottom: 2,
  },
  canvasIndented: {
    paddingLeft: 14,
  },
  canvasDeepIndented: {
    paddingLeft: 26,
  },
  canvasSubheading: {
    color: "#333333",
    fontWeight: "600",
    paddingLeft: 14,
  },
  canvasChoiceInline: {
    paddingLeft: 26,
  },
  matchingTable: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  matchingHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#FAFAFA",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E5",
  },
  matchingBodyRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#EFEFEF",
  },
  matchingHeaderCell: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 11,
    fontFamily: "Times New Roman",
    fontWeight: "700",
    color: "#222222",
  },
  matchingCell: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 11,
    fontFamily: "Times New Roman",
    color: "#222222",
  },
  generateButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: "#FFF17D",
    alignItems: "center",
    justifyContent: "center",
  },
  disabledButton: {
    opacity: 0.65,
  },
  generateButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111111",
  },
  generatedFooter: {
    paddingBottom: 8,
  },
  previewActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  exportButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#222222",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  exportButtonText: {
    fontSize: 13,
    color: "#111111",
    fontWeight: "600",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.18)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 340,
    maxHeight: "78%",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    padding: 18,
    gap: 10,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111111",
    marginBottom: 2,
  },
  modalScroll: {
    maxHeight: 340,
  },
  modalOption: {
    borderWidth: 1,
    borderColor: "#D9D9D9",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalOptionSelected: {
    backgroundColor: "#F6F6F6",
  },
  modalOptionText: {
    fontSize: 14,
    color: "#111111",
  },
  modalEmpty: {
    fontSize: 13,
    color: "#666666",
    paddingVertical: 8,
  },
  scopeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  doneButton: {
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: "#FFF17D",
    alignItems: "center",
    justifyContent: "center",
  },
  doneButtonText: {
    color: "#111111",
    fontSize: 13,
    fontWeight: "700",
  },
});
