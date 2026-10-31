import { useEffect, useState } from "react";
import type { JSX } from "react";
import { travplanApi, travPlanErrorKey } from "../../lib/api/travplan";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { Field, Input, Switch } from "../ui/Field";
import { Button } from "../ui";
import { useExpertRows } from "../Settings/frame/useExpertRows";
import { AdminSubBlock } from "./AdminSubBlock";
import { SectionCard, SectionTitle } from "../Settings/SettingsShared";
import { useCapabilitiesEpochStore } from "../../store/capabilitiesEpochStore";

const NS = "admin:travPlan";
const LIMIT_MAX = { aiDailyLimit: 100, weatherDailyLimit: 200 } as const;
type LimitKey = keyof typeof LIMIT_MAX;
type Limits = Record<LimitKey, number>;

/**
 * Admin → Instanz → TravPlan (owner, 2026-10-26): the instance switch for the
 * planning mode, as TravTrack has one. The section is registered behind the
 * `travPlan` beta key (`adminSections.ts`), so it is only drawn while the
 * server would accept the save at all.
 *
 * The one canonical instance form (settings redesign, rule 4; `/plan/admin`
 * only links here): the switch is standard, the per-account daily request
 * limits for AI and weather are expert. Each part saves alone — `{enabled}`
 * or the limits — so a switch flipped here never writes back limits loaded
 * minutes ago, and a failed save of either stays visible on this card.
 */
export default function TravPlanSettings(): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [savedLimits, setSavedLimits] = useState<Limits | null>(null);
  const [limitsBusy, setLimitsBusy] = useState(false);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const expert = useExpertRows(1);
  const bumpCapabilities = useCapabilitiesEpochStore((s) => s.bump);

  useEffect(() => {
    let alive = true;
    travplanApi.config().then(
      (config) => {
        if (!alive) return;
        setEnabled(config.enabled);
        const loaded = {
          aiDailyLimit: config.aiDailyLimit,
          weatherDailyLimit: config.weatherDailyLimit,
        };
        setLimits(loaded);
        setSavedLimits(loaded);
      },
      (err: unknown) => {
        logger.error("Loading the TravPlan switch failed:", err);
        if (alive) setError(t(`${NS}.errors.loadFailed`));
      }
    );
    return () => {
      alive = false;
    };
  }, [t]);

  const toggle = async (on: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setEnabled((await travplanApi.setConfig({ enabled: on })).enabled);
      bumpCapabilities("travPlan");
    } catch (err) {
      logger.error("Saving the TravPlan switch failed:", err);
      setError(t(travPlanErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const limitsValid =
    limits !== null &&
    (Object.keys(LIMIT_MAX) as LimitKey[]).every(
      (k) => Number.isInteger(limits[k]) && limits[k] >= 0 && limits[k] <= LIMIT_MAX[k]
    );
  const limitsDirty =
    limits !== null &&
    savedLimits !== null &&
    (limits.aiDailyLimit !== savedLimits.aiDailyLimit ||
      limits.weatherDailyLimit !== savedLimits.weatherDailyLimit);

  const saveLimits = async (): Promise<void> => {
    if (!limits || !limitsValid) return;
    setLimitsBusy(true);
    setLimitsError(null);
    try {
      const next = await travplanApi.setConfig(limits);
      const confirmed = {
        aiDailyLimit: next.aiDailyLimit,
        weatherDailyLimit: next.weatherDailyLimit,
      };
      setLimits(confirmed);
      setSavedLimits(confirmed);
    } catch (err) {
      logger.error("Saving the TravPlan limits failed:", err);
      setLimitsError(t(travPlanErrorKey(err)));
    } finally {
      setLimitsBusy(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} description={t(`${NS}.description`)} />
      {enabled !== null && (
        <>
          <Switch
            id="travplan-enabled"
            checked={enabled}
            disabled={busy}
            onChange={(on) => void toggle(on)}
            label={t(`${NS}.switch`)}
            sub={t(`${NS}.switchSub`)}
          />
          <p className="t-caption">{t(`${NS}.defaultsNote`)}</p>
        </>
      )}
      {expert && limits !== null && (
        <AdminSubBlock expert title={t(`${NS}.limits.title`)}>
          <p className="t-caption mb-2">{t(`${NS}.limits.help`)}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(["aiDailyLimit", "weatherDailyLimit"] as const).map((key) => (
              <Field
                key={key}
                label={t(`${NS}.limits.${key}`)}
                htmlFor={`travplan-${key}`}
                error={
                  limits[key] > LIMIT_MAX[key]
                    ? t(`${NS}.limits.tooHigh`, { max: LIMIT_MAX[key] })
                    : undefined
                }
              >
                <Input
                  id={`travplan-${key}`}
                  type="number"
                  min={0}
                  max={LIMIT_MAX[key]}
                  value={Number.isNaN(limits[key]) ? "" : limits[key]}
                  onChange={(e) => setLimits({ ...limits, [key]: e.target.valueAsNumber })}
                />
              </Field>
            ))}
          </div>
          <Button
            variant="primary"
            disabled={!limitsDirty || !limitsValid || limitsBusy}
            onClick={() => void saveLimits()}
          >
            {t(`${NS}.limits.save`)}
          </Button>
          {limitsError && (
            <p role="alert">
              {limitsError}{" "}
              <button type="button" className="underline" onClick={() => void saveLimits()}>
                {t(`${NS}.limits.retry`)}
              </button>
            </p>
          )}
        </AdminSubBlock>
      )}
      {error && <p role="alert">{error}</p>}
    </SectionCard>
  );
}
