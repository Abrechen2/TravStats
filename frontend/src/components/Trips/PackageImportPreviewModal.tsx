import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { apiErrorMachineCode } from "../../lib/apiError";
import type { PackageReading } from "../../lib/api/parse";
import {
  tripPackageApi,
  type PackageChoices,
  type PackageCommitResult,
  type PackageProposal,
} from "../../lib/api/tripPackage";
import { ProposalBody } from "./PackageProposalSections";

/**
 * The review of a package tour (plan 2026-10-09 P3): what the server will
 * create, what it attaches to rows already in the logbook, and what it skips
 * and why — before anything is written.
 *
 * Unlike the cruise import preview, this never creates entities from the
 * browser one by one: the commit is ONE server call in one transaction, so a
 * failure leaves nothing half-imported. A failure is shown as itself, inside
 * the dialog — never as a "saved" toast, and the dialog stays open.
 */
export interface PackageImportPreviewModalProps {
  reading: PackageReading;
  /** The kept document (`retain: true`); the commit files it on the trip. */
  documentId: string | null;
  /** The template's operator, for the intro line. */
  issuer: string | null;
  onCancel: () => void;
  onSaved: (result: PackageCommitResult) => void | Promise<void>;
}

/** The server's code, worded; unknown failures fall back to the generic sentence. */
function failureKey(err: unknown, fallback: "preview" | "commit"): string {
  const code = apiErrorMachineCode(err);
  if (code === "PACKAGE_READING_INVALID") return "readingInvalid";
  if (code === "PACKAGE_READING_MISSING") return "readingMissing";
  if (code === "PACKAGE_FLIGHT_INVALID") return "flightInvalid";
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  if (status === 409) return "documentFiled";
  return fallback;
}

/** "flights[2]" → the flight number the proposal shows for index 2. */
function failedFlight(err: unknown, proposal: PackageProposal | null): string {
  const field = (err as { response?: { data?: { field?: string } } } | undefined)?.response?.data
    ?.field;
  const index = Number(/^flights\[(\d+)\]$/.exec(field ?? "")?.[1]);
  return proposal?.flights.find((f) => f.index === index)?.flightNumber ?? "?";
}

export function PackageImportPreviewModal({
  reading,
  documentId,
  issuer,
  onCancel,
  onSaved,
}: PackageImportPreviewModalProps): JSX.Element {
  const { t } = useTranslation(["import", "common"]);
  const [airports, setAirports] = useState<Record<string, string>>({});
  const [proposal, setProposal] = useState<PackageProposal | null>(null);
  const [tripName, setTripName] = useState("");
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useMemo(
    () => ({ reading, ...(documentId ? { documentId } : {}) }),
    [reading, documentId]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    tripPackageApi
      .preview({ ...request, choices: { airports } })
      .then((next) => {
        if (cancelled) return;
        setProposal(next);
        setTripName((current) => current || next.trip.name);
      })
      .catch((err: unknown) => {
        logger.error("PackageImportPreviewModal: preview failed", err);
        if (!cancelled) setError(t(`import:package.errors.${failureKey(err, "preview")}`));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request, airports, t]);

  const pickAirport = useCallback((city: string, iata: string) => {
    setAirports((current) => ({ ...current, [city]: iata }));
  }, []);

  const handleCommit = async (): Promise<void> => {
    setCommitting(true);
    setError(null);
    const choices: PackageChoices = {
      airports,
      ...(proposal?.trip.action === "create" && tripName.trim()
        ? { tripName: tripName.trim() }
        : {}),
    };
    try {
      const result = await tripPackageApi.commit({ ...request, choices });
      await onSaved(result);
    } catch (err) {
      logger.error("PackageImportPreviewModal: commit failed", err);
      const key = failureKey(err, "commit");
      setError(
        t(
          `import:package.errors.${key}`,
          key === "flightInvalid" ? { flight: failedFlight(err, proposal) } : {}
        )
      );
    } finally {
      setCommitting(false);
    }
  };

  const nothingNew =
    proposal !== null &&
    proposal.trip.action === "attach" &&
    [...proposal.flights, ...proposal.stays, ...(proposal.cruise ? [proposal.cruise] : [])].every(
      (e) => e.action === "skip"
    );

  return (
    <Modal
      open
      onClose={onCancel}
      busy={committing}
      title={t("import:package.title")}
      maxWidth={720}
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={committing}>
            {t("common:buttons.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleCommit()}
            disabled={loading || committing || proposal === null}
          >
            {committing ? t("import:package.committing") : t("import:package.commit")}
          </button>
        </>
      }
    >
      {issuer && (
        <p className="text-sm text-(--text-muted)">{t("import:package.intro", { issuer })}</p>
      )}
      {error && (
        <p role="alert" className="mt-3 font-medium text-(--danger)">
          {error}
        </p>
      )}
      {loading && !proposal && (
        <p className="mt-3 text-sm text-(--text-muted)">{t("import:package.loading")}</p>
      )}
      {nothingNew && <p className="mt-3 text-sm">{t("import:package.nothingNew")}</p>}
      {proposal && (
        <ProposalBody
          proposal={proposal}
          tripName={tripName}
          onTripName={setTripName}
          onPickAirport={pickAirport}
        />
      )}
    </Modal>
  );
}
