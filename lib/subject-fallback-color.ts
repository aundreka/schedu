const SUBJECT_FALLBACK_COLORS = [
  "#4C6A92",
  "#4F7D61",
  "#A04F3F",
  "#6B579D",
  "#B04F73",
  "#2F7782",
  "#8A6A33",
  "#5F6872",
  "#3F7C6D",
  "#8B5A44",
  "#5868A8",
  "#9B5558",
] as const;

export function getSubjectFallbackColor(seed: string | null | undefined) {
  const input = seed?.trim() || "subject";
  let hash = 0;

  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }

  return SUBJECT_FALLBACK_COLORS[hash % SUBJECT_FALLBACK_COLORS.length];
}
