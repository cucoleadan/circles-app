import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowUpRight,
  Heart,
  LoaderCircle,
  MessageCircle,
  Repeat2,
  Send,
} from "lucide-react";
import { useFetcher } from "react-router";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  CommunityActionResult,
  CommunityContentNote,
  CommunityNoteReply,
} from "./types";
import { readableDate, relativeTime } from "./utils";

const ACTION = "/app/community";

function ReplyBody({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = body.length > 240 || body.split("\n").length > 3;

  return (
    <>
      <p
        className={cn(
          "mt-0.5 whitespace-pre-wrap text-sm leading-6 text-foreground",
          !expanded && isLong && "line-clamp-3",
        )}
      >
        {body}
      </p>
      {isLong && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 mr-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </>
  );
}

function Reply({
  reply,
  onReply,
}: {
  reply: CommunityNoteReply;
  onReply: (reply: CommunityNoteReply) => void;
}) {
  const author = reply.authorName ?? reply.authorHandle ?? "Substack reader";
  const fullDate = readableDate(reply.createdAt);
  const meta = [
    reply.authorHandle ? `@${reply.authorHandle.replace(/^@/, "")}` : null,
    relativeTime(reply.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li>
      <div className="flex gap-2.5">
        {reply.authorPhotoUrl ? (
          <img
            src={reply.authorPhotoUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-7 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
            {author.slice(0, 1).toLocaleUpperCase("en")}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-5" title={fullDate ?? undefined}>
            <span className="font-medium text-foreground">{author}</span>{" "}
            {meta && <span className="text-muted-foreground">{meta}</span>}
          </p>
          <ReplyBody body={reply.body} />
          <button
            type="button"
            className="mt-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => onReply(reply)}
          >
            Reply
          </button>
        </div>
      </div>
      {reply.children.length > 0 && (
        <ul className="mt-3 ml-3.5 space-y-3 border-l border-border pl-4">
          {reply.children.map((child) => (
            <Reply key={child.id} reply={child} onReply={onReply} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function NoteEngagement({
  note,
  personId,
  className,
}: {
  note: CommunityContentNote;
  personId?: string;
  className?: string;
}) {
  const reactionFetcher = useFetcher<CommunityActionResult>();
  const commentFetcher = useFetcher<CommunityActionResult>();
  const repliesFetcher = useFetcher<CommunityActionResult>();
  const nestedReplyFetcher = useFetcher<CommunityActionResult>();
  const restackFetcher = useFetcher<CommunityActionResult>();
  const repliesRegionId = useId();
  const handledReaction = useRef<CommunityActionResult | null>(null);
  const handledComment = useRef<CommunityActionResult | null>(null);
  const handledNestedReply = useRef<CommunityActionResult | null>(null);
  const handledRestack = useRef<CommunityActionResult | null>(null);
  const [liked, setLiked] = useState(note.viewerHasLiked);
  const [reactionCount, setReactionCount] = useState(note.reactionCount);
  const [replyCount, setReplyCount] = useState(note.replyCount);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [commentStatus, setCommentStatus] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<CommunityNoteReply | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyStatus, setReplyStatus] = useState<string | null>(null);
  const [restackCount, setRestackCount] = useState(note.restackCount);
  const [restacked, setRestacked] = useState(false);
  const [restackStatus, setRestackStatus] = useState<string | null>(null);

  useEffect(() => {
    const result = reactionFetcher.data;
    if (
      !result ||
      handledReaction.current === result ||
      reactionFetcher.state !== "idle"
    ) {
      return;
    }
    handledReaction.current = result;

    if (
      result.ok &&
      result.intent === "setNoteReaction" &&
      result.noteId === note.id
    ) {
      setLiked(result.liked);
      setReactionCount(result.reactionCount);
    }
  }, [note.id, reactionFetcher.data, reactionFetcher.state]);

  useEffect(() => {
    const result = commentFetcher.data;
    if (!result || handledComment.current === result || commentFetcher.state !== "idle") {
      return;
    }
    handledComment.current = result;

    if (result.ok && result.intent === "commentOnNote" && result.noteId === note.id) {
      setComment("");
      setCommentStatus("Comment posted.");
      setReplyCount((count) => count === null ? null : count + 1);
      setRepliesOpen(true);
      repliesFetcher.submit(
        { intent: "loadNoteComments", noteId: note.id },
        { method: "post", action: ACTION },
      );
    }
  }, [
    commentFetcher.data,
    commentFetcher.state,
    note.id,
    repliesFetcher,
  ]);

  useEffect(() => {
    const result = nestedReplyFetcher.data;
    if (
      !result ||
      handledNestedReply.current === result ||
      nestedReplyFetcher.state !== "idle"
    ) {
      return;
    }
    handledNestedReply.current = result;

    if (
      result.ok &&
      result.intent === "replyToNoteComment" &&
      result.noteId === note.id
    ) {
      setReplyBody("");
      setReplyingTo(null);
      setReplyStatus("Reply posted.");
      setReplyCount((count) => count === null ? null : count + 1);
      setRepliesOpen(true);
      repliesFetcher.submit(
        { intent: "loadNoteComments", noteId: note.id },
        { method: "post", action: ACTION },
      );
    }
  }, [
    nestedReplyFetcher.data,
    nestedReplyFetcher.state,
    note.id,
    repliesFetcher,
  ]);

  useEffect(() => {
    const result = restackFetcher.data;
    if (!result || handledRestack.current === result || restackFetcher.state !== "idle") return;
    handledRestack.current = result;
    if (result.ok && result.intent === "restackNote" && result.noteId === note.id) {
      setRestacked(true);
      setRestackCount((count) => result.restackCount ?? (count === null ? null : count + 1));
      setRestackStatus("Note restacked.");
    }
  }, [note.id, restackFetcher.data, restackFetcher.state]);

  const pendingLikedValue = reactionFetcher.formData?.get("liked");
  const optimisticLiked =
    pendingLikedValue === "true"
      ? true
      : pendingLikedValue === "false"
        ? false
        : liked === true;
  const optimisticCount =
    reactionCount === null
      ? null
      : Math.max(
          0,
          reactionCount +
            (pendingLikedValue === "true" && liked !== true
              ? 1
              : pendingLikedValue === "false" && liked === true
                ? -1
                : 0),
        );
  const reactionBusy = reactionFetcher.state !== "idle";
  const commentBusy = commentFetcher.state !== "idle";
  const repliesBusy = repliesFetcher.state !== "idle";
  const nestedReplyBusy = nestedReplyFetcher.state !== "idle";
  const restackBusy = restackFetcher.state !== "idle";
  const repliesResult = repliesFetcher.data;
  const replies =
    repliesResult?.ok &&
    repliesResult.intent === "loadNoteComments" &&
    repliesResult.noteId === note.id
      ? repliesResult.replies
      : null;
  const visibleReplyCount = replies
    ? replies.comments.reduce(
        function countBranch(total, reply): number {
          return (
            total +
            1 +
            reply.children.reduce(countBranch, 0)
          );
        },
        0,
      ) + replies.moreComments
    : null;
  const displayedReplyCount =
    replyCount === null
      ? visibleReplyCount
      : visibleReplyCount === null
        ? replyCount
        : Math.max(replyCount, visibleReplyCount);
  const reactionError =
    !reactionBusy &&
    reactionFetcher.data &&
    !reactionFetcher.data.ok &&
    reactionFetcher.data.intent === "setNoteReaction"
      ? reactionFetcher.data.message
      : null;
  const commentError =
    !commentBusy &&
    commentFetcher.data &&
    !commentFetcher.data.ok &&
    commentFetcher.data.intent === "commentOnNote"
      ? commentFetcher.data.message
      : null;
  const repliesError =
    !repliesBusy &&
    repliesResult &&
    !repliesResult.ok &&
    repliesResult.intent === "loadNoteComments" &&
    repliesResult.noteId === note.id
      ? repliesResult.message
      : null;
  const nestedReplyError =
    !nestedReplyBusy &&
    nestedReplyFetcher.data &&
    !nestedReplyFetcher.data.ok &&
    nestedReplyFetcher.data.intent === "replyToNoteComment" &&
    nestedReplyFetcher.data.noteId === note.id
      ? nestedReplyFetcher.data.message
      : null;
  const restackError =
    !restackBusy &&
    restackFetcher.data &&
    !restackFetcher.data.ok &&
    restackFetcher.data.intent === "restackNote"
      ? restackFetcher.data.message
      : null;

  function toggleReaction() {
    handledReaction.current = reactionFetcher.data ?? null;
    reactionFetcher.submit(
      {
        intent: "setNoteReaction",
        noteId: note.id,
        liked: String(!optimisticLiked),
        noteUrl: note.url ?? "",
        noteBody: note.body ?? "",
        ...(personId ? { personId } : {}),
      },
      { method: "post", action: ACTION },
    );
  }

  function toggleReplies() {
    const nextOpen = !repliesOpen;
    setRepliesOpen(nextOpen);
    if (nextOpen && !replies && !repliesBusy) {
      repliesFetcher.submit(
        { intent: "loadNoteComments", noteId: note.id },
        { method: "post", action: ACTION },
      );
    }
  }

  function startReply(reply: CommunityNoteReply) {
    setRepliesOpen(true);
    setReplyingTo(reply);
    setReplyStatus(null);
  }

  function restackNote() {
    handledRestack.current = restackFetcher.data ?? null;
    setRestackStatus(null);
    restackFetcher.submit(
      {
        intent: "restackNote",
        noteId: note.id,
        noteUrl: note.url ?? "",
        noteBody: note.body ?? "",
        ...(personId ? { personId } : {}),
      },
      { method: "post", action: ACTION },
    );
  }

  const actionButtonClass =
    "gap-1.5 px-2 text-muted-foreground tabular-nums hover:text-foreground";

  return (
    <div className={cn("mt-4 border-t border-border/60 pt-1.5", className)}>
      <div className="flex items-center">
        <div className="-ml-2 flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={optimisticLiked}
            aria-label={optimisticLiked ? "Unlike this Note" : "Like this Note"}
            disabled={reactionBusy}
            onClick={toggleReaction}
            className={cn(
              actionButtonClass,
              optimisticLiked &&
                "text-rose-600 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-400",
            )}
          >
            {reactionBusy ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Heart className={cn(optimisticLiked && "fill-current")} />
            )}
            {optimisticCount !== null && <span>{optimisticCount}</span>}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={repliesOpen}
            aria-controls={repliesRegionId}
            aria-label="View replies and comments"
            onClick={toggleReplies}
            className={actionButtonClass}
          >
            {repliesBusy ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <MessageCircle />
            )}
            {displayedReplyCount !== null && (
              <span>{displayedReplyCount}</span>
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={restacked ? "Note restacked" : "Restack this Note"}
            aria-pressed={restacked}
            disabled={restackBusy || restacked}
            onClick={restackNote}
            className={cn(actionButtonClass, restacked && "text-emerald-600 dark:text-emerald-400")}
          >
            {restackBusy ? <LoaderCircle className="animate-spin" /> : <Repeat2 />}
            {restackCount !== null && <span>{restackCount}</span>}
          </Button>
        </div>
        {note.url && (
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="-mr-2 ml-auto px-2 text-muted-foreground hover:text-foreground"
          >
            <a href={note.url} target="_blank" rel="noreferrer">
              Substack <ArrowUpRight />
            </a>
          </Button>
        )}
      </div>

      {repliesOpen && (
        <div id={repliesRegionId} className="mt-3 space-y-4">
          <commentFetcher.Form
            method="post"
            action={ACTION}
            onSubmit={() => {
              handledComment.current = commentFetcher.data ?? null;
              setCommentStatus(null);
            }}
          >
            <input type="hidden" name="intent" value="commentOnNote" />
            <input type="hidden" name="noteId" value={note.id} />
            <input type="hidden" name="noteUrl" value={note.url ?? ""} />
            <input type="hidden" name="noteBody" value={note.body ?? ""} />
            {personId && <input type="hidden" name="personId" value={personId} />}
            <Textarea
              name="body"
              value={comment}
              onChange={(event) => setComment(event.currentTarget.value)}
              rows={2}
              maxLength={5_000}
              required
              disabled={commentBusy}
              placeholder="Write a comment…"
              aria-label="Comment"
              className="min-h-16 bg-background text-sm"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {comment.length.toLocaleString()} / 5,000
              </span>
              <Button type="submit" size="sm" disabled={commentBusy || !comment.trim()}>
                {commentBusy ? <LoaderCircle className="animate-spin" /> : <Send />}
                {commentBusy ? "Posting…" : "Post comment"}
              </Button>
            </div>
          </commentFetcher.Form>

          {replyingTo && (
            <nestedReplyFetcher.Form
              method="post"
              action={ACTION}
              className="rounded-lg border border-border bg-muted/40 p-3"
              onSubmit={() => {
                handledNestedReply.current = nestedReplyFetcher.data ?? null;
                setReplyStatus(null);
              }}
            >
              <input type="hidden" name="intent" value="replyToNoteComment" />
              <input type="hidden" name="noteId" value={note.id} />
              <input type="hidden" name="noteUrl" value={note.url ?? ""} />
              <input type="hidden" name="noteBody" value={note.body ?? ""} />
              {personId && <input type="hidden" name="personId" value={personId} />}
              <input
                type="hidden"
                name="parentCommentId"
                value={replyingTo.id}
              />
              <p className="mb-2 text-xs text-muted-foreground">
                Replying to{" "}
                <span className="font-medium text-foreground">
                  {replyingTo.authorName ??
                    replyingTo.authorHandle ??
                    "Substack reader"}
                </span>
              </p>
              <Textarea
                name="body"
                value={replyBody}
                onChange={(event) => setReplyBody(event.currentTarget.value)}
                rows={2}
                maxLength={5_000}
                required
                autoFocus
                disabled={nestedReplyBusy}
                placeholder="Write a reply…"
                aria-label="Reply"
                className="min-h-16 bg-background text-sm"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {replyBody.length.toLocaleString()} / 5,000
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={nestedReplyBusy}
                    onClick={() => {
                      setReplyingTo(null);
                      setReplyBody("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={nestedReplyBusy || !replyBody.trim()}
                  >
                    {nestedReplyBusy ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Send />
                    )}
                    {nestedReplyBusy ? "Posting…" : "Post reply"}
                  </Button>
                </div>
              </div>
            </nestedReplyFetcher.Form>
          )}

          {repliesBusy && !replies ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              Loading replies…
            </p>
          ) : repliesError ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-destructive">{repliesError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  repliesFetcher.submit(
                    { intent: "loadNoteComments", noteId: note.id },
                    { method: "post", action: ACTION },
                  )
                }
              >
                Try again
              </Button>
            </div>
          ) : replies && replies.comments.length > 0 ? (
            <>
              <ul className="space-y-4">
                {replies.comments.map((reply) => (
                  <Reply key={reply.id} reply={reply} onReply={startReply} />
                ))}
              </ul>
              {replies.moreComments > 0 && (
                <p className="text-xs text-muted-foreground">
                  {replies.moreComments.toLocaleString()} more{" "}
                  {replies.moreComments === 1 ? "reply is" : "replies are"} available
                  on Substack.
                </p>
              )}
            </>
          ) : replies ? (
            <p className="text-sm text-muted-foreground">No replies yet.</p>
          ) : null}
        </div>
      )}

      {(reactionError ||
        commentError ||
        nestedReplyError ||
        restackError ||
        commentStatus ||
        replyStatus ||
        restackStatus) && (
        <p
          className={cn(
            "mt-2 text-xs",
            reactionError || commentError || nestedReplyError || restackError
              ? "text-destructive"
              : "text-muted-foreground",
          )}
          role="status"
        >
          {reactionError ??
            commentError ??
            nestedReplyError ??
            restackError ??
            commentStatus ??
            replyStatus ??
            restackStatus}
        </p>
      )}
    </div>
  );
}
