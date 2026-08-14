import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { TableKit } from "@tiptap/extension-table";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  BoldIcon,
  CodeIcon,
  ImagePlusIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  SquareCodeIcon,
  Table2Icon,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";
import { editorHtmlToMarkdown, markdownToEditorHtml } from "@/markdown";
import { Button } from "@/components/ui/button";

export function MarkdownEditor({
  ariaLabel,
  markdown,
  onChange,
}: {
  ariaLabel: string;
  markdown: string;
  onChange: (markdown: string) => void;
}) {
  const editor = useEditor({
    content: markdownToEditorHtml(markdown),
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class:
          "markdown-editor-content min-h-32 rounded-b-md border border-t-0 bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
      },
    },
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Link.configure({
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: {
          rel: "nofollow noreferrer",
          target: "_blank",
        },
        openOnClick: false,
      }),
      Image.configure({
        allowBase64: false,
        inline: false,
      }),
      TableKit.configure({
        table: { resizable: true },
      }),
    ],
    immediatelyRender: false,
    onUpdate: ({ editor: activeEditor }) => {
      onChange(editorHtmlToMarkdown(activeEditor.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    if (shouldReplaceEditorContent(editor.getHTML(), markdown)) {
      editor.commands.setContent(markdownToEditorHtml(markdown), {
        emitUpdate: false,
      });
    }
  }, [editor, markdown]);

  const isCodeBlockActive = editor?.isActive("codeBlock") ?? false;

  return (
    <div data-markdown-editor className="overflow-hidden rounded-md">
      <div className="flex flex-wrap gap-1 rounded-t-md border bg-muted/30 p-1">
        <EditorButton
          active={editor?.isActive("bold") ?? false}
          disabled={!editor}
          icon={BoldIcon}
          label="Bold"
          onClick={() => editor?.chain().focus().toggleBold().run()}
        />
        <EditorButton
          active={false}
          disabled={!editor}
          icon={ImagePlusIcon}
          label="Image"
          onClick={() => {
            const url = window.prompt("Image URL");
            const safeUrl = normalizeImageUrl(url);

            if (!editor || !safeUrl) {
              return;
            }

            editor.chain().focus().setImage({ src: safeUrl }).run();
          }}
        />
        <EditorButton
          active={editor?.isActive("table") ?? false}
          disabled={!editor}
          icon={Table2Icon}
          label="Table"
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertTable({ cols: 3, rows: 3, withHeaderRow: true })
              .run()
          }
        />
        <EditorButton
          active={editor?.isActive("italic") ?? false}
          disabled={!editor}
          icon={ItalicIcon}
          label="Italic"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        />
        <EditorButton
          active={editor?.isActive("code") ?? false}
          disabled={!editor || isCodeBlockActive}
          icon={CodeIcon}
          label="Inline code"
          onClick={() => editor?.chain().focus().toggleCode().run()}
        />
        <EditorButton
          active={isCodeBlockActive}
          disabled={!editor}
          icon={SquareCodeIcon}
          label="Code block"
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        />
        <EditorButton
          active={editor?.isActive("bulletList") ?? false}
          disabled={!editor}
          icon={ListIcon}
          label="Bullet list"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        />
        <EditorButton
          active={editor?.isActive("link") ?? false}
          disabled={!editor}
          icon={LinkIcon}
          label="Link"
          onClick={() => {
            const previousUrl = editor?.getAttributes("link").href as
              | string
              | undefined;
            const url = window.prompt("Link URL", previousUrl ?? "");

            if (!editor || url === null) {
              return;
            }

            if (url.trim() === "") {
              editor.chain().focus().unsetLink().run();
              return;
            }

            editor.chain().focus().setLink({ href: url.trim() }).run();
          }}
        />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function normalizeImageUrl(value: string | null): string | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function shouldReplaceEditorContent(
  currentHtml: string,
  nextMarkdown: string,
): boolean {
  return (
    editorHtmlToMarkdown(currentHtml) !==
    editorHtmlToMarkdown(markdownToEditorHtml(nextMarkdown))
  );
}

function EditorButton({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      className="size-8 rounded-none"
      disabled={disabled}
      onClick={onClick}
      size="sm"
      title={label}
      type="button"
      variant={active ? "default" : "outline"}
    >
      <Icon aria-hidden />
      <span className="sr-only">{label}</span>
    </Button>
  );
}
