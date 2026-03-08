import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAppTheme } from "../../../context/theme";
import { Radius, Spacing, Typography } from "../../../constants/fonts";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import { supabase } from "../../../lib/supabase";

type LibrarySubject = {
  subject_id: string;
  code: string;
  title: string;
  school_name: string;
  year: string | null;
  subject_image: string | null;
  subject_image_signed_url: string | null;
};

function normalizeRow(row: any): LibrarySubject | null {
  const subjectRaw = row?.subject;
  const subject = Array.isArray(subjectRaw) ? subjectRaw[0] : subjectRaw;
  const schoolRaw = subject?.school;
  const school = Array.isArray(schoolRaw) ? schoolRaw[0] : schoolRaw;

  if (!subject?.subject_id || !subject?.code || !subject?.title) return null;

  return {
    subject_id: String(subject.subject_id),
    code: String(subject.code),
    title: String(subject.title),
    school_name: String(school?.name ?? "Unknown School"),
    year: subject?.year ? String(subject.year) : null,
    subject_image: subject?.subject_image ? String(subject.subject_image) : null,
    subject_image_signed_url: null,
  };
}

function toLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isHttpUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://");
}

export default function LibraryScreen() {
  const { colors: c, scheme } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [subjects, setSubjects] = useState<LibrarySubject[]>([]);
  const [currentSubjectIds, setCurrentSubjectIds] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCurrent, setShowCurrent] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedInstitution, setSelectedInstitution] = useState<string>("all");
  const [selectedYear, setSelectedYear] = useState<string>("all");

  const loadSubjects = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("No signed-in user found.");

      const { data, error } = await supabase
        .from("user_subjects")
        .select(
          "subject:subjects(subject_id, code, title, year, subject_image, school:schools(name))"
        )
        .eq("user_id", user.id);

      if (error) throw error;
      const mappedBase = (data ?? [])
        .map(normalizeRow)
        .filter((item: LibrarySubject | null): item is LibrarySubject => Boolean(item))
        .sort((a, b) => a.code.localeCompare(b.code));

      const mapped = await Promise.all(
        mappedBase.map(async (item) => {
          if (!item.subject_image) return item;
          if (isHttpUrl(item.subject_image)) {
            return { ...item, subject_image_signed_url: item.subject_image };
          }
          const { data: signed, error: signError } = await supabase.storage
            .from("uploads")
            .createSignedUrl(item.subject_image, 60 * 60);
          if (signError || !signed?.signedUrl) return item;
          return { ...item, subject_image_signed_url: signed.signedUrl };
        })
      );

      const today = toLocalDateString();
      const { data: plans, error: plansError } = await supabase
        .from("lesson_plans")
        .select("subject_id, start_date, end_date")
        .eq("user_id", user.id);
      if (plansError) throw plansError;

      const current = new Set<string>();
      for (const plan of plans ?? []) {
        const subjectId = String(plan?.subject_id ?? "");
        const start = String(plan?.start_date ?? "");
        const end = String(plan?.end_date ?? "");
        if (!subjectId || !start || !end) continue;

        if (start <= today && end >= today) current.add(subjectId);
      }

      setSubjects(mapped);
      setCurrentSubjectIds(current);
    } catch {
      setSubjects([]);
      setCurrentSubjectIds(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubjects();
  }, [loadSubjects]);

  const { refreshing, onRefresh } = usePullToRefresh(loadSubjects);

  const surface = useMemo(
    () => (scheme === "dark" ? c.card : "#F8F8F8"),
    [c.card, scheme]
  );

  const institutionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const subject of subjects) set.add(subject.school_name);
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [subjects]);

  const yearOptions = useMemo(() => {
    const set = new Set<string>();
    for (const subject of subjects) {
      if (subject.year && subject.year.trim()) set.add(subject.year.trim());
    }
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [subjects]);

  const filteredSubjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return subjects.filter((item) => {
      if (selectedInstitution !== "all" && item.school_name !== selectedInstitution) return false;
      if (selectedYear !== "all" && (item.year ?? "") !== selectedYear) return false;
      if (!query) return true;
      const haystack = `${item.code} ${item.title} ${item.school_name} ${item.year ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [
    subjects,
    selectedInstitution,
    selectedYear,
    searchQuery,
  ]);

  const sortedAllSubjects = useMemo(
    () =>
      [...filteredSubjects].sort((a, b) =>
        `${a.title} ${a.code}`.localeCompare(`${b.title} ${b.code}`)
      ),
    [filteredSubjects]
  );

  const sortedCurrentSubjects = useMemo(
    () =>
      sortedAllSubjects.filter((item) => currentSubjectIds.has(item.subject_id)),
    [sortedAllSubjects, currentSubjectIds]
  );

  const renderCards = (items: LibrarySubject[]) => (
    <View style={styles.gridWrap}>
      {items.map((item) => (
        <Pressable
          key={item.subject_id}
          style={styles.cardWrap}
          onPress={() =>
            router.push({
              pathname: "/library/subject_detail",
              params: { subjectId: item.subject_id },
            })
          }
        >
          <View style={[styles.cardTop, { backgroundColor: c.border }]}>
            {item.subject_image_signed_url ? (
              <Image
                source={{ uri: item.subject_image_signed_url }}
                style={styles.cardImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.imageFallback}>
                <Ionicons name="image-outline" size={34} color={c.mutedText} />
                <Text style={[styles.fallbackText, { color: c.mutedText }]}>No Image</Text>
              </View>
            )}
          </View>
          <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>
            <Text style={styles.codeText}>{item.code}</Text>
            {" - "}
            {item.title}
          </Text>
          <Text style={[styles.cardSub, { color: c.mutedText }]} numberOfLines={1}>
            {item.school_name}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={[styles.page, { backgroundColor: c.background }]}>
      <View style={[styles.content, { backgroundColor: surface }]}>
        <View style={styles.topRow}>
          <Text style={[styles.pageTitle, { color: c.text }]}>Library</Text>
          <View style={styles.actions}>
            <Pressable
              style={styles.iconBtn}
              onPress={() => {
                setSearchOpen((v) => !v);
                if (searchOpen) setSearchQuery("");
              }}
            >
              <Ionicons name="search-outline" size={22} color={c.text} />
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => router.push("/subject")}>
              <Ionicons name="add" size={24} color={c.text} />
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => setFilterOpen(true)}>
              <Ionicons name="options-outline" size={22} color={c.text} />
            </Pressable>
          </View>
        </View>

        {searchOpen ? (
          <View style={[styles.searchWrap, { borderColor: c.border, backgroundColor: c.card }]}>
            <Ionicons name="search-outline" size={18} color={c.mutedText} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by code, title, institution, or year"
              placeholderTextColor={c.mutedText}
              style={[styles.searchInput, { color: c.text }]}
              autoFocus
            />
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={c.tint} />
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.grid}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}
          >
            <Pressable style={styles.sectionHeader} onPress={() => setShowCurrent((v) => !v)}>
              <Text style={[styles.filterText, { color: c.text }]}>Current</Text>
              <Ionicons
                name={showCurrent ? "chevron-up" : "chevron-down"}
                size={14}
                color={c.text}
              />
            </Pressable>
            {showCurrent ? (
              sortedCurrentSubjects.length > 0 ? (
                renderCards(sortedCurrentSubjects)
              ) : (
                <Text style={[styles.sectionEmptyText, { color: c.mutedText }]}>
                  No current subjects.
                </Text>
              )
            ) : null}

            <View style={styles.allHeader}>
              <Text style={[styles.filterText, { color: c.text }]}>All</Text>
            </View>
            {sortedAllSubjects.length > 0 ? (
              renderCards(sortedAllSubjects)
            ) : (
              <Text style={[styles.sectionEmptyText, { color: c.mutedText }]}>
                No subjects match the current filters.
              </Text>
            )}
          </ScrollView>
        )}
      </View>

      <Modal
        visible={filterOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setFilterOpen(false)}>
          <Pressable
            style={[styles.modalCard, { borderColor: c.border, backgroundColor: c.card }]}
            onPress={() => {}}
          >
            <Text style={[styles.modalTitle, { color: c.text }]}>Filters</Text>

            <Text style={[styles.modalSection, { color: c.text }]}>Institution</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.schoolRow}>
              {institutionOptions.map((institution) => {
                const selected = selectedInstitution === institution;
                const label = institution === "all" ? "All Institutions" : institution;
                return (
                  <Pressable
                    key={institution}
                    onPress={() => setSelectedInstitution(institution)}
                    style={[
                      styles.schoolChip,
                      {
                        borderColor: selected ? c.tint : c.border,
                        backgroundColor: selected ? `${c.tint}22` : c.card,
                      },
                    ]}
                  >
                    <Text style={[styles.schoolChipText, { color: selected ? c.tint : c.text }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={[styles.modalSection, { color: c.text }]}>Year</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.schoolRow}>
              {yearOptions.map((year) => {
                const selected = selectedYear === year;
                const label = year === "all" ? "All Years" : year;
                return (
                  <Pressable
                    key={year}
                    onPress={() => setSelectedYear(year)}
                    style={[
                      styles.schoolChip,
                      {
                        borderColor: selected ? c.tint : c.border,
                        backgroundColor: selected ? `${c.tint}22` : c.card,
                      },
                    ]}
                  >
                    <Text style={[styles.schoolChipText, { color: selected ? c.tint : c.text }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setSelectedInstitution("all");
                  setSelectedYear("all");
                }}
                style={[styles.modalBtn, { borderColor: c.border }]}
              >
                <Text style={[styles.modalBtnText, { color: c.text }]}>Reset</Text>
              </Pressable>
              <Pressable
                onPress={() => setFilterOpen(false)}
                style={[styles.modalBtnPrimary, { backgroundColor: c.tint }]}
              >
                <Text style={styles.modalBtnPrimaryText}>Apply</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageTitle: {
    ...Typography.h1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  iconBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBtn: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
  },
  filterText: {
    ...Typography.h3,
  },
  searchWrap: {
    marginTop: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.md,
    minHeight: 40,
    paddingHorizontal: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    ...Typography.h3,
    paddingVertical: 8,
  },
  grid: {
    paddingBottom: Spacing.xxxl,
  },
  sectionHeader: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
  },
  allHeader: {
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  cardWrap: {
    width: "48%",
    marginBottom: Spacing.lg,
  },
  cardTop: {
    borderRadius: Radius.md,
    height: 226,
    overflow: "hidden",
    marginBottom: Spacing.sm,
  },
  cardImage: {
    width: "100%",
    height: "100%",
  },
  imageFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  fallbackText: {
    ...Typography.body,
  },
  cardTitle: {
    ...Typography.h3,
    fontWeight: "700",
    textAlign: "center",
  },
  codeText: {
    fontStyle: "italic",
  },
  cardSub: {
    ...Typography.body,
    textAlign: "center",
    marginTop: 2,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionEmptyText: {
    ...Typography.body,
    marginBottom: Spacing.md,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  modalTitle: {
    ...Typography.h2,
    fontWeight: "700",
  },
  modalSection: {
    ...Typography.h3,
    fontWeight: "600",
    marginTop: 4,
  },
  schoolRow: {
    gap: Spacing.sm,
    paddingVertical: 4,
  },
  schoolChip: {
    borderWidth: 1,
    borderRadius: Radius.round,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  schoolChipText: {
    ...Typography.body,
    fontWeight: "600",
  },
  modalActions: {
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
  },
  modalBtn: {
    minWidth: 80,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  modalBtnText: {
    ...Typography.h3,
    fontWeight: "600",
  },
  modalBtnPrimary: {
    minWidth: 80,
    minHeight: 36,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  modalBtnPrimaryText: {
    ...Typography.h3,
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
