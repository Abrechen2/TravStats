import { useCallback, useEffect, useState, type JSX } from "react";
import { Link } from "react-router-dom";
import Dialog from "../ui/Dialog";
import Pill from "../ui/Pill";
import type { PackageSplitController } from "./usePackageSplit";
import { useTranslation } from "../../hooks/useTranslation";
import { bookingPackageApi } from "../../lib/api/bookingPackage";
import { logger } from "../../lib/logger";
import { saveErrorKey } from "../../lib/saveErrorMessage";
import { parseDecimalInput } from "../../lib/decimalInput";
import { formatAmount } from "../../lib/units";
import type {
  BookingItemKind,
  BookingPackageAnswer,
  BookingPackageItem,
} from "../../types/bookingPackage";

/** The split refusals the server names, each to its own sentence (forgejo#430). */
const SPLIT_ERROR_KEYS: Readonly<Record<string, string>> = {
  BOOKING_PRICE_MISSING: "trips:bookingPackage.errors.BOOKING_PRICE_MISSING",
  BOOKING_SPLIT_SINGLE_SEGMENT: "trips:bookingPackage.errors.BOOKING_SPLIT_SINGLE_SEGMENT",
  BOOKING_SPLIT_ITEMS: "trips:bookingPackage.errors.BOOKING_SPLIT_ITEMS",
  BOOKING_SPLIT_SUM: "trips:bookingPackage.errors.BOOKING_SPLIT_SUM",
};

const key = (i: { kind: string; id: string }): string => `${i.kind}:${i.id}`;

/**
 * The amounts the editor opens with: each item's current share, else the
 * amount a stale split still holds for it (forgejo#430) — the user's typed
 * figures survive a changed package and only need checking.
 */
function draftFrom(answer: BookingPackageAnswer): Record<string, string> {
  const old = new Map((answer.split?.shares ?? []).map((s) => [key(s), s.amount]));
  return Object.fromEntries(
    answer.items.map((i) => {
      const amount = i.share ?? old.get(key(i)) ?? null;
      return [key(i), amount !== null ? String(amount) : ""];
    })
  );
}

/** The package changed after the split: open the editor with the old amounts. */
const needsCheck = (a: BookingPackageAnswer): boolean =>
  a.isPackage && a.booking.price !== null && a.split?.staleReason === "segments";
/** Whole cents — the comparison the server makes, so the button never promises a save it refuses. */
const cents = (n: number): number => Math.round(Number((n * 100).toPrecision(12)));

/** Where an item of the package opens; a stay has no page of its own, so it leads to its trip. */
function itemHref(item: BookingPackageItem): string | null {
  switch (item.kind) {
    case "flight":
      return `/flights/${item.id}`;
    case "rail":
      return `/rail/${item.id}`;
    case "bus":
      return `/bus/${item.id}`;
    case "ferry":
      return `/ferry/${item.id}`;
    case "cruise":
      return `/cruises/${item.id}`;
    case "rental":
      return `/rentals/${item.id}`;
    case "stay":
      return item.tripId ? `/trips/${item.tripId}` : null;
  }
}

interface Props {
  bookingId: string;
  /** The entry the card is shown on, marked in the list. */
  highlight?: { kind: BookingItemKind; id: string };
  /**
   * The host entry's own ⋯ menu opens the split dialog (owner, 2026-11-22). Without a
   * controller the line carries its own "Paketpreis aufteilen …" button.
   */
  controller?: PackageSplitController;
}

/**
 * A booking as a package (forgejo#430), shown as ONE line on an entry: "Paketbuchung REF ·
 * Paketpreis 3.249 € · 15 Einträge" (owner, 2026-11-22). The members open behind the count; the
 * split — equal or the user's own amounts, which must add up to the price exactly — and its
 * explanation live in a dialog. An unsplit item is "Teil eines Pakets", never 0 and never the
 * whole price.
 */
