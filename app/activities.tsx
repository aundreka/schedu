import React from "react";
import { StyleSheet, Text, View } from "react-native";

export default function ActivitiesScreen() {
  return (
    <View style={styles.page}>
      <Text style={styles.title}>Activities</Text>
      <Text style={styles.sub}>Create classroom activities here.</Text>
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
