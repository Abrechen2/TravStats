import { useEffect, useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import type { Cruise, CruiseStopInput } from "../../types";
import { cruiseApi } from "../../lib/api/cruise";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { formatLocalClock } from "../../lib/displayFormat";
import { isTransientSaveError, saveErrorKey } from "../../lib/saveErrorMessage";
import { FormErrorBanner } from "../form";
import { stopTitle } from "./CruiseStopSummary";
import { stopInputsOf } from "./cruiseFormDraft";
import { cruiseStopToWire } from "./cruiseStopWire";
import { cruiseDisplayName } from "./cruiseDeleteMessage";
import { diffItinerary, mergeItinerary } from "./cruiseReimportDiff";
import type { ReimportChange } from "./cruiseReimportDiff";

/** A re-read booking the server already holds: its id, and the plan as read now. */
export interface ReimportConflict {
  existingId: string;
  stops: CruiseStopInput[];
}

export interface ReimportSummary {
  /** Cruises whose stored plan took at least one change. */
  applied: number;
  /** Cruises whose plan matched the stored one. */
  unchanged: number;
  /** Cruises left as stored by choice, or because they could not be read. */
  kept: number;
}

type Loaded =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; cruise: Cruise; stored: CruiseStopInput[]; changes: ReimportChange[] };

type Translate = (key: string, options?: Record<string, unknown>) => string;

const CHECK_ROW =
  "flex items-start gap-2 text-sm text-(--text-primary) pointer-coarse:min-h-(--ts-size-touch-min)";

/** "08:00 – 18:30" on the port's clock; a time the plan does not state reads "offen". */
function times(t: Translate, stop: CruiseStopInput): string {
  const clock = (value: string | null | undefined): string =>
    value ? formatLocalClock(value.slice(0, 16)) : t("dayCard.open");
  return `${clock(stop.arrivalTime)} – ${clock(stop.departureTime)}`;
}

function describe(t: Translate, change: ReimportChange): string {
  switch (change.kind) {
    case "added":
      return t("reimport.added", { day: change.day, title: stopTitle(change.imported, t) });
    case "removed":
      return t("reimport.removed", { day: change.day, title: stopTitle(change.stored, t) });
    case "port":
      return t("reimport.port", {
        day: change.day,
        from: stopTitle(change.stored, t),
        to: stopTitle(change.imported, t),
      });
    case "times":
      return t("reimport.times", {
        day: change.day,
        title: stopTitle(change.stored, t),
        from: times(t, change.stored),
        to: times(t, change.imported),
      });
  }
}

/** What the user wrote for that day and what happens to it, in words. */
function ownNotes(t: Translate, change: ReimportChange): string[] {
  if (change.kind === "added") return [];
  const notes: string[] = [];
  const note = change.stored.excursionNote?.trim();
  if (note) {
    notes.push(
      change.kind === "removed"
        ? t("reimport.noteGoes", { note })
        : t("reimport.noteStays", { note })
    );
  }
  // The all-aboard time belongs to the port, so a new port does not keep it.
  if (change.kind === "port" && change.stored.allAboardTime) {
    notes.push(
      t("reimport.allAboardGoes", {
        time: formatLocalClock(change.stored.allAboardTime),
        port: stopTitle(change.stored, t),
      })
    );
  }
  return notes;
}

/**
 * A booking read again whose cruise is already stored (forgejo#225): the new
 * plan beside the stored one, change by change — a day added, a day gone, a
 * port swapped, a time moved — each taken or left by its own checkbox.
 *
 * What the user wrote is not part of the comparison and survives whatever is
 * taken: the excursion note, the all-aboard time, a typed date — except the
 * all-aboard time of a port the plan swaps for another, which the row names. A removal is
 * the one change that would delete such things, so it starts unticked. The
 * merge matches by day of the cruise, so taking the same plan twice finds
 * nothing left the second time and adds no port call twice.
 *
 * One cruise at a time; a plan that matches the stored one is passed without
 * a question.
 */
