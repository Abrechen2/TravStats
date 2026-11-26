import { Table, TableRow, type TableColumn } from "../components/ui/Table";
import { useSort } from "../hooks/useSort";
import { useCallback, useEffect, useState, useMemo } from "react";
import type { JSX } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import { StarRating } from "../components/lodging/StarRating";
import { MembershipManager } from "../components/lodging/MembershipManager";
import { useTranslation } from "../hooks/useTranslation";
import { getChainDetail } from "../lib/api/lodging";
import { formatCurrency } from "../lib/units";
import {
  countedStays,
  hasAnyPrice,
  lodgingTypeIcon,
  singleOriginalCurrencySpend,
} from "../lib/lodgingFormat";
import { PlannedSpendNote } from "../components/lodging/PlannedSpendNote";
import { FlagImg, resolveCountryCode } from "../lib/countryFlag";
import { logger } from "../lib/logger";
import { useSettingsStore } from "../store/settingsStore";
import { LOYALTY_SETTINGS_PATH } from "./Settings/settingsModel";

import type { Lodging, LodgingChainDetail } from "../types/lodging";
import { useDomainColors } from "../hooks/useDomainColors";
import BackLink from "../components/navigation/BackLink";

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
  const { colorOf } = useDomainColors();
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
      <AppShell>
        <p className="text-[var(--text-muted)]">{t("lodging:chainDetail.loading")}</p>
      </AppShell>
    );
  }

  if (notFound || !detail) {
    return (
      <AppShell>
        <div>
          <BackLink to="/lodging" className="ts-back-link text-sm text-[var(--text-muted)]">
            ← {t("lodging:list.title")}
          </BackLink>
          <div className="mt-4 rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]">
            {t("lodging:chainDetail.notFound")}
          </div>
        </div>
      </AppShell>
    );
  }

  const { chain, lodgings, stats, membership, siblingChains, suggestedChains } = detail;
  // What the user calls this programme wins over what the catalogue guesses —
  // the catalogue is a starting point and goes stale (it still said "NH
  // Rewards" two rebrands later).
  const programLabel = membership?.programName ?? chain.loyaltyProgram;
  const accent = chain.brandColor ?? colorOf("lodging");
  const sharedWithLabel =
    programLabel && siblingChains.length > 0
      ? t("lodging:chainDetail.sharedWith", {
          program: programLabel,
          chains: siblingChains.map((c) => c.name).join(", "),
        })
      : undefined;

  return (
    <AppShell>
      <div>
        <BackLink
          to="/lodging"
          className="ts-back-link mb-3 inline-block text-sm text-[var(--text-muted)]"
        >
          ← {t("lodging:list.title")}
        </BackLink>

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
            <h1 className="t-screen-title">{chain.name}</h1>
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
            <ChainStatsRow
              stats={stats}
              lodgings={detail.lodgings}
              baseCurrency={baseCurrency}
              t={t}
            />
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
            {/* Every programme, of every kind, is managed centrally in the
                settings (owner, 2026-09-26); this box edits the one card that
                covers this chain, and says where the rest are. */}
            <Link
              to={LOYALTY_SETTINGS_PATH}
              data-testid="chain-loyalty-settings-link"
              className="mt-2 inline-block text-xs hover:underline"
              style={{ color: "var(--ts-accent)", fontWeight: 600 }}
            >
              {t("lodging:chainDetail.allProgrammes")}
            </Link>
          </aside>
        </div>

        <h2 className="mb-2 mt-6 text-sm font-semibold text-[var(--text-muted)]">
          {t("lodging:chainDetail.hotelsTitle")}
        </h2>
        {lodgings.length > 0 ? (
          <ChainHotelsTable
            lodgings={lodgings}
            baseCurrency={baseCurrency}
            onOpen={(l) =>
              // Carry where the click came from, so the hotel's own
              // page can offer the way back here instead of dropping
              // the reader into the full list (Alex, 2026-08-29).
              navigate(`/lodging/${l.id}`, {
                state: { fromChain: { id: chain.id, name: chain.name } },
              })
            }
          />
        ) : (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-4 py-8 text-center text-[var(--text-muted)]">
            {t("lodging:chainDetail.hotelsEmpty")}
          </div>
        )}
      </div>
    </AppShell>
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
  lodgings,
  baseCurrency,
  t,
}: {
  stats: LodgingChainDetail["stats"];
  lodgings: readonly Lodging[];
  baseCurrency: string;
  t: ReturnType<typeof useTranslation>["t"];
}): JSX.Element {
  // `stats.totalSpendBase` is the sum over every hotel's counted stays, so the
  // "is there anything to show" question is asked of that same set — not of
  // `> 0`, which hid a genuine free stay behind a dash (forgejo#82).
  const priced = hasAnyPrice(lodgings.flatMap((l) => countedStays(l.stays)));
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <StatTile value={stats.hotelCount} label={t("lodging:chainDetail.stats.hotels")} />
      <StatTile value={stats.stayCount} label={t("lodging:chainDetail.stats.stays")} />
      <StatTile value={stats.nights} label={t("lodging:chainDetail.stats.nights")} />
      <StatTile
        value={priced ? formatCurrency(stats.totalSpendBase, baseCurrency) : "—"}
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
  // Same set as the figure — see LodgingSpendCell on the list page (forgejo#82).
  const counted = countedStays(lodging.stays);
  const planned = <PlannedSpendNote stays={lodging.stays} />;
  if (!hasAnyPrice(counted)) {
    return <>—{planned}</>;
  }
  const original = singleOriginalCurrencySpend(counted, baseCurrency);
  if (!original) {
    return (
      <>
        <div>{formatCurrency(lodging.totalSpendBase, baseCurrency)}</div>
        {planned}
      </>
    );
  }
  return (
    <>
      <div>{formatCurrency(original.amount, original.currency)}</div>
      <div className="text-[10px]" style={{ color: "var(--fx, #6ab7d8)" }}>
        ≈ {formatCurrency(lodging.totalSpendBase, baseCurrency)}
      </div>
      {planned}
    </>
  );
}

