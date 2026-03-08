import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppTheme } from "../../context/theme";
import { supabase } from "../../lib/supabase";

type Institution = {
  school_id: string;
  name: string;
  is_primary: boolean;
};

type PickedFile = {
  uri: string;
  name: string;
  mimeType: string;
};

type SyllabusMode = "text" | "image" | "file" | null;

const TYPE_SCALE = {
  h1: 24,
  h2: 18,
  h3: 16,
  body: 14,
  caption: 12,
} as const;

type OutlineUnit = {
  tempId: string;
  title: string;
  sequenceNo: number;
};

type OutlineChapter = {
  tempId: string;
  title: string;
  sequenceNo: number;
  unitTempId: string | null;
};

type OutlineLesson = {
  title: string;
  sequenceNo: number;
  chapterTempId: string;
};

type ParsedOutline = {
  units: OutlineUnit[];
  chapters: OutlineChapter[];
  lessons: OutlineLesson[];
};

function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

function guessExtension(mimeType?: string | null) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "application/pdf") return "pdf";
  return "jpg";
}

function guessMimeType(name: string, fallback?: string | null) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return fallback || "application/octet-stream";
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

    const pieces: string[] = [];
    for (const block of result ?? []) {
      if (block?.text) pieces.push(block.text);
      else if (block?.lines?.length) {
        for (const line of block.lines) {
          if (line?.text) pieces.push(line.text);
        }
      }
    }

    return pieces.join("\n").trim();
  } catch (_e: any) {
    throw new Error(
      "Image OCR needs a Dev Build (not Expo Go). Install react-native-mlkit-ocr and rebuild your app."
    );
  }
}

function normalizeSyllabusText(rawText: string) {
  const lines = rawText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").replace(/[ ]{2,}/g, " ").trim())
    .map((line) => line.replace(/^[\u2022\u2023\u25E6\u2043\u2219*•·●▪◦\-]+\s*/g, "").trim())
    .filter((line) => line.length >= 3 && line.length <= 220)
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !/^page\s+\d+$/i.test(line));
  return lines;
}

function stripNumberingPrefix(text: string) {
  return text.replace(/^([A-Z]|\d+|[IVXLCDM]+)([.\-:)\]])\s*/i, "").trim();
}

function parseHeading(line: string, type: "unit" | "chapter" | "lesson") {
  const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingRegex = new RegExp(
    `^${escaped}\\s*([A-Za-z0-9IVXLCDM]+)?(?:\\s*[:.\\-\\)\\]]\\s*|\\s+)?(.+)?$`,
    "i"
  );
  const match = line.match(headingRegex);
  if (!match) return null;

  const rawTitle = (match[2] ?? "").trim();
  const cleanTitle = stripNumberingPrefix(rawTitle).replace(/[.:;\-]+$/, "").trim();
  const seqToken = (match[1] ?? "").trim();
  return {
    token: seqToken || null,
    title: cleanTitle || null,
  };
}

function parseOutlineFromText(rawText: string): ParsedOutline {
  const lines = normalizeSyllabusText(rawText);
  const units: OutlineUnit[] = [];
  const chapters: OutlineChapter[] = [];
  const lessons: OutlineLesson[] = [];

  let currentUnitTempId: string | null = null;
  let currentChapterTempId: string | null = null;

  for (const line of lines) {
    const unitMatch = parseHeading(line, "unit");
    if (unitMatch) {
      const tempId = `u_${units.length + 1}`;
      const fallback = unitMatch.token ? `Unit ${unitMatch.token}` : `Unit ${units.length + 1}`;
      units.push({
        tempId,
        title: unitMatch.title ?? fallback,
        sequenceNo: units.length + 1,
      });
      currentUnitTempId = tempId;
      currentChapterTempId = null;
      continue;
    }

    const chapterMatch = parseHeading(line, "chapter");
    if (chapterMatch) {
      const tempId = `c_${chapters.length + 1}`;
      const fallback = chapterMatch.token
        ? `Chapter ${chapterMatch.token}`
        : `Chapter ${chapters.length + 1}`;
      chapters.push({
        tempId,
        title: chapterMatch.title ?? fallback,
        sequenceNo: chapters.length + 1,
        unitTempId: currentUnitTempId,
      });
      currentChapterTempId = tempId;
      continue;
    }

    const lessonMatch = parseHeading(line, "lesson");
    if (lessonMatch) {
      if (!currentChapterTempId) {
        const chapterTempId = `c_${chapters.length + 1}`;
        chapters.push({
          tempId: chapterTempId,
          title: currentUnitTempId ? "General Chapter" : "Chapter 1",
          sequenceNo: chapters.length + 1,
          unitTempId: currentUnitTempId,
        });
        currentChapterTempId = chapterTempId;
      }

      const chapterLessonCount = lessons.filter(
        (entry) => entry.chapterTempId === currentChapterTempId
      ).length;
      const fallback = lessonMatch.token
        ? `Lesson ${lessonMatch.token}`
        : `Lesson ${chapterLessonCount + 1}`;

      lessons.push({
        title: lessonMatch.title ?? fallback,
        sequenceNo: chapterLessonCount + 1,
        chapterTempId: currentChapterTempId,
      });
    }
  }

  return { units, chapters, lessons };
}

