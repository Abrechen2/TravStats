import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import type {
  FieldChoice,
  LinkCandidate,
  LinkCandidates,
  LinkChoices,
  LinkDecision,
  LinkEntryView,
  LinkPreview,
  LinkPreviewAnswer,
  LinkResult,
} from "../../types/sharingLink";
import { Button } from "../ui";
import InlineError from "../ui/InlineError";
import { defaultFieldChoice, formatLinkValue, linkFieldLabel } from "./linkValues";
import { dateLocaleForLanguage } from "../../lib/units";

const NS = "sharing:link";
const DECISIONS: readonly LinkDecision[] = ["both", "mine", "theirs"];
const FIELD_CHOICES: readonly FieldChoice[] = ["mine", "theirs", "both"];

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
  link: (tripId: string, decision: LinkDecision, choices: LinkChoices) => Promise<LinkResult>;
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
  const { t, i18n } = useTranslation(["sharing"]);
  const locale = dateLocaleForLanguage(i18n?.language);
  const [candidates, setCandidates] = useState<LinkCandidate[] | null>(null);
  // The other side has not accepted sharing yet: nothing of theirs is shown (forgejo#440 review).
  const [awaiting, setAwaiting] = useState(false);
  const [tripId, setTripId] = useState("");
  const [dryRun, setDryRun] = useState<LinkPreview | null>(null);
  const [decision, setDecision] = useState<LinkDecision>("both");
  // Per pair and field: what the person picked over the trip-level default (M2).
  const [choices, setChoices] = useState<LinkChoices>({});
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
      else {
        setDryRun(answer);
        setChoices({});
      }
    }, `${NS}.errors.previewFailed`);
  const confirm = () =>
    run(
      async () => onLinked(await link(tripId, decision, choices), tripId),
      `${NS}.errors.linkFailed`
    );
  const choose = (ref: string, field: string, choice: FieldChoice) =>
    setChoices((prev) => ({ ...prev, [ref]: { ...prev[ref], [field]: choice } }));

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
          {dryRun.matched.some((m) => m.conflicts.length > 0 || m.recomputed.length > 0) && (
            <div data-testid="link-conflicts">
              <p className="t-caption">{t(`${NS}.conflictsTitle`)}</p>
              {dryRun.matched
                .filter((m) => m.conflicts.length > 0 || m.recomputed.length > 0)
                .map((m) => (
                  <div
                    key={m.ref}
                    className="text-sm"
                    style={{ marginBottom: "var(--ts-space-xs)" }}
                  >
                    <p className="font-medium">
                      {typeName(m.entity)}: {m.label}
                    </p>
                    {m.conflicts.length > 0 && (
                      <table className="text-sm w-full">
                        <thead>
                          <tr>
                            <th className="text-left font-normal t-caption">
                              {t(`${NS}.table.field`)}
                            </th>
                            <th className="text-left font-normal t-caption">
                              {t(`${NS}.table.mine`)}
                            </th>
                            <th className="text-left font-normal t-caption">
                              {t(`${NS}.table.theirs`, { name: otherName })}
                            </th>
                            <th className="text-left font-normal t-caption">
                              {t(`${NS}.table.take`)}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.conflicts.map((c) => {
                            const picked =
                              choices[m.ref]?.[c.field] ?? defaultFieldChoice(decision, c);
                            const label = linkFieldLabel(c.field, t);
                            return (
                              <tr key={c.field} data-testid={`link-field-${m.ref}-${c.field}`}>
                                <td>{label}</td>
                                <td>
                                  {formatLinkValue(c.display.here, locale, t)}
                                  {c.better === "here" && ` · ${t(`${NS}.better`)}`}
                                </td>
                                <td>
                                  {formatLinkValue(c.display.there, locale, t)}
                                  {c.better === "there" && ` · ${t(`${NS}.better`)}`}
                                </td>
                                <td>
                                  <select
                                    aria-label={t(`${NS}.table.takeFor`, { field: label })}
                                    value={picked}
                                    disabled={busy}
                                    onChange={(e) =>
                                      choose(m.ref, c.field, e.target.value as FieldChoice)
                                    }
                                  >
                                    {FIELD_CHOICES.map((choice) => (
                                      <option key={choice} value={choice}>
                                        {t(`${NS}.fieldChoice.${choice}`, { name: otherName })}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    {m.recomputed.length > 0 && (
                      <p className="t-caption">
                        {t(`${NS}.recomputed`, {
                          fields: m.recomputed.map((f) => linkFieldLabel(f, t)).join(", "),
                        })}
                      </p>
                    )}
                  </div>
                ))}
            </div>
          )}
          {entries(t(`${NS}.onlyHereTitle`), dryRun.onlyHere)}
          {entries(t(`${NS}.onlyThereTitle`, { name: otherName }), dryRun.onlyThere)}
          <p className="t-caption">{t(`${NS}.nothingCreated`)}</p>
          <fieldset className="flex flex-col text-sm" style={{ gap: "var(--ts-space-xs)" }}>
            <legend className="t-caption">{t(`${NS}.decisionTitle`)}</legend>
            <p className="t-caption">{t(`${NS}.decisionRule`)}</p>
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
