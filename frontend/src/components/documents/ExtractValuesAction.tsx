import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { isCancel, type AxiosError } from "axios";

import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { documentsApi } from "../../lib/api/documents";
import { logger } from "../../lib/logger";
import {
  initialSelection,
  offeredFields,
  pickValues,
  type ExtractField,
  type ExtractTarget,
  type ExtractValuesResult,
} from "../../lib/extractValues";

interface Props {
  documentId: string;
  target: ExtractTarget;
}

type Phase =
  | { kind: "reading" }
  | { kind: "failed"; message: string }
  | { kind: "result"; result: ExtractValuesResult };

/** The server's refusals, each as the sentence that tells the user what to do next. */
function failureKey(err: unknown): string {
  const status = (err as AxiosError | undefined)?.response?.status;
  if (status === 415) return "documents:extract.unsupported";
  if (status === 429) return "documents:extract.rateLimited";
  if (status === 503) return "documents:extract.unavailable";
  return "documents:extract.failed";
}

/**
 * "Werte aus dem Beleg übernehmen": a button, and the dialog it opens.
 *
 * The dialog reads the document through the parser — which can take a minute
 * with a language model behind it, so it says so and offers to stop — and
 * shows what it found beside what the entry holds, one checkbox per field.
 * Only empty fields start ticked; nothing is written until the user presses
 * the apply button, and then only through the entry's own `onApply`.
 */
export function ExtractValuesAction({ documentId, target }: Props): JSX.Element {
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
        {t("documents:extract.action")}
      </button>
      {open && (
        <ExtractValuesDialog
          documentId={documentId}
          target={target}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ExtractValuesDialog({
  documentId,
  target,
  onClose,
}: Props & { onClose: () => void }): JSX.Element {
  const { t } = useTranslation(["documents", "common", "flights"]);
  const [phase, setPhase] = useState<Phase>({ kind: "reading" });
  const [selected, setSelected] = useState<ExtractField[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyFailed, setApplyFailed] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const { domain, flightNumber, departureDate, current } = target;

  useEffect(() => {
    // One controller per run: a controller kept across runs would arrive
    // already aborted on the second one, which is every mount in StrictMode.
    const controller = new AbortController();
    controllerRef.current = controller;
    void (async () => {
      try {
        const result = await documentsApi.extractValues(
          documentId,
          {
            domain,
            ...(flightNumber ? { flightNumber } : {}),
            ...(departureDate ? { departureDate } : {}),
          },
          controller.signal
        );
        setSelected(
          result.values ? initialSelection(offeredFields(result.values, current), current) : []
        );
        setPhase({ kind: "result", result });
      } catch (err) {
        if (isCancel(err)) return;
        logger.error({ err, documentId }, "ExtractValuesDialog: extraction failed");
        setPhase({ kind: "failed", message: t(failureKey(err)) });
      }
    })();
    return (): void => controller.abort();
    // `current` is read once, when the proposal arrives — a later keystroke in
    // the form must not re-run a minute of parsing.
  }, [documentId, domain, flightNumber, departureDate]);

  const values = phase.kind === "result" ? phase.result.values : null;
  const offered = useMemo(() => (values ? offeredFields(values, current) : []), [values, current]);

  const display = (field: ExtractField, value: string | number | null | undefined): string => {
    if (value === null || value === undefined || value === "") return "—";
    if (field === "seatClass") return t(`flights:seatClass.${value}`);
    return String(value);
  };

  const apply = async (): Promise<void> => {
    if (!values) return;
    setApplying(true);
    setApplyFailed(false);
    try {
      await target.onApply(pickValues(values, selected));
      onClose();
    } catch (err) {
      logger.error({ err, documentId }, "ExtractValuesDialog: apply failed");
      setApplyFailed(true);
    } finally {
      setApplying(false);
    }
  };

  const cancel = (): void => {
    controllerRef.current?.abort();
    onClose();
  };

  return (
    <Modal
      open
      onClose={cancel}
      busy={applying}
      maxWidth={560}
      closeLabel={t("common:buttons.close")}
      title={t("documents:extract.title")}
      footer={
        <>
          <button type="button" onClick={cancel} className="rounded-lg px-4 py-2 text-sm">
            {t("common:buttons.cancel")}
          </button>
          {offered.length > 0 && (
            <button
              type="button"
              onClick={() => void apply()}
              disabled={selected.length === 0 || applying}
              className="rounded-lg px-4 py-2 text-sm font-semibold"
              style={{ background: "var(--accent)", color: "var(--bg-base)" }}
            >
              {t("documents:extract.apply")}
            </button>
          )}
        </>
      }
    >
      {phase.kind === "reading" && (
        <p role="status" className="text-sm">
          {t("documents:extract.reading")}
        </p>
      )}
      {phase.kind === "failed" && (
        <p role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
          {phase.message}
        </p>
      )}
      {phase.kind === "result" && offered.length === 0 && (
        <p className="text-sm">
          {phase.result.reason === "noText"
            ? t("documents:extract.noText")
            : values === null
              ? t("documents:extract.nothingFound")
              : t("documents:extract.nothingNew")}
        </p>
      )}
      {offered.length > 0 && (
        <ul className="flex flex-col gap-2">
          {offered.map((field) => (
            <li key={field}>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(field)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, field] : prev.filter((f) => f !== field)
                    )
                  }
                />
                <span className="w-40 shrink-0 font-medium">
                  {t(`documents:extract.field.${field}`)}
                </span>
                <span className="text-(--text-muted)">{display(field, current[field])}</span>
                <span aria-hidden="true">→</span>
                <span className="font-semibold">{display(field, values?.[field])}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {applyFailed && (
        <p role="alert" className="mt-3 text-sm" style={{ color: "var(--ts-bad)" }}>
          {t("documents:extract.applyFailed")}
        </p>
      )}
    </Modal>
  );
}
