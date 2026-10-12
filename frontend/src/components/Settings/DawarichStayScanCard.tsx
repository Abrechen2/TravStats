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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      setState(await dawarichStaysApi.state());
    } catch {
      setError(true);
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
          disabled={demo || busy || !state || (!state.connected && !state.enabled)}
          onChange={(e) => void action(() => dawarichStaysApi.enable(e.target.checked))}
        />
        {text("enable")}
      </label>
      {state && !state.connected && <p>{text("ownConnection")}</p>}
      <div className="flex flex-wrap gap-3">
        <button
          className="btn-secondary"
          disabled={
            demo || busy || !state?.enabled || !state.connected || state.result === "running"
          }
          onClick={() => void action(dawarichStaysApi.scan)}
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
      {(error || state?.error) && (
        <p role="alert" className="mt-3">
          {errorKey ? t(errorKey) : text("error")}
        </p>
      )}
    </SectionCard>
  );
}
