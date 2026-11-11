import { useEffect, useState, type JSX } from "react";
import { adminApi } from "../../lib/api";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import type { LoggingConfigResponse } from "../../shared/logContract";
import { useTranslation } from "../../hooks/useTranslation";
import { useRowCopy } from "../Settings/rowCopy";
import { ActionControl, ErrorLine, SettingItem } from "../ui/settings";

/** How often the remaining time is re-read; a minute is the finest the line shows. */
const TICK_MS = 30_000;

/** Whole hours and minutes left until `until`, never negative. */
export function remainingParts(until: number, now: number): { hours: number; minutes: number } {
  const left = Math.max(0, until - now);
  const total = Math.ceil(left / 60_000);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/**
 * "Ausführliches Protokoll für 24 h" (settings v3 `debug24`): one press turns the
 * verbose level on for a day, after which the server puts the level back by
 * itself (`debugUntil`, S2). While it runs the row says until when and how much
 * is left, and offers the way back at once. Nothing here switches the level
 * back — the countdown is only a reading of what the server holds.
 */
export default function MaintenanceDebug24({
  config,
  reload,
  dependency,
}: {
  config: LoggingConfigResponse;
  reload: () => Promise<void>;
  dependency?: { reason: string };
}): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const row = useRowCopy("maintenance");
  const fmt = useDisplayFormat();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // What the toggle itself answered: it is the server's fresh word, so the row shows it even
  // when the reload that follows fails. A successful reload hands the same value back via `config`.
  const [fresh, setFresh] = useState<{ until: string | null } | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const debugUntil = fresh ? fresh.until : (config.debugUntil ?? null);
  const until = debugUntil ? Date.parse(debugUntil) : null;
  const running = until !== null && Number.isFinite(until) && until > now;
  const copy = row("debug24");

  const press = async (on: boolean): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      const answer = await adminApi.toggleDebugLogging(on);
      setFresh({ until: answer.config?.debugUntil ?? null });
      setNow(Date.now());
      try {
        await reload();
        setFresh(null);
      } catch (error) {
        // The switch itself worked; only the re-read failed, and the row already shows the answer.
        logger.warn("Re-reading the logging settings after the 24 h switch failed:", error);
      }
    } catch (error) {
      logger.error("Switching the 24 h verbose log failed:", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const left = running ? remainingParts(until, now) : null;
  return (
    <SettingItem
      title={copy.title}
      sub={copy.sub}
      help={copy.help}
      scope="allAccounts"
      expert
      dependency={dependency}
      control={
        <ActionControl
          label={running ? t("settingsRows:maintenance.debug24.off") : (copy.btn ?? copy.title)}
          busy={busy}
          onClick={() => void press(!running)}
        />
      }
    >
      {running && left ? (
        <p role="status" data-debug24="running" className="t-caption" style={{ margin: 0 }}>
          {t("settingsRows:maintenance.debug24.running", {
            until: fmt.dateTime(debugUntil ?? ""),
            hours: left.hours,
            minutes: left.minutes,
          })}
        </p>
      ) : null}
      {failed ? <ErrorLine>{t("settingsRows:maintenance.debug24.failed")}</ErrorLine> : null}
    </SettingItem>
  );
}
