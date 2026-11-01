import { useEffect, useState } from "react";
import type { JSX } from "react";

import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { documentsApi, type StoredValuesResult } from "../../lib/api/documents";
import { logger } from "../../lib/logger";
import { EXTRACT_FIELDS, type ExtractField, type ExtractTarget } from "../../lib/extractValues";

interface Props {
  documentId: string;
  target: ExtractTarget;
}

type Phase =
  | { kind: "loading" }
  | { kind: "failed"; key: string }
  | { kind: "ready"; result: StoredValuesResult };

/** Each refusal as its own sentence (a missing document and a lost network are different news). */
function failureKey(err: unknown): string {
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  if (status === 404) return "documents:stored.notFound";
  if (status === 429) return "documents:stored.rateLimited";
  if (status === undefined) return "documents:stored.network";
  return "documents:stored.failed";
}

/**
 * "Gespeicherte Werte": what the parser already read from this document, shown
 * without reading it again (`GET /documents/:id/stored-values`, forgejo#407).
 * Read-only; "Werte übernehmen" next to it is the button that parses anew and
 * writes into the entry.
 */
export function StoredValuesAction({ documentId, target }: Props): JSX.Element {
  const { t } = useTranslation(["documents", "common"]);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 text-sm"
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--accent)",
        }}
      >
        {t("documents:stored.action")}
      </button>
      {open && (
        <StoredValuesDialog
          documentId={documentId}
          target={target}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function StoredValuesDialog({
  documentId,
  target,
  onClose,
}: Props & { onClose: () => void }): JSX.Element {
  const { t } = useTranslation(["documents", "common", "flights", "rail"]);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const { flightNumber, trainNumber, departureDate } = target;

  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: "loading" });
    void (async () => {
      try {
        const result = await documentsApi.storedValues(documentId, {
          ...(flightNumber ? { flightNumber } : {}),
          ...(trainNumber ? { trainNumber } : {}),
          ...(departureDate ? { departureDate } : {}),
        });
        if (!cancelled) setPhase({ kind: "ready", result });
      } catch (err) {
        logger.error({ err, documentId }, "StoredValuesDialog: loading failed");
        if (!cancelled) setPhase({ kind: "failed", key: failureKey(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, flightNumber, trainNumber, departureDate, attempt]);

  const display = (field: ExtractField, value: string | number | null | undefined): string => {
    if (field === "seatClass") return t(`flights:seatClass.${value}`);
    if (field === "travelClass") return t(`rail:class.${value}`);
    return String(value);
  };

  const result = phase.kind === "ready" ? phase.result : null;
  const shown = result?.values
    ? EXTRACT_FIELDS.filter((f) => {
        const v = result.values?.[f];
        return v !== null && v !== undefined && v !== "";
      })
    : [];

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth={480}
      closeLabel={t("common:buttons.close")}
      title={t("documents:stored.title")}
      footer={
        <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm">
          {t("common:buttons.close")}
        </button>
      }
    >
      {phase.kind === "loading" && (
        <p role="status" className="text-sm">
          {t("documents:stored.loading")}
        </p>
      )}
      {phase.kind === "failed" && (
        <p role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
          {t(phase.key)}{" "}
          <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>
            {t("documents:stored.retry")}
          </button>
        </p>
      )}
      {result && result.reason !== null && (
        <p className="text-sm">{t(`documents:stored.reason.${result.reason}`)}</p>
      )}
      {shown.length > 0 && result?.values && (
        <dl className="grid gap-x-4 gap-y-2 text-sm" style={{ gridTemplateColumns: "auto 1fr" }}>
          {shown.map((field) => (
            <div key={field} className="contents">
              <dt className="font-medium">{t(`documents:extract.field.${field}`)}</dt>
              <dd className="font-semibold">{display(field, result.values?.[field])}</dd>
            </div>
          ))}
        </dl>
      )}
      {result?.parserUsed && (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("documents:stored.parser", { parser: result.parserUsed })}
        </p>
      )}
    </Modal>
  );
}
