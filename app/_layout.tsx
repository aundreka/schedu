import { Stack, router, useRootNavigationState, useSegments } from "expo-router";
import { Image, StyleSheet, Text, View } from "react-native";
import { ThemeProvider as NavThemeProvider, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useEffect } from "react";
import { ThemeProvider, useAppTheme } from "../context/theme";
import { supabase } from "../lib/supabase";

function BrandTitle({
  mutedText,
  tint,
}: {
  mutedText: string;
  tint: string;
}) {
  return (
    <View style={styles.brandWrap}>
      <Image source={require("../assets/images/icon.png")} style={styles.logo} />
      <View style={styles.brandTextRow}>
        <Text style={[styles.brandGray, { color: mutedText }]}>SCH</Text>
        <Text style={[styles.brandGreen, { color: tint }]}>EDU</Text>
      </View>
    </View>
  );
}

function AppNav() {
  const { scheme, colors: c } = useAppTheme();
  const segments = useSegments();
  const navigationState = useRootNavigationState();
  const isAuthRoute = segments[0] === "(auth)";

  useEffect(() => {
    if (!navigationState?.key) return;

    let active = true;

    const redirectToAuthIfMissing = (hasSession: boolean) => {
      if (!active || hasSession || isAuthRoute) return;
      router.replace("/(auth)");
    };

    void supabase.auth.getSession().then(({ data: { session } }) => {
      redirectToAuthIfMissing(!!session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      redirectToAuthIfMissing(!!session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [isAuthRoute, navigationState?.key]);

  return (
    <NavThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: c.card,
          },
          headerShadowVisible: false,
          headerTintColor: c.text,
          headerTitleAlign: "left",
          headerTitle: () => <BrandTitle mutedText={c.mutedText} tint={c.tint} />,
          headerBackTitle: "Back",
          headerBackTitleStyle: {
            fontSize: 15,
          },
          headerBackButtonDisplayMode: "default",
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ headerShown: true }} />
      </Stack>
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider>
        <AppNav />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  brandWrap: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 28, height: 28, resizeMode: "contain" },
  brandTextRow: { flexDirection: "row", alignItems: "baseline" },
  brandGray: { fontSize: 22, letterSpacing: 1, fontWeight: "600" },
  brandGreen: { fontSize: 22, letterSpacing: 1, fontWeight: "700" },
});
