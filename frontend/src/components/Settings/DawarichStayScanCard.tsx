import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dawarichStaysApi, type StayScanState } from "../../lib/api/dawarichStays";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { profileDateTime } from "../../lib/profileInstant";
import { SectionCard } from "./SettingsShared";

export default function DawarichStayScanCard({
  onScanned,
}: {
  onScanned?: () => void;
}): JSX.Element {
  const { t } = useTranslation("trips");
  const demo = useIsDemoAccount();
  const [state, setState] = useState<StayScanState | null>(null);
  const [lookbackDays, setLookbackDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(async () => {
    try {
      setState(await dawarichStaysApi.state());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (state?.result !== "running") return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load, state?.result]);
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(false);
    try {
      await work();
      onScanned?.();
    } catch {
      setError(true);
    } finally {
      await load();
      setBusy(false);
    }
  };
  const coverageScope = state?.marketResult?.scope === "venues" ? "venues" : "markets";
  const placesPaused = state?.placesEnabled === false;
  // The account switched stay suggestions off (forgejo#306): no scan runs.
  const suggestionsPaused = state?.pausedReason === "suggestionsDisabled";
  const stale =
    !!state?.dataThrough && Date.now() - Date.parse(state.dataThrough) > 24 * 60 * 60_000;
  const text = (key: string) => t(`trips:dawarichStays.${key}`);
  const errorKey =
    state?.error &&
    ["auth", "unreachable", "protocol", "notFound", "invalidUrl"].includes(state.error)
      ? `trips:tours.tracks.dawarich.errors.${state.error}`
      : null;
  return (
    <SectionCard>
      <h3 className="t-heading-sm">{text("title")}</h3>
      <p className="t-body mt-2">{text("description")}</p>
      <label className="flex items-center gap-3 my-4">
        <input
          type="checkbox"
          checked={state?.enabled ?? false}
          disabled={
            demo || busy || !state || ((!state.connected || placesPaused) && !state.enabled)
          }
          onChange={(e) => void action(() => dawarichStaysApi.enable(e.target.checked))}
        />
        {text("enable")}
      </label>
      <label className="flex items-center gap-3 my-4">
        <input
          type="checkbox"
          checked={state?.marketEnabled ?? false}
          disabled={
            demo ||
            busy ||
            !state ||
            (!state.marketEnabled && (!state.enabled || !state.connected || placesPaused))
          }
          onChange={(e) => void action(() => dawarichStaysApi.enableMarkets(e.target.checked))}
        />
        {text("markets.enable")}
      </label>
      <p className="t-caption mb-4">{text("markets.privacy")}</p>
      <label className="flex items-center gap-3 my-4">
        <input
          type="checkbox"
          checked={state?.venueEnabled ?? false}
          disabled={
            demo ||
            busy ||
            !state ||
            (!state.venueEnabled && (!state.enabled || !state.connected || placesPaused))
          }
          onChange={(e) => void action(() => dawarichStaysApi.enableVenues(e.target.checked))}
        />
        {text("venues.enable")}
      </label>
      <p className="t-caption mb-4">{text("venues.description")}</p>
      {state?.marketResult && (
        <div className="my-3" role="status">
          <p>{text(`${coverageScope}.status.${state.marketResult.status}`)}</p>
          <p className="t-caption">
            {t("trips:dawarichStays.markets.coverage", {
              tiles: state.marketResult.tiles,
              total: state.marketResult.totalTiles,
            })}
          </p>
          {!!state.marketResult.missingAreaCount && (
            <p>
              {t(`trips:dawarichStays.${coverageScope}.missing`, {
                count: state.marketResult.missingAreaCount,
              })}
            </p>
          )}
          {state.marketResult.staleMapData && <p>{text("markets.stale")}</p>}
          <p>
            {t(`trips:dawarichStays.${coverageScope}.counts`, {
              created: state.marketResult.createdCount,
              known: state.marketResult.alreadyRecordedCount,
            })}
          </p>
        </div>
      )}
      {state && !state.connected && <p>{text("ownConnection")}</p>}
      {suggestionsPaused && <p className="my-3">{text("suggestionsPaused")}</p>}
      {placesPaused && <p className="my-3">{text("placesPaused")}</p>}
      {state && !state.enabled && <p className="my-3">{text("disabled")}</p>}
      {state?.nextScanAt && (
        <p className="t-caption my-3">
          {text("nextScan")}: {profileDateTime(state.nextScanAt)}
        </p>
      )}
      <label className="block my-3">
        {text("lookback")}
        <select
          className="input"
          value={lookbackDays}
          disabled={busy || state?.result === "running"}
          onChange={(e) => setLookbackDays(Number(e.target.value))}
        >
          {[7, 14, 30].map((days) => (
            <option key={days} value={days}>
              {t("trips:dawarichStays.days", { count: days })}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          className="btn-secondary"
          disabled={
            demo ||
            busy ||
            placesPaused ||
            suggestionsPaused ||
            !state?.enabled ||
            !state.connected ||
            state.result === "running"
          }
          onClick={() => void action(() => dawarichStaysApi.scan(lookbackDays))}
        >
          {text(busy || state?.result === "running" ? "running" : "scan")}
        </button>
        <Link className="btn-secondary" to="/pending-updates?tab=dawarich">
          {text("inbox")}
        </Link>
      </div>
      {state?.result && (
        <p role="status" className="mt-3">
          {text(`result.${state.result}`)} ·{" "}
          {state.finishedAt ? profileDateTime(state.finishedAt) : "—"}
        </p>
      )}
      {state?.windowStart && (
        <p className="t-caption">
          {text("window")}: {profileDateTime(state.windowStart)} –{" "}
          {profileDateTime(state.windowEnd)}
        </p>
      )}
      {state?.finishedAt && (
        <p className="t-caption">
          {text("dataThrough")}: {state.dataThrough ? profileDateTime(state.dataThrough) : "—"} ·{" "}
          {t("trips:dawarichStays.scanCount", {
            points: state.pointCount,
            created: state.createdCount,
          })}
        </p>
      )}
      {state?.finishedAt &&
        ["succeeded", "partial"].includes(state.result ?? "") &&
        !state.dataThrough && <p>{text("noPoints")}</p>}
      {stale && <p>{text("staleData")}</p>}
      {(error || loadError || (state?.error && !state.pausedReason)) && (
        <p role="alert" className="mt-3">
          {errorKey ? t(errorKey) : text("error")}
        </p>
      )}
    </SectionCard>
  );
}
