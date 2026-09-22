import { useEffect, useState, type SyntheticEvent } from "react"
import {
  Activity,
  AlertCircle,
  AtSign,
  Check,
  ExternalLink,
  Globe,
  Hash,
  Image as ImageIcon,
  User,
  UserCog,
  X,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import type { Person } from "../lib/types"

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

export function EditContactDialog({
  open,
  onOpenChange,
  person,
  onPersonUpdated,
  initialFocus = "name",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  person: Person
  onPersonUpdated: (updated: Person) => void
  initialFocus?: "name" | "handle"
}) {
  const [name, setName] = useState(person.name)
  const [handle, setHandle] = useState(person.handle ? `@${person.handle.replace(/^@/, "")}` : "")
  const [avatarUrl, setAvatarUrl] = useState(person.avatarUrl ?? "")
  const [profileUrl, setProfileUrl] = useState(person.profileUrl ?? "")
  const [publicationUrl, setPublicationUrl] = useState(person.publicationUrl ?? "")
  const [substackProfileId, setSubstackProfileId] = useState(person.substackProfileId ?? "")
  const [isFollower, setIsFollower] = useState(Boolean(person.isFollower))
  const [isFollowing, setIsFollowing] = useState(Boolean(person.isFollowing))
  const [isSubscriber, setIsSubscriber] = useState(Boolean(person.isSubscriber))
  const [isSubscribedTo, setIsSubscribedTo] = useState(Boolean(person.isSubscribedTo))
  const [relationshipStatus, setRelationshipStatus] = useState<string>(
    person.relationshipStatus || "active"
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successNotice, setSuccessNotice] = useState(false)

  // Reset form when person changes or modal opens
  useEffect(() => {
    if (open) {
      setName(person.name)
      setHandle(person.handle ? `@${person.handle.replace(/^@/, "")}` : "")
      setAvatarUrl(person.avatarUrl ?? "")
      setProfileUrl(person.profileUrl ?? "")
      setPublicationUrl(person.publicationUrl ?? "")
      setSubstackProfileId(person.substackProfileId ?? "")
      setIsFollower(Boolean(person.isFollower))
      setIsFollowing(Boolean(person.isFollowing))
      setIsSubscriber(Boolean(person.isSubscriber))
      setIsSubscribedTo(Boolean(person.isSubscribedTo))
      setRelationshipStatus(person.relationshipStatus || "active")
      setError(null)
      setSuccessNotice(false)
    }
  }, [open, person])

  if (!person) return null

  async function handleSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName || saving) return

    setSaving(true)
    setError(null)

    const cleanedHandle = handle.trim() ? handle.trim().replace(/^@/, "") : null

    try {
      const res = await fetch(`/api/v1/people/${person.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          handle: cleanedHandle,
          avatarUrl: avatarUrl.trim() || null,
          profileUrl: profileUrl.trim() || null,
          publicationUrl: publicationUrl.trim() || null,
          substackProfileId: substackProfileId.trim() || null,
          relationshipStatus: relationshipStatus || "active",
          isFollower,
          isFollowing,
          isSubscriber,
          isSubscribedTo,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.error || "Failed to update contact profile")
      }

      const updated: Person = {
        ...person,
        ...data.person,
        name: trimmedName,
        handle: cleanedHandle,
        avatarUrl: avatarUrl.trim() || null,
        profileUrl: profileUrl.trim() || null,
        publicationUrl: publicationUrl.trim() || null,
        substackProfileId: substackProfileId.trim() || null,
        relationshipStatus,
        isFollower,
        isFollowing,
        isSubscriber,
        isSubscribedTo,
      }

      onPersonUpdated(updated)
      setSuccessNotice(true)
      setTimeout(() => {
        onOpenChange(false)
      }, 500)
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-lg rounded-md bg-white dark:bg-stone-900 shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden flex flex-col max-h-[90vh] p-0 gap-0"
        showCloseButton={false}
      >
        {/* Modal Header */}
        <div className="p-3.5 pb-3 border-b border-stone-200/80 dark:border-stone-800 flex items-center justify-between bg-stone-50/70 dark:bg-stone-950/40">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded bg-orange-100 text-[#f15a3a] dark:bg-orange-950/60">
              <UserCog className="size-3.5" />
            </span>
            <div>
              <DialogTitle className="font-bold text-stone-900 dark:text-stone-100 text-sm">
                Edit Contact Profile
              </DialogTitle>
              <DialogDescription className="text-xs text-stone-500 dark:text-stone-400">
                Update account handle, Substack links, and profile details.
              </DialogDescription>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="p-1 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 dark:hover:text-stone-200 dark:hover:bg-stone-800 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-3.5 space-y-3 text-xs">
          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/60 text-xs">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <fieldset className="rounded border border-stone-200 bg-stone-50/70 p-2.5 dark:border-stone-800 dark:bg-stone-950/40">
            <legend className="px-1 text-[11px] font-bold text-stone-800 dark:text-stone-200">
              Substack relationship
            </legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {[
                ["Follows you", isFollower, setIsFollower],
                ["You follow", isFollowing, setIsFollowing],
                ["Subscribed to you", isSubscriber, setIsSubscriber],
                ["You subscribe", isSubscribedTo, setIsSubscribedTo],
              ].map(([label, checked, setChecked]) => (
                <label key={String(label)} className="flex cursor-pointer items-center gap-2 rounded border border-stone-200 bg-white px-2.5 py-1.5 font-medium dark:border-stone-800 dark:bg-stone-900 text-xs">
                  <input
                    type="checkbox"
                    checked={Boolean(checked)}
                    onChange={(event) => (setChecked as (value: boolean) => void)(event.target.checked)}
                    className="size-3.5 accent-stone-900 rounded"
                  />
                  {label as string}
                </label>
              ))}
            </div>
          </fieldset>

          {/* Name & Handle Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Full Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-stone-400" />
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Adam Smith"
                  className="pl-8 text-xs h-8.5 bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800"
                  autoFocus={initialFocus === "name"}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Substack Handle
              </label>
              <div className="relative">
                <AtSign className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-stone-400" />
                <Input
                  value={handle}
                  onChange={(e) => {
                    const val = e.target.value
                    if (!val) {
                      setHandle("")
                    } else if (val.startsWith("@")) {
                      setHandle(val)
                    } else {
                      setHandle(`@${val}`)
                    }
                  }}
                  placeholder="@username"
                  className="pl-8 text-xs h-8.5 font-mono bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800"
                  autoFocus={initialFocus === "handle"}
                />
              </div>
              <span className="text-[10px] text-muted-foreground mt-0.5 block">
                Normalized without @ in database
              </span>
            </div>
          </div>

          {/* Avatar URL with live preview */}
          <div>
            <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
              Avatar Image URL
            </label>
            <div className="flex items-center gap-3">
              <Avatar className="size-10 border border-stone-200 dark:border-stone-800 shrink-0">
                <AvatarImage src={avatarUrl.trim() || undefined} alt={name} referrerPolicy="no-referrer" />
                <AvatarFallback className="bg-stone-100 text-stone-700 font-bold text-xs dark:bg-stone-800 dark:text-stone-300">
                  {initials(name || "U")}
                </AvatarFallback>
              </Avatar>
              <div className="relative flex-1">
                <ImageIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-stone-400" />
                <Input
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://substackcdn.com/image/fetch/..."
                  className="pl-8 text-xs h-8.5 bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800"
                />
              </div>
            </div>
          </div>

          {/* Substack Links Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Profile URL
              </label>
              <div className="relative">
                <ExternalLink className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-stone-400" />
                <Input
                  value={profileUrl}
                  onChange={(e) => setProfileUrl(e.target.value)}
                  placeholder="https://substack.com/@username"
                  className="pl-8 text-xs h-8.5 bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Publication URL
              </label>
              <div className="relative">
                <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-stone-400" />
                <Input
                  value={publicationUrl}
                  onChange={(e) => setPublicationUrl(e.target.value)}
                  placeholder="https://newsletter.substack.com"
                  className="pl-8 text-xs h-8.5 bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800"
                />
              </div>
            </div>
          </div>

          {/* Substack Profile ID & Relationship Status Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Substack Profile ID
              </label>
              <div className="relative">
                <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-stone-400" />
                <Input
                  value={substackProfileId}
                  onChange={(e) => setSubstackProfileId(e.target.value)}
                  placeholder="e.g. 19284712"
                  className="pl-8 text-xs h-8.5 font-mono bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800"
                />
              </div>
              <span className="text-[10px] text-muted-foreground mt-0.5 block">
                Stable upstream identity identifier
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Relationship Status
              </label>
              <Select value={relationshipStatus} onValueChange={setRelationshipStatus}>
                <SelectTrigger className="h-8.5 text-xs bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800">
                  <div className="flex items-center gap-1.5">
                    <Activity className="size-3.5 text-stone-400" />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent className="text-xs">
                  <SelectItem value="active">Active Relationship</SelectItem>
                  <SelectItem value="new">New Contact</SelectItem>
                  <SelectItem value="reach-out">Needs Reach Out</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                  <SelectItem value="conversation">In Conversation</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="pt-3 border-t border-stone-200/80 dark:border-stone-800 flex items-center justify-between">
            <div>
              {successNotice && (
                <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                  <Check className="size-3.5" /> Saved!
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => onOpenChange(false)}
                className="text-xs rounded h-7 px-3"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saving || !name.trim()}
                className="text-xs font-semibold bg-[#191817] hover:bg-[#302e2c] text-white rounded shadow-xs h-7 px-3.5"
              >
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
