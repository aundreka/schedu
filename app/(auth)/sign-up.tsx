// app/(auth)/signup.tsx
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
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
// ✅ change this path if your supabase client lives elsewhere
import { supabase } from "../../lib/supabase";

export default function Signup() {
  const { colors: c, ready } = useAppTheme();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const normalizedUsername = useMemo(() => username.trim().toLowerCase(), [username]);
  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);

  const validate = () => {
    const fn = firstName.trim();
    const ln = lastName.trim();
    const un = normalizedUsername;
    const em = normalizedEmail;

    if (!fn || !ln || !un || !em || !password) return "Please fill out all fields.";
    if (un.length < 3) return "Username must be at least 3 characters.";
    if (!/^[a-z0-9._-]+$/.test(un)) return "Username can only use letters, numbers, ., _, and -";
    if (!em.includes("@")) return "Please enter a valid email.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    return null;
  };

  const checkAvailability = async () => {
    // Checks if username/email already exists in public.users
    const un = normalizedUsername;
    const em = normalizedEmail;

    const { data: byUsername, error: e1 } = await supabase
      .from("users")
      .select("userid")
      .eq("username", un)
      .maybeSingle();

    if (e1) throw e1;
    if (byUsername?.userid) return "That username is already taken.";

    const { data: byEmail, error: e2 } = await supabase
      .from("users")
      .select("userid")
      .eq("email", em)
      .maybeSingle();

    if (e2) throw e2;
    if (byEmail?.userid) return "That email is already registered.";

    return null;
  };

 const handleSignup = async () => {
  setErrorMsg(null);

  const v = validate();
  if (v) {
    setErrorMsg(v);
    return;
  }

  try {
    setBusy(true);

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        },
      },
    });

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    const userId = data.user?.id;
    if (!userId) {
      setErrorMsg("Account created, but no user returned. Please try signing in.");
      return;
    }

    const { error: upErr } = await supabase
      .from("users")
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        username: normalizedUsername,
        email: normalizedEmail,
      })
      .eq("userid", userId);

    if (upErr) {
      if (upErr.message?.toLowerCase().includes("duplicate")) {
        setErrorMsg("Username or email is already in use.");
      } else {
        setErrorMsg(upErr.message || "Profile setup failed.");
      }
      return;
    }

    if (!data.session) {
      router.replace("/(auth)");
      return;
    }

    router.replace("/(tabs)");
  } catch (e: any) {
    setErrorMsg(e?.message ?? "Sign up failed.");
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
        {/* Header */}
        <View style={styles.topRow}>
          <Pressable onPress={() => router.back()} disabled={busy} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={20} color={c.text} />
            <Text style={{ color: c.text, fontWeight: "600" }}>Back</Text>
          </Pressable>
        </View>

        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: c.text }]}>Create account</Text>
          <Text style={[styles.subtitle, { color: c.mutedText }]}>
            Sign up to start generating lesson plans.
          </Text>
        </View>

        {/* Form Card */}
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.nameRow}>
            <TextInput
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
              placeholderTextColor={c.mutedText}
              autoCapitalize="words"
              style={[styles.input, styles.half, { borderColor: c.border, color: c.text }]}
              editable={!busy}
            />

            <TextInput
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              placeholderTextColor={c.mutedText}
              autoCapitalize="words"
              style={[styles.input, styles.half, { borderColor: c.border, color: c.text }]}
              editable={!busy}
            />
          </View>

          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            placeholderTextColor={c.mutedText}
            autoCapitalize="none"
            style={[styles.input, { borderColor: c.border, color: c.text }]}
            editable={!busy}
          />

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

          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password (min 8 chars)"
            placeholderTextColor={c.mutedText}
            secureTextEntry
            style={[styles.input, { borderColor: c.border, color: c.text }]}
            editable={!busy}
          />

          <Pressable
            onPress={handleSignup}
            disabled={busy}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: c.tint },
              pressed && { opacity: 0.9 },
              busy && { opacity: 0.7 },
            ]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Sign Up</Text>}
          </Pressable>

          {errorMsg ? <Text style={[styles.error, { color: "#ef4444" }]}>{errorMsg}</Text> : null}
        </View>

        {/* Footer */}
        <View style={styles.footerRow}>
          <Text style={{ color: c.mutedText }}>Already have an account? </Text>
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

  nameRow: {
    flexDirection: "row",
    gap: 10,
  },
  half: { flex: 1 },

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

  footerRow: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  link: { fontWeight: "800" },
});
