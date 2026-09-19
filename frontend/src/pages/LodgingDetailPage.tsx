import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import { useLocation, useNavigate, useParams, Link } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import DetailHeader from "../components/ui/DetailHeader";
import DetailKpis, { type DetailKpi } from "../components/ui/DetailKpis";
import DetailSection from "../components/ui/DetailSection";
import Button from "../components/ui/Button";
import { StayStatusPill } from "../components/lodging/StayStatusPill";
import { lodgingLifecycleStatus } from "../components/lodging/lodgingLifecycle";
import { LodgingFormModal } from "../components/lodging/LodgingFormModal";
import { LodgingMiniMap } from "../components/lodging/LodgingMiniMap";
import { LodgingStayCard } from "../components/lodging/LodgingStayCard";
import { StarRating } from "../components/lodging/StarRating";
import { LodgingPhotoSection } from "../components/lodging/LodgingPhotoSection";
import { StayEditor } from "../components/lodging/StayEditor";
import { ChainNameLink } from "../components/lodging/ChainNameLink";
import { useDocumentCount } from "../hooks/useDocumentCount";
import { useTranslation } from "../hooks/useTranslation";
import { deleteLodging, deleteStay, getLodging, listMemberships } from "../lib/api/lodging";
import { tripsApi } from "../lib/api";
import { formatCurrency } from "../lib/units";
import { countedStays, countUnconvertedStays } from "../lib/lodgingFormat";
import { formatStayPeriod, hasUnknownLength, stayNights } from "../lib/lodgingDateDisplay";
import { PlannedSpendNote } from "../components/lodging/PlannedSpendNote";
import {
  averageRatingsByCategory,
  formatRatingText,
  hasAnyPrice,
  lodgingTypeIcon,
  singleOriginalCurrencySpend,
} from "../lib/lodgingFormat";
import { logger } from "../lib/logger";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import ConfirmModal from "../components/Training/ConfirmModal";
import { countedDeleteMessage, DELETE_BUTTON_CLASS, withDocumentNote } from "../lib/deleteConfirm";
import { deriveStayMembership } from "../shared/membershipDerivation";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import type { Lodging, LodgingMembership, LodgingStay } from "../types/lodging";

/** What a figure reads as when it cannot be stated. The same dash the spend
 *  card already prints for an unconvertible total. */
const UNKNOWN_FIGURE = "—";

