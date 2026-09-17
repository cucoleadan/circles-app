import { useEffect } from "react";
import { ListPlus, LoaderCircle, Save, Trash2, UserPlus } from "lucide-react";
import { useFetcher } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CommunityRelationshipFields } from "./community-fields";
import {
  COMMUNITY_STATUSES,
  COMMUNITY_STATUS_LABELS,
  type CommunityActionResult,
  type CommunityList,
  type CommunityPerson,
  type CommunityTag,
} from "./types";

const selectClassName =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

function FormError({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {message}
    </div>
  );
}

export function PersonDialog({
  person,
  tags,
  lists,
  onClose,
  onDelete,
}: {
  person: CommunityPerson | null;
  tags: CommunityTag[];
  lists: CommunityList[];
  onClose: () => void;
  onDelete?: (person: CommunityPerson) => void;
}) {
  const fetcher = useFetcher<CommunityActionResult>();
  const intent = person ? "updatePerson" as const : "createPerson" as const;
  const busy = fetcher.state !== "idle";
  const error = fetcher.data && !fetcher.data.ok && fetcher.data.intent === intent
    ? fetcher.data.message
    : null;

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.intent === intent) onClose();
  }, [fetcher.data, intent, onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{person ? "Edit community member" : "Add someone to your Community"}</DialogTitle>
          <DialogDescription>
            Keep the relationship context you need—without turning your network into a spreadsheet.
          </DialogDescription>
        </DialogHeader>

        <fetcher.Form method="post" className="grid gap-5">
          <input type="hidden" name="intent" value={intent} />
          {person && <input type="hidden" name="personId" value={person.id} />}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">
              Name
              <Input
                name="name"
                required
                maxLength={80}
                autoComplete="name"
                placeholder="Alex Morgan"
                defaultValue={person?.name ?? ""}
                disabled={busy}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Substack handle
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">@</span>
                <Input
                  name="handle"
                  required
                  maxLength={80}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="alexwrites"
                  defaultValue={person?.handle ?? ""}
                  disabled={busy}
                  className="pl-7"
                />
              </div>
            </label>
          </div>

          <label className="grid gap-2 text-sm font-medium">
            Publication URL <span className="font-normal text-muted-foreground">(optional)</span>
            <Input
              name="publicationUrl"
              type="url"
              maxLength={500}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://yourpublication.substack.com"
              defaultValue={person?.publicationUrl ?? ""}
              disabled={busy}
            />
            <span className="text-xs font-normal text-muted-foreground">
              Add their newsletter homepage or custom publication domain.
            </span>
          </label>

          <label className="grid gap-2 text-sm font-medium sm:max-w-xs">
            Relationship status
            <select name="status" defaultValue={person?.status ?? ""} disabled={busy} className={selectClassName}>
              <option value="">No status</option>
              {COMMUNITY_STATUSES.map((status) => (
                <option key={status} value={status}>{COMMUNITY_STATUS_LABELS[status]}</option>
              ))}
            </select>
          </label>

          <CommunityRelationshipFields
            tags={tags}
            lists={lists}
            initialTags={person?.tags}
            initialLists={person?.lists}
            disabled={busy}
          />

          <label className="grid gap-2 text-sm font-medium">
            Private notes
            <Textarea
              name="notes"
              rows={5}
              maxLength={5_000}
              placeholder="How you met, what they write about, follow-up ideas, collaboration context…"
              defaultValue={person?.notes ?? ""}
              disabled={busy}
            />
            <span className="text-xs font-normal text-muted-foreground">Only visible inside your StackedHQ workspace.</span>
          </label>

          {error && <FormError message={error} />}

          <DialogFooter className="items-center sm:justify-between">
            {person && onDelete ? (
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  onClose();
                  onDelete(person);
                }}
              >
                <Trash2 />Delete
              </Button>
            ) : <span />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? <LoaderCircle className="animate-spin" /> : person ? <Save /> : <UserPlus />}
                {person ? "Save changes" : "Add person"}
              </Button>
            </div>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

export function CreateListDialog({ onClose }: { onClose: () => void }) {
  const fetcher = useFetcher<CommunityActionResult>();
  const busy = fetcher.state !== "idle";
  const error = fetcher.data && !fetcher.data.ok && fetcher.data.intent === "createList"
    ? fetcher.data.message
    : null;

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.intent === "createList") onClose();
  }, [fetcher.data, onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a community list</DialogTitle>
          <DialogDescription>Lists are curated groups you can filter and pin to your dashboard.</DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post" className="grid gap-4">
          <input type="hidden" name="intent" value="createList" />
          <label className="grid gap-2 text-sm font-medium">
            List name
            <Input name="name" required maxLength={50} placeholder="Potential collaborators" autoFocus disabled={busy} />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
            <Textarea name="description" rows={3} maxLength={200} placeholder="People I want to reach out to this month." disabled={busy} />
          </label>
          {error && <FormError message={error} />}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <ListPlus />}Create list
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

export function DeletePersonDialog({
  person,
  onClose,
}: {
  person: CommunityPerson;
  onClose: () => void;
}) {
  const fetcher = useFetcher<CommunityActionResult>();
  const busy = fetcher.state !== "idle";
  const error = fetcher.data && !fetcher.data.ok && fetcher.data.intent === "deletePerson"
    ? fetcher.data.message
    : null;

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.intent === "deletePerson") onClose();
  }, [fetcher.data, onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {person.name}?</DialogTitle>
          <DialogDescription>
            This permanently removes their profile, notes, tags, and list memberships from your Community.
          </DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post" className="grid gap-4">
          <input type="hidden" name="intent" value="deletePerson" />
          <input type="hidden" name="personId" value={person.id} />
          {error && <FormError message={error} />}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Keep person</Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}Remove permanently
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteListDialog({ list, onClose }: { list: CommunityList; onClose: () => void }) {
  const fetcher = useFetcher<CommunityActionResult>();
  const busy = fetcher.state !== "idle";
  const error = fetcher.data && !fetcher.data.ok && fetcher.data.intent === "deleteList"
    ? fetcher.data.message
    : null;

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.intent === "deleteList") onClose();
  }, [fetcher.data, onClose]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{list.name}”?</DialogTitle>
          <DialogDescription>
            People in this list remain in your Community. Only the list and its dashboard pin are removed.
          </DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post" className="grid gap-4">
          <input type="hidden" name="intent" value="deleteList" />
          <input type="hidden" name="listId" value={list.id} />
          {error && <FormError message={error} />}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}Delete list
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
