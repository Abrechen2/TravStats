import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { documentsApi, documentFileUrl, type TravelDocument } from "../../lib/api/documents";
import { formatBaggageAllowance } from "../../lib/baggageAllowance";
import { copyToClipboard } from "../../lib/clipboard";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";
import type { Flight } from "../../types";

/**
 * The touch rule (forgejo#249): a finger gets 44 px, a mouse keeps the
 * compact control. Follows the POINTER, not the width — an iPad is wide.
 */
export const DAY_CARD_TOUCH =
  "pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:min-w-(--ts-size-touch-min)";

/** How long "kopiert" stays visible before the button reads "Kopieren" again. */
const COPIED_VISIBLE_MS = 2500;

type CopyState = "idle" | "copied" | "failed";

function CopyButton({ value, label }: { value: string; label: string }): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const copy = async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    try {
      await copyToClipboard(value);
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), COPIED_VISIBLE_MS);
    } catch (err: unknown) {
      // Not a silent no-op: on a plain-http LAN instance both clipboard paths
      // can fail, and the user must know to select the number by hand.
      logger.warn({ err }, "FlightDayCard: copy failed");
      setState("failed");
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center" style={{ gap: 6 }}>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t("flights:dayCard.copyLabel", { field: label })}
        className={`btn-secondary px-2 py-1 text-xs ${DAY_CARD_TOUCH}`}
      >
        {t("flights:dayCard.copy")}
      </button>
      <span aria-live="polite" className="t-caption" style={{ fontWeight: 600 }}>
        {state === "copied" ? t("flights:dayCard.copied") : null}
      </span>
      {state === "failed" ? (
        <span role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
          {t("flights:dayCard.copyFailed")}
        </span>
      ) : null}
    </span>
  );
}

function Missing(): JSX.Element {
  const { t } = useTranslation(["flights"]);
  return (
    <span className="t-caption" style={{ fontStyle: "italic" }}>
      {t("flights:dayCard.missing")}
    </span>
  );
}

function Item({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col" style={{ gap: 4 }} data-testid={testId}>
      <dt className="t-caption">{label}</dt>
      <dd className="flex min-w-0 flex-col" style={{ gap: 4 }}>
        {children}
      </dd>
    </div>
  );
}

function CopyableValue({ value, label }: { value: string | null | undefined; label: string }) {
  if (!value) return <Missing />;
  return (
    <>
      <span
        className="break-all"
        style={{
          fontFamily: "var(--ts-font-mono)",
          fontSize: 16,
          fontWeight: 700,
          color: "var(--ts-text-bright)",
          userSelect: "all",
        }}
      >
        {value}
      </span>
      <CopyButton value={value} label={label} />
    </>
  );
}

type PassesState =
  | { kind: "loading" }
  | { kind: "failed" }
  /** `others`: documents on the flight that are not a boarding pass. */
  | { kind: "loaded"; passes: TravelDocument[]; others: number };

/** A boarding pass: filed as one, or a wallet pass, which is never anything else. */
export const isBoardingPass = (doc: TravelDocument): boolean =>
  doc.kind === "boardingPass" || doc.format === "pkpass";

/**
 * The flight's kept boarding passes — its own request, so a failure stays
 * local to this card. `version` moves when the page's documents section
 * uploaded or removed one, so the card re-reads instead of going stale.
 */
