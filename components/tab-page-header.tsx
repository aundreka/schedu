import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Spacing, Typography } from "../constants/fonts";

type HeaderAction = {
  key?: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  size?: number;
};

type TabPageHeaderProps = {
  title: string;
  textColor: string;
  actions: HeaderAction[];
};

export default function TabPageHeader({ title, textColor, actions }: TabPageHeaderProps) {
  return (
    <View style={styles.topRow}>
      <Text style={[styles.pageTitle, { color: textColor }]}>{title}</Text>
      <View style={styles.actions}>
        {actions.map((action, index) => (
          <Pressable
            key={action.key ?? `${action.icon}-${index}`}
            style={styles.iconBtn}
            onPress={action.onPress}
          >
            <Ionicons name={action.icon} size={action.size ?? 22} color={textColor} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
});
