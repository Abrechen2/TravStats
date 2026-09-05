import { JSX, KeyboardEvent } from "react";
import { DOMAIN_KEYS, DOMAINS, type DomainKey } from "../../shared/domains";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";

export interface DomainPickerStepProps {
  value: DomainKey[];
  onChange: (next: DomainKey[]) => void;
}

export default function DomainPickerStep({ value, onChange }: DomainPickerStepProps): JSX.Element {
  const { t } = useTranslation("common");
  const { colorOf } = useDomainColors();

  const toggle = (key: DomainKey): void => {
    if (!DOMAINS[key].available) return;
    const next = value.includes(key) ? value.filter((k) => k !== key) : [...value, key];
    onChange(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, key: DomainKey): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(key);
    }
  };

  // Every domain, since 2026-09-05. Places was withheld from a fresh install
  // while it was in beta (the flag is unknown before the first settings
  // request, and unknown read as OFF here on purpose); that gate is gone.
  const visibleKeys = DOMAIN_KEYS;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          {t("setup.domains.title")}
        </h2>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          {t("setup.domains.desc")}
        </p>
      </div>
      <ul className="space-y-2">
        {visibleKeys.map((key) => {
          const d = DOMAINS[key];
          const selected = value.includes(key);
          const locked = !d.available;
          return (
            <li
              key={key}
              data-testid={`domain-card-${key}`}
              onClick={() => toggle(key)}
              onKeyDown={(e) => onKeyDown(e, key)}
              className={`rounded-lg p-4 flex items-center gap-4 transition-colors ${
                locked ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
              }`}
              style={{
                background: "var(--bg-surface)",
                border: `1px solid ${selected ? "var(--accent)" : "var(--color-border)"}`,
                outline: selected ? "1px solid var(--accent)" : "none",
              }}
              role="button"
              tabIndex={locked ? -1 : 0}
              aria-pressed={selected}
              aria-disabled={locked}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0"
                style={{ backgroundColor: `${colorOf(d.key)}22` }}
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
                  {locked && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: "var(--bg-elevated)",
                        color: "var(--text-muted)",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      {t("setup.domains.soon")}
                    </span>
                  )}
                </div>
                <div className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {t(`${d.i18nKey}_desc`)}
                </div>
              </div>
              <div
                className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center"
                style={{
                  background: selected ? "var(--accent)" : "transparent",
                  border: `2px solid ${selected ? "var(--accent)" : "var(--color-border)"}`,
                  color: "#fff",
                }}
                aria-hidden
              >
                {selected ? "✓" : ""}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
