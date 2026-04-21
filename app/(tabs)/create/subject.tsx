import { useCallback, useEffect, useMemo, useState } from "react";
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
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { useAppTheme } from "../../../context/theme";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import { supabase } from "../../../lib/supabase";
import wordnetIndex from "../../../generated/wordnet-index.json";

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
  description?: string | null;
};

type OutlineChapter = {
  tempId: string;
  title: string;
  sequenceNo: number;
  unitTempId: string | null;
  description?: string | null;
};

type OutlineLesson = {
  title: string;
  sequenceNo: number;
  chapterTempId: string;
  learningObjectives?: string | null;
  content?: string | null;
};

type ParsedOutline = {
  units: OutlineUnit[];
  chapters: OutlineChapter[];
  lessons: OutlineLesson[];
};

type WordnetIndexShape = {
  by_initial?: Record<string, string[]>;
};

const WORDNET_BY_INITIAL = ((wordnetIndex as WordnetIndexShape).by_initial ?? {}) as Record<
  string,
  string[]
>;
const WORDNET_SET_CACHE = new Map<string, Set<string>>();

function getWordnetBucket(initial: string) {
  return WORDNET_BY_INITIAL[initial] ?? [];
}

function getWordnetBucketSet(initial: string) {
  const cached = WORDNET_SET_CACHE.get(initial);
  if (cached) return cached;
  const created = new Set(getWordnetBucket(initial));
  WORDNET_SET_CACHE.set(initial, created);
  return created;
}

function applyOriginalCase(original: string, replacement: string) {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function boundedLevenshtein(a: string, b: string, maxDistance: number) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }

  return prev[b.length];
}

function correctWordWithWordnet(token: string) {
  if (!/^[A-Za-z]{4,24}$/.test(token)) return token;
  const lower = token.toLowerCase();
  const initial = lower[0];
  const bucket = getWordnetBucket(initial);
  if (bucket.length === 0) return token;
  if (getWordnetBucketSet(initial).has(lower)) return token;

  let bestWord: string | null = null;
  let bestDistance = 3;
  for (const candidate of bucket) {
    if (Math.abs(candidate.length - lower.length) > 2) continue;
    const distance = boundedLevenshtein(lower, candidate, 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestWord = candidate;
      if (distance === 1) break;
    }
  }

  if (!bestWord || bestDistance > 2) return token;
  return applyOriginalCase(token, bestWord);
}

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

function formatAcademicYear(startYear: number) {
  return `${startYear}-${startYear + 1}`;
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

function normalizeSyllabusText(rawText: string) {
  const baseLines = rawText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").replace(/[ ]{2,}/g, " ").trim())
    .map((line) => line.replace(/^[\u2022\u2023\u25E6\u2043\u2219*•·●▪◦\-]+\s*/g, "").trim())
    .filter((line) => line.length >= 3 && line.length <= 220)
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !/^page\s+\d+$/i.test(line));

  const lines: string[] = [];
  for (let i = 0; i < baseLines.length; i += 1) {
    const current = baseLines[i]
      .replace(/\b(Unit|Chapter|Lesson)\s*([0-9IVXLCDM]+)\b/gi, "$1 $2")
      .replace(/\bLesson\s*O\b/gi, "Lesson 0");
    const next = baseLines[i + 1] ?? "";

    // OCR sometimes splits: "Unit" + "I Things Around You".
    if (/^unit$/i.test(current)) {
      const continuation = next.match(/^([IVXLCDM]+)\s+(.+)$/i);
      if (continuation) {
        lines.push(`Unit ${continuation[1]} ${continuation[2]}`.trim());
        i += 1;
        continue;
      }
      const looseContinuation = next.match(/^[)\]}.,\s-]*([A-Za-z].+)$/);
      if (looseContinuation && !/^(chapter|lesson|unit)\b/i.test(looseContinuation[1])) {
        lines.push(`Unit ${looseContinuation[1]}`.trim());
        i += 1;
        continue;
      }
    }

    // OCR sometimes prefixes headings with noise chars, e.g. "o Lesson 2", "a Chapter 2".
    const cleanedHeadingPrefix = current.replace(/^(?:[A-Za-z]{1,2})\s+(?=(unit|chapter|lesson)\b)/i, "");
    lines.push(cleanedHeadingPrefix.trim());
  }

  return lines;
}

function stripNumberingPrefix(text: string) {
  return text.replace(/^([A-Z]|\d+|[IVXLCDM]+)([.\-:)\]])\s*/i, "").trim();
}

function stripTrailingPageNumber(text: string) {
  return text.replace(/\s+\d{1,4}\s*$/, "").trim();
}

