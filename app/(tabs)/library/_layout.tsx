import { Stack } from "expo-router";

export default function LibraryLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="subject_detail" />
      <Stack.Screen name="lesson_detail" />
      <Stack.Screen name="lesson_editor" />
      <Stack.Screen name="ww_detail" />
      <Stack.Screen name="pt_detail" />
    </Stack>
  );
}
