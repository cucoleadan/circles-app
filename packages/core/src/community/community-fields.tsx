import { useMemo, useState } from "react";
import { Check, ChevronDown, ListPlus, Plus, Tags, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  COMMUNITY_COLORS,
  type CommunityColor,
  type CommunityLabel,
  type CommunityList,
  type CommunityListOption,
  type CommunityTag,
} from "./types";

const MAX_TAGS = 8;

const COLOR_CLASSES: Record<CommunityColor, string> = {
  violet: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/25 dark:bg-violet-500/15 dark:text-violet-300",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-300",
  sky: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/15 dark:text-sky-300",
  rose: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/15 dark:text-rose-300",
  slate: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/25 dark:bg-slate-500/15 dark:text-slate-300",
};

export function communityColorClass(color: CommunityColor) {
  return COLOR_CLASSES[color];
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function colorForName(value: string): CommunityColor {
  const normalized = normalizeName(value);
  const index = [...normalized].reduce((total, character) => total + character.codePointAt(0)!, 0);
  return COMMUNITY_COLORS[index % COMMUNITY_COLORS.length];
}

function mergeTags(available: CommunityTag[], created: CommunityLabel[]) {
  const options = new Map<string, CommunityLabel>();
  for (const option of [...available, ...created]) options.set(normalizeName(option.name), option);
  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function CommunityTagSelector({
  available,
  initial,
  disabled,
}: {
  available: CommunityTag[];
  initial: CommunityLabel[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [created, setCreated] = useState<CommunityLabel[]>([]);
  const [selected, setSelected] = useState(initial);
  const options = useMemo(() => mergeTags(available, created), [available, created]);
  const normalizedQuery = normalizeName(query);
  const matches = options.filter((option) => normalizeName(option.name).includes(normalizedQuery));
  const exactMatch = options.find((option) => normalizeName(option.name) === normalizedQuery);

  function toggle(option: CommunityLabel) {
    const exists = selected.some((item) => normalizeName(item.name) === normalizeName(option.name));
    if (exists) {
      setSelected((current) => current.filter((item) => normalizeName(item.name) !== normalizeName(option.name)));
    } else if (selected.length < MAX_TAGS) {
      setSelected((current) => [...current, option]);
    }
  }

  function createTag() {
    const name = query.trim().replace(/\s+/g, " ");
    if (!name || name.length > 32) return;
    const option = exactMatch ?? {
      id: `new-tag:${normalizeName(name)}`,
      name,
      color: colorForName(name),
    };
    if (!exactMatch) setCreated((current) => [...current, option]);
    if (!selected.some((item) => normalizeName(item.name) === normalizeName(option.name)) && selected.length < MAX_TAGS) {
      setSelected((current) => [...current, option]);
    }
    setQuery("");
  }

  return (
    <div className="grid gap-2">
      {selected.map((tag) => <input key={tag.id} type="hidden" name="tags" value={tag.name} />)}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Tags</span>
        <span className="text-xs text-muted-foreground">{selected.length}/{MAX_TAGS}</span>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" disabled={disabled} className="h-9 w-full justify-between px-3 font-normal">
            <span className="inline-flex min-w-0 items-center gap-2">
              <Tags className="size-4 text-muted-foreground" />
              <span className="truncate">{selected.length ? `${selected.length} selected` : "Choose or create tags"}</span>
            </span>
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(22rem,var(--radix-popover-trigger-width))] p-2">
          <Input
            value={query}
            maxLength={32}
            autoComplete="off"
            placeholder="Search or create a tag…"
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                createTag();
              }
            }}
          />
          <div className="mt-1 max-h-52 overflow-y-auto py-1">
            {matches.map((option) => {
              const checked = selected.some((item) => normalizeName(item.name) === normalizeName(option.name));
              return (
                <button key={option.id} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted" onClick={() => toggle(option)}>
                  <span className={cn("size-2.5 rounded-full border", communityColorClass(option.color))} />
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  {checked && <Check className="size-4 text-violet-600" />}
                </button>
              );
            })}
            {normalizedQuery && !exactMatch && (
              <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-violet-700 hover:bg-violet-50" onClick={createTag}>
                <Plus className="size-4" />Create “{query.trim()}”
              </button>
            )}
            {!normalizedQuery && options.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">Create your first tag here.</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <Badge key={tag.id} variant="outline" className={cn("h-6 gap-1 pr-1", communityColorClass(tag.color))}>
              {tag.name}
              <button type="button" disabled={disabled} aria-label={`Remove ${tag.name}`} className="rounded-full p-0.5 hover:bg-foreground/10" onClick={() => toggle(tag)}>
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function CommunityListSelector({
  available,
  initial,
  disabled,
}: {
  available: CommunityList[];
  initial: CommunityListOption[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set(initial.map((list) => list.id)));

  function toggle(listId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
      return next;
    });
  }

  const selected = available.filter((list) => selectedIds.has(list.id));
  return (
    <div className="grid gap-2">
      {[...selectedIds].map((id) => <input key={id} type="hidden" name="lists" value={id} />)}
      <span className="text-sm font-medium">Lists</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" disabled={disabled || available.length === 0} className="h-9 w-full justify-between px-3 font-normal">
            <span className="inline-flex min-w-0 items-center gap-2">
              <ListPlus className="size-4 text-muted-foreground" />
              <span className="truncate">
                {available.length === 0 ? "Create a list first" : selected.length ? `${selected.length} selected` : "Add to lists"}
              </span>
            </span>
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(22rem,var(--radix-popover-trigger-width))] p-2">
          <div className="max-h-52 overflow-y-auto">
            {available.map((list) => (
              <button key={list.id} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted" onClick={() => toggle(list.id)}>
                <span className="min-w-0 flex-1 truncate">{list.name}</span>
                {selectedIds.has(list.id) && <Check className="size-4 text-violet-600" />}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((list) => <Badge key={list.id} variant="secondary">{list.name}</Badge>)}
        </div>
      )}
    </div>
  );
}

export function CommunityRelationshipFields({
  tags,
  lists,
  initialTags = [],
  initialLists = [],
  disabled = false,
}: {
  tags: CommunityTag[];
  lists: CommunityList[];
  initialTags?: CommunityLabel[];
  initialLists?: CommunityListOption[];
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-4 rounded-xl border border-border/80 bg-muted/20 p-4 sm:grid-cols-2">
      <CommunityTagSelector available={tags} initial={initialTags} disabled={disabled} />
      <CommunityListSelector available={lists} initial={initialLists} disabled={disabled} />
    </div>
  );
}