export function PackageBookingCard({ bookingId, highlight, controller }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["trips", "common"]);
  const [answer, setAnswer] = useState<BookingPackageAnswer | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [ownOpen, setOwnOpen] = useState(false);
  const dialogOpen = controller ? controller.open : ownOpen;
  const setDialogOpen = controller ? controller.setOpen : setOwnOpen;
  const report = controller?.report;

  const load = useCallback(async (): Promise<void> => {
    setLoadFailed(false);
    try {
      setAnswer(await bookingPackageApi.get(bookingId));
    } catch (err) {
      logger.warn({ err }, "PackageBookingCard: load failed");
      setLoadFailed(true);
    }
  }, [bookingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canSplit =
    !!answer && answer.isPackage && answer.booking.price !== null && answer.items.length >= 2;
  useEffect(() => {
    report?.(canSplit);
  }, [report, canSplit]);

  // A stale split opens straight into the editor with the old amounts (forgejo#430).
  const stalePending = !!answer && needsCheck(answer);
  useEffect(() => {
    if (dialogOpen && stalePending && answer) setDraft((d) => d ?? draftFrom(answer));
  }, [dialogOpen, stalePending, answer]);

  if (loadFailed) {
    return (
      <div role="alert" className="text-sm" style={{ color: "var(--color-error)" }}>
        {t("trips:bookingPackage.loadFailed")}{" "}
        <button type="button" style={{ color: "var(--accent)" }} onClick={() => void load()}>
          {t("common:buttons.retry")}
        </button>
      </div>
    );
  }
  if (!answer) return <p className="text-sm">{t("trips:bookingPackage.loading")}</p>;

  const { booking, items, split, isPackage } = answer;
  const money = (value: number): string =>
    formatAmount(value, booking.currency, { language: i18n.language });
  // A split covers every item, a cancelled one too (it may have cost a fee):
  // the server checks a split against the booking's full item list.
  const paying = items;

  const run = async (action: () => Promise<BookingPackageAnswer>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      setAnswer(await action());
      setDraft(null);
    } catch (err) {
      logger.warn({ err }, "PackageBookingCard: split failed");
      setFailure(saveErrorKey(err, "trips:bookingPackage.errors.generic", SPLIT_ERROR_KEYS));
    } finally {
      setBusy(false);
    }
  };

  const draftAmounts = draft ? paying.map((i) => parseDecimalInput(draft[key(i)] ?? "")) : [];
  const draftComplete = draftAmounts.every((a) => a !== null && a >= 0);
  const draftSum = draftAmounts.reduce<number>((a, n) => a + (n ?? 0), 0);
  const restCents = booking.price === null ? 0 : cents(booking.price) - cents(draftSum);

  const shareText = (item: BookingPackageItem): string => {
    if (item.share !== null) return money(item.share);
    return isPackage ? t("trips:bookingPackage.partOfPackage") : "";
  };
  const ref = booking.operator ?? booking.pnr;
  const stale = isPackage && split?.staleReason;
  const itemLabel = (item: BookingPackageItem): string =>
    `${t(`trips:bookingPackage.kind.${item.kind}`)} ${item.label}${
      highlight && key(highlight) === key(item) ? ` ${t("trips:bookingPackage.thisEntry")}` : ""
    }${item.status === "cancelled" ? ` (${t("trips:bookingPackage.cancelled")})` : ""}`;

  return (
    <section
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
      data-testid="package-booking"
    >
      <Pill color="var(--ts-accent)">
        {t(isPackage ? "trips:bookingPackage.title" : "trips:bookingPackage.titleSingle")}
        {ref ? ` ${ref}` : ""}
      </Pill>
      <span data-testid="package-total">
        {booking.price !== null
          ? t("trips:bookingPackage.total", { amount: money(booking.price) })
          : t("trips:bookingPackage.noTotal")}
      </span>
      <span>
        <button
          type="button"
          aria-expanded={membersOpen}
          data-testid="package-members-toggle"
          style={{ color: "var(--accent)" }}
          onClick={() => setMembersOpen((o) => !o)}
        >
          {"· "}
          {t("trips:bookingPackage.entries", { count: items.length })}
        </button>
      </span>
      {stale && (
        <span role="status" className="text-xs" style={{ color: "var(--color-warning)" }}>
          {t("trips:bookingPackage.staleShort")}
        </span>
      )}
      {!controller && canSplit && (
        <button
          type="button"
          style={{ color: "var(--accent)" }}
          onClick={() => setDialogOpen(true)}
        >
          {t("trips:bookingPackage.splitMenu")}
        </button>
      )}
      <Dialog
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        title={t("trips:bookingPackage.membersTitle")}
        dismissLabel={t("common:buttons.close")}
        maxWidth={480}
      >
        <ul className="space-y-2 text-sm" data-testid="package-members">
          {items.map((item) => {
            const href = itemHref(item);
            const label = itemLabel(item);
            return (
              <li key={key(item)}>
                {href ? (
                  <Link to={href} style={{ color: "var(--accent)" }}>
                    {label}
                  </Link>
                ) : (
                  label
                )}
              </li>
            );
          })}
        </ul>
      </Dialog>
      <Dialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setDraft(null);
          setFailure(null);
        }}
        title={t("trips:bookingPackage.splitTitle")}
        dismissLabel={t("common:buttons.close")}
        maxWidth={560}
      >
        <div className="space-y-2 text-sm" data-testid="package-dialog">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t(isPackage ? "trips:bookingPackage.isPackage" : "trips:bookingPackage.notPackage")}
          </p>
          <ul className="space-y-1" data-testid="package-items">
            {items.map((item, idx) => {
              const payingIdx = paying.indexOf(item);
              return (
                <li key={key(item)} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{itemLabel(item)}</span>
                  {draft && payingIdx >= 0 ? (
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-28 text-right"
                      aria-label={t("trips:bookingPackage.amountFor", { label: item.label })}
                      value={draft[key(item)] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [key(item)]: e.target.value })}
                      data-testid={`package-amount-${idx}`}
                    />
                  ) : (
                    <span data-testid="package-share">{shareText(item)}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {stale && (
            <p className="text-xs" style={{ color: "var(--color-warning)" }}>
              {t("trips:bookingPackage.stale")}
            </p>
          )}
          {isPackage && !split && !draft && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("trips:bookingPackage.notSplit")}
            </p>
          )}
          {draft && booking.price !== null && (
            <p className="text-xs" data-testid="package-sum">
              {restCents === 0 && draftComplete
                ? t("trips:bookingPackage.sum", {
                    sum: money(draftSum),
                    total: money(booking.price),
                  })
                : t("trips:bookingPackage.sumMismatch", {
                    total: money(booking.price),
                    rest: money(restCents / 100),
                  })}
            </p>
          )}
          {failure && (
            <p role="alert" className="text-xs" style={{ color: "var(--color-error)" }}>
              {t(failure)}
            </p>
          )}
          {canSplit && (
            <div className="flex flex-wrap gap-3">
              {draft ? (
                <>
                  <button
                    type="button"
                    disabled={busy || !draftComplete || restCents !== 0}
                    style={{ color: "var(--accent)" }}
                    onClick={() =>
                      void run(() =>
                        bookingPackageApi.split(bookingId, {
                          method: "manual",
                          shares: paying.map((i, n) => ({
                            kind: i.kind,
                            id: i.id,
                            amount: draftAmounts[n] ?? 0,
                          })),
                        })
                      )
                    }
                  >
                    {t("trips:bookingPackage.splitSave")}
                  </button>
                  <button type="button" onClick={() => setDraft(null)}>
                    {t("trips:bookingPackage.splitCancel")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    style={{ color: "var(--accent)" }}
                    onClick={() =>
                      void run(() => bookingPackageApi.split(bookingId, { method: "equal" }))
                    }
                  >
                    {t("trips:bookingPackage.splitEqual")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    style={{ color: "var(--accent)" }}
                    onClick={() => setDraft(draftFrom(answer))}
                  >
                    {t("trips:bookingPackage.splitManual")}
                  </button>
                  {split && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => bookingPackageApi.removeSplit(bookingId))}
                    >
                      {t("trips:bookingPackage.splitRemove")}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Dialog>
    </section>
  );
}
