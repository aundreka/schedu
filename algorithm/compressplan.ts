import { applyTermRepairResult, compressTermUsingCapacity } from "./repopulateplan";
import type { Block, SessionSlot, TermSchedulingDiagnostics } from "./types";

type TermCompressionContext = {
  termSlots: SessionSlot[];
  blocks: Block[];
};

export function compressTermPlan(context: TermCompressionContext): TermSchedulingDiagnostics {
  const result = compressTermUsingCapacity({
    termSlots: context.termSlots,
    blocks: context.blocks,
  });
  applyTermRepairResult(context.termSlots, result);
  return result.diagnostics;
}
