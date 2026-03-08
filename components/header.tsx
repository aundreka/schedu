import React from "react";
import { View, Text, Pressable, Image, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAppTheme } from "../context/theme";

export default function AppHeader() {
  const { colors: c } = useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 10, backgroundColor: c.card }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          <Image source={require("../assets/images/icon.png")} style={styles.logo} />
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <Text style={[styles.brandGray, { color: c.mutedText }]}>SCH</Text>
            <Text style={[styles.brandGreen, { color: c.tint }]}>EDU</Text>
          </View>
        </View>

        <Pressable onPress={() => router.push("/profile")} style={styles.iconBtn}>
          <Ionicons name="person-outline" size={22} color={c.mutedText} />
        </Pressable>
      </View>

      <View style={[styles.divider, { backgroundColor: c.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {},
  row: {
    height: 44,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  left: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 28, height: 28, resizeMode: "contain", },
  iconBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  divider: { height: 1 },
  brandGray: { fontSize: 22, letterSpacing: 1, fontWeight: "600" },
  brandGreen: { fontSize: 22, letterSpacing: 1, fontWeight: "700" },
});
