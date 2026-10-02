import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { Extension, type JSONContent } from "@tiptap/core"
import { Mention } from "@tiptap/extension-mention"
import { CharacterCount, Placeholder } from "@tiptap/extensions"
import { Markdown } from "@tiptap/markdown"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { EditorContent, ReactRenderer, useEditor, type Editor } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import StarterKit from "@tiptap/starter-kit"
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion"
import { Bold, Code, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"

import type { Person } from "../../lib/types"

/** A contact offered by the @-mention picker. */
interface MentionCandidate {
  id: number
  label: string
  handle: string
  url: string | null
  avatarUrl: string | null
}

async function searchContacts(query: string): Promise<MentionCandidate[]> {
  if (!query) return []
  try {
    const res = await fetch(`/api/v1/people?search=${encodeURIComponent(query)}&limit=25`)
    const body = await res.json()
    return ((body.people ?? []) as Person[])
      .filter((person) => person.substackProfileId && person.handle && /^\d+$/.test(person.substackProfileId))
      .slice(0, 8)
      .map((person) => ({
        id: Number(person.substackProfileId),
        label: person.name,
        handle: person.handle!,
        url: person.profileUrl ?? null,
        avatarUrl: person.avatarUrl ?? null,
      }))
  } catch {
    return []
  }
}

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()
}

interface MentionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

const MentionList = forwardRef<MentionListHandle, SuggestionProps<MentionCandidate>>(function MentionList(props, ref) {
  const [selected, setSelected] = useState(0)
  useEffect(() => setSelected(0), [props.items])

  const pick = (index: number) => {
    const item = props.items[index]
    if (item) props.command({ id: String(item.id), label: item.label, url: item.url } as never)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!props.items.length) return false
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : -1
        setSelected((index) => (index + step + props.items.length) % props.items.length)
        return true
      }
      if (event.key === "Enter" || event.key === "Tab") {
        pick(selected)
        return true
      }
      return false
    },
  }))

  return (
    <div className="z-50 w-72 overflow-hidden rounded-xl border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-800 dark:bg-stone-900">
      {props.items.length === 0 ? (
        <p className="px-2.5 py-2 text-xs text-muted-foreground">
          {props.query ? "No contacts with a Substack profile match." : "Type a name to mention someone."}
        </p>
      ) : (
        props.items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault()
              pick(index)
            }}
            onMouseEnter={() => setSelected(index)}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
              index === selected ? "bg-stone-100 dark:bg-stone-800" : ""
            }`}
          >
            <Avatar className="size-6">
              {item.avatarUrl && <AvatarImage src={item.avatarUrl} alt="" />}
              <AvatarFallback className="text-[10px]">{initials(item.label)}</AvatarFallback>
            </Avatar>
            <span className="truncate font-medium">{item.label}</span>
            <span className="ml-auto truncate text-xs text-muted-foreground">@{item.handle}</span>
          </button>
        ))
      )}
    </div>
  )
})

/** Substack stores mentions as `substack_mention` nodes with a numeric user ID. */
const SubstackMention = Mention.extend({
  name: "substack_mention",
  addAttributes() {
    return {
      ...this.parent?.(),
      mentionType: { default: "user" },
      url: { default: null },
    }
  },
}).configure({
  HTMLAttributes: { class: "mention" },
  renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
  renderHTML: ({ options, node }) => ["span", options.HTMLAttributes, `@${node.attrs.label ?? node.attrs.id}`],
  suggestion: {
    char: "@",
    items: ({ query }) => searchContacts(query),
    render: () => {
      let component: ReactRenderer<MentionListHandle, SuggestionProps<MentionCandidate>> | null = null
      let unmount: (() => void) | null = null
      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, { props, editor: props.editor })
          unmount = props.mount(component.element)
        },
        onUpdate: (props) => component?.updateProps(props),
        onKeyDown: (props) => {
          if (props.event.key === "Escape") {
            unmount?.()
            unmount = null
            return true
          }
          return component?.ref?.onKeyDown(props) ?? false
        },
        onExit: () => {
          unmount?.()
          component?.destroy()
        },
      }
    },
  },
})

const MARKDOWN_HINT =
  /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s+\S|\d+[.)]\s+\S|>\s|```)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|(^|[\s(])[*_][^*_\s][^*_\n]*[*_](?=[\s).,!?:;]|$)/m
/** Clipboard HTML that already carries formatting is pasted as rich text. */
const RICH_HTML = /<(strong|b|em|i|ul|ol|li|blockquote|a\s|h[1-6]|code)[\s>]/i

/**
 * Rewrites parsed Markdown into nodes Substack Notes support: headings become
 * bold paragraphs; rules, images, and tables are dropped.
 */
export function toNoteContent(nodes: JSONContent[] = []): JSONContent[] {
  return nodes.flatMap((node): JSONContent[] => {
    if (node.type === "heading") {
      return [{
        type: "paragraph",
        content: (node.content ?? []).map((child) =>
          child.type === "text" ? { ...child, marks: [...(child.marks ?? []).filter((m) => m.type !== "bold"), { type: "bold" }] } : child,
        ),
      }]
    }
    if (node.type === "horizontalRule" || node.type === "image" || node.type === "table") return []
    return [{ ...node, ...(node.content ? { content: toNoteContent(node.content) } : {}) }]
  })
}

