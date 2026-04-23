import type { Block, Placement, SessionSlot } from "./types";

type TermCompressionContext = {
  termSlots: SessionSlot[];
  blocks: Block[];
};

function placementId(blockId: string, slotId: string, order: number) {
  return `placement__${blockId}__${slotId}__${order}`;
}

function findSlotIndex(termSlots: SessionSlot[], blockId: string) {
  return termSlots.findIndex((slot) => slot.placements.some((placement) => placement.blockId === blockId));
}

function movePlacementToSlot(
  sourceSlot: SessionSlot,
  targetSlot: SessionSlot,
  blockId: string,
  lane: Placement["lane"]
) {
  const moving = sourceSlot.placements.find((placement) => placement.blockId === blockId);
  if (!moving) return false;
  sourceSlot.placements = sourceSlot.placements.filter((placement) => placement.blockId !== blockId);
  targetSlot.placements.push({
    ...moving,
    id: placementId(blockId, targetSlot.id, targetSlot.placements.length + 1),
    slotId: targetSlot.id,
    lane,
  });
  return true;
}

export function compressTermPlan(context: TermCompressionContext) {
  const { termSlots, blocks } = context;
  const examBlock = blocks.find((block) => block.type === "exam") ?? null;
  const futureDelayCount = Number(examBlock?.metadata.futureDelayCount ?? 0);
  let extraTermSlots = Number(examBlock?.metadata.extraTermSlots ?? 0) - futureDelayCount;
  if (extraTermSlots >= 0) return;

  const lessons = blocks
    .filter((block) => block.type === "lesson" && !block.metadata.extraCandidateType)
    .sort((a, b) => Number(a.metadata.lessonOrder ?? 0) - Number(b.metadata.lessonOrder ?? 0));
  const writtenWorks = blocks
    .filter((block) => block.type === "written_work" && block.subcategory !== "quiz" && !block.metadata.extraCandidateType)
    .sort((a, b) => Number(a.metadata.wwOrder ?? 0) - Number(b.metadata.wwOrder ?? 0));
  const performanceTasks = blocks
    .filter((block) => block.type === "performance_task" && !block.metadata.extraCandidateType)
    .sort((a, b) => Number(a.metadata.ptOrder ?? 0) - Number(b.metadata.ptOrder ?? 0));

  while (extraTermSlots < 0) {
    let changed = false;

    for (const ww of writtenWorks) {
      const wwSlotIndex = findSlotIndex(termSlots, ww.id);
      const lesson = lessons.find((candidate) => Number(candidate.metadata.lessonOrder ?? 0) > 1 && findSlotIndex(termSlots, candidate.id) >= 0);
      if (!lesson || wwSlotIndex < 0) continue;
      const lessonSlotIndex = findSlotIndex(termSlots, lesson.id);
      if (lessonSlotIndex < 0 || lessonSlotIndex === wwSlotIndex) continue;
      const wwSlot = termSlots[wwSlotIndex]!;
      const lessonSlot = termSlots[lessonSlotIndex]!;
      if (movePlacementToSlot(wwSlot, lessonSlot, ww.id, "minor")) {
        extraTermSlots += 1;
        changed = true;
        break;
      }
    }

    if (extraTermSlots >= 0) break;

    if (!changed && performanceTasks.length > 2) {
      for (const pt of performanceTasks) {
        const ptSlotIndex = findSlotIndex(termSlots, pt.id);
        if (ptSlotIndex <= 0) continue;
        const sourceSlot = termSlots[ptSlotIndex]!;
        const targetSlot = termSlots[ptSlotIndex - 1]!;
        if (movePlacementToSlot(sourceSlot, targetSlot, pt.id, "minor")) {
          extraTermSlots += 1;
          changed = true;
          break;
        }
      }
    }

    if (!changed) break;
  }
}
