import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppTheme } from "../context/theme";
import { supabase } from "../lib/supabase";

const OPTIONS = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
] as const;

export default function Settings() {
  const { theme, setTheme, colors: c } = useAppTheme();
  const [open, setOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [initialEmail, setInitialEmail] = useState("");
  const [savedDetails, setSavedDetails] = useState({
    firstName: "",
    lastName: "",
    username: "",
    email: "",
  });
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");

  const currentLabel = OPTIONS.find((o) => o.value === theme)?.label ?? "System";

  const loadUserDetails = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error) throw error;
      if (!user) throw new Error("No signed-in user found.");

      setUserId(user.id);
      const authEmail = user.email ?? "";
      setInitialEmail(authEmail);

      const { data: row, error: profileErr } = await supabase
        .from("users")
        .select("first_name, last_name, username, email")
        .eq("userid", user.id)
        .maybeSingle();
      if (profileErr) throw profileErr;

      const nextDetails = {
        firstName: row?.first_name ?? "",
        lastName: row?.last_name ?? "",
        username: row?.username ?? "",
        email: row?.email ?? authEmail,
      };
      setSavedDetails(nextDetails);
      setFirstName(nextDetails.firstName);
      setLastName(nextDetails.lastName);
      setUsername(nextDetails.username);
      setEmail(nextDetails.email);
    } catch {
      setSavedDetails({ firstName: "", lastName: "", username: "", email: "" });
      setFirstName("");
      setLastName("");
      setUsername("");
      setEmail("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUserDetails();
  }, [loadUserDetails]);

  const handleSaveDetails = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      const nextEmail = email.trim();
      const payload = {
        userid: userId,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        username: username.trim() || null,
        email: nextEmail || null,
      };

      const { error: profileErr } = await supabase.from("users").upsert(payload, {
        onConflict: "userid",
      });
      if (profileErr) throw profileErr;

      if (nextEmail && nextEmail !== initialEmail) {
        const { error: authErr } = await supabase.auth.updateUser({ email: nextEmail });
        if (authErr) throw authErr;
        setInitialEmail(nextEmail);
      }

      const nextSaved = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim(),
        email: nextEmail,
      };
      setSavedDetails(nextSaved);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.screenTopRow}>
          <Text style={[styles.screenTitle, { color: c.text }]}>Settings</Text>
        </View>

        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.title, { color: c.text }]}>User Details</Text>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={c.tint} />
            </View>
          ) : !isEditing ? (
            <View style={styles.detailsWrap}>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: c.mutedText }]}>First name</Text>
                <Text style={[styles.detailValue, { color: c.text }]}>{savedDetails.firstName || "-"}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: c.mutedText }]}>Last name</Text>
                <Text style={[styles.detailValue, { color: c.text }]}>{savedDetails.lastName || "-"}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: c.mutedText }]}>Username</Text>
                <Text style={[styles.detailValue, { color: c.text }]}>{savedDetails.username || "-"}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: c.mutedText }]}>Email</Text>
                <Text style={[styles.detailValue, { color: c.text }]}>{savedDetails.email || "-"}</Text>
              </View>

              <Pressable
                onPress={() => setIsEditing(true)}
                style={[styles.secondaryBtn, { borderColor: c.border, backgroundColor: c.background }]}
              >
                <Text style={[styles.secondaryBtnText, { color: c.text }]}>Edit</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.formWrap}>
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First name"
                placeholderTextColor={c.mutedText}
                style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
              />
              <TextInput
                value={lastName}
                onChangeText={setLastName}
                placeholder="Last name"
                placeholderTextColor={c.mutedText}
                style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
              />
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="Username"
                autoCapitalize="none"
                placeholderTextColor={c.mutedText}
                style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
              />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor={c.mutedText}
                style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
              />
              <Pressable
                onPress={handleSaveDetails}
                disabled={saving}
                style={[styles.saveBtn, { backgroundColor: c.tint, opacity: saving ? 0.8 : 1 }]}
              >
                <Text style={styles.saveBtnText}>{saving ? "Saving..." : "Save"}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setFirstName(savedDetails.firstName);
                  setLastName(savedDetails.lastName);
                  setUsername(savedDetails.username);
                  setEmail(savedDetails.email);
                  setIsEditing(false);
                }}
                disabled={saving}
                style={[styles.secondaryBtn, { borderColor: c.border }]}
              >
                <Text style={[styles.secondaryBtnText, { color: c.text }]}>Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.title, { color: c.text }]}>Appearance</Text>

          <Pressable
            onPress={() => setOpen(true)}
            style={[styles.dropdown, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <Text style={{ color: c.text, fontSize: 14 }}>{currentLabel}</Text>
            <Ionicons name="chevron-down" size={18} color={c.mutedText} />
          </Pressable>
        </View>
      </ScrollView>

      {/* Modal */}
      <Modal transparent animationType="fade" visible={open}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} />

        <View style={[styles.sheet, { backgroundColor: c.card, borderColor: c.border }]}>
          {OPTIONS.map((opt) => {
            const active = opt.value === theme;
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  setTheme(opt.value as any);
                  setOpen(false);
                }}
                style={[styles.option, active && { backgroundColor: c.background }]}
              >
                <Text
                  style={{
                    color: active ? c.tint : c.text,
                    fontWeight: active ? "600" : "400",
                  }}
                >
                  {opt.label}
                </Text>

                {active && <Ionicons name="checkmark" size={18} color={c.tint} />}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 28, gap: 12 },
  screenTopRow: {
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  screenTitle: { fontSize: 24, fontWeight: "800", letterSpacing: -0.3 },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  loadingWrap: {
    minHeight: 64,
    justifyContent: "center",
    alignItems: "center",
  },
  detailsWrap: { gap: 10 },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  detailLabel: { fontSize: 13 },
  detailValue: { fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  formWrap: { gap: 10 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  saveBtn: {
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    marginTop: 2,
  },
  saveBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: "600" },

  dropdown: {
    height: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
  },

  sheet: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 32,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 6,
  },

  option: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
