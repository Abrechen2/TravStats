import { useEffect, useState, type JSX } from "react";
import { adminApi, type ImportModeState } from "../../lib/api";
import { travplanApi } from "../../lib/api/travplan";
import { travTrackApi } from "../../lib/api/travtrack";
import { COUNTRY_TIER_CHOICES, type CountryTier } from "../../types/passport";
import { formatDateTime } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useTranslation } from "../../hooks/useTranslation";
import { useCapabilitiesEpochStore } from "../../store/capabilitiesEpochStore";
import { useExpertRows } from "../Settings/frame/useExpertRows";
import { useRowCopy } from "../Settings/rowCopy";
import BetaFeatureList from "../Admin/BetaFeatureList";
import Button from "../ui/Button";
import { Select } from "../ui/Field";
import {
  ChoiceControl,
  ErrorLine,
  SettingItem,
  SwitchControl,
  useGroupSave,
  useSettingWrite,
} from "../ui/settings";
import GroupFooter from "./GroupFooter";
import InstanceGate from "./InstanceGate";
import { useInstanceStore } from "./instanceStore";
import type { InstanceSettings } from "../../lib/api/admin";

const LIMIT_MAX = { ai: 100, weather: 200 } as const;
type Limits = Record<keyof typeof LIMIT_MAX, string>;

/**
 * Server › Was der Server anbietet (design C1): the beta switch, the two
 * optional modules, the country default and the import mode. Switches write at
 * once and keep the user's choice when a write fails; the planning limits are a
 * small group of their own.
 */
export default function ServerOffers({ part = "all" }: { part?: OffersPart }): JSX.Element {
  return <InstanceGate>{(settings) => <Offers settings={settings} part={part} />}</InstanceGate>;
}

/**
 * Which rows of the page are drawn. Settings v3 splits the old page: TravTrack's
 * offer and TravPlan's offer with its limits each have a page of their own
 * ("Bereitstellung"), what is left is "Funktionen". `all` is the old page.
 */
export type OffersPart = "all" | "rest" | "track" | "plan";

function focusBeta(): void {
  const el = document.getElementById("server-beta-switch");
  if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" });
  el?.focus();
}

