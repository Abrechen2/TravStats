import { useTranslation } from "../../../hooks/useTranslation";
import { Button, Card } from "../../../components/ui";
import { travplanApi } from "../../../lib/api/travplan";
import { PlanActions, PlanCardHead, PlanGrid, PlanGrow, PlanRow } from "../planLayout";
import { PlanCheck, PlanTasks } from "../PlanParts";
import { PackingProfile } from "../PackingProfile";
import WeatherLocation from "../WeatherLocation";
import { newEntry } from "../editorModel";
import { entryRecord, type PlanCtx } from "../planContext";

function PackingList({ ctx }: { ctx: PlanCtx }) {
  const { t } = useTranslation("travplan"),
    { state, busy, edit, mutate } = ctx;
  return (
    <Card>
      <PlanCardHead
        title={
          <>
            {state.packing.filter((p) => p.packed).length} / {state.packing.length} {t("packed")}
          </>
        }
        action={<Button onClick={() => edit("packing")}>{t("newPacking")}</Button>}
      />
      {state.packing.map((p) => (
        <PlanRow key={p.id}>
          <PlanGrow>
            <PlanCheck
              checked={p.packed}
              disabled={busy}
              onChange={(packed) =>
                void mutate({
                  type: "upsert",
                  collection: "packing",
                  value: entryRecord({ ...p, packed }),
                })
              }
            >
              {p.quantity} × {p.label}
              <small className="t-caption">
                {" "}
                · {p.category} · {t("options." + p.scope)}
              </small>
            </PlanCheck>
          </PlanGrow>
          <Button onClick={() => edit("packing", p)}>{t("edit")}</Button>
          <Button
            disabled={busy}
            onClick={() => void mutate({ type: "remove", collection: "packing", id: p.id })}
          >
            {t("delete")}
          </Button>
        </PlanRow>
      ))}
    </Card>
  );
}

function Forecast({ ctx }: { ctx: PlanCtx }) {
  const { t } = useTranslation("travplan"),
    {
      plan,
      state,
      busy,
      day,
      tripId,
      edit,
      mutate,
      onError,
      setPlan,
      weatherBusy,
      setWeatherBusy,
      suggestions,
      setSuggestions,
    } = ctx;
  return (
    <Card>
      <PlanCardHead title={t("forecast")} />
      <WeatherLocation plan={plan} mutate={mutate} onError={onError} />
      <PlanActions>
        <Button
          disabled={weatherBusy || busy}
          onClick={() => {
            setWeatherBusy(true);
            void travplanApi
              .forecast(plan)
              .then(setPlan)
              .then(() => travplanApi.packingSuggestions(tripId))
              .then(setSuggestions)
              .catch(onError)
              .finally(() => setWeatherBusy(false));
          }}
        >
          {weatherBusy ? t("loading") : t("forecast")}
        </Button>
      </PlanActions>
      {state.forecast ? (
        <>
          <p className="t-caption">
            <a
              href={state.forecast.source}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--ts-info)" }}
            >
              {t("sourceDate")}
            </a>{" "}
            · {state.forecast.fetchedAt}
          </p>
          {state.forecast.days
            .filter(
              (d) =>
                (!state.startDay || d.day >= state.startDay) &&
                (!state.endDay || d.day <= state.endDay)
            )
            .map((d) => (
              <PlanRow key={d.day}>
                <span className="t-body">{d.day}</span>
                <span className="t-body">
                  {d.min ?? "—"}° – {d.max ?? "—"}°
                </span>
                <span className="t-body">{d.rainProbability ?? "—"}%</span>
              </PlanRow>
            ))}
        </>
      ) : (
        <p className="t-body">{t("weatherUnknown")}</p>
      )}
      <PlanActions>
        <Button
          disabled={busy || weatherBusy}
          onClick={() =>
            void travplanApi.packingSuggestions(tripId).then(setSuggestions).catch(onError)
          }
        >
          {t("showPackingIdeas")}
        </Button>
      </PlanActions>
      {suggestions
        .filter(
          (s) =>
            !state.packing.some((p) => p.category === "suggestion:" + s) &&
            !state.decisions.some((d) => d.id === "packing:" + s)
        )
        .map((s) => (
          <PlanRow key={s}>
            <PlanGrow>
              <span className="t-body">{t("packingIdeas." + s)}</span>
            </PlanGrow>
            <Button
              onClick={() =>
                edit("packing", {
                  ...newEntry("packing", null, state.currency, day),
                  label: t("packingIdeas." + s),
                  note: state.forecast?.source || "",
                  manual: false,
                  category: "suggestion:" + s,
                })
              }
            >
              {t("add")}
            </Button>
          </PlanRow>
        ))}
    </Card>
  );
}

export function PackingSection({ ctx }: { ctx: PlanCtx }) {
  const { t } = useTranslation("travplan"),
    { state, busy, edit, mutate } = ctx;
  return (
    <>
      <PackingProfile state={state} mutate={mutate} busy={busy} />
      <p className="t-body">{t("packIntro")}</p>
      <PlanGrid>
        <PackingList ctx={ctx} />
        <Forecast ctx={ctx} />
      </PlanGrid>
      <PlanTasks state={state} busy={busy} edit={(task) => edit("tasks", task)} mutate={mutate} />
    </>
  );
}