function useBoardingPasses(
  flightId: string,
  version: number
): { state: PassesState; retry: () => void } {
  const [state, setState] = useState<PassesState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    documentsApi
      .listForEntry({ type: "flight", id: flightId })
      .then((documents) => {
        if (!cancelled) {
          const passes = documents.filter(isBoardingPass);
          setState({ kind: "loaded", passes, others: documents.length - passes.length });
        }
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "FlightDayCard: boarding passes could not be listed");
        if (!cancelled) setState({ kind: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [flightId, attempt, version]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

function BoardingPasses({ flightId, version }: { flightId: string; version: number }): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);
  const { state, retry } = useBoardingPasses(flightId, version);
  if (state.kind === "loading") {
    return <span className="t-caption">{t("flights:dayCard.passesLoading")}</span>;
  }
  if (state.kind === "failed") {
    return (
      <span className="flex flex-wrap items-center" style={{ gap: 6 }}>
        <span role="alert" className="t-caption">
          {t("flights:dayCard.passesFailed")}
        </span>
        <button
          type="button"
          onClick={retry}
          className={`btn-secondary px-2 py-1 text-xs ${DAY_CARD_TOUCH}`}
        >
          {t("common:buttons.retry")}
        </button>
      </span>
    );
  }
  if (state.passes.length === 0) {
    return (
      <>
        <Missing />
        <span className="t-caption">
          {state.others > 0
            ? t("flights:dayCard.passesOthers", { count: state.others })
            : t("flights:dayCard.passesHint")}
        </span>
      </>
    );
  }
  return (
    <ul className="flex flex-col" style={{ gap: 4 }}>
      {state.passes.map((doc) => (
        <li key={doc.id}>
          {/* One action opens it: a plain link in a new tab, which carries the
              session cookie (lib/api/documents `documentFileUrl`). */}
          <a
            href={documentFileUrl(doc)}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center underline underline-offset-4 ${DAY_CARD_TOUCH}`}
            style={{ color: "var(--ts-accent)", fontWeight: 600 }}
          >
            {t("flights:dayCard.openPass", { name: doc.displayName })}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Whether the card has something to say: an upcoming flight always, a past one only with values. */
export function dayCardShown(flight: Flight): boolean {
  if (flight.status === "scheduled") return true;
  return Boolean(flight.bookingReference || flight.seatNumber || flight.baggageAllowance);
}

/**
 * What a traveller needs on the day, in one compact card at the top of the
 * flight's page (forgejo#220): booking reference and ticket number to copy,
 * seat, baggage allowance and the boarding pass to open with one action. A
 * value nobody recorded says "fehlt" rather than vanishing, so the card reads
 * the same on every flight and shows what is still to be filled in.
 */
export default function FlightDayCard({
  flight,
  documentsVersion = 0,
}: {
  flight: Flight;
  /** Bumped by the page when its documents section uploaded or removed a file. */
  documentsVersion?: number;
}): JSX.Element | null {
  const { t } = useTranslation(["flights"]);
  const weightUnit = useSettingsStore((state) => state.units?.weightUnit);
  if (!dayCardShown(flight)) return null;
  const baggage = formatBaggageAllowance(flight.baggageAllowance, weightUnit);
  return (
    <section
      aria-labelledby="flight-day-card-title"
      className="mb-6 flex flex-col"
      style={{
        gap: "var(--ts-space-md)",
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
        padding: "var(--ts-space-lg)",
      }}
    >
      <h2 id="flight-day-card-title" className="t-label-mono">
        {t("flights:dayCard.title")}
      </h2>
      <dl
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
        style={{ gap: "var(--ts-space-lg)" }}
      >
        <Item label={t("flights:form.bookingReference")} testId="day-card-booking-reference">
          <CopyableValue
            value={flight.bookingReference}
            label={t("flights:form.bookingReference")}
          />
        </Item>
        <Item label={t("flights:form.seat")} testId="day-card-seat">
          {flight.seatNumber ? (
            <span style={{ fontFamily: "var(--ts-font-mono)", fontSize: 16, fontWeight: 700 }}>
              {flight.seatNumber}
            </span>
          ) : (
            <Missing />
          )}
        </Item>
        <Item label={t("flights:form.baggageAllowance")} testId="day-card-baggage">
          {baggage ? <span style={{ fontWeight: 600 }}>{baggage}</span> : <Missing />}
        </Item>
        <Item label={t("flights:dayCard.boardingPass")} testId="day-card-boarding-pass">
          <BoardingPasses flightId={flight.id} version={documentsVersion} />
        </Item>
        {flight.ticketNumber ? (
          <Item label={t("flights:form.ticketNumber")} testId="day-card-ticket-number">
            <CopyableValue value={flight.ticketNumber} label={t("flights:form.ticketNumber")} />
          </Item>
        ) : null}
      </dl>
    </section>
  );
}
