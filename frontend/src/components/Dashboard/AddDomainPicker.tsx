// Single "+ hinzufügen" button, floating top-right over the map, that opens
// a small popover listing the enabled addable domains. Restores the
// pre-#folded-panel interaction (a single button → domain picker → modal)
// that commit 9f65eb83 replaced with two always-visible per-domain buttons
// inside the left control panel — moved back out to a map-overlay position
// per owner request.
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { ACCENT, BORDER, PANEL_BG, TEXT } from "../map/controlPanelKit";

export type AddableDomain = "flight" | "cruise" | "lodging" | "poi";

interface AddDomainPickerProps {
  enabled: Record<AddableDomain, boolean>;
  onPick(domain: AddableDomain): void;
}

export function AddDomainPicker({ enabled, onPick }: AddDomainPickerProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const options: { key: AddableDomain; label: string }[] = [];
  if (enabled.flight) options.push({ key: "flight", label: t("dashboard:addPicker.flight") });
  if (enabled.cruise) options.push({ key: "cruise", label: t("dashboard:addPicker.cruise") });
  if (enabled.lodging) options.push({ key: "lodging", label: t("dashboard:addPicker.lodging") });
  if (enabled.poi) options.push({ key: "poi", label: t("dashboard:addPicker.poi") });

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="cursor-pointer rounded-lg px-3 py-2 text-[13px] font-semibold shadow-lg transition-opacity hover:opacity-90"
        style={{ background: `rgb(${ACCENT})`, color: "#0d1117", border: "none" }}
      >
        + {t("dashboard:addPicker.button")} ▾
      </button>
      {open && (
        <ul
          role="menu"
          className="shadow-xl"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            background: PANEL_BG,
            backdropFilter: "blur(8px)",
            border: `1px solid ${BORDER}`,
            borderRadius: "10px",
            padding: "4px 0",
            minWidth: "180px",
            zIndex: 40,
            listStyle: "none",
            margin: 0,
          }}
        >
          {options.map((opt) => (
            <li key={opt.key}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onPick(opt.key);
                  setOpen(false);
                }}
                className="w-full cursor-pointer text-left text-[13px] transition-colors hover:bg-white/5"
                style={{ padding: "8px 14px", background: "transparent", color: TEXT, border: "none" }}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