export function CruiseReimportCompare({
  conflicts,
  onDone,
}: {
  conflicts: readonly ReimportConflict[];
  onDone: (summary: ReimportSummary) => void;
}): JSX.Element | null {
  const { t } = useTranslation(["cruise", "common"]);
  const [index, setIndex] = useState(0);
  const [summary, setSummary] = useState<ReimportSummary>({ applied: 0, unchanged: 0, kept: 0 });
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const conflict = conflicts[index];

  const advance = (outcome: keyof ReimportSummary): void => {
    const next = { ...summary, [outcome]: summary[outcome] + 1 };
    setSummary(next);
    setFailure(null);
    if (index + 1 >= conflicts.length) onDone(next);
    else setIndex(index + 1);
  };

  useEffect(() => {
    if (!conflict) return;
    let cancelled = false;
    setLoaded({ status: "loading" });
    cruiseApi
      .get(conflict.existingId)
      .then((cruise) => {
        if (cancelled) return;
        const stored = stopInputsOf(cruise.stops);
        const changes = diffItinerary(stored, conflict.stops);
        setAccepted(new Set(changes.filter((c) => c.kind !== "removed").map((c) => c.id)));
        setLoaded({ status: "ready", cruise, stored, changes });
      })
      .catch((err: unknown) => {
        logger.error("CruiseReimportCompare: could not read the stored cruise", err);
        if (!cancelled) setLoaded({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [conflict, attempt]);

  // The same plan as stored: nothing to ask.
  const nothingToAsk = loaded.status === "ready" && loaded.changes.length === 0;
  useEffect(() => {
    if (nothingToAsk) advance("unchanged");
  }, [nothingToAsk, loaded]);

  if (!conflict || nothingToAsk) return null;

  const apply = async (): Promise<void> => {
    if (loaded.status !== "ready") return;
    setSaving(true);
    setFailure(null);
    try {
      const merged = mergeItinerary(loaded.stored, loaded.changes, accepted);
      await cruiseApi.update(loaded.cruise.id, { stops: merged.map(cruiseStopToWire) });
      advance("applied");
    } catch (err: unknown) {
      logger.error("CruiseReimportCompare: applying the new plan failed", err);
      setFailure(saveErrorKey(err, "cruise:reimport.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string, on: boolean): void => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    setFailure(null);
  };

  const ready = loaded.status === "ready" ? loaded : null;

  return (
    <Modal
      open
      onClose={() => advance("kept")}
      busy={saving}
      maxWidth={640}
      closeLabel={t("common:buttons.close")}
      title={
        ready
          ? t("reimport.title", { name: cruiseDisplayName(ready.cruise, t) })
          : t("reimport.titleLoading")
      }
      footer={
        <>
          {conflicts.length > 1 && (
            <span className="mr-auto self-center text-xs text-(--text-muted)">
              {t("reimport.progress", { current: index + 1, total: conflicts.length })}
            </span>
          )}
          <button
            type="button"
            onClick={() => advance("kept")}
            disabled={saving}
            className="rounded-md border border-border px-4 py-2 text-sm text-(--text-muted) hover:bg-(--bg-surface) disabled:opacity-50"
          >
            {t("reimport.keepStored")}
          </button>
          <button
            type="button"
            onClick={() => void apply()}
            disabled={saving || ready === null || accepted.size === 0}
            className="btn-primary px-4 py-2 text-sm"
          >
            {saving ? t("common:buttons.saving") : t("reimport.apply", { count: accepted.size })}
          </button>
        </>
      }
    >
      {loaded.status === "loading" && <p className="t-caption">{t("reimport.loading")}</p>}
      {loaded.status === "failed" && (
        <FormErrorBanner
          message={t("reimport.loadFailed")}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}
      {ready && (
        <>
          <p className="mb-3 text-sm text-(--text-muted)">{t("reimport.intro")}</p>
          <ul className="flex flex-col gap-2">
            {ready.changes.map((change) => {
              const notes = ownNotes(t, change);
              return (
                <li key={change.id} className="rounded-md border border-border p-2">
                  <label className={CHECK_ROW}>
                    <input
                      type="checkbox"
                      checked={accepted.has(change.id)}
                      onChange={(e) => toggle(change.id, e.target.checked)}
                      className="mt-0.5 pointer-coarse:h-5 pointer-coarse:w-5"
                    />
                    <span>
                      {describe(t, change)}
                      {notes.map((n) => (
                        <span key={n} className="block text-xs text-(--text-muted)">
                          {n}
                        </span>
                      ))}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <FormErrorBanner
            message={failure ? t(failure) : null}
            onRetry={failure && isTransientSaveError(failure) ? () => void apply() : undefined}
            retryDisabled={saving}
          />
        </>
      )}
    </Modal>
  );
}
