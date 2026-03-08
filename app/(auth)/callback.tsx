import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../lib/supabase";

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{
    code?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
  }>();
  const [message, setMessage] = useState("Finishing sign in...");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const oauthError = Array.isArray(params.error) ? params.error[0] : params.error;
      const oauthErrorDescription = Array.isArray(params.error_description)
        ? params.error_description[0]
        : params.error_description;

      if (oauthError || oauthErrorDescription) {
        if (!cancelled) {
          setMessage(oauthErrorDescription || oauthError || "OAuth sign in failed.");
          setTimeout(() => router.replace("/(auth)"), 1200);
        }
        return;
      }

      const code = Array.isArray(params.code) ? params.code[0] : params.code;
      if (!code) {
        if (!cancelled) {
          setMessage("No auth code received.");
          setTimeout(() => router.replace("/(auth)"), 1200);
        }
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (cancelled) return;

      if (error) {
        setMessage(error.message || "Could not establish a session.");
        setTimeout(() => router.replace("/(auth)"), 1200);
        return;
      }

      router.replace("/(tabs)");
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [params.code, params.error, params.error_description]);

  return (
    <View style={styles.screen}>
      <ActivityIndicator />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 24,
  },
  text: {
    fontSize: 14,
    opacity: 0.8,
    textAlign: "center",
  },
});
