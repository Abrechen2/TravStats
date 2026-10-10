import type { Flight } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { getFlightSourceInfo } from "../../lib/flightSourceInfo";
import Toggletip from "../ui/Toggletip";

/**
 * ℹ dot next to the row actions carrying the data provenance. Renders nothing
 * when there is nothing to tell. The shared `Toggletip` makes it a tap, a key
 * and a hover at once (forgejo#249); it used to be a CSS `group-hover` panel
 * with its own click toggle and outside-click listener.
 */
export default function SourceInfoDot({ flight }: { flight: Flight }): JSX.Element | null {
  const { t } = useTranslation(["flights"]);
  const lines = getFlightSourceInfo(flight, t);
  if (lines.length === 0) return null;

  return (
    <Toggletip
      position="bottom"
      label={t("flights:table.sourceInfo")}
      triggerClassName="h-[18px] w-[18px] justify-center rounded-full border text-[10.5px] italic font-semibold"
      triggerStyle={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
      content={lines.map((line, i) => (
        <span key={i} className="block">
          <span className="font-medium">
            {line.icon} {line.label}
          </span>
          {line.detail && (
            <span className="block" style={{ color: "var(--text-muted)" }}>
              {line.detail}
            </span>
          )}
        </span>
      ))}
    >
      i
    </Toggletip>
  );
}
