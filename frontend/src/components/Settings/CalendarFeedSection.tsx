import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { useConfirmDialog } from "../../hooks/useConfirmDialog";
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
import { SettingRow, SettingRows } from "../ui/SettingRow";
import DemoLockedNotice from "./DemoLockedNotice";
import { SectionCard, SectionTitle } from "./SettingsShared";

const NS = "settings:calendarFeed";

/** The server's codes this card has its own sentence for; the shared ones follow. */
const ERROR_CODES = { CALENDAR_FEED_DISABLED: `${NS}.errors.disabled` } as const;

type CopyState = "idle" | "copied" | "failed";

/**
 * "Kalender-Abo" (forgejo#310): one secret URL any calendar app can subscribe
 * to, with the user's upcoming entries in it.
 *
 * The URL is shown ONCE, right after it is made: the server keeps only its
 * hash, as for API tokens and share links, so afterwards the card can say that
 * a URL exists and when it was last read, but not which one. Losing it means
 * making a new one, which is also how a leaked URL is replaced.
 */
export default function CalendarFeedSection(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const format = useDisplayFormat();
  const isDemo = useIsDemoAccount();
  const { confirm, confirmDialog } = useConfirmDialog();
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
    // Replacing a live URL ends every subscription to it — say so first.
    if (
      status?.active &&
      !(await confirm({
        message: t(`${NS}.confirmRegenerate`),
        confirmText: t(`${NS}.regenerate`),
        destructive: true,
      }))
    ) {
      return;
    }
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
    if (
      !(await confirm({
        message: t(`${NS}.confirmRevoke`),
        confirmText: t(`${NS}.revoke`),
        destructive: true,
      }))
    ) {
      return;
    }
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
    if (!issued) return;
    try {
      if (!window.isSecureContext || !navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(issued.url);
      setCopy("copied");
    } catch (error) {
      logger.warn("Copying the calendar feed URL failed:", error);
      setCopy("failed");
    }
  };

  const active = status?.active === true;

  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} description={t(`${NS}.description`)} />
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
          <SettingRow
            title={active ? t(`${NS}.stateActive`) : t(`${NS}.stateNone`)}
            sub={
              active && status.createdAt
                ? [
                    t(`${NS}.createdAt`, { date: format.dateTime(status.createdAt) }),
                    status.lastUsedAt
                      ? t(`${NS}.lastUsed`, { date: format.dateTime(status.lastUsedAt) })
                      : t(`${NS}.neverUsed`),
                  ].join(" · ")
                : t(`${NS}.noneHint`)
            }
            control={
              isDemo ? undefined : (
                <span className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
                  <Button
                    variant={active ? "secondary" : "primary"}
                    disabled={busy}
                    onClick={() => void issue()}
                  >
                    {active ? t(`${NS}.regenerate`) : t(`${NS}.create`)}
                  </Button>
                  {active && (
                    <Button variant="danger" disabled={busy} onClick={() => void revoke()}>
                      {t(`${NS}.revoke`)}
                    </Button>
                  )}
                </span>
              )
            }
          />
        )}

        {isDemo && status?.enabled && <DemoLockedNotice />}

        {issued && (
          <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
            <label className="label" htmlFor="calendar-feed-url">
              {t(`${NS}.urlLabel`)}
            </label>
            <input
              id="calendar-feed-url"
              className="input"
              readOnly
              value={issued.url}
              onFocus={(event) => event.currentTarget.select()}
              style={{ fontFamily: "var(--ts-font-mono)" }}
            />
            <p className="t-caption">{t(`${NS}.shownOnce`)}</p>
            <span className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
              <Button variant="primary" onClick={() => void copyUrl()}>
                {t(`${NS}.copy`)}
              </Button>
              <a className="btn-secondary" href={issued.webcalUrl}>
                {t(`${NS}.openInCalendar`)}
              </a>
            </span>
            {copy === "copied" && (
              <p role="status" className="t-caption" style={{ color: "var(--ts-good)" }}>
                {t(`${NS}.copied`)}
              </p>
            )}
            {copy === "failed" && (
              <p role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
                {t(`${NS}.copyFailed`)}
              </p>
            )}
          </div>
        )}

        {errorKey && (
          <p role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
            {t(errorKey)}
          </p>
        )}
      </SettingRows>
      {confirmDialog}
    </SectionCard>
  );
}
