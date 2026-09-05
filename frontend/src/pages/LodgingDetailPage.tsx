import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import { LodgingFormModal } from "../components/lodging/LodgingFormModal";
import { LodgingMiniMap } from "../components/lodging/LodgingMiniMap";
import { LodgingStayCard } from "../components/lodging/LodgingStayCard";
import { StarRating } from "../components/lodging/StarRating";
import { LodgingPhotoSection } from "../components/lodging/LodgingPhotoSection";
import { StayEditor } from "../components/lodging/StayEditor";
import { ChainNameLink } from "../components/lodging/ChainNameLink";
import { useTranslation } from "../hooks/useTranslation";
import { deleteLodging, getLodging, listMemberships } from "../lib/api/lodging";
import { tripsApi } from "../lib/api";
import { formatCurrency } from "../lib/units";
import { countedStays, countUnconvertedStays } from "../lib/lodgingFormat";
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
import { countedDeleteMessage, DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { deriveStayMembership } from "../shared/membershipDerivation";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import type { Lodging, LodgingMembership, LodgingStay } from "../types/lodging";

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
  const { t } = useTranslation(["lodging", "common"]);
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
        if (!cancelled) setLodging(data);
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

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />
        <div className="p-6 text-[var(--text-muted)]">{t("lodging:detail.loading")}</div>
      </div>
    );
  }

  if (failure !== null || !lodging) {
    const isLoadError = failure === "loadError";
    return (
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />
        <div className="mx-auto max-w-3xl p-6">
          <button
            onClick={() => navigate(backTo)}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            ← {backLabel}
          </button>
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]"
          >
            {isLoadError ? t("lodging:detail.loadError") : t("lodging:detail.notFound")}
          </div>
          {isLoadError && (
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="mt-3 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {t("common:buttons.retry")}
            </button>
          )}
        </div>
      </div>
    );
  }

  const typeIcon = lodgingTypeIcon(lodging.type);
  const addressLine = [lodging.address, lodging.city, lodging.country].filter(Boolean).join(", ");
  // The stays `totalSpendBase` is summed over — never all of them, or a
  // priced stay still ahead makes the card print the empty sum as "0 €"
  // (forgejo#82; the list cell had the same defect).
  const counted = countedStays(lodging.stays);
  const priced = hasAnyPrice(counted);
  const unconvertedCount = countUnconvertedStays(counted);
  const avgPerNight = lodging.nights > 0 ? lodging.totalSpendBase / lodging.nights : null;
  const originalSpend = singleOriginalCurrencySpend(counted, baseCurrency);
  const categoryRatings = averageRatingsByCategory(lodging.stays);

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
      <NavigationBar />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <button
          onClick={() => navigate(backTo)}
          className="mb-3 text-sm text-[var(--accent)] hover:underline"
        >
          ← {backLabel}
        </button>

        {/* Hotel-header strip */}
        <div className="mb-6 flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--bg-surface)] p-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-lg text-2xl"
              style={{
                backgroundColor: "var(--domain-lodging-soft, rgba(212,119,143,.12))",
                color: "var(--domain-lodging, #d4778f)",
              }}
            >
              {typeIcon}
            </div>
            <div>
              <h1 className="text-xl font-semibold text-[var(--text-primary)]">{lodging.name}</h1>
              <p className="text-sm text-[var(--text-muted)]">
                {lodging.chain ? (
                  <ChainNameLink chainId={lodging.chain.id} name={lodging.chain.name} />
                ) : (
                  t("lodging:field.independent")
                )}
                {lodging.stars !== null ? ` · ${"★".repeat(lodging.stars)} ${lodging.stars}` : ""}
              </p>
              {addressLine.length > 0 && (
                <p className="text-sm font-medium text-[var(--text-primary)]">{addressLine}</p>
              )}
              <p className="text-xs text-[var(--text-muted)]">
                {t("lodging:detail.avgRating")} <b>{formatRatingText(lodging.overallRating)}</b> ·{" "}
                {t("lodging:field.staysCount", { count: lodging.stayCount })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md bg-[var(--accent)] px-3 py-1 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)]"
            >
              {t("common:buttons.edit")}
            </button>
            <button
              type="button"
              data-testid="lodging-delete-button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded-md border border-[var(--danger)]/50 px-3 py-1 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger)]/10"
            >
              {t("common:buttons.delete")}
            </button>
          </div>
        </div>

        {lodging.amenities.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1">
            {lodging.amenities.map((a) => (
              <span
                key={a}
                className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--text-muted)]"
              >
                {a}
              </span>
            ))}
          </div>
        )}

        {id && <LodgingPhotoSection lodgingId={id} />}

        {/* The notes, under the same name the form gives them.
            They were stored and never shown, so anything typed there
            disappeared on save. Rendered only when there are some: an empty
            heading over blank space is its own small untruth. */}
        {lodging.notes !== null && lodging.notes.trim().length > 0 && (
          <section className="mb-4">
            <h2 className="mb-1 text-sm font-semibold text-[var(--text-muted)]">
              {t("lodging:field.notes")}
            </h2>
            <p className="whitespace-pre-line text-sm text-[var(--text-primary)]">
              {lodging.notes}
            </p>
          </section>
        )}

        {/* Two-column body */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div className="md:col-span-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-muted)]">
                {t("lodging:detail.stays")}
              </h2>
              <button
                type="button"
                data-testid="lodging-add-stay-button"
                onClick={() => setEditingStay("new")}
                className="rounded-md bg-[var(--accent)] px-3 py-1 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)]"
              >
                {t("lodging:stayEditor.addStay")}
              </button>
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
                      tripName={stay.tripId ? tripNameById[stay.tripId] : undefined}
                      membershipName={membershipName}
                      membershipSource={resolvedMembership.source}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">
                {t("lodging:detail.staysEmpty")}
              </div>
            )}
          </div>

          <aside className="space-y-3 md:col-span-2">
            <LodgingMiniMap lodging={lodging} onSetLocation={() => setEditing(true)} />

            <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t("lodging:detail.spend")}
              </h3>
              <dl className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                {originalSpend && (
                  <div className="flex justify-between">
                    <dt>{t("lodging:detail.spendOriginal")}</dt>
                    <dd className="text-[var(--text-primary)]">
                      {formatCurrency(originalSpend.amount, originalSpend.currency)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt>{t("lodging:detail.spendBase")}</dt>
                  <dd style={originalSpend ? { color: "var(--fx, #6ab7d8)" } : undefined}>
                    {priced ? formatCurrency(lodging.totalSpendBase, baseCurrency) : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t("lodging:detail.spendPerNight")}</dt>
                  <dd>
                    {priced && avgPerNight !== null
                      ? formatCurrency(avgPerNight, baseCurrency)
                      : "—"}
                  </dd>
                </div>
              </dl>
              <PlannedSpendNote stays={lodging.stays} />
              {/* A total that left rows out must say so. Silence here reads as
                  "this is everything", which is exactly the lie the marker on
                  each stay exists to prevent. */}
              {unconvertedCount > 0 && (
                <p
                  data-testid="lodging-omitted-from-total"
                  className="mt-1 text-xs text-[var(--text-muted)]"
                >
                  {t("lodging:fx.omittedFromTotal", { count: unconvertedCount })}
                </p>
              )}
            </div>

            <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t("lodging:detail.avgRating")}
              </h3>
              <dl className="mt-2 space-y-1.5 text-xs text-[var(--text-muted)]">
                <div className="flex items-center justify-between">
                  <dt>{t("lodging:field.ratingRoom")}</dt>
                  <dd>
                    <StarRating value={categoryRatings.room} />
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt>{t("lodging:field.ratingBreakfast")}</dt>
                  <dd>
                    <StarRating value={categoryRatings.breakfast} />
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt>{t("lodging:field.ratingService")}</dt>
                  <dd>
                    <StarRating value={categoryRatings.service} />
                  </dd>
                </div>
              </dl>
            </div>
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
            stay={editingStay === "new" ? null : editingStay}
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
      </div>
    </div>
  );
}
