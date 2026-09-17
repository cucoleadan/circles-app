import { useEffect, useMemo, useState, type FormEvent } from "react"
import {
  ArrowUpRight,
  CircleDot,
  LogOut,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Separator } from "@workspace/ui/components/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

export type Contact = {
  id: string
  name: string
  handle: string | null
  notes: string | null
  relationshipStatus: RelationshipStatus | null
  createdAt: string
}

type RelationshipStatus = "new" | "active" | "close" | "dormant"
type Filter = "all" | RelationshipStatus

const statuses: {
  id: RelationshipStatus
  label: string
  description: string
  dot: string
}[] = [
  {
    id: "new",
    label: "New",
    description: "Recently added",
    dot: "bg-amber-400",
  },
  {
    id: "active",
    label: "Active",
    description: "Relationships in motion",
    dot: "bg-sky-500",
  },
  {
    id: "close",
    label: "Close",
    description: "Your inner circle",
    dot: "bg-emerald-500",
  },
  {
    id: "dormant",
    label: "Dormant",
    description: "Ready to reconnect",
    dot: "bg-stone-400",
  },
]

function normalizedStatus(contact: Contact): RelationshipStatus {
  return contact.relationshipStatus ?? "new"
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

function ContactEditor({
  contact,
  onSaved,
  onArchived,
}: {
  contact: Contact | null
  onSaved: (contact: Contact, created: boolean) => void
  onArchived: (id: string) => void
}) {
  const [name, setName] = useState(contact?.name ?? "")
  const [handle, setHandle] = useState(contact?.handle ?? "")
  const [notes, setNotes] = useState(contact?.notes ?? "")
  const [relationshipStatus, setRelationshipStatus] =
    useState<RelationshipStatus>(contact ? normalizedStatus(contact) : "new")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError("")
    try {
      const response = await fetch(
        contact ? `/api/contacts/${contact.id}` : "/api/contacts",
        {
          method: contact ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, handle, notes, relationshipStatus }),
        }
      )
      const body = (await response.json()) as {
        contact?: Contact
        error?: string
      }
      if (!response.ok || !body.contact)
        throw new Error(body.error ?? "Could not save this contact.")
      onSaved(body.contact, !contact)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save this contact."
      )
    } finally {
      setSaving(false)
    }
  }

  async function archive() {
    if (
      !contact ||
      !window.confirm(
        `Archive ${contact.name}? You can restore archived contacts later.`
      )
    )
      return
    setSaving(true)
    setError("")
    try {
      const response = await fetch(`/api/contacts/${contact.id}`, {
        method: "DELETE",
      })
      if (!response.ok) throw new Error("Could not archive this contact.")
      onArchived(contact.id)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not archive this contact."
      )
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-7 overflow-y-auto px-5 pb-8 sm:px-8">
        {contact && (
          <div className="flex items-center gap-4 rounded-2xl bg-[#faf4ee] p-4">
            <Avatar className="size-12 border-2 border-white shadow-sm">
              <AvatarFallback className="bg-[#f15a3a] text-sm font-semibold text-white">
                {initials(contact.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-semibold">{contact.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {contact.handle
                  ? `@${contact.handle}`
                  : "No Substack handle yet"}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="contact-name" className="text-xs font-semibold">
            Name
          </label>
          <Input
            id="contact-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Maya Chen"
            maxLength={120}
            required
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="contact-handle" className="text-xs font-semibold">
            Substack handle
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
              @
            </span>
            <Input
              id="contact-handle"
              className="pl-7"
              value={handle}
              onChange={(event) =>
                setHandle(event.target.value.replace(/^@/, ""))
              }
              placeholder="username"
              maxLength={120}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold">Relationship</label>
          <Select
            value={relationshipStatus}
            onValueChange={(value) =>
              setRelationshipStatus(value as RelationshipStatus)
            }
          >
            <SelectTrigger className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  <span className={cn("size-2 rounded-full", status.dot)} />{" "}
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="contact-notes" className="text-xs font-semibold">
              Private notes
            </label>
            <span className="text-[10px] text-muted-foreground">
              Only you can see these
            </span>
          </div>
          <Textarea
            id="contact-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="How you met, what matters to them, and what to follow up on…"
            maxLength={5000}
            className="min-h-36 resize-y leading-6"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        {contact && (
          <>
            <Separator />
            <button
              type="button"
              disabled={saving}
              onClick={archive}
              className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="size-3.5" /> Archive contact
            </button>
          </>
        )}
      </div>

      <div className="border-t bg-white/95 p-4 backdrop-blur sm:px-8">
        <Button
          type="submit"
          size="lg"
          className="h-10 w-full rounded-xl bg-[#191817] hover:bg-[#302e2c]"
          disabled={saving || !name.trim()}
        >
          {saving ? "Saving…" : contact ? "Save changes" : "Add to your circle"}
        </Button>
      </div>
    </form>
  )
}

export function CirclesWorkspace({
  initialContacts,
}: {
  initialContacts: Contact[]
}) {
  const [contacts, setContacts] = useState(initialContacts)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [selected, setSelected] = useState<Contact | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [notice, setNotice] = useState("")

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("contact")
    const contact = contacts.find((item) => item.id === id)
    if (contact) {
      setSelected(contact)
      setEditorOpen(true)
    }
  }, [])

  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return contacts.filter((contact) => {
      const matchesFilter =
        filter === "all" || normalizedStatus(contact) === filter
      const matchesQuery =
        !term ||
        [contact.name, contact.handle, contact.notes].some((value) =>
          value?.toLocaleLowerCase().includes(term)
        )
      return matchesFilter && matchesQuery
    })
  }, [contacts, filter, query])

  function setContactParam(id?: string) {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set("contact", id)
    else url.searchParams.delete("contact")
    window.history.replaceState({}, "", url)
  }

  function openContact(contact: Contact) {
    setSelected(contact)
    setEditorOpen(true)
    setContactParam(contact.id)
  }

  function openCreate() {
    setSelected(null)
    setEditorOpen(true)
    setContactParam()
  }

  function closeEditor() {
    setEditorOpen(false)
    setContactParam()
  }

  function saved(contact: Contact, created: boolean) {
    setContacts((current) => {
      const next = created
        ? [...current, contact]
        : current.map((item) => (item.id === contact.id ? contact : item))
      return next.sort((a, b) => a.name.localeCompare(b.name))
    })
    setNotice(
      created
        ? `${contact.name} was added to your circle.`
        : `${contact.name} was updated.`
    )
    closeEditor()
    window.setTimeout(() => setNotice(""), 3500)
  }

  function archived(id: string) {
    const contact = contacts.find((item) => item.id === id)
    setContacts((current) => current.filter((item) => item.id !== id))
    setNotice(`${contact?.name ?? "Contact"} was archived.`)
    closeEditor()
    window.setTimeout(() => setNotice(""), 3500)
  }

  async function logout() {
    await fetch("/api/auth/sign-out", { method: "POST" })
    window.location.href = "/login"
  }

  return (
    <main className="min-h-screen bg-[#f5f1eb] bg-[radial-gradient(ellipse_at_top_right,rgba(255,210,189,0.45),transparent_60%)] text-[#191817]">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-9">
        <nav className="flex items-center justify-between gap-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-white bg-white/75 px-4 py-2 text-xs font-medium shadow-sm shadow-black/[0.02]">
            <CircleDot className="size-4 text-[#f15a3a]" /> Circles
            <span className="ml-2 hidden border-l pl-3 text-muted-foreground sm:inline">
              People & relationships
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={openCreate}
              className="rounded-full bg-[#191817] px-4 text-white hover:bg-[#302e2c]"
            >
              <Plus /> Add person
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              aria-label="Sign out"
              className="rounded-full"
            >
              <LogOut />
            </Button>
          </div>
        </nav>

        <header className="pt-12 pb-8 sm:pt-16 sm:pb-10">
          <p className="mb-3 flex items-center gap-2 text-xs font-medium tracking-[0.16em] text-[#d94d32] uppercase">
            <Sparkles className="size-3.5" /> Your relationship workspace
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
            <span className="text-[#f15a3a]">{contacts.length}</span>{" "}
            {contacts.length === 1 ? "person" : "people"} in your circle
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
            Remember the people behind the conversations—and the small details
            that make relationships matter.
          </p>
        </header>

        {notice && (
          <div
            role="status"
            className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            {notice}
          </div>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-[230px_minmax(0,1fr)] xl:gap-9">
          <aside
            className="lg:sticky lg:top-6"
            aria-label="Relationship filters"
          >
            <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={cn(
                  "min-w-44 rounded-2xl border p-4 text-left transition-all lg:min-w-0",
                  filter === "all"
                    ? "border-black/20 bg-white shadow-sm"
                    : "border-black/[0.06] bg-white/55 hover:bg-white/80"
                )}
              >
                <span className="flex items-center justify-between text-xs font-semibold">
                  <span>Everyone</span>
                  <span className="text-muted-foreground">
                    {contacts.length}
                  </span>
                </span>
                <span className="mt-3 flex -space-x-2">
                  {contacts.slice(0, 5).map((contact) => (
                    <Avatar
                      key={contact.id}
                      className="size-7 border-2 border-white"
                    >
                      <AvatarFallback className="bg-stone-200 text-[9px]">
                        {initials(contact.name)}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {!contacts.length && (
                    <span className="text-[10px] text-muted-foreground">
                      Your circle is empty
                    </span>
                  )}
                </span>
              </button>
              {statuses.map((status) => {
                const count = contacts.filter(
                  (contact) => normalizedStatus(contact) === status.id
                ).length
                return (
                  <button
                    key={status.id}
                    type="button"
                    onClick={() => setFilter(status.id)}
                    className={cn(
                      "min-w-44 rounded-2xl border p-4 text-left transition-all lg:min-w-0",
                      filter === status.id
                        ? "border-black/20 bg-white shadow-sm"
                        : "border-black/[0.06] bg-white/55 hover:bg-white/80"
                    )}
                  >
                    <span className="flex items-center justify-between text-xs font-semibold">
                      <span>{status.label}</span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        {count}
                        <span
                          className={cn("size-1.5 rounded-full", status.dot)}
                        />
                      </span>
                    </span>
                    <span className="mt-2 block text-[10px] text-muted-foreground">
                      {status.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="min-w-0" aria-label="Contacts">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">
                  {filter === "all"
                    ? "Everyone"
                    : statuses.find((item) => item.id === filter)?.label}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {visible.length} {visible.length === 1 ? "person" : "people"}
                </p>
              </div>
              <label className="relative block w-full sm:w-72">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search contacts"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search people, handles, notes…"
                  className="h-10 rounded-full border-white bg-white/85 pl-10 shadow-sm"
                />
              </label>
            </div>

            {visible.length ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {visible.map((contact) => {
                  const status = statuses.find(
                    (item) => item.id === normalizedStatus(contact)
                  )!
                  return (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() => openContact(contact)}
                      className="group flex min-h-56 flex-col rounded-2xl border border-black/[0.08] bg-white/90 p-5 text-left shadow-[0_2px_8px_rgba(50,35,20,0.025)] transition-all hover:-translate-y-0.5 hover:border-black/15 hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#f15a3a]/50 focus-visible:outline-none sm:p-6"
                    >
                      <header className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="rounded-full border-2 border-[#f15a3a]/65 p-0.5">
                            <Avatar className="size-10">
                              <AvatarFallback className="bg-[#faf0e9] text-xs font-semibold text-[#d94d32]">
                                {initials(contact.name)}
                              </AvatarFallback>
                            </Avatar>
                          </div>
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold group-hover:text-[#d94d32]">
                              {contact.name}
                            </h3>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {contact.handle
                                ? `@${contact.handle}`
                                : "No handle"}
                            </p>
                          </div>
                        </div>
                        <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
                      </header>

                      <div className="mt-5 flex-1">
                        {contact.notes ? (
                          <p className="line-clamp-4 text-sm leading-6 whitespace-pre-wrap text-[#47423e]">
                            {contact.notes}
                          </p>
                        ) : (
                          <p className="text-sm leading-6 text-muted-foreground">
                            No notes yet. Add context, follow-ups, or the
                            details you want to remember.
                          </p>
                        )}
                      </div>

                      <footer className="mt-5 flex items-center justify-between border-t border-black/[0.06] pt-4">
                        <Badge
                          variant="secondary"
                          className="rounded-full bg-[#faf4ee] font-medium text-[#6f5d52]"
                        >
                          <span
                            className={cn(
                              "mr-1 size-1.5 rounded-full",
                              status.dot
                            )}
                          />
                          {status.label}
                        </Badge>
                        <span className="text-[11px] font-medium text-[#d94d32]">
                          Open relationship
                        </span>
                      </footer>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-black/15 bg-white/60 px-6 py-16 text-center">
                <Users className="mx-auto size-8 text-[#f15a3a]/75" />
                <h3 className="mt-4 text-sm font-semibold">
                  {contacts.length
                    ? "No people match this view"
                    : "Your circle starts with one person"}
                </h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  {contacts.length
                    ? "Try another relationship status or clear your search."
                    : "Add someone you want to remember, support, or reconnect with."}
                </p>
                <Button
                  onClick={
                    contacts.length
                      ? () => {
                          setQuery("")
                          setFilter("all")
                        }
                      : openCreate
                  }
                  variant="outline"
                  className="mt-5 rounded-full bg-white"
                >
                  {contacts.length ? "Clear filters" : "Add your first person"}
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>

      <Sheet
        open={editorOpen}
        onOpenChange={(open) => {
          if (!open) closeEditor()
        }}
      >
        <SheetContent className="w-full gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="px-5 pt-6 pb-5 sm:px-8">
            <SheetTitle className="text-xl font-semibold tracking-tight">
              {selected ? "Relationship details" : "Add someone new"}
            </SheetTitle>
            <SheetDescription>
              {selected
                ? "Keep the context that helps you show up well."
                : "Start with the essentials. You can add more anytime."}
            </SheetDescription>
          </SheetHeader>
          <ContactEditor
            key={selected?.id ?? "new"}
            contact={selected}
            onSaved={saved}
            onArchived={archived}
          />
        </SheetContent>
      </Sheet>
    </main>
  )
}
