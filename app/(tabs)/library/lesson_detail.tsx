import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { Radius, Spacing, Typography } from "../../../constants/fonts";
import { useAppTheme } from "../../../context/theme";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import {
  extractLessonContent,
  normalizeToHtml,
  readParam,
  tiptapDocumentHtml,
  type LessonDetailRecord,
  type WebMessage,
} from "../../../lib/lesson-editor";
import { supabase } from "../../../lib/supabase";

function parseWebHeight(event: WebViewMessageEvent) {
  try {
    const data = JSON.parse(event.nativeEvent.data) as WebMessage;
    if (data.type !== "height") return null;
    const nextHeight = Number(data.height);
    return Number.isFinite(nextHeight) ? Math.max(560, Math.ceil(nextHeight)) : null;
  } catch {
    return null;
  }
}

export default function LessonDetailScreen() {
  const { colors: c, scheme } = useAppTheme();
  const params = useLocalSearchParams<{ lessonId?: string | string[]; subjectId?: string | string[] }>();
  const lessonId = useMemo(() => readParam(params.lessonId), [params.lessonId]);
  const subjectIdParam = useMemo(() => readParam(params.subjectId), [params.subjectId]);

  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [lesson, setLesson] = useState<LessonDetailRecord | null>(null);
  const [contentHtml, setContentHtml] = useState("<p></p>");
  const [previewHeight, setPreviewHeight] = useState(560);

  const loadLesson = useCallback(async () => {
    if (!lessonId) {
      setLesson(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("lessons")
        .select("lesson_id, title, sequence_no, content, chapter:chapters(title, subject_id)")
        .eq("lesson_id", lessonId)
        .maybeSingle();
      if (error) throw error;

      const chapterRaw = data?.chapter;
      const chapter = Array.isArray(chapterRaw) ? chapterRaw[0] : chapterRaw;

      if (!data?.lesson_id) {
        setLesson(null);
        setContentHtml("<p></p>");
        return;
      }

      const nextLesson: LessonDetailRecord = {
        lesson_id: String(data.lesson_id),
        title: String(data.title ?? "Untitled Lesson"),
        sequence_no: Number(data.sequence_no ?? 0),
        content: data?.content ? String(data.content) : null,
        chapter_title: chapter?.title ? String(chapter.title) : null,
        subject_id: chapter?.subject_id ? String(chapter.subject_id) : null,
      };

      setLesson(nextLesson);
      setContentHtml(normalizeToHtml(extractLessonContent(nextLesson.content)));
      setPreviewHeight(560);
      setShowMenu(false);
    } catch {
      setLesson(null);
      setContentHtml("<p></p>");
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    loadLesson();
  }, [loadLesson]);

  const { refreshing, onRefresh } = usePullToRefresh(loadLesson);
  const pageBg = useMemo(() => (scheme === "dark" ? c.background : "#F5F6F7"), [c.background, scheme]);
  const shellBg = useMemo(() => (scheme === "dark" ? "#0E1218" : "#FFFFFF"), [scheme]);
  const resolvedSubjectId = (lesson?.subject_id ?? subjectIdParam) || "";
  const previewSource = useMemo(
    () => ({ html: tiptapDocumentHtml({ editable: false, initialHtml: contentHtml }) }),
    [contentHtml]
  );

  const goBack = () => {
    if (resolvedSubjectId) {
      router.replace({
        pathname: "/library/subject_detail",
        params: { subjectId: resolvedSubjectId },
      });
      return;
    }
    router.back();
  };

  const goToEditor = () => {
    if (!lesson) return;
    setShowMenu(false);
    router.push({
      pathname: "/library/lesson_editor",
      params: { lessonId: lesson.lesson_id, subjectId: resolvedSubjectId || undefined },
    });
  };

  const confirmDeleteLesson = () => {
    if (!lesson || deleting) return;
    setShowMenu(false);

    Alert.alert("Delete lesson?", "This lesson will be permanently removed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            const { error } = await supabase.from("lessons").delete().eq("lesson_id", lesson.lesson_id);
            if (error) throw error;
            goBack();
          } catch (err: any) {
            Alert.alert("Could not delete lesson", err?.message ?? "Please try again.");
            setDeleting(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: pageBg }]}>
        <ActivityIndicator color={c.text} />
      </View>
    );
  }

  if (!lesson) {
    return (
      <View style={[styles.center, { backgroundColor: pageBg }]}>
        <Pressable style={styles.backBtn} onPress={goBack}>
          <Ionicons name="caret-back" size={16} color={c.text} />
          <Text style={[styles.backText, { color: c.text }]}>Back</Text>
        </Pressable>
        <Text style={[styles.emptyText, { color: c.text }]}>Lesson not found.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.page, { backgroundColor: pageBg }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.text} />}
      >
        <View style={[styles.header, { backgroundColor: shellBg, borderBottomColor: c.border }]}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Pressable onPress={goBack} style={styles.iconTap}>
                <Ionicons name="caret-back" size={14} color={c.text} />
              </Pressable>
              <Text numberOfLines={1} style={[styles.headerTitle, { color: c.text }]}>
                Lesson {lesson.sequence_no}: {lesson.title}
              </Text>
            </View>

            <View style={styles.menuWrap}>
              <Pressable style={styles.iconTap} onPress={() => setShowMenu((current) => !current)} disabled={deleting}>
                {deleting ? <ActivityIndicator size="small" color={c.text} /> : <Ionicons name="ellipsis-horizontal" size={18} color={c.text} />}
              </Pressable>
              {showMenu ? (
                <View style={[styles.dropdown, { backgroundColor: shellBg, borderColor: c.border }]}>
                  <Pressable style={styles.dropdownItem} onPress={goToEditor}>
                    <Text style={[styles.dropdownText, { color: c.text }]}>Edit</Text>
                  </Pressable>
                  <Pressable style={styles.dropdownItem} onPress={confirmDeleteLesson}>
                    <Text style={[styles.dropdownText, { color: "#D64545" }]}>Delete</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={[styles.editorShell, { backgroundColor: shellBg, borderColor: c.border, height: previewHeight }]}>
          <WebView
            originWhitelist={["*"]}
            source={previewSource}
            key={`lesson-preview-${lesson.lesson_id}-${contentHtml.length}`}
            onMessage={(event) => {
              const nextHeight = parseWebHeight(event);
              if (nextHeight) setPreviewHeight(nextHeight);
            }}
            scrollEnabled={false}
            javaScriptEnabled
            automaticallyAdjustContentInsets={false}
            style={styles.webview}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    paddingBottom: Spacing.xxxl,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  header: {
    borderBottomWidth: 1,
  },
  headerRow: {
    minHeight: 52,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  iconTap: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    ...Typography.h3,
    flex: 1,
    fontWeight: "700",
  },
  menuWrap: {
    position: "relative",
  },
  dropdown: {
    position: "absolute",
    top: 28,
    right: 0,
    minWidth: 132,
    borderWidth: 1,
    borderRadius: Radius.md,
    overflow: "hidden",
    zIndex: 5,
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownText: {
    ...Typography.body,
    fontWeight: "600",
  },
  editorShell: {
    minHeight: 560,
    marginHorizontal: 12,
    borderWidth: 1,
    borderBottomLeftRadius: Radius.lg,
    borderBottomRightRadius: Radius.lg,
    overflow: "hidden",
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  backText: {
    ...Typography.body,
    fontWeight: "600",
  },
  emptyText: {
    ...Typography.h3,
    textAlign: "center",
  },
});
