import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { apiErrorMachineCode } from "../../lib/apiError";
import { flightsApi, type EnrichmentCandidate } from "../../lib/api/flights";
import { logger } from "../../lib/logger";
import { token } from "../ui/tokens";

const KNOWN_CODES = [
  "ENRICH_DISABLED",
  "ENRICH_NO_FLIGHT_NUMBER",
  "ENRICH_NO_REFERENCE",
  "ENRICH_CONFIDENCE_LOW",
];

type RowState = { tone: "good" | "bad"; text: string } | "busy";

/**
 * Flights the historical enrichment could fill in, each with an "Anreichern"
 * button (forgejo#397). The click creates a flight update that waits in the
 * inbox — nothing is written to the flight here. Every failure the server can
 * name has its own sentence; load failure is shown, never read as "no candidates".
 */
export default function EnrichmentCandidatesPanel(): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const { isEnabled } = useEnabledDomains();
  const [candidates, setCandidates] = useState<EnrichmentCandidate[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const load = useCallback(async (): Promise<void> => {
    setLoadFailed(false);
    try {
      const r = await flightsApi.enrichmentCandidates();
      setCandidates(r.settings === null ? [] : r.candidates);
    } catch (err: unknown) {
      logger.error("EnrichmentCandidatesPanel: load failed", err);
      setLoadFailed(true);
    }
  }, []);

  const flightOn = isEnabled("flight");
  useEffect(() => {
    if (flightOn) void load();
  }, [flightOn, load]);

  if (!flightOn) return null;

  const enrich = async (c: EnrichmentCandidate): Promise<void> => {
    setRows((r) => ({ ...r, [c.flightId]: "busy" }));
    try {
      const out = await flightsApi.enrichHistorical(c.flightId);
      setRows((r) => ({
        ...r,
        [c.flightId]: {
          tone: "good",
          text: t("settings:historicalEnrichment.candidates.proposed", {
            confidence: out.confidence,
          }),
        },
      }));
    } catch (err: unknown) {
      const code = apiErrorMachineCode(err);
      const text =
        code && KNOWN_CODES.includes(code)
          ? t(`settings:historicalEnrichment.candidates.errors.${code}`)
          : t("settings:historicalEnrichment.candidates.errors.unknown");
      setRows((r) => ({ ...r, [c.flightId]: { tone: "bad", text } }));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="label">{t("settings:historicalEnrichment.candidates.title")}</span>
      {loadFailed ? (
        <p role="alert" className="text-sm" style={{ color: token("bad") }}>
          {t("settings:historicalEnrichment.candidates.loadFailed")}{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            {t("settings:historicalEnrichment.candidates.retry")}
          </button>
        </p>
      ) : candidates === null ? null : candidates.length === 0 ? (
        <p className="t-caption">{t("settings:historicalEnrichment.candidates.none")}</p>
      ) : (
        <>
          <p className="t-caption">{t("settings:historicalEnrichment.candidates.hint")}</p>
          <ul className="flex flex-col gap-2">
            {candidates.map((c) => {
              const state = rows[c.flightId];
              return (
                <li key={c.flightId} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link className="underline" to={`/flights/${c.flightId}`}>
                    {c.flightNumber}
                  </Link>
                  <span className="t-caption">
                    {t("settings:historicalEnrichment.candidates.row", {
                      confidence: c.confidence,
                      fields: c.missingFields.length + (c.missingRoute ? 1 : 0),
                    })}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={state === "busy"}
                    onClick={() => void enrich(c)}
                  >
                    {t("settings:historicalEnrichment.candidates.enrich")}
                  </button>
                  {state && state !== "busy" && (
                    <span role="status" style={{ color: token(state.tone) }}>
                      {state.text}
                      {state.tone === "good" && (
                        <>
                          {" "}
                          <Link className="underline" to="/pending-updates?tab=updates">
                            {t("settings:historicalEnrichment.candidates.openInbox")}
                          </Link>
                        </>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
