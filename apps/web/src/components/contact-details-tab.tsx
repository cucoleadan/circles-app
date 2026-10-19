import { Edit2, ExternalLink, Globe, User } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Separator } from "@workspace/ui/components/separator"
import type { ListRecord, Person, TagRecord } from "../lib/types"
import { profileUrlForPerson } from "../lib/profile-url"
import { ContactListsEditor } from "./contact-details/contact-lists-editor"
import { ContactNotesEditor } from "./contact-details/contact-notes-editor"
import { ContactTagsEditor } from "./contact-details/contact-tags-editor"
import { formatShortDate as formatDate } from "../lib/date-format"


export function ContactDetailsTab({
  person,
  allLists,
  allTags,
  onPersonUpdated,
  onCreateList,
  onOpenEditProfile,
}: {
  person: Person
  allLists: ListRecord[]
  allTags: TagRecord[]
  onPersonUpdated: (updated: Person) => void
  onCreateList?: (name: string) => Promise<ListRecord | void>
  onOpenEditProfile?: () => void
}) {
  const profileUrl = profileUrlForPerson(person)
  return (
    <div className="space-y-3">
      {/* Private Notes */}
      <ContactNotesEditor person={person} onPersonUpdated={onPersonUpdated} />

      <Separator />

      {/* Lists Section */}
      <ContactListsEditor
        person={person}
        allLists={allLists}
        onPersonUpdated={onPersonUpdated}
        onCreateList={onCreateList}
      />

      <Separator />

      {/* Tags Section */}
      <ContactTagsEditor
        person={person}
        allTags={allTags}
        onPersonUpdated={onPersonUpdated}
      />

      <Separator />

      {/* Profile & Substack Identity */}
      <div className="space-y-2 rounded border border-stone-200/80 bg-white/70 p-2.5 dark:border-stone-800 dark:bg-stone-900/40">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
            <User className="size-3.5 text-stone-500" /> Profile &amp; Substack Info
          </h4>
          {onOpenEditProfile && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenEditProfile}
              className="h-6.5 text-[10.5px] px-2 gap-1 rounded border-stone-200 dark:border-stone-700 hover:text-[#f15a3a]"
            >
              <Edit2 className="size-3 text-[#f15a3a]" /> Edit Profile
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="rounded bg-stone-50/80 dark:bg-stone-950/40 p-2 border border-stone-100 dark:border-stone-800/80">
            <span className="text-muted-foreground block text-[10px] uppercase font-semibold tracking-wider">
              Substack Handle
            </span>
            <div className="mt-0.5 font-mono text-stone-800 dark:text-stone-200 truncate">
              {person.handle ? (
                profileUrl ? (
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[#f15a3a] hover:underline"
                    title={`Open @${person.handle} on Substack`}
                  >
                    @{person.handle}
                  </a>
                ) : `@${person.handle}`
              ) : (
                <span className="text-muted-foreground italic font-sans">None set</span>
              )}
            </div>
          </div>

          <div className="rounded bg-stone-50/80 dark:bg-stone-950/40 p-2 border border-stone-100 dark:border-stone-800/80">
            <span className="text-muted-foreground block text-[10px] uppercase font-semibold tracking-wider">
              Substack Profile ID
            </span>
            <div className="mt-0.5 font-mono text-stone-800 dark:text-stone-200 truncate">
              {person.substackProfileId || (
                <span className="text-muted-foreground italic font-sans">None</span>
              )}
            </div>
          </div>

          <div className="rounded bg-stone-50/80 dark:bg-stone-950/40 p-2 border border-stone-100 dark:border-stone-800/80">
            <span className="text-muted-foreground block text-[10px] uppercase font-semibold tracking-wider">
              Profile URL
            </span>
            <div className="mt-0.5 truncate">
              {profileUrl ? (
                <a
                  href={profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-stone-700 dark:text-stone-300 hover:text-[#f15a3a] inline-flex items-center gap-1"
                >
                  <span className="truncate max-w-[180px]">{profileUrl}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : (
                <span className="text-muted-foreground italic">None</span>
              )}
            </div>
          </div>

          <div className="rounded bg-stone-50/80 dark:bg-stone-950/40 p-2 border border-stone-100 dark:border-stone-800/80">
            <span className="text-muted-foreground block text-[10px] uppercase font-semibold tracking-wider">
              Publication URL
            </span>
            <div className="mt-0.5 truncate">
              {person.publicationUrl ? (
                <a
                  href={person.publicationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-stone-700 dark:text-stone-300 hover:text-[#f15a3a] inline-flex items-center gap-1"
                >
                  <Globe className="size-3 shrink-0 text-stone-400" />
                  <span className="truncate max-w-[170px]">{person.publicationUrl}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : (
                <span className="text-muted-foreground italic">None</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* Relationship Timestamps */}
      <div className="space-y-2 rounded border border-stone-200/80 bg-white/60 p-2.5 dark:border-stone-800 dark:bg-stone-900/40">
        <h4 className="text-xs font-semibold text-stone-700 dark:text-stone-300">
          Key Timestamps
        </h4>
        <div className="grid grid-cols-2 gap-2.5 text-xs">
          <div>
            <span className="text-muted-foreground block text-[10.5px]">First Contact</span>
            <span className="font-medium text-stone-800 dark:text-stone-200">
              {formatDate(person.firstInteractedAt || person.createdAt)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10.5px]">Last Conversation</span>
            <span className="font-medium text-stone-800 dark:text-stone-200">
              {formatDate(person.lastConversationAt)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10.5px]">Last Inbound (From them)</span>
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              {formatDate(person.lastInboundAt)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10.5px]">Last Outbound (You)</span>
            <span className="font-medium text-sky-700 dark:text-sky-400">
              {formatDate(person.lastOutboundAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
