import { useEffect, useRef, useState } from "react";
import type { Flight } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { getFlightSourceInfo } from "../../lib/flightSourceInfo";

/**
 * ℹ dot next to the row actions carrying the data-provenance tooltip.
 * Renders nothing when there is nothing to tell. Desktop hover shows
 * the tooltip via CSS (group-hover); touch/click toggles it (touch fallback)
 * with the click-open state winning over hover. A document listener closes
 * it when clicking outside.
 */
export default function SourceInfoDot({ flight }: { flight: Flight }): JSX.Element | null {
  const { t } = useTranslation(["flights"]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const lines = getFlightSourceInfo(flight, t);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  if (lines.length === 0) return null;

  return (
    <span ref={rootRef} className="relative inline-flex group">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("flights:table.sourceInfo")}
        aria-expanded={open}
        className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border text-[10.5px] italic font-semibold"
        style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
      >
        i
      </button>
      <span
        className={`absolute right-0 top-full mt-2 z-20 rounded-lg border px-3 py-2 text-xs whitespace-nowrap shadow-lg ${open ? "block" : "hidden group-hover:block"}`}
        style={{ background: "var(--bg-base)", borderColor: "var(--color-border)", color: "var(--text-primary)" }}
        role="tooltip"
      >
        {lines.map((line, i) => (
          <span key={i} className="block">
            <span className="font-medium">{line.icon} {line.label}</span>
            {line.detail && (
              <span className="block" style={{ color: "var(--text-muted)" }}>{line.detail}</span>
            )}
          </span>
        ))}
      </span>
    </span>
  );
}
