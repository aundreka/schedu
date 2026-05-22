function stringifyDetail(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function getResponseFromError(error: unknown) {
  const context = (error as { context?: unknown } | null)?.context;
  if (!context || typeof context !== "object") return null;
  if (!("status" in context)) return null;
  return context as Response;
}

async function readErrorPayload(response: Response | null | undefined) {
  if (!response) return null;

  let source = response;
  if (typeof response.clone === "function") {
    try {
      source = response.clone();
    } catch {
      source = response;
    }
  }

  const body = await source.text().catch(() => "");
  if (!body) return null;

  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return { raw: body };
  }
}

function getPayloadMessage(payload: Record<string, unknown> | null) {
  if (!payload) return "";
  return stringifyDetail(payload.details ?? payload.message ?? payload.error ?? payload.raw);
}

export async function formatEdgeFunctionError(
  functionName: string,
  error: unknown,
  response?: Response | null
) {
  const functionResponse = response ?? getResponseFromError(error);
  const payload = await readErrorPayload(functionResponse);
  const serverMessage = getPayloadMessage(payload);
  const fallbackMessage = error instanceof Error ? error.message : "Edge Function failed.";
  const details = serverMessage || fallbackMessage;
  const status = functionResponse?.status;

  return status ? `${functionName} failed (${status}): ${details}` : `${functionName} failed: ${details}`;
}
