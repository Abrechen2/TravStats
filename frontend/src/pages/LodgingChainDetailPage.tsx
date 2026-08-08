import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useNavigate, useParams } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import { StarRating } from "../components/lodging/StarRating";
import { MembershipManager } from "../components/lodging/MembershipManager";
import { useTranslation } from "../hooks/useTranslation";
import { getChainDetail } from "../lib/api/lodging";
import { formatCurrency } from "../lib/units";
import { hasAnyPrice, lodgingTypeIcon, singleOriginalCurrencySpend } from "../lib/lodgingFormat";
import { FlagImg, resolveCountryCode } from "../lib/countryFlag";
import { logger } from "../lib/logger";
import { useSettingsStore } from "../store/settingsStore";
import { DOMAINS } from "../shared/domains";
import type { Lodging, LodgingChainDetail } from "../types/lodging";

/**
 * Chain detail page (collaborator request): click a chain name anywhere it
 * appears — the `/lodging` list's "Kette" column, a hotel's own detail page,
 * or the dashboard's chains view — and land here to see every hotel of that
 * chain the caller has stayed at, plus their loyalty membership for it.
 *
 * The membership block is scoped to THIS CHAIN's id (`scopeChain`). It used to
 * be scoped to `chain.loyaltyProgram` as a string, which meant a rebranded
 * programme — NH Rewards -> NH DISCOVERY -> Minor DISCOVERY — silently emptied
 * this block, and the programme-name field had to be locked to keep the match
 * alive. The catalogue value survives as a SUGGESTION: it prefills the name and
 * pre-ticks which chains the membership covers, nothing more.
 */
