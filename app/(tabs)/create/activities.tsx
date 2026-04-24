import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../../../context/theme";

type ActivityCategory = "written_work" | "performance_task" | null;

type ComponentChip = {
  label: string;
  tone?: "yellow" | "blue";
};

const WRITTEN_WORK_COMPONENTS: ComponentChip[] = [
  { label: "Multiple Choice", tone: "yellow" },
  { label: "Identification w/ Word Bank" },
  { label: "Matching Type" },
  { label: "Enumeration", tone: "blue" },
  { label: "Picture Identification" },
  { label: "Fill in the Blank" },
  { label: "Word Scramble" },
  { label: "Essay" },
  { label: "Logic" },
];

const PERFORMANCE_TASK_COMPONENTS: ComponentChip[] = [
  { label: "Instructions" },
  { label: "Rubrix" },
  { label: "Grading Sheet" },
];

export default function ActivitiesScreen() {
  const { colors: c } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<ActivityCategory>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const activityType = useMemo(() => {
    if (category === "written_work") return "Quiz";
    if (category === "performance_task") return "Project";
    return "";
  }, [category]);

  const selectedCategoryLabel = useMemo(() => {
    if (category === "written_work") return "Written Work";
    if (category === "performance_task") return "Performance Task";
    return "Category";
  }, [category]);

  const requirements = category === "written_work"
    ? ["No. of Items", "Lesson"]
    : category === "performance_task"
      ? ["Brief description"]
      : [];

  const components = category === "written_work" ? WRITTEN_WORK_COMPONENTS : PERFORMANCE_TASK_COMPONENTS;

  return (
    <View style={[styles.page, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 28 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <Pressable style={styles.topLeft} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={16} color="#111111" />
            <Text style={styles.title}>Create Activity</Text>
          </Pressable>

          <Pressable style={styles.iconButton}>
            <Ionicons name="checkmark" size={28} color="#111111" />
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>Overview</Text>

        <View style={styles.fieldGrid}>
          <Pressable
            style={[styles.fieldBox, category ? styles.activeFieldBox : styles.disabledFieldBox]}
            onPress={() => setPickerOpen(true)}
          >
            <Text style={[styles.fieldText, category ? styles.activeFieldText : styles.disabledFieldText]}>
              {selectedCategoryLabel}
            </Text>
          </Pressable>

          <View style={[styles.fieldBox, category ? styles.activeFieldBox : styles.disabledFieldBox]}>
            <Text style={[styles.fieldText, category ? styles.activeFieldText : styles.disabledFieldText]}>
              {category ? activityType : "Activity Type"}
            </Text>
          </View>

          <View style={styles.disabledFieldBox}>
            <Text style={[styles.fieldText, styles.disabledFieldText]}>Subject</Text>
          </View>

          <View style={styles.disabledFieldBox}>
            <Text style={[styles.fieldText, styles.disabledFieldText]}>Scope</Text>
          </View>
        </View>

        {category ? (
          <>
            <View style={styles.divider} />

            <Text style={styles.sectionLabel}>Requirements</Text>
            <View style={requirements.length > 1 ? styles.fieldGrid : styles.singleFieldWrap}>
              {requirements.map((label) => (
                <View
                  key={label}
                  style={[styles.disabledFieldBox, requirements.length === 1 && styles.fullFieldBox]}
                >
                  <Text style={[styles.fieldText, styles.disabledFieldText]}>{label}</Text>
                </View>
              ))}
            </View>

            <View style={styles.divider} />

            <Text style={styles.sectionLabel}>Components</Text>
            <View style={styles.componentWrap}>
              {components.map((item) => (
                <Pressable
                  key={item.label}
                  style={[
                    styles.chip,
                    item.tone === "yellow" && styles.yellowChip,
                    item.tone === "blue" && styles.blueChip,
                  ]}
                >
                  <Text style={styles.chipText}>{item.label}</Text>
                </Pressable>
              ))}
            </View>

            {category === "written_work" ? (
              <View style={styles.previewPanel}>
                <View style={[styles.previewCard, styles.previewYellow]}>
                  <Text style={styles.previewText}>I. Multiple Choice</Text>
                </View>
                <View style={[styles.previewCard, styles.previewBlue]}>
                  <Text style={styles.previewText}>II. Enumeration</Text>
                </View>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <Modal transparent visible={pickerOpen} animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select category</Text>
            <Pressable
              style={styles.modalOption}
              onPress={() => {
                setCategory("written_work");
                setPickerOpen(false);
              }}
            >
              <Text style={styles.modalOptionText}>Written Work</Text>
            </Pressable>
            <Pressable
              style={styles.modalOption}
              onPress={() => {
                setCategory("performance_task");
                setPickerOpen(false);
              }}
            >
              <Text style={styles.modalOptionText}>Performance Task</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  topLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111111",
  },
  iconButton: {
    padding: 2,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "400",
    color: "#111111",
    marginBottom: 10,
  },
  fieldGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  singleFieldWrap: {
    gap: 8,
  },
  fieldBox: {
    width: "48.8%",
    minHeight: 38,
    borderRadius: 1,
    borderWidth: 1.2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  activeFieldBox: {
    backgroundColor: "#FFFFFF",
    borderColor: "#222222",
  },
  disabledFieldBox: {
    width: "48.8%",
    minHeight: 38,
    borderRadius: 1,
    backgroundColor: "#FAFAFA",
    borderWidth: 1,
    borderColor: "#FAFAFA",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  fullFieldBox: {
    width: "100%",
  },
  fieldText: {
    fontSize: 13,
    fontWeight: "400",
    textAlign: "center",
  },
  activeFieldText: {
    color: "#111111",
  },
  disabledFieldText: {
    color: "#BCBCBC",
  },
  divider: {
    height: 1,
    backgroundColor: "#E5E5E5",
    marginVertical: 20,
  },
  componentWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    minHeight: 38,
    borderRadius: 9,
    borderWidth: 1.2,
    borderColor: "#222222",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  yellowChip: {
    backgroundColor: "#FFF17D",
  },
  blueChip: {
    backgroundColor: "#AFCBED",
  },
  chipText: {
    fontSize: 12,
    fontWeight: "400",
    color: "#111111",
  },
  previewPanel: {
    backgroundColor: "#FAFAFA",
    marginTop: 22,
    paddingHorizontal: 14,
    paddingVertical: 22,
    gap: 14,
  },
  previewCard: {
    minHeight: 52,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  previewYellow: {
    backgroundColor: "#FFF785",
  },
  previewBlue: {
    backgroundColor: "#AACAF1",
  },
  previewText: {
    fontSize: 14,
    fontWeight: "400",
    color: "#111111",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.18)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    padding: 18,
    gap: 10,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111111",
    marginBottom: 2,
  },
  modalOption: {
    borderWidth: 1,
    borderColor: "#D9D9D9",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalOptionText: {
    fontSize: 14,
    color: "#111111",
  },
});
