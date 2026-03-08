import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AppHeader from "../../components/header";
import { useAppTheme } from "../../context/theme";

type CreateAction = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: "/lessonplan" | "/subject" | "/notes" | "/activities";
};

const createActions: CreateAction[] = [
  { label: "Lessonplan", icon: "grid-outline", href: "/lessonplan" },
  { label: "Subject", icon: "book-outline", href: "/subject" },
  { label: "Notes", icon: "create-outline", href: "/notes" },
  { label: "Activities", icon: "cube-outline", href: "/activities" },
];

const lightCardTones = [
  { bg: "#DCEBFF", border: "#BFD6FF" }, // pastel blue
  { bg: "#FADCF0", border: "#F2BFE0" }, // pastel pink
  { bg: "#FDF3C8", border: "#F4DF9A" }, // pastel yellow
  { bg: "#D8F2D8", border: "#B7E2B8" }, // pastel green
] as const;

const darkCardTones = [
  { bg: "#2B3950", border: "#3B4D69" }, // muted blue
  { bg: "#4A3546", border: "#62485D" }, // muted pink
  { bg: "#4F472F", border: "#665D3E" }, // muted yellow
  { bg: "#2E4A3A", border: "#3D624E" }, // muted green
] as const;

export default function TabsLayout() {
  const { colors: c, scheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const isDark = scheme === "dark";

  const onCreatePress = (href: CreateAction["href"]) => {
    setCreateMenuOpen(false);
    router.push(href as never);
  };

  return (
    <>
      <Tabs
        screenOptions={{
          header: () => <AppHeader />,

          tabBarActiveTintColor: c.tint,
          tabBarInactiveTintColor: c.mutedText,

          tabBarShowLabel: true,
          tabBarHideOnKeyboard: true,
          tabBarStyle: {
            backgroundColor: c.card,
            borderTopColor: c.border,
            height: 70 + insets.bottom,
            paddingBottom: insets.bottom,
            paddingTop: 6,
          },
          tabBarLabelStyle: { fontSize: 11 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ size, color }) => (
              <Ionicons name="home-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="calendar"
          options={{
            title: "Calendar",
            tabBarIcon: ({ size, color }) => (
              <Ionicons name="calendar-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="create"
          listeners={{
            tabPress: (event) => {
              event.preventDefault();
              setCreateMenuOpen(true);
            },
          }}
          options={{
            title: "Create",
            tabBarIcon: ({ size, color }) => (
              <Ionicons name="add-circle-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="subject"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: "Library",
            tabBarIcon: ({ size, color }) => (
              <Ionicons name="book-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="plans"
          options={{
            title: "Plans",
            tabBarIcon: ({ size, color }) => (
              <Ionicons name="bookmark-outline" size={size} color={color} />
            ),
          }}
        />
      </Tabs>

      <Modal
        visible={createMenuOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setCreateMenuOpen(false)}
      >
        <Pressable
          style={[
            styles.backdrop,
            { backgroundColor: isDark ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.06)" },
          ]}
          onPress={() => setCreateMenuOpen(false)}
        >
          <View style={[styles.popupWrap, { paddingBottom: 82 + insets.bottom }]}>
            <Pressable
              style={[
                styles.popup,
                {
                  backgroundColor: c.card,
                  borderColor: c.border,
                },
              ]}
              onPress={() => {}}
            >
              <View style={styles.row}>
                {createActions.map((action, index) => {
                  const tone = isDark ? darkCardTones[index] : lightCardTones[index];
                  return (
                  <Pressable
                    key={action.label}
                    onPress={() => onCreatePress(action.href)}
                    style={({ pressed }) => [
                      styles.card,
                      {
                        backgroundColor: tone.bg,
                        borderColor: tone.border,
                      },
                      pressed && styles.cardPressed,
                    ]}
                  >
                    <Ionicons name={action.icon} size={22} color={c.text} />
                    <Text style={[styles.label, { color: c.text }]}>{action.label}</Text>
                  </Pressable>
                  );
                })}
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  popupWrap: {
    paddingHorizontal: 12,
  },
  popup: {
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderWidth: 1,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  card: {
    flex: 1,
    minHeight: 92,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 6,
  },
  cardPressed: {
    opacity: 0.82,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
  },
});
