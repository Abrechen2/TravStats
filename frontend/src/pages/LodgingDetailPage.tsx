import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useParams, useNavigate } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import { LodgingFormModal } from "../components/lodging/LodgingFormModal";
import { LodgingMiniMap } from "../components/lodging/LodgingMiniMap";
import { LodgingStayCard } from "../components/lodging/LodgingStayCard";
import { useTranslation } from "../hooks/useTranslation";
import { deleteLodging, getLodging } from "../lib/api/lodging";
import { formatCurrency } from "../lib/units";
import { logger } from "../lib/logger";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import type { Lodging } from "../types/lodging";

/** "★ 4.3" for a rating, "—" when there is nothing to average yet (no rated stays). */
function overallRatingText(value: number | null): string {
  return value !== null ? `★ ${value}` : "—";
}

export default function LodgingDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["lodging", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  // No dedicated `baseCurrency` wired to the frontend yet (Task 19 adds the
  // settings-page currency picker) — `units.currency` is the same
  // aggregate-spend-formatting proxy already used by LodgingStatStrip.tsx.
  const baseCurrency = useSettingsStore((s) => s.units.currency);

  const [lodging, setLodging] = useState<Lodging | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [editing, setEditing] = useState<boolean>(false);
  const [confirmingDelete, setConfirmingDelete] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const data = await getLodging(id);
        if (!cancelled) setLodging(data);
      } catch (err: unknown) {
        logger.error("LodgingDetailPage: failed to load lodging", err);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

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

  if (notFound || !lodging) {
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
            {t("lodging:detail.notFound")}
          </div>
        </div>
      </div>
    );
  }

  const typeIcon = lodging.type === "campsite" ? "⛺" : "🏨";
  const addressLine = [lodging.address, lodging.city, lodging.country].filter(Boolean).join(", ");
  const avgPerNight = lodging.nights > 0 ? lodging.totalSpendBase / lodging.nights : null;

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
                {lodging.chain?.name ?? t("lodging:field.independent")}
                {lodging.stars !== null ? ` · ${"★".repeat(lodging.stars)} ${lodging.stars}` : ""}
              </p>
              {addressLine.length > 0 && (
                <p className="text-sm font-medium text-[var(--text-primary)]">{addressLine}</p>
              )}
              <p className="text-xs text-[var(--text-muted)]">
                {t("lodging:detail.avgRating")} <b>{overallRatingText(lodging.overallRating)}</b> ·{" "}
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

        {/* Two-column body */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div className="md:col-span-3">
            <h2 className="mb-2 text-sm font-semibold text-[var(--text-muted)]">
              {t("lodging:detail.stays")}
            </h2>
            {lodging.stays.length > 0 ? (
              <div className="flex flex-col gap-2">
                {lodging.stays.map((stay) => (
                  <LodgingStayCard key={stay.id} stay={stay} />
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">
                {t("lodging:detail.staysEmpty")}
              </div>
            )}
          </div>

          <aside className="space-y-3 md:col-span-2">
            <LodgingMiniMap lodging={lodging} />

            <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t("lodging:detail.spend")}
              </h3>
              <dl className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                <div className="flex justify-between">
                  <dt>{t("lodging:detail.spendBase")}</dt>
                  <dd>{formatCurrency(lodging.totalSpendBase, baseCurrency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>{t("lodging:detail.spendPerNight")}</dt>
                  <dd>{avgPerNight !== null ? formatCurrency(avgPerNight, baseCurrency) : "—"}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t("lodging:detail.avgRating")}
              </h3>
              <p className="mt-2 text-sm" style={{ color: "var(--star)" }}>
                {overallRatingText(lodging.overallRating)}
              </p>
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

        {confirmingDelete && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--bg-elevated)] p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                {t("lodging:detail.deleteConfirmTitle")}
              </h3>
              <p
                className="mt-2 text-sm text-[var(--text-muted)]"
                data-testid="lodging-delete-message"
                data-stay-count={lodging.stayCount}
              >
                {t("lodging:detail.deleteConfirmMessage", { count: lodging.stayCount })}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  data-testid="lodging-delete-cancel"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
                >
                  {t("common:buttons.cancel")}
                </button>
                <button
                  type="button"
                  data-testid="lodging-delete-confirm"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="rounded-md bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {t("common:buttons.delete")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
