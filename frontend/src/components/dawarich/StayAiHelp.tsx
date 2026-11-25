import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  dawarichStaysApi,
  type StayAiHelpResult,
  type StayIdentity,
} from "../../lib/api/dawarichStays";
import { apiErrorMachineCode } from "../../lib/apiError";
import { logger } from "../../lib/logger";
import { UseCancelledError, withUseConsent } from "../../lib/api/serviceUse";
import { useServiceUseConfirm } from "../ExternalServices/useServiceUseConfirm";

/**
 * "KI fragen" for an ambiguous GPS stay (forgejo#439 phase 2). Shown only
 * while the server says the help is available (the admin's switch, a usable
 * model) and the stay is ambiguous. The model's answer is advice: each
 * ranked name has its reason and its own "Übernehmen", which only fills the
 * card's name field — nothing is saved until the card itself is saved.
 */

/** Several candidates and none the stay's own photos confirm. */
export function isAmbiguous(identity: Pick<StayIdentity, "candidates" | "probable">): boolean {
  return identity.candidates.length >= 2 && !identity.probable?.photoSupported;
}

/** One availability answer per page view: two hundred cards must not ask two hundred times. */
let availability: Promise<boolean> | null = null;
export function resetAiHelpAvailability(): void {
  availability = null;
}
function helpAvailable(): Promise<boolean> {
  availability ??= (async () => {
    try {
      return (await dawarichStaysApi.aiHelpAvailability()).available;
    } catch (error) {
      // Not knowing is "not offered", said in the log; the card itself still works.
      logger.warn("AI help availability could not be read", error);
      availability = null;
      return false;
    }
  })();
  return availability;
}

const REASONS = new Set([
  "serviceOff",
  "internetOff",
  "noProvider",
  "notAmbiguous",
  "providerConsent",
  "providerOff",
  "timeout",
  "unreachable",
  "providerError",
  "badAnswer",
]);

function failureOf(error: unknown): string {
  const data = (error as { response?: { data?: { reason?: unknown } } } | null)?.response?.data;
  if (apiErrorMachineCode(error) === "AI_HELP_FAILED" && typeof data?.reason === "string") {
    return REASONS.has(data.reason) ? data.reason : "providerError";
  }
  const code = (error as { code?: string } | null)?.code;
  if (code === "ECONNABORTED") return "timeout";
  return "unreachable";
}

type State =
  | { phase: "idle" | "asking" }
  | { phase: "answer"; result: StayAiHelpResult }
  | { phase: "error"; reason: string };

export default function StayAiHelp({
  stayId,
  identity,
  onPickName,
}: {
  stayId: string;
  identity: StayIdentity;
  onPickName: (name: string) => void;
}): JSX.Element | null {
  const { t } = useTranslation(["trips"]);
  const text = (key: string, values?: Record<string, unknown>) =>
    t(`trips:dawarichStays.aiHelp.${key}`, values);
  const [shown, setShown] = useState(false);
  const [state, setState] = useState<State>({ phase: "idle" });
  const confirm = useServiceUseConfirm();
  const ambiguous = isAmbiguous(identity);

  useEffect(() => {
    let live = true;
    const check = async () => {
      // Only a "yes" changes anything: the button starts hidden.
      if ((await helpAvailable()) && live) setShown(true);
    };
    if (ambiguous) void check();
    return () => {
      live = false;
    };
  }, [ambiguous]);

  if (!ambiguous || !shown) return null;

  const ask = async () => {
    setState({ phase: "asking" });
    try {
      const result = await withUseConsent(
        (confirmation) => dawarichStaysApi.aiHelp(stayId, confirmation),
        confirm.ask
      );
      setState({ phase: "answer", result });
    } catch (error) {
      if (error instanceof UseCancelledError) {
        setState({ phase: "idle" });
        return;
      }
      logger.warn("AI help failed", error);
      setState({ phase: "error", reason: failureOf(error) });
    }
  };

  return (
    <div className="grid gap-2" data-testid="stay-ai-help">
      {confirm.dialog}
      <div>
        <button
          type="button"
          className="underline"
          disabled={state.phase === "asking"}
          onClick={() => void ask()}
          data-testid="stay-ai-help-ask"
        >
          {state.phase === "asking" ? text("asking") : text("ask")}
        </button>
      </div>
      {state.phase === "error" && (
        <p role="alert" className="t-body" style={{ color: "var(--danger)" }}>
          {text(`error.${state.reason}`)}
        </p>
      )}
      {state.phase === "answer" && (
        <div className="grid gap-1" role="status">
          <p className="t-caption">
            {text("advice", {
              provider: state.result.provider.kind,
              host: state.result.provider.host,
              where: text(`where.${state.result.provider.location}`),
            })}
          </p>
          <ol className="grid gap-1" aria-label={text("ranking")}>
            {state.result.answer.ranking.map((r) => (
              <li key={r.name} className="flex flex-wrap items-baseline gap-2">
                <strong>{r.name}</strong>
                {r.reason && <span className="t-caption">{r.reason}</span>}
                <button type="button" className="underline" onClick={() => onPickName(r.name)}>
                  {text("use")}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
