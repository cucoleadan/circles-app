import type { Person } from "./types"

export function profileUrlForPerson(person: Pick<Person, "profileUrl" | "handle">): string | null {
  if (person.profileUrl) return person.profileUrl
  const handle = person.handle?.trim().replace(/^@/, "")
  return handle && /^[a-z0-9._-]+$/i.test(handle)
    ? `https://substack.com/@${encodeURIComponent(handle)}`
    : null
}
