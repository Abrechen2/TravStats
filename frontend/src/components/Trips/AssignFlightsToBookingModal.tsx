import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { flightsApi } from "../../lib/api/flights";
import { tripsApi } from "../../lib/api/trips";
import { logger } from "../../lib/logger";
import { attachFailureReason, type AttachFailure } from "../../lib/trips/attachableEntries";
import { flightDeparture } from "../../lib/entityTimes";
import { dayOf } from "../../shared/time";
import type { Booking, Flight } from "../../types";

/** Rows drawn at once; more than this is a search, and the dialog says so. */
const VISIBLE_ROWS = 100;

interface Props {
  booking: Booking;
  /** `true` when flights were filed (or a write timed out and nobody knows). */
  onClose: (changed: boolean) => void;
}

type Load =
  | { status: "loading" }
  | { status: "failed"; reason: AttachFailure }
  | { status: "ready"; flights: Flight[] };

const fold = (value: string): string =>
  value
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();

function label(f: Flight): string {
  const departure = flightDeparture(f);
  const day = departure ? dayOf(departure) : "—";
  const route = `${f.depIata ?? f.depIcao ?? "???"} → ${f.arrIata ?? f.arrIcao ?? "???"}`;
  return `${day} · ${route}${f.flightNumber ? ` · ${f.flightNumber}` : ""}`;
}

/**
 * "Flüge dieser Buchung zuordnen" (forgejo#407): pick any of the account's
 * flights — not only the trip's own, which the booking editor offers — and file
 * them on the booking with `POST /trips/bookings/:id/flights`. One call, all or
 * nothing: a refusal is shown once, in the reader's language, and files none.
 */
export default function AssignFlightsToBookingModal({ booking, onClose }: Props): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AttachFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    void (async () => {
      try {
        const flights = await flightsApi.getEvery();
        if (!cancelled) setLoad({ status: "ready", flights });
      } catch (error) {
        logger.warn("Loading the flights for the booking picker failed", error);
        if (!cancelled) setLoad({ status: "failed", reason: attachFailureReason(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const { rows, alreadyHere } = useMemo(() => {
    if (load.status !== "ready") return { rows: [] as Flight[], alreadyHere: 0 };
    const free = load.flights.filter((f) => f.bookingId !== booking.id);
    const q = fold(query);
    return {
      rows: q ? free.filter((f) => fold(label(f)).includes(q)) : free,
      alreadyHere: load.flights.length - free.length,
    };
  }, [load, query, booking.id]);
  const visible = rows.slice(0, VISIBLE_ROWS);

  const toggle = (id: string): void =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const submit = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await tripsApi.fileFlightsOnBooking(booking.id, [...picked]);
      onClose(true);
    } catch (error) {
      logger.warn("Filing flights on the booking failed", error);
      const reason = attachFailureReason(error);
      setFailure(reason);
      // A write the client gave up on may still have landed.
      if (reason === "timeout") setPicked(new Set());
    } finally {
      setBusy(false);
    }
  };

  const muted = { color: "var(--ts-muted)" };
  return (
    <Modal
      open
      onClose={() => onClose(failure === "timeout")}
      busy={busy}
      title={t("trips:bookingAssign.title")}
      maxWidth={560}
      closeLabel={t("trips:bookingAssign.close")}
      testId="assign-flights-to-booking"
      footer={
        <>
          <span className="mr-auto text-xs" style={muted} role="status">
            {t("trips:bookingAssign.selected", { count: picked.size })}
          </span>
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-sm"
            disabled={busy}
            onClick={() => onClose(failure === "timeout")}
          >
            {t("trips:bookingAssign.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary px-3 py-1.5 text-sm"
            disabled={busy || picked.size === 0}
            onClick={() => void submit()}
          >
            {busy ? t("trips:bookingAssign.filing") : t("trips:bookingAssign.file")}
          </button>
        </>
      }
    >
      <>
        {load.status === "loading" && (
          <p role="status" className="text-sm" style={muted}>
            {t("trips:bookingAssign.loading")}
          </p>
        )}
        {load.status === "failed" && (
          <p role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
            {t("trips:bookingAssign.loadFailed")} {t(`trips:addExisting.failure.${load.reason}`)}{" "}
            <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>
              {t("trips:addExisting.retry")}
            </button>
          </p>
        )}
        {load.status === "ready" && (
          <>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("trips:bookingAssign.searchLabel")}
              placeholder={t("trips:bookingAssign.searchPlaceholder")}
              className="mb-3 w-full rounded-md border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--color-border)", background: "var(--bg-elevated)" }}
            />
            {visible.length === 0 ? (
              <p className="text-sm" style={muted}>
                {t(query ? "trips:bookingAssign.noMatches" : "trips:bookingAssign.empty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {visible.map((f) => (
                  <li key={f.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={picked.has(f.id)}
                        disabled={busy}
                        onChange={() => toggle(f.id)}
                      />
                      <span>{label(f)}</span>
                      {f.bookingId ? (
                        <span className="text-xs" style={muted}>
                          {t("trips:bookingAssign.onOtherBooking")}
                        </span>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {rows.length > visible.length && (
              <p className="mt-2 text-xs" style={muted}>
                {t("trips:bookingAssign.truncated", { count: rows.length - visible.length })}
              </p>
            )}
            {alreadyHere > 0 && (
              <p className="mt-2 text-xs" style={muted}>
                {t("trips:bookingAssign.alreadyHere", { count: alreadyHere })}
              </p>
            )}
          </>
        )}
        {failure && (
          <p role="alert" className="mt-3 text-sm" style={{ color: "var(--ts-bad)" }}>
            {t(
              failure === "timeout"
                ? "trips:bookingAssign.timeout"
                : `trips:addExisting.failure.${failure}`
            )}
          </p>
        )}
      </>
    </Modal>
  );
}
