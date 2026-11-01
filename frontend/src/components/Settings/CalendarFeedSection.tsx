import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import {
  calendarFeedApi,
  type CalendarFeedStatus,
  type IssuedCalendarFeed,
} from "../../lib/api/calendarFeed";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import { saveErrorKey } from "../../lib/saveErrorMessage";
import Button from "../ui/Button";
import { SettingRows } from "../ui/SettingRow";
import { ActionControl, ConfirmDialog, ErrorLine, SettingItem } from "../ui/settings";
import { useDialogCopy, useRowCopy } from "./rowCopy";
import { SectionCard, SectionTitle } from "./SettingsShared";

const NS = "settings:calendarFeed";

/** The server's codes this card has its own sentence for; the shared ones follow. */
const ERROR_CODES = { CALENDAR_FEED_DISABLED: `${NS}.errors.disabled` } as const;

type CopyState = "idle" | "copied" | "failed";

/**
 * "Kalender-Abo" (forgejo#310): one secret URL any calendar app can subscribe
 * to, with the user's upcoming entries in it.
 *
 * The live URL is shown right after it is made and again whenever the server
 * can recover it (it keeps the token encrypted since 2026-10-26); a URL from
 * before that still works but cannot be shown. Replacing it is how a leaked
 * URL is retired. Under the link, a warning when its address is a private IP
 * or `localhost` — Google Calendar fetches from the internet and never gets it.
 */
