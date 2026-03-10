import { Stack } from "expo-router";

export default function PlansLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="plan_detail" />
    </Stack>
  );
}
