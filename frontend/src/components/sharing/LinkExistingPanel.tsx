import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import type {
  LinkCandidate,
  LinkCandidates,
  LinkDecision,
  LinkEntryView,
  LinkPreview,
  LinkPreviewAnswer,
  LinkResult,
} from "../../types/sharingLink";
import { Button } from "../ui";
import { shareFieldLabel } from "./noticeValues";
import InlineError from "../ui/InlineError";

const NS = "sharing:link";
const DECISIONS: readonly LinkDecision[] = ["both", "mine", "theirs"];

/** The sentence and, for a refusal across servers, the server it names. */
export interface LinkFailure {
  key: string;
  origin?: string;
}

interface Props {
  /** Who holds the other copy, for the copy ("Ben", "Anna (b.example)"). */
  otherName: string;
  loadCandidates: () => Promise<LinkCandidates>;
  preview: (tripId: string) => Promise<LinkPreviewAnswer>;
  link: (tripId: string, decision: LinkDecision) => Promise<LinkResult>;
  failure: (err: unknown, fallbackKey: string) => LinkFailure;
  onLinked: (result: LinkResult, tripId: string) => void;
}

/** A calendar day as the server sent it (`YYYY-MM-DD`), or the instant's day. */
const dayOf = (iso: string | null): string => (iso ? iso.slice(0, 10) : "—");

/**
 * Linking an existing copy (forgejo#440): instead of copying the trip again, pick the other
 * side's trip that IS this trip, look at the dry run — matched, only here, only there, differing
 * facts — and decide how the differences are settled. Nothing is written before "Verknüpfen";
 * nothing is created by it either.
 */
export default function LinkExistingPanel(props: Props): JSX.Element {
  const { otherName, loadCandidates, preview, link, failure, onLinked } = props;
  const { t } = useTranslation(["sharing"]);
  const [candidates, setCandidates] = useState<LinkCandidate[] | null>(null);
  // The other side has not accepted sharing yet: nothing of theirs is shown (forgejo#440 review).
  const [awaiting, setAwaiting] = useState(false);
  const [tripId, setTripId] = useState("");
  const [dryRun, setDryRun] = useState<LinkPreview | null>(null);
  const [decision, setDecision] = useState<LinkDecision>("both");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LinkFailure | null>(null);

  useEffect(() => {
    let live = true;
    loadCandidates()
      .then((found) => {
        if (!live) return;
        if (found.access === "awaitingConsent") {
          setAwaiting(true);
          setCandidates([]);
          return;
        }
        setCandidates(found.candidates);
        setTripId(found.candidates[0]?.id ?? "");
      })
      .catch((err: unknown) => {
        logger.error("Loading link candidates failed:", err);
        if (live) {
          setCandidates([]);
          setError(failure(err, `${NS}.errors.candidatesFailed`));
        }
      });
    return () => {
      live = false;
    };
    // Loaded once per opening; the loaders are recreated on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<void>, fallbackKey: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      logger.error("Linking an existing copy failed:", err);
      setError(failure(err, fallbackKey));
    } finally {
      setBusy(false);
    }
  };

  const compare = () =>
    run(async () => {
      const answer = await preview(tripId);
      if (answer.access === "awaitingConsent") setAwaiting(true);
      else setDryRun(answer);
    }, `${NS}.errors.previewFailed`);
  const confirm = () =>
    run(async () => onLinked(await link(tripId, decision), tripId), `${NS}.errors.linkFailed`);

  const typeName = (e: string) => t(`${NS}.types.${e}`);
  const entries = (title: string, list: LinkEntryView[]) =>
    list.length > 0 && (
      <div>
        <p className="t-caption">{title}</p>
        <ul className="text-sm">
          {list.map((e, i) => (
            <li key={`${e.entity}-${i}`}>
              {typeName(e.entity)}: {e.label} ({dayOf(e.when)})
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <p className="text-sm">{t(`${NS}.intro`, { name: otherName })}</p>
      {candidates === null && <p className="text-sm">{t(`${NS}.loading`)}</p>}
      {awaiting && (
        <p className="text-sm" role="status" data-testid="link-awaiting-consent">
          {t(`${NS}.awaitingConsent`)}
        </p>
      )}
      {candidates?.length === 0 && !awaiting && !error && (
        <p className="text-sm">{t(`${NS}.noCandidates`, { name: otherName })}</p>
      )}
      {!awaiting && candidates && candidates.length > 0 && (
        <fieldset className="flex flex-col text-sm" style={{ gap: "var(--ts-space-xs)" }}>
          <legend className="t-caption">{t(`${NS}.pickTrip`, { name: otherName })}</legend>
          {candidates.map((c) => (
            <label key={c.id} className="flex items-center gap-2">
              <input
                type="radio"
                name="link-trip"
                value={c.id}
                checked={tripId === c.id}
                disabled={busy}
                onChange={() => {
                  setTripId(c.id);
                  setDryRun(null);
                }}
              />
              {c.name} ({dayOf(c.startDay)} – {dayOf(c.endDay)}) · {t(`${NS}.reason.${c.reason}`)}
            </label>
          ))}
          <span>
            <Button disabled={busy || !tripId} onClick={() => void compare()}>
              {t(`${NS}.compare`)}
            </Button>
          </span>
        </fieldset>
      )}
      {dryRun && !awaiting && (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
          <p className="text-sm" role="status">
            {t(`${NS}.summary`, {
              ...dryRun.counts,
              name: otherName,
            })}
          </p>
          {dryRun.byType.length > 0 && (
            <ul className="text-sm">
              {dryRun.byType.map((b) => (
                <li key={b.entity}>
                  {t(`${NS}.byType`, {
                    type: typeName(b.entity),
                    here: b.here,
                    there: b.there,
                    matched: b.matched,
                    differing: b.differing,
                  })}
                </li>
              ))}
            </ul>
          )}
          {dryRun.matched.some((m) => m.conflicts.length > 0) && (
            <div>
              <p className="t-caption">{t(`${NS}.conflictsTitle`)}</p>
              <ul className="text-sm">
                {dryRun.matched
                  .filter((m) => m.conflicts.length > 0)
                  .flatMap((m, i) =>
                    m.conflicts.map((c) => (
                      <li key={`${i}-${c.field}`}>
                        {m.label} · {shareFieldLabel(c.field, t)}:{" "}
                        {t(`${NS}.conflict`, { here: c.here, there: c.there, name: otherName })}
                      </li>
                    ))
                  )}
              </ul>
            </div>
          )}
          {entries(t(`${NS}.onlyHereTitle`), dryRun.onlyHere)}
          {entries(t(`${NS}.onlyThereTitle`, { name: otherName }), dryRun.onlyThere)}
          <p className="t-caption">{t(`${NS}.nothingCreated`)}</p>
          <fieldset className="flex flex-col text-sm" style={{ gap: "var(--ts-space-xs)" }}>
            <legend className="t-caption">{t(`${NS}.decisionTitle`)}</legend>
            {DECISIONS.map((d) => (
              <label key={d} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="link-decision"
                  value={d}
                  checked={decision === d}
                  disabled={busy}
                  onChange={() => setDecision(d)}
                />
                {t(`${NS}.decision.${d}`, { name: otherName })}
              </label>
            ))}
          </fieldset>
          <span>
            <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
              {t(`${NS}.confirm`)}
            </Button>
          </span>
        </div>
      )}
      {error && <InlineError>{t(error.key, { origin: error.origin ?? "" })}</InlineError>}
    </div>
  );
}
