import { useCallback, useEffect, useState, type JSX } from "react";
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
/** Whole cents — the comparison the server makes, so the button never promises a save it refuses. */
const cents = (n: number): number => Math.round(Number((n * 100).toPrecision(12)));

interface Props {
  bookingId: string;
  /** The entry the card is shown on, marked in the list. */
  highlight?: { kind: BookingItemKind; id: string };
}

/**
 * A booking as a package (forgejo#430): the one price, every entry it sold,
 * and each entry's share — or "Teil eines Pakets" where the price is not
 * split, never 0 and never the whole price. Splitting is equal or by the
 * user's own amounts, which must add up to the price exactly.
 */
export function PackageBookingCard({ bookingId, highlight }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["trips", "common"]);
  const [answer, setAnswer] = useState<BookingPackageAnswer | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);

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
  const canSplit = isPackage && booking.price !== null && paying.length >= 2;

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

  return (
    <section className="space-y-2 text-sm" data-testid="package-booking">
      <h3 className="t-label-mono">
        {t("trips:bookingPackage.title")}
        {booking.operator || booking.pnr ? ` · ${booking.operator ?? booking.pnr}` : ""}
      </h3>
      <p>
        {booking.price !== null
          ? t("trips:bookingPackage.total", { amount: money(booking.price) })
          : t("trips:bookingPackage.noTotal")}
      </p>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {t(isPackage ? "trips:bookingPackage.isPackage" : "trips:bookingPackage.notPackage")}
      </p>
      <ul className="space-y-1" data-testid="package-items">
        {items.map((item, idx) => {
          const own = highlight && key(highlight) === key(item);
          const payingIdx = paying.indexOf(item);
          return (
            <li key={key(item)} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span style={{ color: "var(--text-muted)" }}>
                  {t(`trips:bookingPackage.kind.${item.kind}`)}
                </span>{" "}
                {item.label}
                {own ? ` ${t("trips:bookingPackage.thisEntry")}` : ""}
                {item.status === "cancelled" ? ` (${t("trips:bookingPackage.cancelled")})` : ""}
              </span>
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
      {isPackage && !draft && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {split?.staleReason
            ? t("trips:bookingPackage.stale")
            : split
              ? null
              : t("trips:bookingPackage.notSplit")}
        </p>
      )}
      {draft && booking.price !== null && (
        <p className="text-xs" data-testid="package-sum">
          {restCents === 0 && draftComplete
            ? t("trips:bookingPackage.sum", { sum: money(draftSum), total: money(booking.price) })
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
                onClick={() =>
                  setDraft(
                    Object.fromEntries(
                      paying.map((i) => [key(i), i.share !== null ? String(i.share) : ""])
                    )
                  )
                }
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
    </section>
  );
}
