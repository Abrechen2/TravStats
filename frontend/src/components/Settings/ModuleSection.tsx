import { JSX } from "react";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { DOMAIN_KEYS, DOMAINS, type DomainKey } from "../../shared/domains";
import { useSettingsStore } from "../../store/settingsStore";
import { useTranslation } from "../../hooks/useTranslation";

export default function ModuleSection(): JSX.Element {
  const { t } = useTranslation("common");
  const enabledDomains = useSettingsStore((s) => s.enabledDomains);
  const setEnabledDomains = useSettingsStore((s) => s.setEnabledDomains);

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
      <ul className="space-y-2">
        {DOMAIN_KEYS.map((key) => {
          const d = DOMAINS[key];
          const enabled = enabledDomains.includes(key);
          return (
            <li
              key={key}
              // The whole tile toggles, not just the small switch (UAT
              // finding B9). The switch stays the accessible control and
              // stops propagation so its own click doesn't toggle twice.
              onClick={() => toggle(key)}
              className={`rounded-lg p-4 flex items-center gap-4 ${
                d.available ? "cursor-pointer" : ""
              }`}
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0"
                style={{ backgroundColor: `${d.color}22` }}
                aria-hidden
              >
                {d.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className="font-medium flex items-center gap-2"
                  style={{ color: "var(--text-primary)" }}
                >
                  <span>{t(d.i18nKey)}</span>
                  {!d.available && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: "var(--bg-elevated)",
                        color: "var(--text-muted)",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      {t("settings.modules.comingSoon")}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={d.i18nKey}
                disabled={!d.available}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(key);
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden shrink-0 ${
                  enabled ? "bg-(--accent)" : "bg-gray-600"
                } ${d.available ? "" : "opacity-50 cursor-not-allowed"}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    enabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
