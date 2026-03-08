import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppTheme } from "../context/theme";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { supabase } from "../lib/supabase";

type SchoolType = "university" | "basic_ed" | "training_center";
type InstitutionFilter = "all" | "primary" | SchoolType;

type Institution = {
  school_id: string;
  name: string;
  type: SchoolType;
  is_default: boolean;
  is_primary: boolean;
  avatar_url: string | null;
  avatar_color: string | null;
  avatar_signed_url: string | null;
};

type UserProfile = {
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  email: string | null;
};

type PickedImage = {
  uri: string;
  name: string;
  mimeType: string;
};

const SCHOOL_TYPES: { label: string; value: SchoolType }[] = [
  { label: "University", value: "university" },
  { label: "Basic Education", value: "basic_ed" },
  { label: "Training Center", value: "training_center" },
];

const AVATAR_COLORS = [
  "#22C55E",
  "#0EA5E9",
  "#F97316",
  "#EF4444",
  "#A855F7",
  "#EAB308",
  "#14B8A6",
  "#64748B",
] as const;

const FILTER_OPTIONS: { label: string; value: InstitutionFilter }[] = [
  { label: "All", value: "all" },
  { label: "Default", value: "primary" },
  { label: "University", value: "university" },
  { label: "Basic Education", value: "basic_ed" },
  { label: "Training Center", value: "training_center" },
];

function createUuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

function guessMimeType(name: string, fallback?: string | null) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return fallback || "image/jpeg";
}

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

