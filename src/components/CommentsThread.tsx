import { useEffect, useMemo, useState } from "react";
import { MessageSquarePlus, Send, Trash2, UserRound } from "lucide-react";

import { createComment, deleteComment, listComments, parseApiDate, type CommentItem } from "../lib/api";

type MentionablePerson = {
  id: string;
  email: string;
  full_name?: string | null;
};

type Props = {
  entityType: "note" | "action_item" | "task";
  entityId: string;
  entityLabel?: string | null;
  meetingId?: string | null;
  title?: string;
  defaultExpanded?: boolean;
  mentionablePeople?: MentionablePerson[];
};

export function CommentsThread({
  entityType,
  entityId,
  entityLabel,
  meetingId,
  title = "Comments",
  defaultExpanded = false,
  mentionablePeople = [],
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [loading, setLoading] = useState(defaultExpanded);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setLoading(true);
    void listComments({ entity_type: entityType, entity_id: entityId, meeting_id: meetingId })
      .then((response) => {
        if (!active) return;
        setComments(response.items);
        setError(null);
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : "Unable to load comments");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [entityId, entityType, expanded, meetingId]);

  const mentionQuery = useMemo(() => {
    const match = draft.match(/@([A-Za-z0-9._%+-]*)$/);
    return match ? match[1].toLowerCase() : null;
  }, [draft]);

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    return mentionablePeople
      .filter((person) => {
        const email = person.email.toLowerCase();
        const fullName = (person.full_name ?? "").toLowerCase();
        return email.includes(mentionQuery) || fullName.includes(mentionQuery);
      })
      .slice(0, 5);
  }, [mentionQuery, mentionablePeople]);

  const insertMention = (person: MentionablePerson) => {
    setDraft((current) => current.replace(/@([A-Za-z0-9._%+-]*)$/, `@${person.email} `));
  };

  const handleCreate = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const created = await createComment({
        entity_type: entityType,
        entity_id: entityId,
        body: draft,
        entity_label: entityLabel ?? undefined,
        meeting_id: meetingId ?? undefined,
      });
      setComments((current) => [...current, created]);
      setDraft("");
      setExpanded(true);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save comment");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    const previous = comments;
    setDeletingId(commentId);
    setComments((current) => current.filter((item) => item.id !== commentId));
    try {
      await deleteComment(commentId);
    } catch (nextError) {
      setComments(previous);
      setError(nextError instanceof Error ? nextError.message : "Unable to delete comment");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-[1.2rem] border border-border/70 bg-background/35">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-foreground/88">
          <MessageSquarePlus className="h-4 w-4" />
          {title}
        </div>
        <div className="rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground">
          {comments.length}
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-border/60 px-4 py-4">
          {error ? <div className="mb-3 rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}

          <div className="relative">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a comment and mention teammates with @email"
              className="min-h-[86px] w-full rounded-2xl border border-border bg-card/60 px-4 py-3 text-sm text-foreground outline-none transition focus:ring-1 focus:ring-foreground/20"
            />
            {mentionSuggestions.length ? (
              <div className="absolute left-3 top-full z-10 mt-2 w-[min(100%,22rem)] rounded-2xl border border-border bg-popover p-2 shadow-[var(--shadow-soft)]">
                {mentionSuggestions.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => insertMention(person)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm text-foreground/92">{person.full_name || person.email}</div>
                      <div className="truncate text-xs text-muted-foreground">{person.email}</div>
                    </div>
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Mention</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={saving || !draft.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {saving ? "Posting..." : "Post comment"}
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading comments...</div>
            ) : comments.length ? (
              comments.map((comment) => (
                <div key={comment.id} className="rounded-2xl border border-border/70 bg-card/55 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background/65 text-foreground/80">
                        <UserRound className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium text-foreground/92">{comment.author_name}</div>
                          <div className="text-xs text-muted-foreground">{formatCommentTime(comment.created_at)}</div>
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/86">
                          {renderMentionText(comment.body, comment.mentions)}
                        </div>
                      </div>
                    </div>

                    {comment.can_delete ? (
                      <button
                        type="button"
                        onClick={() => void handleDelete(comment.id)}
                        disabled={deletingId === comment.id}
                        className="rounded-full border border-border bg-background/55 p-2 text-foreground/70 transition hover:bg-accent disabled:opacity-50"
                        aria-label={`Delete comment from ${comment.author_name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-background/30 px-4 py-4 text-sm text-muted-foreground">
                No comments here yet.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderMentionText(
  value: string,
  mentions: { user_id: string; email: string; full_name?: string | null }[],
) {
  const mentionMap = new Map<string, string>();
  for (const mention of mentions) {
    mentionMap.set(`@${mention.email.toLowerCase()}`, `@${mention.full_name || mention.email}`);
    const localPart = mention.email.split("@", 1)[0]?.toLowerCase();
    if (localPart) {
      mentionMap.set(`@${localPart}`, `@${mention.full_name || mention.email}`);
    }
  }

  return value.split(/(@[A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)/g).map((part, index) => {
    if (/^@[A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?$/.test(part)) {
      const normalized = part.toLowerCase();
      const label = mentionMap.get(normalized) ?? part;
      return (
        <span
          key={`${part}-${index}`}
          className="rounded-md bg-emerald-500/12 px-1.5 py-0.5 font-medium text-emerald-300"
        >
          {label}
        </span>
      );
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function formatCommentTime(value: string) {
  return parseApiDate(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
