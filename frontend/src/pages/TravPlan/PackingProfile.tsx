import { useTranslation } from "../../hooks/useTranslation";
import type { PlanState, PlanOperation } from "../../lib/api/travplan";
export function PackingProfile({
  state,
  mutate,
  busy,
}: {
  state: PlanState;
  mutate: (op: PlanOperation) => Promise<boolean>;
  busy: boolean;
}) {
  const { t } = useTranslation("travplan");
  const days =
    state.startDay && state.endDay
      ? Math.max(1, Math.round((Date.parse(state.endDay) - Date.parse(state.startDay)) / 864e5) + 1)
      : null;
  const clothes = days ? Math.min(days, state.packingProfile.washing === "yes" ? 7 : days) : null;
  return (
    <div className="tp-card">
      <h2>{t("packingProfile")}</h2>
      <div className="tp-form">
        {(["washing", "luggage"] as const).map((key) => (
          <label key={key}>
            {t("fields." + key)}
            <select
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
            </select>
          </label>
        ))}
      </div>
      <p className="tp-muted">
        {clothes ? t("clothingGuide", { days: clothes }) : t("clothingUnknown")}
      </p>
      <p className="tp-muted">{t("packingGuide")}</p>
    </div>
  );
}