function parseRomanNumeral(token: string) {
  const value = token.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(value)) return null;
  const map: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };
  let total = 0;
  for (let i = 0; i < value.length; i += 1) {
    const current = map[value[i]];
    const next = map[value[i + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  return total > 0 ? total : null;
}

function parseHeadingSequence(token: string | null, type: "unit" | "chapter" | "lesson") {
  if (!token) return null;
  const normalized = token.trim();
  if (!normalized) return null;

  if (/^\d+$/.test(normalized)) return Number(normalized);
  if (/^[IVXLCDM]+$/i.test(normalized)) return parseRomanNumeral(normalized);

  if (type === "lesson" && /^[0-9IVXLCDM]+([.\-][0-9IVXLCDM]+)+$/i.test(normalized)) {
    const pieces = normalized.split(/[.\-]/).filter(Boolean);
    const last = pieces[pieces.length - 1];
    if (/^\d+$/.test(last)) return Number(last);
    return parseRomanNumeral(last);
  }

  return null;
}

function isWeakOutlineTitle(text: string) {
  const value = text.trim();
  if (!value) return true;
  if (!/[A-Za-z]/.test(value)) return true;
  return /^([A-Z]|\d+|[IVXLCDM]+)([.\-]\d+)?$/i.test(value);
}

function replaceWholeWordInsensitive(text: string, wrong: string, correct: string) {
  const pattern = new RegExp(`\\b${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  return text.replace(pattern, (matched) => {
    if (matched === matched.toUpperCase()) return correct.toUpperCase();
    if (matched[0] === matched[0].toUpperCase()) return correct[0].toUpperCase() + correct.slice(1);
    return correct;
  });
}

function fixCommonOcrTypos(text: string) {
  let next = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bSiz\b/g, "Size")
    .replace(/\bthout\b/gi, "without")
    .replace(/\bNervoUs\b/g, "Nervous")
    .replace(/^[^A-Za-z0-9]+/, "");

  const dictionary: [string, string][] = [
    ["eorth", "earth"],
    ["spcca", "space"],
    ["chartges", "changes"],
    ["earh", "earth"],
    ["wegther", "weather"],
    ["paitermsin", "patterns in"],
    ["phutipjines", "philippines"],
    ["mofion", "motion"],
    ["soldr", "solar"],
    ["oendocrine", "endocrine"],
  ];

  for (const [wrong, correct] of dictionary) {
    next = replaceWholeWordInsensitive(next, wrong, correct);
  }

  next = next.replace(/\b[A-Za-z]{4,24}\b/g, (word) => correctWordWithWordnet(word));

  return next;
}

function cleanOutlineTitle(text: string) {
  const normalized = fixCommonOcrTypos(
    stripTrailingPageNumber(stripNumberingPrefix(text))
    .replace(/[|]+/g, " ")
    .replace(/[.]{2,}/g, " ")
    .replace(/\s+[A-Za-z]*\d+[A-Za-z]+\s*$/, "")
    .replace(/[.:;\-]+$/, "")
    .replace(/[ ]{2,}/g, " ")
    .trim()
  );
  return isWeakOutlineTitle(normalized) ? null : normalized;
}

function formatOutlineTitle(text: string) {
  const cleaned = cleanOutlineTitle(text);
  if (!cleaned) return null;

  const normalized = cleaned
    .replace(/\s+/g, " ")
    .replace(/[.]+$/, "")
    .trim();

  if (!normalized || normalized.length > 90) return null;

  if (normalized === normalized.toUpperCase() && /[A-Z]{3,}/.test(normalized)) {
    return normalized
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .replace(/\b(And|Or|Of|For|To|With|In|On|The|A|An)\b/g, (word, offset) =>
        offset === 0 ? word : word.toLowerCase()
      );
  }

  return normalized;
}

function formatOutlineBodyLine(text: string) {
  const cleaned = fixCommonOcrTypos(
    stripTrailingPageNumber(text)
      .replace(/[|]+/g, " ")
      .replace(/[ ]{2,}/g, " ")
      .trim()
  )
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 4) return null;
  if (/^(contents|table of contents)$/i.test(cleaned)) return null;
  return cleaned;
}

function normalizeBulletObjective(text: string) {
  const cleaned = formatOutlineBodyLine(
    text.replace(/^(?:[\u2022\u2023\u25E6\u2043\u2219*•·●▪◦-]|\d+[.)]?|[A-Za-z][.)]?)\s+/, "")
  );
  if (!cleaned) return null;
  return cleaned.replace(/[.;:]+$/, "").trim();
}

function parseHeading(line: string, type: "unit" | "chapter" | "lesson") {
  const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokenPattern =
    type === "lesson"
      ? "[0-9IVXLCDM]+(?:[.\\-][0-9IVXLCDM]+)*"
      : "[0-9IVXLCDM]+";
  const headingRegex = new RegExp(
    `^${escaped}\\s*(${tokenPattern})?(?:\\s*[:.\\-\\)\\]]\\s*|\\s+)?(.+)?$`,
    "i"
  );
  const match = line.match(headingRegex);
  if (!match) return null;

  const rawTitle = (match[2] ?? "").trim();
  const cleanTitle = cleanOutlineTitle(rawTitle);
  const seqToken = (match[1] ?? "").trim();
  if (type === "chapter" && !seqToken && cleanTitle && /^(test|review|assessment)$/i.test(cleanTitle)) {
    return null;
  }
  return {
    token: seqToken || null,
    title: cleanTitle || null,
  };
}

function parseAnyHeading(line: string) {
  return parseHeading(line, "unit") || parseHeading(line, "chapter") || parseHeading(line, "lesson");
}

function isObjectiveHeading(line: string) {
  return /^(learning objectives?|intended learning outcomes?|objectives?|outcomes?)$/i.test(line.trim());
}

function isObjectiveLeadIn(line: string) {
  return /^(at the end of (?:the )?(?:lesson|chapter|unit)|students (?:should|will|are expected to) be able to)\b/i.test(
    line.trim()
  );
}

function isLikelyObjectiveItem(line: string) {
  const value = line.trim();
  if (!value) return false;
  if (/^[\u2022\u2023\u25E6\u2043\u2219*•·●▪◦\-]/.test(value)) return true;
  if (/^\d+[.)]\s+/.test(value)) return true;
  if (/^[a-z][.)]\s+/i.test(value)) return true;
  return /^(identify|describe|explain|differentiate|analyze|analyse|compare|classify|solve|construct|apply|demonstrate|evaluate|illustrate|discuss|define|interpret|use|create|relate|recognize|outline|summarize)\b/i.test(
    value
  );
}

function joinParagraphLines(lines: string[]) {
  const cleaned = lines.map((line) => formatOutlineBodyLine(line)).filter((line): line is string => Boolean(line));
  return cleaned.length > 0 ? cleaned.join(" ") : null;
}

function formatObjectives(items: string[]) {
  const cleaned = items
    .map((item) => normalizeBulletObjective(item))
    .filter((item): item is string => Boolean(item));
  return cleaned.length > 0 ? cleaned.map((item) => `- ${item}`).join("\n") : null;
}

function isLikelyTitleNoise(line: string) {
  const value = line.trim();
  if (!value) return true;
  if (/^contents$/i.test(value)) return true;
  if (/^table of contents$/i.test(value)) return true;
  if (/^preface\.?$/i.test(value)) return true;
  if (/^welcome to /i.test(value)) return true;
  if (/^chapter test$/i.test(value)) return true;
  if (/^science in action$/i.test(value)) return true;
  if (/^digital adventures in science$/i.test(value)) return true;
  if (/reproduced|without written|thout written/i.test(value)) return true;
  if (value.length < 4) return true;
  if (!/[A-Za-z]/.test(value)) return true;
  if (/\d/.test(value) && !/^(Unit|Chapter|Lesson)\s+/i.test(value)) return true;
  if (/^[a-z\s.,'|-]+$/.test(value) && !/^(and|or|of|for|to|with|in|on)\b/.test(value)) return true;
  if (/^[A-Za-z]+\s*[0-9]+$/.test(value)) return true;

  const tokens = value
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length >= 2) {
    const knownWords = new Set([
      "earth",
      "space",
      "science",
      "matter",
      "mixtures",
      "characteristics",
      "homogeneous",
      "heterogeneous",
      "separating",
      "components",
      "living",
      "things",
      "environment",
      "different",
      "systems",
      "human",
      "body",
      "integumentary",
      "musculoskeletal",
      "digestive",
      "excretory",
      "respiratory",
      "circulatory",
      "nervous",
      "endocrine",
      "diversity",
      "animals",
      "vertebrates",
      "invertebrates",
      "plate",
      "tectonics",
      "galaxies",
      "universe",
      "electromagnetic",
      "waves",
      "spectrum",
      "light",
      "optics",
      "reflection",
      "image",
      "formation",
      "refraction",
      "lenses",
      "changes",
      "shape",
      "size",
      "state",
      "states",
      "solids",
      "liquids",
      "gases",
      "and",
      "the",
      "of",
      "to",
      "in",
      "their",
    ]);
    const knownCount = tokens.filter((token) => knownWords.has(token)).length;
    const suspiciousCount = tokens.filter((token) => /[a-z][A-Z]/.test(token) || !/[aeiou]/i.test(token)).length;
    if (knownCount === 0 && suspiciousCount >= Math.ceil(tokens.length / 2)) return true;
  }

  return false;
}

function mergeContinuationTitles(lines: string[]) {
  const merged: string[] = [];
  for (const line of lines) {
    if (merged.length === 0) {
      merged.push(line);
      continue;
    }

    const previous = merged[merged.length - 1];
    if (/^(and|or|of|for|to|with|in|on)\b/i.test(line) && /[,;:]$/.test(previous)) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${line}`.replace(/[ ]{2,}/g, " ").trim();
      continue;
    }

    merged.push(line);
  }
  return merged;
}