function Offers({ settings, part }: { settings: InstanceSettings; part: OffersPart }): JSX.Element {
  const { t } = useTranslation(["settingsRows", "passport", "admin"]);
  const row = useRowCopy("server");
  const { isFeatureVisible } = useBetaFeatures();
  const patch = useInstanceStore((s) => s.patch);
  const bump = useCapabilitiesEpochStore((s) => s.bump);
  const showTrack = part === "all" || part === "track";
  const showPlan = part === "all" || part === "plan";
  const showRest = part === "all" || part === "rest";
  // The two plan limits are the expert rows of this page.
  const expert = useExpertRows(showPlan ? 2 : 0);
  const trackOffered = isFeatureVisible("travTrack");
  const planOffered = isFeatureVisible("travPlan");

  const [trackSaved, setTrackSaved] = useState<boolean | null>(null);
  const [planSaved, setPlanSaved] = useState<boolean | null>(null);
  const [limitsSaved, setLimitsSaved] = useState<Limits | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const fail = (error: unknown): void => {
      logger.error("Loading the module switches failed:", error);
      if (alive) setLoadFailed(true);
    };
    if (trackOffered) {
      travTrackApi.config().then((c) => alive && setTrackSaved(c.enabled), fail);
    }
    if (planOffered) {
      travplanApi.config().then((c) => {
        if (!alive) return;
        setPlanSaved(c.enabled);
        setLimitsSaved({ ai: String(c.aiDailyLimit), weather: String(c.weatherDailyLimit) });
      }, fail);
    }
    return () => {
      alive = false;
    };
  }, [trackOffered, planOffered]);

  const beta = useSettingWrite<boolean>("server:beta", settings.betaFeaturesEnabled, async (on) => {
    await patch({ betaFeaturesEnabled: on });
  });
  const track = useSettingWrite<boolean>("server:ttoffer", trackSaved ?? false, async (on) => {
    const next = await travTrackApi.setConfig({ enabled: on });
    setTrackSaved(next.enabled);
    bump("travTrack");
  });
  const plan = useSettingWrite<boolean>("server:tpoffer", planSaved ?? false, async (on) => {
    const next = await travplanApi.setConfig({ enabled: on });
    setPlanSaved(next.enabled);
    bump("travPlan");
  });
  const country = useSettingWrite<CountryTier>(
    "server:laenderstd",
    settings.countryThreshold,
    async (tier) => {
      await patch({ countryThreshold: tier });
    }
  );

  const limits = useGroupSave<Limits>({
    id: "server-planlimits",
    label: t("settingsRows:server.groups.planLimits"),
    saved: limitsSaved ?? { ai: "", weather: "" },
    write: async (draft) => {
      const next = await travplanApi.setConfig({
        aiDailyLimit: Number(draft.ai),
        weatherDailyLimit: Number(draft.weather),
      });
      const confirmed = { ai: String(next.aiDailyLimit), weather: String(next.weatherDailyLimit) };
      setLimitsSaved(confirmed);
      return confirmed;
    },
  });
  const limitProblem = (key: keyof Limits): string | undefined => {
    const n = Number(limits.draft[key]);
    if (limits.draft[key].trim() === "" || !Number.isInteger(n) || n < 0 || n > LIMIT_MAX[key]) {
      return t("settingsRows:server.errors.limit", { max: LIMIT_MAX[key] });
    }
    return undefined;
  };

  const needsBeta = {
    reason: t("settingsRows:server.deps.needsBeta"),
    jump: { label: t("settingsRows:server.deps.needsBetaJump"), onJump: focusBeta },
  };

  const b = row("beta");
  const tt = row("ttoffer");
  const tp = row("tpoffer");
  const cs = row("laenderstd");
  const limitItem = (key: keyof Limits, footer: boolean): JSX.Element => (
    <SettingItem
      expert
      title={t(`settingsRows:server.limit.${key}`)}
      scope="allAccounts"
      control={
        <LimitInput
          label={t(`settingsRows:server.limit.${key}`)}
          value={limits.draft[key]}
          invalid={limitProblem(key) !== undefined}
          onChange={(next) => limits.edit({ [key]: next })}
        />
      }
    >
      {limitProblem(key) ? <ErrorLine>{limitProblem(key)}</ErrorLine> : null}
      {footer ? (
        <GroupFooter
          group={limits}
          disabled={limitProblem("ai") !== undefined || limitProblem("weather") !== undefined}
        />
      ) : null}
    </SettingItem>
  );
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      {showRest ? (
        <SettingItem
          title={b.title}
          sub={b.sub}
          scope="allAccounts"
          controlId="server-beta-switch"
          save={beta}
          control={<SwitchControl checked={beta.value} onChange={beta.choose} />}
        >
          {/* Derived from the registry, so it cannot drift from what the switch gates. */}
          <BetaFeatureList />
        </SettingItem>
      ) : null}
      {showTrack ? (
        <SettingItem
          title={tt.title}
          sub={tt.sub}
          scope="allAccounts"
          save={track}
          dependency={trackOffered ? undefined : needsBeta}
          control={<SwitchControl checked={track.value} onChange={track.choose} label={tt.title} />}
        />
      ) : null}
      {showPlan ? (
        <SettingItem
          title={tp.title}
          sub={tp.sub}
          help={tp.help}
          scope="allAccounts"
          save={plan}
          dependency={planOffered ? undefined : needsBeta}
          control={<SwitchControl checked={plan.value} onChange={plan.choose} label={tp.title} />}
        />
      ) : null}
      {showPlan && expert && planOffered && limitsSaved ? (
        <>
          {limitItem("ai", false)}
          {limitItem("weather", true)}
        </>
      ) : null}
      {loadFailed ? <ErrorLine>{t("settingsRows:server.offersLoadFailed")}</ErrorLine> : null}
      {showRest ? (
        <>
          <SettingItem
            title={cs.title}
            sub={cs.sub}
            scope="allAccounts"
            save={country}
            control={
              <ChoiceControl<CountryTier>
                label={cs.title}
                value={country.value}
                options={COUNTRY_TIER_CHOICES.map((tier) => ({
                  value: tier,
                  label: t(`passport:tiers.${tier}`),
                }))}
                onChange={country.choose}
              />
            }
          />
          <ImportModeRow />
        </>
      ) : null}
    </div>
  );
}

