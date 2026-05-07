import { useEffect, useState } from "react";
import { Copy, Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { createOrUpdateMeetingShare, getMeetingShare, type MeetingShare } from "../lib/api";
import { useSettings } from "./SettingsProvider";

type ShareVisibility = "team" | "link" | "private";

export function MeetingShareDialog({
  meetingId,
  open,
  onOpenChange,
}: {
  meetingId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { linkSharing } = useSettings();
  const [shareState, setShareState] = useState<MeetingShare | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !meetingId) return;

    let active = true;
    setLoading(true);
    setError(null);

    void getMeetingShare(meetingId)
      .then((share) => {
        if (active) {
          setShareState(share);
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "Unable to prepare share link");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [meetingId, open]);

  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  const updateVisibility = async (visibility: ShareVisibility) => {
    if (!meetingId) return;
    setLoading(true);
    setError(null);
    try {
      const share = await createOrUpdateMeetingShare(meetingId, { visibility });
      setShareState(share);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to update share visibility");
    } finally {
      setLoading(false);
    }
  };

  const copyShareLink = async () => {
    if (!shareState?.share_url) return;
    try {
      await navigator.clipboard.writeText(shareState.share_url);
      setCopied(true);
    } catch {
      setError("Unable to copy share link");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setCopied(false);
          setError(null);
        }
      }}
    >
      <DialogContent className="max-w-[calc(100vw-1.5rem)] rounded-2xl border-border bg-popover p-0 sm:max-w-lg">
        <div className="p-4 sm:p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="text-xl font-medium text-foreground/95 sm:text-2xl">
              Share this meeting
            </DialogTitle>
            <DialogDescription className="pt-2 text-sm leading-6 text-muted-foreground">
              Create a short share link for this meeting. The default visibility comes from your settings, and you can change it here anytime.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Visibility</div>
              <Select
                value={shareState?.visibility ?? linkSharing}
                onValueChange={(value) => void updateVisibility(value as ShareVisibility)}
                disabled={loading}
              >
                <SelectTrigger className="h-11 w-full bg-background/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">Team members only</SelectItem>
                  <SelectItem value="link">Anyone with the link</SelectItem>
                  <SelectItem value="private">Private link</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-xs leading-5 text-muted-foreground">
                {describeShareVisibility(shareState?.visibility ?? linkSharing)}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Short link</div>
              <div className="space-y-2 rounded-2xl border border-border bg-background/60 p-2">
                <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card/40 px-3 py-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card/60 text-foreground/75">
                    <Link2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-sm text-foreground/90"
                      title={shareState?.share_url ?? ""}
                    >
                      {shareState?.share_url ?? (loading ? "Preparing link..." : "")}
                    </div>
                  </div>
                </div>
                <div className="flex sm:justify-end">
                  <button
                    type="button"
                    onClick={() => void copyShareLink()}
                    disabled={!shareState?.share_url || loading}
                    className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 text-sm text-foreground/85 transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    <Copy className="h-4 w-4" />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            </div>

            {error && <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function describeShareVisibility(visibility: ShareVisibility) {
  if (visibility === "team") {
    return "Only accepted members of your Notable team can open this link.";
  }
  if (visibility === "private") {
    return "Only you can open this link. Anyone else who opens it will see a blocked-access screen.";
  }
  return "Anyone who has this link can open the shared meeting view.";
}
