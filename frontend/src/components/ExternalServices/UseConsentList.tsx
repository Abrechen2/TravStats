import { useCallback, useEffect, useState, type JSX } from "react";
import Button from "../ui/Button";
import { useTranslation } from "../../hooks/useTranslation";
import { serviceUseApi, type UseConsentRow } from "../../lib/api/serviceUse";
import { logger } from "../../lib/logger";
import { formatDayLong } from "../../shared/time/calendar";
import InlineError from "../ui/InlineError";

/**
 * Einstellungen › Dienste: the services this account allowed for good
 * ("Immer erlauben für diesen Dienst", owner 2026-11-25). Revoking one brings
 * the confirmation back on its next use. A failure to load or revoke is said
 * here, in the list, not swallowed.
 */
export default function UseConsentList(): JSX.Element {
  const { t, i18n } = useTranslation(["externalServices"]);
  const [rows, setRows] = useState<UseConsentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Keys, not copy: the state must not depend on `t`, or each render would load again.
  const load = useCallback(async () => {
    try {
      setRows(await serviceUseApi.list());
      setError(null);
    } catch (e) {
      logger.warn("use consents: load failed", e);
      setError("loadFailed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (serviceId: string) => {
    try {
      await serviceUseApi.revoke(serviceId);
      setNote("revoked");
      setError(null);
      await load();
    } catch (e) {
      logger.warn("use consents: revoke failed", e);
      setError("revokeFailed");
    }
  };

  return (
    <section
      className="flex flex-col gap-2"
      data-testid="use-consent-list"
      aria-labelledby="use-consent-title"
    >
      <h2 id="use-consent-title" className="t-card-title">
        {t("externalServices:useConsent.listTitle")}
      </h2>
      {error && <InlineError>{t(`externalServices:useConsent.${error}`)}</InlineError>}
      {note && (
        <p role="status" className="t-caption">
          {t(`externalServices:useConsent.${note}`)}
        </p>
      )}
      {rows && rows.length === 0 && (
        <p className="t-caption">{t("externalServices:useConsent.listEmpty")}</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.serviceId} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>{t(`externalServices:useConsent.services.${r.serviceId}`)}</strong>{" "}
                <span className="t-caption">
                  {t("externalServices:useConsent.listSince", {
                    date: formatDayLong(r.at.slice(0, 10), i18n.language),
                    target: r.target,
                  })}
                </span>
              </span>
              <Button
                onClick={() => void revoke(r.serviceId)}
                data-testid={`use-consent-revoke-${r.serviceId}`}
              >
                {t("externalServices:useConsent.revoke")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