export default function LodgingDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  /**
   * Where the reader came from, when the app knows.
   *
   * Router state, not a stored value: it survives the click that set it and
   * nothing else. On a reload, a bookmark or a link opened in a new tab there
   * genuinely IS no origin, and the full list is then the honest answer rather
   * than a guess dressed up as memory.
   */
  const fromChain =
    (location.state as { fromChain?: { id: number; name: string } } | null)?.fromChain ?? null;
  const backTo = fromChain ? `/lodging/chains/${fromChain.id}` : "/lodging";
  const { t, i18n } = useTranslation(["lodging", "common"]);
  const backLabel = fromChain ? fromChain.name : t("lodging:list.title");
  const addToast = useToastStore((s) => s.addToast);
  // `totalSpendBase` is computed by the backend in the user's actual base
  // currency (`UserSettings.baseCurrency`) — NOT `units.currency`, which is an
  // independent display preference used elsewhere for flight-cost figures.
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);

  const [lodging, setLodging] = useState<Lodging | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  // See CruiseDetailPage: a 404 is "gone", everything else is "could not
  // ask". Collapsing the two made a network drop claim the house was
  // deleted.
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  /** Bumped by the retry button; the fetch effect watches it. */
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [editing, setEditing] = useState<boolean>(false);
  const [confirmingDelete, setConfirmingDelete] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  // "new" = create mode, a LodgingStay = edit mode for that stay, null = closed.
  const [editingStay, setEditingStay] = useState<LodgingStay | "new" | null>(null);
  // The stay whose deletion has been ASKED about but not yet answered — null
  // while no question is open. Holding the stay itself (not just its id) is
  // what lets the confirmation name the dates it is about.
  const [confirmingStayDelete, setConfirmingStayDelete] = useState<LodgingStay | null>(null);
  /**
   * Asked only while the stay's confirmation is opening. The page already
   * mounts a documents section for the HOUSE; this is the STAY's own folder,
   * which nothing on the page has counted.
   */
  const stayDocumentCount = useDocumentCount(
    confirmingStayDelete ? { type: "lodgingStay", id: confirmingStayDelete.id } : null
  );
  const [deletingStay, setDeletingStay] = useState<boolean>(false);
  /**
   * The header figures no longer describe the list below them.
   *
   * Set when a stay was deleted but the reload that recomputes the aggregates
   * failed: the row is gone locally while `stayCount`, `nights`,
   * `overallRating` and `totalSpendBase` still count it. A wrong number
   * presented as data is worse than no number, so the strip shows "—" until
   * the next successful load clears this. The flag lives here rather than in
   * the four fields because the wire type cannot hold "unknown" — they are
   * plain numbers shared with the list and the stats cells.
   */
  const [aggregatesStale, setAggregatesStale] = useState<boolean>(false);
  // Name lookup for the stay cards' trip pill — a stay only stores `tripId`,
  // never the display name, so this page resolves it once against the
  // user's full trip list (small, already-fetched-elsewhere; no per-stay
  // round trip).
  const [tripNameById, setTripNameById] = useState<Record<string, string>>({});
  // The FULL membership rows (not just a name lookup) — each stay's chip
  // must run `deriveStayMembership`, because `stay.membershipId` is an
  // override only. The migration nulled it for every stay whose stored card
  // already matched what derivation now produces, so reading it raw would
  // make the chip disappear from the normal case.
  const [memberships, setMemberships] = useState<LodgingMembership[]>([]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setFailure(null);
      try {
        const data = await getLodging(id);
        if (!cancelled) {
          setLodging(data);
          setAggregatesStale(false);
        }
      } catch (err: unknown) {
        logger.error("LodgingDetailPage: failed to load lodging", err);
        if (!cancelled) setFailure(classifyLoadFailure(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const trips = await tripsApi.getAll();
        if (!cancelled) {
          setTripNameById(Object.fromEntries(trips.map((trip) => [trip.id, trip.name])));
        }
      } catch (err: unknown) {
        logger.error("LodgingDetailPage: failed to load trips", err);
      }
    })();
    void (async () => {
      try {
        const rows = await listMemberships();
        if (!cancelled) setMemberships(rows);
      } catch (err: unknown) {
        logger.error("LodgingDetailPage: failed to load memberships", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The owner-decided-and-non-negotiable safety net: deletion cascades to
  // every stay in the DB (no `Restrict`), so this is the ONLY confirmation
  // standing between the user and losing every stay attached to this
  // lodging. It must name the count and must never be skippable.
  const handleDelete = async (): Promise<void> => {
    if (!id) return;
    setDeleting(true);
    try {
      await deleteLodging(id);
      addToast("success", t("lodging:detail.deleteSuccess"));
      // The list, not the origin: returning to the chain page would show the
      // hotel that was just deleted until that page refetched.
      navigate("/lodging");
    } catch (err: unknown) {
      logger.error("LodgingDetailPage: delete failed", err);
      addToast("error", t("lodging:detail.deleteError"));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  /**
   * ONE deletion path for a stay, reached from a stay card and from the
   * editor's footer. The confirmation in front of it is the only thing between
   * the reader and a stay that is gone, so the request lives here and nowhere
   * else — two call sites would be two places to forget the reload.
   */
  const handleStayDelete = async (): Promise<void> => {
    const stay = confirmingStayDelete;
    if (stay === null || !lodging) return;
    setDeletingStay(true);
    try {
      await deleteStay(lodging.id, stay.id);
    } catch (err: unknown) {
      logger.error("LodgingDetailPage: stay delete failed", err);
      addToast("error", t("lodging:stay.deleteError"));
      setDeletingStay(false);
      setConfirmingStayDelete(null);
      return;
    }
    setDeletingStay(false);
    setConfirmingStayDelete(null);
    // The editor closes too: it is showing a stay that no longer exists, and
    // saving from there would answer 404.
    setEditingStay(null);
    addToast("success", t("lodging:stay.deleted"));
    // The same reload a stay SAVE does — the aggregates (nights, stayCount,
    // overallRating, totalSpendBase) are only ever attached server-side on a
    // lodging fetch, so the header would otherwise keep counting the deleted
    // stay.
    try {
      setLodging(await getLodging(lodging.id));
      setAggregatesStale(false);
    } catch (err: unknown) {
      logger.error("LodgingDetailPage: reload after stay delete failed", err);
      // The stay IS deleted; dropping it locally is closer to the truth than
      // leaving a row the server no longer has. The aggregates cannot be
      // mended the same way — they are computed server-side over the whole
      // house — so they are WITHHELD rather than left counting a stay that
      // is not in the list any more.
      setLodging((prev) =>
        prev === null ? prev : { ...prev, stays: prev.stays.filter((s) => s.id !== stay.id) }
      );
      setAggregatesStale(true);
      addToast("error", t("lodging:stay.refreshFailed"));
    }
  };

  /**
   * What the confirmation says about one stay: the period as the rest of the
   * app writes it, the nights in the same plural-aware wording the card uses,
   * and — only when there is one — that the receipt goes too.
   *
   * The period comes from `formatStayPeriod` rather than two raw dates: a
   * month-precision or undated stay has no "from – to" to print, and inventing
   * one is exactly what that helper exists to prevent.
   */
  const stayDeleteMessage = (stay: LodgingStay): string => {
    const period = formatStayPeriod(stay, i18n.language, t).label;
    const body = hasUnknownLength(stay)
      ? t("lodging:stay.confirmDelete.bodyUnknownLength", { period })
      : t("lodging:stay.confirmDelete.body", {
          period,
          nights: t("lodging:field.nightsCount", { count: stayNights(stay) }),
        });
    const withReceipt =
      stay.receiptUrl === null ? body : `${body}\n${t("lodging:stay.confirmDelete.receiptNote")}`;
    // Finding 6 of the write-path audit (2026-09-19): the note above covers
    // the LEGACY single `receiptUrl` only, while `Document.lodgingStayId`
    // cascades too (`onDelete: Cascade`, proven live by
    // `backend/src/__tests__/integrity/cascades.integrity.test.ts`). The two
    // are different things — one file the cost block links to, versus the
    // whole folder — so both lines stand.
    return withDocumentNote(withReceipt, t, stayDocumentCount);
  };

  if (loading) {
    return (
      <AppShell width="list">
        <p className="text-[var(--text-muted)]">{t("lodging:detail.loading")}</p>
      </AppShell>
    );
  }

  if (failure !== null || !lodging) {
    const isLoadError = failure === "loadError";
    return (
      <AppShell width="reading">
        <div>
          <Link to={backTo} className="ts-back-link text-sm text-[var(--text-muted)]">
            ← {backLabel}
          </Link>
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]"
          >
            {isLoadError ? t("lodging:detail.loadError") : t("lodging:detail.notFound")}
          </div>
          {isLoadError && (
            <div className="mt-3">
              <Button onClick={() => setReloadKey((k) => k + 1)}>
                {t("common:buttons.retry")}
              </Button>
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  const typeIcon = lodgingTypeIcon(lodging.type);
  // The list has shown this pill since block A; the detail page had no status
  // at all, which is one of the four differences D-08 names. Same helper, so
  // the two cannot say different things about the same house.
  const lifecycle = lodgingLifecycleStatus(lodging.stays);
  const addressLine = [lodging.address, lodging.city, lodging.country].filter(Boolean).join(", ");
  // The stays `totalSpendBase` is summed over — never all of them, or a
  // priced stay still ahead makes the card print the empty sum as "0 €"
  // (forgejo#82; the list cell had the same defect).
  const counted = countedStays(lodging.stays);
  const priced = hasAnyPrice(counted);
  const unconvertedCount = countUnconvertedStays(counted, baseCurrency);
  // Every priced stay unconverted means the base-currency sum is empty, not
  // zero: "0 €" beside a stay that cost 780 $ is the B12 defect again.
  // `aggregatesStale` withholds all four server-side figures at once: the
  // spend sum, its per-night derivation and the rating average are exactly as
  // stale as the counts, and showing three while hiding one would be the same
  // lie in a quieter voice.
  const baseKnown =
    !aggregatesStale &&
    priced &&
    unconvertedCount < counted.filter((s) => s.totalPrice !== null).length;
  const avgPerNight = lodging.nights > 0 ? lodging.totalSpendBase / lodging.nights : null;
  const originalSpend = singleOriginalCurrencySpend(counted, baseCurrency);
  const categoryRatings = averageRatingsByCategory(lodging.stays);

  const metaParts: ReactNode[] = [
    addressLine || null,
    lodging.chain ? (
      <ChainNameLink chainId={lodging.chain.id} name={lodging.chain.name} />
    ) : (
      t("lodging:field.independent")
    ),
  ].filter(Boolean);
  const kpis: DetailKpi[] = [
    {
      key: "stays",
      value: aggregatesStale ? UNKNOWN_FIGURE : lodging.stayCount,
      label: t("lodging:detail.stays"),
    },
    {
      key: "nights",
      value: aggregatesStale ? UNKNOWN_FIGURE : lodging.nights,
      label: t("lodging:detail.nights"),
    },
    ...(!aggregatesStale && lodging.overallRating !== null
      ? [
          {
            key: "rating",
            value: formatRatingText(lodging.overallRating),
            label: t("lodging:detail.avgRating"),
          },
        ]
      : []),
    ...(baseKnown
      ? [
          {
            key: "spend",
            value: formatCurrency(lodging.totalSpendBase, baseCurrency),
            label: t("lodging:detail.spend"),
          },
        ]
      : []),
    ...(baseKnown && avgPerNight !== null
      ? [
          {
            key: "perNight",
            value: formatCurrency(avgPerNight, baseCurrency),
            label: t("lodging:detail.spendPerNight"),
          },
        ]
      : []),
  ];

  return (
    <AppShell width="list">
      <DetailHeader
        backTo={backTo}
        backLabel={fromChain ? backLabel : t("lodging:detail.backToLogbook")}
        domain="lodging"
        icon={typeIcon}
        title={lodging.name}
        meta={metaParts.map((part, index) => (
          <span key={index}>
            {index > 0 && " · "}
            {part}
          </span>
        ))}
        hero={<DetailKpis items={kpis} />}
        status={
          <>
            {lifecycle ? (
              <StayStatusPill status={lifecycle} testId="lodging-detail-lifecycle" />
            ) : null}
            {lodging.stars !== null && (
              <span
                aria-label={`${lodging.stars} ★`}
                style={{ color: "var(--ts-accent)", fontSize: 13, letterSpacing: 1 }}
              >
                {"★".repeat(lodging.stars)}
              </span>
            )}
          </>
        }
        actions={
          <>
            <Button onClick={() => setEditing(true)}>{t("common:buttons.edit")}</Button>
            <Button
              variant="danger"
              data-testid="lodging-delete-button"
              onClick={() => setConfirmingDelete(true)}
            >
              {t("common:buttons.delete")}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
        <div className="flex flex-col gap-6 md:col-span-3">
          <section className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="t-label-mono">
                {t("lodging:detail.stays")} · {lodging.stays.length}
              </h2>
              <Button data-testid="lodging-add-stay-button" onClick={() => setEditingStay("new")}>
                {t("lodging:stayEditor.addStay")}
              </Button>
            </div>
            {lodging.stays.length > 0 ? (
              // A scroll box of its own rather than the page: a house with
              // dozens of stays pushed the map and the spend card off screen
              // (owner, 2026-09-05). Bounded only from md up, where the
              // sidebar sits beside it — a nested scroll area inside a
              // single-column page is a scroll trap on a phone.
              <div
                data-testid="lodging-stays-scroll"
                className="flex flex-col gap-2 md:max-h-[70vh] md:overflow-y-auto md:pr-1"
              >
                {lodging.stays.map((stay) => {
                  // The SAME function the server resolves with
                  // (shared/membershipDerivation.ts) and the stay editor
                  // already uses — so the list gives the same answer as the
                  // editor for the same stay, instead of two different ones.
                  const resolvedMembership = deriveStayMembership({
                    overrideId: stay.membershipId,
                    optOut: stay.membershipOptOut,
                    lodgingId: lodging.id,
                    lodgingChainId: lodging.chainId,
                    memberships: memberships.map((m) => ({
                      id: m.id,
                      createdAt: m.createdAt,
                      chainIds: m.chainIds,
                      lodgingIds: m.lodgingIds,
                    })),
                  });
                  const membershipName =
                    resolvedMembership.membershipId !== null
                      ? memberships.find((m) => m.id === resolvedMembership.membershipId)
                          ?.programName
                      : undefined;
                  return (
                    <LodgingStayCard
                      key={stay.id}
                      stay={stay}
                      onEdit={setEditingStay}
                      onDelete={setConfirmingStayDelete}
                      tripName={stay.tripId ? tripNameById[stay.tripId] : undefined}
                      membershipName={membershipName}
                      membershipSource={resolvedMembership.source}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="t-caption">{t("lodging:detail.staysEmpty")}</p>
            )}
          </section>

          <DetailSection
            title={t("lodging:detail.spend")}
            facts={[
              {
                label: t("lodging:detail.spendOriginal"),
                value: originalSpend
                  ? formatCurrency(originalSpend.amount, originalSpend.currency)
                  : null,
                mono: true,
              },
              {
                label: t("lodging:detail.spendBase"),
                value: baseKnown ? formatCurrency(lodging.totalSpendBase, baseCurrency) : "—",
                mono: true,
              },
              {
                label: t("lodging:detail.spendPerNight"),
                value:
                  baseKnown && avgPerNight !== null
                    ? formatCurrency(avgPerNight, baseCurrency)
                    : "—",
                mono: true,
              },
            ]}
          >
            <PlannedSpendNote stays={lodging.stays} />
            {/* A total that left rows out must say so. Silence here reads as
                "this is everything", which is exactly the lie the marker on
                each stay exists to prevent. */}
            {unconvertedCount > 0 && (
              <p data-testid="lodging-omitted-from-total" className="t-caption">
                {t("lodging:fx.omittedFromTotal", { count: unconvertedCount })}
              </p>
            )}
          </DetailSection>
        </div>

        <aside className="flex flex-col gap-6 md:col-span-2">
          <DetailSection title={t("lodging:detail.location")}>
            <LodgingMiniMap lodging={lodging} onSetLocation={() => setEditing(true)} />
          </DetailSection>

          <DetailSection title={t("lodging:detail.avgRating")}>
            <dl className="flex flex-col gap-2 text-sm">
              {(
                [
                  ["ratingRoom", categoryRatings.room],
                  ["ratingBreakfast", categoryRatings.breakfast],
                  ["ratingService", categoryRatings.service],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <dt className="t-caption">{t(`lodging:field.${key}`)}</dt>
                  <dd>
                    <StarRating value={value} />
                  </dd>
                </div>
              ))}
            </dl>
          </DetailSection>

          {lodging.amenities.length > 0 && (
            <DetailSection title={t("lodging:field.amenities")}>
              <div className="flex flex-wrap gap-1.5">
                {lodging.amenities.map((a) => (
                  <span
                    key={a}
                    className="rounded-full border px-2.5 py-0.5 text-xs"
                    style={{ borderColor: "var(--ts-border)", color: "var(--ts-text)" }}
                  >
                    {a}
                  </span>
                ))}
              </div>
            </DetailSection>
          )}

          {id && <LodgingPhotoSection lodgingId={id} />}

          {/* The notes, under the same name the form gives them. They were
              stored and never shown, so anything typed there disappeared on
              save. Rendered only when there are some. */}
          {lodging.notes !== null && lodging.notes.trim().length > 0 && (
            <DetailSection title={t("lodging:field.notes")}>
              <p className="whitespace-pre-line text-sm" style={{ color: "var(--ts-text)" }}>
                {lodging.notes}
              </p>
            </DetailSection>
          )}
        </aside>
      </div>

      {editing && (
        <LodgingFormModal
          mode="edit"
          lodging={lodging}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setLodging(updated);
            setEditing(false);
          }}
        />
      )}

      {editingStay !== null && (
        <StayEditor
          mode={editingStay === "new" ? "create" : "edit"}
          lodgingId={lodging.id}
          lodgingChainId={lodging.chainId}
          lodgingCountryCode={lodging.isoCountryCode}
          stay={editingStay === "new" ? null : editingStay}
          // Only for a stay that exists — a create form has nothing to delete.
          onRequestDelete={
            editingStay === "new" ? undefined : () => setConfirmingStayDelete(editingStay)
          }
          onClose={() => setEditingStay(null)}
          onSaved={async (savedStay) => {
            setEditingStay(null);
            // A stay write doesn't return the parent lodging's recomputed
            // aggregates (nights/stayCount/overallRating/totalSpendBase) —
            // those are only ever attached server-side via
            // `computeAggregates` on a lodging fetch, so a full reload is
            // the only way to keep this page's header stats correct.
            try {
              const fresh = await getLodging(lodging.id);
              setLodging(fresh);
            } catch (err: unknown) {
              logger.error("LodgingDetailPage: reload after stay save failed", err);
              // Fall back to a client-side merge so the new/edited stay is
              // still visible even if the reload itself failed.
              setLodging((prev) => {
                if (!prev) return prev;
                const stays = prev.stays.some((s) => s.id === savedStay.id)
                  ? prev.stays.map((s) => (s.id === savedStay.id ? savedStay : s))
                  : [...prev.stays, savedStay];
                return { ...prev, stays };
              });
            }
          }}
        />
      )}

      {/* Same component and same keys as the lodging LIST — this was the
            clearest case of the six: deleting a house looked different
            depending on whether you did it from the list or from here. */}
      <ConfirmModal
        isOpen={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => void handleDelete()}
        isLoading={deleting}
        title={t("lodging:detail.deleteConfirmTitle")}
        message={countedDeleteMessage(
          t,
          {
            counted: "lodging:detail.deleteConfirmMessage",
            empty: "lodging:detail.deleteConfirmMessageNoStays",
          },
          lodging.name,
          lodging.stayCount
        )}
        confirmText={t("common:buttons.delete")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />

      {/* The same dialog for the stay — rendered after the editor so that, at
          equal z-index, the later portal is the one on top. Both entry points
          lead here, so there is exactly one place a stay can be deleted from. */}
      <ConfirmModal
        isOpen={confirmingStayDelete !== null}
        onClose={() => setConfirmingStayDelete(null)}
        onConfirm={() => void handleStayDelete()}
        isLoading={deletingStay}
        title={t("lodging:stay.confirmDelete.title")}
        message={confirmingStayDelete === null ? "" : stayDeleteMessage(confirmingStayDelete)}
        confirmText={t("common:buttons.delete")}
        confirmButtonClass={DELETE_BUTTON_CLASS}
      />
    </AppShell>
  );
}