function isMissingUnitSchema(error: any) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    message.includes("relation") && message.includes("units") && message.includes("does not exist")
  );
}

async function persistOutline(params: { subjectId: string; rawText: string }) {
  const { subjectId, rawText } = params;
  const outline = parseOutlineFromText(rawText);
  if (outline.chapters.length === 0) {
    return {
      units: 0,
      chapters: 0,
      lessons: 0,
      usedUnits: false,
    };
  }

  const unitIdByTempId = new Map<string, string>();
  let usedUnits = false;

  if (outline.units.length > 0) {
    for (const unit of outline.units) {
      const { data, error } = await supabase
        .from("units")
        .insert({
          subject_id: subjectId,
          title: unit.title,
          sequence_no: unit.sequenceNo,
          status: "published",
        })
        .select("unit_id")
        .single();
      if (error) {
        if (isMissingUnitSchema(error)) {
          unitIdByTempId.clear();
          break;
        }
        throw error;
      }
      unitIdByTempId.set(unit.tempId, String((data as { unit_id: string }).unit_id));
      usedUnits = true;
    }
  }

  const chapterIdByTempId = new Map<string, string>();
  for (const chapter of outline.chapters) {
    const resolvedUnitId = chapter.unitTempId ? unitIdByTempId.get(chapter.unitTempId) ?? null : null;
    const chapterPayload: Record<string, any> = {
      subject_id: subjectId,
      title: chapter.title,
      sequence_no: chapter.sequenceNo,
      status: "published",
    };
    if (resolvedUnitId) {
      chapterPayload.unit_id = resolvedUnitId;
    }

    const { data, error } = await supabase
      .from("chapters")
      .insert(chapterPayload)
      .select("chapter_id")
      .single();
    if (error) throw error;
    chapterIdByTempId.set(chapter.tempId, String((data as { chapter_id: string }).chapter_id));
  }

  let createdLessons = 0;
  for (const lesson of outline.lessons) {
    const chapterId = chapterIdByTempId.get(lesson.chapterTempId);
    if (!chapterId) continue;
    const { error } = await supabase.from("lessons").insert({
      chapter_id: chapterId,
      title: lesson.title,
      sequence_no: lesson.sequenceNo,
      status: "published",
    });
    if (error) throw error;
    createdLessons += 1;
  }

  return {
    units: usedUnits ? outline.units.length : 0,
    chapters: outline.chapters.length,
    lessons: createdLessons,
    usedUnits,
  };
}

