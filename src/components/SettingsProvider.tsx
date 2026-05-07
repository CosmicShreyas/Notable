import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { listCalendarEvents, updateUserPreferences } from "../lib/api";
import { useAuth } from "./AuthProvider";

type ShareVisibility = "team" | "link" | "private";
type TranscriptRetention = "off" | "5d" | "10d" | "30d" | "60d" | "90d";
type SummaryStyle = "concise" | "balanced" | "detailed";
type TranscriptionLanguage = "auto" | "en" | "hi";

type SettingsContextValue = {
  liveIndicator: boolean;
  setLiveIndicator: (value: boolean) => void;
  showConsentNudge: boolean;
  setShowConsentNudge: (value: boolean) => void;
  desktopAlerts: boolean;
  setDesktopAlerts: (value: boolean) => Promise<void>;
  notificationPermission: NotificationPermission | "unsupported";
  improveModels: boolean;
  setImproveModels: (value: boolean) => Promise<void>;
  emailSummarySnapshots: boolean;
  setEmailSummarySnapshots: (value: boolean) => Promise<void>;
  linkSharing: ShareVisibility;
  setLinkSharing: (value: ShareVisibility) => Promise<void>;
  retention: TranscriptRetention;
  setRetention: (value: TranscriptRetention) => Promise<void>;
  summaryStyle: SummaryStyle;
  setSummaryStyle: (value: SummaryStyle) => void;
  transcriptionLanguage: TranscriptionLanguage;
  setTranscriptionLanguage: (value: TranscriptionLanguage) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

const STORAGE_KEYS = {
  liveIndicator: "settings.live-indicator",
  showConsentNudge: "settings.show-consent-nudge",
  desktopAlerts: "settings.desktop-alerts",
  summaryStyle: "settings.summary-style",
  transcriptionLanguage: "settings.transcription-language",
  notificationHistory: "settings.notification-history",
} as const;

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { user, token, refreshUser } = useAuth();
  const [liveIndicator, setLiveIndicator] = useStoredBoolean(STORAGE_KEYS.liveIndicator, true);
  const [showConsentNudge, setShowConsentNudge] = useStoredBoolean(STORAGE_KEYS.showConsentNudge, true);
  const [desktopAlertsEnabled, setDesktopAlertsEnabled] = useStoredBoolean(STORAGE_KEYS.desktopAlerts, false);
  const [improveModels, setImproveModelsValue] = useState(false);
  const [emailSummarySnapshots, setEmailSummarySnapshotsValue] = useState(true);
  const [linkSharing, setLinkSharingValue] = useState<ShareVisibility>("link");
  const [retention, setRetentionValue] = useState<TranscriptRetention>("off");
  const [summaryStyle, setSummaryStyle] = useStoredEnum<SummaryStyle>(STORAGE_KEYS.summaryStyle, "balanced");
  const [transcriptionLanguage, setTranscriptionLanguage] = useStoredEnum<TranscriptionLanguage>(
    STORAGE_KEYS.transcriptionLanguage,
    "auto",
  );
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(
    getNotificationPermission(),
  );

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const syncPermission = () => setNotificationPermission(Notification.permission);
    syncPermission();
    window.addEventListener("focus", syncPermission);
    return () => window.removeEventListener("focus", syncPermission);
  }, []);

  useEffect(() => {
    if (!desktopAlertsEnabled) return;
    if (notificationPermission !== "granted") return;
    if (!user || !token) return;

    let cancelled = false;

    const checkUpcomingMeetings = async () => {
      try {
        const { events } = await listCalendarEvents();
        if (cancelled) return;
        dispatchMeetingNotifications(events);
      } catch {
        // Silent fallback; calendar fetches can fail transiently.
      }
    };

    void checkUpcomingMeetings();
    const intervalId = window.setInterval(() => {
      void checkUpcomingMeetings();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [desktopAlertsEnabled, notificationPermission, token, user]);

  useEffect(() => {
    setRetentionValue(mapRetentionDaysToValue(user?.transcript_retention_days ?? null));
  }, [user?.transcript_retention_days]);

  useEffect(() => {
    setImproveModelsValue(Boolean(user?.allow_anonymized_summary_samples));
  }, [user?.allow_anonymized_summary_samples]);

  useEffect(() => {
    setEmailSummarySnapshotsValue(user?.email_summary_snapshots ?? true);
  }, [user?.email_summary_snapshots]);

  useEffect(() => {
    const nextValue = user?.default_link_sharing;
    if (nextValue === "team" || nextValue === "link" || nextValue === "private") {
      setLinkSharingValue(nextValue);
    }
  }, [user?.default_link_sharing]);

  const setDesktopAlerts = async (value: boolean) => {
    if (!value) {
      setDesktopAlertsEnabled(false);
      return;
    }

    const permission = await requestNotificationPermission();
    setNotificationPermission(permission);
    setDesktopAlertsEnabled(permission === "granted");
  };

  const setRetention = async (value: TranscriptRetention) => {
    const previous = retention;
    setRetentionValue(value);
    try {
      await updateUserPreferences({
        transcript_retention_days: mapRetentionValueToDays(value),
        allow_anonymized_summary_samples: improveModels,
        email_summary_snapshots: emailSummarySnapshots,
      });
      await refreshUser();
    } catch {
      setRetentionValue(previous);
      throw new Error("Unable to update transcript retention");
    }
  };

  const setImproveModels = async (value: boolean) => {
    const previous = improveModels;
    setImproveModelsValue(value);
    try {
      await updateUserPreferences({
        transcript_retention_days: mapRetentionValueToDays(retention),
        allow_anonymized_summary_samples: value,
        email_summary_snapshots: emailSummarySnapshots,
      });
      await refreshUser();
    } catch {
      setImproveModelsValue(previous);
      throw new Error("Unable to update anonymized sample preference");
    }
  };

  const setEmailSummarySnapshots = async (value: boolean) => {
    const previous = emailSummarySnapshots;
    setEmailSummarySnapshotsValue(value);
    try {
      await updateUserPreferences({
        transcript_retention_days: mapRetentionValueToDays(retention),
        allow_anonymized_summary_samples: improveModels,
        email_summary_snapshots: value,
      });
      await refreshUser();
    } catch {
      setEmailSummarySnapshotsValue(previous);
      throw new Error("Unable to update summary snapshot email preference");
    }
  };

  const setLinkSharing = async (value: ShareVisibility) => {
    const previous = linkSharing;
    setLinkSharingValue(value);
    try {
      await updateUserPreferences({
        default_link_sharing: value,
        transcript_retention_days: mapRetentionValueToDays(retention),
        allow_anonymized_summary_samples: improveModels,
        email_summary_snapshots: emailSummarySnapshots,
      });
      await refreshUser();
    } catch {
      setLinkSharingValue(previous);
      throw new Error("Unable to update default link sharing");
    }
  };

  const contextValue = useMemo<SettingsContextValue>(
    () => ({
      liveIndicator,
      setLiveIndicator,
      showConsentNudge,
      setShowConsentNudge,
      desktopAlerts: desktopAlertsEnabled,
      setDesktopAlerts,
      notificationPermission,
      improveModels,
      setImproveModels,
      emailSummarySnapshots,
      setEmailSummarySnapshots,
      linkSharing,
      setLinkSharing,
      retention,
      setRetention,
      summaryStyle,
      setSummaryStyle,
      transcriptionLanguage,
      setTranscriptionLanguage,
    }),
    [
      liveIndicator,
      showConsentNudge,
      desktopAlertsEnabled,
      notificationPermission,
      improveModels,
      emailSummarySnapshots,
      linkSharing,
      retention,
      summaryStyle,
      transcriptionLanguage,
    ],
  );

  return <SettingsContext.Provider value={contextValue}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used inside SettingsProvider");
  }
  return context;
}

function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.requestPermission();
}

