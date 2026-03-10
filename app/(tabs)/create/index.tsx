import { useCallback, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { type Href, useFocusEffect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppTheme } from "../../../context/theme";

type CreateOption = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: Href;
};

const OPTIONS: CreateOption[] = [
  {
    key: "lessonplan",
    label: "Lessonplan",
    icon: "document-text-outline",
    route: "/(tabs)/create/lessonplan",
  },
  { key: "subject", label: "Subject", icon: "book-outline", route: "/(tabs)/create/subject" },
  { key: "notes", label: "Notes", icon: "create-outline", route: "/(tabs)/create/notes" },
  {
    key: "activities",
    label: "Activities",
    icon: "clipboard-outline",
    route: "/(tabs)/create/activities",
  },
];

export default function CreateScreen() {
  const { colors: c, scheme } = useAppTheme();
  const [open, setOpen] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setOpen(true);
    }, [])
  );

  const closePicker = useCallback(() => {
    setOpen(false);
    router.replace("/(tabs)");
  }, []);

  const goToCreate = useCallback((route: Href) => {
    setOpen(false);
    router.push(route);
  }, []);

  const isDark = scheme === "dark";
  const optionColors: Record<string, { bg: string; border: string; fg: string }> = {
    lessonplan: {
      bg: isDark ? "#2F3D45" : "#DDECF4",
      border: isDark ? "#435560" : "#CCDCE4",
      fg: isDark ? "#C7D9E2" : "#3B5563",
    },
    subject: {
      bg: isDark ? "#413850" : "#F4E3F5",
      border: isDark ? "#5A4D6E" : "#E4D1E5",
      fg: isDark ? "#DDD1EB" : "#59446A",
    },
    notes: {
      bg: isDark ? "#2D4634" : "#DFF2DE",
      border: isDark ? "#3E6049" : "#CFE2CD",
      fg: isDark ? "#C9E7D1" : "#3F6449",
    },
    activities: {
      bg: isDark ? "#4D4630" : "#F8EDC8",
      border: isDark ? "#685E41" : "#E8DDAF",
      fg: isDark ? "#ECE0BA" : "#6A5B34",
    },
  };

  return (
    <View style={[styles.page, { backgroundColor: c.background }]}>
      <Modal visible={open} transparent animationType="fade" onRequestClose={closePicker}>
        <Pressable style={styles.backdrop} onPress={closePicker}>
          <Pressable
            style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            <Text style={[styles.title, { color: c.text }]}>What do you want to create?</Text>
            <View style={styles.grid}>
              {OPTIONS.map((option) => (
                <Pressable
                  key={option.key}
                  style={[
                    styles.option,
                    {
                      backgroundColor: optionColors[option.key]?.bg ?? c.card,
                      borderColor: optionColors[option.key]?.border ?? c.border,
                    },
                  ]}
                  onPress={() => goToCreate(option.route)}
                >
                  <Ionicons name={option.icon} size={24} color={optionColors[option.key]?.fg ?? c.text} />
                  <Text style={[styles.optionText, { color: optionColors[option.key]?.fg ?? c.text }]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  option: {
    width: "48%",
    minHeight: 106,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 10,
  },
  optionText: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
});
