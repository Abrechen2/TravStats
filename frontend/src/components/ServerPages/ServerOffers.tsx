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
export default function ServerOffers(): JSX.Element {
  return <InstanceGate>{(settings) => <Offers settings={settings} />}</InstanceGate>;
}

function focusBeta(): void {
  const el = document.getElementById("server-beta-switch");
  if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" });
  el?.focus();
}

function Offers({ settings }: { settings: InstanceSettings }): JSX.Element {
  const { t } = useTranslation(["settingsRows", "passport", "admin"]);
  const row = useRowCopy("server");
  const { isFeatureVisible } = useBetaFeatures();
  const patch = useInstanceStore((s) => s.patch);
  const bump = useCapabilitiesEpochStore((s) => s.bump);
  const expert = useExpertRows(1);
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
  const tl = row("tplimits");
  const cs = row("laenderstd");
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
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
      <SettingItem
        title={tt.title}
        sub={tt.sub}
        scope="allAccounts"
        save={track}
        dependency={trackOffered ? undefined : needsBeta}
        control={<SwitchControl checked={track.value} onChange={track.choose} label={tt.title} />}
      />
      <SettingItem
        title={tp.title}
        help={tp.help}
        scope="allAccounts"
        save={plan}
        dependency={planOffered ? undefined : needsBeta}
        control={<SwitchControl checked={plan.value} onChange={plan.choose} label={tp.title} />}
      />
      {expert && planOffered && limitsSaved ? (
        <SettingItem title={tl.title} sub={tl.sub} scope="allAccounts" expert>
          <div className="flex flex-wrap items-start" style={{ gap: "var(--ts-space-lg)" }}>
            {(["ai", "weather"] as const).map((key) => (
              <label key={key} className="flex flex-col t-caption" style={{ gap: 4 }}>
                {t(`settingsRows:server.limit.${key}`)}
                <LimitInput
                  value={limits.draft[key]}
                  invalid={limitProblem(key) !== undefined}
                  onChange={(next) => limits.edit({ [key]: next })}
                />
                {limitProblem(key) ? <ErrorLine>{limitProblem(key)!}</ErrorLine> : null}
              </label>
            ))}
          </div>
          <GroupFooter
            group={limits}
            disabled={limitProblem("ai") !== undefined || limitProblem("weather") !== undefined}
          />
        </SettingItem>
      ) : null}
      {loadFailed ? <ErrorLine>{t("settingsRows:server.offersLoadFailed")}</ErrorLine> : null}
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
    </div>
  );
}

function LimitInput({
  value,
  invalid,
  onChange,
}: {
  value: string;
  invalid: boolean;
  onChange: (next: string) => void;
}): JSX.Element {
  // A plain field: the row around it is the group, not one value.
  return (
    <input
      type="number"
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
  const value: ImportChoice = active ? (mode.userId ? "one" : "all") : picking ? "one" : "off";
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
            } else if (next === "all") void run({ enabled: true, userId: null });
            else if (active && mode.userId) return;
            else setPicking(true);
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
      {picking && !active ? (
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
