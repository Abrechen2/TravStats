import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import type {
  BulkPair,
  BulkPairs,
  LinkChoices,
  LinkDecision,
  LinkPreviewAnswer,
  LinkResult,
} from "../../types/sharingLink";
import { Button } from "../ui";
import InlineError from "../ui/InlineError";
import { BULK_PACE_MS, wait, withRateLimitPause } from "./bulkRun";
import type { LinkFailure } from "./LinkExistingPanel";
import LinkExistingPanel from "./LinkExistingPanel";

const NS = "sharing:bulk";

/** Where a pair stands in the run. */
type PairState =
  | { kind: "waiting" }
  | { kind: "auto" }
  | { kind: "review"; why: "conflict" | "ambiguous" | "noTrip" | "nothingMatched" }
  | { kind: "done"; linked: number }
  | { kind: "skipped"; why: string }
  | { kind: "failed"; reason: string }
  | { kind: "undone" };

interface Props {
  /** Who holds the other copies ("Papa", "Papa (b.example)"). */
  otherName: string;
  loadPairs: () => Promise<BulkPairs>;
  preview: (pair: BulkPair) => Promise<LinkPreviewAnswer>;
  link: (pair: BulkPair, decision: LinkDecision, choices: LinkChoices) => Promise<LinkResult>;
  /** Undo: the caller's trip leaves its group. */
  undo: (pair: BulkPair) => Promise<void>;
  failure: (err: unknown, fallbackKey: string) => LinkFailure;
}

const dayOf = (iso: string | null): string => (iso ? iso.slice(0, 10) : "—");

/**
 * "Alle passenden Reisen verknüpfen" (UAT 2026-11-27): every trip pair at once. It compares each
 * pair (one dry run per pair), links those whose differences the quality rule settles — empty,
 * derived or a better line or time — and lists the rest for the person, one click each to the
 * per-field view. A summary comes first, a progress line during the run, a result and an undo per
 * pair after it. The run is paced, pauses on a rate limit instead of failing, and can be stopped
 * and started again: what is linked stays linked, and nothing is linked twice.
 */
