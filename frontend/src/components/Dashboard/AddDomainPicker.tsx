import { useState, useRef, useEffect } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

type AddableDomain = "flight" | "cruise" | "poi";

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
  if (enabled.poi) options.push({ key: "poi", label: t("dashboard:addPicker.poi") });

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          background: "var(--accent)",
          color: "#0d1117",
          padding: "6px 12px",
          borderRadius: "10px",
          fontSize: "13px",
          fontWeight: 600,
        }}
      >
        + {t("dashboard:addPicker.button")} ▾
      </button>
      {open && (
        <ul
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "10px",
            padding: "4px 0",
            minWidth: "180px",
            zIndex: 30,
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
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 14px",
                  background: "transparent",
                  color: "var(--text-primary)",
                }}
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
