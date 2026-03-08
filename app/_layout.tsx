import { Stack } from "expo-router";
import { ThemeProvider as NavThemeProvider, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { ThemeProvider, useAppTheme } from "../context/theme";

function AppNav() {
  const { scheme } = useAppTheme();

  return (
    <NavThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Back" }} />
        <Stack.Screen name="profile" options={{ headerShown: true, title: "Profile" }} />
        <Stack.Screen name="settings" options={{ headerShown: true, title: "Settings" }} />
      </Stack>
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AppNav />
    </ThemeProvider>
  );
}
