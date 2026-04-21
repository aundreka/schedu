import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAppTheme } from "../../context/theme";
import { supabase } from "../../lib/supabase";

export default function ForgotPassword() {
  const { colors: c, ready } = useAppTheme();

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const redirectTo = useMemo(() => Linking.createURL("auth/update-password"), []);

  const handleResetRequest = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!normalizedEmail) {
      setErrorMsg("Please enter your email address.");
      return;
    }

    if (!normalizedEmail.includes("@")) {
      setErrorMsg("Please enter a valid email.");
      return;
    }

    try {
      setBusy(true);

      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo,
      });

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      setSuccessMsg("If an account exists for that email, a reset link has been sent.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Could not send reset email.");
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: c.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Pressable onPress={() => router.back()} disabled={busy} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={20} color={c.text} />
            <Text style={{ color: c.text, fontWeight: "600" }}>Back</Text>
          </Pressable>
        </View>

        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: c.text }]}>Forgot password</Text>
          <Text style={[styles.subtitle, { color: c.mutedText }]}>
            Enter the email linked to your account and we&apos;ll send you a reset link.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={c.mutedText}
            autoCapitalize="none"
            keyboardType="email-address"
            style={[styles.input, { borderColor: c.border, color: c.text }]}
            editable={!busy}
          />

          <Pressable
            onPress={handleResetRequest}
            disabled={busy}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: c.tint },
              pressed && { opacity: 0.9 },
              busy && { opacity: 0.7 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Send Reset Link</Text>
            )}
          </Pressable>

          {errorMsg ? <Text style={[styles.error, { color: "#ef4444" }]}>{errorMsg}</Text> : null}
          {successMsg ? (
            <Text style={[styles.success, { color: c.tint }]}>{successMsg}</Text>
          ) : null}
        </View>

        <View style={styles.footerRow}>
          <Text style={{ color: c.mutedText }}>Remembered your password? </Text>
          <Pressable onPress={() => router.replace("/(auth)")} disabled={busy}>
            <Text style={[styles.link, { color: c.tint }]}>Sign in</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 64,
    justifyContent: "center",
  },

  topRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    marginBottom: 8,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },

  titleBlock: { marginTop: 10, marginBottom: 14 },
  title: { fontSize: 26, fontWeight: "800" },
  subtitle: { marginTop: 6, fontSize: 13, lineHeight: 18 },

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

  error: { marginTop: 10, fontSize: 13 },
  success: { marginTop: 10, fontSize: 13 },

  footerRow: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  link: { fontWeight: "800" },
});
