import { Button, Field, Select } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import type { PlanPlace } from "../../../lib/api/travplan";
import { PlacePicker } from "../route/PlacePicker";
import { LEG_MODES, type DraftStop, type LegMode } from "./routeDraft";

const label = (p: PlanPlace | null) =>
  p ? [p.name, p.country, p.zone].filter(Boolean).join(" · ") : "";

/**
 * The way out, stop by stop: each stop says how it is reached, so a ferry port followed by a
 * ferry is a crossing, not a drive across the sea. The last stop is the goal.
 */
export function RouteLegs({
  uid,
  start,
  stops,
  onStart,
  onAdd,
  onStops,
}: {
  uid: string;
  start: PlanPlace | null;
  stops: DraftStop[];
  onStart: (place: PlanPlace) => void;
  onAdd: (place: PlanPlace) => void;
  onStops: (stops: DraftStop[]) => void;
}) {
  const { t } = useTranslation("travplan");
  const setMode = (i: number, mode: LegMode) =>
    onStops(stops.map((s, j) => (j === i ? { ...s, mode } : s)));
  return (
    <>
      <Field label={t("create.start")} htmlFor={uid + "-start"} hint={label(start)}>
        <PlacePicker label={t("create.startSearch")} onPick={onStart} />
      </Field>
      {stops.length > 0 && (
        <ol className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          {stops.map((s, i) => (
            <li key={i} className="flex items-center" style={{ gap: "var(--ts-space-md)" }}>
              <Select
                aria-label={t("create.legMode", { place: s.place.name })}
                value={s.mode}
                onChange={(e) => setMode(i, e.target.value as LegMode)}
                style={{ width: "10rem", flex: "none" }}
              >
                {LEG_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t("route.mode." + m)}
                  </option>
                ))}
              </Select>
              <span className="t-body min-w-0 flex-1">
                → {s.place.name}
                {i === stops.length - 1 && <span className="t-caption"> · {t("create.goal")}</span>}
              </span>
              <Button
                aria-label={t("create.removeStop", { place: s.place.name })}
                onClick={() => onStops(stops.filter((_, j) => j !== i))}
              >
                ×
              </Button>
            </li>
          ))}
        </ol>
      )}
      <Field
        label={t(stops.length ? "create.addStop" : "create.goal")}
        htmlFor={uid + "-dest"}
        hint={t("create.stopHint")}
      >
        <PlacePicker label={t("create.destinationSearch")} onPick={onAdd} />
      </Field>
    </>
  );
}