export default function BulkLinkPanel(props: Props): JSX.Element {
  const { otherName, loadPairs, preview, link, undo, failure } = props;
  const { t } = useTranslation(["sharing"]);
  const [pairs, setPairs] = useState<BulkPair[] | null>(null);
  const [awaiting, setAwaiting] = useState(false);
  const [states, setStates] = useState<Record<string, PairState>>({});
  const [phase, setPhase] = useState<"loading" | "comparing" | "ready" | "running" | "finished">(
    "loading"
  );
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [pause, setPause] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [error, setError] = useState<LinkFailure | null>(null);
  const stop = useRef(false);

  const setState = (id: string, s: PairState) => setStates((prev) => ({ ...prev, [id]: s }));

  const compare = async (list: BulkPair[]): Promise<void> => {
    setPhase("comparing");
    const open = list.filter((p) => !p.linked);
    setProgress({ done: 0, total: open.length });
    let n = 0;
    for (const pair of open) {
      if (stop.current) break;
      if (!pair.trip) setState(pair.id, { kind: "review", why: "noTrip" });
      else if (pair.ambiguous) setState(pair.id, { kind: "review", why: "ambiguous" });
      else {
        try {
          const answer = await withRateLimitPause(
            () => preview(pair),
            setPause,
            () => stop.current
          );
          if (answer === "stopped") break;
          if (answer.access === "awaitingConsent") {
            setAwaiting(true);
            break;
          }
          setState(
            pair.id,
            answer.automatic
              ? { kind: "auto" }
              : {
                  kind: "review",
                  why: answer.counts.matched === 0 ? "nothingMatched" : "conflict",
                }
          );
        } catch (err) {
          logger.error("Bulk link: comparing a pair failed:", err);
          setState(pair.id, {
            kind: "failed",
            reason: t(failure(err, `${NS}.errors.compareFailed`).key),
          });
        }
        await wait(BULK_PACE_MS);
      }
      n += 1;
      setProgress({ done: n, total: open.length });
    }
    setPhase("ready");
  };

  useEffect(() => {
    let live = true;
    // A remount (React Strict Mode runs effects twice) must not inherit the cleanup's stop.
    stop.current = false;
    loadPairs()
      .then((answer) => {
        if (!live) return;
        if (answer.access === "awaitingConsent") {
          setAwaiting(true);
          setPairs([]);
          setPhase("ready");
          return;
        }
        setPairs(answer.pairs);
        void compare(answer.pairs);
      })
      .catch((err: unknown) => {
        logger.error("Bulk link: loading the pairs failed:", err);
        if (live) {
          setPairs([]);
          setPhase("ready");
          setError(failure(err, `${NS}.errors.loadFailed`));
        }
      });
    return () => {
      live = false;
      stop.current = true;
    };
    // Loaded once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const autoPairs = (pairs ?? []).filter((p) => states[p.id]?.kind === "auto");
  const reviewPairs = (pairs ?? []).filter((p) => states[p.id]?.kind === "review");

  const runAll = async (): Promise<void> => {
    stop.current = false;
    setPhase("running");
    setProgress({ done: 0, total: autoPairs.length });
    let n = 0;
    for (const pair of autoPairs) {
      if (stop.current) break;
      try {
        const result = await withRateLimitPause(
          () => link(pair, "best", {}),
          setPause,
          () => stop.current
        );
        if (result === "stopped") break;
        setState(
          pair.id,
          result.linked + result.alreadyLinked > 0
            ? { kind: "done", linked: result.linked + result.alreadyLinked }
            : { kind: "skipped", why: t(`${NS}.skippedNothing`) }
        );
      } catch (err) {
        logger.error("Bulk link: linking a pair failed:", err);
        setState(pair.id, {
          kind: "failed",
          reason: t(failure(err, `${NS}.errors.linkFailed`).key),
        });
      }
      n += 1;
      setProgress({ done: n, total: autoPairs.length });
      await wait(BULK_PACE_MS);
    }
    setPhase(stop.current ? "ready" : "finished");
  };

  const undoPair = async (pair: BulkPair): Promise<void> => {
    try {
      await undo(pair);
      setState(pair.id, { kind: "undone" });
    } catch (err) {
      logger.error("Bulk link: undoing a pair failed:", err);
      setError(failure(err, `${NS}.errors.undoFailed`));
    }
  };

  const names = (p: BulkPair) =>
    t(`${NS}.pairName`, {
      mine: p.trip?.name ?? "—",
      theirs: p.other.name,
      name: otherName,
      from: dayOf(p.trip?.startDay ?? p.other.startDay),
    });

  const resultLine = (p: BulkPair): string | null => {
    const s = states[p.id];
    if (!s) return p.linked ? t(`${NS}.state.linked`) : null;
    switch (s.kind) {
      case "done":
        return t(`${NS}.state.done`, { count: s.linked });
      case "skipped":
        return t(`${NS}.state.skipped`, { why: s.why });
      case "failed":
        return t(`${NS}.state.failed`, { why: s.reason });
      case "undone":
        return t(`${NS}.state.undone`);
      case "review":
        return t(`${NS}.review.${s.why}`);
      default:
        return null;
    }
  };

  const busy = phase === "comparing" || phase === "running";
  const finishedPairs = (pairs ?? []).filter((p) => {
    const k = states[p.id]?.kind;
    return k === "done" || k === "failed" || k === "skipped" || k === "undone" || p.linked;
  });

  return (
    <div className="flex flex-col text-sm" style={{ gap: "var(--ts-space-sm)" }}>
      <p>{t(`${NS}.intro`, { name: otherName })}</p>
      {awaiting && (
        <p role="status" data-testid="bulk-awaiting-consent">
          {t(`${NS}.awaitingConsent`, { name: otherName })}
        </p>
      )}
      {phase === "loading" && <p>{t(`${NS}.loading`)}</p>}
      {busy && (
        <p role="status" data-testid="bulk-progress">
          {t(phase === "comparing" ? `${NS}.comparing` : `${NS}.linking`, progress)}
          {pause !== null && ` · ${t(`${NS}.paused`, { minutes: pause })}`}
        </p>
      )}
      {busy && (
        <span>
          <Button onClick={() => (stop.current = true)}>{t(`${NS}.stop`)}</Button>
        </span>
      )}
      {phase === "ready" && pairs && pairs.length === 0 && !awaiting && !error && (
        <p>{t(`${NS}.none`, { name: otherName })}</p>
      )}
      {phase === "ready" && (autoPairs.length > 0 || reviewPairs.length > 0) && (
        <>
          <p role="status" data-testid="bulk-summary">
            {t(`${NS}.summary`, { auto: autoPairs.length, review: reviewPairs.length })}
          </p>
          {autoPairs.length > 0 && (
            <details>
              <summary>{t(`${NS}.autoTitle`, { count: autoPairs.length })}</summary>
              <ul>
                {autoPairs.map((p) => (
                  <li key={p.id}>{names(p)}</li>
                ))}
              </ul>
            </details>
          )}
          {autoPairs.length > 0 && (
            <span>
              <Button variant="primary" onClick={() => void runAll()}>
                {t(`${NS}.run`, { count: autoPairs.length })}
              </Button>
            </span>
          )}
        </>
      )}
      {reviewPairs.length > 0 && !busy && (
        <div data-testid="bulk-review">
          <p className="t-caption">{t(`${NS}.reviewTitle`)}</p>
          <ul className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
            {reviewPairs.map((p) => (
              <li key={p.id}>
                {names(p)} · {resultLine(p)}{" "}
                {p.trip && (
                  <Button onClick={() => setReviewing(reviewing === p.id ? null : p.id)}>
                    {t(`${NS}.open`)}
                  </Button>
                )}
                {reviewing === p.id && p.trip && (
                  <LinkExistingPanel
                    otherName={otherName}
                    loadCandidates={async () => ({
                      access: "full",
                      candidates: [{ ...p.other, reason: p.reason ?? "overlap" }],
                    })}
                    preview={() => preview(p)}
                    link={(_target, decision, choices) => link(p, decision, choices)}
                    failure={failure}
                    onLinked={(result) => {
                      setReviewing(null);
                      setState(p.id, {
                        kind: "done",
                        linked: result.linked + result.alreadyLinked,
                      });
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {finishedPairs.length > 0 && (
        <div data-testid="bulk-results">
          <p className="t-caption">{t(`${NS}.resultsTitle`)}</p>
          <ul>
            {finishedPairs.map((p) => {
              const s = states[p.id];
              const linkedNow = s?.kind === "done" || (!s && p.linked);
              return (
                <li key={p.id}>
                  {names(p)} · {resultLine(p)}{" "}
                  {linkedNow && p.trip && (
                    <Button disabled={busy} onClick={() => void undoPair(p)}>
                      {t(`${NS}.undo`)}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {error && <InlineError>{t(error.key, { origin: error.origin ?? "" })}</InlineError>}
    </div>
  );
}