function LimitInput({
  label,
  value,
  invalid,
  onChange,
}: {
  label: string;
  value: string;
  invalid: boolean;
  onChange: (next: string) => void;
}): JSX.Element {
  // A plain field: the row around it is the group, not one value.
  return (
    <input
      type="number"
      aria-label={label}
      min={0}
      inputMode="numeric"
      className="ts-control"
      aria-invalid={invalid || undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: 120 }}
    />
  );
}

type ImportChoice = "off" | "all" | "one";

/**
 * Import mode (forgejo#304): the upload and import limits are lifted for 24
 * hours, for every account or one; it ends by itself. Starting and stopping are
 * real writes, so a refusal is said under the row.
 */
function ImportModeRow(): JSX.Element {
  const { t } = useTranslation(["settingsRows", "admin"]);
  const row = useRowCopy("server");
  const copy = row("importmodus");
  const [mode, setMode] = useState<ImportModeState | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; username: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<"load" | "save" | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([adminApi.getImportMode(), adminApi.getUsers()]).then(
      ([state, { users }]) => {
        if (!alive) return;
        setMode(state);
        setAccounts(users.filter((u) => u.isActive).map(({ id, username }) => ({ id, username })));
      },
      (error: unknown) => {
        logger.error("Loading the import mode failed:", error);
        if (alive) setFailure("load");
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  const run = async (body: Parameters<typeof adminApi.setImportMode>[0]): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      setMode(await adminApi.setImportMode(body));
      setPicking(false);
    } catch (error) {
      logger.error("Saving the import mode failed:", error);
      setFailure("save");
    } finally {
      setBusy(false);
    }
  };

  if (!mode) {
    return failure === "load" ? <ErrorLine>{t("admin:importMode.loadFailed")}</ErrorLine> : <></>;
  }
  const active = mode.until !== null;
  const value: ImportChoice = picking ? "one" : active ? (mode.userId ? "one" : "all") : "off";
  const covered = mode.userId ? accounts.find((a) => a.id === mode.userId)?.username : null;
  return (
    <SettingItem
      title={copy.title}
      sub={copy.sub}
      help={copy.help}
      scope="allAccounts"
      error={failure === "save" ? t("admin:importMode.saveFailed") : undefined}
      control={
        <ChoiceControl<ImportChoice>
          label={copy.title}
          value={value}
          options={[
            { value: "off", label: t("settingsRows:server.importMode.off") },
            { value: "all", label: t("settingsRows:server.importMode.all") },
            { value: "one", label: t("settingsRows:server.importMode.one") },
          ]}
          onChange={(next) => {
            if (busy) return;
            if (next === "off") {
              setPicking(false);
              if (active) void run({ enabled: false });
            } else if (next === "all") {
              setPicking(false);
              void run({ enabled: true, userId: null });
            } else if (!(active && mode.userId)) setPicking(true);
          }}
        />
      }
    >
      {active && mode.until ? (
        <p role="status" className="t-caption" style={{ margin: 0 }}>
          {mode.userId
            ? t("admin:importMode.activeFor", {
                until: formatDateTime(mode.until),
                account: covered ?? t("admin:importMode.unknownAccount"),
              })
            : t("admin:importMode.activeAll", { until: formatDateTime(mode.until) })}
        </p>
      ) : null}
      {picking ? (
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
          <Select
            aria-label={t("admin:importMode.account")}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">{t("settingsRows:server.importMode.choose")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.username}
              </option>
            ))}
          </Select>
          <Button
            variant="primary"
            disabled={busy || target === ""}
            onClick={() => void run({ enabled: true, userId: target })}
          >
            {t("admin:importMode.start", { hours: mode.hours })}
          </Button>
        </div>
      ) : null}
    </SettingItem>
  );
}
