import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { Radius, Spacing, Typography } from "../../../constants/fonts";
import { useAppTheme } from "../../../context/theme";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import {
  extractLessonContent,
  normalizeToHtml,
  type ParagraphAlignment,
  readParam,
  tiptapDocumentHtml,
  type EditorCommand,
  type LessonDetailRecord,
  type WebMessage,
} from "../../../lib/lesson-editor";
import { supabase } from "../../../lib/supabase";

function parseWebMessage(event: WebViewMessageEvent) {
  try {
    return JSON.parse(event.nativeEvent.data) as WebMessage;
  } catch {
    return null;
  }
}

type ToolbarState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  bullet: boolean;
  link: boolean;
  code: boolean;
  align: ParagraphAlignment;
};

const DEFAULT_TOOLBAR_STATE: ToolbarState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  bullet: false,
  link: false,
  code: false,
  align: "left",
};

export default function LessonEditorScreen() {
  const { colors: c, scheme } = useAppTheme();
  const params = useLocalSearchParams<{ lessonId?: string | string[]; subjectId?: string | string[] }>();
  const lessonId = useMemo(() => readParam(params.lessonId), [params.lessonId]);
  const subjectIdParam = useMemo(() => readParam(params.subjectId), [params.subjectId]);
  const editorRef = useRef<WebView>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lesson, setLesson] = useState<LessonDetailRecord | null>(null);
  const [contentHtml, setContentHtml] = useState("<p></p>");
  const [draftHtml, setDraftHtml] = useState("<p></p>");
  const [loadedEditorHtml, setLoadedEditorHtml] = useState("<p></p>");
  const [editorHeight, setEditorHeight] = useState(560);
  const [showLinkEditor, setShowLinkEditor] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [toolbarState, setToolbarState] = useState<ToolbarState>(DEFAULT_TOOLBAR_STATE);

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
        setDraftHtml("<p></p>");
        setLoadedEditorHtml("<p></p>");
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
      const nextHtml = normalizeToHtml(extractLessonContent(nextLesson.content));

      setLesson(nextLesson);
      setContentHtml(nextHtml);
      setDraftHtml(nextHtml);
      setLoadedEditorHtml(nextHtml);
      setEditorHeight(560);
      setShowLinkEditor(false);
      setLinkUrl("");
      setToolbarState(DEFAULT_TOOLBAR_STATE);
    } catch {
      setLesson(null);
      setContentHtml("<p></p>");
      setDraftHtml("<p></p>");
      setLoadedEditorHtml("<p></p>");
      setToolbarState(DEFAULT_TOOLBAR_STATE);
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    loadLesson();
  }, [loadLesson]);

  const { refreshing, onRefresh } = usePullToRefresh(loadLesson);
  const shellBg = useMemo(() => (scheme === "dark" ? "#0E1218" : "#FFFFFF"), [scheme]);
  const editorBg = useMemo(() => (scheme === "dark" ? "#11161D" : "#FFFFFF"), [scheme]);
  const pageBg = useMemo(() => (scheme === "dark" ? c.background : "#F5F6F7"), [c.background, scheme]);
  const resolvedSubjectId = (lesson?.subject_id ?? subjectIdParam) || "";
  const editorSource = useMemo(
    () => ({ html: tiptapDocumentHtml({ editable: true, initialHtml: loadedEditorHtml }) }),
    [loadedEditorHtml]
  );

  const sendCommand = (command: EditorCommand) => {
    const webView = editorRef.current;
    if (!webView) return;
    const payload = JSON.stringify(command).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    webView.injectJavaScript(`window.__lessonEditor && window.__lessonEditor.dispatch(JSON.parse('${payload}')); true;`);
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    const data = parseWebMessage(event);
    if (!data) return;

    if (data.type === "content") {
      setDraftHtml(data.html || "<p></p>");
      return;
    }

    if (data.type === "height") {
      const nextHeight = Number(data.height);
      if (Number.isFinite(nextHeight)) {
        setEditorHeight(Math.max(560, Math.ceil(nextHeight)));
      }
      return;
    }

    if (data.type === "state") {
      setToolbarState(data.state);
    }
  };

  const activeBg = scheme === "dark" ? "#1F2A37" : "#E8EEF9";
  const activeAccent = scheme === "dark" ? "#8FB4FF" : "#1D4ED8";
  const resolveToolButtonStyle = (active: boolean) => [styles.toolBtn, active ? { backgroundColor: activeBg } : null];
  const resolveToolTextColor = (active: boolean) => (active ? activeAccent : c.text);

  const goBack = () => {
    if (resolvedSubjectId) {
      router.replace({
        pathname: "/library/lesson_detail",
        params: { lessonId, subjectId: resolvedSubjectId },
      });
      return;
    }
    router.back();
  };

  const saveEdit = async () => {
    if (!lesson || saving) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("lessons")
        .update({ content: draftHtml })
        .eq("lesson_id", lesson.lesson_id);
      if (error) throw error;

      setContentHtml(draftHtml);
      router.replace({
        pathname: "/library/lesson_detail",
        params: { lessonId: lesson.lesson_id, subjectId: resolvedSubjectId || undefined, refreshedAt: String(Date.now()) },
      });
    } catch (err: any) {
      Alert.alert("Could not save lesson", err?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
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
    <View style={[styles.page, { backgroundColor: shellBg }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.text} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.header, { backgroundColor: shellBg, borderBottomColor: c.border }]}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Pressable onPress={goBack} style={styles.iconTap}>
                <Ionicons name="caret-back" size={14} color={c.text} />
              </Pressable>
              <Text numberOfLines={1} style={[styles.headerTitle, { color: c.text }]}>
                Edit Lesson {lesson.sequence_no}: {lesson.title}
              </Text>
            </View>

            <Pressable onPress={saveEdit} disabled={saving} style={styles.iconTap}>
              {saving ? <ActivityIndicator size="small" color={c.text} /> : <Ionicons name="checkmark" size={22} color={c.text} />}
            </Pressable>
          </View>

          <View style={[styles.toolbar, { borderTopColor: c.border }]}>
            <Pressable style={resolveToolButtonStyle(toolbarState.bold)} onPress={() => sendCommand({ type: "bold" })}>
              <Text style={[styles.toolText, styles.boldTool, { color: resolveToolTextColor(toolbarState.bold) }]}>B</Text>
            </Pressable>
            <Pressable style={resolveToolButtonStyle(toolbarState.italic)} onPress={() => sendCommand({ type: "italic" })}>
              <Text style={[styles.toolText, styles.italicTool, { color: resolveToolTextColor(toolbarState.italic) }]}>I</Text>
            </Pressable>
            <Pressable
              style={resolveToolButtonStyle(toolbarState.underline)}
              onPress={() => sendCommand({ type: "underline" })}
            >
              <Text style={[styles.toolText, styles.underlineTool, { color: resolveToolTextColor(toolbarState.underline) }]}>U</Text>
            </Pressable>
            <Pressable style={resolveToolButtonStyle(toolbarState.strike)} onPress={() => sendCommand({ type: "strike" })}>
              <Text style={[styles.toolText, styles.strikeTool, { color: resolveToolTextColor(toolbarState.strike) }]}>S</Text>
            </Pressable>
            <Pressable style={resolveToolButtonStyle(toolbarState.bullet)} onPress={() => sendCommand({ type: "bullet" })}>
              <Ionicons name="list" size={18} color={resolveToolTextColor(toolbarState.bullet)} />
            </Pressable>
            <Pressable
              style={resolveToolButtonStyle(toolbarState.align === "left")}
              onPress={() => sendCommand({ type: "align", value: "left" })}
            >
              <Ionicons name="reorder-three-outline" size={18} color={resolveToolTextColor(toolbarState.align === "left")} />
            </Pressable>
            <Pressable
              style={resolveToolButtonStyle(toolbarState.align === "center")}
              onPress={() => sendCommand({ type: "align", value: "center" })}
            >
              <Ionicons name="remove-outline" size={18} color={resolveToolTextColor(toolbarState.align === "center")} />
            </Pressable>
            <Pressable
              style={resolveToolButtonStyle(toolbarState.align === "right")}
              onPress={() => sendCommand({ type: "align", value: "right" })}
            >
              <Ionicons name="menu-outline" size={18} color={resolveToolTextColor(toolbarState.align === "right")} />
            </Pressable>
            <Pressable
              style={resolveToolButtonStyle(showLinkEditor || toolbarState.link)}
              onPress={() => setShowLinkEditor((current) => !current)}
            >
              <Ionicons name="link-outline" size={18} color={resolveToolTextColor(showLinkEditor || toolbarState.link)} />
            </Pressable>
            <Pressable style={resolveToolButtonStyle(toolbarState.code)} onPress={() => sendCommand({ type: "code" })}>
              <Ionicons name="code-slash-outline" size={18} color={resolveToolTextColor(toolbarState.code)} />
            </Pressable>
          </View>

          {showLinkEditor ? (
            <View style={[styles.actionTray, { borderTopColor: c.border }]}>
              <TextInput
                value={linkUrl}
                onChangeText={setLinkUrl}
                placeholder="https://example.com"
                placeholderTextColor={scheme === "dark" ? "#7B8798" : "#9CA3AF"}
                style={[styles.trayInput, { color: c.text, borderColor: c.border, backgroundColor: editorBg }]}
                autoCapitalize="none"
              />
              <Pressable
                style={[styles.trayButton, { backgroundColor: c.text }]}
                onPress={() => {
                  sendCommand({ type: "link", url: linkUrl.trim() });
                  setLinkUrl("");
                  setShowLinkEditor(false);
                }}
              >
                <Text style={[styles.trayButtonText, { color: editorBg }]}>Apply</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View
          style={[
            styles.editorShell,
            {
              backgroundColor: editorBg,
              borderColor: c.border,
              height: editorHeight,
            },
          ]}
        >
          <WebView
            ref={editorRef}
            originWhitelist={["*"]}
            source={editorSource}
            key={`lesson-editor-${lesson.lesson_id}-${contentHtml.length}`}
            onMessage={handleMessage}
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
  toolbar: {
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  toolBtn: {
    minWidth: 30,
    height: 30,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  toolText: {
    fontSize: 18,
    lineHeight: 20,
  },
  boldTool: {
    fontWeight: "700",
  },
  italicTool: {
    fontStyle: "italic",
  },
  underlineTool: {
    textDecorationLine: "underline",
  },
  strikeTool: {
    textDecorationLine: "line-through",
  },
  actionTray: {
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    gap: 8,
  },
  trayInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Typography.body,
  },
  trayButton: {
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  trayButtonText: {
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
