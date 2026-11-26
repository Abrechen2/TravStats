import type { JSX } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { PURPOSE_FILTER_PARAM, purposeFilterOf } from "../../lib/purposeFilter";
import { usePurposeCatalogue } from "../../store/purposeCatalogueStore";
import { PURPOSES, type Purpose } from "../../shared/purpose";
import PurposeFilterControl from "./PurposeFilterControl";

const COARSE = "pointer-coarse:min-h-(--ts-size-touch-min)";

/**
 * "Alle | Privat | Geschäftlich" at the top of the place lists (owner 2026-11-26), with the
 * specific purpose beside it. Both write the page's `?purpose=`, which the API client sends with
 * every entry read, so the table, its counts and the overview agree.
 */
export default function PurposeSegment(): JSX.Element {
  const { t } = useTranslation(["purpose"]);
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const catalogue = usePurposeCatalogue();
  const value = purposeFilterOf(location);
  // A specific purpose lights up its kind.
  const kind: Purpose | null =
    value && (PURPOSES as readonly string[]).includes(value)
      ? (value as Purpose)
      : ([...catalogue.builtins, ...catalogue.custom].find((p) => p.key === value)?.kind ?? null);

  const choose = (next: Purpose | null): void => {
    const updated = new URLSearchParams(params);
    if (next) updated.set(PURPOSE_FILTER_PARAM, next);
    else updated.delete(PURPOSE_FILTER_PARAM);
    setParams(updated, { replace: true });
  };

  const options: { key: Purpose | null; label: string }[] = [
    { key: null, label: t("purpose:filter.segmentAll") },
    ...PURPOSES.map((k) => ({ key: k, label: t(`purpose:kind.${k}`) })),
  ];

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3" data-testid="purpose-segment">
      <div
        role="group"
        aria-label={t("purpose:filter.label")}
        className="inline-flex overflow-hidden rounded-lg"
        style={{ border: "1px solid var(--color-border)" }}
      >
        {options.map((o) => {
          const active = o.key === null ? value === null : kind === o.key;
          return (
            <button
              key={o.key ?? "all"}
              type="button"
              aria-pressed={active}
              onClick={() => choose(o.key)}
              className={`px-4 py-1.5 text-sm ${COARSE}`}
              style={
                active
                  ? { background: "var(--accent)", color: "var(--bg-base, #fff)" }
                  : { color: "var(--text-secondary)" }
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <PurposeFilterControl compact />
    </div>
  );
}
