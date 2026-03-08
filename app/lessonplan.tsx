import React from "react";
import { StyleSheet, Text, View } from "react-native";

export default function LessonplanScreen() {
  return (
    <View style={styles.page}>
      <Text style={styles.title}>Lessonplan</Text>
      <Text style={styles.sub}>Build your lesson plan here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
  },
  sub: {
    fontSize: 15,
    opacity: 0.7,
  },
});