type ParsedSequenceEntry = {
  value: number;
  explicit: boolean;
};

function normalizeLikelyOcrSequence(entries: ParsedSequenceEntry[]) {
  if (entries.length < 3) return entries.map((entry) => entry.value);

  let bestStart = -1;
  let bestLength = 1;
  let i = 0;
  while (i < entries.length - 1) {
    if (entries[i + 1].value !== entries[i].value + 1) {
      i += 1;
      continue;
    }
    let end = i + 1;
    while (end + 1 < entries.length && entries[end + 1].value === entries[end].value + 1) {
      end += 1;
    }
    const length = end - i + 1;
    if (length > bestLength) {
      bestStart = i;
      bestLength = length;
    }
    i = end + 1;
  }

  if (bestStart < 0 || bestLength < 2) return entries.map((entry) => entry.value);

  const result = entries.map((entry) => entry.value);
  const anchorIndex = bestStart;
  const anchorValue = entries[anchorIndex].value;

  for (let index = 0; index < entries.length; index += 1) {
    if (index >= bestStart && index < bestStart + bestLength) continue;

    const expected = anchorValue + (index - anchorIndex);
    if (expected < 1) continue;

    const current = entries[index];
    const difference = Math.abs(current.value - expected);
    if (difference < 2) continue;

    if (current.explicit || difference >= 4) {
      result[index] = expected;
    }
  }

  return result;
}

