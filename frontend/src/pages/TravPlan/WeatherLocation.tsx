import { useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { travplanApi, type PlanView, type PlanOperation } from "../../lib/api/travplan";
export default function WeatherLocation({
  plan,
  mutate,
  onError,
}: {
  plan: PlanView;
  mutate: (op: PlanOperation) => Promise<boolean>;
  onError: (e: unknown) => void;
}) {
  const { t, i18n } = useTranslation("travplan"),
    [query, setQuery] = useState(plan.state.destination),
    [rows, setRows] = useState<
      {
        id: number;
        name: string;
        country?: string;
        latitude: number;
        longitude: number;
        timezone: string;
      }[]
    >([]),
    [busy, setBusy] = useState(false);
  async function search() {
    setBusy(true);
    try {
      setRows(await travplanApi.locations(query, i18n.language.startsWith("de") ? "de" : "en"));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ marginBottom: 20 }}>
      <label>
        {t("weatherLocation")}
        <input
          className="tp-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={120}
        />
      </label>
      <button disabled={busy || query.trim().length < 2} onClick={() => void search()}>
        {t("searchLocation")}
      </button>
      {rows.map((row) => (
        <div key={row.id} className="tp-row">
          <span className="tp-grow">
            {row.name} · {row.country}
          </span>
          <button
            onClick={() =>
              void mutate({
                type: "settings",
                values: {
                  latitude: row.latitude,
                  longitude: row.longitude,
                  timezone: row.timezone,
                },
              }).then((ok) => {
                if (ok) setRows([]);
              })
            }
          >
            {t("choose")}
          </button>
        </div>
      ))}
      <p className="tp-muted">{t("locationSource")}</p>
    </div>
  );
}
