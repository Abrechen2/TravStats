import { useState, useEffect, useRef, useId } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  notificationsApi,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
  type ReminderDomain,
  type ReminderDomainPrefs,
} from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import RemindersTable from "./RemindersTable";
import { applyPatch, mergePatch } from "./reminderPrefs";

/**
 * Reminders per domain, saved as they change.
 *
 * Round 4 (decision E10) removed the save button from settings: a control that
 * looks set but is not stored until a button further down is pressed was the
 * one way to lose a change here. A switch or chip writes at once; the address
 * writes when the field is left. The write model is the serialized one: one PUT
 * in flight, edits made meanwhile merge into a queued patch, `confirmed` is the
 * last snapshot the server answered. A failed write restores that snapshot and
 * the row it concerned says so and offers a retry.
 */
export default function NotificationPreferences(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const addToast = useToastStore((state) => state.addToast);
  const mailReasonId = useId();
  const appReasonId = useId();

  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "failed">("loading");
  const [drafts, setDrafts] = useState<Partial<Record<ReminderDomain, string>>>({});
  // The address as typed, until the field is left. Server answers must not overwrite it.
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<ReminderDomain>>(new Set());

  const confirmed = useRef<NotificationPreferences | null>(null);
  const inFlight = useRef(false);
  const queued = useRef<NotificationPreferencesPatch | null>(null);
  const sending = useRef<NotificationPreferencesPatch>({});
  // What each failed row tried to write, kept for its retry button.
  const failedPatch = useRef<Partial<Record<ReminderDomain, Partial<ReminderDomainPrefs>>>>({});

  const load = async (): Promise<void> => {
    setLoadState("loading");
    try {
      const data = await notificationsApi.getPreferences();
      confirmed.current = data;
      setPrefs(data);
      setLoadState("loaded");
    } catch (err) {
      // Not the defaults: showing "off" for switches that may be on, and then
      // saving over them, is the lie this state exists to avoid.
      setLoadState("failed");
      addToast("error", err instanceof Error ? err.message : t("settings:notifications.loadError"));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const send = async (patch: NotificationPreferencesPatch): Promise<void> => {
    inFlight.current = true;
    sending.current = patch;
    try {
      const updated = await notificationsApi.updatePreferences(patch);
      confirmed.current = updated;
      // Only adopt the response when no newer edit is waiting: it would
      // otherwise flip the control back until the next response lands.
      if (!queued.current) setPrefs(updated);
    } catch (error) {
      if (queued.current) {
        // Fields the newer edit does not override ride along, so they are retried.
        queued.current = mergePatch(patch, queued.current);
      } else {
        if (confirmed.current) setPrefs(confirmed.current);
        const rows = Object.keys(patch.domains ?? {}) as ReminderDomain[];
        for (const row of rows) failedPatch.current[row] = patch.domains?.[row];
        if (rows.length > 0) setFailed((prev) => new Set([...prev, ...rows]));
        addToast(
          "error",
          error instanceof Error ? error.message : t("settings:notifications.saveFailed")
        );
      }
    } finally {
      inFlight.current = false;
      sending.current = {};
      const next = queued.current;
      queued.current = null;
      if (next) void send(next);
    }
  };

  const save = (patch: NotificationPreferencesPatch): void => {
    setPrefs((current) => (current ? applyPatch(current, patch) : current));
    if (inFlight.current) {
      queued.current = mergePatch(queued.current, patch);
      return;
    }
    void send(patch);
  };

  const changeDomain = (domain: ReminderDomain, change: Partial<ReminderDomainPrefs>): void => {
    setFailed((prev) => {
      if (!prev.has(domain)) return prev;
      const next = new Set(prev);
      next.delete(domain);
      return next;
    });
    delete failedPatch.current[domain];
    save({ domains: { [domain]: change } });
  };

  const retryDomain = (domain: ReminderDomain): void => {
    const change = failedPatch.current[domain];
    if (change) changeDomain(domain, change);
  };

  const setDraft = (domain: ReminderDomain, text: string | undefined): void => {
    setDrafts((prev) => {
      const next = { ...prev };
      if (text === undefined) delete next[domain];
      else next[domain] = text;
      return next;
    });
  };

  if (loadState === "failed") {
    return (
      <div role="alert">
        <p className="t-caption">{t("settings:notifications.loadError")}</p>
        <button type="button" className="btn-secondary" onClick={() => void load()}>
          {t("common:buttons.retry")}
        </button>
      </div>
    );
  }
  if (loadState === "loading" || !prefs) {
    return <p className="t-caption">{t("common:messages.loading")}</p>;
  }

  const commitEmail = (): void => {
    if (emailDraft === null) return;
    const trimmed = emailDraft.trim();
    const value = trimmed === "" ? null : trimmed;
    setEmailDraft(null);
    const latest = { ...confirmed.current, ...sending.current, ...queued.current };
    if (value === latest.notificationEmail) return;
    save({ notificationEmail: value });
  };

  const mailReason = prefs.mail.available ? null : t("settings:notifications.mailReason.no_email");
  const pushWords = t(
    `settings:notifications.pushStatus.${prefs.push.available ? "ok" : (prefs.push.reason ?? "no_relay")}`
  );
  const appBlocked = !prefs.push.available && prefs.push.reason === "no_device_token";

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
      <div className="grid sm:grid-cols-2" style={{ gap: "var(--ts-space-md)" }}>
        <div className="card flex flex-col" style={{ gap: 6, padding: "var(--ts-space-md)" }}>
          <label
            htmlFor="notification-email"
            style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}
          >
            {t("settings:notifications.mailCard")}
          </label>
          <input
            id="notification-email"
            type="email"
            className="input"
            value={emailDraft ?? prefs.notificationEmail ?? ""}
            onChange={(e) => setEmailDraft(e.target.value)}
            onBlur={commitEmail}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEmail();
            }}
            placeholder="name@example.com"
          />
          <span id={mailReasonId} className="t-caption">
            {mailReason ?? t("settings:notifications.emailSub")}
          </span>
        </div>
        <div className="card flex flex-col" style={{ gap: 6, padding: "var(--ts-space-md)" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}>
            {t("settings:notifications.appCard")}
          </span>
          <span id={appReasonId} data-blocked={appBlocked || undefined} className="t-caption">
            {pushWords}
          </span>
        </div>
      </div>
      <RemindersTable
        prefs={prefs}
        drafts={drafts}
        failed={failed}
        onChange={changeDomain}
        onDraft={setDraft}
        onRetry={retryDomain}
        mailReasonId={mailReasonId}
        appReasonId={appReasonId}
      />
      <p className="t-caption">{t("settings:notifications.carriedOver")}</p>
    </div>
  );
}
