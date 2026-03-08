import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
  ScrollView,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { supabase } from "../../lib/supabase";

type PickedFile = {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
};

function guessMimeType(name: string, fallback: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return fallback || "application/octet-stream";
}

function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

async function readUriAsArrayBuffer(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function ocrImage(uri: string): Promise<string> {
  try {
    const mod = await import("react-native-mlkit-ocr");
    const result = await mod.default.detectFromUri(uri);
    if (typeof result === "string") return result;

    const pieces: string[] = [];
    for (const block of result ?? []) {
      if (block?.text) pieces.push(block.text);
      else if (block?.lines?.length) {
        for (const line of block.lines) {
          if (line?.text) pieces.push(line.text);
        }
      }
    }

    const text = pieces.join("\n").trim();
    return text || "";
  } catch (e: any) {
    throw new Error(
      "Image OCR needs a Dev Build (not Expo Go). Install react-native-mlkit-ocr and rebuild your app."
    );
  }
}

export default function CreateScreen() {
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [extractedText, setExtractedText] = useState("");
  const [status, setStatus] = useState<string>("");

  const fileKind = useMemo(() => {
    if (!picked) return null;
    if (picked.mimeType.startsWith("image/")) return "image";
    if (picked.mimeType === "application/pdf") return "pdf";
    if (picked.name.toLowerCase().endsWith(".pdf")) return "pdf";
    return picked.mimeType.startsWith("image/") ? "image" : "unknown";
  }, [picked]);

  async function pickFile() {
    setExtractedText("");
    setStatus("");
    const res = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/*"],
      multiple: false,
      copyToCacheDirectory: true,
    });

    if (res.canceled) return;

    const f = res.assets[0];
    const name = sanitizeFileName(f.name ?? `upload_${Date.now()}`);
    const mimeType = guessMimeType(name, f.mimeType ?? "");

    setPicked({
      uri: f.uri,
      name,
      mimeType,
      size: f.size,
    });
  }

  async function uploadAndExtract() {
    if (!picked) return;

    setBusy(true);
    setExtractedText("");
    setStatus("Preparing upload...");

    try {
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) throw sessionErr;
      const session = sessionData?.session;
      const userId = session?.user?.id;
      if (!userId) throw new Error("You must be signed in.");

      const kind = fileKind;
      if (kind !== "image" && kind !== "pdf") {
        throw new Error("Unsupported file type. Please upload a PDF or an image.");
      }

      if (kind === "image") {
        setStatus("Running OCR on image...");
        const text = await ocrImage(picked.uri);

        if (!text.trim()) {
          setStatus("No text detected.");
          setExtractedText("");
          return;
        }

        setStatus("Uploading image to cloud...");
        const storagePath = `users/${userId}/images/${Date.now()}_${picked.name}`;

        const body = await readUriAsArrayBuffer(picked.uri);
        const { error: upErr } = await supabase.storage
          .from("uploads")
          .upload(storagePath, body, {
            contentType: picked.mimeType,
            upsert: false,
          });
        if (upErr) throw upErr;

        setStatus("Done.");
        setExtractedText(text);
        return;
      }

      setStatus("Uploading PDF to cloud...");
      const storagePath = `users/${userId}/pdfs/${Date.now()}_${picked.name}`;

      const body = await readUriAsArrayBuffer(picked.uri);
      const { error: upErr } = await supabase.storage
        .from("uploads")
        .upload(storagePath, body, {
          contentType: picked.mimeType,
          upsert: false,
        });
      if (upErr) throw upErr;

      setStatus("Extracting text from PDF...");
      const { data, error } = await supabase.functions.invoke("extract-text", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: { storagePath },
      });

      if (error) {
        const response = (error as any)?.context as Response | undefined;
        const status = response?.status;
        let details = error.message || "Edge Function failed.";

        if (response) {
          const payload = await response
            .json()
            .catch(async () => ({ raw: await response.text().catch(() => "") }));
          const serverMessage =
            payload?.details || payload?.message || payload?.error || payload?.raw;
          if (serverMessage) details = `${details} ${String(serverMessage)}`.trim();
        }

        throw new Error(
          status ? `extract-text failed (${status}): ${details}` : `extract-text failed: ${details}`
        );
      }

      const text = (data?.text ?? "").toString();
      setExtractedText(text);
      setStatus(text.trim() ? "Done." : "No text extracted.");
    } catch (e: any) {
      console.log(e);
      setStatus("Error.");
      const message =
        e?.message?.includes?.("Network request failed")
          ? "Network request failed. Check internet access and your EXPO_PUBLIC_SUPABASE_URL/EXPO_PUBLIC_SUPABASE_KEY values."
          : (e?.message ?? "Unknown error");
      Alert.alert("Extraction failed", message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Upload Curriculum / Table of Contents</Text>
      <Text style={styles.sub}>
        Upload a PDF (selectable or scanned) or an image. The extracted text will appear below.
      </Text>

      <View style={styles.card}>
        <Pressable onPress={pickFile} style={styles.btn}>
          <Text style={styles.btnText}>Choose PDF or Image</Text>
        </Pressable>

        {picked ? (
          <View style={styles.fileInfo}>
            <Text style={styles.fileLine}>
              <Text style={styles.fileLabel}>File:</Text> {picked.name}
            </Text>
            <Text style={styles.fileLine}>
              <Text style={styles.fileLabel}>Type:</Text> {picked.mimeType}
            </Text>
            <Text style={styles.fileLine}>
              <Text style={styles.fileLabel}>Kind:</Text> {fileKind}
            </Text>
          </View>
        ) : (
          <Text style={styles.muted}>No file selected.</Text>
        )}

        <Pressable
          onPress={uploadAndExtract}
          style={[styles.btnPrimary, (!picked || busy) && styles.btnDisabled]}
          disabled={!picked || busy}
        >
          {busy ? (
            <View style={styles.row}>
              <ActivityIndicator />
              <Text style={styles.btnTextPrimary}> Processing...</Text>
            </View>
          ) : (
            <Text style={styles.btnTextPrimary}>Extract Text</Text>
          )}
        </Pressable>

        {!!status && <Text style={styles.status}>{status}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Extracted Text</Text>
        <TextInput
          value={extractedText}
          onChangeText={setExtractedText}
          placeholder="Extracted text will appear here..."
          multiline
          style={styles.textBox}
          textAlignVertical="top"
        />
        <Text style={styles.hint}>
          Tip: Teachers can edit this text before generating lessons/quizzes.
        </Text>
      </View>

      <Text style={styles.footerNote}>
        Note: Image OCR requires a Dev Build (not Expo Go). PDFs are processed by your
        backend function.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
  },
  sub: {
    fontSize: 14,
    opacity: 0.75,
    marginBottom: 6,
  },
  card: {
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.12)",
    borderRadius: 16,
    padding: 14,
    gap: 10,
    backgroundColor: "white",
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.18)",
    alignItems: "center",
  },
  btnText: {
    fontWeight: "700",
  },
  btnPrimary: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "black",
    alignItems: "center",
  },
  btnTextPrimary: {
    color: "white",
    fontWeight: "800",
  },
  btnDisabled: {
    opacity: 0.5,
  },
  fileInfo: {
    gap: 4,
  },
  fileLine: {
    fontSize: 13,
  },
  fileLabel: {
    fontWeight: "800",
  },
  muted: {
    fontSize: 13,
    opacity: 0.6,
  },
  status: {
    fontSize: 13,
    opacity: 0.75,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 6,
  },
  textBox: {
    minHeight: 240,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.18)",
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
  },
  hint: {
    fontSize: 12,
    opacity: 0.65,
  },
  footerNote: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
});
