import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Radius, Spacing, Typography } from "../../../constants/fonts";
import { useAppTheme } from "../../../context/theme";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import { supabase } from "../../../lib/supabase";

type WrittenWorkDetail = {
  plan_entry_id: string;
  title: string;
  description: string | null;
  session_category: string | null;
  session_subcategory: string | null;
  scheduled_date: string | null;
  day: string | null;
  start_time: string | null;
  end_time: string | null;
  lesson_title: string | null;
};

function readParam(value?: string | string[]) {
  if (!value) return "";
  return Array.isArray(value) ? String(value[0] ?? "") : String(value);
}

function formatDate(value: string | null) {
  if (!value) return "Not scheduled";
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value: string | null) {
  if (!value) return null;
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw ?? "0");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const meridiem = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function toTitleCase(value: string | null) {
  if (!value) return "Written Work";
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveKicker(entry: WrittenWorkDetail) {
  if (entry.session_category === "exam") {
    return entry.session_subcategory ? toTitleCase(entry.session_subcategory) : "Exam";
  }
  return toTitleCase(entry.session_subcategory);
}

export default function WrittenWorkDetailScreen() {
  const { colors: c, scheme } = useAppTheme();
  const params = useLocalSearchParams<{ planEntryId?: string | string[]; subjectId?: string | string[] }>();
  const planEntryId = useMemo(() => readParam(params.planEntryId), [params.planEntryId]);
  const subjectId = useMemo(() => readParam(params.subjectId), [params.subjectId]);
  const [loading, setLoading] = useState(true);
  const [entry, setEntry] = useState<WrittenWorkDetail | null>(null);

  const handleBack = useCallback(() => {
    if (subjectId) {
      router.replace({
        pathname: "/library/subject_detail",
        params: { subjectId },
      });
      return;
    }
    router.back();
  }, [subjectId]);

  const loadEntry = useCallback(async () => {
    if (!planEntryId) {
      setEntry(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("blocks")
        .select("block_id, title, description, session_category, session_subcategory, lesson_id, slot:slots(slot_date, weekday, start_time, end_time)")
        .eq("block_id", planEntryId)
        .maybeSingle();
      if (error) throw error;

      const slotRaw = data?.slot;
      const slot = Array.isArray(slotRaw) ? slotRaw[0] : slotRaw;

      if (!data?.block_id) {
        setEntry(null);
        return;
      }

      setEntry({
        plan_entry_id: String(data.block_id),
        title: String(data.title ?? "Untitled Written Work"),
        description: data?.description ? String(data.description) : null,
        session_category: data?.session_category ? String(data.session_category) : null,
        session_subcategory: data?.session_subcategory ? String(data.session_subcategory) : null,
        scheduled_date: slot?.slot_date ? String(slot.slot_date) : null,
        day: slot?.weekday ? String(slot.weekday) : null,
        start_time: slot?.start_time ? String(slot.start_time) : null,
        end_time: slot?.end_time ? String(slot.end_time) : null,
        lesson_title: null,
      });
    } catch {
      setEntry(null);
    } finally {
      setLoading(false);
    }
  }, [planEntryId]);

  useEffect(() => {
    loadEntry();
  }, [loadEntry]);

  const { refreshing, onRefresh } = usePullToRefresh(loadEntry);
  const pageBg = useMemo(() => (scheme === "dark" ? c.background : "#F5F6F7"), [c.background, scheme]);
  const cardBg = useMemo(() => (scheme === "dark" ? c.card : "#FFFFFF"), [c.card, scheme]);
  const scheduleText = useMemo(() => {
    if (!entry) return "";
    const start = formatTime(entry.start_time);
    const end = formatTime(entry.end_time);
    if (start && end) return `${start} - ${end}`;
    return start || end || "No time set";
  }, [entry]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: pageBg }]}>
        <ActivityIndicator color={c.text} />
      </View>
    );
  }

  if (!entry) {
    return (
      <View style={[styles.center, { backgroundColor: pageBg }]}>
        <Pressable style={styles.backBtn} onPress={handleBack}>
          <Ionicons name="arrow-back" size={18} color={c.text} />
        </Pressable>
        <Text style={[styles.emptyText, { color: c.text }]}>Item not found.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.page, { backgroundColor: pageBg }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.text} />}
      >
        <Pressable style={styles.backBtn} onPress={handleBack}>
          <Ionicons name="arrow-back" size={18} color={c.text} />
        </Pressable>

        <View style={[styles.heroCard, { backgroundColor: cardBg, borderColor: c.border }]}>
          <Text style={[styles.kicker, { color: c.mutedText }]}>{resolveKicker(entry)}</Text>
          <Text style={[styles.title, { color: c.text }]}>{entry.title}</Text>
          {entry.lesson_title ? (
            <Text style={[styles.meta, { color: c.mutedText }]}>Lesson: {entry.lesson_title}</Text>
          ) : null}
          <Text style={[styles.meta, { color: c.mutedText }]}>Date: {formatDate(entry.scheduled_date)}</Text>
          <Text style={[styles.meta, { color: c.mutedText }]}>
            Day: {entry.day ? toTitleCase(entry.day) : "Not set"}
          </Text>
          <Text style={[styles.meta, { color: c.mutedText }]}>Time: {scheduleText}</Text>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: cardBg, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Description</Text>
          <Text style={[styles.body, { color: c.text }]}>
            {entry.description?.trim() || "No description added yet."}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.md,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
  },
  heroCard: {
    borderWidth: 1,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: 8,
  },
  kicker: {
    ...Typography.caption,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  title: {
    ...Typography.h1,
  },
  meta: {
    ...Typography.body,
  },
  sectionCard: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.h3,
  },
  body: {
    ...Typography.body,
    lineHeight: 22,
  },
  emptyText: {
    ...Typography.h3,
    textAlign: "center",
  },
});
