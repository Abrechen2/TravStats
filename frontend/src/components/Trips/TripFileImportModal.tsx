import { useEffect, useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { apiErrorMachineCode } from "../../lib/apiError";
import { formatLocalDate } from "../../lib/displayFormat";
import {
  tripExchangeApi,
  type TripFileCommitResult,
  type TripFileProposal,
} from "../../lib/api/tripExchange";
import { ActionBadge, Section } from "./PackageProposalSections";

/**
 * The review of a `.travstats` file (spec 2026-10-09 S3), built like the
 * package review: what the server will create, what it attaches to rows
 * already in the logbook, what it skips and why — before anything is
 * written. The commit is ONE server call in one transaction; a failure is
 * shown in the dialog as itself, and the dialog stays open.
 */
export interface TripFileImportModalProps {
  file: File;
  onCancel: () => void;
  onSaved: (result: TripFileCommitResult) => void | Promise<void>;
}

/** The server's code, worded; anything else falls back to the step's own sentence. */
export function tripFileFailureKey(err: unknown, fallback: "preview" | "commit"): string {
  const code = apiErrorMachineCode(err);
  if (code === "TRIP_FILE_INVALID") return "invalid";
  if (code === "TRIP_FILE_VERSION_UNSUPPORTED") return "version";
  if (code === "TRIP_FILE_TOO_LARGE") return "tooLarge";
  if (code === "TRIP_FILE_UNSAFE_PATH") return "unsafe";
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  if (status === 413) return "tooLarge";
  if (status === 429) return "rateLimited";
  return fallback;
}

export function TripFileImportModal({
  file,
  onCancel,
  onSaved,
}: TripFileImportModalProps): JSX.Element {
  const { t } = useTranslation(["import", "common"]);
  const [proposal, setProposal] = useState<TripFileProposal | null>(null);
  const [tripName, setTripName] = useState("");
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    tripExchangeApi
      .preview(file)
      .then((next) => {
        if (cancelled) return;
        setProposal(next);
        setTripName(next.trip.name);
      })
      .catch((err: unknown) => {
        logger.error("TripFileImportModal: preview failed", err);
        if (!cancelled) setError(t(`import:tripFile.errors.${tripFileFailureKey(err, "preview")}`));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, t]);

  const handleCommit = async (): Promise<void> => {
    setCommitting(true);
    setError(null);
    const name = proposal?.trip.action === "create" ? tripName.trim() : "";
    try {
      const result = await tripExchangeApi.commit(file, name || undefined);
      await onSaved(result);
    } catch (err) {
      logger.error("TripFileImportModal: commit failed", err);
      setError(t(`import:tripFile.errors.${tripFileFailureKey(err, "commit")}`));
    } finally {
      setCommitting(false);
    }
  };

  const nothingNew =
    proposal !== null &&
    proposal.trip.action === "attach" &&
    proposal.entries.every((e) => e.action === "skip") &&
    proposal.documents.create + proposal.photos.create + proposal.journal.create === 0;

  return (
    <Modal
      open
      onClose={onCancel}
      busy={committing}
      title={t("import:tripFile.title")}
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
            {committing ? t("import:tripFile.committing") : t("import:tripFile.commit")}
          </button>
        </>
      }
    >
      {error && (
        <p role="alert" className="font-medium text-(--danger)">
          {error}
        </p>
      )}
      {loading && !proposal && (
        <p className="mt-3 text-sm text-(--text-muted)">{t("import:tripFile.loading")}</p>
      )}
      {nothingNew && <p className="mt-3 text-sm">{t("import:tripFile.nothingNew")}</p>}
      {proposal && (
        <ProposalView proposal={proposal} tripName={tripName} onTripName={setTripName} />
      )}
    </Modal>
  );
}

function ProposalView({
  proposal,
  tripName,
  onTripName,
}: {
  proposal: TripFileProposal;
  tripName: string;
  onTripName: (name: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["import"]);
  const included = (["documents", "photos", "private"] as const).filter((k) => proposal.options[k]);
  const fileRows = (["documents", "photos", "journal"] as const).filter(
    (k) => proposal[k].create + proposal[k].skip > 0
  );
  return (
    <div>
      <p className="mt-3 text-sm text-(--text-muted)">
        {t("import:tripFile.intro", {
          date: formatLocalDate(proposal.exportedAt.slice(0, 10)),
          version: proposal.appVersion,
        })}
      </p>
      <p className="mt-1 text-sm text-(--text-muted)">
        {included.length > 0
          ? t("import:tripFile.included", {
              list: included.map((k) => t(`import:tripFile.includes.${k}`)).join(", "),
            })
          : t("import:tripFile.includedNone")}
      </p>
      <Section title={t("import:tripFile.sections.trip")}>
        <li className="flex flex-col gap-1">
          <span className="text-sm">
            {t(`import:package.tripAction.${proposal.trip.action}`)}
            {proposal.trip.matchedBy
              ? ` — ${t(`import:package.matchedBy.${proposal.trip.matchedBy}`)}`
              : ""}
          </span>
          {proposal.trip.action === "create" ? (
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("import:package.tripName")}</span>
              <input
                className="input"
                value={tripName}
                maxLength={200}
                onChange={(e) => onTripName(e.target.value)}
              />
            </label>
          ) : (
            <span className="font-medium">{proposal.trip.name}</span>
          )}
        </li>
      </Section>
      {proposal.bookings.length > 0 && (
        <Section title={t("import:tripFile.sections.bookings")}>
          {proposal.bookings.map((b) => (
            <li key={b.key} className="flex items-center justify-between gap-2 text-sm">
              <span>{b.reference ?? "—"}</span>
              <span className="text-(--text-muted)">
                {t(`import:package.bookingAction.${b.action}`)}
              </span>
            </li>
          ))}
        </Section>
      )}
      {proposal.entries.length > 0 && (
        <Section title={t("import:tripFile.sections.entries")}>
          {proposal.entries.map((e) => (
            <li
              key={e.key}
              className="flex items-center justify-between gap-2 text-sm"
              data-testid="trip-file-entry"
            >
              <span className="min-w-0">
                <span className="text-(--text-muted)">{t(`import:tripFile.kind.${e.kind}`)}</span>{" "}
                <span className="font-medium">{e.label}</span>
                {e.day ? (
                  <span className="text-(--text-muted)"> · {formatLocalDate(e.day)}</span>
                ) : null}
              </span>
              <ActionBadge action={e.action} reason={e.reason} />
            </li>
          ))}
        </Section>
      )}
      {fileRows.length > 0 && (
        <Section title={t("import:tripFile.sections.files")}>
          {fileRows.map((k) => (
            <li key={k} className="text-sm">
              {t(`import:tripFile.files.${k}`, proposal[k])}
            </li>
          ))}
        </Section>
      )}
    </div>
  );
}
