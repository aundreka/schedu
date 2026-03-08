// app/(auth)/index.tsx
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";

import { useAppTheme } from "../../context/theme";
// ✅ change this path if your supabase client lives elsewhere
import { supabase } from "../../lib/supabase";

type Provider = "google" | "apple" | "facebook";

export default function AuthIndex() {
  const { colors: c, ready } = useAppTheme();

  const [identifier, setIdentifier] = useState(""); // username OR email
  const [password, setPassword] = useState("");

  const [loadingEmailPass, setLoadingEmailPass] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<Provider | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const redirectTo = useMemo(() => Linking.createURL("auth/callback"), []);

  const isEmail = (v: string) => v.includes("@");

  const getEmailFromIdentifier = async (id: string): Promise<string | null> => {
    const trimmed = id.trim();
    if (!trimmed) return null;

    if (isEmail(trimmed)) return trimmed;

    // Lookup email by username in public.users (case-insensitive).
    const { data, error } = await supabase
      .from("users")
      .select("email")
      .ilike("username", trimmed)
      .limit(1);

    if (error) throw error;
    return data?.[0]?.email ?? null;
  };

  const handlePasswordSignIn = async () => {
    setErrorMsg(null);

    const id = identifier.trim();
    if (!id || !password) {
      setErrorMsg("Please enter your username/email and password.");
      return;
    }

    try {
      setLoadingEmailPass(true);

      const email = await getEmailFromIdentifier(id);
      if (!email) {
        setErrorMsg("Account not found.");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      // ✅ signed in — send to your main area
      router.replace("/(tabs)");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Sign in failed.");
    } finally {
      setLoadingEmailPass(false);
    }
  };

  const handleOAuth = async (provider: Provider) => {
    setErrorMsg(null);
    try {
      setLoadingProvider(provider);

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });

      if (error) setErrorMsg(error.message);
      // OAuth will return via deep link; session listener can be elsewhere (e.g., root layout).
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Sign in failed.");
    } finally {
      setLoadingProvider(null);
    }
  };

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const busy = loadingEmailPass || !!loadingProvider;

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: c.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.content}>
        {/* Brand (similar layout to your reference image) */}
        <View style={styles.brandRow}>
          <Image source={require("../../assets/images/icon.png")} style={styles.brandLogo} />
          <View>
            <Text style={[styles.brandTitle, { color: c.text }]}>schEDU</Text>
            <Text style={[styles.brandTag, { color: c.mutedText }]}>Smarter Lesson Planning</Text>
          </View>
        </View>

        {/* Card */}
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <TextInput
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="Username or email"
            placeholderTextColor={c.mutedText}
            autoCapitalize="none"
            style={[styles.input, { borderColor: c.border, color: c.text }]}
            editable={!busy}
          />

          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={c.mutedText}
            secureTextEntry
            style={[styles.input, { borderColor: c.border, color: c.text }]}
            editable={!busy}
          />

          <Pressable
            onPress={handlePasswordSignIn}
            disabled={busy}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: c.tint },
              pressed && { opacity: 0.9 },
              busy && { opacity: 0.7 },
            ]}
          >
            {loadingEmailPass ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Sign In</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => router.push("/(auth)/forgot-password")}
            disabled={busy}
            style={{ alignSelf: "flex-start", marginTop: 10 }}
          >
            <Text style={[styles.link, { color: c.mutedText }]}>Forgot password?</Text>
          </Pressable>

          {errorMsg ? (
            <Text style={[styles.error, { color: "#ef4444" }]}>{errorMsg}</Text>
          ) : null}
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
          <Text style={[styles.dividerText, { color: c.mutedText }]}>or</Text>
          <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
        </View>

        {/* Small icon-only OAuth buttons (horizontal) */}
        <View style={styles.oauthRow}>
          <IconAuthButton
            icon="logo-google"
            onPress={() => handleOAuth("google")}
            loading={loadingProvider === "google"}
            disabled={busy}
            c={c}
          />

          {Platform.OS === "ios" && (
            <IconAuthButton
              icon="logo-apple"
              onPress={() => handleOAuth("apple")}
              loading={loadingProvider === "apple"}
              disabled={busy}
              c={c}
            />
          )}

          <IconAuthButton
            icon="logo-facebook"
            onPress={() => handleOAuth("facebook")}
            loading={loadingProvider === "facebook"}
            disabled={busy}
            c={c}
          />
        </View>

        {/* Register */}
        <View style={styles.registerRow}>
          <Text style={{ color: c.mutedText }}>Don’t have an Account? </Text>
          <Pressable onPress={() => router.push("/(auth)/sign-up")} disabled={busy}>
            <Text style={[styles.registerLink, { color: c.tint }]}>Register</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function IconAuthButton({
  icon,
  onPress,
  loading,
  disabled,
  c,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
  c: any;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.iconBtn,
        { borderColor: c.border, backgroundColor: c.card },
        pressed && { opacity: 0.9 },
        disabled && { opacity: 0.7 },
      ]}
    >
      {loading ? (
        <ActivityIndicator />
      ) : (
        <Ionicons name={icon} size={18} color={c.text} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "center",
  },

  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    marginBottom: 18,
  },
  brandLogo: {
    width: 42,
    height: 42,
  },
  brandTitle: { fontSize: 30, fontWeight: "800", letterSpacing: 0.5 },
  brandTag: { fontSize: 12, marginTop: -2 },

  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },

  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
    fontSize: 14,
  },

  primaryBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  link: { fontSize: 13, textDecorationLine: "underline" },

  error: { marginTop: 10, fontSize: 13 },

  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 18,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12 },

  oauthRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginBottom: 16,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  registerRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  registerLink: { fontWeight: "700" },
});
