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
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Swipeable } from "react-native-gesture-handler";
import { useAppTheme } from "../../context/theme";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";
import { supabase } from "../../lib/supabase";

type SchoolType = "university" | "basic_ed" | "training_center";

type Institution = {
  school_id: string;
  name: string;
  type: SchoolType;
  avatar_url: string | null;
  avatar_signed_url: string | null;
  avatar_color: string;
  is_default: boolean;
  is_primary: boolean;
};

type SectionItem = {
  section_id: string;
  name: string;
  grade_level: string | null;
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

const SCHOOL_TYPE_LABEL: Record<SchoolType, string> = {
  university: "University",
  basic_ed: "Basic Education",
  training_center: "Training Center",
};

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

async function readUriAsArrayBuffer(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export default function InstitutionScreen() {
  const { schoolId } = useLocalSearchParams<{ schoolId?: string | string[] }>();
  const schoolIdValue = useMemo(
    () => (Array.isArray(schoolId) ? schoolId[0] : schoolId) ?? "",
    [schoolId]
  );

  const { colors: c } = useAppTheme();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState(false);
  const [savingInstitution, setSavingInstitution] = useState(false);
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [sections, setSections] = useState<SectionItem[]>([]);

  const [showSectionModal, setShowSectionModal] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [sectionGradeLevel, setSectionGradeLevel] = useState("");
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editSectionName, setEditSectionName] = useState("");
  const [editSectionGradeLevel, setEditSectionGradeLevel] = useState("");
  const [deletingSectionId, setDeletingSectionId] = useState<string | null>(null);
  const [showInstitutionModal, setShowInstitutionModal] = useState(false);
  const [institutionName, setInstitutionName] = useState("");
  const [institutionType, setInstitutionType] = useState<SchoolType>("basic_ed");
  const [institutionAvatarColor, setInstitutionAvatarColor] = useState<string>(AVATAR_COLORS[0]);
  const [pickedAvatar, setPickedAvatar] = useState<PickedImage | null>(null);

  const institutionInitials = useMemo(() => {
    const parts = institution?.name?.trim().split(/\s+/).filter(Boolean) ?? [];
    if (parts.length === 0) return "";
    return parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("");
  }, [institution?.name]);

  const loadInstitution = useCallback(async (uid: string, sid: string) => {
    const { data, error } = await supabase
      .from("user_schools")
      .select("is_primary, school:schools(school_id, name, type, avatar_url, avatar_color, is_default)")
      .eq("user_id", uid)
      .eq("school_id", sid)
      .maybeSingle();

    if (error) throw error;

    const schoolRaw = (data as any)?.school;
    const school = Array.isArray(schoolRaw) ? schoolRaw[0] : schoolRaw;
    if (!school) {
      setInstitution(null);
      return;
    }

    let avatarSignedUrl: string | null = null;
    if (school.avatar_url) {
      const { data: signed, error: signedErr } = await supabase.storage
        .from("uploads")
        .createSignedUrl(school.avatar_url, 60 * 60);
      if (!signedErr && signed?.signedUrl) {
        avatarSignedUrl = signed.signedUrl;
      }
    }

    setInstitution({
      school_id: school.school_id,
      name: school.name,
      type: school.type as SchoolType,
      avatar_url: school.avatar_url ?? null,
      avatar_signed_url: avatarSignedUrl,
      avatar_color: school.avatar_color ?? "#22C55E",
      is_default: Boolean(school.is_default),
      is_primary: Boolean(data?.is_primary),
    });
  }, []);

  const loadSections = useCallback(async (sid: string) => {
    const { data, error } = await supabase
      .from("sections")
      .select("section_id, name, grade_level")
      .eq("school_id", sid)
      .order("name", { ascending: true });

    if (error) throw error;
    setSections((data ?? []) as SectionItem[]);
  }, []);

  useEffect(() => {
    const init = async () => {
      if (!schoolIdValue) {
        Alert.alert("Invalid school", "Missing school identifier.");
        router.back();
        return;
      }

      setLoading(true);
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();
        if (error) throw error;
        if (!user) throw new Error("No signed-in user found.");

        setUserId(user.id);
        await Promise.all([loadInstitution(user.id, schoolIdValue), loadSections(schoolIdValue)]);
      } catch (err: any) {
        Alert.alert("Could not load institution", err?.message ?? "Please try again.");
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [schoolIdValue, loadInstitution, loadSections]);

  const refreshInstitution = useCallback(async () => {
    if (!schoolIdValue) return;
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error) throw error;
    if (!user) throw new Error("No signed-in user found.");

    setUserId(user.id);
    await Promise.all([loadInstitution(user.id, schoolIdValue), loadSections(schoolIdValue)]);
  }, [loadInstitution, loadSections, schoolIdValue]);

  const { refreshing, onRefresh } = usePullToRefresh(refreshInstitution);

  const resetSectionForm = () => {
    setSectionName("");
    setSectionGradeLevel("");
  };

  const openInstitutionEditModal = () => {
    if (!institution) return;
    setInstitutionName(institution.name);
    setInstitutionType(institution.type);
    setInstitutionAvatarColor(institution.avatar_color || "#22C55E");
    setPickedAvatar(null);
    setShowInstitutionModal(true);
  };

  const resetInstitutionForm = () => {
    setInstitutionName("");
    setInstitutionType("basic_ed");
    setInstitutionAvatarColor(AVATAR_COLORS[0]);
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

  const handleAddSection = async () => {
    const name = sectionName.trim();
    if (!schoolIdValue || !name) {
      Alert.alert("Missing data", "Section name is required.");
      return;
    }

    setSavingSection(true);
    try {
      const { error } = await supabase.from("sections").insert({
        school_id: schoolIdValue,
        name,
        grade_level: sectionGradeLevel.trim() || null,
      });
      if (error) throw error;

      await loadSections(schoolIdValue);
      setShowSectionModal(false);
      resetSectionForm();
    } catch (err: any) {
      Alert.alert("Could not add section", err?.message ?? "Please try again.");
    } finally {
      setSavingSection(false);
    }
  };

  const openSectionEditor = (section: SectionItem) => {
    if (editingSectionId === section.section_id) {
      setEditingSectionId(null);
      setEditSectionName("");
      setEditSectionGradeLevel("");
      return;
    }
    setEditingSectionId(section.section_id);
    setEditSectionName(section.name);
    setEditSectionGradeLevel(section.grade_level ?? "");
  };

  const handleSaveSectionEdit = async (sectionId: string) => {
    const name = editSectionName.trim();
    if (!schoolIdValue || !name) {
      Alert.alert("Missing data", "Section name is required.");
      return;
    }

    setSavingSection(true);
    try {
      const { error } = await supabase
        .from("sections")
        .update({
          name,
          grade_level: editSectionGradeLevel.trim() || null,
        })
        .eq("school_id", schoolIdValue)
        .eq("section_id", sectionId);
      if (error) throw error;

      await loadSections(schoolIdValue);
      setEditingSectionId(null);
      setEditSectionName("");
      setEditSectionGradeLevel("");
    } catch (err: any) {
      Alert.alert("Could not update section", err?.message ?? "Please try again.");
    } finally {
      setSavingSection(false);
    }
  };

  const handleDeleteSection = async (section: SectionItem) => {
    if (!schoolIdValue || deletingSectionId) return;

    Alert.alert("Delete section?", `Delete "${section.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeletingSectionId(section.section_id);
          try {
            const { error } = await supabase
              .from("sections")
              .delete()
              .eq("school_id", schoolIdValue)
              .eq("section_id", section.section_id);
            if (error) throw error;

            if (editingSectionId === section.section_id) {
              setEditingSectionId(null);
              setEditSectionName("");
              setEditSectionGradeLevel("");
            }
            await loadSections(schoolIdValue);
          } catch (err: any) {
            Alert.alert("Could not delete section", err?.message ?? "Please try again.");
          } finally {
            setDeletingSectionId(null);
          }
        },
      },
    ]);
  };

  const handleDeleteInstitution = async () => {
    if (!userId || !schoolIdValue) return;

    Alert.alert("Delete institution?", "This action cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setSavingInstitution(true);
          try {
            const { error: sectionError } = await supabase
              .from("sections")
              .delete()
              .eq("school_id", schoolIdValue);
            if (sectionError) throw sectionError;

            const { error: membershipError } = await supabase
              .from("user_schools")
              .delete()
              .eq("school_id", schoolIdValue);
            if (membershipError) throw membershipError;

            const { error: schoolError } = await supabase
              .from("schools")
              .delete()
              .eq("school_id", schoolIdValue);
            if (schoolError) throw schoolError;

            router.replace("/profile");
          } catch (err: any) {
            Alert.alert("Could not delete institution", err?.message ?? "Please try again.");
          } finally {
            setSavingInstitution(false);
          }
        },
      },
    ]);
  };

  const handleSaveInstitution = async () => {
    const name = institutionName.trim();
    if (!schoolIdValue || !userId) {
      Alert.alert("Session error", "Please sign in again.");
      return;
    }
    if (!name) {
      Alert.alert("Institution name required", "Enter a name to continue.");
      return;
    }

    setSavingInstitution(true);
    try {
      const { error } = await supabase
        .from("schools")
        .update({
          name,
          type: institutionType,
          avatar_color: institutionAvatarColor || "#22C55E",
        })
        .eq("school_id", schoolIdValue);
      if (error) throw error;

      if (pickedAvatar) {
        const storagePath = `users/${userId}/schools/${schoolIdValue}_${pickedAvatar.name}`;
        const body = await readUriAsArrayBuffer(pickedAvatar.uri);

        const { error: uploadError } = await supabase.storage.from("uploads").upload(storagePath, body, {
          contentType: pickedAvatar.mimeType,
          upsert: true,
        });
        if (uploadError) throw uploadError;

        const { error: avatarUpdateError } = await supabase
          .from("schools")
          .update({ avatar_url: storagePath })
          .eq("school_id", schoolIdValue);
        if (avatarUpdateError) throw avatarUpdateError;
      }

      await loadInstitution(userId, schoolIdValue);
      setShowInstitutionModal(false);
      resetInstitutionForm();
    } catch (err: any) {
      Alert.alert("Could not update institution", err?.message ?? "Please try again.");
    } finally {
      setSavingInstitution(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.tint} />
      </View>
    );
  }

  if (!institution) {
    return (
      <View style={[styles.center, { backgroundColor: c.background, padding: 20 }]}>
        <Text style={{ color: c.mutedText, textAlign: "center" }}>
          Institution not found or inaccessible.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.tint} />}
      >
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.cardTopActions}>
            <Pressable
              onPress={openInstitutionEditModal}
              disabled={savingInstitution}
              style={({ pressed }) => [
                styles.topIconBtn,
                { borderColor: c.border, backgroundColor: c.card, opacity: pressed ? 0.9 : 1 },
              ]}
            >
              <Ionicons name="create-outline" size={16} color={c.text} />
            </Pressable>
            <Pressable
              onPress={handleDeleteInstitution}
              disabled={savingInstitution}
              style={({ pressed }) => [
                styles.topIconBtn,
                { borderColor: c.border, backgroundColor: c.card, opacity: pressed ? 0.9 : 1 },
              ]}
            >
              <Ionicons name="trash-outline" size={16} color={c.text} />
            </Pressable>
          </View>
          <View style={styles.avatarHeader}>
            <View
              style={[
                styles.avatarWrap,
                {
                  backgroundColor: institution.avatar_signed_url ? "transparent" : institution.avatar_color || "#22C55E",
                  borderColor: c.border,
                },
              ]}
            >
              {institution.avatar_signed_url ? (
                <Image source={{ uri: institution.avatar_signed_url }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarInitials}>{institutionInitials}</Text>
              )}
            </View>
          </View>
          <Text style={[styles.schoolName, { color: c.text }]}>{institution.name}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.pill, { borderColor: c.border }]}>
              <Text style={[styles.pillText, { color: c.mutedText }]}>
                {SCHOOL_TYPE_LABEL[institution.type]}
              </Text>
            </View>
            {institution.is_primary ? (
              <View style={[styles.pill, { borderColor: c.tint }]}>
                <Text style={[styles.pillText, { color: c.tint }]}>Default</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.headerRow}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Sections</Text>
          <Pressable
            onPress={() => setShowSectionModal(true)}
            style={({ pressed }) => [
              styles.ctaBtn,
              { backgroundColor: c.tint, opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Text style={styles.ctaBtnText}>Add Section</Text>
          </Pressable>
        </View>

        {sections.length === 0 ? (
          <View style={[styles.emptyCard, { borderColor: c.border, backgroundColor: c.card }]}>
            <Text style={{ color: c.mutedText }}>No sections yet for this institution.</Text>
          </View>
        ) : (
          sections.map((section) => (
            <Swipeable
              key={section.section_id}
              overshootRight={false}
              renderRightActions={() => (
                <View style={styles.swipeActionsWrap}>
                  <Pressable
                    onPress={() => handleDeleteSection(section)}
                    disabled={Boolean(deletingSectionId)}
                    style={({ pressed }) => [
                      styles.swipeActionBtn,
                      {
                        borderColor: c.border,
                        backgroundColor: c.card,
                        opacity: deletingSectionId ? 0.6 : pressed ? 0.9 : 1,
                      },
                    ]}
                  >
                    <Ionicons name="trash-outline" size={16} color={c.text} />
                  </Pressable>
                </View>
              )}
            >
              <View
                style={[
                  styles.sectionCard,
                  {
                    borderColor: c.border,
                    backgroundColor: c.card,
                  },
                ]}
              >
                <View style={styles.sectionTopRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sectionName, { color: c.text }]}>{section.name}</Text>
                    <Text style={[styles.sectionSub, { color: c.mutedText }]}>
                      {section.grade_level ? `Year Level: ${section.grade_level}` : "Year Level: Not set"}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => openSectionEditor(section)}
                    style={({ pressed }) => [
                      styles.topIconBtn,
                      { borderColor: c.border, backgroundColor: c.card, opacity: pressed ? 0.9 : 1 },
                    ]}
                  >
                    <Ionicons name="create-outline" size={16} color={c.text} />
                  </Pressable>
                </View>
                {editingSectionId === section.section_id ? (
                  <View style={[styles.sectionEditor, { borderTopColor: c.border }]}>
                    <View style={styles.sectionEditorRow}>
                      <Text style={[styles.sectionEditorLabel, { color: c.mutedText }]}>Year Level:</Text>
                      <TextInput
                        value={editSectionGradeLevel}
                        onChangeText={setEditSectionGradeLevel}
                        placeholder="Not set"
                        placeholderTextColor={c.mutedText}
                        style={[
                          styles.sectionEditorInput,
                          { color: c.text, borderColor: c.border, backgroundColor: c.background },
                        ]}
                      />
                    </View>
                    <View style={styles.sectionEditorRow}>
                      <Text style={[styles.sectionEditorLabel, { color: c.mutedText }]}>Section Name:</Text>
                      <TextInput
                        value={editSectionName}
                        onChangeText={setEditSectionName}
                        placeholder="Section name"
                        placeholderTextColor={c.mutedText}
                        style={[
                          styles.sectionEditorInput,
                          { color: c.text, borderColor: c.border, backgroundColor: c.background },
                        ]}
                      />
                    </View>
                    <View style={styles.sectionEditorActions}>
                      <Pressable
                        onPress={() => handleSaveSectionEdit(section.section_id)}
                        disabled={savingSection}
                        style={({ pressed }) => [
                          styles.miniActionBtn,
                          { borderColor: c.border, opacity: savingSection ? 0.6 : pressed ? 0.9 : 1 },
                        ]}
                      >
                        <Ionicons name={savingSection ? "time-outline" : "checkmark"} size={16} color={c.text} />
                      </Pressable>
                      <Pressable
                        onPress={() => setEditingSectionId(null)}
                        style={({ pressed }) => [
                          styles.miniActionBtn,
                          { borderColor: c.border, opacity: pressed ? 0.9 : 1 },
                        ]}
                      >
                        <Ionicons name="close" size={16} color={c.text} />
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            </Swipeable>
          ))
        )}
      </ScrollView>

      <Modal
        visible={showSectionModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowSectionModal(false);
          resetSectionForm();
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.modalTitle, { color: c.text }]}>Add Section</Text>
            <TextInput
              value={sectionName}
              onChangeText={setSectionName}
              placeholder="Section name"
              placeholderTextColor={c.mutedText}
              style={[
                styles.input,
                { color: c.text, borderColor: c.border, backgroundColor: c.background },
              ]}
            />
            <TextInput
              value={sectionGradeLevel}
              onChangeText={setSectionGradeLevel}
              placeholder="Year level"
              placeholderTextColor={c.mutedText}
              style={[
                styles.input,
                { color: c.text, borderColor: c.border, backgroundColor: c.background },
              ]}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setShowSectionModal(false);
                  resetSectionForm();
                }}
                style={[styles.modalBtn, { borderColor: c.border }]}
              >
                <Text style={{ color: c.text, fontWeight: "600" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleAddSection}
                disabled={savingSection}
                style={[styles.modalBtnPrimary, { backgroundColor: c.tint }]}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>
                  {savingSection ? "Saving..." : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
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
            <Text style={[styles.modalTitle, { color: c.text }]}>Edit Institution</Text>
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
                  onPress={() => setInstitutionAvatarColor(color)}
                  style={[
                    styles.colorDot,
                    { backgroundColor: color, borderColor: institutionAvatarColor === color ? c.text : c.border },
                  ]}
                >
                  {institutionAvatarColor === color ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : null}
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
                <Text style={{ color: c.text, fontWeight: "600" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveInstitution}
                disabled={savingInstitution}
                style={[styles.modalBtnPrimary, { backgroundColor: c.tint }]}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>
                  {savingInstitution ? "Saving..." : "Save"}
                </Text>
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, gap: 12, paddingBottom: 28 },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    alignItems: "center",
    position: "relative",
  },
  cardTopActions: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 2,
    flexDirection: "row",
    gap: 8,
  },
  topIconBtn: {
    borderWidth: 1,
    borderRadius: 16,
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarHeader: { width: "100%", alignItems: "center", justifyContent: "center" },
  avatarWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarInitials: { color: "#FFFFFF", fontSize: 24, fontWeight: "700" },
  schoolName: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  metaRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  pillText: { fontSize: 12, fontWeight: "600" },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sectionTitle: { fontSize: 18, fontWeight: "700" },
  ctaBtn: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  ctaBtnText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },

  emptyCard: { borderWidth: 1, borderRadius: 14, padding: 14, alignItems: "center" },

  sectionCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 8,
  },
  sectionTopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionName: { fontSize: 15, fontWeight: "700" },
  sectionSub: { marginTop: 2, fontSize: 12 },
  swipeActionsWrap: { justifyContent: "center", alignItems: "flex-end", paddingLeft: 8 },
  swipeActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionEditor: { borderTopWidth: 1, paddingTop: 8, gap: 7 },
  sectionEditorRow: { gap: 6 },
  sectionEditorLabel: { fontSize: 11, fontWeight: "600" },
  sectionEditorInput: {
    borderWidth: 1,
    borderRadius: 8,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sectionEditorActions: { marginTop: 1, flexDirection: "row", justifyContent: "flex-end", gap: 6 },
  miniActionBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

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
  modalTitle: { fontSize: 17, fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  inputLabel: { fontSize: 12, fontWeight: "600", marginTop: 2 },
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
  modalBtnPrimary: {
    borderRadius: 10,
    minWidth: 86,
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
});
