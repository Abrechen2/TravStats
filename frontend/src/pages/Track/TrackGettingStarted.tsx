import { useEffect, useState, type JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { apiTokensApi } from "../../lib/api/tokens";
import { logger } from "../../lib/logger";
import { panelStyle, pillStyle } from "./map/trackMapStyle";

/**
 * `/track` for an account that holds no TravTrack data yet (owner, 2026-10-26:
 * "soll nach Aktivierung sofort da sein mit Meldung, was er tun kann, dass
 * Daten reinkommen"): the three ways data comes in, each with its button, and
 * a line on pairing the Companion when no device is paired. `active` — the
 * account already records into TravTrack — turns the first step into a note.
 */

/** True / false once known; null while unknown or when the token list could not be read. */
function usePairedDevice(): boolean | null {
  const [paired, setPaired] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    apiTokensApi
      .list()
      .then((tokens) => {
        if (live) setPaired(tokens.some((tk) => tk.deviceId !== null && tk.revokedAt === null));
      })
      // Unknown is said by saying nothing: no pairing line is better than a wrong one.
      .catch((err: unknown) => logger.warn("Paired devices could not be read", err));
    return () => {
      live = false;
    };
  }, []);
  return paired;
}

export default function TrackGettingStarted({ active }: { active: boolean }): JSX.Element {
  const { t } = useTranslation(["track"]);
  const paired = usePairedDevice();
  const steps = [
    {
      key: "companion",
      done: active,
      to: "/settings/location?section=locationProvider",
    },
    { key: "dawarich", done: false, to: "/track/imports" },
    { key: "gpx", done: false, to: "/track/imports" },
  ] as const;
  return (
    <section
      style={panelStyle}
      className="flex flex-col gap-4"
      aria-labelledby="track-start-title"
      data-testid="track-getting-started"
    >
      <div className="flex flex-col gap-1">
        <h2 id="track-start-title" className="t-card-title">
          {t("track:start.title")}
        </h2>
        <p className="t-body">{t("track:start.intro")}</p>
      </div>
      <ol className="flex flex-col gap-3" style={{ margin: 0, paddingLeft: 20 }}>
        {steps.map((step) => (
          <li key={step.key} data-step={step.key} className="flex flex-col gap-1">
            <span className="t-body" style={{ fontWeight: 600 }}>
              {t(`track:start.${step.key}.title`)}
            </span>
            <span className="t-caption">
              {t(step.done ? `track:start.${step.key}.done` : `track:start.${step.key}.body`)}
            </span>
            {!step.done && (
              <Link
                to={step.to}
                style={{ ...pillStyle(false), alignSelf: "flex-start", textDecoration: "none" }}
              >
                {t(`track:start.${step.key}.action`)}
              </Link>
            )}
          </li>
        ))}
      </ol>
      {paired === false && (
        <p className="t-caption" data-testid="track-start-pairing">
          {t("track:start.pairing")}{" "}
          <Link to="/settings/account?section=devices">{t("track:start.pairingAction")}</Link>
        </p>
      )}
    </section>
  );
}
