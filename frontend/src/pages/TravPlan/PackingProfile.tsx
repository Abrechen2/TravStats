import { useId } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { Card, Field, Select } from "../../components/ui";
import { PlanCardHead } from "./planLayout";
import type { PlanState, PlanOperation } from "../../lib/api/travplan";

const DAY_MS = 864e5;
const WASHING_CYCLE_DAYS = 7;
export function PackingProfile({
  state,
  mutate,
  busy,
}: {
  state: PlanState;
  mutate: (op: PlanOperation) => Promise<boolean>;
  busy: boolean;
}) {
  const { t } = useTranslation("travplan"),
    uid = useId();
  const days =
    state.startDay && state.endDay
      ? Math.max(
          1,
          Math.round((Date.parse(state.endDay) - Date.parse(state.startDay)) / DAY_MS) + 1
        )
      : null;
  const clothes = days
    ? Math.min(days, state.packingProfile.washing === "yes" ? WASHING_CYCLE_DAYS : days)
    : null;
  return (
    <Card>
      <PlanCardHead title={t("packingProfile")} />
      <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: "var(--ts-space-lg)" }}>
        {(["washing", "luggage"] as const).map((key) => (
          <Field key={key} label={t("fields." + key)} htmlFor={uid + key}>
            <Select
              id={uid + key}
              disabled={busy}
              value={state.packingProfile[key]}
              onChange={(e) =>
                void mutate({
                  type: "settings",
                  values: { packingProfile: { ...state.packingProfile, [key]: e.target.value } },
                })
              }
            >
              {(key === "washing" ? ["unknown", "yes", "no"] : ["unknown", "cabin", "checked"]).map(
                (v) => (
                  <option value={v} key={v}>
                    {t("options." + v, { defaultValue: v })}
                  </option>
                )
              )}
            </Select>
          </Field>
        ))}
      </div>
      <p className="t-caption" style={{ marginTop: "var(--ts-space-md)" }}>
        {clothes ? t("clothingGuide", { days: clothes }) : t("clothingUnknown")}
      </p>
      <p className="t-caption">{t("packingGuide")}</p>
    </Card>
  );
}
