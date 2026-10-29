import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { apiErrorMachineCode } from "../../lib/apiError";
import { logger } from "../../lib/logger";
import { aeroapiApi, type AeroapiSettings, type AeroapiTier } from "../../lib/api/aeroapi";
import Button from "../ui/Button";
import { Field, Input, Select, Switch } from "../ui/Field";
import { SectionTitle } from "../Settings/SettingsShared";

const NS = "admin:aeroapi";
const TIERS: readonly AeroapiTier[] = ["personal", "personal_feeder", "custom"];

/**
 * Administration › Externe Dienste › Flug: the FlightAware AeroAPI plan, this
 * month's spending against the budget, and the opt-in switch for real flight
 * tracks (forgejo#409). Every state the server can be in is said in words —
 * budget reached, sweep stopped and why — never a silent absence.
 */
export default function AeroapiBudgetCard(): JSX.Element {
  const { t, i18n } = useTranslation(["admin"]);
  const [state, setState] = useState<AeroapiSettings | null>(null);
  const [tier, setTier] = useState<AeroapiTier>("personal");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const adopt = (next: AeroapiSettings): void => {
    setState(next);
    setTier(next.tier);
    setCustom(next.customBudgetUsd === null ? "" : String(next.customBudgetUsd));
  };

  useEffect(() => {
    let alive = true;
    aeroapiApi.get().then(
      (loaded) => {
        if (alive) adopt(loaded);
      },
      (err: unknown) => {
        logger.error("Loading the AeroAPI settings failed:", err);
        if (alive) setLoadFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  const usd = (value: number): string =>
    new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD" }).format(value);

  const send = async (body: Parameters<typeof aeroapiApi.update>[0]): Promise<void> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      adopt(await aeroapiApi.update(body));
      setSaved(true);
    } catch (err) {
      logger.error("Saving the AeroAPI settings failed:", err);
      setError(
        apiErrorMachineCode(err) === "AEROAPI_BUDGET_REQUIRED"
          ? `${NS}.budgetRequired`
          : `${NS}.saveFailed`
      );
    } finally {
      setBusy(false);
    }
  };

  const customNumber = custom.trim() === "" ? null : Number(custom.replace(",", "."));
  const dirty =
    state !== null &&
    (tier !== state.tier || (tier === "custom" && customNumber !== state.customBudgetUsd));
  const sweep = state?.lastTrackSweep ?? null;

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }} data-testid="aeroapi-card">
      <SectionTitle title={t(`${NS}.title`)} description={t(`${NS}.description`)} />
      {loadFailed && <p role="alert">{t(`${NS}.loadFailed`)}</p>}
      {state && (
        <>
          <Field label={t(`${NS}.tier`)} htmlFor="aeroapi-tier">
            <Select
              id="aeroapi-tier"
              value={tier}
              disabled={busy}
              onChange={(e) => setTier(e.target.value as AeroapiTier)}
            >
              {TIERS.map((id) => (
                <option key={id} value={id}>
                  {t(`${NS}.tiers.${id}`)}
                </option>
              ))}
            </Select>
          </Field>
          {tier === "custom" && (
            <Field label={t(`${NS}.customBudget`)} htmlFor="aeroapi-custom-budget">
              <Input
                id="aeroapi-custom-budget"
                inputMode="decimal"
                value={custom}
                disabled={busy}
                onChange={(e) => setCustom(e.target.value)}
              />
            </Field>
          )}
          <Button
            variant="primary"
            disabled={busy || !dirty}
            onClick={() =>
              void send({
                tier,
                customBudgetUsd: tier === "custom" ? customNumber : null,
              })
            }
          >
            {t(busy ? `${NS}.saving` : `${NS}.save`)}
          </Button>

          <p className="t-caption" data-testid="aeroapi-usage">
            {t(`${NS}.spent`, {
              month: state.usage.month,
              spent: usd(state.usage.spentUsd),
              budget: usd(state.usage.budgetUsd),
              calls: state.usage.calls,
            })}
          </p>
          {state.usage.exhausted && (
            <p role="status" data-testid="aeroapi-exhausted">
              {t(`${NS}.exhausted`)}
            </p>
          )}
          <p className="t-caption">
            {t(`${NS}.cost`, {
              flights: usd(state.costUsd.flights),
              track: usd(state.costUsd.track),
            })}
          </p>
          <p className="t-caption">{t(`${NS}.rateLimit`)}</p>

          <Switch
            id="aeroapi-tracks"
            checked={state.tracksEnabled}
            disabled={busy}
            onChange={(on) => void send({ tracksEnabled: on })}
            label={t(`${NS}.tracksTitle`)}
            sub={t(`${NS}.tracksSub`)}
          />
          {sweep && (
            <p className="t-caption" data-testid="aeroapi-sweep">
              {t(`${NS}.sweep.label`, { at: sweep.at.slice(0, 16).replace("T", " ") + " UTC" })}
              {": "}
              {t(`${NS}.sweep.status.${sweep.status}`)}
              {Object.keys(sweep.counts).length > 0 && (
                <>
                  {" — "}
                  {t(`${NS}.sweep.counts`, {
                    stored: sweep.counts.stored ?? 0,
                    has_track: sweep.counts.has_track ?? 0,
                    no_match: sweep.counts.no_match ?? 0,
                    no_track: sweep.counts.no_track ?? 0,
                    error: sweep.counts.error ?? 0,
                  })}
                </>
              )}
            </p>
          )}
          {saved && <p role="status">{t(`${NS}.saved`)}</p>}
        </>
      )}
      {error && <p role="alert">{t(error)}</p>}
    </div>
  );
}
