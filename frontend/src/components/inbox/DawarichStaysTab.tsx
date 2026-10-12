import { useCallback, useEffect, useState } from "react";
import { dawarichStaysApi, type DawarichStay, type StayChoices } from "../../lib/api/dawarichStays";
import { useTranslation } from "../../hooks/useTranslation";
import DawarichStayScanCard from "../Settings/DawarichStayScanCard";
import StayReviewCard from "../dawarich/StayReviewCard";
export default function DawarichStaysTab(): JSX.Element {
  const { t } = useTranslation("trips");
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState<DawarichStay[]>([]);
  const [choices, setChoices] = useState<StayChoices>({ places: [], trips: [] });
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [next, options] = await Promise.all([
        dawarichStaysApi.list(status),
        dawarichStaysApi.choices(),
      ]);
      setRows(next);
      setChoices(options);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [status]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="space-y-4">
      <DawarichStayScanCard onScanned={() => void load()} />
      <label>
        {t("trips:dawarichStays.filter")}
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          {["pending", "accepted", "rejected"].map((s) => (
            <option key={s} value={s}>
              {t(`trips:dawarichStays.status.${s}`)}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p role="alert">{t("trips:dawarichStays.error")}</p>
      ) : loading ? (
        <p role="status">{t("trips:dawarichStays.loading")}</p>
      ) : rows.length ? (
        rows.map((row) => (
          <StayReviewCard key={row.id} row={row} choices={choices} onDone={() => void load()} />
        ))
      ) : (
        <p>{t("trips:dawarichStays.empty")}</p>
      )}
    </div>
  );
}
