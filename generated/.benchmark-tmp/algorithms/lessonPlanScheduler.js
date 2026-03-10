"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULER_ALGORITHMS = void 0;
exports.generateSchedulePlan = generateSchedulePlan;
exports.generateScheduledEntries = generateScheduledEntries;
exports.SCHEDULER_ALGORITHMS = [
    {
        id: "rules_engine",
        label: "Rules Engine",
        description: "Deterministic scheduling based on hard/soft pedagogical constraints.",
        theory: "Constraint-based curriculum scheduling",
    },
];
const WEEKDAY_INDEX = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
};
const TARGET_CATEGORIES = new Set(["lesson", "review", "written_work", "performance_task", "exam"]);
const WW_SUBTYPES = ["seatwork", "assignment", "quiz"];
const PT_SUBTYPES = ["activity", "project"];
function toLocalDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
function parseDate(iso) {
    const [y, m, d] = iso.split("-").map((part) => Number(part));
    return new Date(y, (m || 1) - 1, d || 1);
}
function eachDate(startIso, endIso) {
    const start = parseDate(startIso);
    const end = parseDate(endIso);
    const dates = [];
    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        dates.push(toLocalDateString(cursor));
    }
    return dates;
}
function plusDays(iso, days) {
    const date = parseDate(iso);
    date.setDate(date.getDate() + days);
    return toLocalDateString(date);
}
function parseCount(value) {
    if (!value)
        return 0;
    const matched = value.match(/\d+/);
    if (!matched)
        return 0;
    const count = Number(matched[0]);
    return Number.isFinite(count) ? count : 0;
}
function parseLessonNumber(title) {
    const matched = title.match(/lesson\s*(\d+)/i);
    if (!matched)
        return Number.MAX_SAFE_INTEGER;
    return Number(matched[1]);
}
function parseMinutes(start, end) {
    if (!start || !end)
        return 60;
    const [sh, sm] = start.split(":").map((x) => Number(x));
    const [eh, em] = end.split(":").map((x) => Number(x));
    if (!Number.isFinite(sh) || !Number.isFinite(sm) || !Number.isFinite(eh) || !Number.isFinite(em))
        return 60;
    const s = sh * 60 + sm;
    const e = eh * 60 + em;
    if (e <= s)
        return 60;
    return e - s;
}
function makeGeneratedEntry(input, slot, category, title, description, subtype) {
    return {
        plan_entry_id: "",
        lesson_plan_id: input.lessonPlanId,
        title,
        category,
        description,
        scheduled_date: slot.date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        entry_type: "planned_item",
        day: null,
        room: null,
        instance_no: null,
        lesson_id: null,
        lesson_chapter_id: null,
        lesson_estimated_minutes: null,
        is_locked: false,
        ww_subtype: category === "written_work" ? subtype ?? "seatwork" : null,
        pt_subtype: category === "performance_task" ? subtype ?? "activity" : null,
    };
}
function buildMeetingSlots(input) {
    const recurringRows = input.entries
        .filter((entry) => entry.entry_type === "recurring_class" && Boolean(entry.day))
        .sort((a, b) => {
        const weekdayA = WEEKDAY_INDEX[a.day ?? ""] ?? 99;
        const weekdayB = WEEKDAY_INDEX[b.day ?? ""] ?? 99;
        if (weekdayA !== weekdayB)
            return weekdayA - weekdayB;
        return (a.start_time ?? "99:99:99").localeCompare(b.start_time ?? "99:99:99");
    });
    const rawSlots = [];
    for (const date of eachDate(input.startDate, input.endDate)) {
        const weekday = parseDate(date).getDay();
        const rows = recurringRows.filter((row) => WEEKDAY_INDEX[row.day ?? ""] === weekday);
        for (const row of rows) {
            const minutes = parseMinutes(row.start_time ?? null, row.end_time ?? null);
            rawSlots.push({
                index: rawSlots.length,
                date,
                start_time: row.start_time ?? null,
                end_time: row.end_time ?? null,
                hours: Number((minutes / 60).toFixed(2)),
                minutes,
            });
        }
    }
    if (rawSlots.length === 0) {
        for (const date of eachDate(input.startDate, input.endDate)) {
            rawSlots.push({
                index: rawSlots.length,
                date,
                start_time: null,
                end_time: null,
                hours: 1,
                minutes: 60,
            });
        }
    }
    let cumulativeHours = 0;
    return rawSlots.map((slot) => {
        cumulativeHours += slot.hours;
        return {
            ...slot,
            window: Math.floor((cumulativeHours - 0.0001) / 5),
        };
    });
}
function findSlotByDate(slots, dateIso) {
    for (let i = 0; i < slots.length; i += 1) {
        if (slots[i].date === dateIso)
            return i;
    }
    return -1;
}
function pickEvenlyIndexes(count, indexes) {
    if (count <= 0 || indexes.length === 0)
        return [];
    const out = [];
    for (let i = 0; i < count; i += 1) {
        const ratio = (i + 1) / (count + 1);
        out.push(indexes[Math.floor(ratio * indexes.length)] ?? indexes[indexes.length - 1]);
    }
    return out;
}
function findNextSlot(plans, startAt, options) {
    for (let i = Math.max(0, startAt); i < plans.length; i += 1) {
        const row = plans[i];
        if (!options.allowLocked && row.locked)
            continue;
        if (row.other)
            continue;
        if (options.noLesson && row.lesson)
            continue;
        return i;
    }
    return -1;
}
function buildChapterIds(lessonEntries) {
    const sorted = [...lessonEntries].sort((a, b) => parseLessonNumber(a.title) - parseLessonNumber(b.title));
    let fallbackChapter = 1;
    return sorted.map((entry, i) => {
        const byJoin = entry.lesson_chapter_id ?? null;
        if (byJoin)
            return byJoin;
        const matched = (entry.description ?? "").match(/chapter\s*(\d+)/i);
        if (matched)
            return `chapter_${matched[1]}`;
        if (i % 3 === 0 && i > 0)
            fallbackChapter += 1;
        return `chapter_fallback_${fallbackChapter}`;
    });
}
function addDiagnostic(diags, code, tier, passed, message) {
    diags.push({ code, tier, passed, message });
}
function generateSchedulePlan(input) {
    const diagnostics = [];
    const blackout = new Set(input.blackoutDates ?? []);
    const slots = buildMeetingSlots(input);
    if (slots.length === 0) {
        addDiagnostic(diagnostics, "NO_SLOTS", "hard", false, "No meeting slots available.");
        return {
            entries: [],
            diagnostics: {
                feasible: false,
                hardViolations: 1,
                softViolations: 0,
                constraints: diagnostics,
            },
        };
    }
    const fixedEntries = input.entries.filter((entry) => {
        if (entry.entry_type === "recurring_class")
            return false;
        if (!entry.scheduled_date)
            return false;
        return !TARGET_CATEGORIES.has(entry.category);
    });
    const plans = slots.map(() => ({ lesson: null, other: null, locked: false }));
    const lockedRows = input.entries.filter((entry) => entry.is_locked &&
        entry.entry_type !== "recurring_class" &&
        entry.scheduled_date &&
        TARGET_CATEGORIES.has(entry.category));
    lockedRows.forEach((row) => {
        const idx = findSlotByDate(slots, String(row.scheduled_date));
        if (idx < 0) {
            addDiagnostic(diagnostics, "LOCKED_OUT_OF_RANGE", "hard", false, `Locked entry out of plan range: ${row.title}`);
            return;
        }
        if (row.category === "lesson")
            plans[idx].lesson = row;
        else
            plans[idx].other = row;
        plans[idx].locked = true;
    });
    const lessonTemplates = input.entries
        .filter((entry) => entry.entry_type !== "recurring_class" && entry.category === "lesson")
        .sort((a, b) => parseLessonNumber(a.title) - parseLessonNumber(b.title));
    const wwRows = input.entries.filter((entry) => entry.entry_type !== "recurring_class" && entry.category === "written_work");
    const ptRows = input.entries.filter((entry) => entry.entry_type !== "recurring_class" && entry.category === "performance_task");
    const examRows = input.entries.filter((entry) => entry.entry_type !== "recurring_class" && entry.category === "exam");
    const baseWwCount = wwRows.map((x) => parseCount(x.description)).reduce((a, b) => a + b, 0) || wwRows.length;
    const basePtCount = ptRows.map((x) => parseCount(x.description)).reduce((a, b) => a + b, 0) || ptRows.length;
    const examCount = examRows.map((x) => parseCount(x.description)).reduce((a, b) => a + b, 0) || examRows.length;
    // Hard: exams cannot be on blackout.
    const candidateExamIndexes = slots
        .map((slot, idx) => ({ idx, slot }))
        .filter((x) => x.idx >= Math.floor(slots.length * 0.72) && !blackout.has(x.slot.date))
        .map((x) => x.idx);
    const fallbackExamIndexes = slots.map((_, i) => i).filter((i) => !blackout.has(slots[i].date));
    const examIndexes = pickEvenlyIndexes(Math.max(1, examCount), candidateExamIndexes.length > 0 ? candidateExamIndexes : fallbackExamIndexes);
    if (examIndexes.length < Math.max(1, examCount)) {
        addDiagnostic(diagnostics, "EXAM_CAPACITY", "hard", false, "Not enough non-blackout slots to place exams.");
    }
    examIndexes.forEach((slotIndex, i) => {
        const slot = slots[slotIndex];
        if (plans[slotIndex].other && !plans[slotIndex].locked)
            return;
        plans[slotIndex].other = makeGeneratedEntry(input, slot, "exam", `Exam ${i + 1}`, "Major examination");
        const d1 = plusDays(slot.date, -1);
        const d2 = plusDays(slot.date, -2);
        const r1 = !blackout.has(d1) ? findSlotByDate(slots, d1) : -1;
        const r2 = !blackout.has(d2) ? findSlotByDate(slots, d2) : -1;
        const reviewIndex = r1 >= 0 ? r1 : r2;
        if (reviewIndex >= 0 && !plans[reviewIndex].other && !plans[reviewIndex].locked) {
            plans[reviewIndex].other = makeGeneratedEntry(input, slots[reviewIndex], "review", `Review ${i + 1}`, "Exam review");
        }
        else {
            addDiagnostic(diagnostics, "REVIEW_DAY_GAP", "hard", false, `Could not place review 1-2 calendar days before Exam ${i + 1}.`);
        }
    });
    // Dynamic lesson span based on estimated minutes and meeting duration.
    const lessonPlacements = [];
    const chapterIds = buildChapterIds(lessonTemplates);
    let lessonCursor = 0;
    for (let i = 0; i < slots.length && lessonCursor < lessonTemplates.length; i += 1) {
        if (plans[i].other)
            continue;
        if (plans[i].locked && !plans[i].lesson)
            continue;
        if (blackout.has(slots[i].date))
            continue;
        const lessonTemplate = lessonTemplates[lessonCursor];
        const estMinutes = Math.max(1, lessonTemplate.lesson_estimated_minutes ?? 60);
        const span = Math.max(1, Math.min(3, Math.ceil(estMinutes / Math.max(1, slots[i].minutes))));
        let assignedSpan = 0;
        for (let s = i; s < slots.length && assignedSpan < span; s += 1) {
            if (plans[s].other || plans[s].lesson || plans[s].locked || blackout.has(slots[s].date))
                break;
            const partTitle = span > 1 ? `${lessonTemplate.title} (Part ${assignedSpan + 1}/${span})` : lessonTemplate.title;
            plans[s].lesson = makeGeneratedEntry(input, slots[s], "lesson", partTitle, lessonTemplate.description);
            plans[s].lesson.lesson_estimated_minutes = lessonTemplate.lesson_estimated_minutes ?? null;
            lessonPlacements.push({
                lesson: lessonTemplate,
                slotIndex: s,
                chapterId: chapterIds[lessonCursor] ?? `chapter_fallback_${lessonCursor + 1}`,
            });
            assignedSpan += 1;
        }
        lessonCursor += 1;
    }
    if (lessonCursor < lessonTemplates.length) {
        addDiagnostic(diagnostics, "LESSON_CAPACITY", "hard", false, `${lessonTemplates.length - lessonCursor} lesson(s) could not be scheduled within 1-3 meeting span rule.`);
    }
    // Per lesson: assignment OR activity.
    const activityTarget = Math.min(basePtCount, Math.floor(lessonTemplates.length / 2));
    let activitiesAssigned = 0;
    let assignmentNo = 1;
    let activityNo = 1;
    const lessonFirstSlotById = new Map();
    lessonPlacements.forEach((row) => {
        const key = row.lesson.plan_entry_id;
        if (!lessonFirstSlotById.has(key))
            lessonFirstSlotById.set(key, row.slotIndex);
    });
    Array.from(lessonFirstSlotById.entries()).forEach(([lessonId, baseSlot], idx) => {
        const shouldActivity = activitiesAssigned < activityTarget && idx % 2 === 1;
        const subtype = shouldActivity ? "activity" : "assignment";
        const category = shouldActivity ? "performance_task" : "written_work";
        const slotIndex = findNextSlot(plans, baseSlot + 1, { noLesson: true });
        if (slotIndex < 0)
            return;
        if (shouldActivity) {
            plans[slotIndex].other = makeGeneratedEntry(input, slots[slotIndex], category, `Activity ${activityNo}`, `For lesson ${lessonId}`, subtype);
            activityNo += 1;
            activitiesAssigned += 1;
        }
        else {
            plans[slotIndex].other = makeGeneratedEntry(input, slots[slotIndex], category, `Assignment ${assignmentNo}`, `For lesson ${lessonId}`, subtype);
            assignmentNo += 1;
        }
    });
    // Quiz per chapter.
    const chapterLastSlot = new Map();
    lessonPlacements.forEach((item) => {
        chapterLastSlot.set(item.chapterId, item.slotIndex);
    });
    let quizNo = 1;
    Array.from(chapterLastSlot.entries())
        .sort((a, b) => a[1] - b[1])
        .forEach(([chapterId, lastSlot]) => {
        const slotIndex = findNextSlot(plans, lastSlot + 1, { noLesson: true });
        if (slotIndex < 0)
            return;
        plans[slotIndex].other = makeGeneratedEntry(input, slots[slotIndex], "written_work", `Quiz ${quizNo}`, `Chapter ${chapterId.replace("chapter_", "")}`, "quiz");
        quizNo += 1;
    });
    // Project + 1..3 prep meetings.
    let remainingPt = Math.max(0, basePtCount - activitiesAssigned);
    if (remainingPt > 0) {
        const projectDueSlot = findNextSlot(plans, Math.floor(slots.length * 0.68), { noLesson: true });
        if (projectDueSlot >= 0) {
            plans[projectDueSlot].other = makeGeneratedEntry(input, slots[projectDueSlot], "performance_task", "Project", "Project output submission", "project");
            remainingPt -= 1;
            const prepMeetings = Math.min(3, Math.max(1, remainingPt));
            let prepNo = 1;
            for (let s = projectDueSlot - 1; s >= 0 && prepNo <= prepMeetings; s -= 1) {
                if (plans[s].other || plans[s].lesson || plans[s].locked || blackout.has(slots[s].date))
                    continue;
                plans[s].other = makeGeneratedEntry(input, slots[s], "performance_task", "Project", `Project preparation ${prepNo}`, "project");
                prepNo += 1;
                remainingPt -= 1;
            }
            if (prepNo === 1) {
                addDiagnostic(diagnostics, "PROJECT_PREP", "hard", false, "No project prep meeting could be placed.");
            }
        }
        else {
            addDiagnostic(diagnostics, "PROJECT_SLOT", "hard", false, "No available slot for project submission.");
        }
    }
    // 5-hour window WW/PT limits.
    const windows = new Map();
    slots.forEach((slot, idx) => {
        const current = windows.get(slot.window) ?? { ww: 0, pt: 0, slotIndexes: [] };
        current.slotIndexes.push(idx);
        const other = plans[idx].other;
        if (other?.category === "written_work")
            current.ww += 1;
        if (other?.category === "performance_task")
            current.pt += 1;
        windows.set(slot.window, current);
    });
    let seatworkNo = 1;
    for (const [window, stats] of windows.entries()) {
        if (stats.ww < 1) {
            const slotIndex = stats.slotIndexes.find((idx) => !plans[idx].other && !plans[idx].lesson && !plans[idx].locked) ??
                stats.slotIndexes.find((idx) => !plans[idx].other && !plans[idx].locked) ??
                -1;
            if (slotIndex >= 0) {
                plans[slotIndex].other = makeGeneratedEntry(input, slots[slotIndex], "written_work", `Seatwork ${seatworkNo}`, `Window ${window + 1}`, "seatwork");
                seatworkNo += 1;
                stats.ww += 1;
            }
            else {
                addDiagnostic(diagnostics, "WINDOW_WW_MIN", "hard", false, `Window ${window + 1} has no slot available to satisfy minimum written work.`);
            }
        }
        if (stats.ww > 3) {
            addDiagnostic(diagnostics, "WINDOW_WW_MAX", "hard", false, `Window ${window + 1} exceeds maximum written work (3).`);
        }
        if (stats.pt > 2) {
            addDiagnostic(diagnostics, "WINDOW_PT_MAX", "hard", false, `Window ${window + 1} exceeds maximum performance tasks (2).`);
        }
    }
    // Soft: avoid lesson + WW in same meeting unless cramped.
    const overlaps = plans.filter((p) => p.lesson && p.other?.category === "written_work").length;
    addDiagnostic(diagnostics, "LESSON_WW_OVERLAP", "soft", overlaps === 0, overlaps === 0 ? "No lesson-written_work overlap." : `${overlaps} meeting(s) have lesson + written work due to capacity.`);
    // Hard: blackout protection for review/exam.
    const blackoutViolations = plans.filter((p, idx) => blackout.has(slots[idx].date) && (p.other?.category === "review" || p.other?.category === "exam")).length;
    addDiagnostic(diagnostics, "BLACKOUT_REVIEW_EXAM", "hard", blackoutViolations === 0, blackoutViolations === 0
        ? "No review/exam placed on blackout dates."
        : `${blackoutViolations} review/exam item(s) were placed on blackout dates.`);
    const generated = [];
    let generatedId = 1;
    plans.forEach((plan) => {
        if (plan.lesson) {
            generated.push({ ...plan.lesson, plan_entry_id: `generated_rule_${generatedId++}` });
        }
        if (plan.other) {
            generated.push({ ...plan.other, plan_entry_id: `generated_rule_${generatedId++}` });
        }
    });
    const hardViolations = diagnostics.filter((d) => d.tier === "hard" && !d.passed).length;
    const softViolations = diagnostics.filter((d) => d.tier === "soft" && !d.passed).length;
    addDiagnostic(diagnostics, "LOCKED_PRESERVED", "hard", true, `${lockedRows.length} locked entries preserved in-place (teacher override).`);
    addDiagnostic(diagnostics, "SUBTYPE_MODELING", "soft", true, `WW subtypes: ${WW_SUBTYPES.join("/")}; PT subtypes: ${PT_SUBTYPES.join("/")}.`);
    return {
        entries: [...fixedEntries, ...generated],
        diagnostics: {
            feasible: hardViolations === 0,
            hardViolations,
            softViolations,
            constraints: diagnostics,
        },
    };
}
function generateScheduledEntries(input) {
    return generateSchedulePlan(input).entries;
}
