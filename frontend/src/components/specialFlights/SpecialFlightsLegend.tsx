/**
 * Small legend rendered on the map when at least one flight has a
 * specialType set. Communicates which colour/shape means which kind
 * of Sonder-Flug.
 */
import { useTranslation } from "../../hooks/useTranslation";
import { SPECIAL_TYPE_META, SPECIAL_TYPES, rgbToCss } from "./specialTypeMeta";
import type { SpecialType } from "./specialTypeMeta";

interface Props {
  /** Only render entries whose specialType is actually present in the
   *  current flight set — keeps the legend short. */
  presentTypes: ReadonlySet<SpecialType>;
}

export default function SpecialFlightsLegend({ presentTypes }: Props): JSX.Element | null {
  const { t } = useTranslation(["specialFlights"]);
  const visible = SPECIAL_TYPES.filter((k) => presentTypes.has(k));
  if (visible.length === 0) return null;

  return (
    <div
      className="absolute bottom-4 left-4 z-10 rounded-lg px-3 py-2 text-[10px]"
      style={{
        background: "rgba(13, 17, 23, 0.78)",
        border: "1px solid var(--color-border)",
        color: "var(--text-muted)",
        backdropFilter: "blur(10px)",
        maxWidth: 220,
      }}
      aria-label={t("specialFlights:legend.label")}
    >
      <div
        className="text-[10px] uppercase tracking-wider mb-1"
        style={{ color: "var(--text-primary)" }}
      >
        {t("specialFlights:legend.label")}
      </div>
      <ul className="space-y-0.5">
        {visible.map((type) => {
          const meta = SPECIAL_TYPE_META[type];
          return (
            <li key={type} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-xs"
                style={{
                  background: rgbToCss(meta.rgb, 0.9),
                  border: `1px solid ${rgbToCss(meta.rgb, 1)}`,
                }}
                aria-hidden
              />
              <span aria-hidden className="mr-0.5">
                {meta.icon}
              </span>
              <span>{t(`specialFlights:specialType.${type}`)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