export default function LodgingChainDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["lodging", "common"]);
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);

  const [detail, setDetail] = useState<LodgingChainDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [notFound, setNotFound] = useState<boolean>(false);

  useEffect(() => {
    if (!id) return;
    const chainId = Number.parseInt(id, 10);
    if (Number.isNaN(chainId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const data = await getChainDetail(chainId);
        if (!cancelled) setDetail(data);
      } catch (err: unknown) {
        logger.error("LodgingChainDetailPage: failed to load chain", err);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  /**
   * Re-reads the chain after a membership was created, edited or deleted. The
   * page header and the "no membership yet" note come from this payload, so
   * without it they kept showing the pre-save state — the catalogue's stale
   * programme name — until a manual reload.
   *
   * Deliberately does NOT touch `loading`: the loading branch replaces the
   * whole tree, which would unmount `MembershipManager`, whose mount-time load
   * fires `onChanged` again — an endless refetch loop.
   */
  const refreshDetail = useCallback(async (): Promise<void> => {
    if (!id) return;
    const chainId = Number.parseInt(id, 10);
    if (Number.isNaN(chainId)) return;
    try {
      setDetail(await getChainDetail(chainId));
    } catch (err: unknown) {
      logger.error("LodgingChainDetailPage: failed to refresh chain", err);
    }
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />
        <div className="p-6 text-[var(--text-muted)]">{t("lodging:chainDetail.loading")}</div>
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />
        <div className="mx-auto max-w-3xl p-6">
          <button
            onClick={() => navigate("/lodging")}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            ← {t("lodging:list.title")}
          </button>
          <div className="mt-4 rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]">
            {t("lodging:chainDetail.notFound")}
          </div>
        </div>
      </div>
    );
  }

  const { chain, lodgings, stats, membership, siblingChains, suggestedChains } = detail;
  // What the user calls this programme wins over what the catalogue guesses —
  // the catalogue is a starting point and goes stale (it still said "NH
  // Rewards" two rebrands later).
  const programLabel = membership?.programName ?? chain.loyaltyProgram;
  const accent = chain.brandColor ?? DOMAINS.lodging.color;
  const sharedWithLabel =
    programLabel && siblingChains.length > 0
      ? t("lodging:chainDetail.sharedWith", {
          program: programLabel,
          chains: siblingChains.map((c) => c.name).join(", "),
        })
      : undefined;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
      <NavigationBar />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <button
          onClick={() => navigate("/lodging")}
          className="mb-3 text-sm text-[var(--accent)] hover:underline"
        >
          ← {t("lodging:list.title")}
        </button>

        {/* Header: chain name + brand-colour mark + loyalty program.
            The brand colour is a MARK, never a border-left stripe on a boxed
            panel: that shape is this app's error/danger idiom (see the
            not-found block above), and four of the ten seeded chains are
            red-branded — so a perfectly healthy NH page read as an alert
            (collaborator report, 2026-08-07). */}
        <div className="mb-6 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white"
            style={{ background: accent }}
          >
            {chainInitials(chain.name)}
          </span>
          <div>
            <h1 className="text-2xl font-display font-bold text-[var(--text-primary)]">
              {chain.name}
            </h1>
            <p data-testid="chain-loyalty-program" className="text-sm text-[var(--text-muted)]">
              {programLabel ?? t("lodging:chainDetail.noLoyaltyProgram")}
            </p>
          </div>
        </div>

        {/* Stats and membership share the top row; the hotels table below gets
            the FULL width — it is the reason to visit this page, and it was
            being clipped by an aside that is mostly empty space. */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div className="md:col-span-3">
            <ChainStatsRow stats={stats} baseCurrency={baseCurrency} t={t} />
          </div>

          <aside className="md:col-span-2">
            {/* Always offered, even for a chain the catalogue has no programme
                for: a chain without a seeded programme is a gap in OUR data,
                not proof the user has no card for it. */}
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-4">
              <MembershipManager
                scopeChain={{
                  id: chain.id,
                  suggestedChains,
                  suggestedProgramName: chain.loyaltyProgram,
                }}
                sharedWithLabel={sharedWithLabel}
                onChanged={() => void refreshDetail()}
              />
            </div>
            {membership === null && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                {t("lodging:chainDetail.noMembershipYet")}
              </p>
            )}
          </aside>
        </div>

        <h2 className="mb-2 mt-6 text-sm font-semibold text-[var(--text-muted)]">
          {t("lodging:chainDetail.hotelsTitle")}
        </h2>
        {lodgings.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
            <table className="w-full text-sm min-w-[520px]">
              <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">{t("lodging:list.columns.name")}</th>
                  <th className="px-3 py-2 text-left">{t("lodging:list.columns.location")}</th>
                  <th className="px-3 py-2 text-right">{t("lodging:list.columns.stays")}</th>
                  <th className="px-3 py-2 text-right">{t("lodging:list.columns.nights")}</th>
                  <th className="px-3 py-2 text-left">{t("lodging:list.columns.rating")}</th>
                  <th className="px-3 py-2 text-right">{t("lodging:list.columns.spend")}</th>
                </tr>
              </thead>
              <tbody>
                {lodgings.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => navigate(`/lodging/${l.id}`)}
                    className="cursor-pointer border-t border-[var(--color-border)] hover:bg-[var(--bg-surface)]"
                  >
                    <td className="px-3 py-2">
                      <span aria-hidden className="mr-2">
                        {lodgingTypeIcon(l.type)}
                      </span>
                      <span className="font-medium text-[var(--text-primary)]">{l.name}</span>
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {l.city || l.country ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span>{l.city || l.country}</span>
                          <FlagImg country={resolveCountryCode(l.country)} height={12} />
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{l.stayCount}</td>
                    <td className="px-3 py-2 text-right">{l.nights}</td>
                    <td className="px-3 py-2">
                      <StarRating value={l.overallRating} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ChainHotelSpendCell lodging={l} baseCurrency={baseCurrency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-4 py-8 text-center text-[var(--text-muted)]">
            {t("lodging:chainDetail.hotelsEmpty")}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Up to two initials for the brand mark ("NH Hotels" → "NH", "Meliá" → "M").
 * Word-based rather than the first two characters, so a two-word chain reads
 * as its acronym instead of a syllable.
 */
function chainInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0]);
  return letters.join("").toUpperCase();
}

function ChainStatsRow({
  stats,
  baseCurrency,
  t,
}: {
  stats: LodgingChainDetail["stats"];
  baseCurrency: string;
  t: ReturnType<typeof useTranslation>["t"];
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <StatTile value={stats.hotelCount} label={t("lodging:chainDetail.stats.hotels")} />
      <StatTile value={stats.stayCount} label={t("lodging:chainDetail.stats.stays")} />
      <StatTile value={stats.nights} label={t("lodging:chainDetail.stats.nights")} />
      <StatTile
        value={stats.totalSpendBase > 0 ? formatCurrency(stats.totalSpendBase, baseCurrency) : "—"}
        label={t("lodging:chainDetail.stats.spend")}
      />
      <StatTile
        value={stats.avgRating !== null ? `★ ${stats.avgRating}` : "—"}
        label={t("lodging:chainDetail.stats.rating")}
      />
    </div>
  );
}

function StatTile({ value, label }: { value: string | number; label: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--bg-surface)] p-3">
      <div className="text-lg font-display font-bold text-[var(--text-primary)]">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
    </div>
  );
}

function ChainHotelSpendCell({
  lodging,
  baseCurrency,
}: {
  lodging: Lodging;
  baseCurrency: string;
}): JSX.Element {
  if (!hasAnyPrice(lodging.stays)) return <>—</>;
  const original = singleOriginalCurrencySpend(lodging.stays, baseCurrency);
  if (!original) return <>{formatCurrency(lodging.totalSpendBase, baseCurrency)}</>;
  return (
    <>
      <div>{formatCurrency(original.amount, original.currency)}</div>
      <div className="text-[10px]" style={{ color: "var(--fx, #6ab7d8)" }}>
        ≈ {formatCurrency(lodging.totalSpendBase, baseCurrency)}
      </div>
    </>
  );
}
