import { Fragment, useState } from "react";
import { ArrowUpRight, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  CommunityActionResult,
  CommunityContentNote,
  CommunityContentNoteImage,
  CommunityContentPost,
  CommunityContentProfile,
  CommunityEngagement,
  CommunityPerson,
} from "./types";
import { NoteEngagement } from "./note-engagement";
import { formatNaturalRelativeTime, noteImageThumbnail, readableDate, relativeTime } from "./utils";
import { NoteDocumentView, NoteSharedContentCard } from "../notes/note-content-view";
import type { NoteSharedContent } from "../notes/note-content";

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function nameInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("en"))
    .join("");
}

export function ProfileAvatar({
  name,
  photoUrl,
  className,
}: {
  name: string;
  photoUrl?: string | null;
  className?: string;
}) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-muted font-semibold text-muted-foreground",
        className,
      )}
    >
      {nameInitials(name)}
    </span>
  );
}

export function NoteIdentity({
  person,
  profile,
  showListBadges = true,
}: {
  person?: CommunityPerson;
  profile: Pick<CommunityContentProfile, "name" | "photoUrl"> & { handle: string | null };
  showListBadges?: boolean;
}) {
  const name = profile.name ?? person?.name ?? profile.handle ?? "Your publication";
  const identity = person ? (
    <Link
      to={`/app/community/${person.id}`}
      className="block truncate text-sm font-semibold decoration-primary/40 underline-offset-4 hover:underline"
    >
      {name}
    </Link>
  ) : (
    <p className="truncate text-sm font-semibold">{name}</p>
  );

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ProfileAvatar
        name={name}
        photoUrl={profile.photoUrl}
        className="size-9 text-sm"
      />
      <div className="min-w-0 leading-tight">
        <div className="flex flex-wrap items-center gap-1.5">
          {identity}
          {showListBadges && person && person.lists && person.lists.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {person.lists.map((list) => (
                <span
                  key={list.id}
                  className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-secondary-foreground"
                >
                  {list.name}
                </span>
              ))}
            </div>
          )}
        </div>
        {profile.handle && <p className="truncate text-xs text-muted-foreground">@{profile.handle}</p>}
      </div>
    </div>
  );
}

function Timestamp({ value, className }: { value: string | null; className?: string }) {
  const label = relativeTime(value);
  if (!label) return null;
  return (
    <time
      className={cn("shrink-0 text-xs text-muted-foreground", className)}
      title={readableDate(value) ?? undefined}
    >
      {label}
    </time>
  );
}

function renderInline(text: string, keyPrefix: string) {
  return text.split(URL_PATTERN).map((part, index) => {
    if (!part.startsWith("http")) {
      return <Fragment key={`${keyPrefix}-${index}`}>{part}</Fragment>;
    }

    const url = part.replace(/[),.!?]+$/, "");
    const trailingPunctuation = part.slice(url.length);
    return (
      <Fragment key={`${keyPrefix}-${index}`}>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="break-all text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary"
        >
          {url}
        </a>
        {trailingPunctuation}
      </Fragment>
    );
  });
}