type HotelSortKey = "name" | "location" | "stays" | "nights" | "rating";

function ChainHotelsTable({
  lodgings,
  baseCurrency,
  onOpen,
}: {
  lodgings: readonly Lodging[];
  baseCurrency: string;
  onOpen: (lodging: Lodging) => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["lodging", "common"]);
  const accessors = useMemo(
    () => ({
      name: (l: Lodging) => l.name,
      location: (l: Lodging) => l.city || l.country || null,
      stays: (l: Lodging) => l.stayCount,
      nights: (l: Lodging) => l.nights,
      rating: (l: Lodging) => l.overallRating,
    }),
    []
  );
  const sort = useSort<Lodging, HotelSortKey>({
    tableKey: "lodging-chain-hotels",
    rows: lodgings,
    accessors,
    defaultBy: "name",
    descendingFirst: ["stays", "nights", "rating"],
    locale: i18n.language,
  });
  const column = (key: HotelSortKey, label: string): Pick<TableColumn, "label" | "sort"> => ({
    label,
    sort: sort.columnSort(key, t("common:ui.sortBy", { column: label })),
  });
  const columns: TableColumn[] = [
    {
      key: "name",
      min: 160,
      grow: 2,
      onNarrow: "title",
      ...column("name", t("lodging:list.columns.name")),
    },
    {
      key: "location",
      min: 120,
      grow: 1,
      onNarrow: "subtitle",
      ...column("location", t("lodging:list.columns.location")),
    },
    {
      key: "stays",
      min: 70,
      align: "end",
      mono: true,
      priority: 2,
      ...column("stays", t("lodging:list.columns.stays")),
    },
    {
      key: "nights",
      min: 70,
      align: "end",
      mono: true,
      priority: 2,
      ...column("nights", t("lodging:list.columns.nights")),
    },
    { key: "rating", min: 100, priority: 3, ...column("rating", t("lodging:list.columns.rating")) },
    {
      key: "spend",
      min: 100,
      align: "end",
      onNarrow: "trailing",
      label: t("lodging:list.columns.spend"),
    },
  ];
  return (
    <Table
      columns={columns}
      label={t("lodging:chainDetail.hotelsTitle", { defaultValue: "Hotels" })}
    >
      {sort.rows.map((l) => (
        <TableRow
          key={l.id}
          columns={columns}
          onClick={() => onOpen(l)}
          cells={[
            <>
              <span aria-hidden className="mr-2">
                {lodgingTypeIcon(l.type)}
              </span>
              <span className="font-medium text-[var(--text-primary)]">{l.name}</span>
            </>,
            l.city || l.country ? (
              <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
                <span>{l.city || l.country}</span>
                <FlagImg country={resolveCountryCode(l.country)} height={12} />
              </span>
            ) : (
              "—"
            ),
            l.stayCount,
            l.nights,
            <StarRating key="r" value={l.overallRating} />,
            <ChainHotelSpendCell key="s" lodging={l} baseCurrency={baseCurrency} />,
          ]}
        />
      ))}
    </Table>
  );
}
