import type { Block } from "./types";

export type ScheduleTier = "guaranteed" | "elastic";

function extraCandidateType(block: Block) {
  return typeof block.metadata.extraCandidateType === "string"
    ? String(block.metadata.extraCandidateType)
    : null;
}

export function getScheduleTier(block: Block): ScheduleTier {
  const explicit = block.metadata.scheduleTier;
  if (explicit === "guaranteed" || explicit === "elastic") return explicit;
  if (Boolean(block.metadata.manual)) return "guaranteed";
  if (block.type === "exam") return "guaranteed";
  if (block.type === "buffer" && block.subcategory === "orientation") return "guaranteed";
  if (extraCandidateType(block)) return "elastic";
  if (block.required) return "guaranteed";
  if (block.metadata.lowPriority) return "elastic";
  return "guaranteed";
}

export function isGuaranteedBlock(block: Block) {
  return getScheduleTier(block) === "guaranteed";
}

export function isElasticBlock(block: Block) {
  return getScheduleTier(block) === "elastic";
}

export function getDropPriority(block: Block) {
  const explicit = Number(block.metadata.dropPriority ?? NaN);
  if (Number.isFinite(explicit)) return explicit;
  const extraType = extraCandidateType(block);
  if (extraType === "review_before_quiz") return 10;
  if (extraType === "review_before_exam") return 20;
  if (extraType === "lesson_extension") return 30;
  if (extraType === "pt_extension") return 40;
  if (extraType === "extra_written_work") return 50;
  if (extraType === "extra_performance_task") return 60;
  return isElasticBlock(block) ? 100 : 0;
}
