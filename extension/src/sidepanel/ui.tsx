import type { ReactNode } from "react"
import type { Person } from "./api"

// Class strings copied from the web app's components (stone neutrals, #f15a3a accent).
export const card = "rounded-xl border border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900"
export const eyebrow = "text-[10px] font-semibold uppercase tracking-wider text-stone-500"
export const field = "h-8 w-full rounded-md border border-stone-200 bg-stone-50 px-2.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-stone-400/40 dark:border-stone-800 dark:bg-stone-950"
export const btnPrimary = "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-[#f15a3a] px-3 text-xs font-semibold text-white hover:bg-[#d94b2e] disabled:opacity-50"
export const btnOutline = "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-stone-200 bg-white px-3 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
export const iconBtn = "inline-flex size-7 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100"
export const pillIn = "rounded bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
export const pillOut = "rounded bg-sky-50 px-1.5 py-px text-[10px] font-semibold text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"

/** The Circles ring mark; light and dark files live in extension/icons. */
export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <>
      <img src="/icons/logo-light.svg" alt="Circles" className={`${className} dark:hidden`} />
      <img src="/icons/logo-dark.svg" alt="Circles" className={`${className} hidden dark:block`} />
    </>
  )
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?"
}

export function Avatar({ person, size = "size-8 text-[11px]" }: { person: Pick<Person, "name" | "avatarUrl">; size?: string }) {
  const box = `flex shrink-0 items-center justify-center overflow-hidden rounded border border-stone-200 bg-stone-100 font-bold text-stone-700 dark:border-stone-800 dark:bg-stone-800 dark:text-stone-300 ${size}`
  return person.avatarUrl
    ? <img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" className={box} />
    : <span className={box}>{initials(person.name)}</span>
}

export function timeAgo(value: string | null | undefined) {
  if (!value) return ""
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return days < 14 ? `${days}d` : `${Math.round(days / 7)}w`
}

const verbs: Record<string, [string, string]> = {
  // [past tense, joining word before the target]
  comment: ["commented", "on"],
  reply: ["replied", "to"],
  like: ["liked", ""],
  restack: ["restacked", ""],
  subscribe: ["subscribed", "to"],
  mention: ["mentioned", ""],
}
const targets: Record<string, string> = { note: "Note", post: "post", comment: "comment" }

/** "Replied to your Note", "You liked their post", or "Replied" when the target is unknown. */
export function describeAction(actionType: string | null | undefined, direction: string | null | undefined, targetType?: string | null) {
  const [verb, join] = verbs[actionType ?? ""] ?? ["interacted", "with"]
  const outbound = direction === "outbound"
  const target = targets[targetType ?? ""]
  const subject = outbound ? `You ${verb}` : verb[0]!.toUpperCase() + verb.slice(1)
  if (!target) return subject
  return [subject, join, outbound ? "their" : "your", target].filter(Boolean).join(" ")
}

export function PersonRow({ person, detail, trailing, onSelect }: {
  person: Person
  detail: ReactNode
  trailing?: ReactNode
  onSelect: (person: Person) => void
}) {
  return (
    <button type="button" onClick={() => onSelect(person)} className="flex w-full items-center gap-2.5 p-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-800/60">
      <Avatar person={person} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{person.name}</span>
        <span className="block truncate text-[11px] text-stone-500">{detail}</span>
      </span>
      {trailing}
    </button>
  )
}

export function Notice({ tone = "error", children }: { tone?: "error" | "ok"; children: ReactNode }) {
  return (
    <p className={`text-[11px] font-medium ${tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
      {children}
    </p>
  )
}