function parseOutlineFromText(rawText: string): ParsedOutline {
  const lines = normalizeSyllabusText(rawText);
  const units: OutlineUnit[] = [];
  const chapters: OutlineChapter[] = [];
  const lessons: OutlineLesson[] = [];
  const chapterIndicesByBucket = new Map<string, number[]>();
  const lessonIndicesByChapterTempId = new Map<string, number[]>();
  const chapterHadExplicitSeq = new Map<string, boolean>();
  const lessonHadExplicitSeq = new Map<string, boolean[]>();
  const candidateTitleLinesByBucket = new Map<string, string[]>();
  const lessonCountByChapterTempId = new Map<string, number>();
  const nextLessonSequenceByChapterTempId = new Map<string, number>();
  let nextChapterSequence = 1;

  let currentUnitTempId: string | null = null;
  let currentChapterTempId: string | null = null;
  let currentLessonIndex: number | null = null;
  let collectingObjectives = false;
  let objectiveItems: string[] = [];
  let pendingDescriptionLines: string[] = [];
  const rootBucketKey = "__root__";

  const getBucketKey = (unitTempId: string | null) => unitTempId ?? rootBucketKey;
  const pushCandidate = (bucketKey: string, title: string) => {
    const list = candidateTitleLinesByBucket.get(bucketKey) ?? [];
    list.push(title);
    candidateTitleLinesByBucket.set(bucketKey, list);
  };
  const pushChapterIndex = (bucketKey: string, chapterIndex: number) => {
    const list = chapterIndicesByBucket.get(bucketKey) ?? [];
    list.push(chapterIndex);
    chapterIndicesByBucket.set(bucketKey, list);
  };
  const ensureChapterForCurrentScope = () => {
    const chapterTempId = `c_${chapters.length + 1}`;
    const bucketKey = getBucketKey(currentUnitTempId);
    const sequenceNo = nextChapterSequence;
    nextChapterSequence += 1;
    chapters.push({
      tempId: chapterTempId,
      title: "",
      sequenceNo,
      unitTempId: currentUnitTempId,
    });
    pushChapterIndex(bucketKey, chapters.length - 1);
    lessonIndicesByChapterTempId.set(chapterTempId, []);
    lessonHadExplicitSeq.set(chapterTempId, []);
    lessonCountByChapterTempId.set(chapterTempId, 0);
    nextLessonSequenceByChapterTempId.set(chapterTempId, 1);
    chapterHadExplicitSeq.set(chapterTempId, false);
    currentChapterTempId = chapterTempId;
    return chapterTempId;
  };

  const flushCurrentLessonObjectives = () => {
    if (currentLessonIndex === null) return;
    const lesson = lessons[currentLessonIndex];
    if (!lesson) return;
    if (objectiveItems.length === 0) return;
    lesson.learningObjectives = formatObjectives(objectiveItems);
    objectiveItems = [];
  };

  const appendDescriptionToCurrentScope = () => {
    const description = joinParagraphLines(pendingDescriptionLines);
    pendingDescriptionLines = [];
    if (!description) return;

    if (currentLessonIndex !== null && lessons[currentLessonIndex]) {
      const existing = lessons[currentLessonIndex].content?.trim();
      lessons[currentLessonIndex].content = existing ? `${existing}\n\n${description}` : description;
      return;
    }

    if (currentChapterTempId) {
      const chapter = chapters.find((entry) => entry.tempId === currentChapterTempId);
      if (chapter) {
        const existing = chapter.description?.trim();
        chapter.description = existing ? `${existing}\n\n${description}` : description;
        return;
      }
    }

    if (currentUnitTempId) {
      const unit = units.find((entry) => entry.tempId === currentUnitTempId);
      if (unit) {
        const existing = unit.description?.trim();
        unit.description = existing ? `${existing}\n\n${description}` : description;
      }
    }
  };

  const flushScopeBuffers = () => {
    flushCurrentLessonObjectives();
    collectingObjectives = false;
    appendDescriptionToCurrentScope();
  };

  for (const line of lines) {
    if (isObjectiveHeading(line)) {
      appendDescriptionToCurrentScope();
      flushCurrentLessonObjectives();
      collectingObjectives = true;
      continue;
    }

    if (parseAnyHeading(line)) {
      flushScopeBuffers();
    }

    const unitMatch = parseHeading(line, "unit");
    if (unitMatch) {
      const tempId = `u_${units.length + 1}`;
      const fallback = unitMatch.token ? `Unit ${unitMatch.token}` : `Unit ${units.length + 1}`;
      units.push({
        tempId,
        title: formatOutlineTitle(unitMatch.title ?? fallback) ?? fallback,
        sequenceNo: units.length + 1,
        description: null,
      });
      currentUnitTempId = tempId;
      currentChapterTempId = null;
      currentLessonIndex = null;
      continue;
    }

    const chapterMatch = parseHeading(line, "chapter");
    if (chapterMatch) {
      const tempId = `c_${chapters.length + 1}`;
      const parsedChapterSeq = parseHeadingSequence(chapterMatch.token, "chapter");
      const chapterSequenceNo = parsedChapterSeq ?? nextChapterSequence;
      nextChapterSequence = Math.max(nextChapterSequence, chapterSequenceNo + 1);
      const fallback = chapterMatch.token
        ? `Chapter ${chapterMatch.token}`
        : `Chapter ${chapterSequenceNo}`;
      chapters.push({
        tempId,
        title: formatOutlineTitle(chapterMatch.title ?? fallback) ?? fallback,
        sequenceNo: chapterSequenceNo,
        unitTempId: currentUnitTempId,
        description: null,
      });
      pushChapterIndex(getBucketKey(currentUnitTempId), chapters.length - 1);
      lessonIndicesByChapterTempId.set(tempId, []);
      lessonHadExplicitSeq.set(tempId, []);
      lessonCountByChapterTempId.set(tempId, 0);
      nextLessonSequenceByChapterTempId.set(tempId, 1);
      chapterHadExplicitSeq.set(tempId, parsedChapterSeq !== null);
      currentChapterTempId = tempId;
      currentLessonIndex = null;
      continue;
    }

    const lessonMatch = parseHeading(line, "lesson");
    if (lessonMatch) {
      const chapterTempId = currentChapterTempId ?? ensureChapterForCurrentScope();
      const chapterLessonCount = lessonCountByChapterTempId.get(chapterTempId) ?? 0;
      const parsedLessonSeq = parseHeadingSequence(lessonMatch.token, "lesson");
      const nextLessonSequence = nextLessonSequenceByChapterTempId.get(chapterTempId) ?? 1;
      const lessonSequenceNo = parsedLessonSeq ?? nextLessonSequence;
      nextLessonSequenceByChapterTempId.set(
        chapterTempId,
        Math.max(nextLessonSequence, lessonSequenceNo + 1)
      );
      const fallback = lessonMatch.token
        ? `Lesson ${lessonMatch.token}`
        : `Lesson ${lessonSequenceNo}`;

      lessons.push({
        title: formatOutlineTitle(lessonMatch.title ?? fallback) ?? fallback,
        sequenceNo: lessonSequenceNo,
        chapterTempId,
        learningObjectives: null,
        content: null,
      });
      const lessonIndex = lessons.length - 1;
      const lessonIndices = lessonIndicesByChapterTempId.get(chapterTempId) ?? [];
      lessonIndices.push(lessonIndex);
      lessonIndicesByChapterTempId.set(chapterTempId, lessonIndices);
      const lessonExplicitFlags = lessonHadExplicitSeq.get(chapterTempId) ?? [];
      lessonExplicitFlags.push(parsedLessonSeq !== null);
      lessonHadExplicitSeq.set(chapterTempId, lessonExplicitFlags);
      lessonCountByChapterTempId.set(chapterTempId, chapterLessonCount + 1);
      currentLessonIndex = lessonIndex;
      continue;
    }

    const cleanedTitle = cleanOutlineTitle(line);
    if (!cleanedTitle || isLikelyTitleNoise(cleanedTitle) || parseAnyHeading(cleanedTitle)) continue;

    if (collectingObjectives || isObjectiveLeadIn(line) || isLikelyObjectiveItem(line)) {
      collectingObjectives = true;
      const normalizedObjective = normalizeBulletObjective(line);
      if (normalizedObjective) {
        objectiveItems.push(normalizedObjective);
      }
      continue;
    }

    const formattedBody = formatOutlineBodyLine(line);
    if (formattedBody && (currentChapterTempId || currentUnitTempId)) {
      pendingDescriptionLines.push(formattedBody);
      continue;
    }

    pushCandidate(getBucketKey(currentUnitTempId), formatOutlineTitle(cleanedTitle) ?? cleanedTitle);
  }

  flushScopeBuffers();

  // Normalize OCR outliers (e.g., 1, 9, 10, 11 -> 8, 9, 10, 11).
  const chapterEntries = chapters.map((chapter) => ({
    value: chapter.sequenceNo,
    explicit: chapterHadExplicitSeq.get(chapter.tempId) ?? false,
  }));
  const normalizedChapterSequence = normalizeLikelyOcrSequence(chapterEntries);
  chapters.forEach((chapter, index) => {
    chapter.sequenceNo = normalizedChapterSequence[index] ?? chapter.sequenceNo;
    if (/^Chapter\s+[A-Za-z0-9.\-]+\s*$/i.test(chapter.title)) {
      chapter.title = `Chapter ${chapter.sequenceNo}`;
    }
  });

  for (const chapter of chapters) {
    const lessonIndices = lessonIndicesByChapterTempId.get(chapter.tempId) ?? [];
    if (lessonIndices.length === 0) continue;
    const explicitFlags = lessonHadExplicitSeq.get(chapter.tempId) ?? [];
    const lessonEntries = lessonIndices.map((lessonIndex, offset) => ({
      value: lessons[lessonIndex]?.sequenceNo ?? offset + 1,
      explicit: explicitFlags[offset] ?? false,
    }));
    const normalizedLessonSequence = normalizeLikelyOcrSequence(lessonEntries);
    lessonIndices.forEach((lessonIndex, offset) => {
      const lesson = lessons[lessonIndex];
      if (!lesson) return;
      lesson.sequenceNo = normalizedLessonSequence[offset] ?? lesson.sequenceNo;
      if (/^Lesson\s+[A-Za-z0-9.\-]+\s*$/i.test(lesson.title)) {
        lesson.title = `Lesson ${lesson.sequenceNo}`;
      }
    });
  }

  const assignSequentialTitles = (bucketKey: string, unitIndex: number | null) => {
    const candidates = mergeContinuationTitles(candidateTitleLinesByBucket.get(bucketKey) ?? []);
    if (candidates.length === 0) return;

    let pointer = 0;
    if (unitIndex !== null && units[unitIndex] && /^Unit\s+/i.test(units[unitIndex].title)) {
      units[unitIndex].title = formatOutlineTitle(candidates[pointer] ?? "") ?? units[unitIndex].title;
      pointer += 1;
    }

    const chapterIndices = chapterIndicesByBucket.get(bucketKey) ?? [];
    for (const chapterIndex of chapterIndices) {
      const chapter = chapters[chapterIndex];
      if (!chapter) continue;

      if (/^Chapter\s+/i.test(chapter.title) && pointer < candidates.length) {
        chapter.title = formatOutlineTitle(candidates[pointer]) ?? chapter.title;
        pointer += 1;
      }

      const lessonIndices = lessonIndicesByChapterTempId.get(chapter.tempId) ?? [];
      for (const lessonIndex of lessonIndices) {
        const lesson = lessons[lessonIndex];
        if (!lesson) continue;
        if (/^Lesson\s+/i.test(lesson.title) && pointer < candidates.length) {
          lesson.title = formatOutlineTitle(candidates[pointer]) ?? lesson.title;
          pointer += 1;
        }
      }
    }
  };

  for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
    assignSequentialTitles(units[unitIndex].tempId, unitIndex);
  }
  assignSequentialTitles(rootBucketKey, null);

  // Fallback for plain TOCs without explicit unit/chapter/lesson keywords.
  if (chapters.length === 0 && lessons.length === 0) {
    const plainCandidates = mergeContinuationTitles(
      lines
        .map((line) => cleanOutlineTitle(line))
        .filter((line): line is string => Boolean(line))
        .filter((line) => !isLikelyTitleNoise(line) && !parseAnyHeading(line))
    );
    if (plainCandidates.length > 0) {
      const fallbackChapterTempId = "c_1";
      chapters.push({
        tempId: fallbackChapterTempId,
        title: "Outline",
        sequenceNo: 1,
        unitTempId: null,
      });
      plainCandidates.forEach((title, index) => {
        lessons.push({
          title: formatOutlineTitle(title) ?? title,
          sequenceNo: index + 1,
          chapterTempId: fallbackChapterTempId,
          learningObjectives: null,
          content: null,
        });
      });
    }
  }

  return { units, chapters, lessons };
}

