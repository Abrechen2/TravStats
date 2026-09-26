import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { getLoyaltyMembership } from "../../lib/api/loyalty";
import { logger } from "../../lib/logger";

/** The URL parameters the loyalty links set on a list page. */
export const LOYALTY_FILTER_PARAM = "membership";
export const LOYALTY_YEAR_PARAM = "year";

/**
 * Where a loyalty figure's link leads: the lodging or flight list, filtered
 * on the server to the rows the figure counted (`?membership=<id>`, with
 * `&year=` for a per-year figure). Cruise cards have no such list filter.
 */
export function loyaltyListLink(
  domain: "flight" | "lodging",
  membershipId: string,
  year?: number
): string {
  const params = new URLSearchParams({ [LOYALTY_FILTER_PARAM]: membershipId });
  if (year !== undefined) params.set(LOYALTY_YEAR_PARAM, String(year));
  return `${domain === "flight" ? "/flights" : "/lodging"}?${params.toString()}`;
}

/**
 * The card filter a list page was opened with, and the year the link named.
 * The year only SEEDS the page's own year filter — the reader may change it
 * like any other; the card filter stays until it is cleared, because nothing
 * else on the page can show or change it.
 */
export function useLoyaltyListFilter(): {
  membershipId: string | null;
  linkedYear: number | null;
  clear: () => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const membershipId = searchParams.get(LOYALTY_FILTER_PARAM);
  const rawYear = Number.parseInt(searchParams.get(LOYALTY_YEAR_PARAM) ?? "", 10);
  const linkedYear = Number.isFinite(rawYear) ? rawYear : null;
  const clear = useCallback((): void => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(LOYALTY_FILTER_PARAM);
        next.delete(LOYALTY_YEAR_PARAM);
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);
  return { membershipId, linkedYear, clear };
}

type CardState =
  { kind: "loading" } | { kind: "named"; name: string } | { kind: "gone" } | { kind: "unnamed" };

function errorCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
}

interface NoticeProps {
  membershipId: string;
  onClear: () => void;
}

/**
 * Says, above the list, that it shows one programme's rows — and lets the
 * reader drop the filter. A filter nobody can see is how a list comes to look
 * like it lost data.
 *
 * A card that is not there (deleted, or another account's id in a shared
 * link) says so in words; the list request answers the same 404, so the page
 * shows no rows rather than every row.
 */
export function LoyaltyFilterNotice({ membershipId, onClear }: NoticeProps): JSX.Element {
  const { t } = useTranslation(["loyalty"]);
  const [state, setState] = useState<CardState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    getLoyaltyMembership(membershipId)
      .then((card) => {
        if (!cancelled) setState({ kind: "named", name: card.programName });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (errorCode(err) === "LOYALTY_MEMBERSHIP_NOT_FOUND") {
          setState({ kind: "gone" });
          return;
        }
        // The filter still applies on the server; only its name is missing.
        logger.warn("LoyaltyFilterNotice: card name unavailable", err);
        setState({ kind: "unnamed" });
      });
    return () => {
      cancelled = true;
    };
  }, [membershipId]);

  const text =
    state.kind === "named"
      ? t("loyalty:listFilter.named", { name: state.name })
      : state.kind === "gone"
        ? t("loyalty:listFilter.gone")
        : t("loyalty:listFilter.unnamed");

  return (
    <div
      data-testid="loyalty-list-filter"
      role={state.kind === "gone" ? "alert" : "status"}
      className="flex flex-wrap items-center gap-3 text-sm"
      style={{ color: state.kind === "gone" ? "var(--ts-bad)" : "var(--ts-text)" }}
    >
      <span>{text}</span>
      <button
        type="button"
        onClick={onClear}
        className="text-xs hover:underline"
        style={{ color: "var(--ts-accent)", fontWeight: 600 }}
      >
        {t("loyalty:listFilter.clear")}
      </button>
    </div>
  );
}
