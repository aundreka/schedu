import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  PinchGestureHandler,
  type PinchGestureHandlerGestureEvent,
  State,
} from "react-native-gesture-handler";
import { Radius, Spacing, Typography } from "../../constants/fonts";
import { useAppTheme } from "../../context/theme";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";
import { supabase } from "../../lib/supabase";

type ZoomLevel = "daily" | "monthly_compact" | "monthly_detailed";

type LessonPlanOption = {
  lesson_plan_id: string;
  title: string;
  start_date: string;
  end_date: string;
  subject_code: string;
  subject_title: string;
  section_name: string;
};

type PlanEntry = {
  plan_entry_id: string;
  lesson_plan_id: string;
  title: string;
  category: string;
  description: string | null;
  scheduled_date: string | null;
  start_time: string | null;
  end_time: string | null;
};

type DayCell = {
  date: string;
  dayNumber: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  entries: PlanEntry[];
};

const DAYS_SHORT = ["S", "M", "T", "W", "T", "F", "S"] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const CATEGORY_STYLE: Record<string, { color: string; chipLabel: string }> = {
  lesson: { color: "#7FB6A1", chipLabel: "L" },
  written_work: { color: "#8E9AE6", chipLabel: "WW" },
  performance_task: { color: "#CE6E73", chipLabel: "PT" },
  exam: { color: "#D49C49", chipLabel: "EX" },
};

function toLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateFromIso(iso: string) {
  const [y, m, d] = iso.split("-").map((part) => Number(part));
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(iso: string, days: number) {
  const date = parseDateFromIso(iso);
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

function startOfWeek(iso: string) {
  const date = parseDateFromIso(iso);
  return addDays(iso, -date.getDay());
}

function startOfMonth(iso: string) {
  const date = parseDateFromIso(iso);
  return toLocalDateString(new Date(date.getFullYear(), date.getMonth(), 1));
}

function monthTitle(iso: string) {
  const date = parseDateFromIso(iso);
  return `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

function longDateTitle(iso: string) {
  const date = parseDateFromIso(iso);
  return `${WEEKDAY_LONG[date.getDay()]}, ${MONTHS_LONG[date.getMonth()]} ${date.getDate()}`;
}

function entrySort(a: PlanEntry, b: PlanEntry) {
  const aTime = a.start_time || "99:99:99";
  const bTime = b.start_time || "99:99:99";
  if (aTime !== bTime) return aTime.localeCompare(bTime);
  return a.title.localeCompare(b.title);
}

function getEntryColor(category: string) {
  return CATEGORY_STYLE[category]?.color ?? "#B6C0CC";
}

function getChipLabel(entry: PlanEntry) {
  if (entry.category === "lesson") {
    const matched = entry.title.match(/lesson\s*\d+/i);
    return matched ? matched[0].replace(/\s+/g, " ") : "L";
  }
  return CATEGORY_STYLE[entry.category]?.chipLabel ?? "PL";
}

export default function CalendarScreen() {
  const { colors: c, scheme } = useAppTheme();
  const isDark = scheme === "dark";

  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<LessonPlanOption[]>([]);
  const [entriesByPlan, setEntriesByPlan] = useState<Record<string, PlanEntry[]>>({});
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(toLocalDateString());
  const [currentMonthDate, setCurrentMonthDate] = useState<string>(startOfMonth(toLocalDateString()));
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("daily");

  const loadCalendarData = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("No signed-in user found.");

      const today = toLocalDateString();

      const { data: planRows, error: planError } = await supabase
        .from("lesson_plans")
        .select(
          "lesson_plan_id, title, start_date, end_date, subject:subjects(code, title), section:sections(name)"
        )
        .eq("user_id", user.id)
        .order("start_date", { ascending: false });
      if (planError) throw planError;

      const mappedPlans: LessonPlanOption[] = (planRows ?? []).map((row: any) => {
        const subjectRaw = row?.subject;
        const subject = Array.isArray(subjectRaw) ? subjectRaw[0] : subjectRaw;
        const sectionRaw = row?.section;
        const section = Array.isArray(sectionRaw) ? sectionRaw[0] : sectionRaw;

        return {
          lesson_plan_id: String(row.lesson_plan_id),
          title: String(row.title ?? "Untitled Plan"),
          start_date: String(row.start_date),
          end_date: String(row.end_date),
          subject_code: String(subject?.code ?? ""),
          subject_title: String(subject?.title ?? ""),
          section_name: String(section?.name ?? ""),
        };
      });

      let entriesMap: Record<string, PlanEntry[]> = {};

      if (mappedPlans.length > 0) {
        const lessonPlanIds = mappedPlans.map((plan) => plan.lesson_plan_id);
        const { data: entryRows, error: entryError } = await supabase
          .from("plan_entries")
          .select(
            "plan_entry_id, lesson_plan_id, title, category, description, scheduled_date, start_time, end_time"
          )
          .in("lesson_plan_id", lessonPlanIds)
          .order("scheduled_date", { ascending: true });
        if (entryError) throw entryError;

        for (const row of entryRows ?? []) {
          const planId = String(row.lesson_plan_id);
          const current = entriesMap[planId] ?? [];
          current.push({
            plan_entry_id: String(row.plan_entry_id),
            lesson_plan_id: planId,
            title: String(row.title ?? "Untitled"),
            category: String(row.category ?? "planned_item"),
            description: row?.description ? String(row.description) : null,
            scheduled_date: row?.scheduled_date ? String(row.scheduled_date) : null,
            start_time: row?.start_time ? String(row.start_time) : null,
            end_time: row?.end_time ? String(row.end_time) : null,
          });
          entriesMap[planId] = current;
        }

        for (const planId of Object.keys(entriesMap)) {
          entriesMap[planId] = [...entriesMap[planId]].sort(entrySort);
        }
      }

      setPlans(mappedPlans);
      setEntriesByPlan(entriesMap);

      const defaultPlan =
        mappedPlans.find((plan) => plan.start_date <= today && plan.end_date >= today) ?? mappedPlans[0] ?? null;
      const defaultPlanId = defaultPlan?.lesson_plan_id ?? "";
      setSelectedPlanId((prev) => (prev && mappedPlans.some((plan) => plan.lesson_plan_id === prev) ? prev : defaultPlanId));

      if (defaultPlan) {
        setSelectedDate((current) => {
          if (defaultPlan.start_date <= current && defaultPlan.end_date >= current) {
            return current;
          }
          setCurrentMonthDate(startOfMonth(defaultPlan.start_date));
          return defaultPlan.start_date;
        });
      }
    } catch {
      setPlans([]);
      setEntriesByPlan({});
      setSelectedPlanId("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCalendarData();
  }, [loadCalendarData]);

  const { refreshing, onRefresh } = usePullToRefresh(loadCalendarData);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.lesson_plan_id === selectedPlanId) ?? null,
    [plans, selectedPlanId]
  );

  const selectedPlanEntries = useMemo(
    () => (selectedPlanId ? entriesByPlan[selectedPlanId] ?? [] : []),
    [entriesByPlan, selectedPlanId]
  );

  const entriesByDate = useMemo(() => {
    const map: Record<string, PlanEntry[]> = {};
    for (const entry of selectedPlanEntries) {
      if (!entry.scheduled_date) continue;
      const key = entry.scheduled_date;
      const existing = map[key] ?? [];
      existing.push(entry);
      map[key] = existing;
    }

    for (const dateKey of Object.keys(map)) {
      map[dateKey] = map[dateKey].sort(entrySort);
    }

    return map;
  }, [selectedPlanEntries]);

  useEffect(() => {
    if (!selectedPlan) return;
    if (selectedDate < selectedPlan.start_date) {
      setSelectedDate(selectedPlan.start_date);
      setCurrentMonthDate(startOfMonth(selectedPlan.start_date));
      return;
    }
    if (selectedDate > selectedPlan.end_date) {
      setSelectedDate(selectedPlan.end_date);
      setCurrentMonthDate(startOfMonth(selectedPlan.end_date));
    }
  }, [selectedPlan, selectedDate]);

  const dailyEntries = useMemo(() => {
    return [...(entriesByDate[selectedDate] ?? [])];
  }, [entriesByDate, selectedDate]);

  const weekDays = useMemo(() => {
    const weekStart = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index);
      const d = parseDateFromIso(date);
      return {
        date,
        label: DAYS_SHORT[d.getDay()],
        dayNumber: d.getDate(),
        isSelected: date === selectedDate,
      };
    });
  }, [selectedDate]);

  const monthCells = useMemo<DayCell[]>(() => {
    const firstDay = parseDateFromIso(currentMonthDate);
    const month = firstDay.getMonth();
    const startGridDate = addDays(currentMonthDate, -firstDay.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const date = addDays(startGridDate, index);
      const dateObj = parseDateFromIso(date);
      return {
        date,
        dayNumber: dateObj.getDate(),
        inMonth: dateObj.getMonth() === month,
        isToday: date === toLocalDateString(),
        isSelected: date === selectedDate,
        entries: entriesByDate[date] ?? [],
      };
    });
  }, [currentMonthDate, entriesByDate, selectedDate]);

  const handlePinchStateChange = (event: PinchGestureHandlerGestureEvent) => {
    if (event.nativeEvent.state !== State.END) return;
    const scale = event.nativeEvent.scale;

    if (scale < 0.86) {
      setZoomLevel((current) => {
        if (current === "daily") return "monthly_compact";
        if (current === "monthly_detailed") return "monthly_compact";
        return current;
      });
      return;
    }

    if (scale > 1.14) {
      setZoomLevel((current) => {
        if (current === "monthly_compact") return "monthly_detailed";
        if (current === "monthly_detailed") return "daily";
        return current;
      });
    }
  };

  const shiftMonth = (offset: number) => {
    const date = parseDateFromIso(currentMonthDate);
    const next = new Date(date.getFullYear(), date.getMonth() + offset, 1);
    setCurrentMonthDate(toLocalDateString(next));
  };

  const screenBg = isDark ? c.background : "#F5F6F7";
  const cardBg = isDark ? c.card : "#FFFFFF";
  const subtleBg = isDark ? "#121C28" : "#F1F5F9";

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: screenBg }]}> 
        <ActivityIndicator color={c.tint} />
      </View>
    );
  }

  if (!selectedPlan) {
    return (
      <View style={[styles.center, { backgroundColor: screenBg }]}> 
        <Text style={[styles.emptyText, { color: c.mutedText }]}>No lesson plans yet.</Text>
      </View>
    );
  }

  return (
    <PinchGestureHandler onHandlerStateChange={handlePinchStateChange}>
      <View style={[styles.page, { backgroundColor: screenBg }]}> 
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <View>
              <Text style={[styles.modeLabel, { color: c.mutedText }]}> 
                {zoomLevel === "daily" ? "Daily" : "Monthly"}
              </Text>
              <Text style={[styles.dateTitle, { color: c.text }]}> 
                {zoomLevel === "daily" ? longDateTitle(selectedDate) : monthTitle(currentMonthDate)}
              </Text>
            </View>

            <Pressable
              style={[styles.planPill, { backgroundColor: cardBg, borderColor: c.border }]}
              onPress={() => setPlanMenuOpen(true)}
            >
              <Ionicons name="chevron-down" size={16} color={c.text} />
              <View style={styles.planPillTextWrap}>
                <Text style={[styles.planCode, { color: c.text }]} numberOfLines={1}>
                  {selectedPlan.subject_code || selectedPlan.title}
                </Text>
                <Text style={[styles.planSubtitle, { color: c.mutedText }]} numberOfLines={1}>
                  {selectedPlan.subject_title || selectedPlan.section_name}
                </Text>
              </View>
            </Pressable>
          </View>

          {zoomLevel === "daily" ? (
            <View>
              <View style={styles.weekStrip}>
                {weekDays.map((day) => (
                  <Pressable
                    key={day.date}
                    style={styles.weekDayItem}
                    onPress={() => {
                      setSelectedDate(day.date);
                      setCurrentMonthDate(startOfMonth(day.date));
                    }}
                  >
                    <Text style={[styles.weekDayLabel, { color: c.mutedText }]}>{day.label}</Text>
                    <View
                      style={[
                        styles.weekDayCircle,
                        { backgroundColor: day.isSelected ? c.tint : "transparent" },
                      ]}
                    >
                      <Text style={[styles.weekDayNum, { color: day.isSelected ? "#FFFFFF" : c.text }]}>
                        {day.dayNumber}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>

              {dailyEntries.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor: c.border }]}> 
                  <Text style={[styles.emptyCardText, { color: c.mutedText }]}>No entries scheduled on this day.</Text>
                </View>
              ) : (
                <View style={styles.dailyList}>
                  {dailyEntries.map((entry, index) => (
                    <View key={entry.plan_entry_id} style={[styles.dailyRow, { borderColor: c.border }]}> 
                      <View
                        style={[
                          styles.dailyColorBar,
                          { backgroundColor: getEntryColor(entry.category), opacity: 0.95 },
                        ]}
                      />

                      <View style={styles.dailyMain}>
                        <Text style={[styles.dailyTitle, { color: c.text }]} numberOfLines={1}>
                          {entry.title}
                        </Text>
                        <Text style={[styles.dailySub, { color: c.mutedText }]} numberOfLines={2}>
                          {entry.description || selectedPlan.section_name || "Planned item"}
                        </Text>
                      </View>

                      <View style={[styles.entryChip, { borderColor: getEntryColor(entry.category), backgroundColor: subtleBg }]}> 
                        <Text style={[styles.entryChipText, { color: c.text }]}>{getChipLabel(entry)}</Text>
                      </View>

                      {index !== dailyEntries.length - 1 ? <View style={[styles.divider, { backgroundColor: c.border }]} /> : null}
                    </View>
                  ))}
                </View>
              )}
            </View>
          ) : (
            <View>
              <View style={styles.monthNavRow}>
                <Pressable style={styles.navBtn} onPress={() => shiftMonth(-1)}>
                  <Ionicons name="chevron-back" size={18} color={c.text} />
                </Pressable>
                <Pressable style={styles.navBtn} onPress={() => shiftMonth(1)}>
                  <Ionicons name="chevron-forward" size={18} color={c.text} />
                </Pressable>
              </View>

              <View style={styles.weekLabelRow}>
                {DAYS_SHORT.map((label) => (
                  <Text key={label} style={[styles.weekHeaderLabel, { color: c.mutedText }]}>
                    {label}
                  </Text>
                ))}
              </View>

              <View style={styles.monthGrid}>
                {monthCells.map((cell) => (
                  <Pressable
                    key={cell.date}
                    style={[
                      styles.monthCell,
                      {
                        backgroundColor: cell.isSelected ? (isDark ? "#1B2A1F" : "#ECFDF3") : "transparent",
                        borderColor: cell.isSelected ? c.tint : "transparent",
                      },
                    ]}
                    onPress={() => {
                      setSelectedDate(cell.date);
                      if (zoomLevel === "monthly_detailed") {
                        return;
                      }
                    }}
                  >
                    <View
                      style={[
                        styles.dayBadge,
                        {
                          backgroundColor: cell.isToday ? c.tint : "transparent",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayBadgeText,
                          {
                            color: cell.isToday ? "#FFFFFF" : cell.inMonth ? c.text : c.mutedText,
                            opacity: cell.inMonth ? 1 : 0.45,
                          },
                        ]}
                      >
                        {cell.dayNumber}
                      </Text>
                    </View>

                    {zoomLevel === "monthly_compact" ? (
                      <View style={styles.compactBarsWrap}>
                        {cell.entries.slice(0, 3).map((entry) => (
                          <View
                            key={entry.plan_entry_id}
                            style={[styles.compactBar, { backgroundColor: getEntryColor(entry.category) }]}
                          />
                        ))}
                      </View>
                    ) : (
                      <View style={styles.detailItemsWrap}>
                        {cell.entries.slice(0, 3).map((entry) => (
                          <View
                            key={entry.plan_entry_id}
                            style={[styles.detailItem, { backgroundColor: getEntryColor(entry.category) }]}
                          >
                            <Text style={styles.detailItemTitle} numberOfLines={1}>
                              {entry.title}
                            </Text>
                            <Text style={styles.detailItemSub} numberOfLines={1}>
                              {entry.description || getChipLabel(entry)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        <Modal
          transparent
          visible={planMenuOpen}
          animationType="fade"
          onRequestClose={() => setPlanMenuOpen(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setPlanMenuOpen(false)}>
            <View style={[styles.planModal, { backgroundColor: cardBg, borderColor: c.border }]}> 
              <Text style={[styles.modalTitle, { color: c.text }]}>Select lesson plan</Text>
              <ScrollView style={styles.planList}>
                {plans.map((plan) => {
                  const isSelected = plan.lesson_plan_id === selectedPlanId;
                  return (
                    <Pressable
                      key={plan.lesson_plan_id}
                      style={[
                        styles.planRow,
                        {
                          backgroundColor: isSelected ? (isDark ? "#1A2B22" : "#E8F9EE") : "transparent",
                          borderColor: c.border,
                        },
                      ]}
                      onPress={() => {
                        setSelectedPlanId(plan.lesson_plan_id);
                        setSelectedDate(plan.start_date);
                        setCurrentMonthDate(startOfMonth(plan.start_date));
                        setPlanMenuOpen(false);
                      }}
                    >
                      <Text style={[styles.planRowTitle, { color: c.text }]} numberOfLines={1}>
                        {plan.subject_code ? `${plan.subject_code} - ${plan.subject_title}` : plan.title}
                      </Text>
                      <Text style={[styles.planRowSub, { color: c.mutedText }]} numberOfLines={1}>
                        {plan.section_name || "Section"} | {plan.start_date} to {plan.end_date}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
      </View>
    </PinchGestureHandler>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxxl,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: {
    ...Typography.body,
    fontSize: 15,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  modeLabel: {
    ...Typography.body,
    fontSize: 14,
  },
  dateTitle: {
    ...Typography.h1,
    fontSize: 34,
    lineHeight: 38,
    marginTop: 2,
  },
  planPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 150,
    maxWidth: 210,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  planPillTextWrap: { flex: 1 },
  planCode: {
    ...Typography.h3,
    fontSize: 15,
    lineHeight: 18,
    fontStyle: "italic",
  },
  planSubtitle: {
    ...Typography.caption,
    fontSize: 12,
  },
  weekStrip: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  weekDayItem: {
    alignItems: "center",
    width: "14.2%",
  },
  weekDayLabel: {
    ...Typography.caption,
    fontSize: 12,
    marginBottom: 6,
  },
  weekDayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  weekDayNum: {
    ...Typography.body,
    fontSize: 20,
  },
  dailyList: { gap: Spacing.sm },
  dailyRow: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingLeft: 0,
    paddingRight: Spacing.md,
    paddingVertical: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
  },
  dailyColorBar: {
    width: 5,
    alignSelf: "stretch",
    marginRight: 10,
  },
  dailyMain: {
    flex: 1,
    paddingRight: 8,
  },
  dailyTitle: {
    ...Typography.h2,
    fontSize: 22,
    lineHeight: 24,
    fontStyle: "italic",
  },
  dailySub: {
    ...Typography.body,
    fontSize: 17,
    lineHeight: 20,
    marginTop: 2,
  },
  entryChip: {
    borderWidth: 1,
    borderRadius: Radius.round,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 54,
    alignItems: "center",
  },
  entryChipText: {
    ...Typography.body,
    fontSize: 16,
  },
  divider: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: "center",
  },
  emptyCardText: {
    ...Typography.body,
    fontSize: 15,
  },
  monthNavRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: Spacing.sm,
    gap: 4,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  weekLabelRow: {
    flexDirection: "row",
    marginBottom: Spacing.sm,
  },
  weekHeaderLabel: {
    width: `${100 / 7}%`,
    textAlign: "center",
    ...Typography.caption,
    fontSize: 12,
  },
  monthGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  monthCell: {
    width: `${100 / 7}%`,
    minHeight: 92,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 4,
  },
  dayBadge: {
    alignSelf: "center",
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    marginBottom: 4,
  },
  dayBadgeText: {
    ...Typography.body,
    fontSize: 17,
  },
  compactBarsWrap: {
    gap: 4,
    paddingHorizontal: 2,
  },
  compactBar: {
    height: 6,
    borderRadius: 4,
  },
  detailItemsWrap: {
    gap: 3,
  },
  detailItem: {
    borderRadius: Radius.sm,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  detailItemTitle: {
    ...Typography.caption,
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 11,
    lineHeight: 12,
  },
  detailItemSub: {
    ...Typography.caption,
    color: "#FFFFFF",
    fontSize: 10,
    lineHeight: 11,
    marginTop: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  planModal: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    maxHeight: "72%",
  },
  modalTitle: {
    ...Typography.h3,
    fontSize: 17,
    marginBottom: Spacing.md,
  },
  planList: {
    maxHeight: 360,
  },
  planRow: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  planRowTitle: {
    ...Typography.body,
    fontSize: 14,
    fontWeight: "600",
  },
  planRowSub: {
    ...Typography.caption,
    fontSize: 12,
    marginTop: 3,
  },
});
