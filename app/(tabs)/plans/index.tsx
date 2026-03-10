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
import { router } from "expo-router";
import { Radius, Spacing, Typography } from "../../../constants/fonts";
import TabPageHeader from "../../../components/tab-page-header";
import { useAppTheme } from "../../../context/theme";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import { supabase } from "../../../lib/supabase";

type PlanCardItem = {
  lesson_plan_id: string;
  title: string;
  start_date: string;
  end_date: string;
  subject_code: string;
  subject_year: string | null;
  section_name: string;
};

function toLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeYear(year: string | null) {
  const value = (year ?? "").trim();
  if (!value) return "";
  if (/^grade\s+/i.test(value)) return value;
  return `Grade ${value}`;
}

function getCardColor(subjectCode: string) {
  const code = subjectCode.toUpperCase();
  if (code.startsWith("MAT")) return "#EA6EA4";
  if (code.startsWith("SCI8")) return "#5A92D2";
  if (code.startsWith("SCI9")) return "#7A93B1";

  const palette = ["#EA6EA4", "#5A92D2", "#7A93B1", "#66A29A", "#A985D6"] as const;
  const hash = code.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function toPlanCard(row: any): PlanCardItem | null {
  const subjectRaw = row?.subject;
  const subject = Array.isArray(subjectRaw) ? subjectRaw[0] : subjectRaw;
  const sectionRaw = row?.section;
  const section = Array.isArray(sectionRaw) ? sectionRaw[0] : sectionRaw;

  const lessonPlanId = String(row?.lesson_plan_id ?? "");
  const startDate = String(row?.start_date ?? "");
  const endDate = String(row?.end_date ?? "");
  const subjectCode = String(subject?.code ?? "");

  if (!lessonPlanId || !startDate || !endDate || !subjectCode) return null;

  return {
    lesson_plan_id: lessonPlanId,
    title: String(row?.title ?? "Untitled Plan"),
    start_date: startDate,
    end_date: endDate,
    subject_code: subjectCode,
    subject_year: subject?.year ? String(subject.year) : null,
    section_name: String(section?.name ?? ""),
  };
}

export default function PlansScreen() {
  const { colors: c, scheme } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<PlanCardItem[]>([]);
  const [showCurrent, setShowCurrent] = useState(true);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("No signed-in user found.");

      const { data, error } = await supabase
        .from("lesson_plans")
        .select("lesson_plan_id, title, start_date, end_date, subject:subjects(code, year), section:sections(name)")
        .eq("user_id", user.id)
        .order("start_date", { ascending: false });

      if (error) throw error;

      const mapped = (data ?? [])
        .map(toPlanCard)
        .filter((item: PlanCardItem | null): item is PlanCardItem => Boolean(item))
        .sort((a, b) => a.subject_code.localeCompare(b.subject_code));

      setPlans(mapped);
    } catch {
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const { refreshing, onRefresh } = usePullToRefresh(loadPlans);

  const today = toLocalDateString();
  const currentPlans = useMemo(
    () => plans.filter((plan) => plan.start_date <= today && plan.end_date >= today),
    [plans, today]
  );

  const cardTextColor = "#F8FAFC";
  const surface = useMemo(() => (scheme === "dark" ? c.card : "#ECECEC"), [c.card, scheme]);

  const renderCard = (plan: PlanCardItem) => {
    const yearText = normalizeYear(plan.subject_year);
    const subtitle = [plan.subject_code, yearText, plan.section_name].filter(Boolean).join(" - ");

    return (
      <Pressable
        key={plan.lesson_plan_id}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: getCardColor(plan.subject_code), opacity: pressed ? 0.92 : 1 },
        ]}
        onPress={() =>
          router.push({
            pathname: "/plans/plan_detail",
            params: { lessonPlanId: plan.lesson_plan_id },
          })
        }
      >
        <Text style={[styles.cardCode, { color: cardTextColor }]} numberOfLines={2}>{plan.title}</Text>
        <Text style={[styles.cardSub, { color: cardTextColor }]} numberOfLines={1}>
          {subtitle || "No subject"}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.page, { backgroundColor: c.background }]}>
      <View style={[styles.content, { backgroundColor: surface }]}>
        <TabPageHeader
          title="Plans"
          textColor={c.text}
          actions={[
            {
              key: "create",
              icon: "add",
              onPress: () => router.push("/create/lessonplan"),
            },
            {
              key: "filter",
              icon: "options-outline",
              onPress: () => {},
            },
          ]}
        />

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={c.tint} />
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}
          >
            <Pressable style={styles.sectionHeader} onPress={() => setShowCurrent((v) => !v)}>
              <Text style={[styles.sectionTitle, { color: c.text }]}>Current</Text>
              <Ionicons
                name={showCurrent ? "caret-down" : "caret-forward"}
                size={14}
                color={c.text}
              />
            </Pressable>

            {showCurrent ? (
              currentPlans.length > 0 ? (
                <View style={styles.cardsWrap}>{currentPlans.map(renderCard)}</View>
              ) : (
                <Text style={[styles.emptyText, { color: c.mutedText }]}>No current plans.</Text>
              )
            ) : null}

            <View style={styles.allHeaderWrap}>
              <Text style={[styles.sectionTitle, { color: c.text }]}>All</Text>
            </View>

            {plans.length > 0 ? (
              <View style={styles.cardsWrap}>{plans.map(renderCard)}</View>
            ) : (
              <Text style={[styles.emptyText, { color: c.mutedText }]}>No plans found.</Text>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.h2,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "500",
  },
  cardsWrap: {
    gap: Spacing.md,
  },
  card: {
    borderRadius: Radius.lg,
    minHeight: 106,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 5,
    elevation: 4,
  },
  cardCode: {
    ...Typography.h2,
    fontSize: 24,
    lineHeight: 30,
    fontStyle: "italic",
    fontWeight: "700",
  },
  cardSub: {
    ...Typography.body,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  allHeaderWrap: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  listContent: {
    paddingBottom: Spacing.xxxl,
  },
  emptyText: {
    ...Typography.body,
    marginBottom: Spacing.md,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
