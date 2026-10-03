import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import Modal from "../Modal";
import { useLocale } from "../../hooks/useLocale";
import { useTranslation } from "../../hooks/useTranslation";
import { tripsApi } from "../../lib/api/trips";
import { logger } from "../../lib/logger";
import {
  attachEntry,
  attachFailureReason,
  loadAttachableEntries,
  type AttachableEntry,
  type AttachFailure,
} from "../../lib/trips/attachableEntries";
import type { DomainKey } from "../../shared/domains";
import { formatDayLong } from "../../shared/time/calendar";

/** Rows drawn at once. More than this is a search, not a scroll — and it says so. */
const VISIBLE_ROWS = 100;

const NO_ENTRIES: AttachableEntry[] = [];

const DAY_FORMAT: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

type DomainLoad =
  | { status: "loading" }
  | { status: "failed"; reason: AttachFailure }
  | { status: "ready"; entries: AttachableEntry[]; unlinkable: number };

/** Plain-ASCII queries find umlauts: "munchen" matches "München". */
function fold(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

interface Props {
  tripId: string;
  /** The domains this reader has switched on, in display order. Never empty. */
  domains: readonly DomainKey[];
  /**
   * `changed` — the trip may hold something it did not before: an entry was
   * filed, or a write timed out and nobody knows. The caller reloads on it.
   */
  onClose: (changed: boolean) => void;
}

/**
 * Pick existing logbook entries and file them in this trip (forgejo#188).
 *
 * One domain at a time, loaded when its tab is first opened. Each row is
 * attached by its own button, so a refusal belongs to exactly one entry and
 * is shown on it, in the reader's language — the list keeps working around it.
 * An entry that sits in another trip says so and says that adding it moves it.
 *
 * The caller is told only on close: the trip page swaps itself for a loading
 * state while it refetches, which would unmount this dialog mid-pick.
 */
export default function AddExistingEntryModal({ tripId, domains, onClose }: Props): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const locale = useLocale();

  const [domain, setDomain] = useState<DomainKey>(domains[0]);
  const [loads, setLoads] = useState<Partial<Record<DomainKey, DomainLoad>>>({});
  const [tripNames, setTripNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowFailures, setRowFailures] = useState<Record<string, AttachFailure>>({});
  const [attached, setAttached] = useState(0);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const requested = useRef(new Set<DomainKey>());

  const loadDomain = useCallback(async (key: DomainKey): Promise<void> => {
    setLoads((prev) => ({ ...prev, [key]: { status: "loading" } }));
    try {
      const load = await loadAttachableEntries(key);
      setLoads((prev) => ({ ...prev, [key]: { status: "ready", ...load } }));
    } catch (error) {
      logger.warn("Loading the attachable entries failed", error);
      setLoads((prev) => ({
        ...prev,
        [key]: { status: "failed", reason: attachFailureReason(error) },
      }));
    }
  }, []);

  useEffect(() => {
    if (requested.current.has(domain)) return;
    requested.current.add(domain);
    void loadDomain(domain);
  }, [domain, loadDomain]);

  // Only the NAME of the trip an entry would leave. Without it the row still
  // says the entry moves — it just cannot say from where.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const trips = await tripsApi.getAll();
        if (!cancelled) setTripNames(new Map(trips.map((trip) => [trip.id, trip.name])));
      } catch (error) {
        logger.warn("Loading the trip names for the entry picker failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const attach = async (entry: AttachableEntry): Promise<void> => {
    setBusyId(entry.id);
    setRowFailures(({ [entry.id]: _cleared, ...rest }) => rest);
    try {
      await attachEntry(tripId, entry);
      setLoads((prev) => {
        const load = prev[entry.domain];
        if (load?.status !== "ready") return prev;
        return {
          ...prev,
          [entry.domain]: {
            ...load,
            entries: load.entries.map((e) => (e.id === entry.id ? { ...e, tripId } : e)),
          },
        };
      });
      setAttached((n) => n + 1);
    } catch (error) {
      logger.warn("Attaching an entry to the trip failed", error);
      const reason = attachFailureReason(error);
      // A write the client gave up on may still have landed on the server.
      if (reason === "timeout") setOutcomeUnknown(true);
      setRowFailures((prev) => ({ ...prev, [entry.id]: reason }));
    } finally {
      setBusyId(null);
    }
  };

  const formatDays = (entry: AttachableEntry): string => {
    if (!entry.day) return t("trips:addExisting.undated");
    const start = formatDayLong(entry.day, locale, DAY_FORMAT);
    return entry.endDay && entry.endDay !== entry.day
      ? `${start} – ${formatDayLong(entry.endDay, locale, DAY_FORMAT)}`
      : start;
  };

  const load = loads[domain] ?? { status: "loading" };
  const all = load.status === "ready" ? load.entries : NO_ENTRIES;
  const elsewhere = useMemo(() => all.filter((e) => e.tripId !== tripId), [all, tripId]);
  const alreadyHere = all.length - elsewhere.length;
  const matches = useMemo(() => {
    const needle = fold(query);
    if (!needle) return elsewhere;
    return elsewhere.filter((e) =>
      fold(
        [e.title, e.subtitle, e.day, e.tripId ? tripNames.get(e.tripId) : null]
          .filter(Boolean)
          .join(" ")
      ).includes(needle)
    );
  }, [elsewhere, query, tripNames]);
  const visible = matches.slice(0, VISIBLE_ROWS);
  const muted = { color: "var(--ts-muted)" };

  const close = (): void => onClose(attached > 0 || outcomeUnknown);

  return (
    <Modal
      open
      onClose={close}
      busy={busyId !== null}
      title={t("trips:addExisting.title")}
      maxWidth={560}
      closeLabel={t("trips:addExisting.close")}
      testId="add-existing-entry"
      footer={
        <>
          <span className="mr-auto text-xs" style={muted} role="status">
            {attached > 0 ? t("trips:addExisting.added", { count: attached }) : ""}
          </span>
          <button
            type="button"
            className="btn-primary px-3 py-1.5 text-sm"
            disabled={busyId !== null}
            onClick={close}
          >
            {t("trips:addExisting.done")}
          </button>
        </>
      }
    >
      <>
        <div
          className="mb-3 flex flex-wrap gap-2"
          role="tablist"
          aria-label={t("trips:addExisting.domainLabel")}
        >
          {domains.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === domain}
              className="rounded px-2 py-1 text-xs"
              style={
                key === domain
                  ? { background: "var(--accent)", color: "var(--ts-bg)" }
                  : { border: "1px solid var(--ts-border)" }
              }
              onClick={() => {
                setDomain(key);
                setQuery("");
              }}
            >
              {t(`common:domain.${key}`)}
            </button>
          ))}
        </div>

        {load.status === "loading" && (
          <p className="text-sm" style={muted}>
            {t("trips:addExisting.loading")}
          </p>
        )}

        {load.status === "failed" && (
          <div role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
            <p>
              {t("trips:addExisting.loadFailed")} {t(`trips:addExisting.failure.${load.reason}`)}
            </p>
            <button
              type="button"
              className="btn-secondary mt-2 px-3 py-1.5 text-sm"
              onClick={() => void loadDomain(domain)}
            >
              {t("trips:addExisting.retry")}
            </button>
          </div>
        )}

        {load.status === "ready" && (
          <>
            {elsewhere.length > 0 && (
              <input
                type="search"
                aria-label={t("trips:addExisting.searchLabel")}
                placeholder={t("trips:addExisting.searchPlaceholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="mb-3 w-full rounded-sm px-2 py-1.5 text-sm"
                style={{ border: "1px solid var(--ts-border)", background: "var(--ts-surface2)" }}
              />
            )}

            {all.length === 0 && (
              <p className="text-sm" style={muted}>
                {t("trips:addExisting.empty")}
              </p>
            )}
            {all.length > 0 && elsewhere.length === 0 && (
              <p className="text-sm" style={muted}>
                {t("trips:addExisting.allHere")}
              </p>
            )}
            {elsewhere.length > 0 && matches.length === 0 && (
              <p className="text-sm" style={muted}>
                {t("trips:addExisting.noMatches")}
              </p>
            )}

            <ul className="space-y-2">
              {visible.map((entry) => {
                const moves = entry.tripId !== null;
                const otherTrip = entry.tripId ? tripNames.get(entry.tripId) : undefined;
                const failure = rowFailures[entry.id];
                const busy = busyId === entry.id;
                return (
                  <li
                    key={entry.id}
                    className="rounded-sm p-2"
                    style={{ border: "1px solid var(--ts-border)" }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{entry.title}</span>
                        <span className="block text-xs" style={muted}>
                          {[entry.subtitle, formatDays(entry)].filter(Boolean).join(" · ")}
                        </span>
                        {moves && (
                          <span className="block text-xs" style={{ color: "var(--ts-warn)" }}>
                            {otherTrip
                              ? t("trips:addExisting.inOtherTrip", { name: otherTrip })
                              : t("trips:addExisting.inOtherTripUnnamed")}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="btn-secondary shrink-0 px-3 py-1.5 text-sm"
                        disabled={busyId !== null}
                        aria-label={t(
                          moves ? "trips:addExisting.moveLabel" : "trips:addExisting.addLabel",
                          { title: entry.title }
                        )}
                        onClick={() => void attach(entry)}
                      >
                        {busy
                          ? t("trips:addExisting.adding")
                          : t(moves ? "trips:addExisting.move" : "trips:addExisting.add")}
                      </button>
                    </div>
                    {failure && (
                      <p role="alert" className="mt-1 text-xs" style={{ color: "var(--ts-bad)" }}>
                        {t(
                          failure === "timeout"
                            ? "trips:addExisting.attachTimeout"
                            : `trips:addExisting.failure.${failure}`
                        )}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            {matches.length > visible.length && (
              <p className="mt-2 text-xs" style={muted}>
                {t("trips:addExisting.truncated", { count: matches.length - visible.length })}
              </p>
            )}
            {alreadyHere > 0 && (
              <p className="mt-2 text-xs" style={muted}>
                {t("trips:addExisting.alreadyHere", { count: alreadyHere })}
              </p>
            )}
            {load.unlinkable > 0 && (domain === "lodging" || domain === "poi") && (
              <p className="mt-2 text-xs" style={muted}>
                {t(`trips:addExisting.unlinkable.${domain}`, { count: load.unlinkable })}
              </p>
            )}
          </>
        )}
      </>
    </Modal>
  );
}
