import { TIPTAP_LESSON_EDITOR_BUNDLE } from "../generated/tiptapLessonEditorBundle";

export type ParagraphAlignment = "left" | "center" | "right";

export type EditorCommand =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "strike" }
  | { type: "bullet" }
  | { type: "align"; value: ParagraphAlignment }
  | { type: "link"; url: string }
  | { type: "code" }
  | { type: "set-content"; html: string };

export type WebMessage =
  | { type: "ready" }
  | { type: "content"; html: string }
  | { type: "height"; height: number }
  | {
      type: "state";
      state: {
        bold: boolean;
        italic: boolean;
        underline: boolean;
        strike: boolean;
        bullet: boolean;
        link: boolean;
        code: boolean;
        align: ParagraphAlignment;
      };
    };

export type LessonDetailRecord = {
  lesson_id: string;
  title: string;
  sequence_no: number;
  content: string | null;
  chapter_title: string | null;
  subject_id: string | null;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function readParam(value?: string | string[]) {
  if (!value) return "";
  return Array.isArray(value) ? String(value[0] ?? "") : String(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, token: string) => {
    const normalized = token.toLowerCase();

    if (normalized[0] === "#") {
      const isHex = normalized[1] === "x";
      const digits = isHex ? normalized.slice(2) : normalized.slice(1);
      const codePoint = Number.parseInt(digits, isHex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    return NAMED_ENTITIES[normalized] ?? entity;
  });
}

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*?>/i.test(value);
}

export function extractLessonContent(raw: string | null) {
  if (!raw?.trim()) return "";

  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.topics)) {
      return parsed.topics
        .flatMap((topic: any) => {
          const title = typeof topic?.title === "string" ? topic.title.trim() : "";
          const body = typeof topic?.body === "string" ? topic.body.trim() : "";
          return [title, body].filter(Boolean);
        })
        .join("\n\n");
    }
  } catch {}

  return raw;
}

export function normalizeToHtml(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "<p></p>";

  if (looksLikeHtml(trimmed)) return trimmed;

  const decoded = decodeHtmlEntities(trimmed).trim();
  if (looksLikeHtml(decoded)) return decoded;

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function tiptapDocumentHtml(config: { editable: boolean; initialHtml: string }) {
  const { editable, initialHtml } = config;
  const serializedHtml = JSON.stringify(initialHtml).replace(/<\/script/gi, "<\\/script");

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #111827;
      }
      .lesson-editor {
        min-height: 560px;
        padding: 12px 10px 40px;
        outline: none;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 16px;
        line-height: 1.6;
        box-sizing: border-box;
      }
      .lesson-editor p {
        margin: 0 0 12px;
      }
      .lesson-editor p:last-child {
        margin-bottom: 0;
      }
      .lesson-editor a.lesson-link {
        color: #2563eb;
        text-decoration: underline;
      }
      .lesson-editor pre {
        position: relative;
        margin: 14px 0;
        background: #0d1117;
        color: #e6edf3;
        border: 1px solid #1f2937;
        border-radius: 14px;
        padding: 14px 16px 14px 54px;
        font-family: "SFMono-Regular", Menlo, Consolas, monospace;
        font-size: 13px;
        line-height: 1.6;
        overflow-x: auto;
        white-space: pre;
      }
      .lesson-editor .code-line-gutter {
        position: absolute;
        left: 0;
        top: 14px;
        bottom: 14px;
        width: 36px;
        padding: 0 8px 0 10px;
        border-right: 1px solid #1f2937;
        color: #8b949e;
        text-align: right;
        white-space: pre;
        pointer-events: none;
        user-select: none;
      }
      .lesson-editor pre code {
        display: block;
        background: transparent;
        padding: 0;
        border-radius: 0;
        color: inherit;
      }
      .lesson-editor :not(pre) > code {
        font-family: "SFMono-Regular", Menlo, Consolas, monospace;
        background: #f3f4f6;
        border-radius: 4px;
        padding: 1px 4px;
      }
      .lesson-editor ul {
        margin: 0 0 12px 22px;
        padding: 0;
      }
      .lesson-editor li {
        margin: 0 0 6px;
      }
      .lesson-editor [style*="text-align: left"] { text-align: left; }
      .lesson-editor [style*="text-align: center"] { text-align: center; }
      .lesson-editor [style*="text-align: right"] { text-align: right; }
    </style>
  </head>
  <body>
    <div id="editor-root"></div>
    <script>
      ${TIPTAP_LESSON_EDITOR_BUNDLE}
      const root = document.getElementById("editor-root");
      const editor = window.createLessonEditor({
        element: root,
        editable: ${editable ? "true" : "false"},
        initialContent: ${serializedHtml},
      });
      window.__lessonEditor = editor;
    </script>
  </body>
</html>`;
}