function NoteBody({ body }: { body: string }) {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div className="text-[15px] leading-6 text-foreground">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="mb-2.5 last:mb-0">
          {paragraph.split("\n").map((line, lineIndex) => (
            <Fragment key={lineIndex}>
              {lineIndex > 0 && <br />}
              {renderInline(line, `${index}-${lineIndex}`)}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

function NoteImages({
  images,
  noteLabel,
  onImageClick,
}: {
  images: CommunityContentNoteImage[];
  noteLabel: string;
  onImageClick?: (image: CommunityContentNoteImage) => void;
}) {
  const [expandedImage, setExpandedImage] = useState<CommunityContentNoteImage | null>(null);
  const visible = images.slice(0, 4);
  const hiddenCount = images.length - visible.length;

  function selectImage(image: CommunityContentNoteImage) {
    if (onImageClick) {
      onImageClick(image);
      return;
    }
    setExpandedImage((current) => current?.url === image.url ? null : image);
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {visible.map((image, index) => {
          const isExpanded = !onImageClick && expandedImage?.url === image.url;
          return (
            <button
              key={image.url}
              type="button"
              onClick={() => selectImage(image)}
              className={cn(
                "group relative size-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted sm:size-28",
                isExpanded && "ring-2 ring-ring ring-offset-2 ring-offset-card",
              )}
              aria-label={`${isExpanded ? "Collapse" : "Expand"} image ${index + 1} from ${noteLabel}`}
              aria-expanded={onImageClick ? undefined : isExpanded}
            >
            <img
              src={noteImageThumbnail(image.url)}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-opacity group-hover:opacity-90"
            />
            {index === visible.length - 1 && hiddenCount > 0 && (
              <span className="absolute inset-0 grid place-items-center bg-foreground/50 text-sm font-semibold text-background">
                +{hiddenCount}
              </span>
            )}
            </button>
          );
        })}
      </div>

      {expandedImage && !onImageClick && (
        <button
          type="button"
          onClick={() => setExpandedImage(null)}
          className="mt-3 block w-full overflow-hidden rounded-xl border border-border bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
          aria-label={`Collapse expanded image from ${noteLabel}`}
        >
          <img
            src={expandedImage.url}
            alt=""
            loading="lazy"
            decoding="async"
            className="max-h-[75vh] w-full object-contain"
          />
        </button>
      )}
    </div>
  );
}

function ReadOnlyNoteEngagement({
  note,
  openUrl,
}: {
  note: CommunityContentNote;
  openUrl: string | null;
}) {
  return (
    <div className="mt-4 flex items-center border-t border-border/60 pt-1.5 text-muted-foreground">
      <div className="-ml-2 flex items-center gap-0.5">
        <span className="inline-flex h-7 items-center gap-1.5 px-2 text-[0.8rem] tabular-nums">
          <Heart className="size-4" />
          {note.reactionCount ?? 0}
        </span>
        <span className="inline-flex h-7 items-center gap-1.5 px-2 text-[0.8rem] tabular-nums">
          <MessageCircle className="size-4" />
          {note.replyCount ?? 0}
        </span>
        <span className="inline-flex h-7 items-center gap-1.5 px-2 text-[0.8rem] tabular-nums">
          <Repeat2 className="size-4" />
          {note.restackCount ?? 0}
        </span>
      </div>
      {openUrl && (
        <Button asChild variant="ghost" size="sm" className="-mr-2 ml-auto px-2 text-muted-foreground hover:text-foreground">
          <a href={openUrl} target="_blank" rel="noreferrer">
            Substack <ArrowUpRight />
          </a>
        </Button>
      )}
    </div>
  );
}

export function formatEngagementSignal(lastEngagedAt: string | null): {
  text: string;
  lastEngagedText: string | null;
  status: "active" | "warning" | "none";
} {
  if (!lastEngagedAt) {
    return {
      text: "Never engaged",
      lastEngagedText: null,
      status: "none",
    };
  }
  const timestamp = Date.parse(lastEngagedAt);
  if (!Number.isFinite(timestamp)) {
    return {
      text: "Never engaged",
      lastEngagedText: null,
      status: "none",
    };
  }
  const naturalTime = formatNaturalRelativeTime(lastEngagedAt);
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);

  if (days < 5) {
    return {
      text: days === 0 ? "Engaged today" : days === 1 ? "Engaged yesterday" : `Engaged ${days}d ago`,
      lastEngagedText: naturalTime ? `Last engaged ${naturalTime}` : null,
      status: "active",
    };
  }

  return {
    text: `No engagement in ${days}d`,
    lastEngagedText: naturalTime ? `Last engaged ${naturalTime}` : null,
    status: "warning",
  };
}

export function formatEngagementAction(engagement: CommunityEngagement): string {
  const time = formatNaturalRelativeTime(engagement.createdAt) ?? "recently";
  switch (engagement.actionType) {
    case "like":
      return `❤️ You liked this ${time}`;
    case "comment":
      return `💬 You commented ${time}`;
    case "reply":
      return `💬 You replied ${time}`;
    case "restack":
      return `🔁 You restacked this ${time}`;
  }
}

export function NoteCard({
  note,
  person,
  profile,
  engagementPersonId,
  onImageClick,
  readOnly = false,
  collapsible = true,
  openUrl,
  metaLabel,
  engagementBadge,
  engagedBack,
}: {
  note: CommunityContentNote;
  person?: CommunityPerson;
  profile?: Pick<CommunityContentProfile, "name" | "photoUrl"> & { handle: string | null };
  engagementPersonId?: string;
  onImageClick?: (image: CommunityContentNoteImage) => void;
  readOnly?: boolean;
  collapsible?: boolean;
  openUrl?: string | null;
  metaLabel?: string;
  engagementBadge?: string;
  engagedBack?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = note.body.length > 260 || note.body.split("\n").length > 4;
  const showIdentity = Boolean(profile);
  const clipsContent = collapsible && !expanded && isLong;

  return (
    <Card>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          {showIdentity ? (
            <NoteIdentity person={person} profile={profile!} />
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {engagedBack && (
              <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
                💬 Replied back
              </span>
            )}
            {metaLabel ? (
              <span className="shrink-0 text-xs text-muted-foreground">{metaLabel}</span>
            ) : (
              <Timestamp value={note.createdAt} />
            )}
          </div>
        </div>

        {engagementBadge && (
          <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
            {engagementBadge}
          </div>
        )}

        <div className={cn("relative mt-3", clipsContent && "max-h-36 overflow-hidden")}>
          <NoteDocumentView document={note.document} />
          {clipsContent && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />
          )}
        </div>
        {collapsible && isLong && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="mt-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? "Show less" : "Read more"}
          </button>
        )}

        {note.images.length > 0 && (
          <NoteImages
            images={note.images}
            noteLabel={person ? `${person.name}'s note` : "this note"}
            onImageClick={onImageClick}
          />
        )}

        {note.sharedContent && <NoteSharedContentCard content={note.sharedContent} />}

        {readOnly ? (
          <ReadOnlyNoteEngagement note={note} openUrl={openUrl === undefined ? note.url : openUrl} />
        ) : (
          <NoteEngagement note={note} personId={engagementPersonId ?? person?.id} />
        )}
      </CardContent>
    </Card>
  );
}

export function PostCard({
  post,
  person,
  profile,
  className,
  engagementBadge,
  engagedBack,
  onRestack,
}: {
  post: CommunityContentPost;
  person?: CommunityPerson;
  profile?: CommunityContentProfile;
  className?: string;
  engagementBadge?: string;
  engagedBack?: boolean;
  onRestack?: (post: CommunityContentPost) => void;
}) {
  const showIdentity = Boolean(profile);
  const sharedContent: NoteSharedContent = {
    kind: "post",
    url: post.url,
    title: post.title,
    body: post.subtitle,
    imageUrl: post.coverImageUrl ?? null,
    authorName: profile?.name ?? person?.name ?? null,
    authorHandle: profile?.handle ?? person?.handle ?? null,
  };

  return (
    <Card className={className}>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          {showIdentity ? (
            <NoteIdentity person={person} profile={profile!} />
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {engagedBack && (
              <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
                💬 Replied back
              </span>
            )}
            <Timestamp value={post.publishedAt} />
          </div>
        </div>

        {engagementBadge && (
          <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
            {engagementBadge}
          </div>
        )}

        <NoteSharedContentCard content={sharedContent} />

        <div className="mt-4 flex items-center border-t border-border/60 pt-1.5 text-muted-foreground">
          <div className="-ml-2 flex items-center gap-0.5">
            {post.url ? (
              <a
                href={post.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[0.8rem] tabular-nums transition-colors hover:bg-accent hover:text-foreground"
                title="Like on Substack"
              >
                <Heart className="size-4" />
                {post.reactionCount ?? 0}
              </a>
            ) : (
              <span className="inline-flex h-7 items-center gap-1.5 px-2 text-[0.8rem] tabular-nums">
                <Heart className="size-4" />
                {post.reactionCount ?? 0}
              </span>
            )}

            {post.url ? (
              <a
                href={`${post.url}#comments`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[0.8rem] tabular-nums transition-colors hover:bg-accent hover:text-foreground"
                title="Comments on Substack"
              >
                <MessageCircle className="size-4" />
                {post.commentCount ?? 0}
              </a>
            ) : (
              <span className="inline-flex h-7 items-center gap-1.5 px-2 text-[0.8rem] tabular-nums">
                <MessageCircle className="size-4" />
                {post.commentCount ?? 0}
              </span>
            )}

            {onRestack ? (
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[0.8rem] tabular-nums transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => onRestack(post)}
                title="Restack post into a scheduled Note"
              >
                <Repeat2 className="size-4" />
                {post.restackCount ?? 0}
              </button>
            ) : (
              <span className="inline-flex h-7 items-center gap-1.5 px-2 text-[0.8rem] tabular-nums">
                <Repeat2 className="size-4" />
                {post.restackCount ?? 0}
              </span>
            )}
          </div>

          {post.url && (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="-mr-2 ml-auto px-2 text-muted-foreground hover:text-foreground"
            >
              <a href={post.url} target="_blank" rel="noreferrer">
                Substack <ArrowUpRight />
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
