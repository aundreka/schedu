import * as FileSystem from "expo-file-system/legacy";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { supabase } from "./supabase";

export type ActivityCategory = "written_work" | "performance_task";

export type WrittenWorkType = "quiz" | "assignment" | "seatwork" | "exam";
export type PerformanceTaskType = "project" | "lab_report" | "activity" | "other";
export type ActivityType = WrittenWorkType | PerformanceTaskType;

export type ActivityComponent = {
  key: string;
  label: string;
  tone?: "yellow" | "blue";
};

export type SubjectOption = {
  subject_id: string;
  school_id: string;
  code: string;
  title: string;
};

export type ScopeLesson = {
  lesson_id: string;
  title: string;
  content: string | null;
  chapterTitle: string;
  chapterSequence: number;
  lessonSequence: number;
};

export type PickedAsset = {
  uri: string;
  name: string;
  mimeType: string;
};

export const WRITTEN_WORK_TYPES: { key: WrittenWorkType; label: string }[] = [
  { key: "quiz", label: "Quiz" },
  { key: "assignment", label: "Assignment" },
  { key: "seatwork", label: "Seatwork" },
  { key: "exam", label: "Exam" },
];

export const PERFORMANCE_TASK_TYPES: { key: PerformanceTaskType; label: string }[] = [
  { key: "project", label: "Project" },
  { key: "lab_report", label: "Lab Report" },
  { key: "activity", label: "Activity" },
  { key: "other", label: "Other" },
];

export const WRITTEN_WORK_COMPONENTS: ActivityComponent[] = [
  { key: "multiple_choice", label: "Multiple Choice", tone: "yellow" },
  { key: "true_false", label: "True or False" },
  { key: "identification", label: "Identification" },
  { key: "matching_type", label: "Matching Type" },
  { key: "enumeration", label: "Enumeration", tone: "blue" },
  { key: "essay", label: "Essay" },
];

export const PERFORMANCE_TASK_COMPONENTS: ActivityComponent[] = [
  { key: "instructions", label: "Instructions" },
  { key: "objectives", label: "Objectives" },
  { key: "deliverables", label: "Deliverables" },
  { key: "rubric", label: "Rubric" },
  { key: "grading_sheet", label: "Grading Sheet" },
];

export function getActivityTypeLabel(type: ActivityType | "") {
  const match = [...WRITTEN_WORK_TYPES, ...PERFORMANCE_TASK_TYPES].find((item) => item.key === type);
  return match?.label ?? "Activity Type";
}

export function getCategoryLabel(category: ActivityCategory | null) {
  if (category === "written_work") return "Written Work";
  if (category === "performance_task") return "Performance Task";
  return "Category";
}

export function getActivityComponents(category: ActivityCategory | null) {
  return category === "performance_task" ? PERFORMANCE_TASK_COMPONENTS : WRITTEN_WORK_COMPONENTS;
}

export function buildScopeSummary(scopeLessons: ScopeLesson[]) {
  if (scopeLessons.length === 0) return "Scope";
  if (scopeLessons.length === 1) return scopeLessons[0].title;
  return `${scopeLessons.length} lessons selected`;
}

export function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

export function guessMimeType(name: string, fallback?: string | null) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return fallback || "application/octet-stream";
}