export default function SubjectScreen() {
  const { colors: c } = useAppTheme();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [showInstitutionModal, setShowInstitutionModal] = useState(false);

  const [overview, setOverview] = useState("");
  const [title, setTitle] = useState("");
  const [subjectCode, setSubjectCode] = useState("");
  const [year, setYear] = useState("");
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>("");

  const [coverImageUri, setCoverImageUri] = useState<string | null>(null);
  const [syllabusMode, setSyllabusMode] = useState<SyllabusMode>(null);
  const [syllabusText, setSyllabusText] = useState("");
  const [syllabusImage, setSyllabusImage] = useState<PickedFile | null>(null);
  const [syllabusFile, setSyllabusFile] = useState<PickedFile | null>(null);

  const selectedInstitutionName = useMemo(() => {
    return (
      institutions.find((school) => school.school_id === selectedSchoolId)?.name ?? "Academic Institution"
    );
  }, [institutions, selectedSchoolId]);

  useEffect(() => {
    const init = async () => {
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
          .from("user_schools")
          .select("is_primary, school:schools(school_id, name)")
          .eq("user_id", user.id)
          .order("is_primary", { ascending: false });

        if (error) throw error;

        const mapped = (data ?? [])
          .map((row: any) => {
            const schoolRaw = row.school;
            const school = Array.isArray(schoolRaw) ? schoolRaw[0] : schoolRaw;
            if (!school?.school_id || !school?.name) return null;
            return {
              school_id: school.school_id as string,
              name: school.name as string,
              is_primary: Boolean(row?.is_primary),
            } satisfies Institution;
          })
          .filter((row: Institution | null): row is Institution => Boolean(row));

        setInstitutions(mapped);
        if (mapped.length > 0) {
          setSelectedSchoolId(mapped[0].school_id);
        }
      } catch (err: any) {
        Alert.alert("Unable to load subject form", err?.message ?? "Please try again.");
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);

  const pickCoverImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to upload a cover image.");
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });

    if (res.canceled) return;
    setCoverImageUri(res.assets[0]?.uri ?? null);
  };

  const pickSyllabusImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to upload syllabus image.");
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });
    if (res.canceled) return;

    const asset = res.assets[0];
    setSyllabusMode("image");
    setSyllabusImage({
      uri: asset.uri,
      name: asset.fileName || `syllabus_image_${Date.now()}.jpg`,
      mimeType: asset.mimeType || "image/jpeg",
    });
    setSyllabusFile(null);
  };

  const pickSyllabusFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: "application/pdf",
    });
    if (res.canceled) return;

    const file = res.assets[0];
    setSyllabusMode("file");
    setSyllabusFile({
      uri: file.uri,
      name: file.name,
      mimeType: file.mimeType || "application/octet-stream",
    });
    setSyllabusImage(null);
  };

  const handleSave = async () => {
    const normalizedTitle = title.trim();
    const normalizedCode = subjectCode.trim();
    const normalizedYear = year.trim();
    const normalizedOverview = overview.trim();

    if (!userId) {
      Alert.alert("Session error", "Please sign in again.");
      return;
    }
    if (!normalizedTitle) {
      Alert.alert("Missing title", "Subject title is required.");
      return;
    }
    if (!normalizedCode) {
      Alert.alert("Missing subject code", "Subject code is required.");
      return;
    }
    if (!selectedSchoolId) {
      Alert.alert("Missing institution", "Choose an academic institution.");
      return;
    }
    if (syllabusMode === "text" && !syllabusText.trim()) {
      Alert.alert("Missing curriculum text", "Add curriculum text or choose image/pdf.");
      return;
    }
    if (syllabusMode === "image" && !syllabusImage) {
      Alert.alert("Missing curriculum image", "Select an image to continue.");
      return;
    }
    if (syllabusMode === "file" && !syllabusFile) {
      Alert.alert("Missing curriculum file", "Select a PDF to continue.");
      return;
    }

    setSaving(true);
    try {
      let detectedOutlineText = "";

      let subjectImagePath: string | null = null;
      if (coverImageUri) {
        const inferredMime = guessMimeType(coverImageUri, "image/jpeg");
        const ext = guessExtension(inferredMime);
        const coverName = `subject_cover_${Date.now()}.${ext}`;
        subjectImagePath = await uploadUriAsset({
          uri: coverImageUri,
          userId,
          fileName: coverName,
          mimeType: inferredMime,
          folder: "cover",
        });
      }

      let syllabusValue: string | null = null;
      let syllabusKind: "text" | "image" | "file" | null = null;
      let syllabusMimeType: string | null = null;

      if (syllabusMode === "text" && syllabusText.trim()) {
        syllabusValue = syllabusText.trim();
        syllabusKind = "text";
        syllabusMimeType = "text/plain";
        detectedOutlineText = syllabusText.trim();
      }

      if (syllabusMode === "image" && syllabusImage) {
        syllabusValue = await uploadUriAsset({
          uri: syllabusImage.uri,
          userId,
          fileName: syllabusImage.name,
          mimeType: syllabusImage.mimeType,
          folder: "syllabus",
        });
        syllabusKind = "image";
        syllabusMimeType = syllabusImage.mimeType || "image/jpeg";
        detectedOutlineText = await ocrImage(syllabusImage.uri);
      }

      if (syllabusMode === "file" && syllabusFile) {
        const mimeType = syllabusFile.mimeType || guessMimeType(syllabusFile.name, "application/pdf");
        syllabusValue = await uploadUriAsset({
          uri: syllabusFile.uri,
          userId,
          fileName: syllabusFile.name,
          mimeType,
          folder: "syllabus",
        });
        syllabusKind = "file";
        syllabusMimeType = mimeType;
        if (mimeType === "application/pdf") {
          detectedOutlineText = await extractPdfTextFromStoragePath(syllabusValue);
        }
      }

      const { data: created, error: subjectError } = await supabase
        .from("subjects")
        .insert({
          school_id: selectedSchoolId,
          code: normalizedCode,
          title: normalizedTitle,
          year: normalizedYear || null,
          subject_image: subjectImagePath,
          syllabus: syllabusValue,
          syllabus_kind: syllabusKind,
          syllabus_mime_type: syllabusMimeType,
          description: normalizedOverview || null,
          status: "published",
        })
        .select("subject_id")
        .single();

      if (subjectError) throw subjectError;

      const subjectId = (created as { subject_id: string } | null)?.subject_id;
      if (!subjectId) throw new Error("Created subject id not returned.");

      const { error: userSubjectError } = await supabase.from("user_subjects").insert({
        user_id: userId,
        subject_id: subjectId,
      });
      if (userSubjectError) throw userSubjectError;

      let outlineSummary = "";
      if (detectedOutlineText.trim()) {
        try {
          const createdOutline = await persistOutline({
            subjectId,
            rawText: detectedOutlineText,
          });
          if (createdOutline.chapters > 0) {
            outlineSummary = ` Created ${createdOutline.chapters} chapter(s) and ${createdOutline.lessons} lesson(s)${
              createdOutline.usedUnits ? ` across ${createdOutline.units} unit(s).` : "."
            }`;
          }
        } catch (outlineError: any) {
          outlineSummary = ` Subject saved, but outline import failed: ${
            outlineError?.message ?? "Unknown error"
          }`;
        }
      }

      setOverview("");
      setTitle("");
      setSubjectCode("");
      setYear("");
      setCoverImageUri(null);
      setSyllabusMode(null);
      setSyllabusText("");
      setSyllabusImage(null);
      setSyllabusFile(null);
      if (institutions.length > 0) {
        setSelectedSchoolId(institutions[0].school_id);
      } else {
        setSelectedSchoolId("");
      }

      Alert.alert("Subject created", `Your subject was saved successfully.${outlineSummary}`, [
        {
          text: "OK",
          onPress: () => router.replace("/library"),
        },
      ]);
    } catch (err: any) {
      if (String(err?.message || "").toLowerCase().includes("subjects_school_id_code_key")) {
        Alert.alert("Duplicate code", "This subject code already exists for the selected institution.");
      } else {
        Alert.alert("Could not create subject", err?.message ?? "Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.tint} />
      </View>
    );
  }

  return (
    <View style={[styles.page, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.topRow}>
            <Text style={[styles.screenTitle, { color: c.text }]}>Create Subject</Text>
            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={({ pressed }) => [styles.checkBtn, { opacity: saving ? 0.6 : pressed ? 0.8 : 1 }]}
            >
              <Ionicons name={saving ? "time-outline" : "checkmark"} size={28} color={c.text} />
            </Pressable>
          </View>

          <Text style={[styles.overviewLabel, { color: c.text }]}>Overview</Text>

          <Pressable
            onPress={pickCoverImage}
            style={[
              styles.coverCard,
              {
                backgroundColor: c.card,
                borderColor: c.border,
              },
            ]}
          >
            {coverImageUri ? (
              <Image source={{ uri: coverImageUri }} style={styles.coverImage} />
            ) : (
              <Ionicons name="image-outline" size={56} color={c.mutedText} />
            )}
            <View
              style={[
                styles.coverBadge,
                {
                  backgroundColor: c.background,
                  borderColor: c.border,
                },
              ]}
            >
              <Ionicons name="ellipse-outline" size={14} color={c.mutedText} />
            </View>
          </Pressable>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Title"
            placeholderTextColor={c.mutedText}
            style={[
              styles.titleInput,
              {
                color: c.text,
                borderColor: c.border,
                backgroundColor: c.card,
              },
            ]}
          />

          <View style={styles.metaRow}>
            <TextInput
              value={subjectCode}
              onChangeText={setSubjectCode}
              placeholder="Subject Code"
              placeholderTextColor={c.mutedText}
              autoCapitalize="characters"
              style={[
                styles.metaInput,
                {
                  color: c.text,
                  borderColor: c.border,
                  backgroundColor: c.card,
                },
              ]}
            />

            <TextInput
              value={year}
              onChangeText={setYear}
              placeholder="Year"
              placeholderTextColor={c.mutedText}
              style={[
                styles.metaInput,
                {
                  color: c.text,
                  borderColor: c.border,
                  backgroundColor: c.card,
                },
              ]}
            />
          </View>

          <View style={styles.metaRow}>
            <Pressable
              onPress={() => setShowInstitutionModal(true)}
              style={[
                styles.institutionPicker,
                {
                  borderColor: c.border,
                  backgroundColor: c.card,
                },
              ]}
            >
              <Text numberOfLines={1} style={[styles.institutionText, { color: c.mutedText }]}>
                {selectedInstitutionName}
              </Text>
            </Pressable>
          </View>

          <TextInput
            value={overview}
            onChangeText={setOverview}
            placeholder="Brief description (optional)"
            placeholderTextColor={c.mutedText}
            multiline
            style={[
              styles.overviewInput,
              {
                color: c.text,
                borderColor: c.border,
                backgroundColor: c.card,
              },
            ]}
          />

          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <Text style={[styles.syllabusLabel, { color: c.text }]}>Upload Syllabus</Text>

          <View style={styles.syllabusRow}>
            <View
              style={[
                styles.syllabusPreview,
                {
                  borderColor: c.border,
                  backgroundColor: c.card,
                },
              ]}
            >
              {syllabusMode === "text" ? (
                <TextInput
                  value={syllabusText}
                  onChangeText={setSyllabusText}
                  placeholder="Type syllabus notes..."
                  placeholderTextColor={c.mutedText}
                  multiline
                  style={[styles.syllabusTextInput, { color: c.text }]}
                />
              ) : null}

              {syllabusMode === "image" && syllabusImage ? (
                <Image source={{ uri: syllabusImage.uri }} style={styles.syllabusImage} />
              ) : null}

              {syllabusMode === "file" && syllabusFile ? (
                <View style={styles.fileWrap}>
                  <Ionicons name="document-outline" size={24} color={c.text} />
                  <Text numberOfLines={3} style={[styles.fileName, { color: c.text }]}>
                    {syllabusFile.name}
                  </Text>
                </View>
              ) : null}

              {!syllabusMode ? (
                <View style={styles.fileWrap}>
                  <Ionicons name="cloud-upload-outline" size={20} color={c.mutedText} />
                  <Text style={[styles.filePlaceholder, { color: c.mutedText }]}>
                    Select text, image, or file
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.syllabusTools}>
              <Pressable
                onPress={() => {
                  setSyllabusMode("text");
                  setSyllabusImage(null);
                  setSyllabusFile(null);
                }}
                style={[
                  styles.toolBtn,
                  {
                    borderColor: syllabusMode === "text" ? c.text : c.border,
                    backgroundColor: c.card,
                  },
                ]}
              >
                <Text style={[styles.toolText, { color: c.text }]}>T</Text>
              </Pressable>

              <Pressable
                onPress={pickSyllabusImage}
                style={[
                  styles.toolBtn,
                  {
                    borderColor: syllabusMode === "image" ? c.text : c.border,
                    backgroundColor: c.card,
                  },
                ]}
              >
                <Ionicons name="image-outline" size={20} color={c.text} />
              </Pressable>

              <Pressable
                onPress={pickSyllabusFile}
                style={[
                  styles.toolBtn,
                  {
                    borderColor: syllabusMode === "file" ? c.text : c.border,
                    backgroundColor: c.card,
                  },
                ]}
              >
                <Ionicons name="document-outline" size={20} color={c.text} />
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={showInstitutionModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInstitutionModal(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowInstitutionModal(false)}>
          <Pressable
            style={[styles.modalCard, { borderColor: c.border, backgroundColor: c.card }]}
            onPress={() => {}}
          >
            <Text style={[styles.modalTitle, { color: c.text }]}>Select Institution</Text>
            {institutions.length === 0 ? (
              <Text style={{ color: c.mutedText }}>No institutions found. Add one in Profile first.</Text>
            ) : (
              institutions.map((school) => {
                const selected = school.school_id === selectedSchoolId;
                return (
                  <Pressable
                    key={school.school_id}
                    onPress={() => {
                      setSelectedSchoolId(school.school_id);
                      setShowInstitutionModal(false);
                    }}
                    style={[
                      styles.schoolOption,
                      {
                        borderColor: selected ? c.tint : c.border,
                        backgroundColor: selected ? `${c.tint}22` : c.card,
                      },
                    ]}
                  >
                    <Text style={[styles.schoolOptionText, { color: selected ? c.tint : c.text }]}>
                      {school.name}
                    </Text>
                    {school.is_primary ? (
                      <View style={[styles.defaultPill, { borderColor: c.tint }]}>
                        <Text style={[styles.defaultPillText, { color: c.tint }]}>Default</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  screenTitle: { fontSize: TYPE_SCALE.h1, fontWeight: "700", letterSpacing: -0.2 },
  checkBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  overviewLabel: { fontSize: TYPE_SCALE.h3, fontWeight: "600", marginBottom: 8 },
  coverCard: {
    height: 120,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  coverImage: {
    width: "100%",
    height: "100%",
  },
  coverBadge: {
    position: "absolute",
    left: 12,
    bottom: 12,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  titleInput: {
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    textAlign: "center",
    fontSize: TYPE_SCALE.h1,
    fontWeight: "600",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  metaRow: {
    marginTop: 6,
    flexDirection: "row",
    gap: 8,
  },
  metaInput: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: TYPE_SCALE.body,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  institutionPicker: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: "center",
  },
  institutionText: {
    fontSize: TYPE_SCALE.body,
  },
  overviewInput: {
    marginTop: 6,
    minHeight: 74,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: TYPE_SCALE.body,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: "top",
  },
  divider: {
    height: 1,
    marginTop: 16,
    marginBottom: 12,
  },
  syllabusLabel: { fontSize: TYPE_SCALE.h3, fontWeight: "600", marginBottom: 8 },
  syllabusRow: { flexDirection: "row", gap: 12 },
  syllabusPreview: {
    flex: 1,
    minHeight: 144,
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
  },
  syllabusTools: { gap: 10 },
  toolBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  toolText: {
    fontSize: 24,
    fontWeight: "700",
  },
  syllabusTextInput: {
    minHeight: 144,
    fontSize: TYPE_SCALE.body,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: "top",
  },
  syllabusImage: { width: "100%", height: "100%" },
  fileWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  fileName: {
    textAlign: "center",
    fontSize: TYPE_SCALE.caption,
  },
  filePlaceholder: {
    textAlign: "center",
    fontSize: TYPE_SCALE.caption,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 18,
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  modalTitle: {
    fontSize: TYPE_SCALE.h2,
    fontWeight: "700",
    marginBottom: 6,
  },
  schoolOption: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  schoolOptionText: {
    flex: 1,
    fontSize: TYPE_SCALE.body,
    fontWeight: "600",
  },
  defaultPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  defaultPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
});
