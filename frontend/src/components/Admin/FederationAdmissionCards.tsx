import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import {
  federationAdminApi,
  federationErrorCode,
  type FederationAdmission,
} from "../../lib/api/federationAdmin";
import { Button } from "../ui";
import { ErrorLine } from "../ui/settings";

const NS = "federation.admissions";

/**
 * Admin → Instanz → Föderation: servers waiting to be admitted (spec 2026-11-07 §6.2). A card
 * per request that needs this admin's decision, showing the address and the full fingerprint to
 * compare over a second channel, and who asked. Approving admits the server (it pins it);
 * declining burns the request. Requests already sent on wait for the other admin and show as
 * a line without buttons.
 */
export default function FederationAdmissionCards({
  onDecided,
  disabled = false,
}: {
  /** An approval changes the pinned servers, so the parent reloads its state. */
  onDecided: () => void;
  disabled?: boolean;
}): JSX.Element | null {
  const { t } = useTranslation(["admin"]);
  const fmt = useDisplayFormat();
  const [rows, setRows] = useState<FederationAdmission[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    federationAdminApi
      .admissions()
      .then((list) => alive && setRows(list))
      .catch((error: unknown) => {
        logger.error("Loading the admission requests failed:", error);
        if (alive) setErrorKey("federation.admissions.loadFailed");
      });
    return () => {
      alive = false;
    };
  }, []);

  const decide = async (row: FederationAdmission, approve: boolean): Promise<void> => {
    setBusyId(row.id);
    setErrorKey(null);
    try {
      if (approve) await federationAdminApi.approveAdmission(row.id);
      else await federationAdminApi.declineAdmission(row.id);
      setRows((current) => (current ?? []).filter((r) => r.id !== row.id));
      onDecided();
    } catch (error) {
      logger.error("Deciding an admission request failed:", error);
      setErrorKey(`federation.error.${federationErrorCode(error) ?? "generic"}`);
    } finally {
      setBusyId(null);
    }
  };

  const pending = (rows ?? []).filter((r) => r.status === "pending");
  const waiting = (rows ?? []).filter((r) => r.status === "sent");
  if (pending.length === 0 && waiting.length === 0 && !errorKey) return null;

  return (
    <section
      data-testid="federation-admissions"
      className="flex flex-col"
      style={{ gap: "var(--ts-space-sm)" }}
    >
      <p style={{ fontWeight: 600, margin: 0 }}>{t(`${NS}.title`)}</p>
      {pending.map((row) => (
        <article
          key={row.id}
          data-testid={`federation-admission-${row.id}`}
          className="flex flex-col rounded-lg p-3"
          style={{ gap: "var(--ts-space-xs)", border: "1px solid var(--ts-border)" }}
        >
          <span className="t-caption">{t(`${NS}.direction.${row.direction}`)}</span>
          <code className="break-all">{row.origin}</code>
          <span className="t-caption">{t(`${NS}.fingerprint`)}</span>
          <code className="break-all t-caption">{row.fingerprint}</code>
          {row.person ? (
            <span className="t-caption">
              {t(`${NS}.askedBy`)} {row.person.displayName || row.person.username} (
              {row.person.username}) · {fmt.dateTime(row.createdAt)}
            </span>
          ) : null}
          <span className="t-caption">{t(`${NS}.tripSharingNote`)}</span>
          <span className="flex flex-wrap" style={{ gap: "var(--ts-space-xs)" }}>
            <Button
              variant="primary"
              disabled={disabled || busyId !== null}
              onClick={() => void decide(row, true)}
            >
              {t(`${NS}.approve`)}
            </Button>
            <Button
              variant="danger"
              disabled={disabled || busyId !== null}
              onClick={() => void decide(row, false)}
            >
              {t(`${NS}.decline`)}
            </Button>
          </span>
        </article>
      ))}
      {waiting.map((row) => (
        <p key={row.id} className="t-caption" style={{ margin: 0 }}>
          <code className="break-all">{row.origin}</code> · {t(`${NS}.waitingForOther`)}
        </p>
      ))}
      {errorKey ? <ErrorLine>{t(errorKey)}</ErrorLine> : null}
    </section>
  );
}
