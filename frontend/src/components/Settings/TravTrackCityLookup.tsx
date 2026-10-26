import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Switch } from "../ui/Field";
import { token } from "../ui/tokens";
import { useTranslation } from "../../hooks/useTranslation";
import { travTrackMonthsApi } from "../../lib/api/travtrackMonths";
import { logger } from "../../lib/logger";

const NS = "track:settings.cities";

type Status = { tone: "ok" | "bad"; text: string } | null;

/**
 * The city lookup of TravTrack's monthly values (TravTrack plan L3), inside
 * the TravTrack settings card. Off by default; the copy says that rounded
 * positions go to this server's geocoder, which may be a public Nominatim.
 * Shown only while TravTrack is on (`canChange` false: read-only).
 */
export default function TravTrackCityLookup({ canChange }: { canChange: boolean }): JSX.Element {
  const { t } = useTranslation(["track"]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    let live = true;
    travTrackMonthsApi
      .cityLookup()
      .then((value) => {
        if (live) setEnabled(value);
      })
      .catch((err: unknown) => {
        logger.warn("TravTrack city lookup could not be loaded", err);
        if (live) setStatus({ tone: "bad", text: t(`${NS}.loadFailed`) });
      });
    return () => {
      live = false;
    };
  }, [t]);

  const change = async (next: boolean) => {
    setBusy(true);
    setStatus(null);
    try {
      const saved = await travTrackMonthsApi.setCityLookup(next);
      setEnabled(saved);
      setStatus({ tone: "ok", text: t(saved ? `${NS}.savedOn` : `${NS}.savedOff`) });
    } catch (err) {
      logger.warn("TravTrack city lookup not saved", err);
      setStatus({ tone: "bad", text: t(`${NS}.notSaved`) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <h3 className="t-card-title" style={{ marginTop: "var(--ts-space-lg)" }}>
        {t(`${NS}.title`)}
      </h3>
      {enabled !== null && (
        <Switch
          id="travtrack-city-lookup"
          checked={enabled}
          disabled={busy || !canChange}
          onChange={(next) => void change(next)}
          label={t(`${NS}.label`)}
          sub={t(`${NS}.intro`)}
        />
      )}
      {status && (
        <p
          className="t-body"
          role={status.tone === "bad" ? "alert" : "status"}
          style={{ color: token(status.tone === "bad" ? "bad" : "good") }}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