export default function CalendarFeedSection(): JSX.Element {
  const { t } = useTranslation(["settings", "common", "settingsRows"]);
  const format = useDisplayFormat();
  const isDemo = useIsDemoAccount();
  const row = useRowCopy("trips");
  const dialog = useDialogCopy();
  const [asking, setAsking] = useState<"regenerate" | "revoke" | null>(null);
  const [status, setStatus] = useState<CalendarFeedStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [issued, setIssued] = useState<IssuedCalendarFeed | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyState>("idle");

  const load = useCallback(async () => {
    try {
      setStatus(await calendarFeedApi.status());
      setLoadFailed(false);
    } catch (error) {
      logger.error("Loading the calendar feed state failed:", error);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const issue = async (): Promise<void> => {
    setAsking(null);
    setBusy(true);
    setErrorKey(null);
    setCopy("idle");
    try {
      setIssued(await calendarFeedApi.issue());
      await load();
    } catch (error) {
      logger.error("Issuing a calendar feed URL failed:", error);
      setErrorKey(saveErrorKey(error, `${NS}.errors.issue`, ERROR_CODES, { create: true }));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (): Promise<void> => {
    setAsking(null);
    setBusy(true);
    setErrorKey(null);
    try {
      await calendarFeedApi.revoke();
      setIssued(null);
      await load();
    } catch (error) {
      logger.error("Revoking the calendar feed URL failed:", error);
      setErrorKey(saveErrorKey(error, `${NS}.errors.revoke`, ERROR_CODES));
    } finally {
      setBusy(false);
    }
  };

  /**
   * The clipboard is a convenience, never the only way out: on a plain-http
   * LAN address `navigator.clipboard` does not exist, so the URL stays in a
   * field the reader can select, and a failed copy says so.
   */
  const copyUrl = async (): Promise<void> => {
    if (!link) return;
    try {
      if (!window.isSecureContext || !navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(link.url);
      setCopy("copied");
    } catch (error) {
      logger.warn("Copying the calendar feed URL failed:", error);
      setCopy("failed");
    }
  };

  const active = status?.active === true;
  // The URL just issued, else the live one the state recovered.
  const link: { url: string; webcalUrl: string; reachableFromInternet: boolean } | null =
    issued ??
    (active && status?.url && status.webcalUrl
      ? {
          url: status.url,
          webcalUrl: status.webcalUrl,
          reachableFromInternet: status.reachableFromInternet,
        }
      : null);

  const copy_ = row("ics");
  const regenerate = dialog("icsnew");
  const withdraw = dialog("icsrevoke");
  return (
    <SectionCard>
      <SectionTitle title={t("settingsRows:trips.sections.calendarFeed")} />
      <SettingRows>
        {loadFailed && (
          <p role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
            {t(`${NS}.loadFailed`)}{" "}
            <button type="button" className="btn-secondary" onClick={() => void load()}>
              {t(`${NS}.retry`)}
            </button>
          </p>
        )}

        {status && !status.enabled && <p className="t-caption">{t(`${NS}.unavailable`)}</p>}

        {status?.enabled && (
          <SettingItem
            title={copy_.title}
            help={copy_.help}
            sub={
              active && status.createdAt
                ? [
                    copy_.sub,
                    t(`${NS}.createdAt`, { date: format.dateTime(status.createdAt) }),
                    status.lastUsedAt
                      ? t(`${NS}.lastUsed`, { date: format.dateTime(status.lastUsedAt) })
                      : t(`${NS}.neverUsed`),
                  ].join(" · ")
                : copy_.sub
            }
            locked={isDemo ? { why: "demo", reason: t("settings:blocks.lock.demo") } : undefined}
            error={errorKey ? t(errorKey) : undefined}
            control={
              <span className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
                <ActionControl
                  label={active ? t(`${NS}.regenerate`) : (copy_.btn ?? t(`${NS}.create`))}
                  busy={busy}
                  onClick={() => (active ? setAsking("regenerate") : void issue())}
                />
                {active && (
                  <ActionControl
                    danger
                    label={t(`${NS}.revoke`)}
                    busy={busy}
                    onClick={() => setAsking("revoke")}
                  />
                )}
              </span>
            }
          >
            {active && !link && <p className="t-caption">{t(`${NS}.notRecoverable`)}</p>}
            {link && (
              <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
                <label className="label" htmlFor="calendar-feed-url">
                  {t(`${NS}.urlLabel`)}
                </label>
                <input
                  id="calendar-feed-url"
                  className="input"
                  readOnly
                  value={link.url}
                  onFocus={(event) => event.currentTarget.select()}
                  style={{ fontFamily: "var(--ts-font-mono)" }}
                />
                {!link.reachableFromInternet && (
                  <p role="note" className="t-caption" style={{ color: "var(--ts-warn)" }}>
                    {t(`${NS}.unreachable`)}
                  </p>
                )}
                <p className="t-caption">{t(`${NS}.keepSecret`)}</p>
                <span className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
                  <Button variant="primary" onClick={() => void copyUrl()}>
                    {t(`${NS}.copy`)}
                  </Button>
                  <a className="btn-secondary" href={link.webcalUrl}>
                    {t(`${NS}.openInCalendar`)}
                  </a>
                </span>
                {copy === "copied" && (
                  <p role="status" className="t-caption" style={{ color: "var(--ts-good)" }}>
                    {t(`${NS}.copied`)}
                  </p>
                )}
                {copy === "failed" && <ErrorLine>{t(`${NS}.copyFailed`)}</ErrorLine>}
              </div>
            )}
          </SettingItem>
        )}
      </SettingRows>
      <ConfirmDialog
        open={asking === "regenerate"}
        title={regenerate.title}
        affects={regenerate.affects}
        amount={regenerate.amount}
        after={regenerate.after}
        confirmLabel={regenerate.confirmLabel}
        busy={busy}
        onConfirm={() => void issue()}
        onCancel={() => setAsking(null)}
      />
      <ConfirmDialog
        open={asking === "revoke"}
        title={withdraw.title}
        affects={withdraw.affects}
        amount={withdraw.amount}
        after={withdraw.after}
        confirmLabel={withdraw.confirmLabel}
        busy={busy}
        onConfirm={() => void revoke()}
        onCancel={() => setAsking(null)}
      />
    </SectionCard>
  );
}