const PasteMarkdown = Extension.create({
  name: "pasteMarkdown",
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey("pasteMarkdown"),
        props: {
          handlePaste: (_view, event) => {
            const text = event.clipboardData?.getData("text/plain")
            const html = event.clipboardData?.getData("text/html") ?? ""
            if (!text || !editor.markdown || RICH_HTML.test(html) || !MARKDOWN_HINT.test(text)) return false
            const parsed = editor.markdown.parse(text)
            const content = toNoteContent(parsed.content)
            if (!content.length) return false
            editor.commands.insertContent(content)
            return true
          },
        },
      }),
    ]
  },
})

/** Converts the editor document into the shape Substack's Notes API accepts. */
export function toSubstackDoc(doc: JSONContent): JSONContent {
  const visit = (node: JSONContent): JSONContent => {
    if (node.type === "substack_mention") {
      return {
        type: "substack_mention",
        attrs: {
          id: Number(node.attrs?.id),
          label: String(node.attrs?.label ?? ""),
          mentionType: node.attrs?.mentionType ?? "user",
          url: node.attrs?.url ?? null,
        },
      }
    }
    return node.content ? { ...node, content: node.content.map(visit) } : node
  }
  return visit(doc)
}

function ToolbarButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex size-7 items-center justify-center rounded-md text-stone-200 hover:bg-white/15 ${
        active ? "bg-white/20 text-white" : ""
      }`}
    >
      {children}
    </button>
  )
}

export function NoteEditor({
  initialContent,
  editable = true,
  placeholder = "What's on your mind?",
  autofocus = false,
  onReady,
  onUpdate,
  onSubmitShortcut,
}: {
  initialContent: JSONContent | null
  editable?: boolean
  placeholder?: string
  autofocus?: boolean
  onReady?: (editor: Editor) => void
  onUpdate?: (editor: Editor) => void
  onSubmitShortcut?: () => void
}) {
  const submitRef = useRef(onSubmitShortcut)
  useEffect(() => {
    submitRef.current = onSubmitShortcut
  }, [onSubmitShortcut])

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    autofocus: autofocus ? "end" : false,
    content: initialContent ?? undefined,
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        underline: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https" },
      }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
      Markdown,
      SubstackMention,
      PasteMarkdown,
      Extension.create({
        name: "submitShortcut",
        addKeyboardShortcuts: () => ({
          "Mod-Enter": () => {
            submitRef.current?.()
            return true
          },
        }),
      }),
    ],
    editorProps: {
      attributes: {
        class: "min-h-32 max-h-[50vh] overflow-y-auto text-[15px] leading-relaxed outline-none",
        "aria-label": "Note text",
      },
    },
    onCreate: ({ editor }) => onReady?.(editor),
    onUpdate: ({ editor }) => onUpdate?.(editor),
  })

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  if (!editor) return <div className="min-h-32" />

  const setLink = () => {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run()
      return
    }
    const href = window.prompt("Link URL")?.trim()
    if (href) editor.chain().focus().extendMarkRange("link").setLink({ href: /^https?:\/\//i.test(href) ? href : `https://${href}` }).run()
  }

  return (
    <div
      className={[
        "note-editor relative",
        "[&_.ProseMirror_p]:my-1.5 [&_.ProseMirror>*:first-child]:mt-0",
        "[&_.ProseMirror_ul]:my-1.5 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6",
        "[&_.ProseMirror_ol]:my-1.5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6",
        "[&_.ProseMirror_li_p]:my-0.5",
        "[&_.ProseMirror_blockquote]:my-2 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-stone-300 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-stone-600 dark:[&_.ProseMirror_blockquote]:border-stone-700 dark:[&_.ProseMirror_blockquote]:text-stone-400",
        "[&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-stone-100 [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_code]:font-mono [&_.ProseMirror_code]:text-[13px] dark:[&_.ProseMirror_code]:bg-stone-800",
        "[&_.ProseMirror_pre]:my-2 [&_.ProseMirror_pre]:rounded-lg [&_.ProseMirror_pre]:bg-stone-100 [&_.ProseMirror_pre]:p-3 dark:[&_.ProseMirror_pre]:bg-stone-800 [&_.ProseMirror_pre_code]:bg-transparent [&_.ProseMirror_pre_code]:p-0",
        "[&_.ProseMirror_a]:text-[#c2410c] [&_.ProseMirror_a]:underline [&_.ProseMirror_a]:underline-offset-2 dark:[&_.ProseMirror_a]:text-orange-300",
        "[&_.mention]:rounded [&_.mention]:font-semibold [&_.mention]:text-[#c2410c] dark:[&_.mention]:text-orange-300",
        "[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-stone-400 [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
      ].join(" ")}
    >
      {editable && (
        <BubbleMenu
          editor={editor}
          options={{ placement: "top" }}
          className="flex items-center gap-0.5 rounded-lg bg-stone-900 p-1 shadow-lg dark:bg-stone-800"
        >
          <ToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <Strikethrough className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Link" active={editor.isActive("link")} onClick={setLink}>
            <Link2 className="size-3.5" />
          </ToolbarButton>
          <span className="mx-0.5 h-4 w-px bg-white/20" />
          <ToolbarButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            <Quote className="size-3.5" />
          </ToolbarButton>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
