import type { CommunityPerson } from "./types";

export type OrbitPreview = { id: string; direction: "inbound" | "outbound"; actionType: string; body: string | null; title: string | null; occurredAt: string; avatarUrl: string | null };
export type OrbitHistory = { total: number; inbound: number; outbound: number; comments: number; latestAt: string; savedAt: string; preview: OrbitPreview[] };
export type OrbitFilter = "all" | "conversations" | "inbound" | "outbound" | "empty";
export type OrbitSort = "active" | "recent" | "name";
export function selectOrbitPeople(people: CommunityPerson[], history: Record<string, OrbitHistory>, query: string, list: string, filter: OrbitFilter, sort: OrbitSort): CommunityPerson[] {
  const term = query.trim().toLocaleLowerCase("en");
  return people.filter((person) => {
    const saved = history[person.id];
    return (list === "all" || person.lists.some((item) => item.id === list)) &&
      (!term || [person.name, person.handle, person.notes, person.publicationUrl, ...person.tags.map((tag) => tag.name), ...person.lists.map((item) => item.name), ...(saved?.preview.flatMap((item) => [item.body, item.title]) ?? [])].some((value) => value?.toLocaleLowerCase("en").includes(term))) &&
      (filter === "all" || (filter === "conversations" && (saved?.comments ?? 0) > 0) || (filter === "inbound" && (saved?.inbound ?? 0) > 0) || (filter === "outbound" && (saved?.outbound ?? 0) > 0) || (filter === "empty" && !saved?.total));
  }).sort((a, b) => {
    const first = history[a.id]; const second = history[b.id];
    if (sort === "active") return (second?.total ?? 0) - (first?.total ?? 0) || a.name.localeCompare(b.name);
    if (sort === "recent") return (Date.parse(second?.latestAt ?? "") || 0) - (Date.parse(first?.latestAt ?? "") || 0) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
}

export function orbitExcerpt(value: string, length = 280): string {
  const clean = value.trim();
  return clean.length > length ? clean.slice(0, length).trimEnd() + "…" : clean;
}
