import { View, Text, StyleSheet, Pressable, Modal } from "react-native";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useAppTheme } from "../context/theme";

const OPTIONS = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

export default function Settings() {
  const { theme, setTheme, colors: c } = useAppTheme();
  const [open, setOpen] = useState(false);

  const currentLabel =
    OPTIONS.find((o) => o.value === theme)?.label ?? "System";

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <Text style={[styles.title, { color: c.text }]}>Appearance</Text>

      {/* Dropdown trigger */}
      <Pressable
        onPress={() => setOpen(true)}
        style={[
          styles.dropdown,
          {
            backgroundColor: c.card,
            borderColor: c.border,
          },
        ]}
      >
        <Text style={{ color: c.text, fontSize: 14 }}>{currentLabel}</Text>
        <Ionicons name="chevron-down" size={18} color={c.mutedText} />
      </Pressable>

      {/* Modal */}
      <Modal transparent animationType="fade" visible={open}>
        <Pressable
          style={styles.overlay}
          onPress={() => setOpen(false)}
        />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: c.card,
              borderColor: c.border,
            },
          ]}
        >
          {OPTIONS.map((opt) => {
            const active = opt.value === theme;
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  setTheme(opt.value as any);
                  setOpen(false);
                }}
                style={[
                  styles.option,
                  active && { backgroundColor: c.background },
                ]}
              >
                <Text
                  style={{
                    color: active ? c.tint : c.text,
                    fontWeight: active ? "600" : "400",
                  }}
                >
                  {opt.label}
                </Text>

                {active && (
                  <Ionicons
                    name="checkmark"
                    size={18}
                    color={c.tint}
                  />
                )}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },

  dropdown: {
    height: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
  },

  sheet: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 32,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 6,
  },

  option: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
