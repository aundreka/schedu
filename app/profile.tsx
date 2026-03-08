import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppTheme } from "../context/theme";

export default function Profile() {
  const { colors: c } = useAppTheme();

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.title, { color: c.text }]}>Profile</Text>
        <Text style={[styles.sub, { color: c.mutedText }]}>
          Manage your account and preferences.
        </Text>
      </View>

      <View style={{ flex: 1 }} />

      <Pressable
        onPress={() => router.push("/settings")}
        style={({ pressed }) => [
          styles.settingsBtn,
          {
            backgroundColor: c.card,
            borderColor: c.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons name="settings-outline" size={20} color={c.text} />
        <Text style={[styles.settingsText, { color: c.text }]}>Settings</Text>
        <View style={{ flex: 1 }} />
        <Ionicons name="chevron-forward" size={18} color={c.mutedText} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: { borderRadius: 14, padding: 16, borderWidth: 1 },
  title: { fontSize: 20, fontWeight: "700" },
  sub: { marginTop: 6, fontSize: 13 },

  settingsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  settingsText: { fontSize: 16, fontWeight: "600" },
});
