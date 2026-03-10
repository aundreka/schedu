"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULER_ALGORITHMS = void 0;
exports.generateSchedulePlan = generateSchedulePlan;
exports.generateScheduledEntries = generateScheduledEntries;
exports.SCHEDULER_ALGORITHMS = [
    {
        id: "rules_engine",
        label: "Rules Engine",
        description: "Lesson-anchored deterministic scheduling with blackout-aware reflow.",
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
function normalizeWeekday(day) {
    if (!day)
        return null;
    const key = day.trim().toLowerCase();
    if (WEEKDAY_INDEX[key] !== undefined)
        return key;
    if (key.startsWith("mon"))
        return "monday";
    if (key.startsWith("tue"))
        return "tuesday";
    if (key.startsWith("wed"))
        return "wednesday";
    if (key.startsWith("thu"))
        return "thursday";
    if (key.startsWith("fri"))
        return "friday";
    if (key.startsWith("sat"))
        return "saturday";
    if (key.startsWith("sun"))
        return "sunday";
    return null;
}
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
function toMeetingType(value) {
    if (!value)
        return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === "lecture" || normalized === "laboratory")
        return normalized;
    return null;
}
function addDiagnostic(diags, code, tier, passed, message) {
    const sameCodeCount = diags.filter((d) => d.code === code || d.code.startsWith(`${code}__`)).length;
    const uniqueCode = sameCodeCount === 0 ? code : `${code}__${sameCodeCount + 1}`;
    diags.push({ code: uniqueCode, tier, passed, message });
}
function inferWwSubtype(entry) {
    if (entry.ww_subtype)
        return entry.ww_subtype;
    const text = `${entry.title} ${entry.description ?? ""}`.toLowerCase();
    if (text.includes("quiz"))
        return "quiz";
    if (text.includes("seatwork"))
        return "seatwork";
    return "assignment";
}
function inferPtSubtype(entry) {
    if (entry.pt_subtype)
        return entry.pt_subtype;
    const text = `${entry.title} ${entry.description ?? ""}`.toLowerCase();
    if (text.includes("lab report"))
        return "lab_report";
    if (text.includes("reporting"))
        return "reporting";
    if (text.includes("project") || text.includes("prep"))
        return "project";
    return "activity";
}
function inferExamSubtype(entry) {
    const text = `${entry.title} ${entry.description ?? ""}`.toLowerCase();
    if (text.includes("prelim"))
        return "prelim";
    if (text.includes("midterm"))
        return "midterm";
    return "final";
}
function isUuid(value) {
    if (!value)
        return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function withScheduled(template, slot, overrides, suffix) {
    return {
        ...template,
        ...overrides,
        plan_entry_id: `${template.plan_entry_id}::${slot.date}${suffix ? `::${suffix}` : ""}`,
        source_plan_entry_id: isUuid(template.plan_entry_id) ? template.plan_entry_id : null,
        lesson_plan_id: template.lesson_plan_id,
        scheduled_date: slot.date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        meeting_type: overrides?.meeting_type ?? template.meeting_type ?? slot.meeting_type,
        session_category: overrides?.session_category ??
            template.session_category ??
            (template.category === "lesson" ||
                template.category === "written_work" ||
                template.category === "performance_task" ||
                template.category === "exam"
                ? template.category
                : null),
        session_subcategory: overrides?.session_subcategory ??
            template.session_subcategory ??
            (template.category === "lesson"
                ? slot.meeting_type
                : template.category === "written_work"
                    ? inferWwSubtype(template)
                    : template.category === "performance_task"
                        ? inferPtSubtype(template)
                        : template.category === "exam"
                            ? inferExamSubtype(template)
                            : null),
    };
}
function buildMeetingSlots(input) {
    const recurringRows = input.entries
        .filter((entry) => entry.entry_type === "recurring_class" && Boolean(entry.day))
        .sort((a, b) => {
        const weekdayA = WEEKDAY_INDEX[normalizeWeekday(a.day) ?? ""] ?? 99;
        const weekdayB = WEEKDAY_INDEX[normalizeWeekday(b.day) ?? ""] ?? 99;
        if (weekdayA !== weekdayB)
            return weekdayA - weekdayB;
        return (a.start_time ?? "99:99:99").localeCompare(b.start_time ?? "99:99:99");
    });
    const recurringByWeekday = new Map();
    for (const row of recurringRows) {
        const weekday = WEEKDAY_INDEX[normalizeWeekday(row.day) ?? ""];
        if (weekday === undefined)
            continue;
        const bucket = recurringByWeekday.get(weekday) ?? [];
        bucket.push(row);
        recurringByWeekday.set(weekday, bucket);
    }
    const rawSlots = [];
    for (const date of eachDate(input.startDate, input.endDate)) {
        const weekday = parseDate(date).getDay();
        const rows = recurringByWeekday.get(weekday) ?? [];
        for (const row of rows) {
            rawSlots.push({
                index: rawSlots.length,
                date,
                start_time: row.start_time ?? null,
                end_time: row.end_time ?? null,
                meeting_type: row.meeting_type ?? toMeetingType(row.room),
                minutes: parseMinutes(row.start_time ?? null, row.end_time ?? null),
            });
        }
    }
    // Fallback only when no recurring class template exists at all.
    if (rawSlots.length === 0) {
        const explicitRows = input.entries
            .filter((entry) => entry.entry_type !== "recurring_class" && Boolean(entry.scheduled_date))
            .sort((a, b) => {
            const dateCmp = String(a.scheduled_date).localeCompare(String(b.scheduled_date));
            if (dateCmp !== 0)
                return dateCmp;
            return (a.start_time ?? "99:99:99").localeCompare(b.start_time ?? "99:99:99");
        });
        const seen = new Set();
        for (const row of explicitRows) {
            const date = String(row.scheduled_date);
            if (!date || date < input.startDate || date > input.endDate)
                continue;
            const key = `${date}|${row.start_time ?? ""}|${row.end_time ?? ""}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            rawSlots.push({
                index: rawSlots.length,
                date,
                start_time: row.start_time ?? null,
                end_time: row.end_time ?? null,
                meeting_type: row.meeting_type ?? toMeetingType(row.room),
                minutes: parseMinutes(row.start_time ?? null, row.end_time ?? null),
            });
        }
    }
    return rawSlots;
}
function findSlotForEntry(slots, entry) {
    if (!entry.scheduled_date)
        return -1;
    const dateIso = String(entry.scheduled_date);
    const dateMatches = [];
    for (let i = 0; i < slots.length; i += 1) {
        if (slots[i].date === dateIso)
            dateMatches.push(i);
    }
    if (dateMatches.length === 0)
        return -1;
    if (dateMatches.length === 1)
        return dateMatches[0];
    const start = entry.start_time ?? null;
    const end = entry.end_time ?? null;
    const meetingType = entry.meeting_type ?? toMeetingType(entry.room);
    if (start && end) {
        const exact = dateMatches.find((idx) => slots[idx].start_time === start && slots[idx].end_time === end);
        if (exact !== undefined)
            return exact;
    }
    if (start) {
        const byStart = dateMatches.find((idx) => slots[idx].start_time === start);
        if (byStart !== undefined)
            return byStart;
    }
    if (end) {
        const byEnd = dateMatches.find((idx) => slots[idx].end_time === end);
        if (byEnd !== undefined)
            return byEnd;
    }
    if (meetingType) {
        const byMeetingType = dateMatches.find((idx) => slots[idx].meeting_type === meetingType);
        if (byMeetingType !== undefined)
            return byMeetingType;
    }
    return dateMatches[0];
}
function findNextFreeSlot(plans, slots, blackout, startAt, allowLesson = false) {
    for (let i = Math.max(0, startAt); i < plans.length; i += 1) {
        if (blackout.has(slots[i].date))
            continue;
        const row = plans[i];
        if (row.locked)
            continue;
        if (row.other)
            continue;
        if (!allowLesson && row.lesson)
            continue;
        return i;
    }
    return -1;
}
function findPreviousFreeSlot(plans, slots, blackout, startAt, allowLesson = false) {
    for (let i = Math.min(startAt, plans.length - 1); i >= 0; i -= 1) {
        if (blackout.has(slots[i].date))
            continue;
        const row = plans[i];
        if (row.locked)
            continue;
        if (row.other)
            continue;
        if (!allowLesson && row.lesson)
            continue;
        return i;
    }
    return -1;
}
function parseChapterId(entry) {
    if (entry.lesson_chapter_id)
        return entry.lesson_chapter_id;
    const m = `${entry.description ?? ""}`.match(/chapter\s*(\d+)/i);
    return m ? `chapter_${m[1]}` : "chapter_unknown";
}
function buildSyntheticTemplate(input, category, title) {
    return {
        plan_entry_id: `synthetic::${category}::${title.toLowerCase().replace(/\s+/g, "_")}`,
        lesson_plan_id: input.lessonPlanId,
        title,
        category,
        description: null,
        scheduled_date: null,
        start_time: null,
        end_time: null,
        entry_type: null,
        is_locked: false,
    };
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
    const lockedStackedRows = [];
    const lockedRows = input.entries.filter((entry) => entry.is_locked &&
        entry.entry_type !== "recurring_class" &&
        entry.scheduled_date &&
        TARGET_CATEGORIES.has(entry.category));
    for (const row of lockedRows) {
        const idx = findSlotForEntry(slots, row);
        if (idx < 0) {
            addDiagnostic(diagnostics, "LOCKED_OUT_OF_RANGE", "soft", true, `Ignored locked entry out of plan range: ${row.title}`);
            continue;
        }
        const lockedCopy = withScheduled(row, slots[idx], { is_locked: true }, "locked");
        if (row.category === "lesson") {
            plans[idx].lesson = lockedCopy;
            plans[idx].locked = true;
        }
        else {
            if (!plans[idx].other) {
                plans[idx].other = lockedCopy;
            }
            else {
                // Keep additional locked non-lesson rows stacked so extending instances never replaces
                // existing scheduled rows in the same meeting/date.
                lockedStackedRows.push(lockedCopy);
            }
        }
    }
    const lessonRows = input.entries
        .filter((entry) => entry.entry_type !== "recurring_class" && entry.category === "lesson" && !entry.is_locked)
        .sort((a, b) => parseLessonNumber(a.title) - parseLessonNumber(b.title));
    const wwRows = input.entries.filter((entry) => entry.entry_type !== "recurring_class" && entry.category === "written_work" && !entry.is_locked);
    const ptRows = input.entries.filter((entry) => entry.entry_type !== "recurring_class" && entry.category === "performance_task" && !entry.is_locked);
    const examRows = input.entries.filter((entry) => entry.entry_type !== "recurring_class" && entry.category === "exam" && !entry.is_locked);
    const reviewRows = input.entries.filter((entry) => entry.entry_type !== "recurring_class" && entry.category === "review" && !entry.is_locked);
    const assignmentPool = wwRows.filter((x) => inferWwSubtype(x) === "assignment");
    const seatworkPool = wwRows.filter((x) => inferWwSubtype(x) === "seatwork");
    const quizPool = wwRows.filter((x) => inferWwSubtype(x) === "quiz");
    const activityPool = ptRows.filter((x) => inferPtSubtype(x) === "activity");
    const projectPool = ptRows.filter((x) => inferPtSubtype(x) === "project");
    const syntheticAssignment = buildSyntheticTemplate(input, "written_work", "Assignment");
    const syntheticSeatwork = buildSyntheticTemplate(input, "written_work", "Seatwork");
    const syntheticQuiz = buildSyntheticTemplate(input, "written_work", "Quiz");
    const syntheticActivity = buildSyntheticTemplate(input, "performance_task", "Activity");
    const syntheticProject = buildSyntheticTemplate(input, "performance_task", "Project");
    const nextCounter = {};
    const nextSuffix = (label) => {
        const v = (nextCounter[label] ?? 0) + 1;
        nextCounter[label] = v;
        return `${label}_${v}`;
    };
    const pickFromPool = (pool, fallback, cursor) => {
        if (pool.length === 0)
            return fallback;
        const item = pool[cursor.value % pool.length];
        cursor.value += 1;
        return item;
    };
    const assignmentCursor = { value: 0 };
    const seatworkCursor = { value: 0 };
    const quizCursor = { value: 0 };
    const activityCursor = { value: 0 };
    const projectCursor = { value: 0 };
    const isSchedulable = (idx) => !blackout.has(slots[idx].date) && !plans[idx].locked;
    const isEmptyMeeting = (idx) => !plans[idx].lesson && !plans[idx].other;
    const findSlotForOther = (startAt, allowLessonOverlap) => {
        for (let i = Math.max(0, startAt); i < plans.length; i += 1) {
            if (!isSchedulable(i))
                continue;
            if (plans[i].other)
                continue;
            if (!allowLessonOverlap && plans[i].lesson)
                continue;
            return i;
        }
        return -1;
    };
    const placeOtherEntry = (template, startAt, allowLessonOverlap, overrides, suffixLabel) => {
        let idx = findSlotForOther(startAt, false);
        if (idx < 0 && allowLessonOverlap)
            idx = findSlotForOther(startAt, true);
        if (idx < 0)
            return -1;
        plans[idx].other = withScheduled(template, slots[idx], overrides, nextSuffix(suffixLabel));
        return idx;
    };
    const schedulableSlots = slots.map((_, idx) => idx).filter((idx) => isSchedulable(idx));
    if (schedulableSlots.length === 0) {
        addDiagnostic(diagnostics, "NO_ACTIVE_MEETINGS", "hard", false, "No schedulable meetings available after blackout/locked filtering.");
        const generatedFromLocked = [];
        plans.forEach((slotPlan) => {
            if (slotPlan.lesson)
                generatedFromLocked.push(slotPlan.lesson);
            if (slotPlan.other)
                generatedFromLocked.push(slotPlan.other);
        });
        const hardViolationsEarly = diagnostics.filter((d) => d.tier === "hard" && !d.passed).length;
        const softViolationsEarly = diagnostics.filter((d) => d.tier === "soft" && !d.passed).length;
        return {
            entries: [...fixedEntries, ...lockedStackedRows, ...generatedFromLocked],
            diagnostics: {
                feasible: hardViolationsEarly === 0,
                hardViolations: hardViolationsEarly,
                softViolations: softViolationsEarly,
                constraints: diagnostics,
            },
        };
    }
    const schedulableMinutes = schedulableSlots.map((slotIdx) => Math.max(1, slots[slotIdx]?.minutes ?? 60));
    const avgSlotMinutes = schedulableMinutes.length > 0
        ? Math.max(1, Math.round(schedulableMinutes.reduce((sum, value) => sum + value, 0) / schedulableMinutes.length))
        : 60;
    const lessonSpans = lessonRows.map((row) => {
        const estMinutes = Math.max(1, row.lesson_estimated_minutes ?? 60);
        return Math.max(1, Math.min(3, Math.ceil(estMinutes / avgSlotMinutes)));
    });
    const baseLessonMeetings = lessonSpans.reduce((sum, value) => sum + value, 0);
    const desiredLessonMeetings = Math.max(baseLessonMeetings, Math.min(lessonRows.length * 3, Math.max(lessonRows.length, Math.round(schedulableSlots.length * 0.45))));
    let spanCursor = 0;
    while (lessonSpans.reduce((sum, value) => sum + value, 0) < desiredLessonMeetings && lessonSpans.length > 0) {
        if (lessonSpans[spanCursor] < 3)
            lessonSpans[spanCursor] += 1;
        spanCursor = (spanCursor + 1) % lessonSpans.length;
    }
    const chapterLastSlot = new Map();
    const chapterLessonNums = new Map();
    const lessonEndSlots = [];
    let strictCursor = 0;
    const firstSchedulableIdx = schedulableSlots[0] ?? -1;
    for (let lessonIdx = 0; lessonIdx < lessonRows.length; lessonIdx += 1) {
        const lessonRow = lessonRows[lessonIdx];
        const baseSpan = lessonSpans[lessonIdx] ?? 1;
        const anchorPosition = Math.floor(((lessonIdx + 1) * (schedulableSlots.length + 1)) / (lessonRows.length + 1)) - 1;
        const anchor = schedulableSlots[Math.max(0, Math.min(anchorPosition, schedulableSlots.length - 1))] ?? 0;
        let startIdx = -1;
        const searchStart = lessonIdx === 0 ? firstSchedulableIdx : Math.max(strictCursor, Math.max(0, anchor - 1));
        for (let i = Math.max(0, searchStart); i < plans.length; i += 1) {
            if (!isSchedulable(i))
                continue;
            if (!isEmptyMeeting(i))
                continue;
            startIdx = i;
            break;
        }
        if (startIdx < 0) {
            startIdx = findSlotForOther(strictCursor, true);
        }
        if (startIdx < 0) {
            addDiagnostic(diagnostics, "LESSON_CAPACITY", "hard", false, `No slot available for ${lessonRow.title}.`);
            continue;
        }
        const estimateSpanFromSlotMinutes = (fromIdx, estimatedMinutes) => {
            let accMinutes = 0;
            let spanCount = 0;
            for (let i = fromIdx; i < plans.length && spanCount < 3; i += 1) {
                if (!isSchedulable(i))
                    continue;
                if (plans[i].lesson || plans[i].other)
                    continue;
                accMinutes += Math.max(1, slots[i].minutes);
                spanCount += 1;
                if (accMinutes >= estimatedMinutes)
                    break;
            }
            return Math.max(1, spanCount || 1);
        };
        const estimatedMinutes = Math.max(1, lessonRow.lesson_estimated_minutes ?? 60);
        const span = Math.max(baseSpan, estimateSpanFromSlotMinutes(startIdx, estimatedMinutes));
        let placed = 0;
        let endIdx = startIdx;
        for (let i = startIdx; i < plans.length && placed < span; i += 1) {
            if (!isSchedulable(i))
                continue;
            if (plans[i].lesson || plans[i].other)
                continue;
            plans[i].lesson = withScheduled(lessonRow, slots[i], {
                lesson_estimated_minutes: lessonRow.lesson_estimated_minutes ?? null,
                description: span > 1 ? `${lessonRow.description ?? ""}`.trim() || `Part ${placed + 1} of ${span}` : lessonRow.description,
            }, nextSuffix(`lesson_${lessonIdx + 1}`));
            endIdx = i;
            placed += 1;
        }
        if (placed === 0) {
            addDiagnostic(diagnostics, "LESSON_SPAN", "hard", false, `Unable to place ${lessonRow.title}.`);
            continue;
        }
        if (placed < span) {
            addDiagnostic(diagnostics, "LESSON_SPAN", "soft", false, `${lessonRow.title} planned for ${span} meetings but placed in ${placed}.`);
        }
        lessonEndSlots.push(endIdx);
        strictCursor = endIdx + 1;
        const chapterId = parseChapterId(lessonRow);
        const lessonNo = parseLessonNumber(lessonRow.title);
        chapterLastSlot.set(chapterId, Math.max(chapterLastSlot.get(chapterId) ?? -1, endIdx));
        const nums = chapterLessonNums.get(chapterId) ?? [];
        if (Number.isFinite(lessonNo) && lessonNo < Number.MAX_SAFE_INTEGER)
            nums.push(lessonNo);
        chapterLessonNums.set(chapterId, nums);
        const assignmentTemplate = pickFromPool(assignmentPool, syntheticAssignment, assignmentCursor);
        const seatworkTemplate = pickFromPool(seatworkPool, syntheticSeatwork, seatworkCursor);
        const activityTemplate = pickFromPool(activityPool, syntheticActivity, activityCursor);
        const assignmentSlot = placeOtherEntry(assignmentTemplate, endIdx + 1, true, {
            title: `Assignment: ${lessonRow.title}`,
            ww_subtype: "assignment",
            session_category: "written_work",
            session_subcategory: "assignment",
            description: assignmentTemplate.description ?? `Assignment for ${lessonRow.title}`,
        }, "assignment");
        const seatworkSlot = placeOtherEntry(seatworkTemplate, Math.max(endIdx + 1, assignmentSlot + 1), true, {
            title: `Seatwork: ${lessonRow.title}`,
            ww_subtype: "seatwork",
            session_category: "written_work",
            session_subcategory: "seatwork",
            description: seatworkTemplate.description ?? `Seatwork after ${lessonRow.title}`,
        }, "seatwork");
        placeOtherEntry(activityTemplate, Math.max(endIdx + 1, seatworkSlot + 1), true, {
            title: `Activity: ${lessonRow.title}`,
            pt_subtype: "activity",
            session_category: "performance_task",
            session_subcategory: "activity",
            description: activityTemplate.description ?? `Activity for ${lessonRow.title}`,
        }, "activity");
    }
    const chapterOrder = Array.from(chapterLastSlot.entries()).sort((a, b) => a[1] - b[1]);
    const quizAnchors = [];
    const targetQuizCount = Math.max(1, Math.ceil(Math.max(1, lessonRows.length) * 0.4));
    const chapterAnchors = chapterOrder
        .filter(([chapterId]) => chapterId !== "chapter_unknown")
        .map(([, slotIdx]) => slotIdx);
    const chunkSize = Math.max(2, Math.min(3, Math.ceil(Math.max(1, lessonEndSlots.length) / Math.max(1, targetQuizCount))));
    const lessonChunkAnchors = [];
    for (let i = chunkSize - 1; i < lessonEndSlots.length; i += chunkSize) {
        lessonChunkAnchors.push(lessonEndSlots[i]);
    }
    if (lessonChunkAnchors.length === 0 && lessonEndSlots.length > 0) {
        lessonChunkAnchors.push(lessonEndSlots[lessonEndSlots.length - 1]);
    }
    const combinedAnchors = [...chapterAnchors, ...lessonChunkAnchors].sort((a, b) => a - b);
    const dedupAnchors = Array.from(new Set(combinedAnchors));
    for (let i = 0; i < dedupAnchors.length && quizAnchors.length < targetQuizCount; i += 1) {
        quizAnchors.push(dedupAnchors[i]);
    }
    if (quizAnchors.length < targetQuizCount && lessonEndSlots.length > 0) {
        const interval = Math.max(1, Math.floor(lessonEndSlots.length / targetQuizCount));
        for (let i = interval - 1; i < lessonEndSlots.length && quizAnchors.length < targetQuizCount; i += interval) {
            quizAnchors.push(lessonEndSlots[i]);
        }
    }
    const baselineQuizAnchors = Array.from(new Set(quizAnchors)).sort((a, b) => a - b).slice(0, targetQuizCount);
    // Ensure quiz coverage for every lesson checkpoint. 0.4 is only the baseline.
    const finalQuizAnchors = Array.from(new Set([...baselineQuizAnchors, ...lessonEndSlots])).sort((a, b) => a - b);
    let quizzesPlaced = 0;
    for (let i = 0; i < finalQuizAnchors.length; i += 1) {
        const quizTemplate = pickFromPool(quizPool, syntheticQuiz, quizCursor);
        const anchor = finalQuizAnchors[i];
        const placedIdx = placeOtherEntry(quizTemplate, anchor + 1, true, {
            title: `Quiz ${quizzesPlaced + 1}`,
            ww_subtype: "quiz",
            session_category: "written_work",
            session_subcategory: "quiz",
            description: quizTemplate.description ?? "Quiz checkpoint",
        }, "quiz");
        if (placedIdx >= 0)
            quizzesPlaced += 1;
    }
    if (lessonEndSlots.length > 0 && quizzesPlaced < lessonEndSlots.length) {
        addDiagnostic(diagnostics, "QUIZ_COVERAGE", "soft", false, `Only ${quizzesPlaced} quiz slot(s) placed for ${lessonEndSlots.length} lesson checkpoint(s).`);
    }
    // One project per plan, spread across multiple meetings.
    const projectTemplate = pickFromPool(projectPool, syntheticProject, projectCursor);
    const projectSpan = Math.min(5, Math.max(2, Math.round(Math.max(1, schedulableSlots.length) * 0.08)));
    const projectStart = Math.floor(plans.length * 0.62);
    let projectPlaced = 0;
    for (let i = projectStart; i < plans.length && projectPlaced < projectSpan; i += 1) {
        if (!isSchedulable(i))
            continue;
        if (plans[i].other)
            continue;
        plans[i].other = withScheduled(projectTemplate, slots[i], {
            title: projectTemplate.title,
            pt_subtype: "project",
            session_category: "performance_task",
            session_subcategory: "project",
            description: projectTemplate.description ??
                (projectPlaced === projectSpan - 1 ? "Project presentation/submission" : "Project work session"),
        }, nextSuffix("project"));
        projectPlaced += 1;
    }
    const minimumProjectMeetings = schedulableSlots.length >= 12 ? 2 : 1;
    const projectConstraintTier = minimumProjectMeetings >= 2 ? "hard" : "soft";
    if (projectPlaced < minimumProjectMeetings) {
        addDiagnostic(diagnostics, "PROJECT_SPAN", projectConstraintTier, false, `Project allocated to ${projectPlaced} meeting(s); expected at least ${minimumProjectMeetings} for this plan length.`);
    }
    // Place all exams except the final one near the end; final is forced to last meeting.
    const examStart = Math.floor(slots.length * 0.82);
    const preFinalExamCount = Math.max(0, examRows.length - 1);
    for (let examIdx = 0; examIdx < preFinalExamCount; examIdx += 1) {
        const examTemplate = examRows[examIdx];
        const lastLessonSlot = lessonEndSlots.length > 0 ? lessonEndSlots[lessonEndSlots.length - 1] : 0;
        const examSlot = findNextFreeSlot(plans, slots, blackout, Math.max(lastLessonSlot + 1, examStart + examIdx), false);
        if (examSlot < 0)
            continue;
        plans[examSlot].other = withScheduled(examTemplate, slots[examSlot], undefined, `exam_${examIdx + 1}`);
        const reviewTemplate = reviewRows[examIdx] ?? null;
        if (reviewTemplate) {
            const reviewSlot = findNextFreeSlot(plans, slots, blackout, Math.max(0, examSlot - 3), false);
            if (reviewSlot >= 0 && reviewSlot < examSlot) {
                plans[reviewSlot].other = withScheduled(reviewTemplate, slots[reviewSlot], { description: reviewTemplate.description ?? `Preparation for ${examTemplate.title}` }, `review_${examIdx + 1}`);
            }
        }
    }
    // Force the last active meeting to be an exam.
    const lastSchedulableIdx = schedulableSlots[schedulableSlots.length - 1] ?? -1;
    if (lastSchedulableIdx >= 0) {
        const finalExamTemplate = examRows.length > 0 ? examRows[examRows.length - 1] : buildSyntheticTemplate(input, "exam", "Final Exam");
        const slotLocked = plans[lastSchedulableIdx].locked;
        const lastOther = plans[lastSchedulableIdx].other;
        let finalExamIdx = -1;
        if (!slotLocked && !lastOther) {
            finalExamIdx = lastSchedulableIdx;
        }
        else if (!slotLocked && lastOther?.category === "exam") {
            finalExamIdx = lastSchedulableIdx;
        }
        else {
            finalExamIdx = findPreviousFreeSlot(plans, slots, blackout, lastSchedulableIdx - 1, false);
            if (finalExamIdx >= 0) {
                addDiagnostic(diagnostics, "FINAL_EXAM_SHIFTED", "soft", false, "Last active meeting already occupied; final exam shifted to an earlier free meeting.");
            }
            else {
                addDiagnostic(diagnostics, "FINAL_EXAM_PLACEMENT", "hard", false, "No free meeting available for final exam.");
            }
        }
        if (finalExamIdx >= 0 && !plans[finalExamIdx].other) {
            plans[finalExamIdx].other = withScheduled(finalExamTemplate, slots[finalExamIdx], {
                title: finalExamTemplate.title || "Final Exam",
                category: "exam",
                description: finalExamTemplate.description ?? "Culminating assessment.",
            }, "final_exam");
        }
    }
    // Ensure no empty meetings by backfilling with flexible activity/project buffers.
    let fillerCounter = 0;
    for (let idx = 0; idx < plans.length; idx += 1) {
        if (!isSchedulable(idx))
            continue;
        if (!isEmptyMeeting(idx))
            continue;
        const useProject = fillerCounter % 5 === 4;
        const template = useProject
            ? pickFromPool(projectPool, syntheticProject, projectCursor)
            : pickFromPool(activityPool, syntheticActivity, activityCursor);
        plans[idx].other = withScheduled(template, slots[idx], {
            title: useProject ? "Project Buffer Session" : "Flexible Activity Session",
            description: "Flexible buffer session; first to reschedule if a meeting is suspended.",
            pt_subtype: useProject ? "project" : "activity",
        }, nextSuffix("buffer"));
        fillerCounter += 1;
    }
    const generated = [];
    let lessonWithTaskOverlap = 0;
    plans.forEach((slotPlan) => {
        if (slotPlan.lesson)
            generated.push(slotPlan.lesson);
        if (slotPlan.other)
            generated.push(slotPlan.other);
        if (slotPlan.lesson && slotPlan.other?.category === "written_work")
            lessonWithTaskOverlap += 1;
    });
    addDiagnostic(diagnostics, "LESSON_TASK_OVERLAP", "soft", lessonWithTaskOverlap === 0, lessonWithTaskOverlap === 0
        ? "No lesson + written work overlap in one meeting."
        : `${lessonWithTaskOverlap} meeting(s) include lesson + written work due to limited slots.`);
    const emptyMeetings = plans.filter((row, idx) => isSchedulable(idx) && !row.lesson && !row.other).length;
    addDiagnostic(diagnostics, "NO_EMPTY_MEETINGS", "hard", emptyMeetings === 0, emptyMeetings === 0
        ? "All active meetings were filled."
        : `${emptyMeetings} active meeting(s) are still empty.`);
    addDiagnostic(diagnostics, "LOCKED_PRESERVED", "hard", true, `${lockedRows.length} locked entries preserved in-place.`);
    const hardViolations = diagnostics.filter((d) => d.tier === "hard" && !d.passed).length;
    const softViolations = diagnostics.filter((d) => d.tier === "soft" && !d.passed).length;
    return {
        entries: [...fixedEntries, ...lockedStackedRows, ...generated],
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
