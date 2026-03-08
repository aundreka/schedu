// @ts-nocheck

/// <reference lib="deno.ns" />
/// <reference lib="dom" />
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = { storagePath: string };

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const EXTRACTOR_URL = Deno.env.get("EXTRACTOR_URL");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }
    if (!EXTRACTOR_URL) {
      return json({ error: "Missing EXTRACTOR_URL" }, 500);
    }
    const extractorEndpoint = EXTRACTOR_URL.endsWith("/extract")
      ? EXTRACTOR_URL
      : `${EXTRACTOR_URL.replace(/\/+$/, "")}/extract`;

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const body = (await req.json()) as Body;
    if (!body?.storagePath) return json({ error: "storagePath is required" }, 400);

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    // ownership guard: users/<uid>/
    const expectedPrefix = `users/${userId}/`;
    if (!body.storagePath.startsWith(expectedPrefix)) {
      return json({ error: "Forbidden: file not owned by user" }, 403);
    }

    // signed URL for 10 minutes
    const BUCKET = "uploads";
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(body.storagePath, 60 * 10);

    if (signErr || !signed?.signedUrl) {
      return json({ error: "Could not create signed URL", details: signErr?.message }, 500);
    }

    let extractorRes: Response;
    try {
      extractorRes = await fetch(extractorEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signedUrl: signed.signedUrl,
          fileName: body.storagePath.split("/").pop() ?? "file.pdf",
        }),
      });
    } catch (e) {
      return json(
        {
          error: "Extractor request failed",
          details: (e as Error)?.message ?? String(e),
          extractorUrl: extractorEndpoint,
        },
        502
      );
    }

    if (!extractorRes.ok) {
      const errPayload = await extractorRes
        .json()
        .catch(async () => ({ raw: await extractorRes.text().catch(() => "") }));
      const details =
        errPayload?.details || errPayload?.error || errPayload?.message || errPayload?.raw;
      return json(
        {
          error: "Extractor failed",
          status: extractorRes.status,
          details: String(details || extractorRes.statusText || "").slice(0, 800),
          extractorUrl: extractorEndpoint,
        },
        502
      );
    }

    const result = await extractorRes.json().catch(() => ({}));
    const text = (result?.text ?? "").toString();

    return json({ text }, 200);
  } catch (e) {
    return json({ error: "Server error", details: (e as Error)?.message ?? String(e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
