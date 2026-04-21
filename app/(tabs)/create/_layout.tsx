import { Stack } from "expo-router";

export default function CreateLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        gestureDirection: "horizontal",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="lessonplan" />
      <Stack.Screen name="subject" />
      <Stack.Screen name="lesson" />
      <Stack.Screen name="activities" />
    </Stack>
  );
}
