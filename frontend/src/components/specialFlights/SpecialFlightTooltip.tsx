/**
 * Minimal tooltip card for a single selected Sonder-Flug.
 *
 * The regular `MapTooltip` renders `dep → arr`, which is misleading for
 * sightseeing / ZeroG flights where both ends are the same airport, and
 * off-target for eclipse chases where the interesting coordinate is the
 * event — not the arrival airport. This component mirrors the existing
 * MapTooltip visual (same TooltipContainer, same edit/close buttons) but
 * swaps the header line for a special-flight specific summary.
 */
import type { Flight } from "../../types";
import { TooltipContainer } from "../TooltipContainer";
import { useTranslation } from "../../hooks/useTranslation";
import { useLocale } from "../../hooks/useLocale";
import { SPECIAL_TYPE_META, rgbToCss, type SpecialType } from "./specialTypeMeta";

interface Props {
  flight: Flight;
  screenX: number;
  screenY: number;
  onEdit: (flight: Flight) => void;
  onClose: () => void;
}

export function SpecialFlightTooltip({
  flight,
  screenX,
  screenY,
  onEdit,
  onClose,
}: Props): JSX.Element | null {
  const { t } = useTranslation(["specialFlights", "common"]);
  const locale = useLocale();

  const type = flight.specialType as SpecialType | null | undefined;
  if (!type) return null;
  const meta = SPECIAL_TYPE_META[type];

  const label = t(`specialFlights:specialType.${type}`);

  // Header: icon + localised type + airport(s).
  // sightseeing / zerog / rocket_launch → single airport code.
  // others → "DEP → ARR" when arr differs, single airport otherwise.
  const dep = flight.depIata ?? flight.depIcao ?? null;
  const arr = flight.arrIata ?? flight.arrIcao ?? null;

  const isLoopType = type === "sightseeing" || type === "zerog" || type === "rocket_launch";
  const routeString = (() => {
    if (isLoopType) return dep ?? arr ?? "?";
    if (dep && arr && dep !== arr) return `${dep} → ${arr}`;
    return dep ?? arr ?? "?";
  })();

  // Secondary line: aircraft, event label, departure date — whichever are set.
  const metaParts: string[] = [];
  if (flight.aircraft) metaParts.push(flight.aircraft);
  if (flight.eventLabel) metaParts.push(flight.eventLabel);
  if (flight.departureTime) {
    metaParts.push(new Date(flight.departureTime).toLocaleDateString(locale));
  }

  const borderColor = rgbToCss(meta.rgb, 0.6);

  return (
    <TooltipContainer
      screenX={screenX}
      screenY={screenY}
      minWidth="220px"
      borderColor={borderColor}
    >
      <div className="flex items-center gap-1.5 font-bold text-sm">
        <span aria-hidden>{meta.icon}</span>
        <span style={{ color: rgbToCss(meta.rgb, 1) }}>{label}</span>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <span className="font-mono" style={{ color: "var(--text-primary)" }}>
          {routeString}
        </span>
      </div>
      {metaParts.length > 0 && (
        <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          {metaParts.join(" · ")}
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={() => onEdit(flight)}
          className="text-xs px-2 py-1 rounded-sm transition-colors"
          style={{ background: "var(--accent)", color: "white" }}
        >
          {t("common:buttons.edit")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 rounded-sm transition-colors"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
          }}
          aria-label={t("common:buttons.close")}
        >
          ✕
        </button>
      </div>
    </TooltipContainer>
  );
}
