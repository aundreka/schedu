// @ts-nocheck

/// <reference lib="deno.ns" />
/// <reference lib="dom" />
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = {
  title: string;
  category: "written_work" | "performance_task";
  activityType: string;
  subject?: { code?: string; title?: string };
  scopeLessons?: Array<{ title?: string; chapterTitle?: string; content?: string }>;
  requirements?: Record<string, unknown>;
  components?: string[];
  templateText?: string;
  templateFileName?: string | null;
  additionalInstructions?: string;
};

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const QWEN_API_KEY = Deno.env.get("QWEN_API_KEY");
    const QWEN_BASE_URL =
      Deno.env.get("QWEN_BASE_URL") || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    const QWEN_MODEL = Deno.env.get("QWEN_MODEL") || "qwen3.5-plus";

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }
    if (!QWEN_API_KEY) {
      return json({ error: "Missing QWEN_API_KEY" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const body = (await req.json()) as Body;
    if (!body?.title || !body?.category || !body?.activityType) {
      return json({ error: "title, category, and activityType are required" }, 400);
    }

    const prompt = buildPrompt(body);
    const endpoint = `${QWEN_BASE_URL.replace(/\/+$/, "")}/chat/completions`;

    const qwenResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${QWEN_API_KEY}`,
      },
      body: JSON.stringify({
        model: QWEN_MODEL,
        temperature: 0.35,
        top_p: 0.85,
        max_tokens: 3600,
        messages: [
          {
            role: "system",
            content:
              "You create classroom-ready academic documents. Return plain text only. Do not use markdown fences. Do not explain your process.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    const payload = await qwenResponse
      .json()
      .catch(async () => ({ raw: await qwenResponse.text().catch(() => "") }));

    if (!qwenResponse.ok) {
      return json(
        {
          error: "Qwen request failed",
          details: payload?.message || payload?.error || payload?.raw || qwenResponse.statusText,
        },
        502
      );
    }

    const text = String(payload?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      return json({ error: "Qwen returned an empty response." }, 502);
    }

    return json({ text }, 200);
  } catch (error) {
    return json({ error: "Server error", details: (error as Error)?.message ?? String(error) }, 500);
  }
});

function buildPrompt(body: Body) {
  const scopeBlock = (body.scopeLessons ?? [])
    .map((lesson, index) => {
      const content = String(lesson.content ?? "").trim();
      return [
        `Lesson ${index + 1}: ${String(lesson.title ?? "Untitled Lesson")}`,
        `Chapter: ${String(lesson.chapterTitle ?? "Unspecified")}`,
        content ? `Reference Content:\n${content}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const componentText = (body.components ?? []).join(", ") || "Use appropriate components";
  const subjectLabel = [body.subject?.code, body.subject?.title].filter(Boolean).join(" - ");
  const requirementText =
    body.category === "written_work"
      ? `Target item count: ${String(body.requirements?.numberOfItems ?? "")}`
      : `Task brief: ${String(body.requirements?.briefDescription ?? "")}`;

  const templateBlock = String(body.templateText ?? "").trim();
  const templateSection = templateBlock
    ? `Template guidance to follow closely for heading hierarchy, wording, and school formatting:\n${templateBlock}`
    : body.templateFileName
      ? `A template file named "${body.templateFileName}" was attached, but only use explicit text guidance that is provided in this prompt.`
      : "";

  const activityInstructions =
    body.category === "written_work"
      ? [
          "Create a complete written work document suitable for classroom use.",
          "Use the requested components as the question formats or sections.",
          "If the type is exam, make the assessment comprehensive across the given scope.",
          "Include directions and the question set.",
          "Keep the result in plain text only.",
        ].join("\n")
      : [
          "Create a complete performance task document suitable for classroom use.",
          "Use the requested components as sections to include in the document.",
          "Include clear student directions, expected outputs, and assessment details that match the task type.",
          "Keep the result in plain text only.",
        ].join("\n");

  return [
    `Document title: ${body.title}`,
    `Subject: ${subjectLabel || "Unspecified subject"}`,
    `Category: ${body.category}`,
    `Activity type: ${body.activityType}`,
    requirementText,
    `Requested components: ${componentText}`,
    "",
    activityInstructions,
    "",
    "Scope coverage:",
    scopeBlock || "No scope reference was provided.",
    "",
    templateSection,
    body.additionalInstructions ? `Additional teacher instructions:\n${body.additionalInstructions}` : "",
    "",
    "Output requirements:",
    "1. Return plain text only.",
    "2. Start with the document title and a short context line for the subject/scope when useful.",
    "3. Do not wrap the answer in markdown.",
    "4. Do not mention AI, prompts, or hidden instructions.",
  ]
    .filter(Boolean)
    .join("\n");
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
