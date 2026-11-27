import { useEffect, useState, type JSX } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { purposeApi } from "../../lib/api/purpose";
import { logger } from "../../lib/logger";
import { describePurpose } from "../../lib/purposeDisplay";
import {
  PURPOSE_FILTER_PARAM,
  PURPOSE_FILTER_UNKNOWN,
  pageTakesPurposeFilter,
  purposeFilterOf,
} from "../../lib/purposeFilter";
import { usePurposeCatalogue } from "../../store/purposeCatalogueStore";
import { PURPOSES, PURPOSE_DOMAINS, type PurposeDomain } from "../../shared/purpose";

/** The page's domain, whose counts the options show; null on the trips list and "Alle". */
const PATH_DOMAIN: [string, PurposeDomain][] = [
  ["/flights", "flight"],
  ["/rail", "rail"],
  ["/lodging", "lodging"],
  ["/bus", "bus"],
  ["/ferry", "ferry"],
  ["/rentals", "rental"],
  ["/cruises", "cruise"],
  ["/places", "poi"],
  ["/tours", "tour"],
  ["/roadtrips", "roadtrip"],
];

function domainOf(pathname: string): PurposeDomain | null {
  const tab = /^\/dashboard\/([a-z]+)/.exec(pathname)?.[1];
  if (tab && (PURPOSE_DOMAINS as readonly string[]).includes(tab)) return tab as PurposeDomain;
  return PATH_DOMAIN.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? null;
}

/**
 * "Zweck": narrows the page to one purpose — built-in, the user's own, a whole kind, or "nicht
 * festgelegt". The choice goes into the URL (`?purpose=`), which the router reads for every entry
 * request of the page. Each option names how many entries carry it (the page's domain, or all of
 * them on the trips list and the "Alle" dashboard). Renders nothing on a page that takes no filter.
 */
export default function PurposeFilterControl({
  compact,
}: {
  compact?: boolean;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["purpose"]);
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const catalogue = usePurposeCatalogue();
  const [usage, setUsage] = useState<Record<string, number> | null>(null);
  const [failed, setFailed] = useState(false);
  const takes = pageTakesPurposeFilter(location.pathname);
  const domain = domainOf(location.pathname);

  useEffect(() => {
    if (!takes) return;
    let cancelled = false;
    void (async () => {
      try {
        const all = await purposeApi.usage();
        if (cancelled) return;
        const rows = domain ? [all[domain] ?? {}] : Object.values(all);
        const sum: Record<string, number> = {};
        for (const row of rows)
          for (const [k, n] of Object.entries(row ?? {})) sum[k] = (sum[k] ?? 0) + n;
        setUsage(sum);
      } catch (error) {
        // The filter still works without its numbers; the console says why they are missing.
        logger.warn("purpose filter counts could not be loaded", error);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [takes, domain]);

  if (!takes) return null;
  const value = purposeFilterOf(location) ?? "";
  const lang = i18n.language ?? "de";
  const count = (key: string): string => (usage ? ` (${usage[key] ?? 0})` : "");
  const kindCount = (kind: string): string => {
    if (!usage) return "";
    const keys = [
      ...catalogue.builtins.filter((b) => b.kind === kind).map((b) => b.key),
      ...catalogue.custom.filter((c) => c.kind === kind).map((c) => c.key),
    ];
    return ` (${keys.reduce((n, k) => n + (usage[k] ?? 0), 0)})`;
  };
  // An archived purpose is offered only while something carries it, or while it is the filter.
  const custom = catalogue.custom.filter(
    (c) => !c.archived || c.key === value || (usage?.[c.key] ?? 0) > 0
  );

  const choose = (next: string): void => {
    const updated = new URLSearchParams(params);
    if (next) updated.set(PURPOSE_FILTER_PARAM, next);
    else updated.delete(PURPOSE_FILTER_PARAM);
    setParams(updated, { replace: true });
  };

  return (
    <label
      className={`t-caption flex items-center gap-2 ${compact ? "" : "mb-3"}`}
      data-testid="purpose-filter"
    >
      {t("purpose:filter.label")}
      <select
        value={value}
        onChange={(e) => choose(e.target.value)}
        className="pointer-coarse:min-h-(--ts-size-touch-min)"
      >
        <option value="">{t("purpose:filter.all")}</option>
        {PURPOSES.map((kind) => (
          <optgroup key={kind} label={t(`purpose:kind.${kind}`)}>
            <option value={kind}>
              {t(`purpose:filter.allOfKind.${kind}`)}
              {kindCount(kind)}
            </option>
            {[
              ...catalogue.builtins.filter((b) => b.kind === kind).map((b) => b.key),
              ...custom.filter((c) => c.kind === kind).map((c) => c.key),
            ].map((key) => {
              const d = describePurpose(t, catalogue, key, lang);
              return d ? (
                <option key={key} value={key}>
                  {`${d.label}${count(key)}`}
                </option>
              ) : null;
            })}
          </optgroup>
        ))}
        <option value={PURPOSE_FILTER_UNKNOWN}>
          {t("purpose:field.unknown")}
          {count(PURPOSE_FILTER_UNKNOWN)}
        </option>
      </select>
      {failed && <span role="status">{t("purpose:filter.countsFailed")}</span>}
    </label>
  );
}