function dumpExtractedOutlineDebug(rawText: string, source: SyllabusMode) {
  const rawLines = rawText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const normalizedLines = normalizeSyllabusText(rawText);
  const numberedLines = normalizedLines.map((line, index) => `${index + 1}. ${line}`);
  const consoleDump = [
    "[Outline Debug Dump]",
    `Source: ${source ?? "unknown"}`,
    `Raw text chars: ${rawText.length}`,
    `Raw line count: ${rawLines.length}`,
    `Normalized line count: ${normalizedLines.length}`,
    numberedLines.join("\n"),
  ].join("\n");

  console.log(consoleDump);

  const preview = numberedLines.slice(0, 18).join("\n");
  const suffix =
    numberedLines.length > 18
      ? `\n\n...and ${numberedLines.length - 18} more line(s). Full dump is in console logs.`
      : "";

  Alert.alert(
    "OCR Debug Dump",
    `Source: ${source ?? "unknown"}\nNormalized lines: ${numberedLines.length}\n\n${preview}${suffix}`
  );
}

function isMissingUnitSchema(error: any) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    message.includes("relation") && message.includes("units") && message.includes("does not exist")
  );
}

async function persistOutline(params: { subjectId: string; rawText: string; outline?: ParsedOutline }) {
  const { subjectId, rawText, outline: preParsedOutline } = params;
  const outline = preParsedOutline ?? parseOutlineFromText(rawText);
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
          description: unit.description ?? null,
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
      description: chapter.description ?? null,
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
      content: lesson.content ?? null,
      learning_objectives: lesson.learningObjectives ?? null,
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
  const nowYear = new Date().getFullYear();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [institutions, setInstitutions] = useState<Institution[]>([]);

  const [overview, setOverview] = useState("");
  const [title, setTitle] = useState("");
  const [subjectCode, setSubjectCode] = useState("");
  const [year, setYear] = useState("");
  const [schoolYearStart, setSchoolYearStart] = useState<number | null>(null);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>("");
  const [schoolYearPickerOpen, setSchoolYearPickerOpen] = useState(false);
  const [schoolYearPickerYear, setSchoolYearPickerYear] = useState(nowYear);
  const [coverImageUri, setCoverImageUri] = useState<string | null>(null);
  const [syllabusMode, setSyllabusMode] = useState<SyllabusMode>(null);
  const [syllabusText, setSyllabusText] = useState("");
  const [syllabusImage, setSyllabusImage] = useState<PickedFile | null>(null);
  const [syllabusFile, setSyllabusFile] = useState<PickedFile | null>(null);

  const academicYear = useMemo(() => {
    if (!schoolYearStart) return "";
    return formatAcademicYear(schoolYearStart);
  }, [schoolYearStart]);

  const loadSubjectForm = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    loadSubjectForm();
  }, [loadSubjectForm]);

  const { refreshing, onRefresh } = usePullToRefresh(loadSubjectForm);

  const openSchoolYearPicker = () => {
    setSchoolYearPickerYear(schoolYearStart ?? nowYear);
    setSchoolYearPickerOpen(true);
  };

  const applyPickedSchoolYear = () => {
    setSchoolYearStart(schoolYearPickerYear);
    setSchoolYearPickerOpen(false);
  };

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
    const normalizedAcademicYear = academicYear.trim();
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
      let parsedDetectedOutline: ParsedOutline | null = null;

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

      if (__DEV__ && detectedOutlineText.trim()) {
        dumpExtractedOutlineDebug(detectedOutlineText, syllabusMode);
      }
      if (detectedOutlineText.trim()) {
        parsedDetectedOutline = parseOutlineFromText(detectedOutlineText);
      }

      const { data: created, error: subjectError } = await supabase
        .from("subjects")
        .insert({
          school_id: selectedSchoolId,
          code: normalizedCode,
          title: normalizedTitle,
          year: normalizedYear || null,
          academic_year: normalizedAcademicYear || null,
          subject_image: subjectImagePath,
          syllabus: syllabusValue,
          syllabus_kind: syllabusKind,
          syllabus_mime_type: syllabusMimeType,
          description: normalizedOverview || null,
          unit_no:
            parsedDetectedOutline && parsedDetectedOutline.units.length > 0
              ? parsedDetectedOutline.units.length
              : null,
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
            outline: parsedDetectedOutline ?? undefined,
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
      setSchoolYearStart(null);
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
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}
        >
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
              placeholder="Year Level"
              placeholderTextColor={c.mutedText}
              style={[
                styles.metaCompactInput,
                {
                  color: c.text,
                  borderColor: c.border,
                  backgroundColor: c.card,
                },
              ]}
            />
            <View
              style={[
                styles.schoolPickerWrap,
                {
                  borderColor: c.border,
                  backgroundColor: c.card,
                },
              ]}
            >
              <Picker
                enabled={institutions.length > 0}
                selectedValue={selectedSchoolId}
                onValueChange={(value) => setSelectedSchoolId(String(value))}
                style={[styles.schoolPicker, { color: selectedSchoolId ? c.text : c.mutedText }]}
              >
                {institutions.length === 0 ? (
                  <Picker.Item label="No schools found" value="" color={c.mutedText} />
                ) : null}
                {institutions.map((school) => (
                  <Picker.Item key={school.school_id} label={school.name} value={school.school_id} />
                ))}
              </Picker>
            </View>
          </View>

          <View style={styles.metaRow}>
            <Pressable
              onPress={openSchoolYearPicker}
              style={[
                styles.institutionPicker,
                {
                  borderColor: c.border,
                  backgroundColor: c.card,
                },
              ]}
            >
              <Text style={[styles.institutionText, { color: schoolYearStart ? c.text : c.mutedText }]}>
                {schoolYearStart ? academicYear : "Pick School Year"}
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
        visible={schoolYearPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSchoolYearPickerOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSchoolYearPickerOpen(false)}>
          <Pressable
            style={[styles.dateModalCard, { borderColor: c.border, backgroundColor: c.card }]}
            onPress={() => {}}
          >
            <Text style={[styles.modalTitle, { color: c.text }]}>Pick School Year</Text>
            <View style={styles.yearPickerCol}>
              <Picker
                selectedValue={schoolYearPickerYear}
                onValueChange={(value) => setSchoolYearPickerYear(Number(value))}
              >
                {Array.from({ length: 16 }).map((_, index) => {
                  const pickerYear = nowYear - 5 + index;
                  return (
                    <Picker.Item
                      key={pickerYear}
                      label={formatAcademicYear(pickerYear)}
                      value={pickerYear}
                    />
                  );
                })}
              </Picker>
            </View>
            <Pressable
              style={[styles.modalDoneButton, { backgroundColor: c.tint }]}
              onPress={applyPickedSchoolYear}
            >
              <Text style={styles.modalDoneButtonText}>Set Year</Text>
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
  metaCompactInput: {
    flex: 0.9,
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
  schoolPickerWrap: {
    flex: 1.15,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    overflow: "hidden",
  },
  schoolPicker: {
    width: "100%",
    height: 44,
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
  dateModalCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  yearPickerCol: {
    minHeight: 180,
    justifyContent: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 18,
  },
  modalTitle: {
    fontSize: TYPE_SCALE.h2,
    fontWeight: "700",
    marginBottom: 6,
  },
  modalDoneButton: {
    alignSelf: "flex-end",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalDoneButtonText: {
    color: "#FFFFFF",
    fontSize: TYPE_SCALE.body,
    fontWeight: "700",
  },
});
