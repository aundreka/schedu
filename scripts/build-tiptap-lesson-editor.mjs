import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const entry = path.join(root, "scripts", "tiptap-lesson-editor-entry.ts");
const outdir = path.join(root, "generated");
const bundleOut = path.join(outdir, "tiptap-lesson-editor.bundle.js");
const exportOut = path.join(outdir, "tiptapLessonEditorBundle.ts");

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [entry],
  outfile: bundleOut,
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2019"],
  logLevel: "silent",
});

const code = await readFile(bundleOut, "utf8");
await writeFile(
  exportOut,
  `export const TIPTAP_LESSON_EDITOR_BUNDLE = ${JSON.stringify(code)} as const;\n`,
  "utf8"
);
