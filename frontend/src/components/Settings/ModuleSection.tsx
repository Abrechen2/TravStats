import { type JSX } from "react";
import { useInRouterContext } from "react-router-dom";
import { DOMAIN_KEYS, DOMAINS, type DomainKey } from "../../shared/domains";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { switchableDomains } from "../../config/domainBetaGates";
import { useSettingsStore } from "../../store/settingsStore";
import { useDomainColorStore } from "../../store/domainColorStore";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { isBrandDefault, needsOutline } from "../../lib/domainColor";
import { SectionCard } from "./SettingsShared";
import { SettingRows } from "../ui/SettingRow";
import {
  ActionControl,
  JumpControl,
  SettingItem,
  SwitchControl,
  useSettingWrite,
} from "../ui/settings";
import { saveDomainEnabled } from "../../store/confirmedSettings";
import { useGuardedNavigate } from "../ui/settings";
import FirstVisitCard from "./FirstVisitCard";

/** Domains that have a page of their own under Reisearten. */
const DOMAIN_PAGE: Partial<Record<DomainKey, "flight" | "cruise">> = {
  flight: "flight",
  cruise: "cruise",
};

/** The jump to a type's own settings; needs the router, which a bare render may lack. */
function DomainJump({ page }: { page: "flight" | "cruise" }): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const navigate = useGuardedNavigate();
  return (
    <JumpControl
      label={t("settings:rows.domainJump")}
      onJump={() => navigate(`/settings/${page}`)}
    />
  );
}

/** One travel type: its own write, so a refusal is shown and retried on this row. */
function DomainRow({ domain }: { domain: DomainKey }): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const { colors } = useDomainColors();
  const setColor = useDomainColorStore((s) => s.setColor);
  const coarse = useCoarsePointer();
  const isDemo = useIsDemoAccount();
  const inRouter = useInRouterContext();
  const isOn = useSettingsStore((s) => s.enabledDomains.includes(domain));
  const key = domain;
  const d = DOMAINS[key];
  const enabled = useSettingWrite<boolean>(`domains.${key}`, isOn, (on) =>
    saveDomainEnabled(key, on)
  );
  const name = t(d.i18nKey, { ns: "common" });
  const on = enabled.value;
  const page = DOMAIN_PAGE[key];
  return (
    <div
      data-domain-row={key}
      data-domain-on={on ? "true" : "false"}
      style={{ opacity: on ? 1 : 0.5 }}
    >
      <SettingItem
        save={enabled}
        title={
          <span className="inline-flex items-center" style={{ gap: 8 }}>
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: colors[key],
                flexShrink: 0,
              }}
            />
            {name}
          </span>
        }
        name={name}
        sub={
          d.available
            ? t(`settings.modules.sub.${key}`, { ns: "common" })
            : t("settings.modules.comingSoon", { ns: "common" })
        }
        locked={
          !d.available
            ? {
                why: "dependency",
                reason: t("settings.modules.comingSoon", { ns: "common" }),
              }
            : isDemo
              ? { why: "demo", reason: t("settings:blocks.lock.demo") }
              : undefined
        }
        control={
          <>
            <SwitchControl checked={enabled.value} onChange={enabled.choose} label={name} />
            <input
              id={`domain-color-${key}`}
              type="color"
              aria-label={`${name} – ${t("settings:domains.color")}`}
              value={colors[key]}
              disabled={!d.available}
              onChange={(e) => setColor(key, e.target.value)}
              className="cursor-pointer rounded p-0"
              style={{
                flexShrink: 0,
                width: coarse ? 52 : 44,
                height: coarse ? "var(--ts-size-touch-min)" : 32,
                border: "1px solid var(--ts-border-button)",
                background: "transparent",
              }}
            />
            {page && on && inRouter && <DomainJump page={page} />}
          </>
        }
      />
    </div>
  );
}

/**
 * "Was du festhältst": one row per travel type — its colour dot, the switch,
 * the colour, and a jump to its own settings where it has any. A switched-off
 * type stays here, dimmed, so it can be switched on again. Writes go through
 * the settings store, which puts the switch back and says so when the server
 * refuses it.
 */
export default function ModuleSection(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const { colors } = useDomainColors();
  const resetToBrand = useDomainColorStore((s) => s.resetToBrand);
  const enabledDomains = useSettingsStore((s) => s.enabledDomains);
  const { isFeatureVisible } = useBetaFeatures();
  const visibleKeys = switchableDomains(DOMAIN_KEYS, enabledDomains, isFeatureVisible);

  return (
    <div className="space-y-4">
      <FirstVisitCard />
      <SectionCard>
        <SettingRows>
          {visibleKeys.map((key) => (
            <DomainRow key={key} domain={key} />
          ))}
        </SettingRows>

        {/* A colour close to the app's own ground is a legitimate choice, and it
            is also nearly invisible on a chart. Say so once; do not quietly
            brighten what the user picked. */}
        {visibleKeys.some((key) => needsOutline(colors[key])) && (
          <p className="t-caption">{t("settings:domainColors.lowContrast")}</p>
        )}
        {!isBrandDefault(colors) && (
          <SettingItem
            title={t("settings:rows.resetColors.name")}
            help={t("settings:rows.resetColors.help")}
            control={
              <ActionControl label={t("settings:rows.resetColors.name")} onClick={resetToBrand} />
            }
          />
        )}
      </SectionCard>
    </div>
  );
}
