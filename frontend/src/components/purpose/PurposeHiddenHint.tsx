import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { purposeApi } from "../../lib/api/purpose";
import { logger } from "../../lib/logger";
import type { PurposeDomain } from "../../shared/purpose";

/**
 * Under a total: how many entries the account's "ausblenden" setting leaves out, so a hidden
 * number is never mistaken for a real zero. Renders nothing while nothing is hidden. `domain`
 * narrows it to one area; without it every area is summed.
 */
export default function PurposeHiddenHint({
  domain,
}: {
  domain?: PurposeDomain;
}): JSX.Element | null {
  const { t } = useTranslation(["purpose"]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const hidden = await purposeApi.hidden();
        const sum: Record<string, number> = {};
        for (const [d, byPurpose] of Object.entries(hidden)) {
          if (domain && d !== domain) continue;
          for (const [purpose, n] of Object.entries(byPurpose))
            sum[purpose] = (sum[purpose] ?? 0) + n;
        }
        if (!cancelled) setCounts(sum);
      } catch (error) {
        // The totals themselves still render; only the hint is missing.
        logger.warn("purpose hidden counts could not be loaded", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [domain]);

  const lines = (["business", "private"] as const)
    .filter((p) => (counts[p] ?? 0) > 0)
    .map((p) => t(`purpose:hidden.${p}`, { count: counts[p] }));
  if (lines.length === 0) return null;
  return (
    <p className="t-caption" data-testid="purpose-hidden-hint">
      {lines.join(" · ")}
    </p>
  );
}