export async function readUriAsArrayBuffer(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function uploadUriAsset(params: {
  uri: string;
  userId: string;
  fileName: string;
  mimeType: string;
  folder: string;
}) {
  const { uri, userId, fileName, mimeType, folder } = params;
  const safeName = sanitizeFileName(fileName);
  const path = `users/${userId}/activities/${folder}_${Date.now()}_${safeName}`;
  const body = await readUriAsArrayBuffer(uri);
  const { error } = await supabase.storage.from("uploads").upload(path, body, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw error;
  return path;
}

export async function extractPdfTextFromStoragePath(storagePath: string) {
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

export async function readTemplateText(params: {
  asset: PickedAsset | null;
  userId: string;
}) {
  const { asset, userId } = params;
  if (!asset) {
    return { storagePath: null, extractedText: "" };
  }

  const mimeType = asset.mimeType || guessMimeType(asset.name, "application/octet-stream");
  const storagePath = await uploadUriAsset({
    uri: asset.uri,
    userId,
    fileName: asset.name,
    mimeType,
    folder: "template",
  });

  if (mimeType === "application/pdf") {
    return {
      storagePath,
      extractedText: await extractPdfTextFromStoragePath(storagePath),
    };
  }

  if (mimeType === "text/plain") {
    return {
      storagePath,
      extractedText: await FileSystem.readAsStringAsync(asset.uri, { encoding: "utf8" }),
    };
  }

  return {
    storagePath,
    extractedText: "",
  };
}

function splitWrappedLines(text: string, maxChars = 92) {
  const paragraphs = text.replace(/\r\n?/g, "\n").split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trimEnd();
    if (!trimmed) {
      lines.push("");
      continue;
    }

    const words = trimmed.split(/\s+/);
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }

  return lines;
}

export async function createActivityPdf(params: {
  title: string;
  subjectLabel: string;
  typeLabel: string;
  scopeSummary: string;
  text: string;
}) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageSize: [number, number] = [612, 792];
  const marginX = 48;
  const topMargin = 54;
  const bottomMargin = 54;
  const lineHeight = 16;
  const bodyFontSize = 11;

  const lines = [
    params.title,
    `${params.subjectLabel} | ${params.typeLabel}`,
    `Coverage: ${params.scopeSummary || "Not specified"}`,
    "",
    ...splitWrappedLines(params.text),
  ];

  let page = pdfDoc.addPage(pageSize);
  let y = pageSize[1] - topMargin;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isHeading = index === 0;
    const fontToUse = isHeading ? boldFont : font;
    const sizeToUse = isHeading ? 15 : bodyFontSize;

    if (y < bottomMargin) {
      page = pdfDoc.addPage(pageSize);
      y = pageSize[1] - topMargin;
    }

    if (line.length > 0) {
      page.drawText(line, {
        x: marginX,
        y,
        size: sizeToUse,
        font: fontToUse,
        color: rgb(0.08, 0.08, 0.08),
        maxWidth: pageSize[0] - marginX * 2,
      });
    }

    y -= isHeading ? 24 : lineHeight;
  }

  const base64 = await pdfDoc.saveAsBase64({ dataUri: false });
  const path = `${FileSystem.cacheDirectory}activity_${Date.now()}.pdf`;
  await FileSystem.writeAsStringAsync(path, base64, { encoding: "base64" });
  return path;
}

export async function createActivityDocx(params: {
  title: string;
  subjectLabel: string;
  typeLabel: string;
  scopeSummary: string;
  text: string;
}) {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun(params.title)],
    }),
    new Paragraph({
      children: [new TextRun(`${params.subjectLabel} | ${params.typeLabel}`)],
    }),
    new Paragraph({
      children: [new TextRun(`Coverage: ${params.scopeSummary || "Not specified"}`)],
    }),
    new Paragraph({ children: [new TextRun("")] }),
  ];

  const bodyLines = params.text.replace(/\r\n?/g, "\n").split("\n");
  for (const line of bodyLines) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun(line)],
      })
    );
  }

  const doc = new Document({
    sections: [{ children: paragraphs }],
  });

  const base64 = await Packer.toBase64String(doc);
  const path = `${FileSystem.cacheDirectory}activity_${Date.now()}.docx`;
  await FileSystem.writeAsStringAsync(path, base64, { encoding: "base64" });
  return path;
}

export async function shareLocalFile(uri: string) {
  const Sharing = await import("expo-sharing");
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("File sharing is not available on this device.");
  }
  await Sharing.shareAsync(uri);
}
