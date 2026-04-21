import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Radius, Spacing, Typography } from "../../../constants/fonts";
import { useAppTheme } from "../../../context/theme";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import { supabase } from "../../../lib/supabase";

type SubjectOption = {
  subject_id: string;
  school_id: string;
  code: string;
  title: string;
};

type ChapterOption = {
  chapter_id: string;
  subject_id: string;
  title: string;
  sequence_no: number;
  lessonSequenceNos: number[];
};

type PickedAsset = {
  uri: string;
  name: string;
  mimeType: string;
};

type UploadMode = "text" | "image" | "file" | null;

function getParamValue(value?: string | string[]) {
  if (!value) return "";
  return Array.isArray(value) ? String(value[0] ?? "") : String(value);
}

function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

function guessMimeType(name: string, fallback?: string | null) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".txt")) return "text/plain";
  return fallback || "application/octet-stream";
}

async function readUriAsArrayBuffer(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
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
  const path = `users/${userId}/lessons/${folder}_${Date.now()}_${safeName}`;
  const body = await readUriAsArrayBuffer(uri);
  const { error } = await supabase.storage.from("uploads").upload(path, body, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw error;
  return path;
}

async function extractPdfTextFromStoragePath(storagePath: string) {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) throw sessionErr;
  const session = sessionData?.session;
  if (!session?.access_token) throw new Error("You must be signed in.");

  const { data, error } = await supabase.functions.invoke("extract-text", {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
    body: { storagePath },
  });

  if (error) {
    const response = (error as any)?.context as Response | undefined;
    const status = response?.status;
    let details = error.message || "Edge Function failed.";

    if (response) {
      const payload = await response
        .json()
        .catch(async () => ({ raw: await response.text().catch(() => "") }));
      const serverMessage = payload?.details || payload?.message || payload?.error || payload?.raw;
      if (serverMessage) details = `${details} ${String(serverMessage)}`.trim();
    }

    throw new Error(
      status ? `extract-text failed (${status}): ${details}` : `extract-text failed: ${details}`
    );
  }

  return String(data?.text ?? "");
}

async function ocrImage(uri: string): Promise<string> {
  try {
    const mod = await import("react-native-mlkit-ocr");
    const result = await mod.default.detectFromUri(uri);
    if (typeof result === "string") return result;

    type OcrSegment = {
      text: string;
      x: number;
      y: number;
      h: number;
    };

    const segments: OcrSegment[] = [];
    const fallbackPieces: string[] = [];

    for (const block of result ?? []) {
      if (block?.lines?.length) {
        for (const line of block.lines) {
          if (!line?.text) continue;
          fallbackPieces.push(String(line.text).trim());
          const frame = (line as any)?.frame ?? {};
          segments.push({
            text: String(line.text).trim(),
            x: Number(frame?.x ?? 0),
            y: Number(frame?.y ?? 0),
            h: Number(frame?.height ?? 0),
          });
        }
        continue;
      }

      if (block?.text) {
        fallbackPieces.push(String(block.text).trim());
        const frame = (block as any)?.frame ?? {};
        segments.push({
          text: String(block.text).trim(),
          x: Number(frame?.x ?? 0),
          y: Number(frame?.y ?? 0),
          h: Number(frame?.height ?? 0),
        });
      }
    }

    if (segments.length === 0) return "";

    const fallbackText = fallbackPieces.filter(Boolean).join("\n").trim();
    const positionedSegments = segments.filter(
      (segment) => Number.isFinite(segment.x) && Number.isFinite(segment.y) && (segment.x !== 0 || segment.y !== 0)
    );
    const distinctY = new Set(positionedSegments.map((segment) => Math.round(segment.y))).size;
    const canReliablySort = positionedSegments.length >= 4 && distinctY >= 3;
    if (!canReliablySort) {
      return fallbackText;
    }

    const avgHeight =
      segments.reduce((sum, segment) => sum + (segment.h > 0 ? segment.h : 18), 0) / segments.length;
    const rowTolerance = Math.max(10, Math.min(28, avgHeight * 0.65));

    segments.sort((a, b) => {
      if (Math.abs(a.y - b.y) > rowTolerance) return a.y - b.y;
      return a.x - b.x;
    });

    const rows: OcrSegment[][] = [];
    for (const segment of segments) {
      const lastRow = rows[rows.length - 1];
      if (!lastRow) {
        rows.push([segment]);
        continue;
      }

      const rowY = lastRow.reduce((sum, item) => sum + item.y, 0) / lastRow.length;
      if (Math.abs(segment.y - rowY) <= rowTolerance) {
        lastRow.push(segment);
      } else {
        rows.push([segment]);
      }
    }

    const orderedLines = rows
      .map((row) =>
        row
          .sort((a, b) => a.x - b.x)
          .map((segment) => segment.text)
          .filter(Boolean)
          .join(" ")
          .replace(/[ ]{2,}/g, " ")
          .trim()
      )
      .filter((line) => line.length > 0);

    return orderedLines.join("\n").trim();
  } catch {
    throw new Error(
      "Image OCR needs a Dev Build (not Expo Go). Install react-native-mlkit-ocr and rebuild your app."
    );
  }
}

