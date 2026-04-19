import { JSX } from "react";
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
    <section aria-labelledby="modules-heading" className="settings-section">
      <h2 id="modules-heading" className="settings-section-title">
        {t("settings.modules.title")}
      </h2>
      <p className="settings-section-desc">{t("settings.modules.desc")}</p>
      <ul className="settings-modules-list">
        {DOMAIN_KEYS.map((key) => {
          const d = DOMAINS[key];
          const enabled = enabledDomains.includes(key);
          return (
            <li key={key} className="settings-module-row">
              <div
                className="settings-module-icon"
                style={{ backgroundColor: `${d.color}22` }}
                aria-hidden
              >
                {d.icon}
              </div>
              <div className="settings-module-meta">
                <div className="settings-module-title">
                  {t(d.i18nKey)}
                  {!d.available && (
                    <span className="settings-module-badge">
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
                onClick={() => toggle(key)}
                className={`settings-toggle ${enabled ? "on" : ""} ${
                  d.available ? "" : "disabled"
                }`}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
