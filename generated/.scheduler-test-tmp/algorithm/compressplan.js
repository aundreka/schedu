"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compressTermPlan = compressTermPlan;
const repopulateplan_1 = require("./repopulateplan");
function compressTermPlan(context) {
    const result = (0, repopulateplan_1.compressTermUsingCapacity)({
        termSlots: context.termSlots,
        blocks: context.blocks,
    });
    (0, repopulateplan_1.applyTermRepairResult)(context.termSlots, result);
    return result.diagnostics;
}