const LESSON_SECTION_HEADINGS = new Set([
  "lesson",
  "chapter",
  "unit",
  "objectives",
  "learning objectives",
  "goals",
  "materials",
  "resources",
  "procedure",
  "procedures",
  "activity",
  "activities",
  "discussion",
  "introduction",
  "motivation",
  "presentation",
  "practice",
  "guided practice",
  "independent practice",
  "assessment",
  "evaluation",
  "summary",
  "review",
  "assignment",
  "homework",
  "references",
  "source",
  "sources",
  "key concepts",
  "examples",
  "content",
]);

function toTitleCase(text: string) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeInlineSpacing(text: string) {
  return text
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .trim();
}

function stripOcrNoise(line: string) {
  return normalizeInlineSpacing(
    line
      .replace(/[|¦]+/g, " ")
      .replace(/[~_]{2,}/g, " ")
      .replace(/[^\S\r\n]*[•●◦▪■□◆◇]+[^\S\r\n]*/g, " • ")
      .replace(/^[\s"'`~|\\/_\-.,:;]+/, "")
      .replace(/[\s"'`~|\\/_\-.,:;]+$/, "")
  );
}

function isLikelyPageNoise(line: string) {
  const value = line.trim();
  if (!value) return true;
  if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(value)) return true;
  if (/^\d+\s+of\s+\d+$/i.test(value)) return true;
  if (/^\d{1,4}$/.test(value)) return true;
  if (/^[^\w]{1,4}$/.test(value)) return true;
  return false;
}

function isHeadingLine(line: string) {
  const value = line.replace(/[:.]+$/, "").trim();
  if (!value || value.length > 80) return false;
  if (/^(lesson|chapter|unit)\s+[0-9ivxlcdm]+/i.test(value)) return true;
  return LESSON_SECTION_HEADINGS.has(value.toLowerCase());
}

function normalizeHeading(line: string) {
  const value = normalizeInlineSpacing(line.replace(/[:.]+$/, "").trim());
  const numberedHeading = value.match(/^(lesson|chapter|unit)\s+([0-9ivxlcdm]+)(.*)$/i);
  if (numberedHeading) {
    const label = toTitleCase(numberedHeading[1]);
    const sequence = numberedHeading[2].toUpperCase();
    const rest = normalizeInlineSpacing(numberedHeading[3] ?? "").replace(/^[-:)\].\s]+/, "");
    return rest ? `${label} ${sequence}: ${capitalizeSentence(rest)}` : `${label} ${sequence}`;
  }
  return toTitleCase(value);
}

function isBulletLine(line: string) {
  return /^([•●◦▪■□◆◇*\-–—]|\d+[.)]|[A-Za-z][.)])\s+/.test(line.trim());
}

function normalizeBulletLine(line: string) {
  const value = line.trim().replace(/^([•●◦▪■□◆◇*\-–—]|\d+[.)]|[A-Za-z][.)])\s+/, "");
  return `- ${capitalizeSentence(value)}`;
}

