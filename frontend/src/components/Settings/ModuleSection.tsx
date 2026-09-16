import { JSX } from "react";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { DOMAIN_KEYS, DOMAINS, type DomainKey } from "../../shared/domains";
import { useSettingsStore } from "../../store/settingsStore";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { Switch } from "../ui/Field";
import { SettingRows } from "../ui/SettingRow";

export default function ModuleSection(): JSX.Element {
  const { t } = useTranslation("common");
  const { colorOf } = useDomainColors();
  const enabledDomains = useSettingsStore((s) => s.enabledDomains);
  const setEnabledDomains = useSettingsStore((s) => s.setEnabledDomains);

  // Every domain, since 2026-09-05. Places sat behind the instance beta flag
  // here (never behind "already enabled" — this list is where the user turns
  // a domain on) until its gate's own condition was met.
  const visibleKeys = DOMAIN_KEYS;

  const toggle = (key: DomainKey): void => {
    if (!DOMAINS[key].available) return;
    const next = enabledDomains.includes(key)
      ? enabledDomains.filter((k) => k !== key)
      : [...enabledDomains, key];
    setEnabledDomains(next);
  };

  return (
    <SectionCard>
      <SectionTitle title={t("settings.modules.title")} description={t("settings.modules.desc")} />
      {/* One switch row per domain. The Switch is a label around its input, so
          the whole row toggles — the finding UAT B9 asked for — without a
          second click handler that could fire twice. */}
      <SettingRows>
        {visibleKeys.map((key) => {
          const d = DOMAINS[key];
          return (
            <div key={key} className="ts-setting-row">
              <Switch
                id={`module-${key}`}
                checked={enabledDomains.includes(key)}
                disabled={!d.available}
                onChange={() => toggle(key)}
                label={t(d.i18nKey)}
                sub={
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "var(--ts-radius-pill)",
                        background: colorOf(d.key),
                      }}
                    />
                    {d.available
                      ? t(`settings.modules.sub.${key}`)
                      : t("settings.modules.comingSoon")}
                  </span>
                }
              />
            </div>
          );
        })}
      </SettingRows>
    </SectionCard>
  );
}
