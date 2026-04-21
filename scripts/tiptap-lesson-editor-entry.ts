import { Editor } from "@tiptap/core";
import StarterKitExtension from "@tiptap/starter-kit";
import LinkExtension from "@tiptap/extension-link";
import UnderlineExtension from "@tiptap/extension-underline";
import TextAlignExtension from "@tiptap/extension-text-align";

type ParagraphAlignment = "left" | "center" | "right";

type EditorCommand =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "strike" }
  | { type: "bullet" }
  | { type: "align"; value: ParagraphAlignment }
  | { type: "link"; url: string }
  | { type: "code" }
  | { type: "set-content"; html: string };

type EditorBridge = {
  dispatch: (command: EditorCommand) => void;
  setContent: (html: string) => void;
  destroy: () => void;
};

type EditorStatePayload = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  bullet: boolean;
  link: boolean;
  code: boolean;
  align: ParagraphAlignment;
};

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void };
    __lessonEditor?: EditorBridge;
    createLessonEditor?: (config: {
      element: HTMLElement;
      editable: boolean;
      initialContent: string;
    }) => EditorBridge;
  }
}

function post(type: string, payload: Record<string, unknown>) {
  window.ReactNativeWebView?.postMessage(JSON.stringify({ type, ...payload }));
}

function resolveSafeHeight(element: HTMLElement) {
  const candidates = [
    element.scrollHeight,
    element.offsetHeight,
    document.documentElement?.scrollHeight,
    document.body?.scrollHeight,
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  const measuredHeight = candidates.length ? Math.max(...candidates) : 0;
  return Math.max(560, Math.ceil(measuredHeight + 24));
}

function emitHeight(element: HTMLElement) {
  const height = resolveSafeHeight(element);
  post("height", { height });
}

function annotateCodeBlocks(root: HTMLElement) {
  root.querySelectorAll("pre").forEach((block) => {
    const existingGutter = block.querySelector(":scope > .code-line-gutter");
    const codeElement = block.querySelector("code");
    const content = codeElement?.textContent ?? block.textContent ?? "";
    const lineCount = Math.max(1, content.split("\n").length);
    const lineNumbers = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");

    let gutter: HTMLSpanElement;
    if (existingGutter instanceof HTMLSpanElement) {
      gutter = existingGutter;
    } else {
      gutter = document.createElement("span");
      gutter.className = "code-line-gutter";
      gutter.setAttribute("contenteditable", "false");
      gutter.setAttribute("aria-hidden", "true");
      block.prepend(gutter);
    }

    gutter.textContent = lineNumbers;
  });
}

function readAlignment(editor: Editor): ParagraphAlignment {
  if (editor.isActive({ textAlign: "center" })) return "center";
  if (editor.isActive({ textAlign: "right" })) return "right";
  return "left";
}

function emitState(editor: Editor) {
  const state: EditorStatePayload = {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    bullet: editor.isActive("bulletList"),
    link: editor.isActive("link"),
    code: editor.isActive("codeBlock"),
    align: readAlignment(editor),
  };

  post("state", { state });
}

function syncEditorChrome(editor: Editor, element: HTMLElement) {
  annotateCodeBlocks(element);
  emitState(editor);
  emitHeight(element);
}

function createLessonEditor(config: {
  element: HTMLElement;
  editable: boolean;
  initialContent: string;
}): EditorBridge {
  const { element, editable, initialContent } = config;

  const editor = new Editor({
    element,
    editable,
    extensions: [
      StarterKitExtension.configure({
        heading: false,
        blockquote: false,
        horizontalRule: false,
      }),
      UnderlineExtension,
      LinkExtension.configure({
        openOnClick: !editable,
        autolink: false,
        HTMLAttributes: {
          class: "lesson-link",
        },
      }),
      TextAlignExtension.configure({
        types: ["paragraph"],
        alignments: ["left", "center", "right"],
        defaultAlignment: "left",
      }),
    ],
    content: initialContent || "<p></p>",
    editorProps: {
      attributes: {
        class: "lesson-editor",
      },
    },
    onCreate: ({ editor: instance }) => {
      post("ready", {});
      post("content", { html: instance.getHTML() });
      syncEditorChrome(instance, element);
    },
    onUpdate: ({ editor: instance }) => {
      post("content", { html: instance.getHTML() });
      syncEditorChrome(instance, element);
    },
    onSelectionUpdate: ({ editor: instance }) => {
      syncEditorChrome(instance, element);
    },
  });

  const dispatch = (command: EditorCommand) => {
    if (command.type === "bold") {
      editor.chain().focus().toggleBold().run();
      return;
    }
    if (command.type === "italic") {
      editor.chain().focus().toggleItalic().run();
      return;
    }
    if (command.type === "underline") {
      editor.chain().focus().toggleUnderline().run();
      return;
    }
    if (command.type === "strike") {
      editor.chain().focus().toggleStrike().run();
      return;
    }
    if (command.type === "bullet") {
      editor.chain().focus().toggleBulletList().run();
      return;
    }
    if (command.type === "align") {
      editor.chain().focus().setTextAlign(command.value).run();
      return;
    }
    if (command.type === "link") {
      const href = command.url.trim();
      if (!href) return;
      const normalized = /^https?:\/\//i.test(href) ? href : `https://${href}`;
      editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
      return;
    }
    if (command.type === "code") {
      editor.chain().focus().toggleCodeBlock().run();
      return;
    }
    if (command.type === "set-content") {
      editor.commands.setContent(command.html || "<p></p>", { emitUpdate: false });
    }
  };

  const bridge: EditorBridge = {
    dispatch,
    setContent: (html: string) => {
      editor.commands.setContent(html || "<p></p>", { emitUpdate: false });
    },
    destroy: () => {
      editor.destroy();
    },
  };

  const scheduleHeightEmit = () => {
    window.requestAnimationFrame(() => syncEditorChrome(editor, element));
  };

  window.addEventListener("load", scheduleHeightEmit);
  window.addEventListener("resize", scheduleHeightEmit);
  const observer = new MutationObserver(scheduleHeightEmit);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });

  const runtimeBridge: EditorBridge = {
    ...bridge,
    destroy: () => {
      observer.disconnect();
      window.removeEventListener("load", scheduleHeightEmit);
      window.removeEventListener("resize", scheduleHeightEmit);
      bridge.destroy();
    },
  };

  window.__lessonEditor = runtimeBridge;
  return runtimeBridge;
}

window.createLessonEditor = createLessonEditor;