function capitalizeSentence(text: string) {
  const value = normalizeInlineSpacing(text);
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function shouldJoinWithPrevious(previous: string, next: string) {
  if (!previous || !next) return false;
  if (isHeadingLine(previous) || isHeadingLine(next)) return false;
  if (isBulletLine(previous) || isBulletLine(next)) return false;
  if (/[.!?:]$/.test(previous)) return false;
  if (/^(and|but|or|so|because|which|that|who|when|where|while|using|with|for|to|of|in|on)\b/i.test(next)) {
    return true;
  }
  if (/^[a-z(]/.test(next)) return true;
  if (/[,;]$/.test(previous)) return true;
  if (previous.length < 70 && next.length < 70) return true;
  return false;
}

function splitLineIntoSegments(line: string) {
  return line
    .split(/\s{2,}/)
    .map((part) => stripOcrNoise(part))
    .filter(Boolean);
}

function formatExtractedLessonText(rawText: string) {
  const normalizedLines = rawText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => splitLineIntoSegments(line))
    .map((line) => stripOcrNoise(line))
    .filter((line) => line.length > 0)
    .filter((line) => !isLikelyPageNoise(line));

  const dedupedLines: string[] = [];
  const seen = new Set<string>();
  for (const line of normalizedLines) {
    const key = line.toLowerCase();
    if (seen.has(key) && (isHeadingLine(line) || line.length <= 40)) continue;
    seen.add(key);
    dedupedLines.push(line);
  }

  const mergedLines: string[] = [];
  for (const line of dedupedLines) {
    if (mergedLines.length === 0) {
      mergedLines.push(line);
      continue;
    }

    const previous = mergedLines[mergedLines.length - 1];
    if (shouldJoinWithPrevious(previous, line)) {
      mergedLines[mergedLines.length - 1] = normalizeInlineSpacing(`${previous} ${line}`);
      continue;
    }

    mergedLines.push(line);
  }

  const formattedLines: string[] = [];
  let previousType: "heading" | "bullet" | "paragraph" | null = null;

  for (const line of mergedLines) {
    let nextLine = line;
    let currentType: "heading" | "bullet" | "paragraph";

    if (isHeadingLine(nextLine)) {
      nextLine = normalizeHeading(nextLine);
      currentType = "heading";
    } else if (isBulletLine(nextLine)) {
      nextLine = normalizeBulletLine(nextLine);
      currentType = "bullet";
    } else {
      nextLine = capitalizeSentence(nextLine);
      currentType = "paragraph";
    }

    if (formattedLines.length > 0) {
      const last = formattedLines[formattedLines.length - 1];
      if (last !== "") {
        const needsSpacing =
          currentType === "heading" ||
          previousType === "heading" ||
          currentType !== previousType;
        if (needsSpacing) {
          formattedLines.push("");
        }
      }
    }

    formattedLines.push(nextLine);
    previousType = currentType;
  }

  return formattedLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildLessonContent(params: {
  text: string;
  imageStoragePath: string | null;
  fileStoragePath: string | null;
  formatting: string;
}) {
  const sections: string[] = [];
  const normalizedText = params.text.trim();
  const normalizedFormatting = params.formatting.trim();

  if (normalizedText) sections.push(normalizedText);

  if (params.imageStoragePath || params.fileStoragePath) {
    const attachments: string[] = [];
    if (params.imageStoragePath) attachments.push(`Image: ${params.imageStoragePath}`);
    if (params.fileStoragePath) attachments.push(`File: ${params.fileStoragePath}`);
    sections.push(`Source\n${attachments.map((item) => `- ${item}`).join("\n")}`);
  }

  if (normalizedFormatting) {
    sections.push(`Formatting Lesson:\n${normalizedFormatting}`);
  }

  return sections.join("\n\n").trim() || null;
}

export default function CreateLessonScreen() {
  const { colors: c, scheme } = useAppTheme();
  const params = useLocalSearchParams<{
    subjectId?: string | string[];
    chapterId?: string | string[];
    chapterNumber?: string | string[];
    lessonNumber?: string | string[];
  }>();
  const requestedSubjectId = useMemo(() => getParamValue(params.subjectId), [params.subjectId]);
  const requestedChapterId = useMemo(() => getParamValue(params.chapterId), [params.chapterId]);
  const requestedChapterNumber = useMemo(() => getParamValue(params.chapterNumber), [params.chapterNumber]);
  const requestedLessonNumber = useMemo(() => getParamValue(params.lessonNumber), [params.lessonNumber]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState("");
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [chapters, setChapters] = useState<ChapterOption[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [chapterNumber, setChapterNumber] = useState("");
  const [lessonNumber, setLessonNumber] = useState("");
  const [title, setTitle] = useState("");
  const [lessonText, setLessonText] = useState("");
  const [formatting, setFormatting] = useState("");
  const [uploadMode, setUploadMode] = useState<UploadMode>(null);
  const [imageAsset, setImageAsset] = useState<PickedAsset | null>(null);
  const [fileAsset, setFileAsset] = useState<PickedAsset | null>(null);
  const [subjectPickerOpen, setSubjectPickerOpen] = useState(false);
  const selectedSubjectIdRef = useRef("");

  useEffect(() => {
    selectedSubjectIdRef.current = selectedSubjectId;
  }, [selectedSubjectId]);

  const loadChapters = useCallback(async (subjectId: string) => {
    if (!subjectId) {
      setChapters([]);
      return [] as ChapterOption[];
    }

    const { data, error } = await supabase
      .from("chapters")
      .select("chapter_id, subject_id, title, sequence_no, lessons(lesson_id, sequence_no)")
      .eq("subject_id", subjectId)
      .order("sequence_no", { ascending: true });
    if (error) throw error;

    const mapped = (data ?? []).map((row: any) => ({
      chapter_id: String(row.chapter_id),
      subject_id: String(row.subject_id),
      title: String(row.title),
      sequence_no: Number(row.sequence_no ?? 0),
      lessonSequenceNos: (row?.lessons ?? [])
        .map((lesson: any) => Number(lesson.sequence_no ?? 0))
        .filter((value: number) => Number.isFinite(value) && value > 0)
        .sort((a: number, b: number) => a - b),
    }));

    setChapters(mapped);
    return mapped;
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
        (requestedSubjectId && mappedSubjects.some((item) => item.subject_id === requestedSubjectId) && requestedSubjectId) ||
        (selectedSubjectIdRef.current &&
          mappedSubjects.some((item) => item.subject_id === selectedSubjectIdRef.current) &&
          selectedSubjectIdRef.current) ||
        "";

      setSelectedSubjectId(nextSubjectId);

      if (!nextSubjectId) {
        setChapters([]);
        setChapterNumber("");
        setLessonNumber("");
      } else {
        const loadedChapters = await loadChapters(nextSubjectId);
        if (requestedChapterId) {
          const requestedChapter =
            loadedChapters.find((item) => item.chapter_id === requestedChapterId) ?? null;
          setChapterNumber(requestedChapter ? String(requestedChapter.sequence_no) : "");
        } else if (requestedChapterNumber) {
          setChapterNumber(requestedChapterNumber);
        }

        if (requestedLessonNumber) {
          setLessonNumber(requestedLessonNumber);
        }
      }
    } catch (err: any) {
      Alert.alert("Unable to load lesson form", err?.message ?? "Please try again.");
      setSubjects([]);
      setChapters([]);
      setSelectedSubjectId("");
      setChapterNumber("");
      setLessonNumber("");
    } finally {
      setLoading(false);
    }
  }, [loadChapters, requestedChapterId, requestedChapterNumber, requestedLessonNumber, requestedSubjectId]);

  useEffect(() => {
    loadBase();
  }, [loadBase]);

  const { refreshing, onRefresh } = usePullToRefresh(loadBase);

  const selectedSubject = useMemo(
    () => subjects.find((item) => item.subject_id === selectedSubjectId) ?? null,
    [selectedSubjectId, subjects]
  );

  const normalizedChapterNumber = useMemo(() => {
    const value = Number(chapterNumber.trim());
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }, [chapterNumber]);

  const normalizedLessonNumber = useMemo(() => {
    const value = Number(lessonNumber.trim());
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }, [lessonNumber]);

  const matchingChapter = useMemo(() => {
    if (!normalizedChapterNumber) return null;
    return chapters.find((item) => item.sequence_no === normalizedChapterNumber) ?? null;
  }, [chapters, normalizedChapterNumber]);

  const subjectFieldText = selectedSubject ? `${selectedSubject.code} - ${selectedSubject.title}` : "Subject";
  const canSave = Boolean(selectedSubject && normalizedLessonNumber && !saving);

  const previewPlaceholder = useMemo(() => {
    if (uploadMode === "text") return "Paste or type lesson content here.";
    if (uploadMode === "image") return "Choose an image to attach to this lesson.";
    if (uploadMode === "file") return "Choose a document to attach to this lesson.";
    return "Select text, image, or file for this lesson.";
  }, [uploadMode]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/create");
  };

  const handlePickSubject = async (subjectId: string) => {
    setSelectedSubjectId(subjectId);
    setSubjectPickerOpen(false);
    setChapterNumber("");
    setLessonNumber("");

    try {
      await loadChapters(subjectId);
    } catch (err: any) {
      Alert.alert("Unable to load chapters", err?.message ?? "Please try again.");
      setChapters([]);
    }
  };

  const handlePickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to upload an image.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    setImageAsset({
      uri: asset.uri,
      name: asset.fileName || `lesson_image_${Date.now()}.jpg`,
      mimeType: asset.mimeType || "image/jpeg",
    });
    setFileAsset(null);
    setUploadMode("image");
  };

  const handlePickFile = async () => {
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
    setFileAsset({
      uri: asset.uri,
      name: asset.name,
      mimeType: guessMimeType(asset.name, asset.mimeType),
    });
    setImageAsset(null);
    setUploadMode("file");
  };

  const handleSave = async () => {
    if (!userId) {
      Alert.alert("Session error", "Please sign in again.");
      return;
    }
    if (!selectedSubject) {
      Alert.alert("Subject required", "Choose a subject first.");
      return;
    }
    if (!normalizedLessonNumber) {
      Alert.alert("Lesson required", "Enter a lesson number.");
      return;
    }

    setSaving(true);
    try {
      let imageStoragePath: string | null = null;
      let fileStoragePath: string | null = null;
      let extractedLessonText = "";

      if (uploadMode === "image" && imageAsset) {
        imageStoragePath = await uploadUriAsset({
          uri: imageAsset.uri,
          userId,
          fileName: imageAsset.name,
          mimeType: imageAsset.mimeType,
          folder: "image",
        });
        extractedLessonText = formatExtractedLessonText(await ocrImage(imageAsset.uri));
      }

      if (uploadMode === "file" && fileAsset) {
        const mimeType = fileAsset.mimeType || guessMimeType(fileAsset.name, "application/octet-stream");
        fileStoragePath = await uploadUriAsset({
          uri: fileAsset.uri,
          userId,
          fileName: fileAsset.name,
          mimeType,
          folder: "file",
        });
        if (mimeType === "application/pdf") {
          extractedLessonText = formatExtractedLessonText(
            await extractPdfTextFromStoragePath(fileStoragePath)
          );
        }
      }

      let chapterToUse = matchingChapter;

      if (!chapterToUse && normalizedChapterNumber) {
        const { data: insertedChapter, error: chapterInsertError } = await supabase
          .from("chapters")
          .insert({
            subject_id: selectedSubject.subject_id,
            title: `Chapter ${normalizedChapterNumber}`,
            sequence_no: normalizedChapterNumber,
            status: "draft",
          })
          .select("chapter_id, subject_id, title, sequence_no")
          .single();
        if (chapterInsertError) throw chapterInsertError;

        chapterToUse = {
          chapter_id: String(insertedChapter.chapter_id),
          subject_id: String(insertedChapter.subject_id),
          title: String(insertedChapter.title),
          sequence_no: Number(insertedChapter.sequence_no ?? normalizedChapterNumber),
          lessonSequenceNos: [],
        };
        setChapters((current) =>
          [...current, chapterToUse!].sort((a, b) => a.sequence_no - b.sequence_no)
        );
      }

      if (!chapterToUse && !normalizedChapterNumber) {
        const generalChapter = chapters.find((item) => item.title.trim().toLowerCase() === "general") ?? null;
        if (generalChapter) {
          chapterToUse = generalChapter;
        } else {
          const nextChapterSequence =
            chapters.reduce((max, item) => Math.max(max, item.sequence_no), 0) + 1;
          const { data: insertedChapter, error: chapterInsertError } = await supabase
            .from("chapters")
            .insert({
              subject_id: selectedSubject.subject_id,
              title: "General",
              sequence_no: nextChapterSequence,
              status: "draft",
            })
            .select("chapter_id, subject_id, title, sequence_no")
            .single();
          if (chapterInsertError) throw chapterInsertError;

          chapterToUse = {
            chapter_id: String(insertedChapter.chapter_id),
            subject_id: String(insertedChapter.subject_id),
            title: String(insertedChapter.title),
            sequence_no: Number(insertedChapter.sequence_no ?? nextChapterSequence),
            lessonSequenceNos: [],
          };
          setChapters((current) =>
            [...current, chapterToUse!].sort((a, b) => a.sequence_no - b.sequence_no)
          );
        }
      }

      if (!chapterToUse) {
        throw new Error("Could not resolve a chapter for this lesson.");
      }

      if (chapterToUse.lessonSequenceNos.includes(normalizedLessonNumber)) {
        Alert.alert("Lesson number in use", "That lesson number already exists in this chapter.");
        return;
      }

      const normalizedTitle = title.trim() || `Lesson ${normalizedLessonNumber}`;
      const content = buildLessonContent({
        text: lessonText.trim() || extractedLessonText,
        imageStoragePath,
        fileStoragePath,
        formatting,
      });

      const { error } = await supabase.from("lessons").insert({
        chapter_id: chapterToUse.chapter_id,
        title: normalizedTitle,
        content,
        sequence_no: normalizedLessonNumber,
        status: "draft",
      });
      if (error) throw error;

      Alert.alert("Lesson created", "The lesson was saved.", [
        {
          text: "OK",
          onPress: () =>
            router.replace({
              pathname: "/library/subject_detail",
              params: { subjectId: selectedSubject.subject_id, openChapterId: chapterToUse.chapter_id },
            }),
        },
      ]);
    } catch (err: any) {
      Alert.alert("Could not create lesson", err?.message ?? "Please try again.");
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

  const fieldBg = scheme === "dark" ? "#161D26" : "#F8F8F8";
  const dividerColor = scheme === "dark" ? c.border : "#E3E3E3";
  const iconButtonBg = scheme === "dark" ? "#171B21" : "#FBFBFB";
  const activeIconButtonBg = scheme === "dark" ? "#203126" : "#EAF7EE";
  const activeIconColor = scheme === "dark" ? "#D9F2E1" : "#1D6A3A";
  const inactiveTextColor = scheme === "dark" ? "#9AA3AF" : "#B4B4B4";
  const surfaceTextColor = selectedSubject ? c.text : inactiveTextColor;

  return (
    <KeyboardAvoidingView
      style={[styles.page, { backgroundColor: c.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}
      >
        <View style={styles.headingRow}>
          <View style={styles.headingLeft}>
            <Pressable onPress={handleBack} hitSlop={10}>
              <Ionicons name="caret-back" size={15} color={c.text} />
            </Pressable>
            <Text style={[styles.pageTitle, { color: c.text }]}>Create Lesson</Text>
          </View>
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : canSave ? 1 : 0.35 })}
          >
            {saving ? <ActivityIndicator size="small" color={c.text} /> : <Ionicons name="checkmark" size={17} color={c.text} />}
          </Pressable>
        </View>

        <Text style={[styles.sectionLabel, { color: c.text }]}>Overview</Text>

        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Title (can be blank)"
          placeholderTextColor={inactiveTextColor}
          style={[styles.titleInput, { backgroundColor: fieldBg, color: c.text }]}
        />

        <View style={styles.overviewRow}>
          <Pressable
            style={[styles.overviewField, { backgroundColor: fieldBg }]}
            onPress={() => setSubjectPickerOpen(true)}
          >
            <Text style={[styles.overviewFieldText, { color: surfaceTextColor }]} numberOfLines={1}>
              {subjectFieldText}
            </Text>
          </Pressable>

          <TextInput
            value={chapterNumber}
            onChangeText={(value) => setChapterNumber(value.replace(/[^0-9]/g, ""))}
            placeholder="Chapter"
            placeholderTextColor={inactiveTextColor}
            keyboardType="number-pad"
            style={[styles.overviewInput, { backgroundColor: fieldBg, color: c.text }]}
          />

          <TextInput
            value={lessonNumber}
            onChangeText={(value) => setLessonNumber(value.replace(/[^0-9]/g, ""))}
            placeholder="Lesson"
            placeholderTextColor={inactiveTextColor}
            keyboardType="number-pad"
            style={[styles.overviewInput, { backgroundColor: fieldBg, color: c.text }]}
          />
        </View>

        <View style={[styles.divider, { backgroundColor: dividerColor }]} />

        <Text style={[styles.sectionLabel, { color: c.text }]}>Upload Lesson</Text>

        <View style={styles.uploadRow}>
          <View style={[styles.previewCard, { backgroundColor: fieldBg, borderColor: dividerColor }]}>
            {uploadMode === "text" ? (
              <TextInput
                value={lessonText}
                onChangeText={setLessonText}
                placeholder={previewPlaceholder}
                placeholderTextColor={inactiveTextColor}
                multiline
                textAlignVertical="top"
                style={[styles.previewTextArea, { color: c.text }]}
              />
            ) : uploadMode === "image" ? (
              imageAsset ? (
                <Image source={{ uri: imageAsset.uri }} style={styles.previewImage} resizeMode="cover" />
              ) : (
                <View style={styles.previewPlaceholderWrap}>
                  <Ionicons name="image-outline" size={28} color={inactiveTextColor} />
                  <Text style={[styles.previewPlaceholderText, { color: inactiveTextColor }]}>
                    {previewPlaceholder}
                  </Text>
                </View>
              )
            ) : uploadMode === "file" ? (
              fileAsset ? (
                <View style={styles.previewFileWrap}>
                  <Ionicons name="document-outline" size={34} color={c.text} />
                  <Text style={[styles.previewFileName, { color: c.text }]} numberOfLines={3}>
                    {fileAsset.name}
                  </Text>
                </View>
              ) : (
                <View style={styles.previewPlaceholderWrap}>
                  <Ionicons name="document-outline" size={28} color={inactiveTextColor} />
                  <Text style={[styles.previewPlaceholderText, { color: inactiveTextColor }]}>
                    {previewPlaceholder}
                  </Text>
                </View>
              )
            ) : (
              <View style={styles.previewPlaceholderWrap}>
                <Text style={[styles.previewLargeGlyph, { color: inactiveTextColor }]}>T</Text>
                <Text style={[styles.previewPlaceholderText, { color: inactiveTextColor }]}>
                  {previewPlaceholder}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.uploadActions}>
            <Pressable
              style={[
                styles.uploadActionButton,
                { backgroundColor: uploadMode === "text" ? activeIconButtonBg : iconButtonBg },
              ]}
              onPress={() => {
                setUploadMode("text");
                setImageAsset(null);
                setFileAsset(null);
              }}
            >
              <Text
                style={[
                  styles.uploadActionText,
                  { color: uploadMode === "text" ? activeIconColor : c.text },
                ]}
              >
                T
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.uploadActionButton,
                { backgroundColor: uploadMode === "image" ? activeIconButtonBg : iconButtonBg },
              ]}
              onPress={handlePickImage}
            >
              <Ionicons
                name="image-outline"
                size={24}
                color={uploadMode === "image" ? activeIconColor : c.text}
              />
            </Pressable>

            <Pressable
              style={[
                styles.uploadActionButton,
                { backgroundColor: uploadMode === "file" ? activeIconButtonBg : iconButtonBg },
              ]}
              onPress={handlePickFile}
            >
              <Ionicons
                name="document-outline"
                size={24}
                color={uploadMode === "file" ? activeIconColor : c.text}
              />
            </Pressable>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: dividerColor }]} />

        <Text style={[styles.sectionLabel, { color: c.text }]}>Formatting (optional)</Text>

        <TextInput
          value={formatting}
          onChangeText={setFormatting}
          placeholder="(No bullet points, precise descriptions, summarized descriptions, etc.)"
          placeholderTextColor={inactiveTextColor}
          multiline
          textAlignVertical="top"
          style={[styles.formattingInput, { backgroundColor: fieldBg, color: c.text }]}
        />
      </ScrollView>

      <Modal visible={subjectPickerOpen} transparent animationType="fade" onRequestClose={() => setSubjectPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSubjectPickerOpen(false)}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: c.text }]}>Select Subject</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {subjects.length > 0 ? (
                subjects.map((subject) => (
                  <Pressable
                    key={subject.subject_id}
                    style={[styles.modalItem, { borderBottomColor: c.border }]}
                    onPress={() => handlePickSubject(subject.subject_id)}
                  >
                    <Text style={[styles.modalItemText, { color: c.text }]}>{`${subject.code} - ${subject.title}`}</Text>
                  </Pressable>
                ))
              ) : (
                <Text style={[styles.emptyPickerText, { color: c.mutedText }]}>No subjects found.</Text>
              )}
            </ScrollView>
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
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxxl,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  headingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  pageTitle: {
    ...Typography.h2,
  },
  sectionLabel: {
    ...Typography.h2,
    fontWeight: "400",
    marginBottom: Spacing.sm,
  },
  titleInput: {
    minHeight: 44,
    borderRadius: Radius.sm,
    textAlign: "center",
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    ...Typography.h1,
    fontWeight: "600",
  },
  overviewRow: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  overviewField: {
    flex: 1,
    minHeight: 48,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.sm,
  },
  overviewFieldText: {
    ...Typography.body,
    textAlign: "center",
  },
  overviewInput: {
    flex: 1,
    minHeight: 48,
    borderRadius: Radius.sm,
    textAlign: "center",
    paddingHorizontal: Spacing.sm,
    ...Typography.body,
  },
  divider: {
    height: 1,
    marginVertical: Spacing.lg,
  },
  uploadRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: Spacing.lg,
    minHeight: 220,
  },
  previewCard: {
    flex: 1,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: "hidden",
    minHeight: 220,
  },
  previewTextArea: {
    flex: 1,
    minHeight: 220,
    padding: Spacing.md,
    ...Typography.body,
  },
  previewPlaceholderWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  previewPlaceholderText: {
    ...Typography.body,
    textAlign: "center",
  },
  previewLargeGlyph: {
    fontSize: 34,
    lineHeight: 34,
    fontWeight: "500",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewFileWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  previewFileName: {
    ...Typography.body,
    textAlign: "center",
  },
  uploadActions: {
    width: 76,
    justifyContent: "center",
    gap: Spacing.md,
  },
  uploadActionButton: {
    width: 76,
    height: 64,
    borderRadius: Radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadActionText: {
    fontSize: 28,
    lineHeight: 28,
    fontWeight: "500",
  },
  formattingInput: {
    minHeight: 118,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    ...Typography.body,
    fontStyle: "italic",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.32)",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  modalCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    maxHeight: "70%",
    paddingVertical: Spacing.sm,
  },
  modalTitle: {
    ...Typography.h2,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  modalItem: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalItemText: {
    ...Typography.body,
  },
  emptyPickerText: {
    ...Typography.body,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
});
