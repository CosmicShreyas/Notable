export const PENDING_CHAT_KEY = "notable.pending-chat";

export type PendingChatDraft = {
  text: string;
  source: "askbar" | "quick-action";
};

export function storePendingChatDraft(draft: PendingChatDraft) {
  sessionStorage.setItem(PENDING_CHAT_KEY, JSON.stringify(draft));
}

export function consumePendingChatDraft() {
  const raw = sessionStorage.getItem(PENDING_CHAT_KEY);
  if (!raw) return null;

  sessionStorage.removeItem(PENDING_CHAT_KEY);

  try {
    return JSON.parse(raw) as PendingChatDraft;
  } catch {
    return null;
  }
}
