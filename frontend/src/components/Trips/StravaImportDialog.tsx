import { useEffect, useState } from "react";
import type { JSX } from "react";

import Dialog from "../ui/Dialog";
import { useTranslation } from "../../hooks/useTranslation";
import { stravaApi, stravaFailureKind, type StravaActivity } from "../../lib/api/strava";
import { useDisplayFormat } from "../../lib/displayFormat";

const DAY_MS = 86_400_000;

/**
 * Pick a Strava activity. `target` decides what picking does: make a new day
 * tour from it, or add its recording to an existing route. Activities without
 * a GPS route (a treadmill run) are listed but cannot be picked, with the
 * reason — hiding them would leave the reader looking for a workout they
 * know they recorded.
 */
export default function StravaImportDialog({
  target,
  around,
  onDone,
  onClose,
}: {
  target: { kind: "newTour"; tripId?: string | null } | { kind: "route"; routeId: string };
  /** Centre of the window to list (a trip's or tour's day); default: the last 30 days. */
  around?: string | null;
  onDone: (routeId: string) => void;
  onClose: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips", "common"]);
  const display = useDisplayFormat();
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const [rows, setRows] = useState<StravaActivity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const centre = around ? Date.parse(around) : Date.now();
    const window = around
      ? {
          after: new Date(centre - 3 * DAY_MS).toISOString(),
          before: new Date(centre + 4 * DAY_MS).toISOString(),
        }
      : { after: new Date(centre - 30 * DAY_MS).toISOString() };
    stravaApi
      .activities(window)
      .then(setRows)
      .catch((err: unknown) => {
        const kind = stravaFailureKind(err);
        setError(kind ? t(`roadtrips:strava.failure.${kind}`) : t("roadtrips:strava.genericError"));
      });
  }, [around, t]);

  const pick = async (a: StravaActivity): Promise<void> => {
    setBusy(a.id);
    setError(null);
    try {
      if (target.kind === "newTour") {
        onDone(await stravaApi.importAsTour(a.id, target.tripId));
      } else {
        await stravaApi.importInto(target.routeId, a.id);
        onDone(target.routeId);
      }
    } catch (err) {
      const kind = stravaFailureKind(err);
      setError(kind ? t(`roadtrips:strava.failure.${kind}`) : t("roadtrips:strava.importFailed"));
      setBusy(null);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("roadtrips:strava.importTitle")}
      closeLabel={t("common:buttons.close")}
    >
      {rows === null && !error && (
        <p className="text-sm text-(--text-muted)">{t("common:loading.default")}</p>
      )}
      {rows !== null && rows.length === 0 && (
        <p className="text-sm text-(--text-muted)">{t("roadtrips:strava.noActivities")}</p>
      )}
      <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
        {(rows ?? []).map((a) => (
          <li key={a.id}>
            <button
              type="button"
              disabled={!a.hasRoute || busy !== null}
              onClick={() => void pick(a)}
              className="w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-(--bg-surface) disabled:opacity-50"
            >
              <span className="font-medium">{a.name || a.sportType}</span>
              <span className="t-meta-mono ml-2 text-(--text-muted)">
                {a.startDate && display.date(a.startDate)} · {nf.format(a.distanceKm)} km
                {a.ascentM !== null && ` · ↑ ${Math.round(a.ascentM)} m`}
              </span>
              {!a.hasRoute && (
                <span className="block text-xs text-(--text-muted)">
                  {t("roadtrips:strava.noRoute")}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** Whether Strava is connected for this reader — hides the import buttons otherwise. */
export function useStravaConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let cancelled = false;
    stravaApi
      .status()
      .then((s) => !cancelled && setConnected(s.connected))
      .catch(() => {
        // Not being able to ask is the same as not connected for a button.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return connected;
}
