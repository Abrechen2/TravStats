import { useId, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { travplanApi, type PlanView, type PlanOperation } from "../../lib/api/travplan";
import { Button, Field, Input } from "../../components/ui";
import { PlanActions, PlanGrow, PlanRow } from "./planLayout";

const MIN_QUERY_CHARS = 2;
const MAX_QUERY_CHARS = 120;
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
    [busy, setBusy] = useState(false),
    inputId = useId();
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
    <div style={{ marginBottom: "var(--ts-space-xl)" }}>
      <Field label={t("weatherLocation")} htmlFor={inputId}>
        <Input
          id={inputId}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={MAX_QUERY_CHARS}
        />
      </Field>
      <PlanActions>
        <Button
          disabled={busy || query.trim().length < MIN_QUERY_CHARS}
          onClick={() => void search()}
        >
          {t("searchLocation")}
        </Button>
      </PlanActions>
      {rows.map((row) => (
        <PlanRow key={row.id}>
          <PlanGrow>
            <span className="t-body">
              {row.name} · {row.country}
            </span>
          </PlanGrow>
          <Button
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
          </Button>
        </PlanRow>
      ))}
      <p className="t-caption">{t("locationSource")}</p>
    </div>
  );
}
