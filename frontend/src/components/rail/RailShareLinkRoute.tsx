import { useState } from "react";
import type { FormEvent, JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { railApi } from "../../lib/api/rail";
import { logger } from "../../lib/logger";
import type { RailShareLinkFacts, RailShareLinkFailure } from "../../types/railShareLink";
import type { ImportRouteContext } from "../import/types";
import { wallClockLabel } from "./railImportModel";
import {
  draftFromShareLinkFacts,
  hasShareLinkFacts,
  shareLinkReasonKey,
  type RailShareLinkPrefill,
  type RailShareLinkRequestFailure,
} from "./railShareLinkModel";

interface Props {
  /** Absent outside the import dialog — then the fallbacks are named, not offered as buttons. */
  context?: ImportRouteContext;
}

type Failure = {
  reason: RailShareLinkFailure | RailShareLinkRequestFailure;
  facts: RailShareLinkFacts | null;
};

const statusOf = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } } | null)?.response?.status;

/**
 * "I have a DB share link" (forgejo#204). The link is read on the server; a
 * connection it yields goes to the ordinary rail review. Reading it fails
 * often — bahn.de's bot protection refuses requests that are not a browser —
 * so the route says that up front, names the actual reason when it happens,
 * and offers the ways that work at once: the ticket PDF or the booking mail in
 * the drop zone above, or typing it in with whatever the link itself carried.
 */
export function RailShareLinkRoute({ context }: Props): JSX.Element {
  const { t } = useTranslation(["rail"]);
  const coarse = useCoarsePointer();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const control = coarse ? "min-h-11" : "py-1.5";

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (url.trim() === "" || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const answer = await railApi.readShareLink(url.trim());
      if (answer.outcome === "read") {
        context?.openReview({ domain: "rail", bookings: [answer.booking] });
      } else {
        setFailure({ reason: answer.reason, facts: answer.facts });
      }
    } catch (err: unknown) {
      logger.error("RailShareLinkRoute: the link request failed", err);
      setFailure({
        reason: statusOf(err) === 429 ? "requestRateLimited" : "requestFailed",
        facts: null,
      });
    } finally {
      setBusy(false);
    }
  };

  const typeIt = (): void => {
    const prefill: RailShareLinkPrefill = {
      kind: "railShareLink",
      draft: draftFromShareLinkFacts(
        failure?.facts ?? {
          departureStationName: null,
          arrivalStationName: null,
          departureLocal: null,
          travelClass: null,
        }
      ),
    };
    context?.openManual(prefill);
  };

  const facts = failure?.facts && hasShareLinkFacts(failure.facts) ? failure.facts : null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="t-caption">{t("rail:shareLink.caveat")}</p>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e): void => void submit(e)}>
        <label htmlFor="rail-share-link" className="sr-only">
          {t("rail:shareLink.label")}
        </label>
        <input
          id="rail-share-link"
          type="url"
          inputMode="url"
          value={url}
          placeholder="https://www.bahn.de/buchung/start?vbid=…"
          onChange={(e): void => setUrl(e.target.value)}
          className={`min-w-0 flex-1 rounded-md border border-border bg-(--bg-surface) px-3 text-sm ${control}`}
        />
        <button
          type="submit"
          disabled={busy || url.trim() === ""}
          className={`rounded-md border border-border px-3 text-xs font-semibold disabled:opacity-50 ${control}`}
        >
          {busy ? t("rail:shareLink.reading") : t("rail:shareLink.read")}
        </button>
      </form>
      {failure && (
        <div role="alert" className="flex flex-col gap-2" data-testid="rail-share-link-failed">
          <p className="text-sm text-(--warning)">{t(shareLinkReasonKey(failure.reason))}</p>
          {facts && (
            <p className="t-caption" data-testid="rail-share-link-facts">
              {t("rail:shareLink.factsKept", {
                route: [facts.departureStationName ?? "?", facts.arrivalStationName ?? "?"].join(
                  " → "
                ),
                when: facts.departureLocal ? wallClockLabel(facts.departureLocal) : "—",
                travelClass: facts.travelClass ? t(`rail:class.${facts.travelClass}`) : "—",
              })}
            </p>
          )}
          <p className="text-sm">{t("rail:shareLink.fallbackIntro")}</p>
          <div className="flex flex-wrap gap-2">
            {context?.focusDocumentRoute && (
              <button
                type="button"
                onClick={context.focusDocumentRoute}
                className={`rounded-md border border-border px-3 text-xs font-semibold ${control}`}
              >
                {t("rail:shareLink.useDocument")}
              </button>
            )}
            {context && (
              <button
                type="button"
                onClick={typeIt}
                className={`rounded-md border border-border px-3 text-xs font-semibold ${control}`}
              >
                {facts ? t("rail:shareLink.typeWithFacts") : t("rail:shareLink.typeIt")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
