import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import Button from "../components/ui/Button";
import { FerryFormModal } from "../components/ferry/FerryFormModal";
import { useTranslation } from "../hooks/useTranslation";
import { ferryApi } from "../lib/api/ferry";
import { formatStationTime } from "../lib/railTime";
import { railDeparture } from "../lib/entityTimes";
import type { FerryJourney } from "../types/ferry";
export default function FerryPage() {
  const { t, i18n } = useTranslation(["ferry", "common"]);
  const navigate = useNavigate();
  const [rides, setRides] = useState<FerryJourney[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(false);
    void ferryApi
      .list(offset, search)
      .then((page) => {
        if (live) {
          setRides(page.journeys);
          setTotal(page.total);
        }
      })
      .catch(() => {
        if (live) setError(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [offset, search]);
  return (
    <AppShell>
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl">{t("ferry:title")}</h1>
          <Button onClick={() => setAdding(true)}>{t("ferry:add")}</Button>
        </div>
        <input
          aria-label={t("ferry:search")}
          placeholder={t("ferry:search")}
          className="rounded border bg-[var(--bg-surface)] p-2"
          value={search}
          maxLength={100}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        {loading ? (
          <p role="status">{t("common:loading")}</p>
        ) : error ? (
          <p role="alert">{t("ferry:error")}</p>
        ) : rides.length === 0 ? (
          <p>{t("ferry:empty")}</p>
        ) : (
          <ul className="space-y-2">
            {rides.map((ride) => {
              const departure = railDeparture(ride);
              return (
                <li key={ride.id} className="rounded border border-[var(--color-border)] p-4">
                  <Link to={`/ferry/${ride.id}`} className="font-semibold">
                    ⛴ {ride.depStationName} → {ride.arrStationName}
                  </Link>
                  <p className="text-sm">
                    {departure && formatStationTime(departure, i18n.language)} ·{" "}
                    {ride.operator ?? "—"} · {t(`ferry:status.${ride.status}`)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex gap-2">
          <Button
            disabled={offset === 0 || loading}
            onClick={() => setOffset((n) => Math.max(0, n - 50))}
          >
            {t("ferry:previous")}
          </Button>
          <Button
            disabled={offset + 50 >= total || loading}
            onClick={() => setOffset((n) => n + 50)}
          >
            {t("ferry:next")}
          </Button>
        </div>
        {adding && (
          <FerryFormModal
            journey={null}
            onClose={() => setAdding(false)}
            onSaved={(ride) => navigate(`/ferry/${ride.id}`)}
          />
        )}
      </div>
    </AppShell>
  );
}