function useStoredBoolean(key: string, defaultValue: boolean) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    const stored = localStorage.getItem(key);
    if (stored === "true") setValue(true);
    if (stored === "false") setValue(false);
  }, [key]);

  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);

  return [value, setValue] as const;
}

function useStoredEnum<T extends string>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(defaultValue);

  useEffect(() => {
    const stored = localStorage.getItem(key) as T | null;
    if (stored) setValue(stored);
  }, [key]);

  useEffect(() => {
    localStorage.setItem(key, value);
  }, [key, value]);

  return [value, setValue] as const;
}

function dispatchMeetingNotifications(
  events: {
    id: string;
    title: string;
    start?: string | null;
    join_url?: string | null;
    provider: string;
  }[],
) {
  if (typeof window === "undefined" || !("Notification" in window)) return;

  const history = readNotificationHistory();
  const nextHistory = { ...history };
  const now = Date.now();

  for (const event of events) {
    if (!event.start) continue;
    const startTime = new Date(event.start).getTime();
    if (Number.isNaN(startTime)) continue;

    const minutesUntilStart = Math.round((startTime - now) / 60_000);
    const eventKey = event.id || `${event.title}-${event.start}`;
    const reminderKey = `${eventKey}:10m`;
    const liveKey = `${eventKey}:live`;

    if (minutesUntilStart <= 10 && minutesUntilStart > 1 && !nextHistory[reminderKey]) {
      showMeetingNotification(
        `${event.title} starts soon`,
        `${event.title} starts in ${minutesUntilStart} minutes.${event.join_url ? " Tap to open the join link." : ""}`,
        event.join_url,
      );
      nextHistory[reminderKey] = now;
    }

    if (minutesUntilStart <= 1 && minutesUntilStart >= -5 && !nextHistory[liveKey]) {
      showMeetingNotification(
        `${event.title} is starting now`,
        event.join_url
          ? `Your meeting is starting. Tap to open the join link.`
          : `Your meeting is starting now.`,
        event.join_url,
      );
      nextHistory[liveKey] = now;
    }
  }

  for (const [key, timestamp] of Object.entries(nextHistory)) {
    if (now - timestamp > 24 * 60 * 60 * 1000) {
      delete nextHistory[key];
    }
  }

  localStorage.setItem(STORAGE_KEYS.notificationHistory, JSON.stringify(nextHistory));
}

function showMeetingNotification(title: string, body: string, joinUrl?: string | null) {
  const notification = new Notification(title, {
    body,
    tag: `${title}:${body}`,
    silent: false,
  });

  if (joinUrl) {
    notification.onclick = () => {
      window.focus();
      window.open(joinUrl, "_blank", "noopener,noreferrer");
      notification.close();
    };
  }
}

function readNotificationHistory(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.notificationHistory);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function mapRetentionDaysToValue(days: number | null): TranscriptRetention {
  switch (days) {
    case 5:
      return "5d";
    case 10:
      return "10d";
    case 30:
      return "30d";
    case 60:
      return "60d";
    case 90:
      return "90d";
    default:
      return "off";
  }
}

function mapRetentionValueToDays(value: TranscriptRetention): number | null {
  switch (value) {
    case "5d":
      return 5;
    case "10d":
      return 10;
    case "30d":
      return 30;
    case "60d":
      return 60;
    case "90d":
      return 90;
    default:
      return null;
  }
}