async function readUriAsArrayBuffer(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export default function Profile() {
  const { colors: c } = useAppTheme();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [lessonPlanCount, setLessonPlanCount] = useState(0);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<InstitutionFilter>("all");
  const [showFilterModal, setShowFilterModal] = useState(false);

  const [showInstitutionModal, setShowInstitutionModal] = useState(false);
  const [institutionName, setInstitutionName] = useState("");
  const [institutionType, setInstitutionType] = useState<SchoolType>("basic_ed");
  const [avatarColor, setAvatarColor] = useState<string>(AVATAR_COLORS[0]);
  const [pickedAvatar, setPickedAvatar] = useState<PickedImage | null>(null);

  const filteredInstitutions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return institutions.filter((inst) => {
      const typeMatch =
        activeFilter === "all"
          ? true
          : activeFilter === "primary"
            ? inst.is_primary
            : inst.type === activeFilter;
      const queryMatch = query ? inst.name.toLowerCase().includes(query) : true;
      return typeMatch && queryMatch;
    });
  }, [institutions, searchQuery, activeFilter]);

  const gridRows = useMemo(() => {
    const rows: Institution[][] = [];
    for (let i = 0; i < filteredInstitutions.length; i += 2) {
      rows.push(filteredInstitutions.slice(i, i + 2));
    }
    return rows;
  }, [filteredInstitutions]);

  const loadInstitutions = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from("user_schools")
      .select("is_primary, school:schools(school_id, name, type, is_default, avatar_url, avatar_color)")
      .eq("user_id", uid)
      .order("is_primary", { ascending: false });

    if (error) throw error;

    const mapped = (data ?? [])
      .map((row: any) => {
        const schoolRaw = row.school;
        const school = Array.isArray(schoolRaw) ? schoolRaw[0] : schoolRaw;
        if (!school?.school_id || !school?.name || !school?.type) return null;

        return {
          school_id: school.school_id,
          name: school.name,
          type: school.type as SchoolType,
          is_default: Boolean(school.is_default),
          is_primary: Boolean(row.is_primary),
          avatar_url: school.avatar_url ?? null,
          avatar_color: school.avatar_color ?? null,
          avatar_signed_url: null,
        } as Institution;
      })
      .filter((x: Institution | null): x is Institution => Boolean(x));

    const withSignedUrls = await Promise.all(
      mapped.map(async (inst) => {
        if (!inst.avatar_url) return inst;
        const { data: signed, error: signedErr } = await supabase.storage
          .from("uploads")
          .createSignedUrl(inst.avatar_url, 60 * 60);
        if (signedErr || !signed?.signedUrl) return inst;
        return { ...inst, avatar_signed_url: signed.signedUrl };
      })
    );

    setInstitutions(withSignedUrls);
  }, []);

  const loadUserProfile = useCallback(async (uid: string, email: string | null) => {
    const { data, error } = await supabase
      .from("users")
      .select("first_name, last_name, username, email")
      .eq("userid", uid)
      .maybeSingle();

    if (error) throw error;

    const row = data as UserProfile | null;
    setProfile({
      first_name: row?.first_name ?? null,
      last_name: row?.last_name ?? null,
      username: row?.username ?? null,
      email: row?.email ?? email,
    });
  }, []);

  const loadLessonPlanCount = useCallback(async (uid: string) => {
    const { count, error } = await supabase
      .from("lesson_plans")
      .select("lesson_plan_id", { count: "exact", head: true })
      .eq("user_id", uid);

    if (error) throw error;
    setLessonPlanCount(count ?? 0);
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (error) throw error;
        if (!user) throw new Error("No signed-in user found.");

        setUserId(user.id);
        await Promise.all([
          loadInstitutions(user.id),
          loadUserProfile(user.id, user.email ?? null),
          loadLessonPlanCount(user.id),
        ]);
      } catch (err: any) {
        Alert.alert("Unable to load profile", err?.message ?? "Please try again.");
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [loadInstitutions, loadUserProfile, loadLessonPlanCount]);

  const refreshProfile = useCallback(async () => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error) throw error;
    if (!user) throw new Error("No signed-in user found.");

    setUserId(user.id);
    await Promise.all([
      loadInstitutions(user.id),
      loadUserProfile(user.id, user.email ?? null),
      loadLessonPlanCount(user.id),
    ]);
  }, [loadInstitutions, loadLessonPlanCount, loadUserProfile]);

  const { refreshing, onRefresh } = usePullToRefresh(refreshProfile);

  const resetInstitutionForm = () => {
    setInstitutionName("");
    setInstitutionType("basic_ed");
    setAvatarColor(AVATAR_COLORS[0]);
    setPickedAvatar(null);
  };

  const pickAvatarImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to upload an image.");
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });

    if (res.canceled) return;

    const asset = res.assets[0];
    const defaultName = asset.mimeType === "image/png" ? `school_avatar_${Date.now()}.png` : `school_avatar_${Date.now()}.jpg`;
    const fileName = sanitizeFileName(asset.fileName || defaultName);
    const mimeType = guessMimeType(fileName, asset.mimeType);

    setPickedAvatar({ uri: asset.uri, name: fileName, mimeType });
  };

  const handleAddInstitution = async () => {
    const name = institutionName.trim();
    if (!userId) {
      Alert.alert("Session error", "Please sign in again.");
      return;
    }
    if (!name) {
      Alert.alert("Institution name required", "Enter a name to continue.");
      return;
    }

    const schoolId = createUuid();
    setSaving(true);

    try {
      const { error: schoolError } = await supabase.from("schools").insert({
        school_id: schoolId,
        name,
        type: institutionType,
        created_by: userId,
        is_default: false,
        avatar_color: avatarColor,
      });
      if (schoolError) throw schoolError;

      const { error: membershipError } = await supabase.from("user_schools").insert({
        user_id: userId,
        school_id: schoolId,
        is_primary: institutions.length === 0,
      });
      if (membershipError) throw membershipError;

      if (pickedAvatar) {
        try {
          const storagePath = `users/${userId}/schools/${schoolId}_${pickedAvatar.name}`;
          const body = await readUriAsArrayBuffer(pickedAvatar.uri);

          const { error: uploadError } = await supabase.storage.from("uploads").upload(storagePath, body, {
            contentType: pickedAvatar.mimeType,
            upsert: true,
          });
          if (uploadError) throw uploadError;

          const { error: updateError } = await supabase
            .from("schools")
            .update({ avatar_url: storagePath })
            .eq("school_id", schoolId)
            .eq("created_by", userId);
          if (updateError) throw updateError;
        } catch (avatarErr: any) {
          Alert.alert(
            "Institution created",
            `Institution was added, but avatar upload failed: ${avatarErr?.message ?? "Unknown error"}`
          );
        }
      }

      await loadInstitutions(userId);
      setShowInstitutionModal(false);
      resetInstitutionForm();
    } catch (err: any) {
      Alert.alert("Could not add institution", err?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSetPrimary = async (schoolId: string) => {
    if (!userId) return;
    setSaving(true);
    try {
      const { error: clearError } = await supabase
        .from("user_schools")
        .update({ is_primary: false })
        .eq("user_id", userId);
      if (clearError) throw clearError;

      const { error: setError } = await supabase
        .from("user_schools")
        .update({ is_primary: true })
        .eq("user_id", userId)
        .eq("school_id", schoolId);
      if (setError) throw setError;

      const schoolIds = institutions.map((inst) => inst.school_id);
      if (schoolIds.length > 0) {
        const { error: clearDefaultError } = await supabase
          .from("schools")
          .update({ is_default: false })
          .in("school_id", schoolIds);
        if (clearDefaultError) throw clearDefaultError;
      }

      const { error: setDefaultError } = await supabase
        .from("schools")
        .update({ is_default: true })
        .eq("school_id", schoolId);
      if (setDefaultError) throw setDefaultError;

      await loadInstitutions(userId);
    } catch (err: any) {
      Alert.alert("Could not set default institution", err?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleInstitutionLongPress = (inst: Institution) => {
    if (inst.is_primary) {
      Alert.alert("Already default", `${inst.name} is already your default institution.`);
      return;
    }

    Alert.alert(inst.name, "Choose an action", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Make Default",
        onPress: () => {
          void handleSetPrimary(inst.school_id);
        },
      },
    ]);
  };

  const handleSignOut = async () => {
    if (signingOut) return;

    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.replace("/(auth)");
    } catch (err: any) {
      Alert.alert("Sign out failed", err?.message ?? "Please try again.");
    } finally {
      setSigningOut(false);
    }
  };

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Teacher";
  const handleName = profile?.username ? `@${profile.username}` : "@user";
  const profileInitials = getInitials(displayName) || "U";
  const activeFilterLabel = FILTER_OPTIONS.find((x) => x.value === activeFilter)?.label ?? "All";

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}
      >
        <View style={styles.screenTopRow}>
          <Text style={[styles.screenTitle, { color: c.text }]}>Profile</Text>
          <Pressable style={styles.iconBtn} onPress={() => router.push("/settings")}>
            <Ionicons name="settings-outline" size={22} color={c.text} />
          </Pressable>
        </View>

        <View style={[styles.profileCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.profileTopRow}>
            <View style={[styles.profileAvatar, { backgroundColor: c.tint }]}>
              <Text style={styles.profileAvatarText}>{profileInitials}</Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={[styles.profileName, { color: c.text }]} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={[styles.profileHandle, { color: c.mutedText }]}>{handleName}</Text>
              {profile?.email ? (
                <Text style={[styles.profileEmail, { color: c.mutedText }]} numberOfLines={1}>
                  {profile.email}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={[styles.profileStatsRow, { borderTopColor: c.border }]}> 
            <View style={styles.profileStatItem}>
              <Text style={[styles.profileStatValue, { color: c.text }]}>{institutions.length}</Text>
              <Text style={[styles.profileStatLabel, { color: c.mutedText }]}>Institutions</Text>
            </View>
            <View style={styles.profileStatItem}>
              <Text style={[styles.profileStatValue, { color: c.text }]}>{lessonPlanCount}</Text>
              <Text style={[styles.profileStatLabel, { color: c.mutedText }]}>Lesson Plans</Text>
            </View>
          </View>
        </View>

        <View style={styles.topRow}>
          <Text style={[styles.title, { color: c.text }]}>Institutions</Text>
          <View style={styles.iconRow}>
            <Pressable style={styles.iconBtn} onPress={() => setSearchOpen((prev) => !prev)}>
              <Ionicons name="search" size={20} color={c.text} />
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => setShowInstitutionModal(true)}>
              <Ionicons name="add" size={24} color={c.text} />
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => setShowFilterModal(true)}>
              <Ionicons name="options-outline" size={20} color={c.text} />
            </Pressable>
          </View>
        </View>

        {searchOpen ? (
          <View style={[styles.searchWrap, { borderColor: c.border, backgroundColor: c.card }]}>
            <Ionicons name="search" size={16} color={c.mutedText} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search institutions"
              placeholderTextColor={c.mutedText}
              style={[styles.searchInput, { color: c.text }]}
            />
            {searchQuery ? (
              <Pressable onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={16} color={c.mutedText} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Pressable
          onPress={() => setShowFilterModal(true)}
          style={({ pressed }) => [
            styles.filterRow,
            { opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.filterText, { color: c.text }]}>{activeFilterLabel}</Text>
          <Ionicons name="chevron-down" size={12} color={c.text} />
        </Pressable>

        {loading ? (
          <View style={[styles.placeholderCard, { borderColor: c.border, backgroundColor: c.card }]}>
            <ActivityIndicator color={c.tint} />
          </View>
        ) : filteredInstitutions.length === 0 ? (
          <View style={[styles.placeholderCard, { borderColor: c.border, backgroundColor: c.card }]}>
            <Text style={[styles.placeholderText, { color: c.mutedText }]}>No institutions match your filter.</Text>
          </View>
        ) : (
          <View style={styles.gridWrap}>
            {gridRows.map((row, idx) => (
              <View key={`row-${idx}`} style={styles.gridRow}>
                {row.map((inst) => {
                  const avatarUri = inst.avatar_signed_url;
                  const initials = getInitials(inst.name) || "S";
                  const bg = inst.avatar_color || c.tint;

                  return (
                    <Pressable
                      key={inst.school_id}
                      onPress={() =>
                        router.push({ pathname: "/institution", params: { schoolId: inst.school_id } })
                      }
                      onLongPress={() => handleInstitutionLongPress(inst)}
                      style={({ pressed }) => [styles.gridItem, { opacity: pressed ? 0.85 : 1 }]}
                    >
                      <View style={styles.avatarWrap}>
                        {avatarUri ? (
                          <Image source={{ uri: avatarUri }} style={styles.avatarImage} resizeMode="cover" />
                        ) : (
                          <View style={[styles.avatarFallback, { backgroundColor: bg }]}>
                            <Text style={styles.avatarInitials}>{initials}</Text>
                          </View>
                        )}
                        {inst.is_primary ? (
                          <View style={[styles.defaultDot, { backgroundColor: c.tint }]}>
                            <Ionicons name="checkmark" size={11} color="#FFFFFF" />
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.schoolName, { color: c.text }]} numberOfLines={2}>
                        {inst.name}
                      </Text>
                    </Pressable>
                  );
                })}
                {row.length === 1 ? <View style={styles.gridItem} /> : null}
              </View>
            ))}
          </View>
        )}

        <Pressable
          onPress={handleSignOut}
          disabled={signingOut}
          style={({ pressed }) => [
            styles.signOutBtn,
            {
              backgroundColor: signingOut ? `${c.mutedText}66` : c.card,
              borderColor: c.border,
              opacity: pressed ? 0.88 : 1,
            },
          ]}
        >
          <Ionicons name="log-out-outline" size={16} color={c.text} />
          <Text style={[styles.signOutText, { color: c.text }]}>
            {signingOut ? "Signing out..." : "Sign Out"}
          </Text>
        </Pressable>
      </ScrollView>

      <Modal visible={showFilterModal} transparent animationType="fade" onRequestClose={() => setShowFilterModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowFilterModal(false)}>
          <Pressable
            onPress={() => {}}
            style={[styles.filterModalCard, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <Text style={[styles.modalTitle, { color: c.text }]}>Filter Institutions</Text>
            <View style={styles.filterOptionWrap}>
              {FILTER_OPTIONS.map((opt) => {
                const selected = opt.value === activeFilter;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      setActiveFilter(opt.value);
                      setShowFilterModal(false);
                    }}
                    style={[
                      styles.filterOption,
                      {
                        borderColor: selected ? c.tint : c.border,
                        backgroundColor: selected ? `${c.tint}22` : c.card,
                      },
                    ]}
                  >
                    <Text style={{ color: selected ? c.tint : c.text, fontWeight: "600", fontSize: 13 }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showInstitutionModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowInstitutionModal(false);
          resetInstitutionForm();
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]}> 
            <Text style={[styles.modalTitle, { color: c.text }]}>Add Institution</Text>

            <TextInput
              value={institutionName}
              onChangeText={setInstitutionName}
              placeholder="Institution name"
              placeholderTextColor={c.mutedText}
              style={[
                styles.input,
                { color: c.text, borderColor: c.border, backgroundColor: c.background },
              ]}
            />

            <Text style={[styles.inputLabel, { color: c.mutedText }]}>Institution Type</Text>
            <View style={styles.inlineOptionWrap}>
              {SCHOOL_TYPES.map((opt) => {
                const selected = opt.value === institutionType;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setInstitutionType(opt.value)}
                    style={[
                      styles.inlineOption,
                      {
                        borderColor: selected ? c.tint : c.border,
                        backgroundColor: selected ? `${c.tint}22` : c.card,
                      },
                    ]}
                  >
                    <Text style={[styles.inlineOptionText, { color: selected ? c.tint : c.text }]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.inputLabel, { color: c.mutedText }]}>Color</Text>
            <View style={styles.colorRow}>
              {AVATAR_COLORS.map((color) => (
                <Pressable
                  key={color}
                  onPress={() => setAvatarColor(color)}
                  style={[
                    styles.colorDot,
                    { backgroundColor: color, borderColor: avatarColor === color ? c.text : c.border },
                  ]}
                >
                  {avatarColor === color ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : null}
                </Pressable>
              ))}
            </View>

            <Text style={[styles.inputLabel, { color: c.mutedText }]}>Image</Text>
            <Pressable
              onPress={pickAvatarImage}
              style={({ pressed }) => [
                styles.uploadBtn,
                { borderColor: c.border, backgroundColor: c.background, opacity: pressed ? 0.9 : 1 },
              ]}
            >
              <Ionicons name="image-outline" size={16} color={c.text} />
              <Text style={[styles.uploadText, { color: c.text }]}>
                {pickedAvatar ? pickedAvatar.name : "Upload image"}
              </Text>
            </Pressable>

            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setShowInstitutionModal(false);
                  resetInstitutionForm();
                }}
                style={[styles.modalBtn, { borderColor: c.border }]}
              >
                <Text style={[styles.modalBtnText, { color: c.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleAddInstitution}
                disabled={saving}
                style={[styles.modalBtnPrimary, { backgroundColor: c.tint }]}
              >
                <Text style={styles.modalBtnPrimaryText}>{saving ? "Saving..." : "Save"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 28 },
  screenTopRow: {
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  screenTitle: { fontSize: 24, fontWeight: "800", letterSpacing: -0.3 },

  profileCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
    marginBottom: 14,
    overflow: "hidden",
  },
  profileTopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  profileAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarText: { color: "#FFFFFF", fontSize: 24, fontWeight: "800" },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 20, fontWeight: "800" },
  profileHandle: { fontSize: 13, marginTop: 1 },
  profileEmail: { fontSize: 12, marginTop: 2 },
  profileStatsRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  profileStatItem: { minWidth: 76 },
  profileStatValue: { fontSize: 16, fontWeight: "800" },
  profileStatLabel: { fontSize: 11, marginTop: 2 },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 31, fontWeight: "800", letterSpacing: -0.4 },
  iconRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },

  searchWrap: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },

  filterRow: {
    marginTop: 12,
    marginBottom: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    alignSelf: "flex-start",
    paddingHorizontal: 2,
  },
  filterText: { fontSize: 15, fontWeight: "500" },

  gridWrap: { gap: 22 },
  gridRow: { flexDirection: "row", gap: 14 },
  gridItem: { flex: 1, alignItems: "center" },
  avatarWrap: {
    width: 126,
    height: 126,
    borderRadius: 63,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatarImage: {
    width: 126,
    height: 126,
    borderRadius: 63,
  },
  avatarFallback: {
    width: 126,
    height: 126,
    borderRadius: 63,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: { color: "#FFFFFF", fontSize: 34, fontWeight: "800" },
  defaultDot: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  schoolName: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 18,
    textAlign: "center",
    maxWidth: 150,
  },

  placeholderCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  placeholderText: { fontSize: 13, textAlign: "center" },
  signOutBtn: {
    marginTop: 24,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  signOutText: { fontSize: 14, fontWeight: "700" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 18,
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  filterModalCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  modalTitle: { fontSize: 17, fontWeight: "700" },
  filterOptionWrap: { gap: 8 },
  filterOption: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },

  inputLabel: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  inlineOptionWrap: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  inlineOption: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  inlineOptionText: { fontSize: 12, fontWeight: "600" },

  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  colorDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  uploadText: { flex: 1, fontSize: 13, fontWeight: "500" },

  modalActions: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  modalBtn: {
    borderWidth: 1,
    borderRadius: 10,
    minWidth: 86,
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  modalBtnText: { fontSize: 14, fontWeight: "600" },
  modalBtnPrimary: {
    borderRadius: 10,
    minWidth: 86,
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  modalBtnPrimaryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
});
