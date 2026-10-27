import { JSX } from "react";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { DOMAIN_KEYS, DOMAINS, type DomainKey } from "../../shared/domains";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { switchableDomains } from "../../config/domainBetaGates";
import { useSettingsStore } from "../../store/settingsStore";
import { useDomainColorStore } from "../../store/domainColorStore";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { isBrandDefault, needsOutline } from "../../lib/domainColor";
import { Switch } from "../ui/Field";
import { SettingRows } from "../ui/SettingRow";
import TravPlanModuleRow from "./TravPlanModuleRow";

/**
 * "Bereiche & Farben": one row per domain — the switch that turns it on and
 * its colour right beside it (forgejo#321).
 *
 * These were two sections, "Bereiche" and "Farben", listing the same domains
 * twice a screen apart, and a tester looked for the colour of a domain under
 * the domain. A switched-off domain keeps its row: it is where the reader turns
 * it on, and its colour can be chosen before it is.
 *
 * The colour reaches everything that is not the map — statistics, the trip
 * timeline, the activity sidebar, the import log (#270). The map keeps its own
 * per-mode palettes on purpose ("switching modes back and forth never clobbers
 * a colour the user picked for another mode"); the note under the rows says so.
 */
export default function ModuleSection(): JSX.Element {
  const { t } = useTranslation("common");
  const { colors } = useDomainColors();
  const setColor = useDomainColorStore((s) => s.setColor);
  const resetToBrand = useDomainColorStore((s) => s.resetToBrand);
  const enabledDomains = useSettingsStore((s) => s.enabledDomains);
  const setEnabledDomains = useSettingsStore((s) => s.setEnabledDomains);
  const coarse = useCoarsePointer();

  // Every domain, since 2026-09-05; a domain behind a beta switch by the
  // switch ALONE (never behind "already enabled" — this list is where the user
  // turns a domain on), see `switchableDomains`. Reads the stored choice raw,
  // so a domain hidden by a closed switch is not dropped by the next toggle.
  const { isFeatureVisible } = useBetaFeatures();
  const visibleKeys = switchableDomains(DOMAIN_KEYS, enabledDomains, isFeatureVisible);

  const toggle = (key: DomainKey): void => {
    if (!DOMAINS[key].available) return;
    const next = enabledDomains.includes(key)
      ? enabledDomains.filter((k) => k !== key)
      : [...enabledDomains, key];
    setEnabledDomains(next);
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:domains.title")}
        description={t("settings:domains.description")}
      />
      <SettingRows>
        {visibleKeys.map((key) => {
          const d = DOMAINS[key];
          const name = t(d.i18nKey);
          const on = enabledDomains.includes(key);
          return (
            // A switched-off domain keeps its row, dimmed as a whole — switch,
            // name and colour alike (forgejo#321 prototype) — and stays operable.
            <div
              key={key}
              data-domain-row={key}
              data-domain-on={on ? "true" : "false"}
              className="ts-setting-row flex items-center"
              style={{ gap: 12, opacity: on ? 1 : 0.5 }}
            >
              {/* The Switch is a label around its input, so the whole text
                  toggles — the finding UAT B9 asked for — without a second
                  click handler that could fire twice. */}
              <div className="min-w-0 flex-1">
                <Switch
                  id={`module-${key}`}
                  checked={on}
                  disabled={!d.available}
                  onChange={() => toggle(key)}
                  label={name}
                  sub={
                    d.available
                      ? t(`settings.modules.sub.${key}`)
                      : t("settings.modules.comingSoon")
                  }
                />
              </div>
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
            </div>
          );
        })}
        {/* Not a domain, switched like one (owner, 2026-10-27). */}
        <TravPlanModuleRow />
      </SettingRows>

      {/* A colour close to the app's own ground is a legitimate choice, and it
          is also nearly invisible on a chart. Say so once; do not quietly
          brighten what the user picked. */}
      {visibleKeys.some((key) => needsOutline(colors[key])) && (
        <p className="t-caption">{t("settings:domainColors.lowContrast")}</p>
      )}
      <p className="t-caption">{t("settings:domainColors.mapNote")}</p>
      {!isBrandDefault(colors) && (
        <button type="button" onClick={resetToBrand} className="btn-secondary self-start">
          {t("settings:domainColors.reset")}
        </button>
      )}
    </SectionCard>
  );
}
