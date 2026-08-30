import type { JSX } from "react";

import { SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useDomainColorStore } from "../../store/domainColorStore";
import { isBrandDefault, needsOutline } from "../../lib/domainColor";
import { AVAILABLE_DOMAINS, DOMAINS } from "../../shared/domains";

/**
 * One colour per domain, for everywhere that is not the map.
 *
 * It sits in Display rather than in the map's appearance panel on purpose: the
 * colours reach the statistics, the trip timeline, the activity sidebar and the
 * import log, and filing them under "map" is how they came to reach nothing
 * outside the map (#270).
 *
 * The map is deliberately NOT wired to this. Its four colour stores keep their
 * own per-mode palettes, and their own comment explains why the slots are
 * independent: "switching modes back and forth never clobbers a colour the user
 * picked for another mode". Binding `solid` to this value would reintroduce
 * exactly the implicit override 2.4.0 removed. The note in the panel says so,
 * rather than leaving someone to wonder why the map did not follow.
 */
export default function DomainColorSection(): JSX.Element | null {
  const { t } = useTranslation(["settings", "common"]);
  const { colors, customisable } = useDomainColors();
  const setColor = useDomainColorStore((s) => s.setColor);
  const resetToBrand = useDomainColorStore((s) => s.resetToBrand);

  // The gate covers the value as well as this panel, so with it closed there is
  // nothing here to show and nothing that could have been changed.
  if (!customisable) return null;

  return (
    <div className="mt-8">
      <SectionTitle
        title={t("settings:domainColors.title")}
        description={t("settings:domainColors.description")}
      />

      <div className="max-w-md space-y-3">
        {AVAILABLE_DOMAINS.map((key) => {
          const hex = colors[key];
          return (
            <div key={key} className="flex items-center gap-3">
              <span aria-hidden className="w-6 text-center text-lg">
                {DOMAINS[key].icon}
              </span>
              <label htmlFor={`domain-color-${key}`} className="flex-1 text-sm">
                {t(`common:${DOMAINS[key].i18nKey}`)}
              </label>
              <code className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                {hex}
              </code>
              <input
                id={`domain-color-${key}`}
                type="color"
                value={hex}
                onChange={(e) => setColor(key, e.target.value)}
                className="h-8 w-12 cursor-pointer rounded border p-0"
                style={{
                  borderColor: "var(--color-border)",
                  background: "transparent",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* A colour close to the app's own ground is a legitimate choice, and it
          is also nearly invisible on a chart. Say so once; do not quietly
          brighten what the user picked. */}
      {AVAILABLE_DOMAINS.some((key) => needsOutline(colors[key])) && (
        <p className="mt-3 max-w-md text-xs" style={{ color: "var(--text-muted)" }}>
          {t("settings:domainColors.lowContrast")}
        </p>
      )}

      <p className="mt-3 max-w-md text-xs" style={{ color: "var(--text-muted)" }}>
        {t("settings:domainColors.mapNote")}
      </p>

      {!isBrandDefault(colors) && (
        <button
          type="button"
          onClick={resetToBrand}
          className="mt-3 rounded-md border px-3 py-1 text-sm"
          style={{ borderColor: "var(--color-border)", color: "var(--text-secondary)" }}
        >
          {t("settings:domainColors.reset")}
        </button>
      )}
    </div>
  );
}
